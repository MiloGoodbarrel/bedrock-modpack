// Tests for behavior_packs/modpack_bp/scripts/settingsmodel.js (pure JS, no Minecraft).
// Run with Node 18+:  node tests/settings.test.js   (or in a browser via tests/run.html)

export function runSettingsTests(m) {
  const fails = [];
  const check = (name, ok) => {
    if (!ok) fails.push(name);
  };

  // Empty / garbage input gives the defaults.
  check("undefined -> defaults", JSON.stringify(m.migrate(undefined)) === JSON.stringify(m.DEFAULTS));
  check("string -> defaults", JSON.stringify(m.migrate("nonsense")) === JSON.stringify(m.DEFAULTS));

  // A v1-era save (Nether/End toggles, missing new keys) migrates cleanly.
  const v1 = { morph: true, morphType: "mob", maxY: 120, allowWater: true, allowNether: true, allowEnd: true, fillMode: "glass", zoomKit: true, alignToMap: false };
  const v2 = m.migrate(v1);
  check("v1 keeps valid values", v2.morph && v2.morphType === "mob" && v2.maxY === 120 && v2.allowWater && v2.fillMode === "glass" && v2.zoomKit);
  check("v1 drops removed options", !("allowNether" in v2) && !("allowEnd" in v2));
  check("v1 gets new defaults", v2.peaceful === false && v2.rotations === 3 && v2.captureMode === "sight");
  check("version stamped", v2.version === m.SETTINGS_VERSION);

  // Invalid values are replaced, not kept.
  const bad = m.migrate({ morph: "yes", morphType: "dragon", maxY: 999, rotations: 0, captureMode: "telepathy", fillMode: "lava", peaceful: 1 });
  check("invalid values -> defaults", bad.morph === false && bad.morphType === "both" && bad.maxY === 0 && bad.rotations === 3 && bad.captureMode === "sight" && bad.fillMode === "wool_slab" && bad.peaceful === false);
  check("unknown keys dropped", !("hack" in m.migrate({ hack: true })));

  // Migrating twice changes nothing.
  check("migrate is idempotent", JSON.stringify(m.migrate(v2)) === JSON.stringify(v2));

  // Every preset is valid and recognized as itself.
  for (const [id, label] of m.PRESETS) {
    const s = m.presetSettings(id);
    check(`preset ${id} is valid`, JSON.stringify(m.migrate(s)) === JSON.stringify(s));
    check(`preset ${id} matches itself`, m.matchingPreset(s)?.id === id);
    check(`preset ${id} shows in the summary`, m.describeSettings(s).includes(`Preset: ${label}`));
  }
  const ids = m.PRESETS.map(([id]) => id);
  check("all six presets exist", ["classic", "mob", "block", "mixed", "extended", "solo"].every((id) => ids.includes(id)));
  check("presets are all different", new Set(m.PRESETS.map(([, , , v]) => JSON.stringify(m.migrate(v)))).size === m.PRESETS.length);
  check("tweaked settings show as Custom", m.describeSettings({ ...m.presetSettings("classic"), maxY: 80 }).includes("Preset: Custom"));
  check("unknown preset -> undefined", m.presetSettings("nope") === undefined);
  check("mob morph preset", m.presetSettings("mob").morph === true && m.presetSettings("mob").morphType === "mob");
  check("classic has morph off", m.presetSettings("classic").morph === false);

  return { passed: fails.length === 0, fails };
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("settings.test.js")) {
  const m = await import("../behavior_packs/modpack_bp/scripts/settingsmodel.js");
  const res = runSettingsTests(m);
  console.log(res.passed ? "settings: all tests passed" : `settings: FAILED\n${res.fails.join("\n")}`);
  process.exit(res.passed ? 0 : 1);
}
