# Links the packs into Minecraft Bedrock's development pack folders so edits show up
# after reloading the world (or running /reload for scripts). Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File tools\dev-install.ps1
# Uses directory junctions, which don't need admin rights.

$repo = Split-Path -Parent $PSScriptRoot
$packs = @{
    "development_behavior_packs\hide_and_seek_bp" = Join-Path $repo "behavior_packs\modpack_bp"
    "development_resource_packs\hide_and_seek_rp" = Join-Path $repo "resource_packs\modpack_rp"
}

# Newer (GDK) installs use the first path; older (UWP) installs use the second.
$roots = @(
    "$env:APPDATA\Minecraft Bedrock\Users\Shared\games\com.mojang",
    "$env:LOCALAPPDATA\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang"
) | Where-Object { Test-Path $_ }

if (-not $roots) { Write-Error "Couldn't find a Minecraft Bedrock data folder."; exit 1 }

foreach ($root in $roots) {
    foreach ($rel in $packs.Keys) {
        $link = Join-Path $root $rel
        New-Item -ItemType Directory -Force (Split-Path $link) | Out-Null
        if (Test-Path $link) {
            $item = Get-Item $link -Force
            if ($item.LinkType -eq "Junction") { continue }
            Write-Warning "$link exists and isn't a link; leaving it alone."
            continue
        }
        New-Item -ItemType Junction -Path $link -Target $packs[$rel] | Out-Null
        Write-Host "Linked $link"
    }
}
Write-Host "Done. Enable 'Extreme Hide & Seek BP' and 'Extreme Hide & Seek RP' on a world."
