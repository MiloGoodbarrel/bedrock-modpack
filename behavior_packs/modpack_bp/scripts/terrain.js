// Terrain scan for the map. Scripts can only read loaded chunks, so once a game starts this walks a ticking area
// across the play area, a few samples at a time, and records the surface at each grid point as a color code
// (water, grass, forest, sand, snow...). The finished scan is saved with the world and reused by any later game
// started from the same spot.
import { world, system } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { surfaceBlock } from "./surface.js";

const KEY = "hs:terrain";
const AREA = "hs_scan";
const FAILED = "x"; // sample couldn't be loaded; drawn as unknown

// Surface block -> map color. First match wins.
const PALETTE = [
  [/lava|magma/, "§c"],
  [/ice/, "§b"],
  [/water|kelp|seagrass|bubble/, "§9"],
  [/leaves|log|wood|mushroom_block|bamboo|vine/, "§2"],
  [/snow/, "§f"],
  [/red_sand|terracotta/, "§6"],
  [/sand/, "§e"],
  [/grass_block|moss|azalea/, "§a"],
  [/dirt|podzol|mud|mycelium|farmland|path|clay/, "§6"],
];
const PLANT =
  /(short_grass|tall_grass|fern|flower|tulip|dandelion|poppy|orchid|allium|bluet|daisy|bush|sapling|snow_layer|sugar_cane|reeds|carpet|petals|leaf_litter|wildflowers)/;

let data = null; // { key, n, cells: string[] }
let running = false;

const wait = (ticks) => new Promise((resolve) => system.runTimeout(resolve, ticks));

function loadData() {
  if (data) return data;
  try {
    const raw = world.getDynamicProperty(KEY);
    if (typeof raw === "string") data = JSON.parse(raw);
  } catch {}
  return data;
}

function persist() {
  try {
    world.setDynamicProperty(KEY, JSON.stringify(data));
  } catch (e) {
    console.warn(`[hs] could not save terrain: ${e}`);
  }
}

function keyFor(state) {
  const c = state.center;
  return `${state.dimId}:${Math.floor(c.x)}:${Math.floor(c.z)}:${CONFIG.playAreaRadius}:${CONFIG.terrainGrid}`;
}

function current(state) {
  const d = loadData();
  return d && state.center && d.key === keyFor(state) ? d : undefined;
}

/** 0..1, how much of the play area has been scanned for the current game. */
export function progress(state) {
  const d = current(state);
  if (!d) return 0;
  return d.cells.filter(Boolean).length / d.cells.length;
}

/**
 * Whether the play area has any water or ice, from the terrain scan: true / false once the scan is finished,
 * undefined while it isn't (so nothing gets ruled out on incomplete data).
 */
export function hasWater(state) {
  const d = current(state);
  if (!d || d.cells.some((c) => !c)) return undefined;
  return d.cells.some((c) => c === "§9" || c === "§b");
}

/** Terrain color code at overworld x/z, or undefined if not scanned yet. */
export function colorAt(state, x, z) {
  const d = current(state);
  if (!d) return undefined;
  const r = CONFIG.playAreaRadius;
  const cell = (2 * r) / d.n;
  const clamp = (v) => Math.max(0, Math.min(d.n - 1, Math.floor(v)));
  const col = clamp((x - (state.center.x - r)) / cell);
  const row = clamp((z - (state.center.z - r)) / cell);
  const v = d.cells[row * d.n + col];
  return v && v !== FAILED ? v : undefined;
}

function classify(dim, x, z) {
  let b;
  try {
    b = surfaceBlock(dim, { x, z });
  } catch {
    return undefined;
  }
  if (!b) return "§8";
  let t = b.typeId;
  if (PLANT.test(t)) {
    try {
      t = b.below()?.typeId ?? t;
    } catch {}
  }
  for (const [re, color] of PALETTE) if (re.test(t)) return color;
  return "§7"; // stone, gravel, ores, buildings...
}

function loaded(dim, p) {
  try {
    return !!dim.getBlock({ x: p.x, y: 64, z: p.z });
  } catch {
    return false;
  }
}

/**
 * Starts (or resumes) the scan for the current game if it isn't finished. isActive() says whether that game is
 * still running; the scan stops when it isn't.
 */
export function ensureScan(state, isActive) {
  if (running || !CONFIG.terrainScan || !state.center || state.dimId === "minecraft:nether") return;
  let d = current(state);
  if (!d) {
    const n = CONFIG.terrainGrid;
    data = d = { key: keyFor(state), n, cells: Array(n * n).fill("") };
    persist();
  }
  if (d.cells.every(Boolean)) return;
  running = true;
  const fresh = !d.cells.some(Boolean);
  if (fresh) world.sendMessage("§7Mapping the play area's terrain in the background (takes a few minutes)...");
  scan(d, { ...state.center }, state.dimId, isActive)
    .catch((e) => console.warn(`[hs] terrain scan failed: ${e}`))
    .finally(() => {
      running = false;
    });
}

async function scan(d, center, dimId, isActive) {
  const dim = world.getDimension(dimId);
  const n = d.n;
  const r = CONFIG.playAreaRadius;
  const cell = (2 * r) / n;
  const group = 3; // 3x3 samples per ticking area (~120 blocks across)
  try {
    for (let gr = 0; gr < n; gr += group) {
      for (let gc = 0; gc < n; gc += group) {
        if (!isActive() || data !== d) return;
        const pts = [];
        for (let row = gr; row < Math.min(gr + group, n); row++) {
          for (let col = gc; col < Math.min(gc + group, n); col++) {
            if (d.cells[row * n + col]) continue;
            pts.push({
              i: row * n + col,
              x: Math.floor(center.x - r + (col + 0.5) * cell),
              z: Math.floor(center.z - r + (row + 0.5) * cell),
            });
          }
        }
        if (!pts.length) continue;
        if (!pts.every((p) => loaded(dim, p))) {
          const mx = Math.floor(pts.reduce((s, p) => s + p.x, 0) / pts.length);
          const mz = Math.floor(pts.reduce((s, p) => s + p.z, 0) / pts.length);
          try {
            dim.runCommand(`tickingarea remove ${AREA}`);
          } catch {}
          try {
            dim.runCommand(`tickingarea add circle ${mx} 64 ${mz} 4 ${AREA}`);
          } catch {}
          for (let t = 0; t < 60 && !pts.every((p) => loaded(dim, p)); t++) await wait(5);
          await wait(5);
        }
        for (const p of pts) d.cells[p.i] = (loaded(dim, p) && classify(dim, p.x, p.z)) || FAILED;
        persist();
      }
    }
    world.sendMessage("§aThe map now shows the play area's terrain.");
  } finally {
    try {
      dim.runCommand(`tickingarea remove ${AREA}`);
    } catch {}
  }
}
