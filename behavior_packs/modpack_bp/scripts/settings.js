// Game-mode settings chosen by the admin (world operator) in the lobby. Saved with the world and copied into
// the game state when a game starts, so changing them never affects a game in progress. The data model,
// migration and presets live in settingsmodel.js (pure, tested).
import { world } from "@minecraft/server";
import { migrate } from "./settingsmodel.js";

export {
  MORPH_TYPES,
  HEIGHT_LIMITS,
  FILL_MODES,
  ROTATIONS,
  CAPTURE_MODES,
  PRESETS,
  presetSettings,
  matchingPreset,
  morphLabel,
  describeSettings,
  fillBlock,
} from "./settingsmodel.js";

const KEY = "hs:settings";

/** The saved settings, migrated to the current version (anything invalid or removed is repaired). */
export function getSettings() {
  try {
    const raw = world.getDynamicProperty(KEY);
    if (typeof raw === "string") return migrate(JSON.parse(raw));
  } catch {}
  return migrate({});
}

export function saveSettings(settings) {
  try {
    world.setDynamicProperty(KEY, JSON.stringify(migrate(settings)));
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
