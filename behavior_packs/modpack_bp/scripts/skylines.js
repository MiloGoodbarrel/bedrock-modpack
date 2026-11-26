// Red lines in the sky that show up on real map items.
//
// Bedrock add-ons can't draw on maps, but a map shows the highest block in each column. So during a round, the
// add-on places a band of red wool high in the sky along the edge of the area where the hider can still be
// (the play area's border before any answers, then the shape the answers leave). Anyone exploring with a map
// sees the outline appear.
//
// Lines are drawn in chunks near players (loaded anyway, and the only places maps update). Every chunk that
// gets wool is remembered with the "version" (game, round, number of answers) it was drawn for. Chunks drawn
// for an older version are cleaned up in the background, loading them with a ticking area if needed, so a new
// hider's round starts with a clean sky. game.js also swaps everyone's map for a fresh one each round.
import { world, system, BlockPermutation } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { insidePlayArea } from "./rules.js";
import { possibleFn } from "./map.js";
import { FILL_MODES, fillBlock } from "./settings.js";

// Every block type this module ever places (or used to), so old ones get cleared even if the settings changed.
const OURS = new Set(
  [
    CONFIG.skyLineBlock,
    CONFIG.skyLineFallback,
    "minecraft:red_wool",
    ...FILL_MODES.flatMap(([, , b, , fb]) => [b, fb]),
  ].filter(Boolean)
);

const perms = new Map();

/** The block to place, e.g. a top-half wool slab, falling back to a full block if the slab doesn't exist. */
function permutation(type, states, fallback) {
  const key = `${type}|${fallback}`;
  if (!perms.has(key)) {
    let p;
    try {
      p = BlockPermutation.resolve(type, states);
    } catch {
      try {
        p = BlockPermutation.resolve(type);
      } catch {
        try {
          p = fallback ? BlockPermutation.resolve(fallback) : undefined;
        } catch {}
      }
    }
    perms.set(key, p);
  }
  return perms.get(key);
}

/** Y for the lines: CONFIG.skyLineY, or build height (the highest placeable block, normally 319). */
function skyY(dim) {
  if (CONFIG.skyLineY != null) return CONFIG.skyLineY;
  try {
    return dim.heightRange.max - 1; // max is exclusive
  } catch {
    return 319;
  }
}

function linePerm() {
  return permutation(CONFIG.skyLineBlock, CONFIG.skyLineStates, CONFIG.skyLineFallback);
}

const OVERWORLD = "minecraft:overworld";
const RADIUS = 4; // chunks around each player
const DIRTY_KEY = "hs:skydirty";
const CLEAN_AREA = "hs_skyclean";

const done = new Map(); // "cx,cz" -> version drawn this session (skip redrawing)
let dirty = null; // Map "cx,cz" -> version, for chunks that have wool in them (persisted)
let dirtyChanged = false;
let cleaning = false;

const wait = (ticks) => new Promise((resolve) => system.runTimeout(resolve, ticks));

function dirtyMap() {
  if (!dirty) {
    dirty = new Map();
    try {
      const raw = world.getDynamicProperty(DIRTY_KEY);
      if (typeof raw === "string") for (const [k, v] of Object.entries(JSON.parse(raw))) dirty.set(k, v);
    } catch {}
  }
  return dirty;
}

function saveDirty() {
  if (!dirtyChanged) return;
  dirtyChanged = false;
  try {
    world.setDynamicProperty(DIRTY_KEY, JSON.stringify(Object.fromEntries(dirtyMap())));
  } catch {}
}

function drawing(state) {
  return (state.phase === "hiding" || state.phase === "seeking") && !!state.center && state.dimId === OVERWORLD;
}

function versionOf(state) {
  return drawing(state) ? `${state.gameId}:${state.cycle ?? 0}:${state.turn}:${state.clues.filter((c) => !c.cancelled).length}` : "none";
}

/** Once per second. */
export function tick(state) {
  if (!CONFIG.skyLines) return;
  const version = versionOf(state);

  const todo = new Map();
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== OVERWORLD) continue;
    const pcx = Math.floor(p.location.x / 16);
    const pcz = Math.floor(p.location.z / 16);
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      for (let dz = -RADIUS; dz <= RADIUS; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = `${cx},${cz}`;
        if (done.get(key) === version) continue;
        // Outside a round, only chunks that actually have wool need visiting.
        if (version === "none" && !dirtyMap().has(key)) continue;
        const d = dx * dx + dz * dz;
        const prev = todo.get(key);
        if (!prev || d < prev.d) todo.set(key, { cx, cz, d, key });
      }
    }
  }

  const dim = world.getDimension(OVERWORLD);
  if (todo.size) {
    const shape = version === "none" ? undefined : shapeFns(state);
    let budget = CONFIG.skyLineChunksPerSecond;
    for (const t of [...todo.values()].sort((a, b) => a.d - b.d)) {
      if (budget-- <= 0) break;
      if (drawChunk(dim, t.cx, t.cz, shape, version)) done.set(t.key, version);
    }
  }

  // Lines from an older round/answer far from everyone: clean them up in the background.
  if (!cleaning && [...dirtyMap().values()].some((v) => v !== version)) {
    cleaning = true;
    cleanup(dim, () => versionOf(state))
      .catch((e) => console.warn(`[hs] sky line cleanup failed: ${e}`))
      .finally(() => {
        cleaning = false;
      });
  }
  saveDirty();
}

/** inside(x,z): the hider could be here. ruledOut(x,z): in the play area but ruled out. fill: block or undefined. */
function shapeFns(state) {
  const possible = possibleFn(state);
  const f = fillBlock(state.rules?.fillMode);
  return {
    inside: (x, z) => insidePlayArea({ x, z }, state.center) && possible(x, z),
    ruledOut: (x, z) => insidePlayArea({ x, z }, state.center) && !possible(x, z),
    fill: f ? permutation(f.type, f.states, f.fallback) : undefined,
    fillBlocksLight: !!f && !/glass/.test(f.type),
  };
}

/**
 * Clears old blocks in the chunk and (with a shape) draws the current edge, plus the ruled-out fill if that's
 * on. Updates the dirty list. Returns false if the chunk isn't loaded.
 */
function drawChunk(dim, cx, cz, shape, version) {
  const inside = shape?.inside;
  const y = skyY(dim);
  const x0 = cx * 16;
  const z0 = cz * 16;
  let probe;
  try {
    probe = dim.getBlock({ x: x0, y, z: z0 });
  } catch {
    return false;
  }
  if (!probe) return false;
  const w = CONFIG.skyLineWidth;
  let placed = false;
  for (let x = x0; x < x0 + 16; x++) {
    for (let z = z0; z < z0 + 16; z++) {
      let block;
      try {
        block = dim.getBlock({ x, y, z });
      } catch {
        continue;
      }
      if (!block) continue;
      const mx = x + 0.5;
      const mz = z + 0.5;
      const edge =
        !!inside && inside(mx, mz) && (!inside(mx + w, mz) || !inside(mx - w, mz) || !inside(mx, mz + w) || !inside(mx, mz - w));
      // The fill leaves a gap at every odd x and odd z (1 block in 4), so daylight still reaches the ground and
      // the ruled-out area doesn't get dark enough for monsters. Maps still show it dark: 3 of every 4 blocks
      // are filled, and zoomed-out maps sample even coordinates. See-through fills (glass) don't need gaps.
      const gap = (x & 1) === 1 && (z & 1) === 1 && shape?.fillBlocksLight;
      const want = edge ? linePerm() : shape?.fill && !gap && shape.ruledOut(mx, mz) ? shape.fill : undefined;
      try {
        if (want) {
          if (block.typeId !== want.type.id && (block.isAir || OURS.has(block.typeId))) block.setPermutation(want);
          placed = true;
        } else if (OURS.has(block.typeId)) {
          block.setType("minecraft:air");
        }
      } catch {}
    }
  }
  const key = `${cx},${cz}`;
  if (placed) dirtyMap().set(key, version);
  else dirtyMap().delete(key);
  dirtyChanged = true;
  return true;
}

/** Clears every chunk whose lines are from an older version, loading far-away ones with a ticking area. */
async function cleanup(dim, currentVersion) {
  const stale = () => [...dirtyMap().entries()].filter(([, v]) => v !== currentVersion()).map(([k]) => k);
  try {
    for (let guard = 0; guard < 300; guard++) {
      let keys = stale();
      if (!keys.length) return;
      // Clear whatever is already loaded.
      for (const key of keys) {
        const [cx, cz] = key.split(",").map(Number);
        if (drawChunk(dim, cx, cz, undefined, "none")) done.delete(key); // no shape = clear only
      }
      saveDirty();
      keys = stale();
      if (!keys.length) return;
      // Load the next stale spot and try again.
      const [cx, cz] = keys[0].split(",").map(Number);
      try {
        dim.runCommand(`tickingarea remove ${CLEAN_AREA}`);
      } catch {}
      try {
        dim.runCommand(`tickingarea add circle ${cx * 16 + 8} 64 ${cz * 16 + 8} 4 ${CLEAN_AREA}`);
      } catch {}
      for (let t = 0; t < 40; t++) {
        let ok = false;
        try {
          ok = !!dim.getBlock({ x: cx * 16, y: skyY(dim), z: cz * 16 });
        } catch {}
        if (ok) break;
        await wait(5);
      }
      await wait(5);
    }
  } finally {
    try {
      dim.runCommand(`tickingarea remove ${CLEAN_AREA}`);
    } catch {}
  }
}
