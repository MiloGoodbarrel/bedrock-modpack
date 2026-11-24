// Hider powerup cards. Asking a question earns the hider cards (each category has its own draw/pick; re-asking
// a used question doubles it). The hand holds CONFIG.handSize cards; extras must be discarded.
//   time      - +N minutes to the hider's score while it's in their hand
//   cancel    - block the question that was just asked (played in the few seconds before it's answered)
//   challenge - force the seekers to complete a challenge before they can ask anything else
import { challengeById, randomChallenge } from "./challenges.js";

const POOL = [
  { type: "time", minutes: 3, weight: 25 },
  { type: "time", minutes: 5, weight: 14 },
  { type: "time", minutes: 10, weight: 6 },
  { type: "cancel", weight: 12 },
  { type: "challenge", weight: 20 },
];

let seq = 0;

function pickWeighted() {
  const total = POOL.reduce((n, c) => n + c.weight, 0);
  let roll = Math.random() * total;
  for (const c of POOL) {
    roll -= c.weight;
    if (roll < 0) return c;
  }
  return POOL[0];
}

export function drawCards(n) {
  return Array.from({ length: n }, () => {
    const base = pickWeighted();
    const card = { id: `${Date.now().toString(36)}${(seq++).toString(36)}`, type: base.type };
    if (base.type === "time") card.minutes = base.minutes;
    if (base.type === "challenge") card.challenge = randomChallenge().id;
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
  if (c.type === "time") return `+${c.minutes} minutes to your hide time while it's in your hand.`;
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

/** Extra seconds from the time cards in a hand. */
export function bonusSeconds(hand) {
  return (hand ?? []).reduce((n, c) => n + (c.type === "time" ? c.minutes * 60 : 0), 0);
}
