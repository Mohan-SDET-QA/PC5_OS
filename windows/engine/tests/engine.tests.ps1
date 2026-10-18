# Unit tests for the parts of the engine that don't need DISM or a real disk.
# Run: pwsh -File windows/engine/tests/engine.tests.ps1   (or Windows PowerShell 5.1)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\PC5Engine.psm1') -Force -DisableNameChecking
$script:failed = 0
function Check([string] $Name, [bool] $Ok) {
    if ($Ok) { Write-Host "ok   $Name" } else { Write-Host "FAIL $Name" -ForegroundColor Red; $script:failed++ }
}

# Catalog: every preset item exists, ids are unique, downloads are defined.
$cat = Get-PC5Catalog
$ids = @($cat.groups | ForEach-Object { $_.items } | ForEach-Object { $_.id })
Check 'catalog ids are unique' (($ids | Sort-Object -Unique).Count -eq $ids.Count)
foreach ($preset in $cat.presets.PSObject.Properties) {
    $missing = @($preset.Value.items | Where-Object { $ids -notcontains $_ })
    Check "preset $($preset.Name) only uses known items" ($missing.Count -eq 0)
}
$downloadItems = @($cat.groups | ForEach-Object { $_.items } | Where-Object { $_.PSObject.Properties['download'] })
Check 'every download item has a URL' (@($downloadItems | Where-Object { -not $cat.downloads.($_.download).url }).Count -eq 0)
$tweakItems = @($cat.groups | ForEach-Object { $_.items } | Where-Object { $_.PSObject.Properties['tweak'] })
$tweaks = (Get-Module PC5Engine).SessionState.PSVariable.GetValue('Tweaks')
Check 'every tweak item is implemented' (@($tweakItems | Where-Object { -not $tweaks.ContainsKey($_.tweak) }).Count -eq 0)
$items = Get-PC5CatalogItems $cat @('apps.news', 'tw.ads', 'nope')
Check 'catalog lookup returns known items only' ($items.Count -eq 2)

# Account names.
Check 'user name: normal' (Test-PC5UserName 'Player')
Check 'user name: spaces inside' (Test-PC5UserName 'Big Player')
Check 'user name: too long' (-not (Test-PC5UserName 'abcdefghijklmnopqrstu'))
Check 'user name: reserved' (-not (Test-PC5UserName 'Administrator'))
Check 'user name: bad characters' (-not (Test-PC5UserName 'a/b'))
Check 'user name: empty' (-not (Test-PC5UserName ''))

# unattend.xml for media and for an applied image.
$media = [xml](New-PC5Unattend 'media' 'Player & Co' 'en-US' 'Pacific Standard Time' 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE')
$passes = @($media.unattend.settings | ForEach-Object { $_.pass })
Check 'media unattend has windowsPE' ($passes -contains 'windowsPE')
Check 'media unattend escapes the user name' ($media.OuterXml -match 'Player &amp; Co')
Check 'media unattend has the product key' ($media.OuterXml -match 'AAAAA-BBBBB')
$applied = [xml](New-PC5Unattend 'applied' 'Player' 'de-DE' 'W. Europe Standard Time')
$passes = @($applied.unattend.settings | ForEach-Object { $_.pass })
Check 'applied unattend drops windowsPE' (($passes -notcontains 'windowsPE') -and ($passes -contains 'oobeSystem') -and ($passes -contains 'specialize'))
Check 'applied unattend keeps no placeholders' (-not ($applied.OuterXml -match '\{\{'))

# Progress maths across weighted steps.
$events = New-Object System.Collections.ArrayList
$emit = { param($e) [void]$events.Add($e) }.GetNewClosure()
(Get-Module PC5Engine).SessionState.PSVariable.Set('Emit', $emit)
Start-PC5Plan @(@{ id = 'a'; label = 'A'; weight = 1 }, @{ id = 'b'; label = 'B'; weight = 3 })
Start-PC5Step 'a'
Set-PC5StepProgress 50
Start-PC5Step 'b'
Set-PC5StepProgress 50
$p = @($events | Where-Object { $_.kind -eq 'progress' })
Check 'progress: half of step 1 of 4 units is 12.5%' ($p[0].percent -eq 12.5)
Check 'progress: half of step 2 is 62.5%' ($p[1].percent -eq 62.5)
Check 'plan event lists steps' ((@($events | Where-Object { $_.kind -eq 'plan' })[0].steps.Count) -eq 2)

# Arguments with spaces are quoted for native tools.
Check 'arg quoting' ((Format-PC5Arg 'C:\Program Files\x') -eq '"C:\Program Files\x"' -and (Format-PC5Arg '/Index:1') -eq '/Index:1')

# Cancel file.
$cf = Join-Path ([IO.Path]::GetTempPath()) "pc5-cancel-test-$PID"
Set-PC5CancelFile $cf
Check 'not cancelled without the file' (-not (Test-CancelRequested))
Set-Content $cf 'x'
$threw = $false
try { Assert-NotCancelled } catch [System.OperationCanceledException] { $threw = $true }
Check 'cancel file stops the build' $threw
Remove-Item $cf
Set-PC5CancelFile ''

# Undo runs newest first.
$order = New-Object System.Collections.ArrayList
Push-PC5Undo 'first' { [void]$order.Add(1) }.GetNewClosure()
Push-PC5Undo 'second' { [void]$order.Add(2) }.GetNewClosure()
Invoke-PC5Undo
Check 'undo runs in reverse order' (($order -join ',') -eq '2,1')

if ($script:failed) { Write-Host "$script:failed failed" -ForegroundColor Red; exit 1 }
Write-Host 'all engine tests passed' -ForegroundColor Green
