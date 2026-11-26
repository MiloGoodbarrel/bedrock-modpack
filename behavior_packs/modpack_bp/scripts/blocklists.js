// Block lists (pure, no Minecraft imports, so they can be tested outside the game).

// Blocks a survival player can't break, so a hider building a spot (in Creative) may not use them: a hideout
// made of these could never be broken into. Also never allowed as a block disguise or a task block.
const UNBREAKABLE = new Set([
  "minecraft:bedrock",
  "minecraft:invisible_bedrock",
  "minecraft:barrier",
  "minecraft:border_block",
  "minecraft:allow",
  "minecraft:deny",
  "minecraft:end_portal_frame",
  "minecraft:end_portal",
  "minecraft:end_gateway",
  "minecraft:portal",
  "minecraft:command_block",
  "minecraft:chain_command_block",
  "minecraft:repeating_command_block",
  "minecraft:structure_block",
  "minecraft:structure_void",
  "minecraft:jigsaw",
  "minecraft:light_block",
  "minecraft:moving_block",
  "minecraft:reinforced_deepslate",
  "minecraft:trial_spawner",
  "minecraft:vault",
]);

// Approximate light each block gives off (0-15), for the "in light from a block?" question.
const LIGHT = new Map([
  ["minecraft:torch", 14], ["minecraft:wall_torch", 14], ["minecraft:soul_torch", 10], ["minecraft:redstone_torch", 7],
  ["minecraft:lantern", 15], ["minecraft:soul_lantern", 10], ["minecraft:glowstone", 15], ["minecraft:sea_lantern", 15],
  ["minecraft:shroomlight", 15], ["minecraft:lit_pumpkin", 15], ["minecraft:campfire", 15], ["minecraft:soul_campfire", 10],
  ["minecraft:lit_redstone_lamp", 15], ["minecraft:end_rod", 14], ["minecraft:lava", 15], ["minecraft:flowing_lava", 15],
  ["minecraft:fire", 15], ["minecraft:soul_fire", 10], ["minecraft:beacon", 15], ["minecraft:conduit", 15],
  ["minecraft:ochre_froglight", 15], ["minecraft:verdant_froglight", 15], ["minecraft:pearlescent_froglight", 15],
  ["minecraft:lit_furnace", 13], ["minecraft:lit_smoker", 13], ["minecraft:lit_blast_furnace", 13],
  ["minecraft:glow_lichen", 7], ["minecraft:magma", 3], ["minecraft:crying_obsidian", 10], ["minecraft:jack_o_lantern", 15],
  ["minecraft:respawn_anchor", 15], ["minecraft:copper_lantern", 15], ["minecraft:copper_torch", 14],
]);

/** How much light a block gives off (0 for most blocks). */
export function lightLevel(typeId) {
  return LIGHT.get(typeId) ?? 0;
}

/** True for blocks (or their items) that survival players can't break. */
export function isUnbreakable(typeId) {
  if (!typeId) return false;
  return UNBREAKABLE.has(typeId) || /^minecraft:light_block_\d+$/.test(typeId) || /command_block$/.test(typeId);
}
