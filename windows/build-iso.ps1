#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Builds PC5 OS: a stripped-down Windows 11 install ISO that boots straight
  into the PC5Shell console UI.

.DESCRIPTION
  Takes YOUR official Windows 11 ISO (download it from microsoft.com) and:
    1. keeps a single edition and removes bloat apps (Xbox/Store apps are kept)
    2. applies console-friendly registry tweaks (no lock screen, no ads,
       no BitLocker auto-encryption, no forced reboots while logged in, game mode)
    3. installs PC5Shell and makes it the user's shell instead of Explorer
    4. bundles the Steam installer, run silently at first boot
    5. writes autounattend.xml (local account, auto-login, no OOBE screens)
    6. produces a bootable ISO with oscdimg (Windows ADK)

  You still need a valid Windows licence for the installed machine.

.EXAMPLE
  .\build-iso.ps1 -IsoPath D:\Win11_24H2_English_x64.iso

.EXAMPLE
  # Dual boot: install into an empty partition you created next to your current
  # Windows (Disk Management > Shrink Volume > New Simple Volume). Only that
  # partition is formatted. Find the numbers with: Get-Partition
  .\build-iso.ps1 -IsoPath D:\Win11.iso -InstallDisk 0 -InstallPartition 5

.EXAMPLE
  # Fully hands-off install that ERASES DISK 0 without asking:
  .\build-iso.ps1 -IsoPath D:\Win11.iso -AutoWipeDisk0 -ProductKey XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
#>
param(
    [Parameter(Mandatory)] [string] $IsoPath,
    [string] $OutIso = (Join-Path $PSScriptRoot 'PC5OS.iso'),
    [string] $ShellDir = (Join-Path $PSScriptRoot '..\shell\dist\win-unpacked'),
    [string] $Edition = 'Windows 11 Pro',
    [string] $UserName = 'Player',
    [string] $Locale = 'en-US',
    [string] $TimeZone = 'Pacific Standard Time',
    [string] $ProductKey = '',
    [string] $WorkDir = 'C:\PC5Build',   # must not contain spaces (oscdimg)
    # Erase the first disk and install without asking. Dangerous - see README.
    [switch] $AutoWipeDisk0,
    # Dual boot: format and install into this one partition, no questions asked.
    # Numbers as shown by Get-Partition (DiskNumber / PartitionNumber).
    [int] $InstallDisk = -1,
    [int] $InstallPartition = -1,
    # Allow installing on PCs without TPM 2.0 / Secure Boot / 4 GB RAM.
    [switch] $BypassHardwareChecks,
    # Also remove the Xbox app, Game Bar and Microsoft Store (breaks Game Pass).
    [switch] $RemoveXbox,
    # Bundle the Epic Games Launcher installer too.
    [switch] $IncludeEpic,
    # Keep UAC prompts (they need a mouse to answer; off by default for a console).
    [switch] $KeepUacPrompts
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# ---------------------------------------------------------------- preflight
$oscdimg = "${env:ProgramFiles(x86)}\Windows Kits\10\Assessment and Deployment Kit\Deployment Tools\amd64\Oscdimg\oscdimg.exe"
if (-not (Test-Path $oscdimg)) {
    throw "oscdimg.exe not found. Install the Windows ADK 'Deployment Tools' feature: https://learn.microsoft.com/windows-hardware/get-started/adk-install"
}
if (-not (Test-Path (Join-Path $ShellDir 'PC5Shell.exe'))) {
    throw "PC5Shell build not found in $ShellDir. Run 'npm install' and 'npm run dist' in the shell folder first."
}
if ($AutoWipeDisk0 -and $InstallDisk -ge 0) { throw 'Use either -AutoWipeDisk0 or -InstallDisk/-InstallPartition, not both.' }
if (($InstallDisk -ge 0) -xor ($InstallPartition -ge 0)) { throw 'Give both -InstallDisk and -InstallPartition.' }
$IsoPath = (Resolve-Path $IsoPath).Path
$ShellDir = (Resolve-Path $ShellDir).Path

$isoDir = Join-Path $WorkDir 'iso'
$mountDir = Join-Path $WorkDir 'mount'
$scriptsSrc = Join-Path $PSScriptRoot 'scripts'
if (Test-Path $WorkDir) {
    Get-WindowsImage -Mounted | Where-Object Path -like "$WorkDir*" | ForEach-Object { Dismount-WindowsImage -Path $_.Path -Discard | Out-Null }
    Remove-Item $WorkDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $isoDir, $mountDir | Out-Null

# ---------------------------------------------------------------- copy ISO
Step "Copying Windows media from $IsoPath"
$disk = Mount-DiskImage -ImagePath $IsoPath -PassThru
try {
    $drive = ($disk | Get-Volume).DriveLetter + ':'
    robocopy "$drive\" $isoDir /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
} finally {
    Dismount-DiskImage -ImagePath $IsoPath | Out-Null
}
attrib -r "$isoDir\*" /s /d

# ---------------------------------------------------------------- single edition
$wim = Join-Path $isoDir 'sources\install.wim'
$esd = Join-Path $isoDir 'sources\install.esd'
$source = if (Test-Path $wim) { $wim } elseif (Test-Path $esd) { $esd } else { throw 'No install.wim/esd in ISO' }
$image = Get-WindowsImage -ImagePath $source | Where-Object ImageName -eq $Edition
if (-not $image) {
    $names = (Get-WindowsImage -ImagePath $source).ImageName -join ', '
    throw "Edition '$Edition' not found. Available: $names"
}
Step "Extracting '$Edition' (index $($image.ImageIndex))"
$workWim = Join-Path $WorkDir 'install.wim'
Export-WindowsImage -SourceImagePath $source -SourceIndex $image.ImageIndex -DestinationImagePath $workWim -CompressionType max | Out-Null
Remove-Item $source -Force

Step 'Mounting image'
Mount-WindowsImage -ImagePath $workWim -Index 1 -Path $mountDir | Out-Null

try {
    # ------------------------------------------------------------ remove apps
    Step 'Removing bloatware apps'
    $removeApps = @(
        'Clipchamp.Clipchamp', 'Microsoft.BingNews', 'Microsoft.BingWeather', 'Microsoft.BingSearch',
        'Microsoft.Copilot', 'Microsoft.Windows.Ai.Copilot', 'Microsoft.GetHelp', 'Microsoft.Getstarted',
        'Microsoft.MicrosoftOfficeHub', 'Microsoft.MicrosoftSolitaireCollection', 'Microsoft.MicrosoftStickyNotes',
        'Microsoft.MicrosoftJournal', 'Microsoft.People', 'Microsoft.PowerAutomateDesktop', 'Microsoft.Todos',
        'Microsoft.WindowsAlarms', 'Microsoft.WindowsCamera', 'microsoft.windowscommunicationsapps',
        'Microsoft.WindowsFeedbackHub', 'Microsoft.WindowsMaps', 'Microsoft.WindowsSoundRecorder',
        'Microsoft.YourPhone', 'Microsoft.ZuneMusic', 'Microsoft.ZuneVideo', 'Microsoft.OutlookForWindows',
        'MicrosoftCorporationII.QuickAssist', 'MicrosoftCorporationII.MicrosoftFamily', 'MSTeams',
        'Microsoft.Windows.DevHome', 'Microsoft.549981C3F5F10'
    )
    if ($RemoveXbox) {
        $removeApps += 'Microsoft.GamingApp', 'Microsoft.XboxGamingOverlay', 'Microsoft.XboxIdentityProvider',
                       'Microsoft.XboxSpeechToTextOverlay', 'Microsoft.Xbox.TCUI', 'Microsoft.WindowsStore', 'Microsoft.StorePurchaseApp'
    }
    Get-AppxProvisionedPackage -Path $mountDir | Where-Object {
        $name = $_.DisplayName
        $removeApps | Where-Object { $name -like "$_*" }
    } | ForEach-Object {
        Write-Host "   - $($_.DisplayName)"
        Remove-AppxProvisionedPackage -Path $mountDir -PackageName $_.PackageName | Out-Null
    }

    Step 'Removing optional capabilities'
    foreach ($cap in 'Browser.InternetExplorer', 'MathRecognizer', 'App.StepsRecorder', 'Microsoft.Windows.WordPad', 'App.Support.QuickAssist') {
        Get-WindowsCapability -Path $mountDir | Where-Object { $_.Name -like "$cap*" -and $_.State -eq 'Installed' } | ForEach-Object {
            Write-Host "   - $($_.Name)"
            try { Remove-WindowsCapability -Path $mountDir -Name $_.Name | Out-Null } catch { Write-Warning $_ }
        }
    }

    # ------------------------------------------------------------ registry
    Step 'Applying registry tweaks'
    reg load HKLM\O_SOFTWARE "$mountDir\Windows\System32\config\SOFTWARE" | Out-Null
    reg load HKLM\O_SYSTEM "$mountDir\Windows\System32\config\SYSTEM" | Out-Null
    reg load HKLM\O_DEFAULT "$mountDir\Users\Default\NTUSER.DAT" | Out-Null
    try {
        function Set-Reg($key, $name, $value, $type = 'REG_DWORD') {
            reg add $key /v $name /t $type /d $value /f | Out-Null
        }
        $shellExe = 'C:\Program Files\PC5Shell\PC5Shell.exe'

        # Console shell for every user profile created from Default (incl. the console account).
        Set-Reg 'HKLM\O_DEFAULT\Software\Microsoft\Windows NT\CurrentVersion\Winlogon' 'Shell' $shellExe 'REG_SZ'

        # No ads, suggested apps, "finish setting up your PC" nags.
        Set-Reg 'HKLM\O_SOFTWARE\Policies\Microsoft\Windows\CloudContent' 'DisableWindowsConsumerFeatures' 1
        Set-Reg 'HKLM\O_SOFTWARE\Policies\Microsoft\Windows\CloudContent' 'DisableConsumerAccountStateContent' 1
        $cdm = 'HKLM\O_DEFAULT\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'
        foreach ($v in 'SilentInstalledAppsEnabled', 'SystemPaneSuggestionsEnabled', 'SoftLandingEnabled', 'SubscribedContentEnabled',
                       'PreInstalledAppsEnabled', 'OemPreInstalledAppsEnabled', 'ContentDeliveryAllowed') { Set-Reg $cdm $v 0 }
        Set-Reg 'HKLM\O_DEFAULT\Software\Microsoft\Windows\CurrentVersion\UserProfileEngagement' 'ScoobeSystemSettingEnabled' 0
        reg delete 'HKLM\O_DEFAULT\Software\Microsoft\Windows\CurrentVersion\Run' /v OneDriveSetup /f 2>$null | Out-Null

        # Telemetry minimum (fully honoured on Enterprise/Education only).
        Set-Reg 'HKLM\O_SOFTWARE\Policies\Microsoft\Windows\DataCollection' 'AllowTelemetry' 0

        # Console behaviour.
        Set-Reg 'HKLM\O_SOFTWARE\Policies\Microsoft\Windows\Personalization' 'NoLockScreen' 1
        Set-Reg 'HKLM\O_SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' 'NoAutoRebootWithLoggedOnUsers' 1
        Set-Reg 'HKLM\O_SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE' 'BypassNRO' 1
        Set-Reg 'HKLM\O_SYSTEM\ControlSet001\Control\BitLocker' 'PreventDeviceEncryption' 1
        Set-Reg 'HKLM\O_DEFAULT\Software\Microsoft\GameBar' 'AutoGameModeEnabled' 1
        Set-Reg 'HKLM\O_DEFAULT\Software\Microsoft\GameBar' 'UseNexusForGameBarEnabled' 0
        if (-not $KeepUacPrompts) {
            # Elevate admins silently: UAC dialogs can't be answered with a controller.
            Set-Reg 'HKLM\O_SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' 'ConsentPromptBehaviorAdmin' 0
        }
        if ($BypassHardwareChecks) {
            Set-Reg 'HKLM\O_SYSTEM\Setup\MoSetup' 'AllowUpgradesWithUnsupportedTPMOrCPU' 1
        }
    } finally {
        [gc]::Collect()
        Start-Sleep -Seconds 2
        reg unload HKLM\O_SOFTWARE | Out-Null
        reg unload HKLM\O_SYSTEM | Out-Null
        reg unload HKLM\O_DEFAULT | Out-Null
    }

    # ------------------------------------------------------------ shell + first boot
    Step 'Installing PC5Shell into the image'
    robocopy $ShellDir "$mountDir\Program Files\PC5Shell" /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }

    $setupScripts = "$mountDir\Windows\Setup\Scripts"
    New-Item -ItemType Directory -Force -Path $setupScripts | Out-Null
    Copy-Item "$scriptsSrc\SetupComplete.cmd", "$scriptsSrc\firstboot.ps1" $setupScripts
    Set-Content -Path "$setupScripts\pc5-user.txt" -Value $UserName -Encoding ascii

    Step 'Downloading launcher installers'
    Invoke-WebRequest 'https://cdn.cloudflare.steamstatic.com/client/installer/SteamSetup.exe' -OutFile "$setupScripts\SteamSetup.exe"
    # 7-Zip lets PC5 extract .7z / .rar / .zip game downloads.
    Invoke-WebRequest 'https://www.7-zip.org/a/7z2409-x64.exe' -OutFile "$setupScripts\7zip-setup.exe"
    if ($IncludeEpic) {
        Invoke-WebRequest 'https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/installer/download/EpicGamesLauncherInstaller.msi' -OutFile "$setupScripts\EpicInstaller.msi"
    }

    Step 'Saving image'
    Dismount-WindowsImage -Path $mountDir -Save | Out-Null
} catch {
    Write-Warning 'Build failed - discarding mounted image'
    Dismount-WindowsImage -Path $mountDir -Discard -ErrorAction SilentlyContinue | Out-Null
    throw
}

Step 'Compressing install.wim'
Export-WindowsImage -SourceImagePath $workWim -SourceIndex 1 -DestinationImagePath $wim -CompressionType max | Out-Null
Remove-Item $workWim -Force

# ---------------------------------------------------------------- boot.wim
if ($BypassHardwareChecks) {
    Step 'Patching Setup to skip TPM / Secure Boot / RAM checks'
    $bootWim = Join-Path $isoDir 'sources\boot.wim'
    Mount-WindowsImage -ImagePath $bootWim -Index 2 -Path $mountDir | Out-Null
    try {
        reg load HKLM\O_BOOT "$mountDir\Windows\System32\config\SYSTEM" | Out-Null
        foreach ($v in 'BypassTPMCheck', 'BypassSecureBootCheck', 'BypassRAMCheck', 'BypassCPUCheck') {
            reg add 'HKLM\O_BOOT\Setup\LabConfig' /v $v /t REG_DWORD /d 1 /f | Out-Null
        }
        [gc]::Collect()
        reg unload HKLM\O_BOOT | Out-Null
        Dismount-WindowsImage -Path $mountDir -Save | Out-Null
    } catch {
        Dismount-WindowsImage -Path $mountDir -Discard -ErrorAction SilentlyContinue | Out-Null
        throw
    }
}

# ---------------------------------------------------------------- autounattend
Step 'Writing autounattend.xml'
$xml = Get-Content (Join-Path $PSScriptRoot 'autounattend.template.xml') -Raw
$keyBlock = if ($ProductKey) { "<ProductKey><Key>$ProductKey</Key><WillShowUI>OnError</WillShowUI></ProductKey>" } else { '' }
if ($AutoWipeDisk0) {
    Write-Warning 'AutoWipeDisk0: booting this ISO will ERASE disk 0 on the target PC without asking.'
    $diskBlock = @'
<DiskConfiguration>
        <Disk wcm:action="add">
          <DiskID>0</DiskID>
          <WillWipeDisk>true</WillWipeDisk>
          <CreatePartitions>
            <CreatePartition wcm:action="add"><Order>1</Order><Type>EFI</Type><Size>300</Size></CreatePartition>
            <CreatePartition wcm:action="add"><Order>2</Order><Type>MSR</Type><Size>16</Size></CreatePartition>
            <CreatePartition wcm:action="add"><Order>3</Order><Type>Primary</Type><Extend>true</Extend></CreatePartition>
          </CreatePartitions>
          <ModifyPartitions>
            <ModifyPartition wcm:action="add"><Order>1</Order><PartitionID>1</PartitionID><Format>FAT32</Format><Label>System</Label></ModifyPartition>
            <ModifyPartition wcm:action="add"><Order>2</Order><PartitionID>3</PartitionID><Format>NTFS</Format><Label>PC5</Label><Letter>C</Letter></ModifyPartition>
          </ModifyPartitions>
        </Disk>
      </DiskConfiguration>
'@
    $installTo = '<InstallTo><DiskID>0</DiskID><PartitionID>3</PartitionID></InstallTo>'
} elseif ($InstallDisk -ge 0) {
    Write-Warning "Dual boot: booting this ISO will FORMAT partition $InstallPartition on disk $InstallDisk (other partitions are left alone)."
    $diskBlock = @"
<DiskConfiguration>
        <Disk wcm:action="add">
          <DiskID>$InstallDisk</DiskID>
          <WillWipeDisk>false</WillWipeDisk>
          <ModifyPartitions>
            <ModifyPartition wcm:action="add"><Order>1</Order><PartitionID>$InstallPartition</PartitionID><Format>NTFS</Format><Label>PC5</Label></ModifyPartition>
          </ModifyPartitions>
        </Disk>
      </DiskConfiguration>
"@
    $installTo = "<InstallTo><DiskID>$InstallDisk</DiskID><PartitionID>$InstallPartition</PartitionID></InstallTo>"
} else {
    $diskBlock = ''
    $installTo = ''
}
$xml = $xml.Replace('{{LOCALE}}', $Locale).Replace('{{TIMEZONE}}', $TimeZone).Replace('{{USERNAME}}', $UserName)
$xml = $xml.Replace('{{PRODUCT_KEY_BLOCK}}', $keyBlock).Replace('{{DISK_BLOCK}}', $diskBlock).Replace('{{INSTALL_TO_BLOCK}}', $installTo)
Set-Content -Path (Join-Path $isoDir 'autounattend.xml') -Value $xml -Encoding utf8

# ---------------------------------------------------------------- ISO
Step "Creating $OutIso"
$bootData = '2#p0,e,b{0}#pEF,e,b{1}' -f "$isoDir\boot\etfsboot.com", "$isoDir\efi\microsoft\boot\efisys.bin"
& $oscdimg -m -o -u2 -udfver102 -lPC5OS "-bootdata:$bootData" $isoDir $OutIso
if ($LASTEXITCODE -ne 0) { throw "oscdimg failed ($LASTEXITCODE)" }

Write-Host "`nDone: $OutIso" -ForegroundColor Green
Write-Host 'Write it to a USB stick with Rufus (default settings; untick all options in Rufus''s "Windows User Experience" dialog).'
