// Morph (disguise) helpers shared by people and bots.
//
// - Mob morph: the hider turns invisible and can't walk; a real mob (the "decoy", tagged hs_decoy) is pinned to
//   them and copies where they look. Hitting the decoy finds the hider. Other mobs of the same kind are fair
//   game for confusion.
// - Block morph: the chosen block is placed where the hider stands and the hider watches from inside it in
//   Spectator. Hitting or breaking that block finds the hider.
import * as mc from "@minecraft/server";

const { world, BlockPermutation } = mc;

export const DECOY_TAG = "hs_decoy";
const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];

export const MOBS = [
  ["minecraft:pig", "Pig"],
  ["minecraft:cow", "Cow"],
  ["minecraft:sheep", "Sheep"],
  ["minecraft:chicken", "Chicken"],
  ["minecraft:rabbit", "Rabbit"],
  ["minecraft:goat", "Goat"],
  ["minecraft:horse", "Horse"],
  ["minecraft:villager_v2", "Villager"],
  ["minecraft:cat", "Cat"],
  ["minecraft:fox", "Fox"],
  ["minecraft:wolf", "Wolf"],
  ["minecraft:llama", "Llama"],
  ["minecraft:panda", "Panda"],
  ["minecraft:frog", "Frog"],
  ["minecraft:armadillo", "Armadillo"],
];

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

/** The block the player is holding, if it can be placed as a disguise. */
export function heldBlock(player) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    const item = inv?.getItem(player.selectedSlotIndex);
    if (item && blockPermutation(item.typeId)) return item.typeId;
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

/** Places the disguise block at the hider's feet. */
export function placeBlock(dimension, loc, typeId) {
  const perm = blockPermutation(typeId);
  if (!perm) return false;
  try {
    dimension.getBlock(floorLoc(loc))?.setPermutation(perm);
    return true;
  } catch {
    return false;
  }
}

/** Removes the disguise block, if it's still there. */
export function clearBlock(dimension, loc, typeId) {
  try {
    const block = dimension.getBlock(floorLoc(loc));
    if (block && block.typeId === typeId) block.setType("minecraft:air");
  } catch {}
}

/** Locks or unlocks walking (looking around still works). Falls back to the leash if unsupported. */
export function setMovement(player, allowed) {
  try {
    const category = mc.InputPermissionCategory?.Movement;
    if (category !== undefined) player.inputPermissions.setPermissionCategory(category, allowed);
  } catch {}
}

/** Selects an empty hotbar slot so an invisible hider isn't holding a floating item. */
export function emptyHands(player) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return;
    for (let i = 0; i < 9; i++) {
      if (!inv.getItem(i)) {
        player.selectedSlotIndex = i;
        return;
      }
    }
  } catch {}
}
