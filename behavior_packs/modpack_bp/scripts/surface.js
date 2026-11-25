// "Where's the ground?" lookups that ignore the add-on's own sky layer.
//
// The map outline and fill sit at build height, so the game's plain "highest block here" lookup would return
// those slabs instead of the real surface. Everything that needs the ground (teleports, the border, spot
// rules, bots, the terrain scan, the map station...) uses surfaceBlock() instead of getTopmostBlock().
import { CONFIG } from "./config.js";

// Every block type the sky layer uses (or used to), whatever the settings.
export const SKY_BLOCKS = new Set([
  "minecraft:red_wool_slab",
  "minecraft:red_wool",
  "minecraft:black_wool_slab",
  "minecraft:black_wool",
  "minecraft:black_stained_glass",
  "minecraft:blackstone_slab",
  CONFIG.skyLineBlock,
  CONFIG.skyLineFallback,
].filter(Boolean));

/** Y of the sky layer: CONFIG.skyLineY, or build height (the highest placeable block, normally 319). */
export function skyY(dim) {
  if (CONFIG.skyLineY != null) return CONFIG.skyLineY;
  try {
    return dim.heightRange.max - 1; // max is exclusive
  } catch {
    return 319;
  }
}

/**
 * The highest block at x/z that isn't part of the sky layer, like Dimension.getTopmostBlock. Throws (like
 * getTopmostBlock) if the chunk isn't loaded; undefined if the column is empty.
 */
export function surfaceBlock(dim, xz) {
  const top = dim.getTopmostBlock(xz);
  if (!top || !SKY_BLOCKS.has(top.typeId) || top.location.y !== skyY(dim)) return top;
  // Look straight down from just under the sky layer for the real surface.
  const hit = dim.getBlockFromRay(
    { x: Math.floor(xz.x) + 0.5, y: top.location.y - 0.001, z: Math.floor(xz.z) + 0.5 },
    { x: 0, y: -1, z: 0 },
    { includeLiquidBlocks: true, includePassableBlocks: true, maxDistance: 1024 }
  );
  return hit?.block;
}
