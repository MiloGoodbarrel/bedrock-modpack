// Seeker questions. "Me" always means the seeker who asked.
//
// Each question has either:
// - answer(asker, hider) -> string: computed the moment it's asked. asker/hider are anything with `location`,
//   plus `dimension` for block/biome checks (players, bot entities, or plain objects).
// - or, for Task questions, prepare(asker) -> payload at ask time and perform(hider, payload) -> string when the
//   question goes through: the game makes the hider do something that gives them away.
//
// `planar` questions depend only on x/z, so bots and the map can use them to rule out areas.
import { BlockPermutation } from "@minecraft/server";

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

/** True if any block within r (a cube around the feet) matches test(typeId). */
function anyNear(e, r, test) {
  if (!e.dimension) return false;
  const l = e.location;
  const bx = Math.floor(l.x);
  const by = Math.floor(l.y);
  const bz = Math.floor(l.z);
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const b = getBlock(e.dimension, { x: bx + dx, y: by + dy, z: bz + dz });
        if (b && test(b.typeId)) return true;
      }
    }
  }
  return false;
}

const yesNo = (v) => (v ? "Yes" : "No");
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
    const top = d.getTopmostBlock({ x: fx, z: fz });
    if (top) return { x: fx, y: top.location.y + 1, z: fz };
  } catch {}
  return { x: fx, y: fy + 2, z: fz };
}

function place(hider, typeId) {
  const at = spotNear(hider);
  try {
    hider.dimension.getBlock(at)?.setPermutation(BlockPermutation.resolve(typeId));
    return true;
  } catch {
    return false;
  }
}

function spawnNear(hider, typeId) {
  try {
    hider.dimension.spawnEntity(typeId, spotNear(hider));
    return true;
  } catch {
    return false;
  }
}

const ANIMALS = [
  ["minecraft:pig", "pig"],
  ["minecraft:cow", "cow"],
  ["minecraft:sheep", "sheep"],
  ["minecraft:rabbit", "rabbit"],
];

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
        text: "Is your biome the same as mine?",
        answer: (asker, hider) => {
          const a = biomeId(asker);
          const h = biomeId(hider);
          if (!a || !h) return "Unknown (biome check not supported on this game version)";
          return a === h ? `Yes (${prettyBiome(a)})` : `No (not ${prettyBiome(a)})`;
        },
      },
      {
        id: "same_dimension",
        text: "Are you in the same dimension as me?",
        answer: (asker, hider) => yesNo(asker.dimension?.id === hider.dimension?.id),
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
        id: "on_grass",
        text: "Are you standing on grass?",
        answer: (asker, hider) => yesNo(standingOn(hider)?.typeId === "minecraft:grass_block"),
      },
      {
        id: "on_leaves",
        text: "Are you standing on leaves?",
        answer: (asker, hider) => yesNo(/leaves/.test(standingOn(hider)?.typeId ?? "")),
      },
      {
        id: "same_block",
        text: "Are you standing on the same block as me?",
        answer: (asker, hider) => {
          const mine = standingOn(asker)?.typeId;
          return mine && standingOn(hider)?.typeId === mine ? `Yes (${prettyBlock(mine)})` : `No (not ${prettyBlock(mine)})`;
        },
      },
      {
        id: "water_near",
        text: "Is there water within 4 blocks of you?",
        answer: (asker, hider) => yesNo(anyNear(hider, 4, (t) => t === "minecraft:water" || t === "minecraft:flowing_water")),
      },
      {
        id: "lava_near",
        text: "Is there lava within 6 blocks of you?",
        answer: (asker, hider) => yesNo(anyNear(hider, 6, (t) => t === "minecraft:lava" || t === "minecraft:flowing_lava")),
      },
      {
        id: "snow_near",
        text: "Is there snow within 4 blocks of you?",
        answer: (asker, hider) => yesNo(anyNear(hider, 4, (t) => /snow/.test(t))),
      },
      {
        id: "flowers_near",
        text: "Are there flowers within 4 blocks of you?",
        answer: (asker, hider) => yesNo(anyNear(hider, 4, (t) => FLOWERS.test(t))),
      },
      {
        id: "mobs_near",
        text: "Are there any mobs within 16 blocks of you?",
        answer: (asker, hider) => {
          try {
            const mobs = hider.dimension.getEntities({
              location: hider.location,
              maxDistance: 16,
              excludeTypes: ["minecraft:player", "hs:bot", "minecraft:item", "minecraft:xp_orb", "minecraft:arrow"],
              excludeTags: ["hs_decoy"],
            });
            return yesNo(mobs.some((m) => m.id !== hider.id && m.getComponent("minecraft:health")));
          } catch {
            return "Unknown";
          }
        },
      },
      {
        id: "sky_visible",
        text: "Is there open sky right above you?",
        answer: (asker, hider) => {
          try {
            const l = hider.location;
            const top = hider.dimension.getTopmostBlock({ x: Math.floor(l.x), z: Math.floor(l.z) });
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
    questions: [
      {
        id: "task_firework",
        text: "Launch a firework!",
        perform: (hider) =>
          spawnNear(hider, "minecraft:fireworks_rocket") ? "A firework shot up from the hider's spot!" : "The firework fizzled.",
      },
      {
        id: "task_fire",
        text: "Light a fire with a fire charge!",
        perform: (hider) => (place(hider, "minecraft:fire") ? "A fire is burning next to the hider!" : "The fire didn't catch."),
      },
      {
        id: "task_bee",
        text: "Spawn a bee!",
        perform: (hider) => (spawnNear(hider, "minecraft:bee") ? "A bee appeared next to the hider. Bzzz." : "No bee showed up."),
      },
      {
        id: "task_animal",
        text: "Spawn a farm animal!",
        perform: (hider) => {
          const [id, name] = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
          return spawnNear(hider, id) ? `A ${name} appeared next to the hider.` : "No animal showed up.";
        },
      },
      {
        id: "task_gravel",
        text: "Place a gravel block!",
        perform: (hider) => (place(hider, "minecraft:gravel") ? "A gravel block was placed next to the hider." : "The gravel couldn't be placed."),
      },
      {
        id: "task_sand",
        text: "Place a sand block!",
        perform: (hider) => (place(hider, "minecraft:sand") ? "A sand block was placed next to the hider." : "The sand couldn't be placed."),
      },
      {
        id: "task_my_block",
        text: "Place the block I'm standing on!",
        prepare: (asker) => {
          const t = standingOn(asker)?.typeId;
          return t && t !== "minecraft:air" && !/water|lava/.test(t) ? t : "minecraft:dirt";
        },
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
