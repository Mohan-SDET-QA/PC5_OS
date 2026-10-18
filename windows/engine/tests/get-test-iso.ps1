# Downloads a Windows 11 x64 ISO for the end-to-end test: the given URL, or
# Microsoft's free Windows 11 Enterprise evaluation (found on the Evaluation Center page).
param([Parameter(Mandatory)] [string] $Out, [string] $Url = '')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
function Resolve-Final([string] $Link) { return (& curl.exe -sIL -A 'Mozilla/5.0' -o NUL -w '%{url_effective}' $Link) }
if (-not $Url) {
    $links = @()
    try {
        $page = (Invoke-WebRequest 'https://www.microsoft.com/en-us/evalcenter/download-windows-11-enterprise' -UseBasicParsing -UserAgent 'Mozilla/5.0').Content
        $links = @([regex]::Matches($page, 'https://go\.microsoft\.com/fwlink/\?[^"''<>\s]+') | ForEach-Object { $_.Value.Replace('&amp;', '&') } | Sort-Object -Unique)
    } catch { Write-Host "::warning::Evaluation Center page: $($_.Exception.Message)" }
    Write-Host "::notice::Found $($links.Count) download links on the Evaluation Center page"
    # Known official evaluation links (Windows 11 Enterprise 24H2 / 23H2, Windows 10 Enterprise 22H2), en-US x64.
    $links += 'https://go.microsoft.com/fwlink/?linkid=2289031&clcid=0x409&culture=en-us&country=us',
              'https://go.microsoft.com/fwlink/?linkid=2273046&clcid=0x409&culture=en-us&country=us',
              'https://go.microsoft.com/fwlink/?linkid=2208844&clcid=0x409&culture=en-us&country=us'
    foreach ($l in $links) {
        $final = Resolve-Final $l
        Write-Host "  $l -> $final"
        if ($final -match 'x64FRE_en-us\.iso' -and $final -notmatch 'ltsc|LTSC') { $Url = $l; Write-Host "::notice::Using $final"; break }
    }
    if (-not $Url) { Write-Host '::error::No English x64 Windows evaluation ISO link resolved. Run the workflow with an iso_url.'; exit 1 }
}
Write-Host "Downloading $Url"
& curl.exe -L --fail --retry 3 -o $Out $Url
if ($LASTEXITCODE -ne 0) { Write-Host "::error::Download failed (curl $LASTEXITCODE)"; exit 1 }
Write-Host ("Downloaded {0:N1} GB" -f ((Get-Item $Out).Length / 1GB))
