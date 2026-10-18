<#
.SYNOPSIS
  PC5 OS install engine (runs as administrator).

.DESCRIPTION
  The PC5 OS Installer window starts this with -Serve: it then talks to the
  window over a private loopback connection. It can also be run by hand:

    .\pc5-engine.ps1 -Command targets
    .\pc5-engine.ps1 -Command info -ArgsJson '{"iso":"D:\\Win11.iso"}'
    .\pc5-engine.ps1 -Command build -ArgsJson (Get-Content spec.json -Raw)

  Each line of output is a JSON event; the last line is the result.
#>
param(
    [switch] $Serve,
    [int] $Port = 0,
    [string] $Token = '',
    [string] $Command = '',
    [string] $ArgsJson = '{}',
    [string] $CancelFile = ''
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'PC5Engine.psm1') -Force -DisableNameChecking

if ($Serve) {
    Start-PC5Server -Port $Port -Token $Token
    exit 0
}
if (-not $Command) { Get-Help $MyInvocation.MyCommand.Path -Detailed; exit 1 }
if ($CancelFile) { Set-PC5CancelFile $CancelFile }
try {
    $data = Invoke-PC5Command $Command (ConvertFrom-Json $ArgsJson)
    [Console]::Out.WriteLine((@{ type = 'result'; ok = $true; data = $data } | ConvertTo-Json -Compress -Depth 12))
    exit 0
} catch {
    [Console]::Out.WriteLine((@{ type = 'result'; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress -Depth 4))
    exit 1
}
