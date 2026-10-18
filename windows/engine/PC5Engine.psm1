# PC5 OS install engine.
#
# Turns a Windows ISO into PC5 OS. Three targets:
#   partition  install next to the current Windows (dual boot, no USB needed):
#              shrink a drive, apply the image to the new partition, strip it,
#              add PC5, and add "PC5 OS" to the boot menu
#   usb        a bootable install USB (UEFI) with the stripped image
#   iso        a bootable PC5 OS ISO (for VMs, Ventoy, or another PC)
#
# Runs elevated, from pc5-engine.ps1, and reports progress as JSON events that
# the PC5 OS Installer window shows. Windows PowerShell 5.1 compatible.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:WindowsDir = Split-Path $PSScriptRoot -Parent
$script:StateFile = Join-Path $(if ($env:ProgramData) { $env:ProgramData } else { [IO.Path]::GetTempPath() }) 'PC5OS\installs.json'
$script:Emit = { param($Event) [Console]::Out.WriteLine(($Event | ConvertTo-Json -Compress -Depth 10)) }
$script:CancelFile = $null
$script:Plan = @()
$script:StepIndex = -1
$script:Undo = New-Object System.Collections.ArrayList
$script:MinSizeGB = 40
$script:HostReserveGB = 20
$BASIC_DATA = '{ebd0a0a2-b9e5-4433-87c0-68b6b72699c7}'

# ------------------------------------------------------------------ events
function Send-PC5Event([hashtable] $Data) { & $script:Emit $Data }
function Write-PC5Log([string] $Text, [string] $Level = 'info') { Send-PC5Event @{ kind = 'log'; level = $Level; text = $Text } }

function Start-PC5Plan([object[]] $Steps) {
    $script:Plan = $Steps
    $script:StepIndex = -1
    Send-PC5Event @{ kind = 'plan'; steps = @($Steps | ForEach-Object { @{ id = $_.id; label = $_.label } }) }
}

function Start-PC5Step([string] $Id) {
    for ($i = 0; $i -lt $script:Plan.Count; $i++) { if ($script:Plan[$i].id -eq $Id) { $script:StepIndex = $i } }
    Assert-NotCancelled
    $step = $script:Plan[$script:StepIndex]
    Send-PC5Event @{ kind = 'step'; id = $Id; label = $step.label; percent = (Get-OverallPercent 0) }
    Write-PC5Log $step.label 'step'
}

function Get-OverallPercent([double] $StepPercent) {
    if (-not $script:Plan.Count -or $script:StepIndex -lt 0) { return 0 }
    $total = 0; $done = 0
    for ($i = 0; $i -lt $script:Plan.Count; $i++) {
        $w = [double]$script:Plan[$i].weight
        $total += $w
        if ($i -lt $script:StepIndex) { $done += $w }
    }
    $done += [double]$script:Plan[$script:StepIndex].weight * [math]::Min(100, [math]::Max(0, $StepPercent)) / 100
    return [math]::Round(100 * $done / $total, 1)
}

function Set-PC5StepProgress([double] $Percent, [string] $Detail = '') {
    Send-PC5Event @{ kind = 'progress'; stepPercent = [math]::Round($Percent, 1); percent = (Get-OverallPercent $Percent); detail = $Detail }
}

function Set-PC5CancelFile([string] $Path) { $script:CancelFile = $Path }
function Test-CancelRequested { return [bool]($script:CancelFile -and (Test-Path -LiteralPath $script:CancelFile)) }
function Assert-NotCancelled {
    if (Test-CancelRequested) { throw (New-Object System.OperationCanceledException 'Cancelled') }
}

# Undo actions run in reverse order if a build fails or is cancelled.
function Push-PC5Undo([string] $Label, [scriptblock] $Action) { [void]$script:Undo.Insert(0, @{ label = $Label; action = $Action }) }
function Invoke-PC5Undo {
    foreach ($u in @($script:Undo)) {
        try { Write-PC5Log "Undoing: $($u.label)" 'warn'; & $u.action } catch { Write-PC5Log "Couldn't undo ($($u.label)): $($_.Exception.Message)" 'error' }
    }
    $script:Undo.Clear()
}

# ------------------------------------------------------------------ helpers
function Format-PC5Arg([string] $Value) {
    if ($Value -match '[\s"]') { return '"' + ($Value -replace '"', '\"') + '"' }
    return $Value
}

# Runs a program, returns its output, throws with that output if it fails.
function Invoke-PC5Native([string] $File, [string[]] $Arguments, [int[]] $OkCodes = @(0)) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $File
    $psi.Arguments = ($Arguments | ForEach-Object { Format-PC5Arg $_ }) -join ' '
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $err = $p.StandardError.ReadToEndAsync()
    $out = $p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    $text = ($out + $err.Result).Trim()
    if ($OkCodes -notcontains $p.ExitCode) { throw "$([IO.Path]::GetFileName($File)) failed ($($p.ExitCode)): $text" }
    return $text
}

# DISM with live progress (it prints "[=====  42.0% ]" updates) and cancel support.
function Invoke-PC5Dism([string] $Arguments) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = Join-Path $env:WINDIR 'System32\dism.exe'
    $psi.Arguments = "/English /NoRestart $Arguments"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $err = $p.StandardError.ReadToEndAsync()
    $line = New-Object System.Text.StringBuilder
    $all = New-Object System.Text.StringBuilder
    $last = -1
    while (($c = $p.StandardOutput.Read()) -ge 0) {
        $ch = [char]$c
        if ($ch -ne "`r" -and $ch -ne "`n") { [void]$line.Append($ch); continue }
        $text = $line.ToString()
        [void]$line.Clear()
        if (-not $text.Trim()) { continue }
        if ($text -match '(\d{1,3}(?:[.,]\d+)?)\s*%') {
            $pct = [double]($Matches[1] -replace ',', '.')
            if ([int]$pct -ne $last) { $last = [int]$pct; Set-PC5StepProgress $pct }
        } else { [void]$all.AppendLine($text) }
        if (Test-CancelRequested) {
            try { $p.Kill() } catch { }
            throw (New-Object System.OperationCanceledException 'Cancelled')
        }
    }
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) {
        $msg = (($all.ToString() + $err.Result) -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 6) -join ' '
        throw "DISM failed ($($p.ExitCode)): $msg"
    }
}

function Invoke-PC5Robocopy([string] $From, [string] $To, [string[]] $Extra = @()) {
    Invoke-PC5Native (Join-Path $env:WINDIR 'System32\robocopy.exe') (@($From, $To, '/E', '/R:2', '/W:2', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') + $Extra) @(0, 1, 2, 3, 4, 5, 6, 7) | Out-Null
}

function Get-PC5Catalog { return Get-Content (Join-Path $PSScriptRoot 'strip-catalog.json') -Raw -Encoding UTF8 | ConvertFrom-Json }

function Get-PC5CatalogItems([object] $Catalog, [string[]] $Ids) {
    $all = @()
    foreach ($g in $Catalog.groups) { foreach ($i in $g.items) { if ($Ids -contains $i.id) { $all += $i } } }
    return , $all
}

# Valid Windows local account name, and not one Windows reserves.
function Test-PC5UserName([string] $Name) {
    if (-not $Name -or $Name.Length -gt 20) { return $false }
    if ($Name -match '[\\/\[\]:;|=,+*?<>@"]' -or $Name.EndsWith('.') -or $Name.Trim() -ne $Name) { return $false }
    return @('administrator', 'guest', 'defaultaccount', 'wdagutilityaccount', 'system', 'none') -notcontains $Name.ToLowerInvariant()
}

function ConvertTo-PC5XmlText([string] $Text) { return [System.Security.SecurityElement]::Escape($Text) }

# unattend.xml from the template. 'media' = install media (autounattend.xml);
# 'applied' = an image applied directly to a partition (Windows\Panther\unattend.xml).
function New-PC5Unattend([string] $Kind, [string] $UserName, [string] $Locale, [string] $TimeZone, [string] $ProductKey = '') {
    $xml = Get-Content (Join-Path $script:WindowsDir 'autounattend.template.xml') -Raw -Encoding UTF8
    $key = ''
    if ($ProductKey) { $key = "<ProductKey><Key>$(ConvertTo-PC5XmlText $ProductKey)</Key><WillShowUI>OnError</WillShowUI></ProductKey>" }
    $xml = $xml.Replace('{{LOCALE}}', (ConvertTo-PC5XmlText $Locale)).Replace('{{TIMEZONE}}', (ConvertTo-PC5XmlText $TimeZone))
    $xml = $xml.Replace('{{USERNAME}}', (ConvertTo-PC5XmlText $UserName)).Replace('{{PRODUCT_KEY_BLOCK}}', $key)
    $xml = $xml.Replace('{{DISK_BLOCK}}', '').Replace('{{INSTALL_TO_BLOCK}}', '')
    $xml = [regex]::Replace($xml, '(?s)<!--.*?-->\s*', '')
    if ($Kind -eq 'applied') { $xml = [regex]::Replace($xml, '(?s)\s*<settings pass="windowsPE">.*?</settings>', '') }
    return $xml
}

# ------------------------------------------------------------------ Windows image
$script:MountedIso = $null
function Open-PC5Media([string] $Path) {
    if (Test-Path -LiteralPath $Path -PathType Container) { return (Resolve-Path -LiteralPath $Path).Path.TrimEnd('\') + '\' }
    if (-not (Test-Path -LiteralPath $Path)) { throw "Can't find $Path" }
    $full = (Resolve-Path -LiteralPath $Path).Path
    $img = Get-DiskImage -ImagePath $full
    if (-not $img.Attached) { $img = Mount-DiskImage -ImagePath $full -StorageType ISO -PassThru; $script:MountedIso = $full }
    for ($i = 0; $i -lt 20; $i++) {
        $vol = Get-DiskImage -ImagePath $full | Get-Volume -ErrorAction SilentlyContinue
        if ($vol -and $vol.DriveLetter) { return "$($vol.DriveLetter):\" }
        Start-Sleep -Milliseconds 500
    }
    throw 'The ISO opened but Windows gave it no drive letter.'
}

function Close-PC5Media {
    if ($script:MountedIso) {
        try { Dismount-DiskImage -ImagePath $script:MountedIso | Out-Null } catch { }
        $script:MountedIso = $null
    }
}

function Get-PC5InstallSource([string] $Root) {
    foreach ($n in 'install.wim', 'install.esd') {
        $p = Join-Path $Root "sources\$n"
        if (Test-Path -LiteralPath $p) { return $p }
    }
    if (Test-Path -LiteralPath (Join-Path $Root 'sources\install.swm')) { throw 'This media has a split image (install.swm). Use the original Windows ISO from microsoft.com.' }
    throw "This isn't Windows install media: there's no sources\install.wim or install.esd."
}

function Get-PC5ArchName($Value) {
    switch ([int]$Value) { 0 { 'x86' } 5 { 'arm' } 9 { 'x64' } 12 { 'arm64' } default { "$Value" } }
}

# Editions in a Windows ISO (or extracted folder).
function Get-PC5IsoInfo([string] $Path) {
    $root = Open-PC5Media $Path
    try {
        $src = Get-PC5InstallSource $root
        $images = @()
        foreach ($i in Get-WindowsImage -ImagePath $src) {
            $d = Get-WindowsImage -ImagePath $src -Index $i.ImageIndex
            $images += [ordered]@{
                index = [int]$i.ImageIndex; name = $i.ImageName; description = $i.ImageDescription; size = [int64]$i.ImageSize
                version = "$($d.Version)"; build = [int]$d.Build; arch = (Get-PC5ArchName $d.Architecture); editionId = $d.EditionId
                languages = @($d.Languages | ForEach-Object { "$_" })
            }
        }
        $label = ''
        try { $label = (Get-Volume -DriveLetter $root.Substring(0, 1) -ErrorAction Stop).FileSystemLabel } catch { }
        return [ordered]@{ path = $Path; label = $label; format = [IO.Path]::GetExtension($src).TrimStart('.'); images = $images }
    } finally { Close-PC5Media }
}

# ------------------------------------------------------------------ this PC
function Get-PC5Firmware {
    try { $sb = [bool](Confirm-SecureBootUEFI); return @{ type = 'UEFI'; secureBoot = $sb } }
    catch [System.PlatformNotSupportedException] { return @{ type = 'BIOS'; secureBoot = $false } }
    catch { return @{ type = $(if ($env:firmware_type -eq 'Legacy') { 'BIOS' } else { 'UEFI' }); secureBoot = $false } }
}

function Get-PC5BitLocker([string] $MountPoint) {
    try {
        $b = Get-BitLockerVolume -MountPoint $MountPoint -ErrorAction Stop
        return "$($b.ProtectionStatus)" -eq 'On'
    } catch { return $false }
}

function Get-PC5Targets {
    $fw = Get-PC5Firmware
    $system = $env:SystemDrive.Substring(0, 1)
    $hostDisks = @(Get-Disk | Where-Object { @('USB', 'SD', 'MMC', 'Virtual', 'File Backed Virtual') -notcontains "$($_.BusType)" -or $_.IsBoot })
    $drives = @()
    foreach ($disk in $hostDisks) {
        foreach ($p in Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue) {
            if (-not $p.DriveLetter -or $p.DriveLetter -eq [char]0) { continue }
            $v = $null
            try { $v = Get-Volume -Partition $p -ErrorAction Stop } catch { continue }
            if ("$($v.FileSystem)" -ne 'NTFS') { continue }
            $maxGB = 0; $reason = ''
            try {
                $sup = Get-PartitionSupportedSize -DiskNumber $disk.Number -PartitionNumber $p.PartitionNumber
                $shrinkable = [math]::Min($p.Size - $sup.SizeMin, $v.SizeRemaining)
                $maxGB = [math]::Floor(($shrinkable - $script:HostReserveGB * 1GB) / 1GB)
            } catch { $reason = 'Windows can''t shrink this drive right now.' }
            if ("$($disk.PartitionStyle)" -ne 'GPT') { $reason = 'This disk uses the old MBR layout. PC5 OS needs a GPT disk.' }
            elseif ($maxGB -lt $script:MinSizeGB -and -not $reason) { $reason = "Needs at least $($script:MinSizeGB + $script:HostReserveGB) GB free." }
            $drives += [ordered]@{
                letter = "$($p.DriveLetter)"; label = $v.FileSystemLabel; diskNumber = [int]$disk.Number; partitionNumber = [int]$p.PartitionNumber
                size = [int64]$p.Size; free = [int64]$v.SizeRemaining; maxSizeGB = [int][math]::Max(0, $maxGB); isSystem = ("$($p.DriveLetter)" -eq $system)
                bitlocker = (Get-PC5BitLocker "$($p.DriveLetter):"); diskName = $disk.FriendlyName; usable = (-not $reason); reason = $reason
            }
        }
    }
    $disks = @()
    foreach ($disk in $hostDisks) {
        $parts = @()
        foreach ($p in Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue) {
            $label = ''
            if ($p.DriveLetter -and $p.DriveLetter -ne [char]0) { try { $label = (Get-Volume -Partition $p -ErrorAction Stop).FileSystemLabel } catch { } }
            $parts += [ordered]@{ number = [int]$p.PartitionNumber; offset = [int64]$p.Offset; size = [int64]$p.Size; type = "$($p.Type)"; letter = $(if ($p.DriveLetter -and $p.DriveLetter -ne [char]0) { "$($p.DriveLetter)" } else { '' }); label = $label }
        }
        $freeGB = [math]::Floor([int64]$disk.LargestFreeExtent / 1GB)
        $disks += [ordered]@{
            number = [int]$disk.Number; name = $disk.FriendlyName; size = [int64]$disk.Size; style = "$($disk.PartitionStyle)"
            largestFree = [int64]$disk.LargestFreeExtent; freeUsable = ("$($disk.PartitionStyle)" -eq 'GPT' -and $freeGB -ge $script:MinSizeGB); partitions = $parts
        }
    }
    $usb = @()
    foreach ($disk in Get-Disk | Where-Object { "$($_.BusType)" -eq 'USB' -and -not $_.IsBoot -and -not $_.IsSystem }) {
        $letters = @(Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter -and $_.DriveLetter -ne [char]0 } | ForEach-Object { "$($_.DriveLetter):" })
        $usb += [ordered]@{ number = [int]$disk.Number; name = $disk.FriendlyName; size = [int64]$disk.Size; letters = $letters; usable = ($disk.Size -ge 8GB) }
    }
    $work = @(Get-Volume | Where-Object { $_.DriveType -eq 'Fixed' -and $_.DriveLetter -and "$($_.FileSystem)" -eq 'NTFS' } |
        Sort-Object SizeRemaining -Descending | ForEach-Object { [ordered]@{ letter = "$($_.DriveLetter)"; free = [int64]$_.SizeRemaining } })
    $tz = ''
    try { $tz = (Get-TimeZone).Id } catch { $tz = (& tzutil /g) }
    return [ordered]@{
        firmware = $fw.type; secureBoot = $fw.secureBoot; locale = (Get-Culture).Name; timeZone = $tz; userName = $env:USERNAME
        minSizeGB = $script:MinSizeGB; drives = $drives; disks = $disks; usb = $usb; workDrives = $work; installs = @(Get-PC5Installs)
        oscdimg = [bool](Get-PC5Oscdimg)
    }
}

# ------------------------------------------------------------------ PC5 installs on this PC
function Read-PC5State {
    if (-not (Test-Path -LiteralPath $script:StateFile)) { return @() }
    # Assigned first: in Windows PowerShell 5.1 a piped JSON array arrives as one object.
    try { $items = ConvertFrom-Json (Get-Content -LiteralPath $script:StateFile -Raw); return $items } catch { return @() }
}
function Write-PC5State([object[]] $Items) {
    New-Item -ItemType Directory -Force -Path (Split-Path $script:StateFile) | Out-Null
    ConvertTo-Json -InputObject @($Items) -Depth 5 | Set-Content -LiteralPath $script:StateFile -Encoding UTF8
}

function Get-PC5Installs {
    $out = @()
    foreach ($s in Read-PC5State) {
        $part = Get-Partition -ErrorAction SilentlyContinue | Where-Object { $_.Guid -eq $s.partitionGuid } | Select-Object -First 1
        $entry = $false
        try { Invoke-PC5Native 'bcdedit.exe' @('/enum', $s.entryId) | Out-Null; $entry = $true } catch { }
        $out += [ordered]@{ entryId = $s.entryId; partitionGuid = $s.partitionGuid; sizeGB = $s.sizeGB; created = $s.created; sourceLetter = $s.sourceLetter; letter = $(if ($part -and $part.DriveLetter -and $part.DriveLetter -ne [char]0) { "$($part.DriveLetter)" } else { '' }); healthy = ([bool]$part -and $entry) }
    }
    return $out
}

# The Windows Boot Manager's OS entries: @{ id; device } (device like "partition=C:").
function Get-PC5BootEntries {
    $text = Invoke-PC5Native 'bcdedit.exe' @('/enum', 'osloader', '/v')
    $entries = @()
    foreach ($block in ($text -split '(\r?\n){2,}')) {
        $id = [regex]::Match($block, '\{[0-9a-fA-F-]{36}\}').Value
        if (-not $id) { continue }
        $dev = [regex]::Match($block, '(?m)^\S+\s+(partition=\S+)').Groups[1].Value
        $entries += @{ id = $id.ToLowerInvariant(); device = $dev }
    }
    return $entries
}

function Add-PC5BootEntry([string] $Letter, [bool] $MakeDefault) {
    if (Get-PC5BitLocker $env:SystemDrive) {
        Write-PC5Log 'BitLocker is on: pausing it for two restarts so the boot change doesn''t ask for your recovery key.' 'warn'
        Suspend-BitLocker -MountPoint $env:SystemDrive -RebootCount 2 | Out-Null
    }
    $before = @(Get-PC5BootEntries | ForEach-Object { $_.id })
    # /d keeps the current default, so the PC still starts the usual Windows unless asked.
    Invoke-PC5Native 'bcdboot.exe' @("$($Letter):\Windows", '/d') | Out-Null
    $after = @(Get-PC5BootEntries)
    $new = $after | Where-Object { $before -notcontains $_.id } | Select-Object -First 1
    if (-not $new) { $new = $after | Where-Object { $_.device -ieq "partition=$($Letter):" } | Select-Object -First 1 }
    if (-not $new) { throw 'The boot entry for PC5 OS could not be found after bcdboot.' }
    Invoke-PC5Native 'bcdedit.exe' @('/set', $new.id, 'description', 'PC5 OS') | Out-Null
    if ($MakeDefault) { Invoke-PC5Native 'bcdedit.exe' @('/default', $new.id) | Out-Null }
    Invoke-PC5Native 'bcdedit.exe' @('/timeout', '5') | Out-Null
    return $new.id
}

# Fast Startup leaves the Windows drive half-asleep, which isn't safe to share between two Windows installs.
function Disable-PC5FastStartup {
    $key = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power'
    if ((Get-ItemProperty $key -Name HiberbootEnabled -ErrorAction SilentlyContinue).HiberbootEnabled -ne 0) {
        Set-ItemProperty $key -Name HiberbootEnabled -Value 0 -Type DWord
        Write-PC5Log 'Turned off Fast Startup on this Windows (needed to share drives safely between two Windows installs).'
    }
}

function New-PC5Partition([object] $Spec) {
    $bytes = [int64]$Spec.sizeGB * 1GB
    if ($Spec.mode -eq 'free') {
        $disk = Get-Disk -Number $Spec.diskNumber
        if ($disk.LargestFreeExtent -lt $bytes) { throw "Disk $($Spec.diskNumber) has only $([math]::Floor($disk.LargestFreeExtent / 1GB)) GB of free space in one piece." }
        $new = New-Partition -DiskNumber $Spec.diskNumber -Size $bytes -GptType $BASIC_DATA
    } else {
        $src = Get-Partition -DriveLetter $Spec.driveLetter
        $sup = Get-PartitionSupportedSize -DiskNumber $src.DiskNumber -PartitionNumber $src.PartitionNumber
        $origSize = [int64]$src.Size
        $end = [int64]$src.Offset + $origSize
        $newSize = $origSize - $bytes
        if ($newSize -lt $sup.SizeMin + $script:HostReserveGB * 1GB) { throw "Drive $($Spec.driveLetter): can't give up $($Spec.sizeGB) GB. Try a smaller size." }
        Write-PC5Log "Shrinking drive $($Spec.driveLetter): by $($Spec.sizeGB) GB"
        Resize-Partition -DiskNumber $src.DiskNumber -PartitionNumber $src.PartitionNumber -Size $newSize
        $disk = $src.DiskNumber; $num = $src.PartitionNumber
        Push-PC5Undo "give drive $($Spec.driveLetter): its space back" { Resize-Partition -DiskNumber $disk -PartitionNumber $num -Size $origSize }.GetNewClosure()
        $src = Get-Partition -DiskNumber $disk -PartitionNumber $num
        $offset = [int64]$src.Offset + [int64]$src.Size
        $offset = [int64]([math]::Ceiling($offset / 1MB) * 1MB)
        $size = [int64]([math]::Floor(($end - $offset) / 1MB) * 1MB)
        $new = New-Partition -DiskNumber $disk -Offset $offset -Size $size -GptType $BASIC_DATA
    }
    $guid = $new.Guid
    Push-PC5Undo 'remove the new partition' { Get-Partition | Where-Object { $_.Guid -eq $guid } | Remove-Partition -Confirm:$false }.GetNewClosure()
    Format-Volume -Partition $new -FileSystem NTFS -NewFileSystemLabel 'PC5 OS' -Confirm:$false | Out-Null
    $new | Add-PartitionAccessPath -AssignDriveLetter -ErrorAction SilentlyContinue
    $new = Get-Partition | Where-Object { $_.Guid -eq $guid }
    if (-not $new.DriveLetter -or $new.DriveLetter -eq [char]0) { throw 'Windows gave the new partition no drive letter.' }
    return @{ letter = "$($new.DriveLetter)"; guid = $guid; diskNumber = [int]$new.DiskNumber; partitionNumber = [int]$new.PartitionNumber }
}

function Remove-PC5Install([string] $EntryId) {
    $state = @(Read-PC5State)
    $s = $state | Where-Object { $_.entryId -eq $EntryId } | Select-Object -First 1
    if (-not $s) { throw 'That PC5 OS install is not known on this PC.' }
    $part = Get-Partition -ErrorAction SilentlyContinue | Where-Object { $_.Guid -eq $s.partitionGuid } | Select-Object -First 1
    if ($part -and ($part.IsBoot -or ($part.DriveLetter -and "$($part.DriveLetter):" -eq $env:SystemDrive))) { throw 'PC5 OS is the Windows running right now. Remove it from your other Windows.' }
    try { Invoke-PC5Native 'bcdedit.exe' @('/delete', $EntryId, '/cleanup') | Out-Null } catch { Write-PC5Log "Boot entry: $($_.Exception.Message)" 'warn' }
    if ($part) { Remove-Partition -DiskNumber $part.DiskNumber -PartitionNumber $part.PartitionNumber -Confirm:$false }
    if ($s.sourceLetter) {
        try {
            $src = Get-Partition -DriveLetter $s.sourceLetter
            $max = (Get-PartitionSupportedSize -DiskNumber $src.DiskNumber -PartitionNumber $src.PartitionNumber).SizeMax
            if ($max -gt $src.Size) { Resize-Partition -DiskNumber $src.DiskNumber -PartitionNumber $src.PartitionNumber -Size $max }
        } catch { Write-PC5Log "Couldn't give the space back to $($s.sourceLetter): ($($_.Exception.Message)). Use Disk Management > Extend Volume." 'warn' }
    }
    Write-PC5State @($state | Where-Object { $_.entryId -ne $EntryId })
    return @{ removed = $EntryId }
}

function Restart-IntoPC5([string] $EntryId) {
    Invoke-PC5Native 'bcdedit.exe' @('/bootsequence', $EntryId) | Out-Null
    Invoke-PC5Native 'shutdown.exe' @('/r', '/t', '5', '/c', 'Starting PC5 OS') | Out-Null
    return @{ restarting = $true }
}

# ------------------------------------------------------------------ stripping
function Invoke-PC5Strip([string] $Root, [object[]] $Items) {
    $appx = @($Items | ForEach-Object { if ($_.PSObject.Properties['appx']) { $_.appx } })
    $caps = @($Items | ForEach-Object { if ($_.PSObject.Properties['capabilities']) { $_.capabilities } })
    $features = @($Items | ForEach-Object { if ($_.PSObject.Properties['features']) { $_.features } })
    $work = @()
    if ($appx.Count) {
        foreach ($pkg in Get-AppxProvisionedPackage -Path $Root) {
            $n = $pkg.DisplayName
            if ($appx | Where-Object { $n -like "$_*" }) { $work += @{ kind = 'appx'; name = $n; id = $pkg.PackageName } }
        }
    }
    if ($caps.Count) {
        foreach ($c in Get-WindowsCapability -Path $Root | Where-Object { "$($_.State)" -eq 'Installed' }) {
            $cn = $c.Name
            if ($caps | Where-Object { $cn -like "$_*" }) { $work += @{ kind = 'capability'; name = $cn; id = $cn } }
        }
    }
    if ($features.Count) {
        foreach ($f in Get-WindowsOptionalFeature -Path $Root | Where-Object { $features -contains $_.FeatureName -and "$($_.State)" -eq 'Enabled' }) {
            $work += @{ kind = 'feature'; name = $f.FeatureName; id = $f.FeatureName }
        }
    }
    $done = 0; $removed = 0
    foreach ($w in $work) {
        Assert-NotCancelled
        Set-PC5StepProgress (100 * $done / [math]::Max(1, $work.Count)) $w.name
        try {
            switch ($w.kind) {
                'appx' { Remove-AppxProvisionedPackage -Path $Root -PackageName $w.id | Out-Null }
                'capability' { Remove-WindowsCapability -Path $Root -Name $w.id | Out-Null }
                'feature' { Disable-WindowsOptionalFeature -Path $Root -FeatureName $w.id | Out-Null }
            }
            $removed++
            Write-PC5Log "Removed $($w.name)"
        } catch { Write-PC5Log "Kept $($w.name): $($_.Exception.Message)" 'warn' }
        $done++
    }
    Set-PC5StepProgress 100
    return $removed
}

# ------------------------------------------------------------------ offline settings
function Mount-PC5Hives([string] $Root) {
    $map = @{ PC5_SOFT = 'Windows\System32\config\SOFTWARE'; PC5_SYS = 'Windows\System32\config\SYSTEM'; PC5_DEF = 'Users\Default\NTUSER.DAT' }
    foreach ($k in $map.Keys) { Invoke-PC5Native 'reg.exe' @('load', "HKLM\$k", (Join-Path $Root $map[$k])) | Out-Null }
}
function Dismount-PC5Hives {
    [gc]::Collect(); [gc]::WaitForPendingFinalizers()
    foreach ($k in 'PC5_SOFT', 'PC5_SYS', 'PC5_DEF') {
        for ($i = 0; $i -lt 10; $i++) {
            try { Invoke-PC5Native 'reg.exe' @('unload', "HKLM\$k") | Out-Null; break } catch { Start-Sleep -Milliseconds 700 }
        }
    }
}
function Set-PC5Reg([string] $Key, [string] $Name, $Value, [string] $Type = 'REG_DWORD') {
    Invoke-PC5Native 'reg.exe' @('add', $Key, '/v', $Name, '/t', $Type, '/d', "$Value", '/f') | Out-Null
}

$script:Tweaks = @{
    noAds = {
        Set-PC5Reg 'HKLM\PC5_SOFT\Policies\Microsoft\Windows\CloudContent' 'DisableWindowsConsumerFeatures' 1
        Set-PC5Reg 'HKLM\PC5_SOFT\Policies\Microsoft\Windows\CloudContent' 'DisableConsumerAccountStateContent' 1
        $cdm = 'HKLM\PC5_DEF\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'
        foreach ($v in 'SilentInstalledAppsEnabled', 'SystemPaneSuggestionsEnabled', 'SoftLandingEnabled', 'SubscribedContentEnabled', 'PreInstalledAppsEnabled', 'OemPreInstalledAppsEnabled', 'ContentDeliveryAllowed') { Set-PC5Reg $cdm $v 0 }
        Set-PC5Reg 'HKLM\PC5_DEF\Software\Microsoft\Windows\CurrentVersion\UserProfileEngagement' 'ScoobeSystemSettingEnabled' 0
        Set-PC5Reg 'HKLM\PC5_SOFT\Policies\Microsoft\Windows\OOBE' 'DisablePrivacyExperience' 1
    }
    telemetry = { Set-PC5Reg 'HKLM\PC5_SOFT\Policies\Microsoft\Windows\DataCollection' 'AllowTelemetry' 0 }
    noForcedReboot = { Set-PC5Reg 'HKLM\PC5_SOFT\Policies\Microsoft\Windows\WindowsUpdate\AU' 'NoAutoRebootWithLoggedOnUsers' 1 }
    noAutoBitLocker = { Set-PC5Reg 'HKLM\PC5_SYS\ControlSet001\Control\BitLocker' 'PreventDeviceEncryption' 1 }
    gameMode = {
        Set-PC5Reg 'HKLM\PC5_DEF\Software\Microsoft\GameBar' 'AutoGameModeEnabled' 1
        Set-PC5Reg 'HKLM\PC5_DEF\Software\Microsoft\GameBar' 'UseNexusForGameBarEnabled' 0
    }
    noOneDrive = {
        try { Invoke-PC5Native 'reg.exe' @('delete', 'HKLM\PC5_DEF\Software\Microsoft\Windows\CurrentVersion\Run', '/v', 'OneDriveSetup', '/f') | Out-Null } catch { }
        Set-PC5Reg 'HKLM\PC5_SOFT\Policies\Microsoft\Windows\OneDrive' 'DisableFileSyncNGSC' 1
    }
    noLockScreen = { Set-PC5Reg 'HKLM\PC5_SOFT\Policies\Microsoft\Windows\Personalization' 'NoLockScreen' 1 }
    noWebSearch = {
        Set-PC5Reg 'HKLM\PC5_SOFT\Policies\Microsoft\Windows\Windows Search' 'DisableWebSearch' 1
        Set-PC5Reg 'HKLM\PC5_SOFT\Policies\Microsoft\Windows\Windows Search' 'ConnectedSearchUseWeb' 0
        Set-PC5Reg 'HKLM\PC5_DEF\Software\Policies\Microsoft\Windows\Explorer' 'DisableSearchBoxSuggestions' 1
    }
    noUacPrompts = { Set-PC5Reg 'HKLM\PC5_SOFT\Microsoft\Windows\CurrentVersion\Policies\System' 'ConsentPromptBehaviorAdmin' 0 }
}

# PC5 itself, its first-boot script, the console settings and the account.
function Install-PC5Payload([string] $Root, [object] $Spec, [object[]] $Items, [object] $Catalog, [string] $ShellDir, [string] $Kind) {
    if (-not (Test-Path -LiteralPath (Join-Path $ShellDir 'PC5Shell.exe'))) { throw "PC5 app files not found in $ShellDir" }
    Set-PC5StepProgress 5 'Copying PC5'
    Invoke-PC5Robocopy $ShellDir (Join-Path $Root 'Program Files\PC5Shell') @('/XF', 'Uninstall PC5Shell.exe', '/XD', 'PC5Build')

    Set-PC5StepProgress 35 'Console settings'
    $version = $(if ($Spec.PSObject.Properties['version']) { $Spec.version } else { '0.0.0' })
    Mount-PC5Hives $Root
    try {
        Set-PC5Reg 'HKLM\PC5_DEF\Software\Microsoft\Windows NT\CurrentVersion\Winlogon' 'Shell' 'C:\Program Files\PC5Shell\PC5Shell.exe' 'REG_SZ'
        Set-PC5Reg 'HKLM\PC5_SOFT\Microsoft\Windows\CurrentVersion\OOBE' 'BypassNRO' 1
        Set-PC5Reg 'HKLM\PC5_SOFT\PC5OS' 'Version' $version 'REG_SZ'
        Set-PC5Reg 'HKLM\PC5_SOFT\PC5OS' 'Installed' (Get-Date -Format 's') 'REG_SZ'
        Set-PC5Reg 'HKLM\PC5_SOFT\PC5OS' 'Profile' (($Spec.items | Sort-Object) -join ',') 'REG_SZ'
        if ($Spec.bypassChecks) { Set-PC5Reg 'HKLM\PC5_SYS\Setup\MoSetup' 'AllowUpgradesWithUnsupportedTPMOrCPU' 1 }
        foreach ($i in $Items) {
            if ($i.PSObject.Properties['tweak'] -and $script:Tweaks.ContainsKey($i.tweak)) { & $script:Tweaks[$i.tweak]; Write-PC5Log "Set: $($i.title)" }
        }
    } finally { Dismount-PC5Hives }

    Set-PC5StepProgress 50 'First-start setup'
    $scripts = Join-Path $Root 'Windows\Setup\Scripts'
    New-Item -ItemType Directory -Force -Path $scripts | Out-Null
    Copy-Item (Join-Path $script:WindowsDir 'scripts\SetupComplete.cmd'), (Join-Path $script:WindowsDir 'scripts\firstboot.ps1') $scripts -Force
    Set-Content -LiteralPath (Join-Path $scripts 'pc5-user.txt') -Value $Spec.userName -Encoding ASCII

    $downloads = @($Items | Where-Object { $_.PSObject.Properties['download'] })
    $n = 0
    foreach ($d in $downloads) {
        Assert-NotCancelled
        $info = $Catalog.downloads.($d.download)
        Set-PC5StepProgress (55 + 40 * $n / [math]::Max(1, $downloads.Count)) "Downloading $($d.title)"
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $info.url -OutFile (Join-Path $scripts $info.file) -UseBasicParsing
            Write-PC5Log "Downloaded $($d.title)"
        } catch { Write-PC5Log "Couldn't download $($d.title) ($($_.Exception.Message)). You can install it later from PC5." 'warn' }
        $n++
    }

    if ($Kind -eq 'applied') {
        $panther = Join-Path $Root 'Windows\Panther'
        New-Item -ItemType Directory -Force -Path $panther | Out-Null
        $xml = New-PC5Unattend 'applied' $Spec.userName $Spec.locale $Spec.timeZone
        Set-Content -LiteralPath (Join-Path $panther 'unattend.xml') -Value $xml -Encoding UTF8
    }
    Set-PC5StepProgress 100
}

# Lets Windows Setup on the USB/ISO run on PCs without TPM 2.0, Secure Boot or 4 GB RAM.
function Set-PC5SetupBypass([string] $Media, [string] $MountDir) {
    $boot = Join-Path $Media 'sources\boot.wim'
    Invoke-PC5Dism "/Mount-Image /ImageFile:$(Format-PC5Arg $boot) /Index:2 /MountDir:$(Format-PC5Arg $MountDir)"
    try {
        Invoke-PC5Native 'reg.exe' @('load', 'HKLM\PC5_BOOT', (Join-Path $MountDir 'Windows\System32\config\SYSTEM')) | Out-Null
        try {
            foreach ($v in 'BypassTPMCheck', 'BypassSecureBootCheck', 'BypassRAMCheck', 'BypassCPUCheck') { Set-PC5Reg 'HKLM\PC5_BOOT\Setup\LabConfig' $v 1 }
        } finally {
            [gc]::Collect()
            for ($i = 0; $i -lt 10; $i++) { try { Invoke-PC5Native 'reg.exe' @('unload', 'HKLM\PC5_BOOT') | Out-Null; break } catch { Start-Sleep -Milliseconds 700 } }
        }
        Invoke-PC5Dism "/Unmount-Image /MountDir:$(Format-PC5Arg $MountDir) /Commit"
    } catch {
        try { Invoke-PC5Dism "/Unmount-Image /MountDir:$(Format-PC5Arg $MountDir) /Discard" } catch { }
        throw
    }
}

# ------------------------------------------------------------------ ISO writing
function Get-PC5Oscdimg {
    $p = "${env:ProgramFiles(x86)}\Windows Kits\10\Assessment and Deployment Kit\Deployment Tools\amd64\Oscdimg\oscdimg.exe"
    if (Test-Path -LiteralPath $p) { return $p }
    return $null
}

$script:IsoWriterLoaded = $false
function New-PC5IsoFile([string] $Media, [string] $OutFile) {
    $etfs = Join-Path $Media 'boot\etfsboot.com'
    $efi = Join-Path $Media 'efi\microsoft\boot\efisys.bin'
    $oscdimg = Get-PC5Oscdimg
    if ($oscdimg) {
        $bootData = '2#p0,e,b{0}#pEF,e,b{1}' -f $etfs, $efi
        Invoke-PC5Native $oscdimg @('-m', '-o', '-u2', '-udfver102', '-lPC5OS', "-bootdata:$bootData", $Media, $OutFile) | Out-Null
        return
    }
    # Built into Windows: the IMAPI2 file-system image writer (UDF, BIOS + UEFI boot).
    if (-not $script:IsoWriterLoaded) {
        Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class PC5IsoWriter {
    public static void Save(string path, object comStream, int blockSize, int totalBlocks) {
        IStream input = (IStream)comStream;
        byte[] buffer = new byte[blockSize * 256];
        IntPtr read = Marshal.AllocHGlobal(sizeof(int));
        try {
            using (FileStream output = File.Create(path)) {
                long remaining = (long)blockSize * totalBlocks;
                while (remaining > 0) {
                    int chunk = (int)Math.Min(buffer.Length, remaining);
                    input.Read(buffer, chunk, read);
                    int got = Marshal.ReadInt32(read);
                    if (got <= 0) break;
                    output.Write(buffer, 0, got);
                    remaining -= got;
                }
            }
        } finally { Marshal.FreeHGlobal(read); }
    }
}
'@
        $script:IsoWriterLoaded = $true
    }
    function Get-BootOption([string] $File, [int] $Platform) {
        $s = New-Object -ComObject ADODB.Stream
        $s.Open(); $s.Type = 1; $s.LoadFromFile($File)
        $o = New-Object -ComObject IMAPI2FS.BootOptions
        $o.AssignBootImage($s)
        $o.PlatformId = $Platform
        $o.Emulation = 0
        $o.Manufacturer = 'PC5OS'
        return $o
    }
    $fsi = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
    $fsi.FileSystemsToCreate = 4   # UDF: install.wim is larger than ISO 9660 allows
    $fsi.UDFRevision = 0x102
    $fsi.FreeMediaBlocks = 0       # no size limit
    $fsi.VolumeName = 'PC5OS'
    $fsi.Root.AddTree($Media.TrimEnd('\'), $false)
    $options = @()
    if (Test-Path -LiteralPath $etfs) { $options += Get-BootOption $etfs 0 }
    if (Test-Path -LiteralPath $efi) { $options += Get-BootOption $efi 0xEF }
    if ($options.Count -gt 1) {
        try { $fsi.BootImageOptionsArray = [object[]]$options }
        catch { Write-PC5Log 'This Windows can only add one boot loader: the ISO will start on UEFI PCs only.' 'warn'; $fsi.BootImageOptions = $options[-1] }
    } elseif ($options.Count -eq 1) { $fsi.BootImageOptions = $options[0] }
    $result = $fsi.CreateResultImage()
    try {
        [PC5IsoWriter]::Save($OutFile, $result.ImageStream, $result.BlockSize, $result.TotalBlocks)
    } finally {
        # IMAPI keeps every source file open until its objects are released.
        foreach ($o in @($result, $fsi) + $options) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($o) } catch { } }
        [gc]::Collect(); [gc]::WaitForPendingFinalizers()
    }
}

# Deletes a folder, retrying while Windows still holds files in it.
function Remove-PC5Folder([string] $Path) {
    for ($i = 0; $i -lt 10; $i++) {
        if (-not (Test-Path -LiteralPath $Path)) { return $true }
        try { Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop } catch { [gc]::Collect(); Start-Sleep -Seconds 2 }
    }
    if (Test-Path -LiteralPath $Path) { Write-PC5Log "Couldn't delete the temporary folder $Path. You can delete it yourself." 'warn'; return $false }
    return $true
}

# ------------------------------------------------------------------ USB
function Initialize-PC5Usb([int] $Number) {
    $disk = Get-Disk -Number $Number
    if ("$($disk.BusType)" -ne 'USB' -or $disk.IsBoot -or $disk.IsSystem) { throw 'That drive is not a removable USB drive.' }
    if ($disk.Size -lt 8GB) { throw 'The USB drive needs at least 8 GB.' }
    if ("$($disk.PartitionStyle)" -ne 'RAW') { Clear-Disk -Number $Number -RemoveData -RemoveOEM -Confirm:$false }
    Initialize-Disk -Number $Number -PartitionStyle GPT -ErrorAction SilentlyContinue
    # FAT32 so every UEFI PC can start from it; Windows formats FAT32 up to 32 GB.
    $size = [int64]([math]::Min(32GB, $disk.Size - 64MB))
    $p = New-Partition -DiskNumber $Number -Size $size -GptType $BASIC_DATA -AssignDriveLetter
    Format-Volume -Partition $p -FileSystem FAT32 -NewFileSystemLabel 'PC5OS' -Confirm:$false | Out-Null
    $p = Get-Partition -DiskNumber $Number -PartitionNumber $p.PartitionNumber
    return "$($p.DriveLetter):\"
}

# ------------------------------------------------------------------ build
function Get-PC5WorkDir([object] $Spec, [string] $Avoid) {
    if ($Spec.PSObject.Properties['workDir'] -and $Spec.workDir) { return $Spec.workDir }
    $vol = Get-Volume | Where-Object { $_.DriveType -eq 'Fixed' -and $_.DriveLetter -and "$($_.FileSystem)" -eq 'NTFS' -and "$($_.DriveLetter)" -ne $Avoid } |
        Sort-Object SizeRemaining -Descending | Select-Object -First 1
    if (-not $vol -or $vol.SizeRemaining -lt 15GB) { throw 'Making a USB or ISO needs about 15 GB of free space on a drive for temporary files.' }
    return "$($vol.DriveLetter):\PC5Build"
}

function Get-PC5ShellDir([object] $Spec) {
    if ($Spec.PSObject.Properties['shellDir'] -and $Spec.shellDir) { return $Spec.shellDir }
    return (Join-Path $env:ProgramFiles 'PC5Shell')
}

# The full build for one target. $Spec comes from the installer window as JSON.
function Invoke-PC5Build([object] $Spec) {
    $catalog = Get-PC5Catalog
    $items = Get-PC5CatalogItems $catalog @($Spec.items)
    if (-not (Test-PC5UserName $Spec.userName)) { throw "'$($Spec.userName)' can't be a Windows account name." }
    $shellDir = Get-PC5ShellDir $Spec
    $script:Undo.Clear()
    $result = @{}
    try {
        switch ($Spec.target) {
            'partition' { $result = Invoke-PC5PartitionBuild $Spec $items $catalog $shellDir }
            'usb' { $result = Invoke-PC5MediaBuild $Spec $items $catalog $shellDir }
            'iso' { $result = Invoke-PC5MediaBuild $Spec $items $catalog $shellDir }
            default { throw "Unknown target $($Spec.target)" }
        }
        $script:Undo.Clear()
        return $result
    } catch {
        $err = $_
        Write-PC5Log $err.Exception.Message 'error'
        Invoke-PC5Undo
        throw $err
    } finally { Close-PC5Media }
}

function Invoke-PC5PartitionBuild([object] $Spec, [object[]] $Items, [object] $Catalog, [string] $ShellDir) {
    $p = $Spec.partition
    Start-PC5Plan @(
        @{ id = 'check'; label = 'Checking this PC'; weight = 2 }
        @{ id = 'media'; label = 'Opening the Windows image'; weight = 2 }
        @{ id = 'partition'; label = 'Making room for PC5 OS'; weight = 6 }
        @{ id = 'apply'; label = 'Installing Windows'; weight = 55 }
        @{ id = 'strip'; label = 'Stripping it down'; weight = 18 }
        @{ id = 'pc5'; label = 'Adding PC5'; weight = 12 }
        @{ id = 'boot'; label = 'Adding PC5 OS to the boot menu'; weight = 4 }
        @{ id = 'finish'; label = 'Finishing'; weight = 1 }
    )
    Start-PC5Step 'check'
    $fw = Get-PC5Firmware
    $testRun = $Spec.PSObject.Properties['skipBoot'] -and $Spec.skipBoot
    if ($fw.type -ne 'UEFI' -and -not $testRun) { throw 'This PC starts in legacy BIOS mode. Installing next to Windows needs UEFI; make a USB instead.' }
    if ([int]$p.sizeGB -lt $script:MinSizeGB) { throw "PC5 OS needs at least $($script:MinSizeGB) GB." }
    if ($p.mode -ne 'free') {
        $src = Get-Partition -DriveLetter $p.driveLetter
        if ("$((Get-Disk -Number $src.DiskNumber).PartitionStyle)" -ne 'GPT') { throw 'That disk uses the old MBR layout. PC5 OS needs a GPT disk.' }
    }
    Disable-PC5FastStartup

    Start-PC5Step 'media'
    $media = Open-PC5Media $Spec.iso
    $source = Get-PC5InstallSource $media
    $img = Get-WindowsImage -ImagePath $source -Index ([int]$Spec.imageIndex)
    if ((Get-PC5ArchName $img.Architecture) -ne 'x64' -and -not ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -and (Get-PC5ArchName $img.Architecture) -eq 'arm64')) { throw 'That Windows edition is not for this kind of PC (needs 64-bit).' }
    Write-PC5Log "Using $($img.ImageName) $($img.Version)"

    Start-PC5Step 'partition'
    $part = New-PC5Partition $p
    $root = "$($part.letter):\"
    Write-PC5Log "PC5 OS partition is drive $($part.letter): ($($p.sizeGB) GB)"

    Start-PC5Step 'apply'
    Invoke-PC5Dism "/Apply-Image /ImageFile:$(Format-PC5Arg $source) /Index:$([int]$Spec.imageIndex) /ApplyDir:$root"

    Start-PC5Step 'strip'
    $removed = Invoke-PC5Strip $root $Items
    Write-PC5Log "Removed $removed apps and features"

    Start-PC5Step 'pc5'
    Install-PC5Payload $root $Spec $Items $Catalog $ShellDir 'applied'

    Start-PC5Step 'boot'
    $entry = $null
    if ($Spec.PSObject.Properties['skipBoot'] -and $Spec.skipBoot) { Write-PC5Log 'Skipping the boot menu (test run).' 'warn' }
    else {
        $entry = Add-PC5BootEntry $part.letter ([bool]$p.makeDefault)
        $e = $entry
        Push-PC5Undo 'remove the boot entry' { Invoke-PC5Native 'bcdedit.exe' @('/delete', $e, '/cleanup') | Out-Null }.GetNewClosure()
        $state = @(Read-PC5State) + @([ordered]@{ entryId = $entry; partitionGuid = $part.guid; sizeGB = [int]$p.sizeGB; created = (Get-Date -Format s); sourceLetter = $(if ($p.mode -eq 'free') { '' } else { $p.driveLetter }) })
        Write-PC5State $state
    }

    Start-PC5Step 'finish'
    Close-PC5Media
    Set-PC5StepProgress 100
    return @{ target = 'partition'; entryId = $entry; letter = $part.letter; sizeGB = [int]$p.sizeGB; removed = $removed }
}

function Invoke-PC5MediaBuild([object] $Spec, [object[]] $Items, [object] $Catalog, [string] $ShellDir) {
    $isUsb = $Spec.target -eq 'usb'
    $steps = @(
        @{ id = 'check'; label = 'Checking space'; weight = 1 }
        @{ id = 'copy'; label = 'Copying the Windows installer'; weight = 8 }
        @{ id = 'export'; label = 'Extracting your Windows edition'; weight = 14 }
        @{ id = 'mount'; label = 'Opening the image'; weight = 6 }
        @{ id = 'strip'; label = 'Stripping it down'; weight = 16 }
        @{ id = 'pc5'; label = 'Adding PC5'; weight = 9 }
        @{ id = 'save'; label = 'Saving the image'; weight = 14 }
    )
    if ($Spec.bypassChecks) { $steps += @{ id = 'bypass'; label = 'Allowing PCs without TPM 2.0'; weight = 6 } }
    if ($isUsb) { $steps += @{ id = 'usb'; label = 'Preparing the USB drive'; weight = 2 }, @{ id = 'write'; label = 'Writing to the USB drive'; weight = 22 } }
    else { $steps += @{ id = 'write'; label = 'Writing the ISO'; weight = 14 } }
    $steps += @{ id = 'finish'; label = 'Cleaning up'; weight = 1 }
    Start-PC5Plan $steps

    Start-PC5Step 'check'
    $avoid = ''
    if ($isUsb) {
        $usbDisk = Get-Disk -Number ([int]$Spec.usb.diskNumber)
        if ("$($usbDisk.BusType)" -ne 'USB') { throw 'That drive is not a USB drive.' }
        $usbLetters = @(Get-Partition -DiskNumber $usbDisk.Number -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter -and $_.DriveLetter -ne [char]0 } | ForEach-Object { "$($_.DriveLetter)" })
        if ($usbLetters.Count) { $avoid = $usbLetters[0] }
    } elseif (-not $Spec.isoOut) { throw 'Choose where to save the ISO.' }
    $work = Get-PC5WorkDir $Spec $avoid
    if (Test-Path -LiteralPath $work) {
        Get-WindowsImage -Mounted | Where-Object { $_.Path -like "$work*" } | ForEach-Object { Invoke-PC5Dism "/Unmount-Image /MountDir:$(Format-PC5Arg $_.Path) /Discard" }
        Remove-Item -LiteralPath $work -Recurse -Force
    }
    $mediaDir = Join-Path $work 'media'
    $mountDir = Join-Path $work 'mount'
    $wim = Join-Path $work 'install.wim'
    New-Item -ItemType Directory -Force -Path $mediaDir, $mountDir | Out-Null
    $w = $work
    Push-PC5Undo 'delete temporary files' { [void](Remove-PC5Folder $w) }.GetNewClosure()
    Write-PC5Log "Temporary files: $work"

    Start-PC5Step 'copy'
    $media = Open-PC5Media $Spec.iso
    $source = Get-PC5InstallSource $media
    Invoke-PC5Robocopy $media.TrimEnd('\') $mediaDir @('/XF', 'install.wim', 'install.esd')
    Invoke-PC5Native 'attrib.exe' @('-r', "$mediaDir\*", '/s', '/d') | Out-Null

    Start-PC5Step 'export'
    Invoke-PC5Dism "/Export-Image /SourceImageFile:$(Format-PC5Arg $source) /SourceIndex:$([int]$Spec.imageIndex) /DestinationImageFile:$(Format-PC5Arg $wim) /Compress:max /CheckIntegrity"
    Close-PC5Media

    Start-PC5Step 'mount'
    Invoke-PC5Dism "/Mount-Image /ImageFile:$(Format-PC5Arg $wim) /Index:1 /MountDir:$(Format-PC5Arg $mountDir)"
    $m = $mountDir
    Push-PC5Undo 'close the image' { Invoke-PC5Dism "/Unmount-Image /MountDir:$(Format-PC5Arg $m) /Discard" }.GetNewClosure()

    Start-PC5Step 'strip'
    $removed = Invoke-PC5Strip $mountDir $Items

    Start-PC5Step 'pc5'
    Install-PC5Payload $mountDir $Spec $Items $Catalog $ShellDir 'media'

    Start-PC5Step 'save'
    Invoke-PC5Dism "/Unmount-Image /MountDir:$(Format-PC5Arg $mountDir) /Commit"
    $script:Undo.RemoveAt(0)

    if ($Spec.bypassChecks) {
        Start-PC5Step 'bypass'
        Set-PC5SetupBypass $mediaDir $mountDir
    }

    $locale = $Spec.locale; $tz = $Spec.timeZone
    $xml = New-PC5Unattend 'media' $Spec.userName $locale $tz $(if ($Spec.PSObject.Properties['productKey']) { $Spec.productKey } else { '' })
    $out = $null
    if ($isUsb) {
        Start-PC5Step 'usb'
        $usb = Initialize-PC5Usb ([int]$Spec.usb.diskNumber)
        Start-PC5Step 'write'
        Invoke-PC5Robocopy $mediaDir.TrimEnd('\') $usb.TrimEnd('\')
        Set-PC5StepProgress 30 'Splitting the image for FAT32'
        Invoke-PC5Dism "/Split-Image /ImageFile:$(Format-PC5Arg $wim) /SWMFile:$(Format-PC5Arg (Join-Path $usb 'sources\install.swm')) /FileSize:3800"
        Set-Content -LiteralPath (Join-Path $usb 'autounattend.xml') -Value $xml -Encoding UTF8
        $out = $usb
    } else {
        Start-PC5Step 'write'
        Move-Item -LiteralPath $wim -Destination (Join-Path $mediaDir 'sources\install.wim') -Force
        Set-Content -LiteralPath (Join-Path $mediaDir 'autounattend.xml') -Value $xml -Encoding UTF8
        $dir = Split-Path -Parent $Spec.isoOut
        if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        New-PC5IsoFile $mediaDir $Spec.isoOut
        $out = $Spec.isoOut
    }

    Start-PC5Step 'finish'
    Get-WindowsImage -Mounted -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$work*" } | ForEach-Object { Invoke-PC5Dism "/Unmount-Image /MountDir:$(Format-PC5Arg $_.Path) /Discard" }
    [void](Remove-PC5Folder $work)
    Set-PC5StepProgress 100
    return @{ target = $Spec.target; output = $out; removed = $removed }
}

# ------------------------------------------------------------------ commands
function Invoke-PC5Command([string] $Name, [object] $A) {
    switch ($Name) {
        'ping' {
            $admin = $false
            try { $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch { }
            return @{ pong = $true; elevated = $admin; engine = 1 }
        }
        'catalog' { return Get-PC5Catalog }
        'targets' { return Get-PC5Targets }
        'info' { return Get-PC5IsoInfo $A.iso }
        'build' { return Invoke-PC5Build $A.spec }
        'remove' { return Remove-PC5Install $A.entryId }
        'restart' { return Restart-IntoPC5 $A.entryId }
        default { throw "Unknown command $Name" }
    }
}

# A loopback connection to the PC5 window, so one administrator prompt covers
# the whole session. The first line must be the token PC5 generated.
function Start-PC5Server([int] $Port, [string] $Token) {
    $listener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), $Port
    $listener.Start()
    $accept = $listener.AcceptTcpClientAsync()
    if (-not $accept.Wait(120000)) { $listener.Stop(); return }
    $client = $accept.Result
    $listener.Stop()
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, (New-Object System.Text.UTF8Encoding $false))
    $writer = New-Object System.IO.StreamWriter($stream, (New-Object System.Text.UTF8Encoding $false))
    $writer.AutoFlush = $true
    try {
        if ($reader.ReadLine() -ne $Token) { return }
        $writer.WriteLine('{"type":"ready"}')
        while ($null -ne ($line = $reader.ReadLine())) {
            $req = $line | ConvertFrom-Json
            $id = $req.id
            $script:Emit = { param($Event) $writer.WriteLine((@{ type = 'event'; id = $id; event = $Event } | ConvertTo-Json -Compress -Depth 10)) }.GetNewClosure()
            $script:CancelFile = $(if ($req.PSObject.Properties['cancelFile']) { $req.cancelFile } else { $null })
            try {
                $data = Invoke-PC5Command $req.cmd $req.args
                $writer.WriteLine((@{ type = 'result'; id = $id; ok = $true; data = $data } | ConvertTo-Json -Compress -Depth 12))
            } catch {
                $cancelled = $_.Exception -is [System.OperationCanceledException]
                $writer.WriteLine((@{ type = 'result'; id = $id; ok = $false; cancelled = $cancelled; error = $_.Exception.Message } | ConvertTo-Json -Compress -Depth 4))
            }
        }
    } finally {
        Close-PC5Media
        $client.Close()
    }
}

Export-ModuleMember -Function * -Variable Tweaks
