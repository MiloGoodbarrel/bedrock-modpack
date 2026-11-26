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

$out = Join-Path $dist "$name.mcaddon"
Remove-Item -Force $out -ErrorAction SilentlyContinue

# Build the zip by hand rather than with Compress-Archive: Windows PowerShell's Compress-Archive stores paths
# with backslashes, which the zip format doesn't allow and which other platforms (phones, consoles) can read
# as one long file name. Entries here always use forward slashes.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stageFull = (Resolve-Path $stage).Path.TrimEnd('\') + '\'
$archive = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem -Recurse -File $stage | ForEach-Object {
        $entry = $_.FullName.Substring($stageFull.Length) -replace '\\', '/'
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $_.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    $archive.Dispose()
}
Remove-Item -Recurse -Force $stage

# Sanity checks on the result.
$check = [System.IO.Compression.ZipFile]::OpenRead($out)
try {
    $names = $check.Entries | ForEach-Object { $_.FullName }
} finally {
    $check.Dispose()
}
$problems = @()
if ($names | Where-Object { $_ -match '\\' }) { $problems += "backslashes in entry names" }
foreach ($required in "ExtremeHideAndSeek_BP/manifest.json", "ExtremeHideAndSeek_RP/manifest.json", "ExtremeHideAndSeek_BP/scripts/main.js") {
    if ($names -notcontains $required) { $problems += "missing $required" }
}
if ($problems) { Write-Error "Build problems: $($problems -join '; ')"; exit 1 }
Write-Host "Built $out ($($names.Count) files)"
