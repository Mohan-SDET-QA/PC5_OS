# PC5 OS first-boot configuration. Runs once as SYSTEM via SetupComplete.cmd.
# Output is logged to C:\Windows\Setup\Scripts\firstboot.log.
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$user = (Get-Content "$here\pc5-user.txt" -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $user) { $user = 'Player' }
function Log($m) { Write-Output "[$(Get-Date -Format s)] $m" }

Log 'Power: High performance, no hibernation, never auto-sleep'
powercfg /setactive SCHEME_MIN
powercfg /hibernate off
powercfg /change monitor-timeout-ac 30
powercfg /change standby-timeout-ac 0

Log "Auto-login as $user"
$winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
Set-ItemProperty $winlogon -Name AutoAdminLogon -Value '1'
Set-ItemProperty $winlogon -Name DefaultUserName -Value $user
Set-ItemProperty $winlogon -Name DefaultPassword -Value ''
Remove-ItemProperty $winlogon -Name AutoLogonCount -ErrorAction SilentlyContinue

Log 'Installing Steam'
if (Test-Path "$here\SteamSetup.exe") {
    Start-Process "$here\SteamSetup.exe" -ArgumentList '/S' -Wait
    Log 'Steam installed'
}

if (Test-Path "$here\7zip-setup.exe") {
    Log 'Installing 7-Zip'
    Start-Process "$here\7zip-setup.exe" -ArgumentList '/S' -Wait
}

Log 'Boot menu: 3 second timeout (it needs a keyboard; PC5 can restart into other OSes itself)'
bcdedit /timeout 3

if (Test-Path "$here\EpicInstaller.msi") {
    Log 'Installing Epic Games Launcher'
    Start-Process msiexec.exe -ArgumentList "/i `"$here\EpicInstaller.msi`" /qn /norestart" -Wait
}

Log 'Disabling Explorer-only startup nags'
# These run from the Explorer shell, which isn't used; keep them from popping up if Desktop mode is opened.
reg add 'HKLM\SOFTWARE\Policies\Microsoft\Windows\OOBE' /v DisablePrivacyExperience /t REG_DWORD /d 1 /f | Out-Null

Log 'Cleaning up installers'
Remove-Item "$here\SteamSetup.exe", "$here\EpicInstaller.msi", "$here\7zip-setup.exe" -Force -ErrorAction SilentlyContinue

Log 'First boot done'
