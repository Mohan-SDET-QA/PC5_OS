# Compiles PC5Input.cs with the .NET Framework C# compiler included in Windows.
$ErrorActionPreference = 'Stop'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "C# compiler not found at $csc" }
$out = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Force -Path $out | Out-Null
& $csc /nologo /optimize+ /target:winexe /platform:x64 "/out:$out\PC5Input.exe" (Join-Path $PSScriptRoot 'PC5Input.cs')
if ($LASTEXITCODE -ne 0) { throw 'PC5Input build failed' }
& $csc /nologo /optimize+ /target:exe /platform:x64 "/out:$out\PC5System.exe" (Join-Path $PSScriptRoot 'PC5System.cs')
if ($LASTEXITCODE -ne 0) { throw 'PC5System build failed' }
Copy-Item (Join-Path $PSScriptRoot 'bluetooth.ps1') $out
Write-Host "Built $out\PC5Input.exe and PC5System.exe"
