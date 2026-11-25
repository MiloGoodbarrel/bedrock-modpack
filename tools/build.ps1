# Packages both packs into dist\ExtremeHideAndSeek.mcaddon for sharing.
#   powershell -ExecutionPolicy Bypass -File tools\build.ps1

$repo = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $repo "dist"
$stage = Join-Path $dist "stage"
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null

Copy-Item -Recurse (Join-Path $repo "behavior_packs\modpack_bp") (Join-Path $stage "ExtremeHideAndSeek_BP")
Copy-Item -Recurse (Join-Path $repo "resource_packs\modpack_rp") (Join-Path $stage "ExtremeHideAndSeek_RP")

$zip = Join-Path $dist "ExtremeHideAndSeek.zip"
$out = Join-Path $dist "ExtremeHideAndSeek.mcaddon"
Remove-Item -Force $zip, $out -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip
Move-Item $zip $out
Remove-Item -Recurse -Force $stage
Write-Host "Built $out"
