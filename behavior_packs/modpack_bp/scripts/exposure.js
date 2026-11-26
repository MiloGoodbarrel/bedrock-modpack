// "Open to Outside" spot rule, as pure functions (no Minecraft imports, so it can be tested outside the game).
//
// A hiding spot has to connect to the outside world through see-through space: starting from the hider's feet
// and head, a flood fill moves through see-through blocks (air, leaves, fences, plants, open doors; not glass)
// and must reach a block with open sky above it within a few steps. A leaf pocket in a tree or a spot under a
// mushroom cap passes; a pit with a trapdoor lid, a sealed tunnel or a deep cave doesn't.

// Blocks you can see through (or past). Matched against the type id; doors and trapdoors only when open.
// Glass and glass panes deliberately do NOT count: a sealed glass box (or a box with a glass window) is still a
// bunker. A built enclosure needs a real opening.
const SEE_THROUGH =
  /(leaves|fence|_wall$|iron_bars|chain|flower|tulip|dandelion|poppy|orchid|allium|bluet|daisy|lilac|peony|rose_bush|lily|grass$|fern|vine|sapling|bush|sugar_cane|reeds|torch|carpet|snow_layer|ladder|sign|button|rail|lever|lantern|kelp|seagrass|water|bubble_column|_mushroom$|^minecraft:(red|brown)_mushroom$|petals|leaf_litter|wildflowers|azalea$|scaffolding|cobweb|tripwire|pressure_plate|candle|banner|head|skull|pot$|end_rod|lightning_rod|chain)/;
const OPENABLE = /(door|trapdoor|fence_gate)$/;

/** True if a block of this type (with these block states) can be seen through. */
export function isSeeThrough(typeId, states = {}) {
  if (!typeId || typeId === "minecraft:air") return true;
  if (OPENABLE.test(typeId)) return /fence_gate$/.test(typeId) || states.open_bit === true;
  return SEE_THROUGH.test(typeId);
}

/**
 * Flood fill from the start cells through see-through cells (6 directions), at most `maxSteps` blocks away.
 *   cell(x, y, z) -> { pass, sky, natural } or undefined when unknown (unloaded: treated as blocked)
 *     pass: see-through;  sky: see-through and outside (open sky, at ground level);
 *     natural: open space that was already there (not dug out by the hider)
 * Returns true if the outside is reached, or if the connected open space holds at least `minNatural` natural
 * cells (a natural cave or ravine: hard but fair). Dug-out space never counts toward that.
 */
export function openToOutside(starts, cell, maxSteps = 6, minNatural = Infinity) {
  let natural = 0;
  const seen = new Set();
  const queue = [];
  for (const s of starts) {
    const key = `${s.x},${s.y},${s.z}`;
    if (!seen.has(key)) {
      seen.add(key);
      queue.push({ ...s, steps: 0 });
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    const info = cell(p.x, p.y, p.z);
    if (!info) continue;
    if (info.sky) return true;
    if (info.pass && info.natural && ++natural >= minNatural) return true;
    if (p.steps >= maxSteps) continue;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const n = { x: p.x + dx, y: p.y + dy, z: p.z + dz, steps: p.steps + 1 };
      const key = `${n.x},${n.y},${n.z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (cell(n.x, n.y, n.z)?.pass) queue.push(n);
    }
  }
  return false;
}
