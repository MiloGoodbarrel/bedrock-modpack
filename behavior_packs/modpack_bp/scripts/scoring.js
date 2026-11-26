// Score rules as pure functions (no Minecraft imports), so they can be tested outside the game.

/**
 * A hider's score for their current round: seconds hidden, minus the overtime penalty, plus the time-bonus
 * cards they've played this round (cards still in the hand don't count, like the original). Never below 0.
 */
export function roundScore({ hiderSeconds, overtime, penaltyPerSecond, bonusSeconds = 0 }) {
  return Math.max(0, hiderSeconds - overtime * penaltyPerSecond + bonusSeconds);
}

/** Final standings: [{ name, seconds }] sorted best first (ties keep join order). */
export function rankings(players, scores) {
  return players
    .map((p, i) => ({ name: p.name, seconds: scores[p.id] ?? 0, i }))
    .sort((a, b) => b.seconds - a.seconds || a.i - b.i)
    .map(({ name, seconds }) => ({ name, seconds }));
}
