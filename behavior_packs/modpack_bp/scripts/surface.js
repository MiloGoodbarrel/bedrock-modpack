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

/** True if the surface block is something you can stand on: not water/lava and not open air. */
function isDryGround(block) {
  return !!block && !block.isAir && !block.isLiquid && !block.isWaterlogged;
}

/**
 * The nearest dry land to x/z: searches outward in rings (every `step` blocks, up to `maxRadius`) through loaded
 * chunks. Returns { x, y, z } to stand on (block centre, feet height), or undefined if there's none in reach.
 */
export function findLand(dim, x, z, maxRadius = 96, step = 4) {
  const tryAt = (px, pz) => {
    let top;
    try {
      top = surfaceBlock(dim, { x: px, z: pz });
    } catch {
      return undefined; // unloaded
    }
    if (!isDryGround(top)) return undefined;
    return { x: Math.floor(px) + 0.5, y: top.location.y + 1, z: Math.floor(pz) + 0.5 };
  };
  const here = tryAt(Math.floor(x), Math.floor(z));
  if (here) return here;
  for (let r = step; r <= maxRadius; r += step) {
    let best;
    // Walk the square ring at distance r, keeping the spot closest to the middle.
    for (let i = -r; i <= r; i += step) {
      for (const [dx, dz] of [[i, -r], [i, r], [-r, i], [r, i]]) {
        const spot = tryAt(Math.floor(x) + dx, Math.floor(z) + dz);
        if (spot && (!best || Math.hypot(dx, dz) < best.d)) best = { ...spot, d: Math.hypot(dx, dz) };
      }
    }
    if (best) return { x: best.x, y: best.y, z: best.z };
  }
  return undefined;
}

/**
 * Builds a flat platform of `block` centred on x/z at height y (the water's surface), size (2·radius+1)².
 * Only fills water and air, so nothing built or natural gets replaced. Returns the y to stand on.
 */
export function buildPlatform(dim, x, y, z, radius = 2, block = "minecraft:oak_planks") {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      try {
        const b = dim.getBlock({ x: cx + dx, y, z: cz + dz });
        if (b && (b.isAir || (b.isLiquid && !/lava/.test(b.typeId)))) b.setType(block);
      } catch {}
    }
  }
  return y + 1;
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
