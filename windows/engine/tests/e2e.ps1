# End-to-end test of the install engine on a real Windows machine (CI runner).
#   partition: installs PC5 OS into a new partition on a virtual disk (VHDX),
#              then checks the files, removed apps, registry, the boot entry
#              (when the machine boots UEFI) and Remove.
#   iso:       builds a PC5 OS ISO and checks what is inside it.
param([Parameter(Mandatory)] [string] $Iso, [ValidateSet('partition', 'iso')] [string] $Target = 'partition', [string] $Work = 'C:\pc5-test')
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\PC5Engine.psm1') -Force -DisableNameChecking
$script:failed = 0
$script:passed = New-Object System.Collections.ArrayList
# GitHub shows only 10 annotations of each kind per step: passes are summed up in one.
function Check([string] $Name, [bool] $Ok, [string] $Detail = '') {
    if ($Ok) { Write-Host "ok   $Name" -ForegroundColor Green; [void]$script:passed.Add($Name) }
    else { Write-Host "::error::FAIL: $Name $Detail"; $script:failed++ }
}

try {
# Quieter event output: steps, warnings and every 10%.
$last = @{ p = -10 }
$emit = {
    param($e)
    if ($e.kind -eq 'step') { Write-Host "==> $($e.label)" -ForegroundColor Cyan }
    elseif ($e.kind -eq 'log' -and ($e.level -eq 'warn' -or $e.level -eq 'error')) { Write-Host "::warning::$($e.text)" }
    elseif ($e.kind -eq 'log' -and $e.level -ne 'step') { Write-Host "    [$($e.level)] $($e.text)" }
    elseif ($e.kind -eq 'progress' -and $e.percent -ge $last.p + 10) { $last.p = $e.percent; Write-Host "    $($e.percent)%" }
}.GetNewClosure()
(Get-Module PC5Engine).SessionState.PSVariable.Set('Emit', $emit)

# Stand-in for the PC5 app files (the real ones come from the installed app).
New-Item -ItemType Directory -Force -Path $Work | Out-Null
$app = Join-Path $Work 'app'
New-Item -ItemType Directory -Force -Path "$app\resources" | Out-Null
Copy-Item "$env:WINDIR\System32\notepad.exe" "$app\PC5Shell.exe"
Set-Content "$app\resources\marker.txt" 'pc5'

$info = Invoke-PC5Command 'info' ([pscustomobject]@{ iso = $Iso })
$info.images | ForEach-Object { Write-Host "Edition $($_.index): $($_.name) $($_.version) $($_.arch)" }
$image = $info.images | Where-Object { $_.arch -eq 'x64' } | Select-Object -First 1
Check 'ISO has an x64 edition' ([bool]$image)
$catalog = Get-PC5Catalog
$items = @($catalog.presets.minimal.items)
$removedPatterns = @(Get-PC5CatalogItems $catalog $items | ForEach-Object { if ($_.PSObject.Properties['appx']) { $_.appx } })

$targets = Invoke-PC5Command 'targets' $null
Write-Host "Firmware: $($targets.firmware); drives: $(@($targets.drives | ForEach-Object { $_.letter }) -join ', ')"

if ($Target -eq 'partition') {
    $vhd = Join-Path $Work 'pc5-test.vhdx'
    Remove-Item $vhd -ErrorAction SilentlyContinue
    "create vdisk file=$vhd maximum=65536 type=expandable`nattach vdisk`nconvert gpt" | Set-Content (Join-Path $Work 'diskpart.txt') -Encoding ASCII
    diskpart /s (Join-Path $Work 'diskpart.txt') | Out-Host
    $disk = Get-Disk | Where-Object { $_.Location -like '*pc5-test.vhdx*' } | Select-Object -First 1
    Check 'test disk attached' ([bool]$disk)

    $spec = [pscustomobject]@{
        target = 'partition'; iso = $Iso; imageIndex = $image.index; items = $items; userName = 'Player'
        locale = 'en-US'; timeZone = 'Pacific Standard Time'; shellDir = $app; version = '0.0.0-test'; skipBoot = $true
        partition = [pscustomobject]@{ mode = 'free'; diskNumber = [int]$disk.Number; sizeGB = 50; makeDefault = $false }
    }
    $r = Invoke-PC5Build $spec
    $root = "$($r.letter):\"
    Write-Host "Installed to $root, removed $($r.removed)"
    Check 'Windows was applied' (Test-Path "$root\Windows\System32\ntoskrnl.exe")
    Check 'PC5 app was copied' ((Test-Path "$root\Program Files\PC5Shell\PC5Shell.exe") -and (Test-Path "$root\Program Files\PC5Shell\resources\marker.txt"))
    Check 'first-boot script is in place' ((Test-Path "$root\Windows\Setup\Scripts\SetupComplete.cmd") -and (Test-Path "$root\Windows\Setup\Scripts\firstboot.ps1"))
    $unattend = [xml](Get-Content "$root\Windows\Panther\unattend.xml" -Raw)
    Check 'unattend.xml has the account and no windowsPE pass' (($unattend.OuterXml -match '<Name>Player</Name>') -and -not ($unattend.OuterXml -match 'windowsPE'))
    Check 'Steam installer was downloaded' (Test-Path "$root\Windows\Setup\Scripts\SteamSetup.exe")
    $left = @(Get-AppxProvisionedPackage -Path $root | Where-Object { $n = $_.DisplayName; $removedPatterns | Where-Object { $n -like "$_*" } })
    Check "stripped apps are gone ($($left.Count) left)" ($left.Count -eq 0)
    Write-Host "Apps kept: $(@(Get-AppxProvisionedPackage -Path $root | ForEach-Object { $_.DisplayName }) -join ', ')"
    reg load HKLM\PC5T_SOFT "$root\Windows\System32\config\SOFTWARE" | Out-Null
    reg load HKLM\PC5T_DEF "$root\Users\Default\NTUSER.DAT" | Out-Null
    try {
        Check 'PC5 OS marker in registry' ([bool]((reg query HKLM\PC5T_SOFT\PC5OS /v Version) -match '0.0.0-test'))
        Check 'console shell for new users' ([bool]((reg query 'HKLM\PC5T_DEF\Software\Microsoft\Windows NT\CurrentVersion\Winlogon' /v Shell) -match 'PC5Shell.exe'))
        Check 'ads policy set' ([bool]((reg query HKLM\PC5T_SOFT\Policies\Microsoft\Windows\CloudContent /v DisableWindowsConsumerFeatures) -match '0x1'))
    } finally {
        [gc]::Collect(); Start-Sleep 1
        reg unload HKLM\PC5T_SOFT | Out-Null
        reg unload HKLM\PC5T_DEF | Out-Null
    }

    if ($targets.firmware -eq 'UEFI') {
        $defaultBefore = [regex]::Match((bcdedit /enum '{default}' /v | Out-String), '\{[0-9a-f-]{36}\}').Value
        $current = [regex]::Match((bcdedit /enum '{current}' /v | Out-String), '\{[0-9a-f-]{36}\}').Value
        $entry = Add-PC5BootEntry $r.letter $false
        Check 'new boot entry is not the running Windows' ($entry -ne $current) "(entry $entry, current $current)"
        $text = bcdedit /enum $entry | Out-String
        Check 'boot entry is called PC5 OS' ($text -match 'PC5 OS')
        $defaultAfter = [regex]::Match((bcdedit /enum '{default}' /v | Out-String), '\{[0-9a-f-]{36}\}').Value
        Check 'default boot entry unchanged' ($defaultBefore -eq $defaultAfter)
        $part = Get-Partition -DriveLetter $r.letter
        Write-PC5State @([ordered]@{ entryId = $entry; partitionGuid = $part.Guid; sizeGB = 50; created = (Get-Date -Format s); sourceLetter = '' })
        Check 'install is listed' (@(Get-PC5Installs | Where-Object { $_.entryId -eq $entry -and $_.healthy }).Count -eq 1)
        Remove-PC5Install $entry | Out-Null
        Check 'remove deletes the partition' (-not (Get-Partition | Where-Object { $_.Guid -eq $part.Guid }))
        $after = (& bcdedit.exe /enum $entry 2>&1 | Out-String).Trim()
        $code = $LASTEXITCODE
        $stillListed = (& bcdedit.exe /enum osloader /v | Out-String) -match [regex]::Escape($entry)
        Check 'remove deletes the boot entry' (-not $stillListed) "(enum exit $code, output: $($after -replace '\s+', ' '))"
    } else { Write-Host 'This machine boots BIOS: boot-menu checks skipped.' -ForegroundColor Yellow }
} else {
    $out = Join-Path $Work 'out\PC5-OS.iso'
    $spec = [pscustomobject]@{
        target = 'iso'; iso = $Iso; imageIndex = $image.index; items = $items; userName = 'Player'; isoOut = $out
        locale = 'en-US'; timeZone = 'Pacific Standard Time'; shellDir = $app; version = '0.0.0-test'; bypassChecks = $true; workDir = (Join-Path $Work 'build')
    }
    $r = Invoke-PC5Build $spec
    Check 'ISO was written' ((Test-Path $out) -and (Get-Item $out).Length -gt 2GB)
    Write-Host ("ISO size {0:N2} GB" -f ((Get-Item $out).Length / 1GB))
    $m = Mount-DiskImage -ImagePath $out -PassThru
    try {
        $d = "$(($m | Get-Volume).DriveLetter):\"
        Check 'ISO has install.wim, boot files and autounattend.xml' ((Test-Path "$d\sources\install.wim") -and (Test-Path "$d\efi\microsoft\boot\efisys.bin") -and (Test-Path "$d\autounattend.xml"))
        Check 'ISO has one edition' (@(Get-WindowsImage -ImagePath "$d\sources\install.wim").Count -eq 1)
    } finally { Dismount-DiskImage -ImagePath $out | Out-Null }
    Check 'temporary files cleaned up' (-not (Test-Path (Join-Path $Work 'build')))
}

} catch {
    Write-Host "::error::$($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim()))"
    exit 1
}
Write-Host "::notice::passed $($script:passed.Count): $($script:passed -join '; ')"
if ($script:failed) { Write-Host "::error::$script:failed checks failed"; exit 1 }
Write-Host 'end-to-end test passed' -ForegroundColor Green
