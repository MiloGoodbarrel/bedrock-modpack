// Text minimap of the play area. Bedrock scripts can't draw map textures, so the map is a grid of colored
// squares: each cell is darkened once the answers so far rule it out, like the blackout map in the original mod.
// North is up. Shown from the Map button in the menu.
import { world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { flatPos } from "./rules.js";
import { constraintsFrom, allOk, classifyGrid } from "./geometry.js";
import * as terrain from "./terrain.js";

const CELL = "■";
// Without terrain data yet: plain green / orange / grey. With terrain: the terrain color, dark grey for partly
// ruled out, black for ruled out. Player dots use colors the terrain never does.
const PLAIN = { in: "§2", part: "§6", out: "§8" };
const OVER_TERRAIN = { part: "§8", out: "§0" };
const DOT = { me: "§d", seeker: "§5", bot: "§3", hider: "§4" };

/** True if the answers so far still allow the hider to be at x/z (overworld-equivalent coordinates). */
export function possibleAt(state, x, z) {
  return allOk(constraintsFrom(state.clues), x, z);
}

/** Same as possibleAt, as a reusable function for checking many points against the current clues. */
export function possibleFn(state) {
  const cs = constraintsFrom(state.clues);
  return (x, z) => allOk(cs, x, z);
}

let cache = { key: "", grid: null };

/**
 * size×size grid of "in" | "part" | "out", cached until a new clue arrives. Conservative (geometry.js): a
 * cell is only "out" when it's proven that no point in it fits every answer.
 */
function grid(state, size) {
  const key = `${state.gameId}:${state.cycle ?? 0}:${state.turn}:${state.clues.length}:${size}:${state.center.x},${state.center.z}`;
  if (cache.key === key) return cache.grid;
  const rows = classifyGrid(constraintsFrom(state.clues), state.center.x, state.center.z, CONFIG.playAreaRadius, size);
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
