// Morph (disguise) helpers shared by people and bots.
//
// - Mob morph: the hider turns invisible and can't walk; a real mob (the "decoy", tagged hs_decoy) is pinned to
//   them and copies where they look. Hitting the decoy finds the hider. Other mobs of the same kind are fair
//   game for confusion.
// - Block morph: the chosen block is placed where the hider stands and the hider watches from inside it in
//   Spectator. Hitting or breaking that block finds the hider.
import * as mc from "@minecraft/server";
import { isUnbreakable } from "./blocklists.js";

const { world, BlockPermutation } = mc;

export const DECOY_TAG = "hs_decoy";
const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];

// Mobs a hider can become. Kept to passive mobs that seekers can't ride (horse, llama) and that don't ram or
// knock players around (goat), so the decoy can't affect the game by itself. Expand only after testing in game.
export const MOBS = [
  ["minecraft:pig", "Pig"],
  ["minecraft:cow", "Cow"],
  ["minecraft:sheep", "Sheep"],
  ["minecraft:chicken", "Chicken"],
  ["minecraft:rabbit", "Rabbit"],
  ["minecraft:villager_v2", "Villager"],
  ["minecraft:cat", "Cat"],
  ["minecraft:fox", "Fox"],
  ["minecraft:wolf", "Wolf"],
  ["minecraft:panda", "Panda"],
  ["minecraft:frog", "Frog"],
  ["minecraft:armadillo", "Armadillo"],
];

// Put on a player while a morph changes them (invisibility, Spectator, movement lock), so the change can be
// undone even if they log off and the game ends or resets before they come back.
export const MORPH_TAG = "hs_morphed";

export const BLOCKS = [
  ["minecraft:stone", "Stone"],
  ["minecraft:cobblestone", "Cobblestone"],
  ["minecraft:dirt", "Dirt"],
  ["minecraft:grass_block", "Grass Block"],
  ["minecraft:sand", "Sand"],
  ["minecraft:gravel", "Gravel"],
  ["minecraft:oak_log", "Oak Log"],
  ["minecraft:oak_leaves", "Oak Leaves"],
  ["minecraft:oak_planks", "Oak Planks"],
  ["minecraft:moss_block", "Moss Block"],
  ["minecraft:hay_block", "Hay Bale"],
  ["minecraft:pumpkin", "Pumpkin"],
  ["minecraft:melon_block", "Melon"],
  ["minecraft:coal_ore", "Coal Ore"],
  ["minecraft:bookshelf", "Bookshelf"],
  ["minecraft:crafting_table", "Crafting Table"],
];

export function prettyId(id) {
  const known = [...MOBS, ...BLOCKS].find(([x]) => x === id);
  if (known) return known[1];
  return (id ?? "").replace(/^minecraft:/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function blockPermutation(typeId) {
  try {
    return BlockPermutation.resolve(typeId);
  } catch {
    return undefined;
  }
}

/** The block the player is holding, if it can be placed as a disguise (never an unbreakable one). */
export function heldBlock(player) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    const item = inv?.getItem(player.selectedSlotIndex);
    if (item && !isUnbreakable(item.typeId) && blockPermutation(item.typeId)) return item.typeId;
  } catch {}
  return undefined;
}

function floorLoc(loc) {
  return { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) };
}

/** Type ids of the 6 blocks touching the block at loc (the hider's feet). */
export function neighbourTypes(dimension, loc) {
  const b = floorLoc(loc);
  const out = [];
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    try {
      const block = dimension.getBlock({ x: b.x + dx, y: b.y + dy, z: b.z + dz });
      if (block) out.push(block.typeId);
    } catch {}
  }
  return out;
}

export function liveEntity(id) {
  if (!id) return undefined;
  try {
    const e = world.getEntity(id);
    return e?.isValid ? e : undefined;
  } catch {
    return undefined;
  }
}

export function spawnDecoy(dimension, type, loc, yaw = 0) {
  const e = dimension.spawnEntity(type, loc);
  try {
    e.addTag(DECOY_TAG);
  } catch {}
  try {
    e.addEffect("resistance", 20000000, { amplifier: 255, showParticles: false });
  } catch {}
  try {
    e.setRotation({ x: 0, y: yaw });
  } catch {}
  return e;
}

export function removeDecoys(keepId) {
  for (const id of DIMENSIONS) {
    try {
      for (const e of world.getDimension(id).getEntities({ tags: [DECOY_TAG] })) {
        if (e.id !== keepId) e.remove();
      }
    } catch {}
  }
}

// What a disguise block may replace: open space, water, and small plants / snow layers. Never lava, and never
// anything solid someone built or placed.
const HOLDABLE = /(short_grass|tall_grass|fern|flower|tulip|dandelion|poppy|orchid|allium|bluet|daisy|bush|sapling|snow_layer|petals|leaf_litter|wildflowers)/;

function holds(block) {
  if (!block) return false;
  if (block.isAir) return true;
  if (block.typeId === "minecraft:lava" || block.typeId === "minecraft:flowing_lava") return false;
  return block.isLiquid || HOLDABLE.test(block.typeId);
}

/** True if a disguise block can go where the hider's feet are (nothing solid there). */
export function roomForBlock(dimension, loc) {
  try {
    return holds(dimension.getBlock(floorLoc(loc)));
  } catch {
    return false;
  }
}

/**
 * Places the disguise block at the hider's feet. Returns a snapshot of what was there before (for restoring),
 * or undefined if it couldn't be placed (nothing is changed then).
 */
export function placeBlock(dimension, loc, typeId) {
  const perm = blockPermutation(typeId);
  if (!perm) return undefined;
  try {
    const block = dimension.getBlock(floorLoc(loc));
    if (!holds(block)) return undefined;
    let states = {};
    try {
      states = block.permutation.getAllStates();
    } catch {}
    const original = { type: block.typeId, states };
    block.setPermutation(perm);
    return block.typeId === typeId ? original : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Puts back what was there before the disguise block, but only if the disguise block is still there (if
 * someone already broke or replaced it, their change is left alone).
 */
export function clearBlock(dimension, loc, typeId, original) {
  try {
    const block = dimension.getBlock(floorLoc(loc));
    if (!block || block.typeId !== typeId) return;
    let perm;
    try {
      if (original?.type) perm = BlockPermutation.resolve(original.type, original.states ?? {});
    } catch {
      try {
        perm = BlockPermutation.resolve(original.type);
      } catch {}
    }
    if (perm) block.setPermutation(perm);
    else block.setType("minecraft:air");
  } catch {}
}

/** Locks or unlocks walking (looking around still works). Falls back to the leash if unsupported. */
export function setMovement(player, allowed) {
  try {
    const category = mc.InputPermissionCategory?.Movement;
    if (category !== undefined) player.inputPermissions.setPermissionCategory(category, allowed);
  } catch {}
}

/**
 * Makes sure an invisible hider isn't holding anything (it would float in the air): selects an empty hotbar
 * slot, or moves the held item into the main inventory if the hotbar is full. Returns true if the hand is
 * empty afterwards.
 */
export function emptyHands(player) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;
    if (!inv.getItem(player.selectedSlotIndex)) return true;
    for (let i = 0; i < 9; i++) {
      if (!inv.getItem(i)) {
        player.selectedSlotIndex = i;
        return true;
      }
    }
    for (let i = 9; i < inv.size; i++) {
      if (!inv.getItem(i)) {
        inv.moveItem(player.selectedSlotIndex, i, inv);
        return true;
      }
    }
  } catch {}
  return false;
}

const WORN = ["Head", "Chest", "Legs", "Feet", "Offhand"];

/**
 * Invisible players still show their armor and off-hand item. Moves anything worn (and the off-hand item,
 * e.g. a map) into the inventory. Items only move if there's room, so nothing gets dropped on the ground
 * next to the hider. Returns the slots that still have something in them.
 */
export function stripVisibleGear(player) {
  const left = [];
  try {
    const eq = player.getComponent("minecraft:equippable");
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!eq || !inv) return left;
    for (const slot of WORN) {
      const item = eq.getEquipment(slot);
      if (!item) continue;
      if (inv.emptySlotsCount > 0) {
        inv.addItem(item);
        eq.setEquipment(slot, undefined);
      } else {
        left.push(slot);
      }
    }
  } catch {}
  return left;
}

/** True if the player is wearing or holding something that would float while they're invisible. */
export function showsGear(player) {
  try {
    const eq = player.getComponent("minecraft:equippable");
    if (WORN.some((slot) => !!eq?.getEquipment(slot))) return true;
    const inv = player.getComponent("minecraft:inventory")?.container;
    return !!inv?.getItem(player.selectedSlotIndex);
  } catch {
    return false;
  }
}
