// Seeker questions. "Me" always means the seeker who asked.
//
// Each question has either:
// - answer(asker, hider) -> string: computed the moment it's asked. asker/hider are anything with `location`,
//   plus `dimension` for block/biome checks (players, bot entities, or plain objects).
// - or, for Task questions, prepare(asker) -> payload at ask time and perform(hider, payload) -> string when the
//   question goes through: the game makes the hider do something that gives them away.
//
// `planar` questions depend only on x/z, so bots and the map can use them to rule out areas.
import { BlockPermutation, ItemStack, world } from "@minecraft/server";
import { surfaceBlock } from "./surface.js";
import { isUnbreakable, lightLevel } from "./blocklists.js";

// Overworld-equivalent position: Nether coordinates count 8x so north/south and distances still make sense
// when someone is in the Nether. Plain objects without a dimension are taken as-is.
function pos(e) {
  const l = e.location;
  if (e.dimension?.id === "minecraft:nether") return { x: l.x * 8, y: l.y, z: l.z * 8 };
  return l;
}

function biomeId(player) {
  try {
    if (typeof player.dimension.getBiome !== "function") return undefined;
    return player.dimension.getBiome(player.location)?.id;
  } catch {
    return undefined;
  }
}

/** Whether this game version lets scripts read biomes (Dimension.getBiome isn't in Script API 2.0.0). */
function biomeSupported() {
  try {
    return typeof world.getDimension("minecraft:overworld").getBiome === "function";
  } catch {
    return false;
  }
}

function prettyBiome(id) {
  return id ? id.replace("minecraft:", "").replace(/_/g, " ") : "unknown";
}

function prettyBlock(id) {
  return (id ?? "unknown").replace("minecraft:", "").replace(/_/g, " ");
}

function getBlock(dimension, loc) {
  try {
    return dimension.getBlock(loc);
  } catch {
    return undefined;
  }
}

/** The block someone is standing on (works on slabs too). */
function standingOn(e) {
  if (!e.dimension) return undefined;
  const l = e.location;
  return getBlock(e.dimension, { x: Math.floor(l.x), y: Math.floor(l.y - 0.01), z: Math.floor(l.z) });
}

/**
 * True if any block within r (a cube around the feet) matches test(typeId); false if none does; undefined if
 * nothing matched but part of the area couldn't be read (unloaded), so "No" can't be claimed for sure.
 */
function anyNear(e, r, test) {
  if (!e.dimension) return undefined;
  const l = e.location;
  const bx = Math.floor(l.x);
  const by = Math.floor(l.y);
  const bz = Math.floor(l.z);
  let missing = false;
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const b = getBlock(e.dimension, { x: bx + dx, y: by + dy, z: bz + dz });
        if (!b) missing = true;
        else if (test(b.typeId)) return true;
      }
    }
  }
  return missing ? undefined : false;
}

const yesNo = (v) => (v === undefined ? "Unknown (part of that area isn't loaded)" : v ? "Yes" : "No");
const FLOWERS = /(flower|tulip|dandelion|poppy|orchid|allium|bluet|daisy|lilac|rose_bush|peony|lily_of_the_valley|pitcher_plant|wildflowers|petals)/;

// --- Task helpers ------------------------------------------------------------

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** An open spot with solid ground next to the hider (1-2 blocks away), or the top of their column. */
function spotNear(hider) {
  const d = hider.dimension;
  const l = hider.location;
  const fx = Math.floor(l.x);
  const fy = Math.floor(l.y - 0.01) + 1;
  const fz = Math.floor(l.z);
  const offsets = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx || dz) for (const dy of [0, 1, -1]) offsets.push([dx, dy, dz]);
    }
  }
  for (const [dx, dy, dz] of shuffle(offsets)) {
    const at = { x: fx + dx, y: fy + dy, z: fz + dz };
    const here = getBlock(d, at);
    const below = getBlock(d, { x: at.x, y: at.y - 1, z: at.z });
    if (here?.isAir && below && !below.isAir && !below.isLiquid) return at;
  }
  try {
    const top = surfaceBlock(d, { x: fx, z: fz });
    if (top) return { x: fx, y: top.location.y + 1, z: fz };
  } catch {}
  return { x: fx, y: fy + 2, z: fz };
}

/**
 * Places a block next to the hider. Only ever fills empty air (never replaces a block anyone built or the
 * terrain), and only reports success if the block is really there afterwards.
 */
function place(hider, typeId) {
  const at = spotNear(hider);
  try {
    const block = hider.dimension.getBlock(at);
    if (!block?.isAir) return false;
    block.setPermutation(BlockPermutation.resolve(typeId));
    return hider.dimension.getBlock(at)?.typeId === typeId;
  } catch {
    return false;
  }
}

/** Spawns an entity next to the hider; true only if it really appeared. */
function spawnNear(hider, typeId) {
  try {
    return !!hider.dimension.spawnEntity(typeId, spotNear(hider))?.isValid;
  } catch {
    return false;
  }
}

const ANIMALS = [
  ["minecraft:bee", "bee"],
  ["minecraft:chicken", "chicken"],
  ["minecraft:cow", "cow"],
  ["minecraft:pig", "pig"],
  ["minecraft:rabbit", "rabbit"],
];

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

/** Type of the mob closest to someone (within 32 blocks), or null if there's none. Players, bots and disguises don't count. */
function nearestMob(e) {
  try {
    const mobs = e.dimension
      .getEntities({
        location: e.location,
        maxDistance: 32,
        excludeTypes: ["minecraft:player", "hs:bot", "minecraft:item", "minecraft:xp_orb", "minecraft:arrow"],
        excludeTags: ["hs_decoy"],
      })
      .filter((m) => m.id !== e.id && m.getComponent("minecraft:health"));
    if (!mobs.length) return null;
    const l = e.location;
    const d = (m) => Math.hypot(m.location.x - l.x, m.location.y - l.y, m.location.z - l.z);
    return mobs.sort((a, b) => d(a) - d(b))[0].typeId;
  } catch {
    return null;
  }
}

/** A task question the hider performs: `spec` says what counts as done, `perform` is the automatic fallback. */
function task(id, text, spec, done, perform) {
  return { id, text, hiderTask: spec, doneText: () => done, perform };
}

/** Breaks one breakable block next to the hider (with the usual particles and drop), for the automatic task. */
function breakNear(hider) {
  const d = hider.dimension;
  const l = hider.location;
  const fx = Math.floor(l.x);
  const fy = Math.floor(l.y);
  const fz = Math.floor(l.z);
  const sides = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1]];
  for (const [dx, dy, dz] of shuffle(sides)) {
    const b = getBlock(d, { x: fx + dx, y: fy + dy, z: fz + dz });
    if (!b || b.isAir || b.isLiquid || isUnbreakable(b.typeId)) continue;
    try {
      d.runCommand(`setblock ${fx + dx} ${fy + dy} ${fz + dz} air destroy`);
      return true;
    } catch {}
  }
  return false;
}

/** Roughly: does light from a light-emitting block reach the hider? (brightness minus distance, no walls) */
function inBlockLight(hider) {
  const d = hider.dimension;
  if (!d) return undefined;
  const l = hider.location;
  const fx = Math.floor(l.x);
  const fy = Math.floor(l.y);
  const fz = Math.floor(l.z);
  const r = 14;
  let missing = false;
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const dist = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        if (dist > r) continue;
        const b = getBlock(d, { x: fx + dx, y: fy + dy, z: fz + dz });
        if (!b) {
          missing = true;
          continue;
        }
        if (lightLevel(b.typeId) - dist > 0) return true;
      }
    }
  }
  return missing ? undefined : false;
}

// --- Categories --------------------------------------------------------------

const DISTANCES = [500, 250, 100, 50, 25];

export const CATEGORIES = [
  {
    id: "comparing",
    name: "Comparing",
    color: "§9",
    icon: "textures/items/compass_item",
    draw: 3,
    pick: 2,
    reward: "Draw 3, pick 2",
    questions: [
      {
        id: "north_south",
        text: "Are you north or south of me?",
        planar: true,
        answer: (asker, hider) => (pos(hider).z < pos(asker).z ? "North" : "South"),
      },
      {
        id: "east_west",
        text: "Are you east or west of me?",
        planar: true,
        answer: (asker, hider) => (pos(hider).x > pos(asker).x ? "East" : "West"),
      },
      {
        id: "above_below",
        text: "Are you above or below me?",
        answer: (asker, hider) => (hider.location.y > asker.location.y ? "Above" : "Below"),
      },
      {
        id: "same_biome",
        // Script API 2.0.0 has no biome lookup, so this only shows up on game versions where it works.
        available: biomeSupported,
        text: "Is your biome the same as mine?",
        answer: (asker, hider) => {
          const a = biomeId(asker);
          const h = biomeId(hider);
          if (!a || !h) return "Unknown (biome check not supported on this game version)";
          return a === h ? `Yes (${prettyBiome(a)})` : `No (not ${prettyBiome(a)})`;
        },
      },
      {
        id: "same_block",
        text: "Are you standing on the same type of block as me?",
        answer: (asker, hider) => {
          const mine = standingOn(asker)?.typeId;
          return mine && standingOn(hider)?.typeId === mine ? `Yes (${prettyBlock(mine)})` : `No (not ${prettyBlock(mine)})`;
        },
      },
      {
        id: "same_nearest_mob",
        text: "Are the mobs nearest to you and me the same type?",
        answer: (asker, hider) => {
          const mine = nearestMob(asker);
          if (mine === null) return "Unknown (no mob near the asker to compare with)";
          const theirs = nearestMob(hider);
          return theirs === mine ? `Yes (${prettyBlock(mine)})` : `No (not ${prettyBlock(mine)})`;
        },
      },
    ],
  },
  {
    id: "distance",
    name: "Distance",
    color: "§a",
    icon: "textures/items/lead",
    draw: 2,
    pick: 2,
    reward: "Draw 2, pick 2",
    questions: DISTANCES.map((r) => ({
      id: `within_${r}`,
      text: `Are you within ${r} blocks of me?`,
      planar: true,
      radius: r,
      answer: (asker, hider) => {
        const dx = pos(hider).x - pos(asker).x;
        const dz = pos(hider).z - pos(asker).z;
        return Math.hypot(dx, dz) <= r ? "Yes" : "No";
      },
    })),
  },
  {
    id: "observation",
    name: "Observation",
    color: "§e",
    icon: "textures/items/spyglass",
    draw: 2,
    pick: 1,
    reward: "Draw 2, pick 1",
    questions: [
      {
        id: "block_light",
        text: "Are you in light from a block (torch, lantern, lava...)?",
        // No light API in Script API 2.0.0: estimated from light-emitting blocks nearby (their brightness minus
        // the distance to the hider), without walls blocking it.
        answer: (asker, hider) => yesNo(inBlockLight(hider)),
      },
      {
        id: "on_leaves",
        text: "Are you standing on leaves?",
        answer: (asker, hider) => yesNo(/leaves/.test(standingOn(hider)?.typeId ?? "")),
      },
      {
        id: "water_near",
        text: "Is there water nearby? (within 4 blocks)",
        answer: (asker, hider) => yesNo(anyNear(hider, 4, (t) => t === "minecraft:water" || t === "minecraft:flowing_water")),
      },
      {
        id: "lava_near",
        text: "Is there lava nearby? (within 4 blocks)",
        answer: (asker, hider) => yesNo(anyNear(hider, 4, (t) => t === "minecraft:lava" || t === "minecraft:flowing_lava")),
      },
      {
        id: "snow_near",
        text: "Is there snow nearby? (within 4 blocks)",
        answer: (asker, hider) => yesNo(anyNear(hider, 4, (t) => /snow/.test(t))),
      },
      {
        id: "flowers_near",
        text: "Are there flowers nearby? (within 4 blocks)",
        answer: (asker, hider) => yesNo(anyNear(hider, 4, (t) => FLOWERS.test(t))),
      },
      {
        id: "sky_visible",
        text: "Is the sky visible above you?",
        answer: (asker, hider) => {
          try {
            const l = hider.location;
            const top = surfaceBlock(hider.dimension, { x: Math.floor(l.x), z: Math.floor(l.z) });
            return yesNo(!top || top.location.y < Math.floor(l.y) + 1);
          } catch {
            return "Unknown";
          }
        },
      },
    ],
  },
  {
    id: "task",
    name: "Task",
    color: "§c",
    icon: "textures/items/fireworks",
    draw: 1,
    pick: 1,
    reward: "Draw 1, pick 1",
    // The hider does each task themselves (powerups.js gives them the item and waits; their hide timer is paused
    // meanwhile). `perform` is the automatic version, used if they run out of time, are a block disguise, or
    // are a bot.
    questions: [
      task("task_break", "Break a Block", { kind: "break" }, "broke a block", (hider) =>
        breakNear(hider) ? "A block next to the hider broke!" : "No block could be broken."),
      task("task_grass", "Place a Grass Block", { kind: "place", block: "minecraft:grass_block" }, "placed a Grass Block", (hider) =>
        place(hider, "minecraft:grass_block") ? "A grass block appeared next to the hider." : "The grass block couldn't be placed."),
      task("task_gravel", "Place Gravel", { kind: "place", block: "minecraft:gravel" }, "placed Gravel", (hider) =>
        place(hider, "minecraft:gravel") ? "A gravel block appeared next to the hider." : "The gravel couldn't be placed."),
      task("task_sand", "Place Sand", { kind: "place", block: "minecraft:sand" }, "placed Sand", (hider) =>
        place(hider, "minecraft:sand") ? "A sand block appeared next to the hider." : "The sand couldn't be placed."),
      task("task_stone", "Place Stone", { kind: "place", block: "minecraft:stone" }, "placed Stone", (hider) =>
        place(hider, "minecraft:stone") ? "A stone block appeared next to the hider." : "The stone couldn't be placed."),
      ...ANIMALS.map(([mob, name]) =>
        task(`task_${name}`, `Spawn a ${cap(name)}`, { kind: "spawn", mob, give: `${mob}_spawn_egg` }, `spawned a ${cap(name)}`, (hider) =>
          spawnNear(hider, mob) ? `A ${name} appeared next to the hider.` : `No ${name} showed up.`)
      ),
      task("task_fire", "Use a Fire Charge", { kind: "use", item: "minecraft:fire_charge" }, "used a Fire Charge", (hider) =>
        place(hider, "minecraft:fire") ? "A fire is burning next to the hider!" : "The fire didn't catch."),
      task(
        "task_firework",
        "Use a Firework Rocket",
        { kind: "spawn", mob: "minecraft:fireworks_rocket", give: "minecraft:firework_rocket" },
        "used a Firework Rocket",
        (hider) => (spawnNear(hider, "minecraft:fireworks_rocket") ? "A firework shot up from the hider's spot!" : "The firework fizzled.")
      ),
      {
        id: "task_drop_floor",
        text: "Drop the block you're standing on!",
        // Extension (not in the original); always done automatically.
        perform: (hider) => {
          let type = standingOn(hider)?.typeId;
          if (!type || type === "minecraft:air" || /water|lava/.test(type) || isUnbreakable(type)) type = "minecraft:dirt";
          const at = spotNear(hider);
          const drop = { x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 };
          for (const t of [type, "minecraft:dirt"]) {
            try {
              hider.dimension.spawnItem(new ItemStack(t, 1), drop);
              return `The hider dropped a ${prettyBlock(t)} block next to their spot.`;
            } catch {}
          }
          return "The hider had nothing to drop.";
        },
      },
      {
        id: "task_my_block",
        text: "Place the block I'm standing on!",
        // Extension (not in the original).
        prepare: (asker) => {
          const t = standingOn(asker)?.typeId;
          return t && t !== "minecraft:air" && !/water|lava/.test(t) && !isUnbreakable(t) ? t : "minecraft:dirt";
        },
        hiderTask: { kind: "place", fromPayload: true },
        doneText: (type) => `placed ${prettyBlock(type)}`,
        perform: (hider, type) =>
          place(hider, type) ? `A ${prettyBlock(type)} block was placed next to the hider.` : `The ${prettyBlock(type)} couldn't be placed.`,
      },
    ],
  },
];

export function findQuestion(id) {
  for (const cat of CATEGORIES) {
    const q = cat.questions.find((x) => x.id === id);
    if (q) return { category: cat, question: q };
  }
  return undefined;
}

/** Questions that can actually be asked on this game version (hides ones the API can't answer). */
export function availableQuestions(category) {
  return category.questions.filter((q) => q.available?.() !== false);
}
