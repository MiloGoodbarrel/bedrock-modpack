// Score rules as pure functions (no Minecraft imports), so they can be tested outside the game.
import { bonusSeconds } from "./hand.js";

/**
 * A hider's score for their current round: seconds hidden, minus the overtime penalty, plus the time-bonus
 * cards in their hand (at most `handSize` cards ever count). Never below 0.
 */
export function roundScore({ hiderSeconds, overtime, penaltyPerSecond, hand, handSize }) {
  return Math.max(0, hiderSeconds - overtime * penaltyPerSecond + bonusSeconds(hand, handSize));
}

/** Final standings: [{ name, seconds }] sorted best first (ties keep join order). */
export function rankings(players, scores) {
  return players
    .map((p, i) => ({ name: p.name, seconds: scores[p.id] ?? 0, i }))
    .sort((a, b) => b.seconds - a.seconds || a.i - b.i)
    .map(({ name, seconds }) => ({ name, seconds }));
}
