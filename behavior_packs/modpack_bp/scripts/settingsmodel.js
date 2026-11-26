// The admin's game settings as pure data and functions (no Minecraft imports), so migration and presets can
// be tested outside the game. settings.js adds saving/loading and the admin check on top.

export const SETTINGS_VERSION = 2;

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

// How many times the whole group rotates through hiding. After everyone has hidden, everyone is moved to a new
// random location with a new border and it starts again; scores add up.
export const ROTATIONS = [1, 2, 3, 4, 5];

// How seekers find a hider who isn't disguised (disguised hiders always have to be hit).
export const CAPTURE_MODES = [
  ["sight", "Look at them or hit them"],
  ["sustained", "Keep them in view for a second, or hit them"],
  ["hit", "Hit them only"],
];

export const DEFAULTS = {
  version: SETTINGS_VERSION,
  morph: false,
  morphType: "both",
  maxY: 0,
  allowWater: false,
  peaceful: false, // hostile mobs are on by default; the admin can switch to Peaceful
  rotations: 3,
  captureMode: "sight",
  fillMode: "wool_slab",
  zoomKit: false, // "Map station"
  alignToMap: false,
  openSpot: true, // "Open to Outside" spot rule: no sealed bunkers, trapdoor pits or tunnels
};

const ids = (list) => list.map(([id]) => id);

/**
 * Turns whatever was saved (by any older version, or hand-edited) into a valid, current settings object:
 * unknown keys dropped, missing ones filled with defaults, values outside the allowed choices replaced by
 * the default. Removed options (Nether/End hiding) are simply gone.
 */
export function migrate(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  const bool = (value, fallback) => (typeof value === "boolean" ? value : fallback);
  return {
    version: SETTINGS_VERSION,
    morph: bool(s.morph, DEFAULTS.morph),
    morphType: pick(s.morphType, ids(MORPH_TYPES), DEFAULTS.morphType),
    maxY: pick(s.maxY, HEIGHT_LIMITS, DEFAULTS.maxY),
    allowWater: bool(s.allowWater, DEFAULTS.allowWater),
    peaceful: bool(s.peaceful, DEFAULTS.peaceful),
    rotations: pick(s.rotations, ROTATIONS, DEFAULTS.rotations),
    captureMode: pick(s.captureMode, ids(CAPTURE_MODES), DEFAULTS.captureMode),
    fillMode: pick(s.fillMode, ids(FILL_MODES), DEFAULTS.fillMode),
    zoomKit: bool(s.zoomKit, DEFAULTS.zoomKit),
    alignToMap: bool(s.alignToMap, DEFAULTS.alignToMap),
    openSpot: bool(s.openSpot, DEFAULTS.openSpot),
  };
}

/**
 * One-tap presets. "Classic" is as close to the reference mod as this add-on gets; the others change only what
 * their name says on top of it. Each preset is a full settings object, so applying one never leaves
 * leftovers from the previous settings.
 */
const CLASSIC = { ...DEFAULTS, rotations: 1 };
export const PRESETS = [
  ["classic", "Classic", "The original game: no morphs, one rotation, sight or hit to find.", { ...CLASSIC }],
  ["mob", "Mob Morph", "Classic, but hiders turn into a mob.", { ...CLASSIC, morph: true, morphType: "mob" }],
  ["block", "Block Morph", "Classic, but hiders turn into a block.", { ...CLASSIC, morph: true, morphType: "block" }],
  ["mixed", "Mixed Morph", "Classic, but hiders pick a mob or a block.", { ...CLASSIC, morph: true, morphType: "both" }],
  [
    "extended",
    "Extended",
    "Everything on: 3 rotations at new locations, the map station, maps lined up with the play area, and " +
      "seekers must keep the hider in view for a second.",
    { ...CLASSIC, rotations: 3, zoomKit: true, alignToMap: true, captureMode: "sustained" },
  ],
  [
    "solo",
    "Solo Practice",
    "For playing alone against bots: Peaceful, one rotation, and the map station to practice zooming maps.",
    { ...CLASSIC, peaceful: true, zoomKit: true },
  ],
];

export function presetSettings(id) {
  const p = PRESETS.find(([pid]) => pid === id);
  return p ? migrate(p[3]) : undefined;
}

/** Which preset these settings match exactly, if any (for showing "Preset: Classic" in menus). */
export function matchingPreset(settings) {
  const s = migrate(settings);
  for (const [id, label, , values] of PRESETS) {
    const v = migrate(values);
    if (Object.keys(v).every((k) => v[k] === s[k])) return { id, label };
  }
  return undefined;
}

export function morphLabel(type) {
  return MORPH_TYPES.find(([id]) => id === type)?.[1] ?? type;
}

/** One-line-per-setting summary for menus. */
export function describeSettings(raw) {
  const s = migrate(raw);
  const preset = matchingPreset(s);
  return [
    `Preset: ${preset ? preset.label : "Custom"}`,
    `Morph: ${s.morph ? morphLabel(s.morphType) : "Off"}`,
    `Height limit: ${s.maxY ? `Y ${s.maxY}` : "None"}`,
    `Hide in water: ${s.allowWater ? "Yes" : "No"}`,
    `Spot must be open to the outside: ${s.openSpot ? "Yes" : "No (bunkers allowed)"}`,
    `Hostile mobs: ${s.peaceful ? "Off (Peaceful)" : "On"}`,
    `Rotations: ${s.rotations}${s.rotations > 1 ? " (new random location each time)" : ""}`,
    `Finding the hider: ${CAPTURE_MODES.find(([id]) => id === s.captureMode)[1]}`,
    `Sky fill on maps: ${FILL_MODES.find(([id]) => id === s.fillMode)[1]}`,
    `Map station: ${s.zoomKit ? "Yes" : "No"}${s.alignToMap ? " · play area lined up with maps" : ""}`,
  ].join("\n");
}

/** { type, states, fallback } for a fill mode, or undefined when it's off. */
export function fillBlock(mode) {
  const m = FILL_MODES.find(([id]) => id === mode);
  return m?.[2] ? { type: m[2], states: m[3], fallback: m[4] } : undefined;
}
