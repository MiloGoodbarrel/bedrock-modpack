// Tests for behavior_packs/modpack_bp/scripts/geometry.js (pure JS, no Minecraft).
// Run with Node 18+:  node tests/geometry.test.js
// Also runnable in a browser console after pasting geometry.js (see runGeometryTests below).

export function runGeometryTests(g) {
  const fails = [];
  const check = (name, ok) => {
    if (!ok) fails.push(name);
  };
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  // Answer functions copied from questions.js, to prove constraints match them exactly.
  const answers = {
    north_south: (a, h) => (h.z < a.z ? "North" : "South"),
    east_west: (a, h) => (h.x > a.x ? "East" : "West"),
  };
  for (const r of [500, 250, 100, 50, 25]) answers[`within_${r}`] = (a, h) => (Math.hypot(h.x - a.x, h.z - a.z) <= r ? "Yes" : "No");
  const qids = Object.keys(answers);

  // 1. Constraint point tests match the answers, including exact ties (boundary equality).
  for (let i = 0; i < 20000; i++) {
    const a = { x: Math.round(rand() * 200 - 100), z: Math.round(rand() * 200 - 100) };
    const h = { x: Math.round(rand() * 200 - 100), z: Math.round(rand() * 200 - 100) };
    if (i % 5 === 0) h.z = a.z; // ties
    if (i % 7 === 0) h.x = a.x;
    const qid = qids[i % qids.length];
    const c = g.constraintFromClue({ qid, from: a, answer: answers[qid](a, h) });
    if (!c || !g.pointOk(c, h.x, h.z)) {
      fails.push(`answer/constraint mismatch ${qid}`);
      break;
    }
  }

  // 2. Randomized: clues consistent with a real hider; no feasible point may sit in an "out" cell.
  for (const size of [9, 15]) {
    for (let t = 0; t < 150; t++) {
      const cx = rand() * 2000 - 1000, cz = rand() * 2000 - 1000, R = 500;
      const hider = { x: cx + (rand() * 2 - 1) * R, z: cz + (rand() * 2 - 1) * R };
      const clues = [];
      const n = 1 + Math.floor(rand() * 7);
      for (let k = 0; k < n; k++) {
        const qid = qids[Math.floor(rand() * qids.length)];
        // Askers close to the hider make tight, awkward regions.
        const a = { x: hider.x + (rand() * 2 - 1) * 120, z: hider.z + (rand() * 2 - 1) * 120 };
        clues.push({ qid, from: a, answer: answers[qid](a, hider) });
      }
      const cs = g.constraintsFrom(clues);
      const grid = g.classifyGrid(cs, cx, cz, R, size);
      const cell = (2 * R) / size;
      const cellOf = (p) => ({
        col: Math.min(size - 1, Math.floor((p.x - (cx - R)) / cell)),
        row: Math.min(size - 1, Math.floor((p.z - (cz - R)) / cell)),
      });
      const hc = cellOf(hider);
      if (grid[hc.row][hc.col] === "out") fails.push(`hider cell blacked out (size ${size}, trial ${t})`);
      for (let s = 0; s < 400; s++) {
        const p = { x: cx + (rand() * 2 - 1) * R, z: cz + (rand() * 2 - 1) * R };
        if (!g.allOk(cs, p.x, p.z)) continue;
        const pc = cellOf(p);
        if (grid[pc.row][pc.col] === "out") {
          fails.push(`feasible point in out cell (size ${size}, trial ${t})`);
          break;
        }
        if (grid[pc.row][pc.col] === "in" && !g.allOk(cs, p.x, p.z)) fails.push("in cell has infeasible point");
      }
      // Every point of an "in" cell must be feasible.
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          if (grid[row][col] !== "in") continue;
          for (let s = 0; s < 6; s++) {
            const x = cx - R + (col + rand()) * cell, z = cz - R + (row + rand()) * cell;
            if (!g.allOk(cs, x, z)) fails.push(`"in" cell contains an infeasible point (size ${size})`);
          }
        }
      }
    }
  }

  // 3. A 25-block "yes" circle sitting between the old 9-point samples stays visible.
  {
    const R = 500, size = 15, cell = (2 * R) / size; // ~66.7 blocks
    // Old samples were at 17%, 50%, 83% of the cell. Put the circle center at 33% of cell (x and z).
    const centerX = -R + 3 * cell + 0.33 * cell, centerZ = -R + 4 * cell + 0.33 * cell;
    const cs = g.constraintsFrom([{ qid: "within_25", from: { x: centerX, z: centerZ }, answer: "Yes" }]);
    const grid = g.classifyGrid(cs, 0, 0, R, size);
    check("25-block circle cell not blacked out", grid[4][3] !== "out");
    const visible = grid.flat().filter((v) => v !== "out").length;
    check("25-block circle only touches a few cells", visible >= 1 && visible <= 4);
  }

  // 4. Tangency / boundary: circle touching a cell edge exactly.
  {
    const cs = [{ kind: "circle", cx: 0, cz: 0, r: 10, inside: true }];
    check("tangent rect is not out", g.classifyRect(cs, 10, -5, 20, 5) !== "out");
    check("just-outside rect is out", g.classifyRect(cs, 10.001, -5, 20, 5) === "out");
    const half = [{ kind: "half", axis: "z", op: "lt", v: 0 }];
    check("z<0: rect starting at z=0 is out", g.classifyRect(half, -5, 0, 5, 10) === "out");
    check("z<0: rect ending at z=0 is part", g.classifyRect(half, -5, -10, 5, 0) === "part");
    const ge = [{ kind: "half", axis: "z", op: "ge", v: 0 }];
    check("z>=0: rect ending at z=0 is part (z=0 allowed)", g.classifyRect(ge, -5, -10, 5, 0) !== "out");
  }

  // 5. Contradictions black out everything; cancelled clues and junk add nothing.
  {
    const cs = g.constraintsFrom([
      { qid: "north_south", from: { x: 0, z: 0 }, answer: "North" },
      { qid: "north_south", from: { x: 0, z: -100 }, answer: "South" },
      { qid: "within_25", from: { x: 0, z: 400 }, answer: "Yes" },
    ]);
    const grid = g.classifyGrid(cs, 0, 0, 500, 9);
    check("contradictory constraints -> all out", grid.flat().every((v) => v === "out"));
    check("cancelled clue adds no constraint", g.constraintsFrom([{ qid: "within_25", from: { x: 0, z: 0 }, answer: "Yes", cancelled: true }]).length === 0);
    check("non-planar clue adds no constraint", g.constraintsFrom([{ qid: "on_grass", from: { x: 0, z: 0 }, answer: "Yes" }]).length === 0);
    check("NaN position adds no constraint", g.constraintsFrom([{ qid: "within_25", from: { x: NaN, z: 0 }, answer: "Yes" }]).length === 0);
    check("no clues -> all in", g.classifyGrid([], 0, 0, 500, 9).flat().every((v) => v === "in"));
  }

  // 6. Negative coordinates.
  {
    const cs = g.constraintsFrom([{ qid: "east_west", from: { x: -750, z: -2000 }, answer: "West" }]);
    const grid = g.classifyGrid(cs, -1000, -2000, 500, 10);
    check("negative coords: west half in, east half out", grid[0][0] === "in" && grid[0][9] === "out");
  }

  // 7. Area fraction (clue log): halves and circles come out about right.
  {
    check("no clues -> 100%", g.areaFraction([], 0, 0, 500) === 1);
    const north = g.constraintsFrom([{ qid: "north_south", from: { x: 0, z: 0 }, answer: "North" }]);
    check("north of the center -> about 50%", Math.abs(g.areaFraction(north, 0, 0, 500) - 0.5) < 0.02);
    const circle = g.constraintsFrom([{ qid: "within_250", from: { x: 0, z: 0 }, answer: "Yes" }]);
    const expected = (Math.PI * 250 * 250) / (1000 * 1000); // ~19.6%
    check("250-block circle in the middle -> about 19.6%", Math.abs(g.areaFraction(circle, 0, 0, 500) - expected) < 0.02);
    const none = g.constraintsFrom([
      { qid: "north_south", from: { x: 0, z: -600 }, answer: "North" }, // north of the whole area: impossible
    ]);
    check("impossible -> 0%", g.areaFraction(none, 0, 0, 500) === 0);
  }

  return { passed: fails.length === 0, fails: [...new Set(fails)].slice(0, 10) };
}

// Node entry point.
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("geometry.test.js")) {
  const g = await import("../behavior_packs/modpack_bp/scripts/geometry.js");
  const res = runGeometryTests(g);
  console.log(res.passed ? "geometry: all tests passed" : `geometry: FAILED\n${res.fails.join("\n")}`);
  process.exit(res.passed ? 0 : 1);
}
