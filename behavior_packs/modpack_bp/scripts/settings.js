// Game-mode settings chosen by the admin (world operator) in the lobby. Saved with the world and copied into
// the game state when a game starts, so changing them never affects a game in progress.
import { world } from "@minecraft/server";

const KEY = "hs:settings";

export const MORPH_TYPES = [
  ["mob", "Mobs"],
  ["block", "Blocks"],
  ["both", "Mobs or blocks (hider picks)"],
];
// 0 = no limit
export const HEIGHT_LIMITS = [0, 80, 100, 120, 160, 200];

// What fills the ruled-out area in the sky (so it shows dark on real maps): [id, label, block, states, fallback].
// Top slabs sit in the upper half of the block and let light through; wool slabs show on maps in wool's color.
export const FILL_MODES = [
  ["wool_slab", "Black wool top slabs", "minecraft:black_wool_slab", { "minecraft:vertical_half": "top" }, "minecraft:black_wool"],
  ["off", "Off (outline only)"],
  ["glass", "Black stained glass", "minecraft:black_stained_glass"],
  ["slab", "Blackstone slabs", "minecraft:blackstone_slab"],
];

/** { type, states, fallback } for a fill mode, or undefined when it's off. */
export function fillBlock(mode) {
  const m = FILL_MODES.find(([id]) => id === mode);
  return m?.[2] ? { type: m[2], states: m[3], fallback: m[4] } : undefined;
}

// How many times the whole group rotates through hiding. After everyone has hidden, everyone is moved to a new
// random location with a new border and it starts again; scores add up.
export const ROTATIONS = [1, 2, 3, 4, 5];

const DEFAULTS = {
  morph: false,
  morphType: "both",
  maxY: 0,
  allowWater: false,
  peaceful: false, // hostile mobs are on by default; the admin can switch to Peaceful
  rotations: 3,
  fillMode: "wool_slab",
  zoomKit: false,
  alignToMap: false,
};

// The Nether and the End were removed as hiding options: games are Overworld-only. Settings saved by older
// versions are migrated by forcing these off.
const FORCED = { allowNether: false, allowEnd: false };

export function getSettings() {
  try {
    const raw = world.getDynamicProperty(KEY);
    if (typeof raw === "string") return { ...DEFAULTS, ...JSON.parse(raw), ...FORCED };
  } catch {}
  return { ...DEFAULTS, ...FORCED };
}

export function saveSettings(settings) {
  try {
    world.setDynamicProperty(KEY, JSON.stringify({ ...DEFAULTS, ...settings }));
  } catch (e) {
    console.warn(`[hs] could not save settings: ${e}`);
  }
}

/** World operators (the owner in single player / on a Realm) and anyone tagged hs_admin. */
export function isAdmin(player) {
  try {
    if (player.hasTag("hs_admin")) return true;
  } catch {}
  try {
    if ((player.playerPermissionLevel ?? -1) >= 2) return true; // PlayerPermissionLevel.Operator
  } catch {}
  try {
    if ((player.commandPermissionLevel ?? 0) >= 1) return true; // CommandPermissionLevel.GameDirectors+
  } catch {}
  return false;
}

export function morphLabel(type) {
  return MORPH_TYPES.find(([id]) => id === type)?.[1] ?? type;
}

/** One-line-per-setting summary for menus. */
export function describeSettings(s) {
  const rot = s.rotations ?? 1;
  return [
    `Morph: ${s.morph ? morphLabel(s.morphType) : "Off"}`,
    `Height limit: ${s.maxY ? `Y ${s.maxY}` : "None"}`,
    `Hide in water: ${s.allowWater ? "Yes" : "No"}`,
    `Hostile mobs: ${s.peaceful ? "Off (Peaceful)" : "On"}`,
    `Rotations: ${rot}${rot > 1 ? " (new random location each time)" : ""}`,
    `Sky fill on maps: ${FILL_MODES.find(([id]) => id === s.fillMode)?.[1] ?? "Off"}`,
    `Map station: ${s.zoomKit ? "Yes" : "No"}${s.alignToMap ? " · play area lined up with maps" : ""}`,
  ].join("\n");
}
