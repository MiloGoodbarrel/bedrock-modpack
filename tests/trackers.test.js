// Tests for behavior_packs/modpack_bp/scripts/trackers.js (pure JS, no Minecraft).
// Run with Node 18+:  node tests/trackers.test.js   (or in a browser via tests/run.html)

export function runTrackerTests(t) {
  const fails = [];
  const check = (name, ok) => {
    if (!ok) fails.push(name);
  };

  // Feeds a list of samples through fallStep and reports whether any landing counted.
  const run = (samples, need = 100) => {
    let track;
    let landed = false;
    for (const s of samples) {
      const r = t.fallStep(track, { x: 0, z: 0, alive: true, grounded: false, ...s }, need);
      track = r.track;
      if (r.landed) landed = true;
    }
    return landed;
  };
  const fall = (from, to, step = 15) => {
    const out = [{ y: from, grounded: true }];
    for (let y = from; y > to; y -= step) out.push({ y });
    out.push({ y: to, grounded: true });
    return out;
  };

  check("110-block fall counts", run(fall(200, 90)));
  check("exactly 100 counts", run(fall(200, 100)));
  check("99-block fall doesn't", !run(fall(200, 101)));
  check("dying on landing doesn't count", !run([...fall(200, 90).slice(0, -1), { y: 90, grounded: true, alive: false }]));
  check("water landing counts", run([{ y: 200, grounded: true }, { y: 180 }, { y: 150 }, { y: 120 }, { y: 95, grounded: true }]));
  check("teleport down (huge step) doesn't count", !run([{ y: 200, grounded: true }, { y: 190 }, { x: 500, y: 60, grounded: true }]));
  check("teleport up then fall counts only the real fall", !run([{ y: 64, grounded: true }, { y: 250 }, { y: 240 }, { y: 200, grounded: true }]));
  check("jumping around on the ground doesn't count", !run([{ y: 64, grounded: true }, { y: 65 }, { y: 64, grounded: true }, { y: 65 }, { y: 64, grounded: true }]));
  check("climbing up then falling from the top counts from the top", run([{ y: 60, grounded: true }, { y: 62 }, { y: 64 }, { y: 66 }, ...fall(170, 60).slice(1)]));
  check("starting mid-air from nothing doesn't crash", run([{ y: 300 }, { y: 285 }, { y: 270 }, { y: 255 }, { y: 240 }, { y: 225 }, { y: 210 }, { y: 195, grounded: true }]));

  // Tool breaking.
  const iron = (remaining, slot = 0) => ({ slot, type: "minecraft:iron_pickaxe", remaining });
  check("nearly broken iron tool vanishing counts", t.toolBroke(iron(1), { slot: 0, type: undefined }));
  check("healthy tool vanishing doesn't (dropped/stored)", !t.toolBroke(iron(120), { slot: 0, type: undefined }));
  check("switching slots doesn't", !t.toolBroke(iron(1, 0), { slot: 1, type: undefined }));
  check("replaced by another item doesn't", !t.toolBroke(iron(1), { slot: 0, type: "minecraft:dirt" }));
  check("diamond tool doesn't count", !t.toolBroke({ slot: 0, type: "minecraft:diamond_pickaxe", remaining: 1 }, { slot: 0 }));
  check("shears count", t.toolBroke({ slot: 0, type: "minecraft:shears", remaining: 1 }, { slot: 0 }));
  check("flint and steel counts", t.toolBroke({ slot: 0, type: "minecraft:flint_and_steel", remaining: 0 }, { slot: 0 }));
  check("iron sword counts", t.toolBroke({ slot: 2, type: "minecraft:iron_sword", remaining: 0 }, { slot: 2 }));
  check("no previous sample doesn't", !t.toolBroke(undefined, { slot: 0 }));

  return { passed: fails.length === 0, fails };
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("trackers.test.js")) {
  const t = await import("../behavior_packs/modpack_bp/scripts/trackers.js");
  const res = runTrackerTests(t);
  console.log(res.passed ? "trackers: all tests passed" : `trackers: FAILED\n${res.fails.join("\n")}`);
  process.exit(res.passed ? 0 : 1);
}
