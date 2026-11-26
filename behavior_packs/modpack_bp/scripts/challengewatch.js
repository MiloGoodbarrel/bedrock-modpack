// Detects when a seeker completes the active challenge, crediting the seeker who actually did it wherever the
// stable API allows:
//   bred / hatched / golem / tnt: the mob or TNT must appear near where a seeker just fed chickens, threw an
//                                 egg, placed the golem's pumpkin, or lit TNT
//   bonemeal / turnsInto / portal: the block a seeker used an item on must actually change (plant grew,
//                                 dirt became mud, a portal appeared)
//   fall / toolBreak:             tracked per seeker (trackers.js)
//   dye:                          a seeker uses a dye on a sheep / cat / wolf, or on a sign
//   mined:                        a seeker breaks one of the listed blocks (diamond ore)
//   effect / boat / tame / bedrock: checked on each seeker every second (poisoned, in a boat with a mob,
//                                 has tamed an animal that wasn't tamed before, standing on bedrock)
//   items:                        an inventory count going up (can't be attributed: chests or teammates count)
import { world, system } from "@minecraft/server";
import { itemCount } from "./challenges.js";
import { fallStep, toolBroke } from "./trackers.js";
import * as game from "./game.js";
import * as powerups from "./powerups.js";

const DYE = /_dye$|^minecraft:(ink_sac|glow_ink_sac|cocoa_beans|lapis_lazuli|bone_meal)$/;
const DYEABLE_MOBS = new Set(["minecraft:sheep", "minecraft:cat", "minecraft:wolf"]);
const TAMEABLE_AGE = 20 * 20; // an animal a seeker interacted with is watched this long for becoming tamed
const IGNITERS = new Set(["minecraft:flint_and_steel", "minecraft:fire_charge"]);
const PUMPKINS = new Set(["minecraft:carved_pumpkin", "minecraft:lit_pumpkin"]);

const recent = new Map(); // player id -> { fed, egg, pumpkin, ignite: { tick, loc, dim } }
const snapshots = new Map(); // player id -> { loc, dim, before } taken just before using an item on a block
let falls = new Map();
let tools = new Map();
let tameWatch = new Map(); // entity id -> { player id, until tick, wasTamed }
let watching = ""; // challenge id the trackers were reset for

function active() {
  const ch = powerups.activeChallenge();
  const key = ch ? `${game.roundKey()}:${ch.id}` : "";
  if (key !== watching) {
    watching = key;
    falls = new Map();
    tools = new Map();
    tameWatch = new Map();
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
  if (ch.detect === "bred" && cause === "Born") who = whoDid("fed", loc, dimId, 90 * 20, 16); // any animal
  else if (ch.detect === "hatched" && entity.typeId === "minecraft:chicken" && cause !== "Born" && isBaby(entity))
    who = whoDid("egg", loc, dimId, 10 * 20, 32);
  else if (ch.detect === "golem" && (entity.typeId === "minecraft:iron_golem" || entity.typeId === "minecraft:snow_golem"))
    who = whoDid("pumpkin", loc, dimId, 5 * 20, 6);
  else if (ch.detect === "tnt" && entity.typeId === "minecraft:tnt") who = whoDid("ignite", loc, dimId, 5 * 20, 4);
  if (who) complete(who.name);
}

export function onPlace(player, block) {
  if (!game.isSeeker(player) || !PUMPKINS.has(block?.typeId)) return;
  note(player, "pumpkin", block.location);
}

export function onInteractEntity(player, target, item) {
  if (!game.isSeeker(player) || !target) return;
  const ch = active();
  // Feeding any animal (holding an item while interacting): a baby born nearby soon after counts as bred.
  if (item) note(player, "fed", target.location);
  if (ch?.detect === "dye" && DYE.test(item?.typeId ?? "") && DYEABLE_MOBS.has(target.typeId)) return complete(player.name);
  // Taming takes a few tries (or riding, for horses): watch this animal for a while.
  if (ch?.detect === "tame") {
    let tamed = false;
    try {
      tamed = !!target.getComponent("minecraft:tameable")?.isTamed;
    } catch {}
    if (!tameWatch.has(target.id)) tameWatch.set(target.id, { player: player.id, wasTamed: tamed });
    tameWatch.get(target.id).until = system.currentTick + TAMEABLE_AGE;
  }
}

/** A seeker broke a block (mine diamonds). */
export function onBreak(player, brokenPermutation) {
  const ch = active();
  if (!ch || ch.detect !== "mined" || !game.isSeeker(player)) return;
  let type;
  try {
    type = brokenPermutation?.type?.id;
  } catch {}
  if (ch.blocks.includes(type)) complete(player.name);
}

export function onItemUse(player, item) {
  if (game.isSeeker(player) && item?.typeId === "minecraft:egg") note(player, "egg", player.location);
}

/** Before an item is used on a block: remember what the block (and the one above it) looked like. */
export function beforeUseOnBlock(player, block, item) {
  const ch = active();
  if (!ch || !game.isSeeker(player) || !block) return;
  if (ch.detect === "tnt" && block.typeId === "minecraft:tnt" && IGNITERS.has(item?.typeId)) note(player, "ignite", block.location);
  if (ch.detect === "dye" && /sign/.test(block.typeId) && DYE.test(item?.typeId ?? "")) {
    system.run(() => complete(player.name)); // dyeing a sign's text
    return;
  }
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
  if (!ch || !s.challenge) return;
  for (const p of world.getAllPlayers()) {
    if (!game.isSeeker(p)) continue;
    try {
      if (ch.detect === "items") {
        const have = itemCount(p, ch.items);
        if (s.challenge.baseline[p.id] === undefined) s.challenge.baseline[p.id] = have;
        else if (have > s.challenge.baseline[p.id]) return complete(p.name);
      } else if (ch.detect === "effect") {
        if (p.getEffect(ch.effect)) return complete(p.name);
      } else if (ch.detect === "bedrock") {
        const l = p.location;
        const under = p.dimension.getBlock({ x: Math.floor(l.x), y: Math.floor(l.y - 0.01), z: Math.floor(l.z) });
        if (under?.typeId === "minecraft:bedrock") return complete(p.name);
      } else if (ch.detect === "boat") {
        const boat = p.getComponent("minecraft:riding")?.entityRidingOn;
        if (boat && /boat/.test(boat.typeId)) {
          const riders = boat.getComponent("minecraft:rideable")?.getRiders() ?? [];
          if (riders.some((r) => r.typeId !== "minecraft:player")) return complete(p.name);
        }
      } else if (ch.detect === "tame") {
        // Horses and the like are tamed by riding them: watch whatever the seeker is riding too.
        const mount = p.getComponent("minecraft:riding")?.entityRidingOn;
        if (mount?.getComponent("minecraft:tameable") && !tameWatch.has(mount.id)) {
          tameWatch.set(mount.id, { player: p.id, wasTamed: !!mount.getComponent("minecraft:tameable").isTamed });
        }
        if (mount && tameWatch.has(mount.id)) tameWatch.get(mount.id).until = system.currentTick + TAMEABLE_AGE;
      }
    } catch {}
  }
  if (ch.detect === "tame") {
    // An animal a seeker was working on is now tamed to that seeker, and wasn't before.
    for (const [id, w] of tameWatch) {
      if (system.currentTick > w.until) {
        tameWatch.delete(id);
        continue;
      }
      try {
        const e = world.getEntity(id);
        const t = e?.getComponent("minecraft:tameable");
        if (t?.isTamed && !w.wasTamed && t.tamedToPlayerId === w.player) {
          const p = world.getAllPlayers().find((pl) => pl.id === w.player);
          return complete(p?.name ?? "A seeker");
        }
      } catch {}
    }
  }
}
