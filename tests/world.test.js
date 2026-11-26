// Tests for unbreakable-block rules (blocklists.js) and the "no starting in water" helpers (surface.js),
// run against the fake world in tests/mocks/minecraft-server.js. Browser only (tests/run.html).

export function runWorldTests({ blocklists, surface, mc }) {
  const fails = [];
  const check = (name, ok) => {
    if (!ok) fails.push(name);
  };

  // --- Unbreakable blocks ---
  for (const id of [
    "minecraft:bedrock",
    "minecraft:end_portal_frame",
    "minecraft:barrier",
    "minecraft:command_block",
    "minecraft:repeating_command_block",
    "minecraft:structure_block",
    "minecraft:light_block_15",
    "minecraft:reinforced_deepslate",
    "minecraft:end_portal",
    "minecraft:portal",
  ]) {
    check(`${id} is unbreakable`, blocklists.isUnbreakable(id));
  }
  for (const id of ["minecraft:stone", "minecraft:obsidian", "minecraft:oak_planks", "minecraft:dirt", "minecraft:chest", undefined, ""]) {
    check(`${id} is breakable`, !blocklists.isUnbreakable(id));
  }

  // --- Finding land ---
  // Ocean: water surface at y=62 everywhere in x -40..40, z -40..40, except an island at x 20..25.
  const ocean = (island = true) => {
    const blocks = {};
    for (let x = -40; x <= 40; x++) {
      for (let z = -40; z <= 40; z++) {
        blocks[`${x},55,${z}`] = "minecraft:sand";
        const land = island && x >= 20 && x <= 25 && z >= -2 && z <= 2;
        for (let y = 56; y <= 62; y++) blocks[`${x},${y},${z}`] = land ? "minecraft:dirt" : "minecraft:water";
        if (land) blocks[`${x},63,${z}`] = "minecraft:grass_block";
      }
    }
    return mc.makeDimension({ blocks });
  };
  {
    const d = ocean();
    const land = surface.findLand(d, 0.5, 0.5, 96);
    check("finds the nearest island", !!land && land.x >= 20 && land.x <= 26 && Math.abs(land.z) <= 3);
    check("stands on top of it (y 64)", land?.y === 64);
    check("already on land: stays put", JSON.stringify(surface.findLand(d, 22.5, 0.5)) === JSON.stringify({ x: 22.5, y: 64, z: 0.5 }));
  }
  {
    const d = ocean(false);
    check("open sea: no land in reach", surface.findLand(d, 0.5, 0.5, 32) === undefined);
    // Platform on the water surface (y 62), 5x5, standing height 63.
    const standY = surface.buildPlatform(d, 0.5, 62, 0.5, 2);
    let planks = 0;
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (d.typeAt(x, 62, z) === "minecraft:oak_planks") planks++;
    check("platform is 5x5 planks", planks === 25);
    check("platform stand height", standY === 63);
    check("water around it is untouched", d.typeAt(3, 62, 0) === "minecraft:water");
    check("land is found on the platform now", !!surface.findLand(d, 0.5, 0.5, 8));
  }
  {
    // A platform never replaces solid blocks.
    const d = mc.makeDimension({ blocks: { "0,62,0": "minecraft:stone", "1,62,0": "minecraft:water" } });
    surface.buildPlatform(d, 0.5, 62, 0.5, 1);
    check("platform keeps existing solid blocks", d.typeAt(0, 62, 0) === "minecraft:stone");
    check("platform fills water", d.typeAt(1, 62, 0) === "minecraft:oak_planks");
  }
  {
    // Unloaded chunks are skipped, not treated as land.
    const d = mc.makeDimension({ blocks: { "50,63,0": "minecraft:grass_block" }, unloaded: (x) => x < 40 });
    check("unloaded columns are skipped", surface.findLand(d, 0.5, 0.5, 60, 2)?.x === 50.5);
  }

  return { passed: fails.length === 0, fails };
}
