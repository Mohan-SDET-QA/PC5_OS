#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Install or remove PC5Shell as the console shell on an EXISTING Windows PC,
  without rebuilding an ISO. Good for testing on your current machine.

.EXAMPLE
  .\install-shell.ps1 -Install            # current user boots into PC5Shell
  .\install-shell.ps1 -Install -AutoLogin # ...and logs in automatically (account must have no password)
  .\install-shell.ps1 -Uninstall          # back to the normal Windows desktop

  Getting to Windows from PC5: Settings > System > Desktop Mode (desktop now,
  PS button returns) or Switch to Windows (sign out to normal Windows, with a
  "Return to PC5" icon on the desktop). Emergency: Ctrl+Alt+Del > Task Manager >
  Run new task > explorer.exe.
#>
param(
    [switch] $Install,
    [switch] $Uninstall,
    [switch] $AutoLogin,
    [string] $ShellDir = (Join-Path $PSScriptRoot '..\..\shell\dist\win-unpacked')
)
$ErrorActionPreference = 'Stop'
$target = 'C:\Program Files\PC5Shell'
$exe = Join-Path $target 'PC5Shell.exe'
$userWinlogon = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon'

if ($Install) {
    if (-not (Test-Path (Join-Path $ShellDir 'PC5Shell.exe'))) { throw "Build the shell first (npm run dist). Not found: $ShellDir" }
    robocopy (Resolve-Path $ShellDir).Path $target /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
    New-Item -Path $userWinlogon -Force | Out-Null
    Set-ItemProperty $userWinlogon -Name Shell -Value $exe
    if ($AutoLogin) {
        $hk = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
        Set-ItemProperty $hk -Name AutoAdminLogon -Value '1'
        Set-ItemProperty $hk -Name DefaultUserName -Value $env:USERNAME
        Set-ItemProperty $hk -Name DefaultPassword -Value ''
    }
    # Start menu shortcut: from the Windows desktop, opening PC5 brings it back to the front.
    $startMenu = [Environment]::GetFolderPath('Programs')
    $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $startMenu 'PC5.lnk'))
    $s.TargetPath = $exe
    $s.Save()
    Write-Host "PC5Shell is now the shell for $env:USERNAME. Sign out to try it." -ForegroundColor Green
} elseif ($Uninstall) {
    Remove-ItemProperty $userWinlogon -Name Shell -ErrorAction SilentlyContinue
    Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'PC5.lnk') -ErrorAction SilentlyContinue
    Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Return to PC5.lnk') -ErrorAction SilentlyContinue
    Write-Host 'Restored the Windows desktop shell. Sign out to apply.' -ForegroundColor Green
} else {
    Get-Help $MyInvocation.MyCommand.Path -Detailed
}
