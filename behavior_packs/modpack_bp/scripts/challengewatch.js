// Detects when a seeker completes the active challenge, crediting the seeker who actually did it wherever the
// stable API allows:
//   bred / hatched / golem / tnt: the mob or TNT must appear near where a seeker just fed chickens, threw an
//                                 egg, placed the golem's pumpkin, or lit TNT
//   bonemeal / turnsInto / portal: the block a seeker used an item on must actually change (plant grew,
//                                 dirt became mud, a portal appeared)
//   fall / toolBreak:             tracked per seeker (trackers.js)
//   items:                        an inventory count going up (can't be attributed: chests or teammates count)
import { world, system } from "@minecraft/server";
import { itemCount } from "./challenges.js";
import { fallStep, toolBroke } from "./trackers.js";
import * as game from "./game.js";
import * as powerups from "./powerups.js";

const SEEDS = new Set([
  "minecraft:wheat_seeds",
  "minecraft:beetroot_seeds",
  "minecraft:melon_seeds",
  "minecraft:pumpkin_seeds",
  "minecraft:torchflower_seeds",
  "minecraft:pitcher_pod",
]);
const IGNITERS = new Set(["minecraft:flint_and_steel", "minecraft:fire_charge"]);
const PUMPKINS = new Set(["minecraft:carved_pumpkin", "minecraft:lit_pumpkin"]);

const recent = new Map(); // player id -> { fed, egg, pumpkin, ignite: { tick, loc, dim } }
const snapshots = new Map(); // player id -> { loc, dim, before } taken just before using an item on a block
let falls = new Map();
let tools = new Map();
let watching = ""; // challenge id the trackers were reset for

function active() {
  const ch = powerups.activeChallenge();
  const key = ch ? `${game.roundKey()}:${ch.id}` : "";
  if (key !== watching) {
    watching = key;
    falls = new Map();
    tools = new Map();
    recent.clear();
    snapshots.clear();
  }
  return ch;
}

function complete(name) {
  powerups.completeChallenge(name);
}

function note(player, kind, loc) {
  const r = recent.get(player.id) ?? {};
  r[kind] = { tick: system.currentTick, loc: { ...loc }, dim: player.dimension.id };
  recent.set(player.id, r);
}

/** The seeker who did `kind` within `ticks` and `dist` blocks of loc, if any. */
function whoDid(kind, loc, dimId, ticks, dist) {
  for (const p of world.getAllPlayers()) {
    if (!game.isSeeker(p)) continue;
    const r = recent.get(p.id)?.[kind];
    if (!r || r.dim !== dimId || system.currentTick - r.tick > ticks) continue;
    if (Math.hypot(r.loc.x - loc.x, r.loc.y - loc.y, r.loc.z - loc.z) <= dist) return p;
  }
  return undefined;
}

function stateOf(block) {
  if (!block) return "";
  let states = {};
  try {
    states = block.permutation.getAllStates();
  } catch {}
  return `${block.typeId}${JSON.stringify(states)}`;
}

function isBaby(e) {
  try {
    return !!e.getComponent("minecraft:is_baby");
  } catch {
    return false;
  }
}

// --- Events (wired in main.js) ---------------------------------------------------

export function onSpawn(entity, cause) {
  const ch = active();
  if (!ch) return;
  let loc;
  let dimId;
  try {
    loc = entity.location;
    dimId = entity.dimension.id;
  } catch {
    return;
  }
  let who;
  if (ch.detect === "bred" && entity.typeId === ch.mob && cause === "Born") who = whoDid("fed", loc, dimId, 90 * 20, 16);
  else if (ch.detect === "hatched" && entity.typeId === "minecraft:chicken" && cause !== "Born" && isBaby(entity))
    who = whoDid("egg", loc, dimId, 10 * 20, 32);
  else if (ch.detect === "golem" && entity.typeId === "minecraft:iron_golem") who = whoDid("pumpkin", loc, dimId, 5 * 20, 6);
  else if (ch.detect === "tnt" && entity.typeId === "minecraft:tnt") who = whoDid("ignite", loc, dimId, 5 * 20, 4);
  if (who) complete(who.name);
}

export function onPlace(player, block) {
  if (!game.isSeeker(player) || !PUMPKINS.has(block?.typeId)) return;
  note(player, "pumpkin", block.location);
}

export function onInteractEntity(player, target, item) {
  if (!game.isSeeker(player) || !target) return;
  if (target.typeId === "minecraft:chicken" && SEEDS.has(item?.typeId)) note(player, "fed", target.location);
}

export function onItemUse(player, item) {
  if (game.isSeeker(player) && item?.typeId === "minecraft:egg") note(player, "egg", player.location);
}

/** Before an item is used on a block: remember what the block (and the one above it) looked like. */
export function beforeUseOnBlock(player, block, item) {
  const ch = active();
  if (!ch || !game.isSeeker(player) || !block) return;
  if (ch.detect === "tnt" && block.typeId === "minecraft:tnt" && IGNITERS.has(item?.typeId)) note(player, "ignite", block.location);
  if (ch.detect === "bonemeal" || ch.detect === "turnsInto") {
    let above;
    try {
      above = block.above();
    } catch {}
    snapshots.set(player.id, { loc: { ...block.location }, dim: block.dimension, before: stateOf(block) + stateOf(above) });
  }
}

/** After an item is used on a block: check a moment later whether it really did something. */
export function onUseOnBlock(player, block, item) {
  const ch = active();
  if (!ch || !game.isSeeker(player) || !block) return;
  const loc = { ...block.location };
  const dim = block.dimension;
  const snap = snapshots.get(player.id);
  snapshots.delete(player.id);
  const check = (fn) =>
    system.runTimeout(() => {
      try {
        if (active() === ch && fn()) complete(player.name);
      } catch {}
    }, 2);

  if (ch.detect === "bonemeal" && item?.typeId === "minecraft:bone_meal" && snap) {
    check(() => {
      const b = dim.getBlock(snap.loc);
      return stateOf(b) + stateOf(b?.above()) !== snap.before; // the plant grew (or grass sprouted)
    });
  } else if (ch.detect === "turnsInto" && snap) {
    check(() => dim.getBlock(snap.loc)?.typeId === ch.into && !snap.before.startsWith(ch.into));
  } else if (ch.detect === "portal" && IGNITERS.has(item?.typeId)) {
    check(() => {
      for (let dx = -3; dx <= 3; dx++)
        for (let dy = -1; dy <= 4; dy++)
          for (let dz = -3; dz <= 3; dz++)
            if (dim.getBlock({ x: loc.x + dx, y: loc.y + dy, z: loc.z + dz })?.typeId === "minecraft:portal") return true;
      return false;
    });
  }
}

// --- Ticks -------------------------------------------------------------------------

/** A few times a second: falls and tool breaks. */
export function tickFast() {
  const ch = active();
  if (!ch || (ch.detect !== "fall" && ch.detect !== "toolBreak")) return;
  for (const p of world.getAllPlayers()) {
    if (!game.isSeeker(p)) continue;
    if (ch.detect === "fall") {
      const l = p.location;
      let alive = true;
      try {
        alive = (p.getComponent("minecraft:health")?.currentValue ?? 1) > 0;
      } catch {}
      const sample = { x: l.x, y: l.y, z: l.z, grounded: p.isOnGround || p.isInWater, alive };
      const r = fallStep(falls.get(p.id), sample);
      falls.set(p.id, r.track);
      if (r.landed) {
        // Confirm a second later that they really survived the landing.
        system.runTimeout(() => {
          try {
            if (active() === ch && p.isValid && (p.getComponent("minecraft:health")?.currentValue ?? 0) > 0) complete(p.name);
          } catch {}
        }, 20);
      }
    } else {
      let now = { slot: -1 };
      try {
        const slot = p.selectedSlotIndex;
        const item = p.getComponent("minecraft:inventory")?.container?.getItem(slot);
        const dur = item?.getComponent("minecraft:durability");
        now = { slot, type: item?.typeId, remaining: dur ? dur.maxDurability - dur.damage : undefined };
      } catch {}
      if (toolBroke(tools.get(p.id), now)) return complete(p.name);
      tools.set(p.id, now);
    }
  }
}

/** Once a second: inventory-count challenges (fish, bread). */
export function tickSecond() {
  const ch = active();
  const s = game.state;
  if (!ch || ch.detect !== "items" || !s.challenge) return;
  for (const p of world.getAllPlayers()) {
    if (!game.isSeeker(p)) continue;
    const have = itemCount(p, ch.items);
    if (s.challenge.baseline[p.id] === undefined) s.challenge.baseline[p.id] = have;
    else if (have > s.challenge.baseline[p.id]) return complete(p.name);
  }
}
