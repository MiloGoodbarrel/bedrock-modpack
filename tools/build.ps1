# Packages both packs into an .mcaddon for sharing.
#   Release build (main):        powershell -ExecutionPolicy Bypass -File tools\build.ps1
#                                -> dist\ExtremeHideAndSeek.mcaddon
#   Test build for a branch:     powershell -ExecutionPolicy Bypass -File tools\build.ps1 -Test
#                                -> dist\ExtremeHideAndSeek-test-<branch>.mcaddon
param(
    [switch]$Test
)

$repo = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $repo "dist"
$stage = Join-Path $dist "stage"
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null

Copy-Item -Recurse (Join-Path $repo "behavior_packs\modpack_bp") (Join-Path $stage "ExtremeHideAndSeek_BP")
Copy-Item -Recurse (Join-Path $repo "resource_packs\modpack_rp") (Join-Path $stage "ExtremeHideAndSeek_RP")

$name = "ExtremeHideAndSeek"
if ($Test) {
    $branch = (git -C $repo rev-parse --abbrev-ref HEAD).Trim()
    $safe = $branch -replace '[^A-Za-z0-9._-]', '-'
    $name = "ExtremeHideAndSeek-test-$safe"
}

$zip = Join-Path $dist "$name.zip"
$out = Join-Path $dist "$name.mcaddon"
Remove-Item -Force $zip, $out -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip
Move-Item $zip $out
Remove-Item -Recurse -Force $stage
Write-Host "Built $out"
