// AI players for solo games.
//
// Bedrock can't add fake players without experimental APIs (which don't run on Realms), so bots are
// player-shaped `hs:bot` entities driven entirely by this script:
// - Seeker bots live "on paper" (just an x/z position) while far from everyone, and appear as entities when a
//   person or a bot's hiding spot is nearby, so they only ever touch loaded chunks.
// - They keep a cloud of candidate points consistent with every planar clue asked so far (by anyone), walk to
//   the nearest unsearched candidate, ask whichever question splits the cloud most evenly, and find the hider
//   by line of sight within their field of view (or by bumping into them).
// - A bot hider scouts a random area (loaded with a ticking area), picks the most covered spot that passes the
//   spot rules, plants a leaf bush around it, and stands there.

import { world, system, BlockPermutation } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { surfaceBlock } from "./surface.js";
import { CATEGORIES } from "./questions.js";
import { insidePlayArea } from "./rules.js";
import * as disguise from "./disguise.js";
import { constraintsFrom, allOk, smallestYesCircle } from "./geometry.js";
import * as game from "./game.js";

export const BOT_TYPE = "hs:bot";
const SCOUT_AREA = "hs_scout";
const HIDE_AREA = "hs_hide";
const DT = 0.2; // seconds per fast tick (runs every 4 game ticks)
const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];

// Blocks you can walk through (grass, flowers, ...). Matched against the type id.
const PASSABLE =
  /(grass$|fern|flower|tulip|dandelion|poppy|orchid|allium|bluet|daisy|bush|sapling|vine|snow_layer|torch|carpet|rail|button|pressure_plate|sign|sugar_cane|reeds|kelp|mushroom|lily|leaf_litter|petals|cobweb)/;

const wait = (ticks) => new Promise((resolve) => system.runTimeout(resolve, ticks));
const hyp = (dx, dz) => Math.hypot(dx, dz);
const rand = (spread) => (Math.random() * 2 - 1) * spread;

export function isBotId(id) {
  return typeof id === "string" && id.startsWith("bot:");
}

/** Player-list entries for new bots. */
export function makeBots(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `bot:${i + 1}`,
    name: CONFIG.botNames[i] ?? `Bot ${i + 1}`,
    bot: true,
    skin: i % 2,
  }));
}

// ---------------------------------------------------------------------------
// World helpers
// ---------------------------------------------------------------------------

function dim() {
  return world.getDimension(game.state.dimId);
}

function cmd(d, command) {
  try {
    d.runCommand(command);
  } catch {}
}

function getBlock(d, loc) {
  try {
    return d.getBlock(loc);
  } catch {
    return undefined;
  }
}

function isOpen(b) {
  return !!b && (b.isAir || b.isLiquid || PASSABLE.test(b.typeId));
}

/** Something a bot can stand on. Liquids count, so bots wade across water instead of sinking. */
function isFloor(b) {
  return !!b && !b.isAir && !PASSABLE.test(b.typeId);
}

/** Highest standing Y in column x/z, scanning down from fromY. Undefined if none or unloaded. */
function scanDown(d, x, z, fromY, depth, skipCanopy) {
  for (let y = fromY; y > fromY - depth; y--) {
    const below = getBlock(d, { x, y: y - 1, z });
    if (!below) return undefined;
    if (skipCanopy && /leaves|log/.test(below.typeId)) continue;
    if (isFloor(below) && isOpen(getBlock(d, { x, y, z })) && isOpen(getBlock(d, { x, y: y + 1, z }))) return y;
  }
  return undefined;
}

/** Ground level at x/z: near a known Y if given, otherwise the surface under any tree canopy. */
function groundY(d, x, z, nearY) {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  if (nearY != null) return scanDown(d, bx, bz, Math.floor(nearY) + 1, 13, false);
  let top;
  try {
    top = surfaceBlock(d, { x: bx, z: bz });
  } catch {
    return undefined;
  }
  if (!top) return undefined;
  return scanDown(d, bx, bz, top.location.y + 1, 40, true);
}

function liveEntity(entityId) {
  if (!entityId) return undefined;
  try {
    const e = world.getEntity(entityId);
    return e?.isValid ? e : undefined;
  } catch {
    return undefined;
  }
}

function spawnBot(id, loc, yaw, nameTag) {
  const entry = game.state.players.find((p) => p.id === id);
  const e = dim().spawnEntity(BOT_TYPE, loc);
  try {
    e.setProperty("hs:skin", entry?.skin ?? 0);
  } catch {}
  try {
    e.nameTag = nameTag;
  } catch {}
  try {
    e.setRotation({ x: 0, y: yaw });
  } catch {}
  return e;
}

function removeAllBotEntities() {
  for (const id of DIMENSIONS) {
    try {
      for (const e of world.getDimension(id).getEntities({ type: BOT_TYPE })) e.remove();
    } catch {}
  }
}

function isTracked(entity) {
  return Object.values(game.state.bots ?? {}).some((b) => b.entityId === entity.id);
}

/** Removes bot entities the game no longer knows about (e.g. left behind in a chunk that was unloaded). */
export function onEntityLoad(entity) {
  try {
    if (entity.typeId === BOT_TYPE && !isTracked(entity)) entity.remove();
    else if (entity.hasTag(disguise.DECOY_TAG) && entity.id !== game.state.disguise?.entityId) entity.remove();
  } catch {}
}

export function removeStray() {
  for (const id of DIMENSIONS) {
    try {
      for (const e of world.getDimension(id).getEntities({ type: BOT_TYPE })) onEntityLoad(e);
    } catch {}
  }
}

function randomPoint(minFromCenter = 0) {
  const c = game.state.center;
  const r = CONFIG.playAreaRadius;
  for (let i = 0; i < 50; i++) {
    const p = { x: c.x + rand(r), z: c.z + rand(r) };
    if (hyp(p.x - c.x, p.z - c.z) >= minFromCenter) return p;
  }
  return { x: c.x + r / 2, z: c.z };
}

function inArea(p) {
  return insidePlayArea(p, game.state.center);
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------

function freshSeeker() {
  const c = game.state.center;
  return { x: c.x + rand(3), y: c.y, z: c.z + rand(3), look: Math.random() * 360, target: null, pause: 0, stuck: 0, sight: 0, entityId: null };
}

/** Called at the start of every turn, after state.turn is set. */
export function onTurnStart() {
  const s = game.state;
  removeAllBotEntities();
  disguise.removeDecoys();
  cmd(dim(), `tickingarea remove ${HIDE_AREA}`);
  s.botHide = null;
  s.searched = [];
  s.searchSeq = 0;
  s.botAskWait = null;
  s.bots = {};
  for (const p of s.players) {
    if (p.bot && p.id !== game.hiderId()) s.bots[p.id] = freshSeeker();
  }
}

/** Shows the found bot hider's name and lets its area unload. */
export function onHiderFound() {
  const s = game.state;
  const id = game.hiderId();
  const e = liveEntity(s.bots?.[id]?.entityId);
  if (e) {
    try {
      e.nameTag = game.nameOf(id);
    } catch {}
  }
  cmd(dim(), `tickingarea remove ${HIDE_AREA}`);
}

/** Removes every bot entity and ticking area (end of game / reset). */
export function cleanup() {
  const s = game.state;
  removeAllBotEntities();
  const d = dim();
  cmd(d, `tickingarea remove ${HIDE_AREA}`);
  cmd(d, `tickingarea remove ${SCOUT_AREA}`);
  s.bots = {};
  s.botHide = null;
}

function seekerBots() {
  const s = game.state;
  s.bots ??= {};
  return s.players.filter((p) => p.bot && p.id !== game.hiderId()).map((p) => [p.id, (s.bots[p.id] ??= freshSeeker())]);
}

// ---------------------------------------------------------------------------
// Bot hider
// ---------------------------------------------------------------------------

let planning = false;

export function hideReady() {
  return !!game.state.botHide;
}

/** Starts (or restarts after a reload) the bot hider's search for a spot. */
export function ensureHidePlan() {
  const s = game.state;
  if (planning || s.botHide) return;
  planning = true;
  const token = game.roundKey();
  planHide(token)
    .catch((e) => console.warn(`[hs] bot hide failed: ${e}`))
    .finally(() => {
      planning = false;
    });
}

function sameRound(token) {
  const s = game.state;
  return s.phase === "hiding" && game.roundKey() === token;
}

async function waitLoaded(d, x, z, token) {
  for (let i = 0; i < 60; i++) {
    if (!sameRound(token)) return false;
    if (getBlock(d, { x, y: CONFIG.seaLevel, z })) {
      await wait(10); // let neighbouring chunks finish too
      return true;
    }
    await wait(5);
  }
  return false;
}

async function planHide(token) {
  const d = dim();
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (!sameRound(token)) return;
      const p = randomPoint(CONFIG.botMinHideDistance);
      const px = Math.floor(p.x);
      const pz = Math.floor(p.z);
      cmd(d, `tickingarea remove ${SCOUT_AREA}`);
      cmd(d, `tickingarea add circle ${px} ${CONFIG.seaLevel} ${pz} 1 ${SCOUT_AREA}`);
      if (!(await waitLoaded(d, px, pz, token))) continue;
      const spot = findSpot(d, px, pz);
      if (!spot || !sameRound(token)) continue;

      cmd(d, `tickingarea remove ${HIDE_AREA}`);
      cmd(d, `tickingarea add circle ${spot.x} ${spot.y} ${spot.z} 4 ${HIDE_AREA}`);
      const s = game.state;
      const hide = { x: spot.x + 0.5, y: spot.y, z: spot.z + 0.5, yaw: Math.random() * 360 };
      if (s.rules?.morph) {
        if (!disguiseBot(d, hide)) continue;
      } else {
        buildCover(d, spot);
      }
      s.botHide = hide;
      hiderEntity();
      return;
    }
  } finally {
    cmd(d, `tickingarea remove ${SCOUT_AREA}`);
  }
}

/** Picks and applies a random disguise for a bot hider at the given spot. False if no block fits. */
function disguiseBot(d, hide) {
  const s = game.state;
  const type = s.rules.morphType;
  const kind = type === "both" ? (Math.random() < 0.5 ? "mob" : "block") : type;
  if (kind === "mob") {
    const [mob] = disguise.MOBS[Math.floor(Math.random() * disguise.MOBS.length)];
    s.disguise = { kind, type: mob, applied: true, entityId: null }; // entity spawned by hiderEntity()
    return true;
  }
  const near = disguise.neighbourTypes(d, hide);
  const options = disguise.BLOCKS.map(([id]) => id).filter((id) => !near.includes(id));
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  for (const block of options) {
    const original = disguise.placeBlock(d, hide, block);
    if (original) {
      s.disguise = { kind, type: block, applied: true, entityId: null, original }; // original is restored later
      return true;
    }
  }
  return false;
}

/** Best-covered standing spot near px/pz that passes the spot rules. */
function findSpot(d, px, pz) {
  let best;
  let bestScore = -1;
  for (let i = 0; i < 60; i++) {
    const x = px + Math.floor(rand(12.5));
    const z = pz + Math.floor(rand(12.5));
    if (!inArea({ x: x + 0.5, z: z + 0.5 })) continue;
    let ground;
    try {
      ground = surfaceBlock(d, { x, z });
    } catch {
      continue;
    }
    if (ground && PASSABLE.test(ground.typeId)) ground = ground.below();
    // Topmost block = open sky overhead, which covers "Near Sky Light". Skip treetops and water.
    if (!ground || ground.isLiquid || /leaves|log/.test(ground.typeId)) continue;
    try {
      if (ground.isWaterlogged) continue;
    } catch {}
    const y = ground.location.y + 1;
    if (y < CONFIG.seaLevel) continue;
    if (game.state.rules?.maxY && y > game.state.rules.maxY) continue;
    const feet = getBlock(d, { x, y, z });
    const head = getBlock(d, { x, y: y + 1, z });
    if (!isOpen(feet) || !isOpen(head) || feet.isLiquid || head.isLiquid) continue;
    const score = coverScore(d, x, y, z) + Math.random() * 3;
    if (score > bestScore) {
      bestScore = score;
      best = { x, y, z };
    }
  }
  return best;
}

function coverScore(d, x, y, z) {
  let n = 0;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (!dx && !dz) continue;
      for (const dy of [0, 1]) {
        if (!isOpen(getBlock(d, { x: x + dx, y: y + dy, z: z + dz }))) n += Math.abs(dx) <= 1 && Math.abs(dz) <= 1 ? 2 : 1;
      }
    }
  }
  return n;
}

const RING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/** Plants a waist-to-head-high leaf bush around the spot, leaving the sky open above. */
function buildCover(d, spot) {
  let leaves;
  try {
    leaves = BlockPermutation.resolve("minecraft:oak_leaves", { persistent_bit: true });
  } catch {
    try {
      leaves = BlockPermutation.resolve("minecraft:oak_leaves");
    } catch {
      return;
    }
  }
  const gap = Math.floor(Math.random() * RING.length);
  RING.forEach(([dx, dz], i) => {
    if (i === gap || Math.random() < 0.3) return;
    for (const dy of [0, 1]) {
      const b = getBlock(d, { x: spot.x + dx, y: spot.y + dy, z: spot.z + dz });
      if (b && !b.isLiquid && (b.isAir || PASSABLE.test(b.typeId))) {
        try {
          b.setPermutation(leaves);
        } catch {}
      }
    }
  });
}

/**
 * The bot hider's entity (its bot body, or its mob disguise), respawned at its spot if it went missing.
 * Undefined for a block disguise, which has no entity.
 */
export function hiderEntity() {
  const s = game.state;
  const h = s.botHide;
  if (!h) return undefined;
  const dz = s.disguise;
  if (dz?.kind === "block") return undefined;
  if (dz?.kind === "mob") {
    let e = disguise.liveEntity(dz.entityId);
    if (!e) {
      try {
        e = disguise.spawnDecoy(dim(), dz.type, { x: h.x, y: h.y, z: h.z }, h.yaw);
        dz.entityId = e.id;
      } catch {
        return undefined;
      }
    }
    return e;
  }
  const id = game.hiderId();
  s.bots ??= {};
  const b = (s.bots[id] ??= {});
  let e = liveEntity(b.entityId);
  if (!e) {
    try {
      e = spawnBot(id, { x: h.x, y: h.y, z: h.z }, h.yaw, "");
      b.entityId = e.id;
    } catch {
      return undefined;
    }
  }
  return e;
}

// ---------------------------------------------------------------------------
// Seeker bots: where could the hider be?
// ---------------------------------------------------------------------------

let pool = { round: "", stamp: "", pts: [] };

/** The canonical search-area constraints (geometry.js), shared with the map, sky outline and teleports. */
function clueChecks() {
  return constraintsFrom(game.state.clues);
}

function consistent(p, checks) {
  if (!allOk(checks, p.x, p.z)) return false;
  for (const m of game.state.searched ?? []) {
    if (hyp(p.x - m.x, p.z - m.z) < m.r) return false;
  }
  return true;
}

/** Random point generator, sampling inside the smallest "yes, within N blocks" circle when there is one. */
function sampler(checks) {
  const circle = smallestYesCircle(checks);
  if (!circle) return () => randomPoint(0);
  return () => {
    const a = Math.random() * Math.PI * 2;
    const r = circle.r * Math.sqrt(Math.random());
    return { x: circle.cx + Math.cos(a) * r, z: circle.cz + Math.sin(a) * r };
  };
}

/** Points the hider could still be at (consistent with all clues, not yet searched). */
function candidates() {
  const s = game.state;
  s.searched ??= [];
  const round = game.roundKey();
  const stamp = `${s.clues.length}:${s.searchSeq ?? 0}`;
  if (pool.round !== round) pool = { round, stamp: "", pts: [] };
  const checks = clueChecks();
  if (pool.stamp !== stamp) {
    pool.pts = pool.pts.filter((p) => consistent(p, checks));
    pool.stamp = stamp;
  }
  if (pool.pts.length < 150) {
    const next = sampler(checks);
    for (let i = 0; i < 1500 && pool.pts.length < 400; i++) {
      const p = next();
      if (inArea(p) && consistent(p, checks)) pool.pts.push(p);
    }
    // Everything left has been searched without luck: search it all again.
    if (!pool.pts.length && s.searched.length) {
      s.searched = [];
      s.searchSeq = (s.searchSeq ?? 0) + 1;
    }
  }
  return pool.pts;
}

function markSearched(x, z) {
  const s = game.state;
  s.searched ??= [];
  s.searched.push({ x: Math.round(x), z: Math.round(z), r: CONFIG.botSearchRadius });
  if (s.searched.length > 150) s.searched.shift();
  s.searchSeq = (s.searchSeq ?? 0) + 1;
}

/** Nearest promising candidate, steering away from where the other bots are already heading. */
function chooseTarget(b) {
  const pts = candidates();
  if (!pts.length) return;
  const others = Object.values(game.state.bots).filter((o) => o !== b && o.target).map((o) => o.target);
  let best;
  let bestCost = Infinity;
  for (let i = 0; i < Math.min(pts.length, 200); i++) {
    const p = pts[Math.floor(Math.random() * pts.length)];
    let cost = hyp(p.x - b.x, p.z - b.z);
    for (const t of others) if (hyp(p.x - t.x, p.z - t.z) < 40) cost += 80;
    if (cost < bestCost) {
      bestCost = cost;
      best = p;
    }
  }
  b.target = { x: best.x, z: best.z };
}

function reached(b, physical) {
  if (!b.target.detour) {
    markSearched(b.x, b.z);
    if (physical) b.pause = 2; // look around
  }
  b.target = null;
}

/** The unused planar question that splits the candidates most evenly from where this bot stands. */
function bestQuestion(b, pts) {
  const from = { location: { x: b.x, y: b.y ?? game.state.center.y, z: b.z } };
  const sample = pts.length > 300 ? pts.slice(0, 300) : pts;
  let best;
  for (const cat of CATEGORIES) {
    for (const q of cat.questions) {
      if (!q.planar || game.state.used.includes(q.id)) continue;
      const first = q.answer(from, { location: sample[0] });
      let same = 0;
      for (const p of sample) if (q.answer(from, { location: p }) === first) same++;
      const score = Math.min(same, sample.length - same) / sample.length;
      if (score > 0.05 && (!best || score > best.score)) best = { q, score };
    }
  }
  return best;
}

function maybeAsk() {
  const s = game.state;
  if (s.cooldown > 0 || s.challenge || s.pending) {
    s.botAskWait = null;
    return;
  }
  // Round robin: only the bot whose turn it is asks, after a short "thinking" pause.
  const turn = game.currentAsker();
  const mine = seekerBots().find(([id]) => id === turn);
  if (!mine) {
    s.botAskWait = null;
    return;
  }
  if (s.botAskWait == null) s.botAskWait = 3;
  if (--s.botAskWait > 0) return;
  s.botAskWait = null;

  const [id, b] = mine;
  const pts = candidates();
  const pick = pts.length >= 4 ? bestQuestion(b, pts) : undefined;
  if (!pick) {
    // Nothing useful to ask from here: pass the turn on.
    game.broadcast(`§7${game.nameOf(id)} passed their turn to ask.`);
    game.advanceAsker();
    return;
  }
  game.askAs(
    { name: game.nameOf(id), location: { x: b.x, y: b.y ?? s.center.y, z: b.z }, dimension: dim() },
    pick.q.id
  );
}

// ---------------------------------------------------------------------------
// Seeker bots: moving and looking
// ---------------------------------------------------------------------------

/** Distance to the nearest thing that keeps chunks loaded: a person, or a bot hider's ticking area. */
function anchorDistance(b) {
  const s = game.state;
  let best = Infinity;
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id === s.dimId) best = Math.min(best, hyp(p.location.x - b.x, p.location.z - b.z));
  }
  if (s.spot && isBotId(game.hiderId())) best = Math.min(best, hyp(s.spot.x - b.x, s.spot.z - b.z));
  return best;
}

/** Spawns or despawns the bot's entity depending on whether anyone is near. Returns the live entity, if any. */
function syncPresence(id, b) {
  let e = liveEntity(b.entityId);
  const dist = anchorDistance(b);
  if (e) {
    if (dist > CONFIG.botActiveRange + 16) {
      try {
        e.remove();
      } catch {}
      b.entityId = null;
      b.y = null;
      return undefined;
    }
    return e;
  }
  b.entityId = null;
  if (dist > CONFIG.botActiveRange) return undefined;
  // Ground near the last known height, or else the surface (e.g. the start point was moved somewhere new).
  const y = groundY(dim(), b.x, b.z, b.y) ?? (b.y != null ? groundY(dim(), b.x, b.z, null) : undefined);
  if (y === undefined) return undefined;
  b.y = y;
  try {
    e = spawnBot(id, { x: b.x, y, z: b.z }, b.look ?? 0, game.nameOf(id));
    b.entityId = e.id;
  } catch {
    return undefined;
  }
  return e;
}

function yawOf(dx, dz) {
  return (Math.atan2(-dx, dz) * 180) / Math.PI;
}

function detour(b) {
  const a = Math.random() * Math.PI * 2;
  const p = { x: b.x + Math.cos(a) * 8, z: b.z + Math.sin(a) * 8, detour: true };
  return inArea(p) ? p : { x: game.state.center.x, z: game.state.center.z, detour: true };
}

/** Off-screen movement: a straight line toward the target, once per second. */
function stepVirtual(b) {
  if (!b.target) chooseTarget(b);
  if (!b.target) return;
  const dx = b.target.x - b.x;
  const dz = b.target.z - b.z;
  const dist = hyp(dx, dz);
  b.y = null;
  b.look = yawOf(dx, dz);
  if (dist <= CONFIG.botWalkSpeed) {
    b.x = b.target.x;
    b.z = b.target.z;
    return reached(b, false);
  }
  b.x += (dx / dist) * CONFIG.botWalkSpeed;
  b.z += (dz / dist) * CONFIG.botWalkSpeed;
}

/** In-world movement, 5 times per second: walks over terrain, steps up 1 block, drops up to 4. */
function stepPhysical(b, e, d) {
  if (b.pause > 0) {
    b.pause -= DT;
    b.look = (b.look + 90 * DT) % 360;
    try {
      e.setRotation({ x: 0, y: b.look });
    } catch {}
    return;
  }
  if (!b.target) chooseTarget(b);
  if (!b.target) return;
  const dx = b.target.x - b.x;
  const dz = b.target.z - b.z;
  const dist = hyp(dx, dz);
  if (dist < 1.5) return reached(b, true);

  const step = Math.min(dist, CONFIG.botWalkSpeed * DT);
  const nx = b.x + (dx / dist) * step;
  const nz = b.z + (dz / dist) * step;
  const ny = scanDown(d, Math.floor(nx), Math.floor(nz), Math.floor(b.y) + 1, 6, false);
  if (ny === undefined) {
    if (++b.stuck >= 3) {
      b.target = detour(b);
      b.stuck = 0;
    }
    return;
  }
  b.stuck = 0;
  b.x = nx;
  b.y = ny;
  b.z = nz;
  b.t = (b.t ?? 0) + DT;
  b.look = yawOf(dx, dz) + Math.sin(b.t * 1.5) * 40; // glance side to side while walking
  try {
    e.teleport({ x: nx, y: ny, z: nz }, { rotation: { x: 0, y: b.look } });
  } catch {}
}

/** True if the bot can see the target (in view, in range, nothing solid between) or is touching it. */
function sees(b, target) {
  const s = game.state;
  if (b.y == null || target.dimension?.id !== s.dimId) return false;
  const t = target.location;
  const dx = t.x - b.x;
  const dz = t.z - b.z;
  const flat = hyp(dx, dz);
  if (flat <= CONFIG.botTouchRange && Math.abs(t.y - b.y) <= 2.5) return true;
  // A disguised hider looks like any other mob or block: bots have to walk up and poke it.
  if (s.disguise?.applied) return false;

  if (flat > 0.01) {
    const yaw = (b.look * Math.PI) / 180;
    const dot = (dx * -Math.sin(yaw) + dz * Math.cos(yaw)) / flat;
    if (dot < Math.cos((CONFIG.botFov * Math.PI) / 180)) return false;
  }
  const eye = { x: b.x, y: b.y + 1.62, z: b.z };
  const d = dim();
  for (const h of [1.5, 0.9]) {
    const dy = t.y + h - eye.y;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > CONFIG.spotDistance) return false;
    let hit;
    try {
      hit = d.getBlockFromRay(eye, { x: dx / dist, y: dy / dist, z: dz / dist }, {
        maxDistance: dist,
        includeLiquidBlocks: false,
        includePassableBlocks: false,
      });
    } catch {
      continue;
    }
    if (!hit) return true;
  }
  return false;
}

/** Seeker bot positions ({ x, z }) for the minimap. */
export function seekerPositions() {
  return seekerBots().map(([, b]) => b);
}

/** Seeker bots with names, for the hider's radar and teleporting to a bot. */
export function seekerList() {
  return seekerBots().map(([id, b]) => ({ id, name: game.nameOf(id), x: b.x, z: b.z }));
}

/** Distance from a location to the nearest seeker bot (for the hider's HUD). */
export function nearestSeekerDistance(loc) {
  let best;
  for (const [, b] of seekerBots()) {
    const d = hyp(b.x - loc.x, b.z - loc.z);
    if (best === undefined || d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Ticks (called from game.js)
// ---------------------------------------------------------------------------

/** Once per second during hiding/seeking (not while paused). */
export function tickSecond() {
  const s = game.state;
  for (const [id, b] of seekerBots()) {
    const e = syncPresence(id, b);
    if (s.phase === "hiding") {
      if (e) {
        b.look = ((b.look ?? 0) + 25) % 360;
        try {
          e.setRotation({ x: 0, y: b.look });
        } catch {}
      }
    } else if (!e) {
      stepVirtual(b);
    }
  }
  if (s.phase === "seeking") maybeAsk();
}

/** 5 times per second during seeking: walk and look for the hider. */
export function tickFast(target) {
  const s = game.state;
  const d = dim();
  for (const [id, b] of seekerBots()) {
    if (s.phase !== "seeking") return;
    const e = liveEntity(b.entityId);
    if (!e) continue;
    stepPhysical(b, e, d);
    if (target && sees(b, target)) {
      if (++b.sight >= CONFIG.botSightChecks) return game.found({ name: game.nameOf(id) });
    } else {
      b.sight = 0;
    }
  }
}
