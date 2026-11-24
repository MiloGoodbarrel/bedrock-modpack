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
import { world, system } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { insidePlayArea } from "./rules.js";
import { possibleFn } from "./map.js";

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
  return drawing(state) ? `${state.gameId}:${state.turn}:${state.clues.filter((c) => !c.cancelled).length}` : "none";
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
    const inside = version === "none" ? undefined : insideFn(state);
    let budget = CONFIG.skyLineChunksPerSecond;
    for (const t of [...todo.values()].sort((a, b) => a.d - b.d)) {
      if (budget-- <= 0) break;
      if (drawChunk(dim, t.cx, t.cz, inside, version)) done.set(t.key, version);
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

function insideFn(state) {
  const possible = possibleFn(state);
  return (x, z) => insidePlayArea({ x, z }, state.center) && possible(x, z);
}

/**
 * Clears old wool in the chunk and (with inside) draws the current edge. Updates the dirty list.
 * Returns false if the chunk isn't loaded.
 */
function drawChunk(dim, cx, cz, inside, version) {
  const y = CONFIG.skyLineY;
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
      try {
        if (edge) {
          if (block.isAir) block.setType(CONFIG.skyLineBlock);
          placed = true;
        } else if (block.typeId === CONFIG.skyLineBlock) {
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
        if (drawChunk(dim, cx, cz, undefined, "none")) done.delete(key);
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
          ok = !!dim.getBlock({ x: cx * 16, y: CONFIG.skyLineY, z: cz * 16 });
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
