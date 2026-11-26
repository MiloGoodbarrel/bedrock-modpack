// Tests for spot rules (rules.js), observation answers and task placement (questions.js), scoring
// (scoring.js) and card drawing (cards.js), run against the fake world in tests/mocks/minecraft-server.js.
// Browser only (tests/run.html maps "@minecraft/server" to the mock with an import map).

export function runRulesTests({ rules, questions, scoring, cards, mc }) {
  const fails = [];
  const check = (name, ok) => {
    if (!ok) fails.push(name);
  };
  const center = { x: 0.5, y: 64, z: 0.5 };

  // A flat stone floor at y=63 (standing height 64) over a 21x21 area, open sky.
  const floor = (extra = {}) => {
    const blocks = {};
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) blocks[`${x},63,${z}`] = "minecraft:stone";
    return mc.makeDimension({ blocks: { ...blocks, ...extra } });
  };
  const ruleMap = (p, opts = {}, disguise) =>
    Object.fromEntries(rules.checkSpotRules(p, center, opts, disguise).map((r) => [r.label, r.ok]));

  // --- Spot rules ---
  {
    const p = mc.makePlayer({ dimension: floor() });
    const r = ruleMap(p);
    check("dry open ground passes everything", Object.values(r).every(Boolean));
  }
  {
    const p = mc.makePlayer({ dimension: floor({ "0,64,0": "minecraft:water" }) });
    check("standing in water fails Dry", ruleMap(p).Dry === false);
    check("water allowed: no Dry rule, lava rule passes", ruleMap(p, { allowWater: true }).Dry === undefined && ruleMap(p, { allowWater: true })["Not in Lava"] === true);
  }
  {
    const p = mc.makePlayer({ dimension: floor({ "0,64,0": "minecraft:lava" }) });
    check("lava fails Dry", ruleMap(p).Dry === false);
    check("lava fails even with water allowed", ruleMap(p, { allowWater: true })["Not in Lava"] === false);
  }
  {
    const p = mc.makePlayer({ dimension: floor({ "0,64,0": "minecraft:powder_snow" }) });
    check("powder snow fails Dry", ruleMap(p).Dry === false);
    const wl = mc.makePlayer({ dimension: floor({ "0,64,0": { typeId: "minecraft:oak_stairs", waterlogged: true } }) });
    check("waterlogged block fails Dry", ruleMap(wl).Dry === false);
  }
  {
    const dim = mc.makeDimension({ blocks: { "0,61,0": "minecraft:stone" } });
    check("Y 62 is below sea level", ruleMap(mc.makePlayer({ dimension: dim, y: 62 }))["Above Sea Level"] === false);
    check("Y 63 is at sea level (allowed)", ruleMap(mc.makePlayer({ dimension: floor(), y: 63 }))["Above Sea Level"] === true);
  }
  {
    check("not on ground fails", ruleMap(mc.makePlayer({ dimension: floor(), onGround: false }))["On Ground"] === false);
  }
  {
    // Roof over a 5x5 area (sky-light radius 2) at y=70: no open sky nearby.
    const roof = {};
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) roof[`${x},70,${z}`] = "minecraft:glass";
    check("fully roofed (even glass) fails Near Sky Light", ruleMap(mc.makePlayer({ dimension: floor(roof) }))["Near Sky Light"] === false);
    delete roof["2,70,2"];
    check("one open column within 2 passes", ruleMap(mc.makePlayer({ dimension: floor(roof) }))["Near Sky Light"] === true);
  }
  {
    // The add-on's own sky layer at build height must not count as a roof.
    const sky = {};
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) sky[`${x},319,${z}`] = "minecraft:black_wool_slab";
    check("sky layer at build height is ignored", ruleMap(mc.makePlayer({ dimension: floor(sky) }))["Near Sky Light"] === true);
  }
  {
    check("inside play area", ruleMap(mc.makePlayer({ dimension: floor(), x: 499 }))["Inside Play Area"] === true);
    check("outside play area", ruleMap(mc.makePlayer({ dimension: floor(), x: 501.5 }))["Inside Play Area"] === false);
  }
  {
    const nether = mc.makeDimension({ id: "minecraft:nether" });
    check("Nether fails In the Overworld", ruleMap(mc.makePlayer({ dimension: nether }))["In the Overworld"] === false);
  }
  {
    // Block morph.
    const dim = floor({ "1,64,0": "minecraft:dirt" });
    const p = mc.makePlayer({ dimension: dim });
    check("block same as a neighbour fails", ruleMap(p, { morph: true }, { kind: "block", type: "minecraft:dirt" })["Unlike Neighbours"] === false);
    check("different block passes", ruleMap(p, { morph: true }, { kind: "block", type: "minecraft:oak_planks" })["Unlike Neighbours"] === true);
    check("floor counts as a neighbour", ruleMap(p, { morph: true }, { kind: "block", type: "minecraft:stone" })["Unlike Neighbours"] === false);
    check("air at feet has room", ruleMap(p, { morph: true }, { kind: "block", type: "minecraft:oak_planks" })["Room for the Block"] === true);
    const grass = mc.makePlayer({ dimension: floor({ "0,64,0": "minecraft:short_grass" }) });
    check("short grass at feet has room", ruleMap(grass, { morph: true }, { kind: "block", type: "minecraft:oak_planks" })["Room for the Block"] === true);
    const slab = mc.makePlayer({ dimension: floor({ "0,64,0": "minecraft:oak_slab" }) });
    check("a slab at feet has no room", ruleMap(slab, { morph: true }, { kind: "block", type: "minecraft:oak_planks" })["Room for the Block"] === false);
    check("morph on without a pick fails", ruleMap(p, { morph: true }, undefined)["Pick a Disguise"] === false);
  }

  // --- Open Spot (no dug-out bunkers, trapdoor pits or tunnels; natural caves are fine) ---
  {
    // Solid dirt ground from y=55 to y=63 over a 21x21 area, stone below, open sky. Helpers carve air into it.
    const ground = () => {
      const b = {};
      for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) {
        for (let y = 40; y <= 54; y++) b[`${x},${y},${z}`] = "minecraft:stone";
        for (let y = 55; y <= 63; y++) b[`${x},${y},${z}`] = "minecraft:dirt";
      }
      return b;
    };
    const carve = (b, cells) => {
      for (const c of cells) b[c] = "minecraft:air";
      return b;
    };
    // dug: the carved cells the hider dug out themselves (they never count as natural space).
    const spot = (blocks, { y, x = 0.5, dug = [] }) =>
      ruleMap(mc.makePlayer({ dimension: mc.makeDimension({ blocks }), x, y }), { dug: new Set(dug) })["Open Spot"];

    const pitCells = ["0,61,0", "0,62,0", "0,63,0"];
    const pit = () => carve(ground(), pitCells);
    check("shallow open dug pit (3 deep) passes: one step to the surface", spot(pit(), { y: 61, dug: pitCells }) === true);
    const closed = { ...pit(), "0,63,0": { typeId: "minecraft:oak_trapdoor", states: { open_bit: false } } };
    check("dug pit with a closed trapdoor lid fails", spot(closed, { y: 61, dug: pitCells }) === false);
    const opened = { ...pit(), "0,63,0": { typeId: "minecraft:oak_trapdoor", states: { open_bit: true } } };
    check("dug pit with an open trapdoor passes", spot(opened, { y: 61, dug: pitCells }) === true);
    check("dug pit covered with dirt fails", spot({ ...pit(), "0,63,0": "minecraft:dirt" }, { y: 61, dug: pitCells }) === false);

    // The tunnel loophole: dig down, then 3 blocks sideways, then seal the entrance.
    const tunnelCells = ["0,63,0", "0,62,0", "0,61,0", "1,61,0", "2,61,0", "3,61,0", "1,62,0", "2,62,0", "3,62,0"];
    const sealed = { ...carve(ground(), tunnelCells), "0,63,0": "minecraft:dirt" };
    check("sealed dug tunnel fails", spot(sealed, { y: 61, x: 3.5, dug: tunnelCells }) === false);
    check("tiny sealed natural pocket fails too", spot(sealed, { y: 61, x: 3.5, dug: [] }) === false);

    // A deep open 1x1 shaft fails even with nothing on top: its floor is far below the ground around it.
    const shaftCells = [];
    for (let y = 48; y <= 63; y++) shaftCells.push(`0,${y},0`);
    check("deep dug shaft (16 down, no lid) fails", spot(carve(ground(), shaftCells), { y: 48, dug: shaftCells }) === false);

    // A natural cave: a sealed 7x3x7 hollow deep underground, no sky anywhere. Hard to find, but fair.
    const caveCells = [];
    for (let x = -3; x <= 3; x++) for (let y = 45; y <= 47; y++) for (let z = -3; z <= 3; z++) caveCells.push(`${x},${y},${z}`);
    const cave = carve(ground(), caveCells);
    check("natural cave passes", spot(cave, { y: 45 }) === true);
    check("hiding against a natural cave wall passes", spot(cave, { y: 45, x: 3.5 }) === true);
    check("the same hollow dug out by the hider fails", spot(cave, { y: 45, dug: caveCells }) === false);
    // A pit inside the cave (dug 2 deeper in the cave floor) still opens into the natural cave.
    const pitInCave = carve({ ...cave }, ["0,44,0", "0,43,0"]);
    check("dug pit in a natural cave floor passes", spot(pitInCave, { y: 43, dug: ["0,44,0", "0,43,0"] }) === true);

    // Leaf pocket: surrounded by leaves on every side and above, but leaves are see-through.
    const leafy = {};
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) leafy[`${x},70,${z}`] = "minecraft:oak_log";
    for (let x = -2; x <= 2; x++) for (let y = 71; y <= 74; y++) for (let z = -2; z <= 2; z++) leafy[`${x},${y},${z}`] = "minecraft:oak_leaves";
    carve(leafy, ["0,71,0", "0,72,0"]);
    check("pocket cut into leaves passes", spot(leafy, { y: 71, dug: ["0,71,0", "0,72,0"] }) === true);

    // Under a mushroom cap: a 5x5 cap overhead, open at the sides.
    const shroom = {};
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) shroom[`${x},63,${z}`] = "minecraft:grass_block";
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) shroom[`${x},68,${z}`] = "minecraft:red_mushroom_block";
    check("under a mushroom cap passes", spot(shroom, { y: 64 }) === true);

    // A sealed dirt box on the surface fails; a glass window opens it up.
    const box = {};
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) box[`${x},63,${z}`] = "minecraft:stone";
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let y = 64; y <= 66; y++) box[`${dx},${y},${dz}`] = "minecraft:dirt";
    box["0,66,0"] = "minecraft:dirt";
    check("sealed dirt box fails", spot(box, { y: 64 }) === false);
    check("same box with a glass window passes", spot({ ...box, "1,65,0": "minecraft:glass" }, { y: 64 }) === true);

    // The admin can switch the rule off.
    check("rule absent when switched off", ruleMap(mc.makePlayer({ dimension: mc.makeDimension({ blocks: sealed }), x: 3.5, y: 61 }), { openSpot: false })["Open Spot"] === undefined);
  }

  // --- Observation answers ---
  const q = (id) => questions.findQuestion(id).question;
  {
    const dim = floor({ "3,64,0": "minecraft:water" });
    const hider = mc.makePlayer({ dimension: dim });
    check("water within 4: yes", q("water_near").answer(hider, hider) === "Yes");
    check("lava within 6: no", q("lava_near").answer(hider, hider) === "No");
    const partly = mc.makeDimension({ blocks: { "0,63,0": "minecraft:stone" }, unloaded: (x) => x > 2 });
    const h2 = mc.makePlayer({ dimension: partly });
    check("unloaded area answers Unknown, not No", q("water_near").answer(h2, h2).startsWith("Unknown"));
    check("standing on stone: not grass", q("on_grass").answer(hider, hider) === "No");
    const g = mc.makePlayer({ dimension: floor({ "0,63,0": "minecraft:grass_block" }) });
    check("standing on grass: yes", q("on_grass").answer(g, g) === "Yes");
  }

  // --- Task placement never overwrites blocks ---
  {
    const dim = floor({ "0,64,0": "minecraft:air" });
    const hider = mc.makePlayer({ dimension: dim });
    const msg = q("task_gravel").perform(hider);
    let placed = 0;
    for (let x = -3; x <= 3; x++) for (let y = 63; y <= 66; y++) for (let z = -3; z <= 3; z++) if (dim.typeAt(x, y, z) === "minecraft:gravel") placed++;
    check("gravel task places exactly one block", placed === 1 && msg.includes("placed"));
    check("gravel task didn't replace the floor", dim.typeAt(0, 63, 0) === "minecraft:stone");
    check("bee task spawns a bee", q("task_bee").perform(hider).includes("bee") && dim.spawned.some((e) => e.typeId === "minecraft:bee"));
    const drop = q("task_drop_floor").perform(hider);
    check("drop task drops the hider's floor block", drop.includes("stone") && dim.spawned.some((e) => e.item?.typeId === "minecraft:stone"));
  }

  // --- Scoring ---
  {
    const time = (m) => ({ type: "time", minutes: m });
    check("plain score", scoring.roundScore({ hiderSeconds: 300, overtime: 0, penaltyPerSecond: 60, hand: [], handSize: 5 }) === 300);
    check("overtime penalty", scoring.roundScore({ hiderSeconds: 300, overtime: 2, penaltyPerSecond: 60, hand: [], handSize: 5 }) === 180);
    check("never negative", scoring.roundScore({ hiderSeconds: 10, overtime: 10, penaltyPerSecond: 60, hand: [], handSize: 5 }) === 0);
    check("time cards add up", scoring.roundScore({ hiderSeconds: 0, overtime: 0, penaltyPerSecond: 60, hand: [time(3), time(10)], handSize: 5 }) === 780);
    const six = [time(3), time(3), time(3), time(3), time(3), time(10)];
    check("a sixth card never counts", scoring.roundScore({ hiderSeconds: 0, overtime: 0, penaltyPerSecond: 60, hand: six, handSize: 5 }) === 900);
    const r = scoring.rankings([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], { a: 100, b: 300, c: 100 });
    check("rankings sorted, ties keep join order", r.map((x) => x.name).join() === "B,A,C");
  }

  // --- Card drawing ---
  {
    const all = cards.drawCards(500, []);
    check("draws the requested number", all.length === 500);
    check("every card is a known type", all.every((c) => ["time", "cancel", "challenge"].includes(c.type)));
    const ids = new Set(all.map((c) => c.id));
    check("card ids are unique", ids.size === 500);
    const challengeIds = (list) => list.filter((c) => c.type === "challenge").map((c) => c.challenge);
    const taken = ["fish", "mud", "tnt"];
    check("taken challenges are never dealt", challengeIds(cards.drawCards(300, taken)).every((id) => !taken.includes(id)));
    const batch = challengeIds(cards.drawCards(40, []));
    check("no challenge twice in one draw", new Set(batch).size === batch.length);
  }

  return { passed: fails.length === 0, fails };
}
