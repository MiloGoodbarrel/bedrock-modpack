# Packages both packs into dist\HideAndSeek.mcaddon for sharing.
#   powershell -ExecutionPolicy Bypass -File tools\build.ps1

$repo = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $repo "dist"
$stage = Join-Path $dist "stage"
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null

Copy-Item -Recurse (Join-Path $repo "behavior_packs\modpack_bp") (Join-Path $stage "HideAndSeek_BP")
Copy-Item -Recurse (Join-Path $repo "resource_packs\modpack_rp") (Join-Path $stage "HideAndSeek_RP")

$zip = Join-Path $dist "HideAndSeek.zip"
$out = Join-Path $dist "HideAndSeek.mcaddon"
Remove-Item -Force $zip, $out -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip
Move-Item $zip $out
Remove-Item -Recurse -Force $stage
Write-Host "Built $out"
