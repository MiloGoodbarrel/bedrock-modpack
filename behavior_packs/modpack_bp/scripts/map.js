// Text minimap of the play area. Bedrock scripts can't draw map textures, so the map is a grid of colored
// squares: each cell is darkened once the answers so far rule it out, like the blackout map in the original mod.
// North is up. Used both in the menu (big) and on the HUD action bar (small).
import { world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { findQuestion } from "./questions.js";
import { flatPos } from "./rules.js";
import * as terrain from "./terrain.js";

const CELL = "■";
// Without terrain data yet: plain green / orange / grey. With terrain: the terrain color, dark grey for partly
// ruled out, black for ruled out. Player dots use colors the terrain never does.
const PLAIN = { in: "§2", part: "§6", out: "§8" };
const OVER_TERRAIN = { part: "§8", out: "§0" };
const DOT = { me: "§d", seeker: "§5", bot: "§3", hider: "§4" };
const HUD_KEY = "hs:hudmap";

/** Per-player HUD minimap toggle (on by default). */
export function hudMapOn(player) {
  try {
    return player.getDynamicProperty(HUD_KEY) !== false;
  } catch {
    return true;
  }
}

export function setHudMap(player, on) {
  try {
    player.setDynamicProperty(HUD_KEY, on);
  } catch {}
}

function planarChecks(clues) {
  return clues
    .filter((c) => c.qid && c.from && !c.cancelled)
    .map((c) => ({ c, q: findQuestion(c.qid)?.question }))
    .filter((x) => x.q?.planar);
}

function possible(x, z, checks) {
  const hider = { location: { x, y: 0, z } };
  for (const { c, q } of checks) {
    if (q.answer({ location: c.from }, hider) !== c.answer) return false;
  }
  return true;
}

/** True if the answers so far still allow the hider to be at x/z (overworld-equivalent coordinates). */
export function possibleAt(state, x, z) {
  return possible(x, z, planarChecks(state.clues));
}

/** Same as possibleAt, as a reusable function for checking many points against the current clues. */
export function possibleFn(state) {
  const checks = planarChecks(state.clues);
  return (x, z) => possible(x, z, checks);
}

let cache = { key: "", grid: null };

/** size x size grid of "in" | "part" | "out", cached until a new clue arrives. */
function grid(state, size) {
  const key = `${state.gameId}:${state.turn}:${state.clues.length}:${size}`;
  if (cache.key === key) return cache.grid;
  const checks = planarChecks(state.clues);
  const r = CONFIG.playAreaRadius;
  const cell = (2 * r) / size;
  const x0 = state.center.x - r;
  const z0 = state.center.z - r;
  const rows = [];
  for (let row = 0; row < size; row++) {
    const line = [];
    for (let col = 0; col < size; col++) {
      let ok = 0;
      for (const fx of [0.17, 0.5, 0.83]) {
        for (const fz of [0.17, 0.5, 0.83]) {
          if (possible(x0 + (col + fx) * cell, z0 + (row + fz) * cell, checks)) ok++;
        }
      }
      line.push(ok === 9 ? "in" : ok === 0 ? "out" : "part");
    }
    rows.push(line);
  }
  cache = { key, grid: rows };
  return rows;
}

function cellOf(state, size, entity) {
  const p = flatPos(entity);
  const r = CONFIG.playAreaRadius;
  const cell = (2 * r) / size;
  const clamp = (v) => Math.max(0, Math.min(size - 1, Math.floor(v)));
  return { col: clamp((p.x - (state.center.x - r)) / cell), row: clamp((p.z - (state.center.z - r)) / cell) };
}

/**
 * Who appears on the map for this viewer. Seekers see themselves and the other seekers; the hider also sees
 * their own spot. Nobody but the hider sees the hider.
 * deps: { hiderId, isSeeker, seekerBots } from game.js / bots.js (passed in to avoid an import cycle).
 */
function markers(state, viewer, deps) {
  const out = [];
  for (const b of deps.seekerBots()) out.push({ entity: { location: { x: b.x, y: 0, z: b.z } }, color: DOT.bot });
  for (const p of world.getAllPlayers()) {
    if (p.id !== viewer.id && deps.isSeeker(p)) out.push({ entity: p, color: DOT.seeker });
  }
  out.push({ entity: viewer, color: viewer.id === deps.hiderId() ? DOT.hider : DOT.me });
  return out;
}

function cellColor(state, size, row, col, v) {
  const r = CONFIG.playAreaRadius;
  const cell = (2 * r) / size;
  const base = terrain.colorAt(state, state.center.x - r + (col + 0.5) * cell, state.center.z - r + (row + 0.5) * cell);
  if (!base) return PLAIN[v];
  return v === "in" ? base : OVER_TERRAIN[v];
}

/** The map as lines of text. */
export function renderMap(state, viewer, size, deps) {
  if (!state.center) return [];
  const g = grid(state, size);
  const marks = new Map();
  for (const m of markers(state, viewer, deps)) {
    if (m.entity.dimension && m.entity.dimension.id === "minecraft:the_end") continue;
    const { row, col } = cellOf(state, size, m.entity);
    marks.set(`${row},${col}`, m.color);
  }
  return g.map((line, row) =>
    line.map((v, col) => `${marks.get(`${row},${col}`) ?? cellColor(state, size, row, col, v)}${CELL}`).join("") + "§r"
  );
}

/** Legend text for the menu map, matching whether terrain has been scanned yet. */
export function legend(state) {
  const dots = `${DOT.me}■§r you · ${DOT.seeker}■§r other seekers · ${DOT.bot}■§r bots · ${DOT.hider}■§r you (hider)`;
  const done = terrain.progress(state);
  if (done <= 0) return `§fN§r is up · §2■§r possible · §6■§r partly ruled out · §8■§r ruled out\n${dots}`;
  const scan = done < 1 ? `\n§7Terrain scan: ${Math.floor(done * 100)}%§r` : "";
  return (
    "§fN§r is up · §0■§r ruled out · §8■§r partly ruled out\n" +
    "§9■§r water §b■§r ice §a■§r grass §2■§r forest §e■§r sand §6■§r dirt/badlands §f■§r snow §7■§r stone §c■§r lava\n" +
    dots +
    scan
  );
}

/** Cell size in blocks for a map of this size. */
export function cellBlocks(size) {
  return Math.round((2 * CONFIG.playAreaRadius) / size);
}
