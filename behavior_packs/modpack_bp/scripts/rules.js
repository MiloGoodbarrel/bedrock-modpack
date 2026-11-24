import { CONFIG } from "./config.js";
import { neighbourTypes } from "./disguise.js";

const OVERWORLD = "minecraft:overworld";
const NETHER = "minecraft:nether";
const END = "minecraft:the_end";

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

/** Overworld-equivalent x/z (Nether coordinates are 1:8). */
export function flatPos(entity) {
  const l = entity.location;
  if (entity.dimension?.id === NETHER) return { x: l.x * 8, y: l.y, z: l.z * 8 };
  return { x: l.x, y: l.y, z: l.z };
}

export function dimensionAllowed(dimId, opts) {
  return dimId === OVERWORLD || (dimId === NETHER && !!opts.allowNether) || (dimId === END && !!opts.allowEnd);
}

/**
 * The hider's spot rules, as shown on the hider's HUD. Returns [{ label, ok }].
 * opts = the game's settings (allowWater, allowNether, allowEnd, maxY, morph); disguise = the picked disguise.
 */
export function checkSpotRules(player, center, opts = {}, disguise = undefined) {
  const { dimension, location } = player;
  const dimId = dimension.id;
  const feet = blockAt(dimension, location);
  const head = blockAt(dimension, { x: location.x, y: location.y + 1, z: location.z });
  const y = Math.floor(location.y);

  const rules = [{ label: "On Ground", ok: player.isOnGround }];
  if (!opts.allowWater) rules.push({ label: "Dry", ok: !player.isInWater && !isWet(feet) && !isWet(head) });
  if (dimId === OVERWORLD) rules.push({ label: "Above Sea Level", ok: y >= CONFIG.seaLevel });
  if (dimId !== NETHER) rules.push({ label: "Near Sky Light", ok: nearSkyLight(player) }); // the Nether has no sky
  if (opts.maxY) rules.push({ label: `Below Y ${opts.maxY}`, ok: y <= opts.maxY });
  if (dimId !== OVERWORLD) rules.push({ label: "Allowed Dimension", ok: dimensionAllowed(dimId, opts) });
  if (dimId !== END) rules.push({ label: "Inside Play Area", ok: insidePlayArea(flatPos(player), center) });
  if (opts.morph) {
    if (!disguise) rules.push({ label: "Pick a Disguise", ok: false });
    else if (disguise.kind === "block") {
      rules.push({ label: "Unlike Neighbours", ok: !neighbourTypes(dimension, location).includes(disguise.type) });
    }
  }
  return rules;
}

export function formatRules(rules, separator = "\n") {
  return rules.map((r) => (r.ok ? `§a✔ ${r.label}` : `§c✘ ${r.label}`)).join(separator) + "§r";
}
