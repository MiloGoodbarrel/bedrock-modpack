import { CONFIG } from "./config.js";

const WET_BLOCKS = new Set([
  "minecraft:water",
  "minecraft:flowing_water",
  "minecraft:bubble_column",
  "minecraft:powder_snow",
]);

function blockAt(dimension, location) {
  try {
    return dimension.getBlock(location);
  } catch {
    return undefined;
  }
}

function isWet(block) {
  if (!block) return false;
  if (WET_BLOCKS.has(block.typeId)) return true;
  try {
    return block.isWaterlogged === true;
  } catch {
    return false;
  }
}

function nearSkyLight(player) {
  const { dimension, location } = player;
  const bx = Math.floor(location.x);
  const bz = Math.floor(location.z);
  const headY = Math.floor(location.y) + 1;
  const r = CONFIG.skyLightRadius;
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      let top;
      try {
        top = dimension.getTopmostBlock({ x: bx + dx, z: bz + dz });
      } catch {
        continue; // unloaded column
      }
      // Open sky if nothing in this column sits above the hider's head.
      if (!top || top.location.y < headY) return true;
    }
  }
  return false;
}

/** True if x/z is inside the square play area around center (always true without a center). */
export function insidePlayArea(location, center) {
  if (!center) return true;
  const r = CONFIG.playAreaRadius;
  return Math.abs(location.x - center.x) <= r && Math.abs(location.z - center.z) <= r;
}

/** The hider's spot rules, as shown on the hider's HUD. Returns [{ label, ok }]. */
export function checkSpotRules(player, center) {
  const { dimension, location } = player;
  const feet = blockAt(dimension, location);
  const head = blockAt(dimension, { x: location.x, y: location.y + 1, z: location.z });
  return [
    { label: "On Ground", ok: player.isOnGround },
    { label: "Dry", ok: !player.isInWater && !isWet(feet) && !isWet(head) },
    { label: "Above Sea Level", ok: Math.floor(location.y) >= CONFIG.seaLevel },
    { label: "Near Sky Light", ok: nearSkyLight(player) },
    { label: "Inside Play Area", ok: insidePlayArea(location, center) },
  ];
}

export function formatRules(rules, separator = "\n") {
  return rules.map((r) => (r.ok ? `§a✔ ${r.label}` : `§c✘ ${r.label}`)).join(separator) + "§r";
}
