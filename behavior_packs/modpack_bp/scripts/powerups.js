// The question → answer → powerup loop.
//
// 1. A seeker asks. If the hider holds a Cancel card, the answer waits CONFIG.cancelWindowSeconds so they can
//    play it (people get a prompt; bot hiders decide on the spot). Otherwise it's answered right away.
// 2. Task questions make the hider do something that gives them away (fire, firework, bee, blocks...).
// 3. The hider earns cards: draw N, pick M (per category; doubled for a repeated question). Hand limit
//    CONFIG.handSize, extras must be discarded.
// 4. Challenge cards stop all questions until a seeker completes the challenge or it times out.
import { world, system } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { findQuestion } from "./questions.js";
import { flatPos } from "./rules.js";
import * as cards from "./cards.js";
import { challengeById, itemCount } from "./challenges.js";
import * as game from "./game.js";

/** Set by ui.js: hooks.offer(player) opens the card picker, hooks.cancel(player) the Cancel prompt. */
export const hooks = { offer: undefined, cancel: undefined };

let tokenSeq = 0;

function hiderPlayer() {
  const id = game.hiderId();
  return game.isBotId(id) ? undefined : game.getPlayer(id);
}

function announce(title, subtitle) {
  for (const p of world.getAllPlayers()) {
    if (!game.isSeeker(p) && p.id !== game.hiderId()) continue;
    try {
      p.onScreenDisplay.setTitle(title, { subtitle, fadeInDuration: 5, stayDuration: 70, fadeOutDuration: 10 });
    } catch {}
  }
}

function hand() {
  const s = game.state;
  s.hand ??= [];
  return s.hand;
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/** Why no question can be asked right now (challenge running or an answer pending), or undefined. */
export function blockedReason() {
  const s = game.state;
  if (s.challenge) return `Challenge first: ${challengeById(s.challenge.id)?.name ?? "?"}`;
  if (s.pending) return "Waiting for the hider's answer...";
  return undefined;
}

/** Asks a question for a Player or bot (anything with name/location/dimension). True if it was asked. */
export function ask(asker, questionId) {
  const s = game.state;
  if (s.phase !== "seeking" || blockedReason()) return false;
  const found = findQuestion(questionId);
  const hider = game.hiderTarget();
  if (!found || !hider) return false;
  const { category, question } = found;

  const repeat = s.used.includes(questionId);
  if (!repeat) s.used.push(questionId);
  s.cooldown = CONFIG.questionCooldownSeconds;
  const l = flatPos(asker); // overworld-equivalent, so bots and the map can reuse the clue
  const pending = {
    token: `${++tokenSeq}:${Date.now()}`,
    qid: questionId,
    text: question.text,
    by: asker.name,
    from: { x: l.x, y: l.y, z: l.z },
    answer: question.answer ? question.answer(asker, hider) : null,
    payload: question.prepare ? question.prepare(asker) : null,
    repeat,
    left: CONFIG.cancelWindowSeconds,
  };
  s.pending = pending;
  game.advanceAsker(); // round robin: the next seeker asks next
  game.broadcast(
    `${category.color}[${category.name}] §f${asker.name}: ${question.text}` +
      (repeat ? " §7(asked again: double powerups)" : "")
  );

  if (!hand().some((c) => c.type === "cancel")) {
    resolve(pending.token, false);
  } else if (game.isBotId(game.hiderId())) {
    const keen = category.id === "task" || category.id === "distance";
    resolve(pending.token, Math.random() < (keen ? 0.6 : 0.35));
  } else {
    game.save();
    const p = hiderPlayer();
    if (p) hooks.cancel?.(p);
  }
  return true;
}

/** Finishes the pending question, either answering it or (cancelled) blocking it. */
export function resolve(token, cancelled) {
  const s = game.state;
  const p = s.pending;
  if (!p || p.token !== token) return;
  s.pending = null;
  const found = findQuestion(p.qid);
  if (!found) return;
  const { category, question } = found;
  const hiderName = game.nameOf(game.hiderId());

  if (cancelled) {
    const i = hand().findIndex((c) => c.type === "cancel");
    if (i >= 0) hand().splice(i, 1);
    s.clues.push({ by: p.by, text: p.text, answer: "Cancelled by the hider", qid: p.qid, from: p.from, cancelled: true });
    game.broadcast(`§c${hiderName} played Cancel! "${p.text}" gets no answer.`);
    announce("§cCancelled!", `${hiderName} blocked: ${p.text}`);
    game.save();
    return;
  }

  let answer = p.answer;
  if (question.perform) {
    const hider = game.hiderTarget();
    answer = hider ? question.perform(hider, p.payload) : "The hider couldn't do it.";
  }
  s.clues.push({ by: p.by, text: p.text, answer, qid: p.qid, from: p.from });
  game.broadcast(`  §e→ ${answer}`);
  if (question.perform) announce("§cTask!", answer);
  else announce(`§e${answer}`, `${p.by}: ${p.text}`);

  const mult = p.repeat ? 2 : 1;
  offer(category.draw * mult, category.pick * mult);
  game.save();
}

/** The hider lets the pending question through. */
export function letThrough(player, token) {
  if (player.id === game.hiderId()) resolve(token ?? game.state.pending?.token, false);
}

/** The hider plays a Cancel card on the pending question. */
export function playCancel(player, token) {
  if (player.id !== game.hiderId() || !hand().some((c) => c.type === "cancel")) return;
  resolve(token ?? game.state.pending?.token, true);
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function offer(draw, pick) {
  const s = game.state;
  s.offer = { cards: cards.drawCards(draw), picks: Math.min(pick, draw), age: 0 };
  if (game.isBotId(game.hiderId())) {
    autoFinish();
    return;
  }
  const p = hiderPlayer();
  if (p) {
    p.sendMessage(`§dYou earned powerups: pick ${s.offer.picks} of ${draw}.`);
    hooks.offer?.(p);
  }
}

export function takeCard(player, cardId) {
  const s = game.state;
  const o = s.offer;
  if (!o || player.id !== game.hiderId()) return;
  const i = o.cards.findIndex((c) => c.id === cardId);
  if (i < 0) return;
  hand().push(o.cards.splice(i, 1)[0]);
  o.picks--;
  if (o.picks <= 0 || !o.cards.length) s.offer = null;
  game.save();
}

export function discardCard(player, cardId) {
  if (player.id !== game.hiderId()) return;
  const i = hand().findIndex((c) => c.id === cardId);
  if (i >= 0) hand().splice(i, 1);
  game.save();
}

function trimHand() {
  const h = hand();
  while (h.length > CONFIG.handSize) {
    let worst = 0;
    h.forEach((c, i) => {
      if (cards.cardValue(c) < cards.cardValue(h[worst])) worst = i;
    });
    h.splice(worst, 1);
  }
}

/** Picks the best remaining cards and trims the hand (bot hiders, or a person who keeps closing the picker). */
export function autoFinish() {
  const s = game.state;
  const o = s.offer;
  if (o) {
    const best = [...o.cards].sort((a, b) => cards.cardValue(b) - cards.cardValue(a)).slice(0, o.picks);
    hand().push(...best);
    s.offer = null;
  }
  trimHand();
  game.save();
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

export function playChallenge(player, cardId) {
  const s = game.state;
  if (s.phase !== "seeking") return;
  if (s.challenge) return player?.sendMessage("§cA challenge is already running.");
  const i = hand().findIndex((c) => c.id === cardId && c.type === "challenge");
  if (i < 0) return;
  const [card] = hand().splice(i, 1);
  const ch = challengeById(card.challenge);
  if (!ch) return;
  const baseline = {};
  for (const p of world.getAllPlayers()) if (game.isSeeker(p)) baseline[p.id] = itemCount(p, ch.items);
  s.challenge = { id: ch.id, left: CONFIG.challengeSeconds, baseline, botLeft: 45 + Math.floor(Math.random() * 75) };
  game.broadcast(`§6${game.nameOf(game.hiderId())} played a challenge: §l${ch.name}§r§6! §7${ch.desc}`);
  game.broadcast("§7No questions until a seeker completes it.");
  announce("§6Challenge!", ch.name);
  game.save();
}

function completeChallenge(byName) {
  const s = game.state;
  const ch = challengeById(s.challenge?.id);
  s.challenge = null;
  game.broadcast(`§a${byName} completed the challenge${ch ? ` "${ch.name}"` : ""}! Questions are open again.`);
  announce("§aChallenge complete!", `${byName} did it`);
  game.save();
}

function activeChallenge() {
  const s = game.state;
  return s.phase === "seeking" && s.challenge ? challengeById(s.challenge.id) : undefined;
}

/** Entity spawned in the world (breeding, golems, TNT...). */
export function onSpawn(entity, cause) {
  const ch = activeChallenge();
  if (!ch?.spawn) return;
  let ok = false;
  try {
    ok = ch.spawn(entity, cause);
  } catch {}
  if (!ok) return;
  for (const p of world.getAllPlayers()) {
    if (!game.isSeeker(p) || p.dimension.id !== entity.dimension.id) continue;
    const l = entity.location;
    if (Math.hypot(p.location.x - l.x, p.location.y - l.y, p.location.z - l.z) <= 24) return completeChallenge(p.name);
  }
}

/** A player used an item on a block (bone meal, water bottles...). */
export function onUseOnBlock(player, block, item) {
  const ch = activeChallenge();
  if (!ch || !game.isSeeker(player)) return;
  if (ch.useItem && item?.typeId === ch.useItem) return completeChallenge(player.name);
  if (ch.blockAfter) {
    const loc = block.location;
    const dim = block.dimension;
    system.runTimeout(() => {
      try {
        if (activeChallenge() === ch && dim.getBlock(loc)?.typeId === ch.blockAfter) completeChallenge(player.name);
      } catch {}
    }, 2);
  }
}

// ---------------------------------------------------------------------------
// Ticking (once per second during seeking, from game.js)
// ---------------------------------------------------------------------------

export function tickSecond() {
  const s = game.state;

  if (s.pending && --s.pending.left <= 0) resolve(s.pending.token, false);

  if (s.offer && ++s.offer.age > CONFIG.offerSeconds) {
    const p = hiderPlayer();
    p?.sendMessage("§7You took too long, so the best powerups were picked for you.");
    autoFinish();
  }
  // A person who never discards down to the hand limit gets trimmed after a while.
  if (!s.offer && hand().length > CONFIG.handSize) {
    s.overHand = (s.overHand ?? 0) + 1;
    if (s.overHand > CONFIG.offerSeconds) trimHand();
  } else {
    s.overHand = 0;
  }

  const ch = activeChallenge();
  if (ch) {
    for (const p of world.getAllPlayers()) {
      if (!game.isSeeker(p)) continue;
      if (ch.dimension && p.dimension.id === ch.dimension) return completeChallenge(p.name);
      if (ch.items) {
        const have = itemCount(p, ch.items);
        if (s.challenge.baseline[p.id] === undefined) s.challenge.baseline[p.id] = have;
        else if (have > s.challenge.baseline[p.id]) return completeChallenge(p.name);
      }
    }
    // Bots can't really fish or breed chickens: with no people seeking, a bot "does it" after a while.
    if (!game.humanSeekersOnline() && --s.challenge.botLeft <= 0) {
      const bot = s.players.find((p) => p.bot && p.id !== game.hiderId());
      return completeChallenge(bot?.name ?? "The seekers");
    }
    if (--s.challenge.left <= 0) {
      s.challenge = null;
      game.broadcast(`§7The challenge "${ch.name}" timed out. Questions are open again.`);
      announce("§7Challenge over", "Questions are open again");
    }
  }

  // Bot hiders play a challenge card at a random moment.
  if (game.isBotId(game.hiderId()) && !s.challenge && !s.pending && Math.random() < 0.15) {
    const card = hand().find((c) => c.type === "challenge");
    if (card) playChallenge(undefined, card.id);
  }
}
