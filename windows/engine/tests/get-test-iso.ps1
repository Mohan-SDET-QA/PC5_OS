# Downloads a Windows 11 x64 ISO for the end-to-end test: the given URL, or
# Microsoft's free Windows 11 Enterprise evaluation (found on the Evaluation Center page).
param([Parameter(Mandatory)] [string] $Out, [string] $Url = '')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
if (-not $Url) {
    $page = (Invoke-WebRequest 'https://www.microsoft.com/en-us/evalcenter/download-windows-11-enterprise' -UseBasicParsing -UserAgent 'Mozilla/5.0').Content
    $links = [regex]::Matches($page, 'https://go\.microsoft\.com/fwlink/\?[^"''<>\s]+') | ForEach-Object { $_.Value.Replace('&amp;', '&') } | Sort-Object -Unique
    Write-Host "Found $($links.Count) download links on the Evaluation Center page"
    foreach ($l in $links) {
        $final = & curl.exe -sIL -o NUL -w '%{url_effective}' $l
        Write-Host "  $l -> $final"
        if ($final -match 'x64FRE_en-us\.iso' -and $final -notmatch 'LTSC|ltsc') { $Url = $l; break }
    }
    if (-not $Url) { throw 'No English x64 Windows 11 evaluation ISO link found. Run the workflow with an iso_url.' }
}
Write-Host "Downloading $Url"
& curl.exe -L --fail --retry 3 -o $Out $Url
if ($LASTEXITCODE -ne 0) { throw "Download failed ($LASTEXITCODE)" }
Write-Host ("Downloaded {0:N1} GB" -f ((Get-Item $Out).Length / 1GB))
