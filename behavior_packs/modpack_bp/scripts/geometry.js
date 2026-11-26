// Search-area geometry, shared by the menu map, the sky outline, teleport checks and bots.
// Pure JavaScript (no Minecraft imports) so it can be tested outside the game.
//
// Each planar clue becomes one canonical constraint on the hider's overworld-equivalent x/z. The point test
// matches the question answers exactly:
//   north_south: "North" <=> hider.z <  asker.z      "South" <=> hider.z >= asker.z
//   east_west:   "East"  <=> hider.x >  asker.x      "West"  <=> hider.x <= asker.x
//   within_R:    "Yes"   <=> horizontal distance <= R   "No" <=> distance > R
// Cancelled clues and anything that isn't planar (or has an unexpected answer) adds no constraint.

/** One clue -> constraint, or undefined if the clue doesn't restrict x/z. */
export function constraintFromClue(clue) {
  if (!clue || clue.cancelled || !clue.qid || !clue.from) return undefined;
  const { x, z } = clue.from;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined;
  if (clue.qid === "north_south") {
    if (clue.answer === "North") return { kind: "half", axis: "z", op: "lt", v: z };
    if (clue.answer === "South") return { kind: "half", axis: "z", op: "ge", v: z };
    return undefined;
  }
  if (clue.qid === "east_west") {
    if (clue.answer === "East") return { kind: "half", axis: "x", op: "gt", v: x };
    if (clue.answer === "West") return { kind: "half", axis: "x", op: "le", v: x };
    return undefined;
  }
  const m = /^within_(\d+)$/.exec(clue.qid);
  if (m) {
    const r = Number(m[1]);
    if (clue.answer === "Yes") return { kind: "circle", cx: x, cz: z, r, inside: true };
    if (clue.answer === "No") return { kind: "circle", cx: x, cz: z, r, inside: false };
  }
  return undefined;
}

export function constraintsFrom(clues) {
  return (clues ?? []).map(constraintFromClue).filter(Boolean);
}

/** Exact test: does the point satisfy this constraint? */
export function pointOk(c, x, z) {
  if (c.kind === "half") {
    const p = c.axis === "x" ? x : z;
    if (c.op === "lt") return p < c.v;
    if (c.op === "le") return p <= c.v;
    if (c.op === "gt") return p > c.v;
    return p >= c.v;
  }
  const d = Math.hypot(x - c.cx, z - c.cz);
  return c.inside ? d <= c.r : d > c.r;
}

/** Exact test against every constraint. */
export function allOk(constraints, x, z) {
  for (const c of constraints) if (!pointOk(c, x, z)) return false;
  return true;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * How one constraint relates to the closed rectangle [x0,x1]×[z0,z1]: "all" (every point satisfies it),
 * "none" (no point does) or "some". "all" and "none" are only returned when provably true.
 */
export function rectStatus(c, x0, z0, x1, z1) {
  if (c.kind === "half") {
    const lo = c.axis === "x" ? x0 : z0;
    const hi = c.axis === "x" ? x1 : z1;
    if (c.op === "lt") return hi < c.v ? "all" : lo >= c.v ? "none" : "some";
    if (c.op === "le") return hi <= c.v ? "all" : lo > c.v ? "none" : "some";
    if (c.op === "gt") return lo > c.v ? "all" : hi <= c.v ? "none" : "some";
    return lo >= c.v ? "all" : hi < c.v ? "none" : "some"; // ge
  }
  const near = Math.hypot(clamp(c.cx, x0, x1) - c.cx, clamp(c.cz, z0, z1) - c.cz);
  const far = Math.hypot(Math.max(Math.abs(x0 - c.cx), Math.abs(x1 - c.cx)), Math.max(Math.abs(z0 - c.cz), Math.abs(z1 - c.cz)));
  if (c.inside) return far <= c.r ? "all" : near > c.r ? "none" : "some";
  return near > c.r ? "all" : far <= c.r ? "none" : "some";
}

/**
 * Conservative classification of a rectangle against all constraints:
 *   "out"  - proven that no point in it satisfies every constraint (safe to black out)
 *   "in"   - proven that every point satisfies every constraint
 *   "part" - anything else, including "couldn't prove it either way"
 * Ambiguous rectangles are split into quarters up to `depth` times; a rectangle is only "out" if every
 * piece is proven out, so a feasible sliver between sample points can never be blacked out.
 */
export function classifyRect(constraints, x0, z0, x1, z1, depth = 5) {
  let all = true;
  for (const c of constraints) {
    const s = rectStatus(c, x0, z0, x1, z1);
    if (s === "none") return "out";
    if (s !== "all") all = false;
  }
  if (all) return "in";
  if (depth <= 0) return "part";
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  const kids = [
    classifyRect(constraints, x0, z0, mx, mz, depth - 1),
    classifyRect(constraints, mx, z0, x1, mz, depth - 1),
    classifyRect(constraints, x0, mz, mx, z1, depth - 1),
    classifyRect(constraints, mx, mz, x1, z1, depth - 1),
  ];
  if (kids.every((k) => k === "out")) return "out";
  if (kids.every((k) => k === "in")) return "in";
  return "part";
}

/** size×size grid over the square [cx-r, cx+r]×[cz-r, cz+r], rows north (low z) to south. */
export function classifyGrid(constraints, cx, cz, r, size, depth = 5) {
  const cell = (2 * r) / size;
  const rows = [];
  for (let row = 0; row < size; row++) {
    const line = [];
    for (let col = 0; col < size; col++) {
      const x0 = cx - r + col * cell;
      const z0 = cz - r + row * cell;
      line.push(classifyRect(constraints, x0, z0, x0 + cell, z0 + cell, depth));
    }
    rows.push(line);
  }
  return rows;
}

/**
 * Roughly what fraction (0..1) of the square play area still fits every constraint, by checking an n×n grid
 * of points. Used for the "X% of the area left" note in the clue log; never used to rule anything out.
 */
export function areaFraction(constraints, cx, cz, r, n = 80) {
  if (!constraints.length) return 1;
  let ok = 0;
  const step = (2 * r) / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (allOk(constraints, cx - r + (i + 0.5) * step, cz - r + (j + 0.5) * step)) ok++;
    }
  }
  return ok / (n * n);
}

/** The smallest "within R: yes" circle, if any (bots sample inside it). */
export function smallestYesCircle(constraints) {
  let best;
  for (const c of constraints) {
    if (c.kind === "circle" && c.inside && (!best || c.r < best.r)) best = c;
  }
  return best;
}
