// Pure state machines for challenge detection (no Minecraft imports, so they can be tested outside the game).

/**
 * One step of the "fall 100 blocks and survive" tracker, fed a position sample every few ticks.
 *   track:  previous state ({ peak, last }) or undefined
 *   sample: { x, y, z, grounded, alive }  (grounded = standing on a block or in water)
 * Returns { track, landed, drop }: `landed` is true on the sample where a fall of at least `need` blocks ends
 * with the player alive. A sudden horizontal jump or a rise (teleport, respawn, dimension change) restarts
 * the tracker instead of counting as a fall.
 */
export function fallStep(track, sample, need = 100, maxStepH = 30, maxRise = 10) {
  const fresh = { peak: sample.y, last: sample };
  if (!track?.last) return { track: fresh, landed: false, drop: 0 };
  const dh = Math.hypot(sample.x - track.last.x, sample.z - track.last.z);
  const dy = sample.y - track.last.y;
  if (dh > maxStepH || dy > maxRise) return { track: fresh, landed: false, drop: 0 };
  if (sample.grounded) {
    const drop = Math.max(track.peak, sample.y) - sample.y;
    return { track: fresh, landed: drop >= need && sample.alive, drop };
  }
  return { track: { peak: Math.max(track.peak, sample.y), last: sample }, landed: false, drop: 0 };
}

const IRON_TOOL = /^minecraft:iron_(pickaxe|axe|shovel|hoe|sword)$/;

/**
 * "Break an iron tool": compares the held item now with the previous sample.
 *   prev / now: { slot, type, remaining }  (type undefined for an empty hand; remaining = durability left)
 * True when an iron tool that was about to break (remaining <= `nearlyBroken`) vanished from the same,
 * still-selected slot. Switching slots never counts. Dropping a nearly broken tool on purpose would also
 * count; the API has no item-break event to tell them apart.
 */
export function toolBroke(prev, now, nearlyBroken = 3) {
  if (!prev || !now) return false;
  if (!IRON_TOOL.test(prev.type ?? "")) return false;
  if (!(prev.remaining <= nearlyBroken)) return false;
  return now.slot === prev.slot && !now.type;
}
