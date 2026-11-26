// Hider powerup cards. Asking a question earns the hider cards (each category has its own draw/pick; re-asking
// a used question doubles it). The hand holds CONFIG.handSize cards; extras must be discarded.
//   time      - +N minutes to the hider's score while it's in their hand
//   cancel    - block the question that was just asked (played in the few seconds before it's answered)
//   challenge - force the seekers to complete a challenge before they can ask anything else
import { CHALLENGES, challengeById } from "./challenges.js";
import { CONFIG } from "./config.js";
import { bonusSeconds as handBonus } from "./hand.js";

// Card kinds; their draw weights come from CONFIG.cardWeights.
const POOL = [
  { key: "time3", type: "time", minutes: 3 },
  { key: "time5", type: "time", minutes: 5 },
  { key: "time10", type: "time", minutes: 10 },
  { key: "cancel", type: "cancel" },
  { key: "challenge", type: "challenge" },
];

let seq = 0;

function pickWeighted() {
  const weight = (c) => Math.max(0, CONFIG.cardWeights?.[c.key] ?? 0);
  const total = POOL.reduce((n, c) => n + weight(c), 0);
  let roll = Math.random() * total;
  for (const c of POOL) {
    roll -= weight(c);
    if (roll < 0) return c;
  }
  return POOL[0];
}

/**
 * Draws n cards. Each challenge can only come up once per round, so challenges listed in `taken` (and ones
 * already drawn in this batch) are skipped. When none are left, a different card is drawn instead.
 */
export function drawCards(n, taken = []) {
  const blocked = new Set(taken);
  return Array.from({ length: n }, () => {
    const card = { id: `${Date.now().toString(36)}${(seq++).toString(36)}` };
    for (let tries = 0; tries < 20; tries++) {
      const base = pickWeighted();
      if (base.type === "challenge") {
        const open = CHALLENGES.filter((c) => !blocked.has(c.id));
        if (!open.length) continue;
        card.type = "challenge";
        card.challenge = open[Math.floor(Math.random() * open.length)].id;
        blocked.add(card.challenge);
        return card;
      }
      card.type = base.type;
      if (base.type === "time") card.minutes = base.minutes;
      return card;
    }
    card.type = "time";
    card.minutes = 3;
    return card;
  });
}

export function cardName(c) {
  if (c.type === "time") return `${c.minutes} Minute Bonus`;
  if (c.type === "cancel") return "Cancel";
  return `Challenge: ${challengeById(c.challenge)?.name ?? "?"}`;
}

export function cardColor(c) {
  return c.type === "time" ? "§a" : c.type === "cancel" ? "§c" : "§6";
}

export function cardDesc(c) {
  if (c.type === "time") return `Play it to add ${c.minutes} minutes to your hide time. Unplayed time bonuses are lost when you're found.`;
  if (c.type === "cancel") return "Block a question right after it's asked. The seekers get no answer.";
  return `Seekers must "${challengeById(c.challenge)?.desc ?? "?"}" before they can ask another question.`;
}

export function cardIcon(c) {
  if (c.type === "time") return "textures/items/clock_item";
  if (c.type === "cancel") return "textures/blocks/barrier";
  return "textures/items/blaze_powder";
}

/** How much a bot hider wants a card. */
export function cardValue(c) {
  if (c.type === "time") return c.minutes * 10;
  if (c.type === "cancel") return 45;
  return 60;
}

/** Extra seconds from the time cards in a hand (never more than the hand limit's worth of cards). */
export function bonusSeconds(hand) {
  return handBonus(hand, CONFIG.handSize);
}
