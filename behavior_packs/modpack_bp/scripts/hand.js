// Hider hand rules, as pure functions (no Minecraft imports) so they can be tested outside the game.
//
// The hand never holds more than `size` cards, at any moment:
// - Taking a card from an offer while the hand is full needs a discard in the same step: either a card from
//   the hand, or the offered card itself (declining it). Either way it uses up one pick.
// - Unpicked offered cards are never part of the hand, so they never count toward the score.
// - A new offer while one is still open is merged into it, so nothing is lost or overwritten.

/** Seconds of bonus from the time cards in a hand (only the first `size` cards can ever count). */
export function bonusSeconds(hand, size = Infinity) {
  return (hand ?? []).slice(0, size).reduce((n, c) => n + (c.type === "time" ? c.minutes * 60 : 0), 0);
}

/** Opens a new offer, or merges the cards and picks into the one already open. Returns the open offer. */
export function mergeOffer(existing, id, cards, picks) {
  if (existing) {
    existing.cards.push(...cards);
    existing.picks = Math.min(existing.picks + picks, existing.cards.length);
    existing.age = 0;
    return existing;
  }
  return { id, cards: [...cards], picks: Math.min(picks, cards.length), age: 0 };
}

/**
 * Takes `cardId` from the offer into the hand. If the hand is full, `discardId` must name a card in the hand
 * (it's thrown away) or the offered card itself (declined). Mutates hand/offer only on success.
 * Returns { ok, reason?, offerDone }.
 */
export function takeCard(hand, offer, cardId, discardId, size) {
  if (!offer || offer.picks <= 0) return { ok: false, reason: "no-offer" };
  const i = offer.cards.findIndex((c) => c.id === cardId);
  if (i < 0) return { ok: false, reason: "not-offered" };
  if (hand.length >= size) {
    if (discardId === undefined) return { ok: false, reason: "hand-full" };
    if (discardId === cardId) {
      offer.cards.splice(i, 1); // declined: the offered card goes away
    } else {
      const d = hand.findIndex((c) => c.id === discardId);
      if (d < 0) return { ok: false, reason: "bad-discard" };
      hand.splice(d, 1);
      hand.push(offer.cards.splice(i, 1)[0]);
    }
  } else {
    hand.push(offer.cards.splice(i, 1)[0]);
  }
  offer.picks--;
  return { ok: true, offerDone: offer.picks <= 0 || offer.cards.length === 0 };
}

/**
 * Finishes an offer automatically (bot hiders, or a person who timed out): takes the most valuable offered
 * cards, and when the hand is full only swaps one in for a less valuable hand card. Never exceeds `size`.
 */
export function autoFinish(hand, offer, size, value) {
  if (offer) {
    const best = [...offer.cards].sort((a, b) => value(b) - value(a)).slice(0, Math.max(0, offer.picks));
    for (const card of best) {
      if (hand.length < size) {
        hand.push(card);
        continue;
      }
      let worst = 0;
      hand.forEach((c, i) => {
        if (value(c) < value(hand[worst])) worst = i;
      });
      if (hand.length && value(card) > value(hand[worst])) hand.splice(worst, 1, card);
    }
  }
  trim(hand, size, value);
}

/** Drops the least valuable cards until the hand fits (repairs hands saved by older versions). */
export function trim(hand, size, value) {
  while (hand.length > size) {
    let worst = 0;
    hand.forEach((c, i) => {
      if (value(c) < value(hand[worst])) worst = i;
    });
    hand.splice(worst, 1);
  }
}
