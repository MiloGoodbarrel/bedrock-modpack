// Game-mode settings chosen by the world's admins in the lobby. Saved with the world and copied into
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

// --- Admins ------------------------------------------------------------------------
//
// The pinned Script API (@minecraft/server 2.0.0) has no way to tell whether a player is an operator, so the
// add-on keeps its own admin list, saved with the world:
// - while the world has no admin, the first person to press "Become admin" in the lobby becomes one (in
//   practice the world's owner setting it up; the list survives uploading the world to a Realm)
// - admins can add or remove other admins from Game settings
// - anyone tagged hs_admin (/tag <name> add hs_admin) also counts
// - on newer game versions that do report operator status, operators count too

const ADMINS_KEY = "hs:admins";

/** [{ id, name }] */
export function adminList() {
  try {
    const raw = world.getDynamicProperty(ADMINS_KEY);
    const list = typeof raw === "string" ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((a) => a && typeof a.id === "string") : [];
  } catch {
    return [];
  }
}

function saveAdmins(list) {
  try {
    world.setDynamicProperty(ADMINS_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn(`[hs] could not save admins: ${e}`);
  }
}

export function hasAnyAdmin() {
  return adminList().length > 0;
}

/** First person to claim it becomes admin, if the world has none yet. True if they're admin now. */
export function claimAdmin(player) {
  if (hasAnyAdmin()) return isAdmin(player);
  saveAdmins([{ id: player.id, name: player.name }]);
  return true;
}

export function addAdmin(player) {
  const list = adminList().filter((a) => a.id !== player.id);
  list.push({ id: player.id, name: player.name });
  saveAdmins(list);
}

/** Removes an admin (by id). The last admin can't be removed, so a world never locks everyone out. */
export function removeAdmin(id) {
  const list = adminList();
  if (list.length <= 1) return false;
  saveAdmins(list.filter((a) => a.id !== id));
  return true;
}

/** Saved admins, anyone tagged hs_admin, and operators on game versions that report it. */
export function isAdmin(player) {
  try {
    if (player.hasTag("hs_admin")) return true;
  } catch {}
  if (adminList().some((a) => a.id === player.id)) return true;
  // Newer Script API versions (not 2.0.0) expose this; the property simply doesn't exist on 2.0.0.
  try {
    const level = player.playerPermissionLevel;
    if (typeof level === "number" && level >= 2) return true; // PlayerPermissionLevel.Operator
  } catch {}
  return false;
}
