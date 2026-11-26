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

/** True for blocks (or their items) that survival players can't break. */
export function isUnbreakable(typeId) {
  if (!typeId) return false;
  return UNBREAKABLE.has(typeId) || /^minecraft:light_block_\d+$/.test(typeId) || /command_block$/.test(typeId);
}
