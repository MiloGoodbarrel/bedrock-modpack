import { CONFIG } from "./config.js";
import { surfaceBlock } from "./surface.js";
import { isSeeThrough, openToOutside } from "./exposure.js";
import { neighbourTypes, roomForBlock } from "./disguise.js";

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

// Lava is never a valid spot, even when the admin allows hiding in water (no "hide in lava" cheese).
const LAVA_BLOCKS = new Set(["minecraft:lava", "minecraft:flowing_lava"]);

function isWet(block) {
  if (!block) return false;
  if (WET_BLOCKS.has(block.typeId)) return true;
  try {
    return block.isWaterlogged === true;
  } catch {
    return false;
  }
}

function isLava(block) {
  return !!block && LAVA_BLOCKS.has(block.typeId);
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
        top = surfaceBlock(dimension, { x: bx + dx, z: bz + dz });
      } catch {
        continue; // unloaded column
      }
      // Open sky if nothing in this column sits above the hider's head.
      if (!top || top.location.y < headY) return true;
    }
  }
  return false;
}

/**
 * "Open Spot": the spot must connect to the outside through see-through space within a few blocks, or be part
 * of a big enough natural open space (a cave or ravine). opts.dug = blocks the hider dug out this round ("x,y,z"),
 * which never count as natural, so a hand-dug pit, tunnel or bunker fails.
 * (exposure.js). Unloaded blocks count as closed, so an unknown spot never passes.
 */
function openToOutsideAt(player, dug) {
  const { dimension: d, location: l } = player;
  const fx = Math.floor(l.x);
  const fy = Math.floor(l.y);
  const fz = Math.floor(l.z);
  const tops = new Map();
  const topAt = (x, z) => {
    const key = `${x},${z}`;
    if (!tops.has(key)) {
      let top = null; // null = unknown (unloaded)
      try {
        const t = surfaceBlock(d, { x, z });
        top = t ? t.location.y : -Infinity;
      } catch {}
      tops.set(key, top);
    }
    return tops.get(key);
  };
  // Ground height around a column: the lowest surface 2 blocks out in each direction (so standing next to a
  // wall or a mushroom cap doesn't count as being "below ground").
  const groundAround = (x, z) => {
    const near = [topAt(x + 2, z), topAt(x - 2, z), topAt(x, z + 2), topAt(x, z - 2)].filter((t) => t !== null);
    return near.length ? Math.min(...near) : topAt(x, z);
  };
  const cell = (x, y, z) => {
    let b;
    try {
      b = d.getBlock({ x, y, z });
    } catch {
      return undefined;
    }
    if (!b) return undefined;
    let states = {};
    try {
      states = b.permutation.getAllStates();
    } catch {}
    const pass = b.isAir || isSeeThrough(b.typeId, states);
    const natural = !dug?.has(`${x},${y},${z}`); // the hider didn't dig this out
    const top = topAt(x, z);
    if (!pass || top === null || !(top < y)) return { pass, sky: false, natural };
    // Open sky above, but only "outside" if it isn't down a shaft: at most a block below the ground around it.
    const ground = groundAround(x, z);
    return { pass, sky: ground === null || y >= ground, natural };
  };
  return openToOutside(
    [
      { x: fx, y: fy, z: fz },
      { x: fx, y: fy + 1, z: fz },
    ],
    cell,
    CONFIG.openToOutsideSteps,
    CONFIG.naturalSpaceBlocks
  );
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

/** Games are Overworld-only (the Nether and End options were removed). */
export function dimensionAllowed(dimId) {
  return dimId === OVERWORLD;
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
  const lava = isLava(feet) || isLava(head);
  if (!opts.allowWater) rules.push({ label: "Dry", ok: !player.isInWater && !isWet(feet) && !isWet(head) && !lava });
  else rules.push({ label: "Not in Lava", ok: !lava });
  if (dimId === OVERWORLD) rules.push({ label: "Above Sea Level", ok: y >= CONFIG.seaLevel });
  if (dimId !== NETHER) rules.push({ label: "Near Sky Light", ok: nearSkyLight(player) }); // the Nether has no sky
  if (opts.openSpot !== false) rules.push({ label: "Open Spot", ok: openToOutsideAt(player, opts.dug) });
  if (opts.maxY) rules.push({ label: `Below Y ${opts.maxY}`, ok: y <= opts.maxY });
  if (dimId !== OVERWORLD) rules.push({ label: "In the Overworld", ok: dimensionAllowed(dimId) });
  if (dimId !== END) rules.push({ label: "Inside Play Area", ok: insidePlayArea(flatPos(player), center) });
  if (opts.morph) {
    if (!disguise) rules.push({ label: "Pick a Disguise", ok: false });
    else if (disguise.kind === "block") {
      rules.push({ label: "Unlike Neighbours", ok: !neighbourTypes(dimension, location).includes(disguise.type) });
      rules.push({ label: "Room for the Block", ok: roomForBlock(dimension, location) });
    }
  }
  return rules;
}

export function formatRules(rules, separator = "\n") {
  return rules.map((r) => (r.ok ? `§a✔ ${r.label}` : `§c✘ ${r.label}`)).join(separator) + "§r";
}
