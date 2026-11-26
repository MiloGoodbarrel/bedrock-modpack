// The question → answer → powerup loop.
//
// 1. A seeker asks. If the hider holds a Cancel card, the answer waits CONFIG.cancelWindowSeconds so they can
//    play it (people get a prompt; bot hiders decide on the spot). Otherwise it's answered right away.
// 2. Task questions make the hider do something that gives them away (fire, firework, bee, blocks...).
// 3. The hider earns cards: draw N, pick M (per category). The hand never holds more than CONFIG.handSize
//    cards: taking one into a full hand means discarding one in the same step (hand.js).
// 4. Challenge cards stop all questions until a seeker completes the challenge.
import { world, system, ItemStack } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { findQuestion } from "./questions.js";
import { flatPos } from "./rules.js";
import * as cards from "./cards.js";
import * as handRules from "./hand.js";
import * as terrain from "./terrain.js";
import { challengeById, itemCount, unattainableChallenges } from "./challenges.js";
import * as game from "./game.js";

let offerSeq = 0;

/** True if this player is the current (human) hider during seeking: the only one allowed to touch cards. */
function isActiveHider(player) {
  return !!player && game.state.phase === "seeking" && player.id === game.hiderId();
}

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
  if (s.task) return "The hider is doing a task...";
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

  if (question.available?.() === false) return false; // not answerable on this game version
  // Each question (and task) can be asked once per hider's round.
  if (s.used.includes(questionId)) return false;
  s.used.push(questionId);
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
    left: CONFIG.cancelWindowSeconds,
  };
  s.pending = pending;
  game.advanceAsker(); // round robin: the next seeker asks next
  game.broadcast(`${category.color}[${category.name}] §f${asker.name}: ${question.text}`);
  game.sfx("ask");

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
    game.sfx("cancel");
    announce("§cCancelled!", `${hiderName} blocked: ${p.text}`);
    game.save();
    return;
  }

  if (question.perform) {
    // Tasks: the hider does it themselves when they can (a person who isn't a block disguise); otherwise it
    // happens automatically.
    const person = hiderPlayer();
    const blockDisguise = s.disguise?.applied && s.disguise.kind === "block";
    if (question.hiderTask && person && !blockDisguise) return startHiderTask(p, question, person);
    const hider = game.hiderTarget();
    return finishTask(p, hider ? question.perform(hider, p.payload) : "The hider couldn't do it.");
  }
  s.clues.push({ by: p.by, text: p.text, answer: p.answer, qid: p.qid, from: p.from });
  game.broadcast(`  §e→ ${p.answer}`);
  announce(`§e${p.answer}`, `${p.by}: ${p.text}`);
  game.sfx("answer");
  offer(category.draw, category.pick);
  game.save();
}

// ---------------------------------------------------------------------------
// Tasks the hider performs
// ---------------------------------------------------------------------------
//
// The hider gets the item they need and has CONFIG.taskSeconds to do it. Their hide timer is paused and no
// questions can be asked until it's done. If time runs out it happens automatically.

function startHiderTask(p, question, person) {
  const s = game.state;
  const spec = { ...question.hiderTask };
  if (spec.fromPayload) spec.block = p.payload;
  s.task = { ...p, spec, left: CONFIG.taskSeconds };
  const give = spec.give ?? spec.block ?? spec.item;
  if (give) {
    try {
      person.getComponent("minecraft:inventory")?.container?.addItem(new ItemStack(give, 1));
    } catch {}
  }
  game.broadcast(`§c[Task] ${game.nameOf(game.hiderId())} must: ${question.text} §7(their hide timer is paused until it's done)`);
  try {
    person.onScreenDisplay.setTitle("§cYour task", {
      subtitle: `${question.text} (${CONFIG.taskSeconds}s, your timer is paused)`,
      fadeInDuration: 5,
      stayDuration: 80,
      fadeOutDuration: 10,
    });
  } catch {}
  game.save();
}

/** Records a task as done (by the hider, or automatically) and hands out the powerups. */
function finishTask(p, answer) {
  const s = game.state;
  s.task = null;
  const found = findQuestion(p.qid);
  s.clues.push({ by: p.by, text: p.text, answer, qid: p.qid, from: p.from });
  game.broadcast(`  §e→ ${answer}`);
  announce("§cTask!", answer);
  game.sfx("answer");
  if (found) offer(found.category.draw, found.category.pick);
  game.save();
}

function taskDone() {
  const s = game.state;
  const t = s.task;
  if (!t) return;
  const q = findQuestion(t.qid)?.question;
  const did = q?.doneText ? q.doneText(t.spec.block) : "did the task";
  finishTask(t, `${game.nameOf(game.hiderId())} ${did}`);
}

function isTaskHider(player) {
  return !!game.state.task && isActiveHider(player);
}

/** The hider placed a block. */
export function taskPlaced(player, block) {
  const t = game.state.task;
  if (isTaskHider(player) && t.spec.kind === "place" && block?.typeId === t.spec.block) taskDone();
}

/** The hider broke a block. */
export function taskBroke(player) {
  if (isTaskHider(player) && game.state.task.spec.kind === "break") taskDone();
}

/** The hider used an item (fire charge). */
export function taskUsed(player, item) {
  const t = game.state.task;
  if (isTaskHider(player) && t.spec.kind === "use" && item?.typeId === t.spec.item) taskDone();
}

/** Something spawned: the task mob (or firework) near the hider counts. */
export function taskSpawned(entity) {
  const t = game.state.task;
  if (!t || t.spec.kind !== "spawn" || entity?.typeId !== t.spec.mob) return;
  const hider = hiderPlayer();
  if (!hider) return;
  try {
    const a = entity.location;
    const b = hider.location;
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= 10) taskDone();
  } catch {}
}

/** A seeker died during the round: the hider gets a powerup (draw 1, pick 1), like the original. */
export function seekerDied(name) {
  if (game.state.phase !== "seeking") return;
  game.broadcast(`§c${name} died! The hider gets a powerup.`);
  offer(1, 1);
  game.save();
}

/** The hider plays a time-bonus card: its minutes are added to their score from now on. */
export function playTimeBonus(player, cardId) {
  const s = game.state;
  if (player ? !isActiveHider(player) : !game.isBotId(game.hiderId())) return;
  const i = hand().findIndex((c) => c.id === cardId && c.type === "time");
  if (i < 0) return;
  const [card] = hand().splice(i, 1);
  s.bonusTime = (s.bonusTime ?? 0) + card.minutes * 60;
  game.broadcast(`§a${game.nameOf(game.hiderId())} played a Time Bonus: +${card.minutes} minutes!`);
  announce("§aTime Bonus!", `+${card.minutes} minutes`);
  game.sfx("timeBonus");
  game.save();
}

/** The hider lets the pending question through. */
export function letThrough(player, token) {
  if (isActiveHider(player)) resolve(token ?? game.state.pending?.token, false);
}

/** The hider plays a Cancel card on the pending question (a stale token from an old prompt does nothing). */
export function playCancel(player, token) {
  if (!isActiveHider(player) || !hand().some((c) => c.type === "cancel")) return;
  resolve(token ?? game.state.pending?.token, true);
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * Challenges that can't be dealt now: already played, in the hand, in the open offer, or not attainable with
 * the game's settings (e.g. TNT in Peaceful, where there's no gunpowder).
 */
function takenChallenges() {
  const s = game.state;
  const unattainable = unattainableChallenges(s.rules, terrain.hasWater(s));
  return [...(s.usedChallenges ?? []), ...unattainable, ...hand(), ...(s.offer?.cards ?? [])]
    .map((c) => (typeof c === "string" ? c : c.type === "challenge" ? c.challenge : undefined))
    .filter(Boolean);
}

function offer(draw, pick) {
  const s = game.state;
  const drawn = cards.drawCards(draw, takenChallenges());
  // A new offer while one is still open is merged into it, so nothing is lost.
  s.offer = handRules.mergeOffer(s.offer, `${game.roundKey()}:${++offerSeq}`, drawn, pick);
  if (game.isBotId(game.hiderId())) {
    autoFinish();
    return;
  }
  const p = hiderPlayer();
  if (p) {
    p.sendMessage(`§dYou earned powerups: pick ${s.offer.picks} of ${s.offer.cards.length}.`);
    hooks.offer?.(p);
  }
}

/**
 * The hider takes an offered card. With a full hand, discardId must be a hand card (thrown away) or the
 * offered card itself (declined). Stale calls (old offer id, wrong player, round over) do nothing.
 * Returns the hand.js result ({ ok, reason }).
 */
export function takeCard(player, offerId, cardId, discardId) {
  const s = game.state;
  if (!isActiveHider(player) || !s.offer || s.offer.id !== offerId) return { ok: false, reason: "stale" };
  const r = handRules.takeCard(hand(), s.offer, cardId, discardId, CONFIG.handSize);
  if (r.ok && r.offerDone) s.offer = null;
  if (r.ok) game.save();
  return r;
}

/** Picks the best offered cards (never going over the hand limit): bot hiders, or a person who timed out. */
export function autoFinish() {
  const s = game.state;
  handRules.autoFinish(hand(), s.offer, CONFIG.handSize, cards.cardValue);
  s.offer = null;
  // Bot hiders play their time bonuses straight away.
  if (game.isBotId(game.hiderId())) {
    for (const c of hand().filter((x) => x.type === "time")) playTimeBonus(undefined, c.id);
  }
  game.save();
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

/** Plays a challenge card: by the human hider (player), or by a bot hider (player undefined). */
export function playChallenge(player, cardId) {
  const s = game.state;
  if (s.phase !== "seeking") return;
  const botHider = game.isBotId(game.hiderId());
  if (player ? !isActiveHider(player) : !botHider) return; // only the current hider may play their cards
  if (s.challenge) return player?.sendMessage("§cA challenge is already running.");
  const i = hand().findIndex((c) => c.id === cardId && c.type === "challenge");
  if (i < 0) return;
  const ch = challengeById(hand()[i].challenge);
  if (!ch) return;
  if ((s.usedChallenges ?? []).includes(ch.id)) {
    player?.sendMessage("§cThat challenge was already played this round.");
    return;
  }
  hand().splice(i, 1);
  s.usedChallenges = [...(s.usedChallenges ?? []), ch.id]; // each challenge once per round
  const baseline = {};
  for (const p of world.getAllPlayers()) if (game.isSeeker(p)) baseline[p.id] = itemCount(p, ch.items);
  s.challenge = { id: ch.id, left: CONFIG.challengeSeconds, baseline, botLeft: 45 + Math.floor(Math.random() * 75) };
  game.broadcast(`§6${game.nameOf(game.hiderId())} played a challenge: §l${ch.name}§r§6! §7${ch.desc}`);
  game.broadcast("§7No questions and no teleporting until a seeker completes it.");
  announce("§6Challenge!", ch.name);
  game.sfx("challenge");
  game.save();
}

/** Ends the active challenge as completed (called by challengewatch.js when a seeker does it). */
export function completeChallenge(byName) {
  const s = game.state;
  if (!s.challenge) return; // already completed (two detections in the same moment)
  const ch = challengeById(s.challenge.id);
  s.challenge = null;
  game.broadcast(`§a${byName} completed the challenge${ch ? ` "${ch.name}"` : ""}! Questions are open again.`);
  announce("§aChallenge complete!", `${byName} did it`);
  game.sfx("challengeDone");
  game.save();
}

/** The active challenge's definition, during seeking. */
export function activeChallenge() {
  const s = game.state;
  return s.phase === "seeking" && s.challenge ? challengeById(s.challenge.id) : undefined;
}

// ---------------------------------------------------------------------------
// Ticking (once per second during seeking, from game.js)
// ---------------------------------------------------------------------------

export function tickSecond() {
  const s = game.state;

  if (s.pending && --s.pending.left <= 0) resolve(s.pending.token, false);
  // A task the hider hasn't done in time happens automatically.
  if (s.task && --s.task.left <= 0) {
    const t = s.task;
    const q = findQuestion(t.qid)?.question;
    const hider = game.hiderTarget();
    game.tell(hiderPlayer() ?? { sendMessage() {} }, "§7Time's up: your task was done for you.");
    finishTask(t, hider && q ? q.perform(hider, t.payload) : "The hider couldn't do it.");
  }

  if (s.offer && ++s.offer.age > CONFIG.offerSeconds) {
    const p = hiderPlayer();
    p?.sendMessage("§7You took too long, so the best powerups were picked for you.");
    autoFinish();
  }
  // Hands saved by older versions could be oversized: repair them.
  if (hand().length > CONFIG.handSize) handRules.trim(hand(), CONFIG.handSize, cards.cardValue);

  // (Seekers completing the challenge is detected in challengewatch.js.)
  const ch = activeChallenge();
  if (ch) {
    // Bots can't really fish or breed chickens: with no people seeking, a bot "does it" after a while.
    if (!game.humanSeekersOnline() && --s.challenge.botLeft <= 0) {
      const bot = s.players.find((p) => p.bot && p.id !== game.hiderId());
      return completeChallenge(bot?.name ?? "The seekers");
    }
    if (CONFIG.challengeSeconds > 0 && --s.challenge.left <= 0) {
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
