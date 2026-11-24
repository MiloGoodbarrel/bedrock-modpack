import { system } from "@minecraft/server";
import { ActionFormData, MessageFormData, FormCancelationReason } from "@minecraft/server-ui";
import * as game from "./game.js";
import { CATEGORIES } from "./questions.js";
import { checkSpotRules, formatRules } from "./rules.js";
import { CONFIG } from "./config.js";

const wait = (ticks) => new Promise((resolve) => system.runTimeout(resolve, ticks));

/** Shows a form, retrying while the player is busy (e.g. chat or another screen open). */
async function show(form, player) {
  for (let i = 0; i < 40; i++) {
    const res = await form.show(player);
    if (res.cancelationReason !== FormCancelationReason.UserBusy) return res;
    await wait(5);
  }
  return undefined;
}

/** Builds an ActionForm from [label, handler] pairs and runs the chosen handler. */
async function menu(player, title, body, buttons) {
  const form = new ActionFormData().title(title).body(body);
  for (const [label] of buttons) form.button(label);
  const res = await show(form, player);
  if (!res || res.canceled || res.selection === undefined) return;
  await buttons[res.selection][1]();
}

async function confirm(player, title, body) {
  const form = new MessageFormData().title(title).body(body).button1("Cancel").button2("Yes");
  const res = await show(form, player);
  return res?.selection === 1;
}

export async function openMenu(player) {
  const s = game.state;
  switch (s.phase) {
    case "lobby":
      return lobbyMenu(player);
    case "hiding":
      return game.isHider(player) ? hiderBuildMenu(player) : waitingMenu(player);
    case "seeking":
      return game.isHider(player) ? hiderSeekingMenu(player) : seekerMenu(player);
    case "between":
      return menu(player, "Hide & Seek", "Next round is about to start...", [["Close", () => {}]]);
    case "ended":
      return resultsMenu(player);
  }
}

// --- Lobby -----------------------------------------------------------------

function lobbyMenu(player) {
  const names = game.humans().map((p) => p.name);
  const botCount = game.botsForLobby();
  const body =
    `Players (${names.length}): ${names.length ? names.join(", ") : "nobody yet"}\n` +
    (botCount ? `§eSolo game: ${botCount} bots will play with you.§r\n` : "") +
    "\nEveryone takes a turn hiding. The hider builds a spot, the seekers ask questions to narrow it down. " +
    "Longest hide time wins.";
  const buttons = [];
  if (game.isJoined(player)) buttons.push(["§cLeave", () => game.leave(player)]);
  else buttons.push(["§aJoin", () => game.join(player)]);
  if (game.isJoined(player)) {
    buttons.push(["§6Start game\n§8(starts here, at your position)", () => game.start(player)]);
  }
  buttons.push(["How to play", () => howToPlay(player)]);
  return menu(player, "Hide & Seek", body, buttons);
}

function howToPlay(player) {
  const body = [
    "§l1. Hide§r",
    `The hider gets ${game.fmt(CONFIG.hidingSeconds)} in Creative to build or find a spot. ` +
      `Going over costs ${CONFIG.overtimePenaltyPerSecond}s of score per second.`,
    "Your spot must be:",
    "- On Ground",
    "- Dry (water and powder snow count as wet)",
    `- Above Sea Level (Y ${CONFIG.seaLevel}+)`,
    "- Near Sky Light (open sky close by)",
    `- Inside Play Area (${CONFIG.playAreaRadius * 2}x${CONFIG.playAreaRadius * 2} around the start point)`,
    "Lock in from the menu. You switch to Survival and can't leave your spot.",
    "",
    "§l2. Seek§r",
    `Seekers ask questions from the menu (one every ${CONFIG.questionCooldownSeconds}s, each once per round). ` +
      "\"Me\" means the seeker asking, so where you stand matters.",
    "Look straight at the hider with nothing in the way, or hit them, to find them.",
    "",
    "§l3. Score§r",
    "Your hide time counts until you're found. Highest total wins.",
    "",
    "§lSolo§r",
    `Start alone and ${CONFIG.botsWhenSolo} bots join. Bots hide in leafy bushes, ask questions, ` +
      "and hunt you using every answer given so far.",
  ].join("\n");
  return menu(player, "How to play", body, [["Back", () => openMenu(player)]]);
}

// --- Hiding phase ----------------------------------------------------------

function hiderBuildMenu(player) {
  const s = game.state;
  const rules = checkSpotRules(player, s.center);
  const timer = s.hidingLeft > 0 ? `Build time left: ${game.fmt(s.hidingLeft)}` : `§cOVERTIME: +${s.overtime}s§r`;
  const body = `${timer}\n\nSpot rules (where you're standing now):\n${formatRules(rules)}`;
  return menu(player, "Your hiding spot", body, [
    [
      "§aLock in spot",
      async () => {
        const failed = game.lockIn(player);
        if (failed.length) {
          player.sendMessage(`§cCan't lock in yet. Fix: ${failed.map((r) => r.label).join(", ")}`);
        }
      },
    ],
    ["Refresh", () => hiderBuildMenu(player)],
    ["Game options", () => optionsMenu(player)],
  ]);
}

function waitingMenu(player) {
  const s = game.state;
  const body =
    s.hidingLeft > 0
      ? `${game.nameOf(game.hiderId())} is building their spot. ${game.fmt(s.hidingLeft)} left.`
      : `${game.nameOf(game.hiderId())} is in overtime (+${s.overtime}s).`;
  return menu(player, "Hide & Seek", body, [
    ["Close", () => {}],
    ["Game options", () => optionsMenu(player)],
  ]);
}

// --- Seeking phase ---------------------------------------------------------

function seekerMenu(player) {
  const s = game.state;
  const blocked = game.canAsk(player);
  const body =
    `Seeking ${game.nameOf(game.hiderId())} - ${game.fmt(s.hiderSeconds)}\n` +
    `Questions asked: ${s.used.length}\n` +
    (blocked ? `§7${blocked}§r` : "§aYou can ask a question.§r");
  const buttons = [];
  if (game.isSeeker(player)) buttons.push(["§bAsk a question", () => categoryMenu(player)]);
  buttons.push(["Clues", () => cluesMenu(player)]);
  buttons.push(["Game options", () => optionsMenu(player)]);
  return menu(player, "Seeker", body, buttons);
}

function categoryMenu(player) {
  const blocked = game.canAsk(player);
  if (blocked) {
    player.sendMessage(`§c${blocked}`);
    return;
  }
  const buttons = CATEGORIES.map((cat) => {
    const left = cat.questions.filter((q) => !game.state.used.includes(q.id)).length;
    return [`${cat.name}  §8(${left} left)\n§8Hider: ${cat.reward}`, () => questionMenu(player, cat)];
  });
  buttons.push(["Back", () => openMenu(player)]);
  return menu(player, "Ask a question", "Answers are relative to where YOU are standing.", buttons);
}

function questionMenu(player, category) {
  const open = category.questions.filter((q) => !game.state.used.includes(q.id));
  if (!open.length) {
    return menu(player, category.name, "All questions in this category have been asked.", [
      ["Back", () => categoryMenu(player)],
    ]);
  }
  const buttons = open.map((q) => [q.text, () => game.ask(player, q.id)]);
  buttons.push(["Back", () => categoryMenu(player)]);
  return menu(player, category.name, `Hider reward: ${category.reward}`, buttons);
}

function cluesMenu(player) {
  const clues = game.state.clues;
  const body = clues.length
    ? clues.map((c, i) => `${i + 1}. §7${c.by}:§r ${c.text}\n   §e${c.answer}§r`).join("\n")
    : "No questions asked yet.";
  return menu(player, "Clues", body, [["Back", () => openMenu(player)]]);
}

function hiderSeekingMenu(player) {
  const body = `You've been hidden for ${game.fmt(game.currentScore())}.\nStay put!`;
  return menu(player, "Hider", body, [
    ["Clues", () => cluesMenu(player)],
    ["Game options", () => optionsMenu(player)],
  ]);
}

// --- Results / options -----------------------------------------------------

function resultsMenu(player) {
  const body = game
    .rankings()
    .map((r, i) => `${i + 1}. ${r.name} - ${game.fmt(r.seconds)}`)
    .join("\n");
  return menu(player, "Results", body, [
    ["Back to lobby", () => game.reset()],
    ["Close", () => {}],
  ]);
}

function optionsMenu(player) {
  return menu(player, "Game options", "Host tools. Everyone can see these, so play nice.", [
    [
      "Skip this hider's turn",
      async () => {
        if (await confirm(player, "Skip turn", `End ${game.nameOf(game.hiderId())}'s round now?`)) game.skipTurn();
      },
    ],
    [
      "§cEnd game",
      async () => {
        if (await confirm(player, "End game", "Stop the game and go back to the lobby?")) game.reset();
      },
    ],
    ["Back", () => openMenu(player)],
  ]);
}
