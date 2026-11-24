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

const DEFAULTS = {
  morph: false,
  morphType: "both",
  maxY: 0,
  allowWater: false,
  allowNether: false,
  allowEnd: false,
};

export function getSettings() {
  try {
    const raw = world.getDynamicProperty(KEY);
    if (typeof raw === "string") return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
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
  const allowed = ["Overworld", s.allowNether && "Nether", s.allowEnd && "End"].filter(Boolean).join(", ");
  return [
    `Morph: ${s.morph ? morphLabel(s.morphType) : "Off"}`,
    `Height limit: ${s.maxY ? `Y ${s.maxY}` : "None"}`,
    `Hide in water: ${s.allowWater ? "Yes" : "No"}`,
    `Hiding dimensions: ${allowed}`,
  ].join("\n");
}
