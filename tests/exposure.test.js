// Tests for behavior_packs/modpack_bp/scripts/exposure.js (pure JS, no Minecraft).
// Run with Node 18+:  node tests/exposure.test.js   (or in a browser via tests/run.html)

export function runExposureTests(e) {
  const fails = [];
  const check = (name, ok) => {
    if (!ok) fails.push(name);
  };

  // See-through classification.
  for (const id of ["minecraft:air", "minecraft:oak_leaves", "minecraft:oak_fence",
    "minecraft:cobblestone_wall", "minecraft:iron_bars", "minecraft:short_grass", "minecraft:poppy", "minecraft:water",
    "minecraft:red_mushroom", "minecraft:oak_fence_gate", "minecraft:torch"]) {
    check(`${id} is see-through`, e.isSeeThrough(id));
  }
  for (const id of ["minecraft:dirt", "minecraft:stone", "minecraft:oak_planks", "minecraft:grass_block", "minecraft:red_mushroom_block",
    "minecraft:oak_log", "minecraft:lava", "minecraft:glass", "minecraft:glass_pane", "minecraft:tinted_glass"]) {
    check(`${id} is not see-through`, !e.isSeeThrough(id));
  }
  check("closed trapdoor is not see-through", !e.isSeeThrough("minecraft:oak_trapdoor", { open_bit: false }));
  check("open trapdoor is see-through", e.isSeeThrough("minecraft:oak_trapdoor", { open_bit: true }));
  check("closed door is not see-through", !e.isSeeThrough("minecraft:oak_door", {}));

  // Flood fill on a tiny synthetic world: a straight corridor along x, sky only at x = 5.
  const corridor = (len, skyAt) => (x, y, z) => (y === 0 && z === 0 && x >= 0 && x <= len ? { pass: true, sky: x === skyAt } : { pass: false, sky: false });
  check("reaches sky 5 steps away", e.openToOutside([{ x: 0, y: 0, z: 0 }], corridor(10, 5), 6));
  check("doesn't reach sky 7 steps away", !e.openToOutside([{ x: 0, y: 0, z: 0 }], corridor(10, 7), 6));
  check("no sky at all", !e.openToOutside([{ x: 0, y: 0, z: 0 }], corridor(10, -1), 6));
  check("unknown (unloaded) cells block", !e.openToOutside([{ x: 0, y: 0, z: 0 }], (x, y, z) => (x === 0 && y === 0 && z === 0 ? { pass: true, sky: false } : undefined), 6));
  check("sky at the start counts", e.openToOutside([{ x: 0, y: 0, z: 0 }], () => ({ pass: true, sky: true }), 6));

  return { passed: fails.length === 0, fails };
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("exposure.test.js")) {
  const e = await import("../behavior_packs/modpack_bp/scripts/exposure.js");
  const res = runExposureTests(e);
  console.log(res.passed ? "exposure: all tests passed" : `exposure: FAILED\n${res.fails.join("\n")}`);
  process.exit(res.passed ? 0 : 1);
}
