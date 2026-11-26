// All menus. Opened with the Extreme Hide & Seek Menu item. Bedrock forms are lists of buttons, so the Java mod's tabbed
// screen becomes a hub with icon buttons (Questions / Clues / Map / Hand), and the question board shows every
// category and question, with ones already asked this round greyed out.
import { system } from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData, FormCancelationReason } from "@minecraft/server-ui";
import * as game from "./game.js";
import * as powerups from "./powerups.js";
import { CATEGORIES, findQuestion } from "./questions.js";
import { checkSpotRules, formatRules } from "./rules.js";
import { CONFIG } from "./config.js";
import {
  getSettings,
  saveSettings,
  isAdmin,
  describeSettings,
  MORPH_TYPES,
  HEIGHT_LIMITS,
  FILL_MODES,
  ROTATIONS,
  CAPTURE_MODES,
} from "./settings.js";
import { MOBS, BLOCKS, heldBlock, prettyId } from "./disguise.js";
import { legend, cellBlocks } from "./map.js";
import { cardName, cardDesc, cardIcon, cardColor, bonusSeconds } from "./cards.js";
import { challengeById } from "./challenges.js";

const ICON = {
  questions: "textures/items/book_writable",
  clues: "textures/items/paper",
  map: "textures/items/map_filled",
  hud: "textures/items/compass_item",
  hand: "textures/items/book_enchanted",
  options: "textures/items/redstone_dust",
  back: "textures/items/arrow",
  lock: "textures/items/emerald",
  disguise: "textures/items/ender_eye",
  challenge: "textures/items/blaze_powder",
  teleport: "textures/items/ender_pearl",
};

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

/** Builds an ActionForm from [label, handler, icon?] entries and runs the chosen handler. */
async function menu(player, title, body, buttons) {
  const form = new ActionFormData().title(title).body(body);
  for (const [label, , icon] of buttons) {
    if (icon) form.button(label, icon);
    else form.button(label);
  }
  const res = await show(form, player);
  if (!res || res.canceled || res.selection === undefined) return;
  await buttons[res.selection][1]();
}

async function confirm(player, title, body) {
  const form = new MessageFormData().title(title).body(body).button1("Cancel").button2("Yes");
  const res = await show(form, player);
  return res?.selection === 1;
}

const back = (player) => ["Back", () => openMenu(player), ICON.back];

export async function openMenu(player) {
  const s = game.state;
  switch (s.phase) {
    case "lobby":
      return lobbyMenu(player);
    case "hiding":
      return game.isHider(player) ? hiderBuildMenu(player) : waitingMenu(player);
    case "seeking":
      if (game.isHider(player)) return hiderSeekingMenu(player);
      return game.isSeeker(player) ? seekerMenu(player) : spectatorMenu(player);
    case "between":
      return menu(player, "Extreme Hide & Seek", "Next round is about to start...", [["Close", () => {}]]);
    case "ended":
      return resultsMenu(player);
  }
}

// --- Shared tabs ---------------------------------------------------------------

function mapButtons(player) {
  return [["§2§lMap§r", () => mapMenu(player), ICON.map]];
}

function mapMenu(player) {
  const lines = game.mapLines(player, CONFIG.menuMapSize);
  const size = CONFIG.playAreaRadius * 2;
  const body = lines.length
    ? `${lines.join("\n")}\n\n${legend(game.state)}\n§7${size}x${size} play area · each square is ~${cellBlocks(CONFIG.menuMapSize)} blocks§r`
    : "The map shows up once a round starts.";
  return menu(player, "Map", body, [["Refresh", () => mapMenu(player), ICON.map], back(player)]);
}

function catOf(qid) {
  return findQuestion(qid)?.category;
}

function cluesMenu(player) {
  const clues = game.state.clues;
  const body = clues.length
    ? clues
        .map((c, i) => {
          const cat = catOf(c.qid);
          const color = c.cancelled ? "§c" : "§e";
          return `${cat?.color ?? "§f"}${i + 1}. [${cat?.name ?? "?"}] §7${c.by}:§r ${c.text}\n   ${color}${c.answer}§r`;
        })
        .join("\n")
    : "No questions asked yet.";
  return menu(player, "Clues", body, [back(player)]);
}

/** Status lines for the top of the seeker / hider hub. */
function statusLines() {
  const s = game.state;
  const lines = [];
  const ch = game.activeChallenge();
  if (ch) {
    const left = CONFIG.challengeSeconds > 0 ? `${game.fmt(s.challenge.left)} left` : "no questions until a seeker does it";
    lines.push(`§6§lCHALLENGE:§r§6 ${ch.name}§r\n§7${ch.desc} (${left})§r`);
  }
  if (s.pending) lines.push("§7Waiting for the hider's answer...§r");
  const hint = game.disguiseHint();
  if (hint) lines.push(`§d${hint}§r`);
  return lines;
}

// --- Lobby -------------------------------------------------------------------

function lobbyMenu(player) {
  const names = game.humans().map((p) => p.name);
  const botCount = game.botsForLobby();
  const body =
    `Players (${names.length}): ${names.length ? names.join(", ") : "nobody yet"}\n` +
    (botCount ? `§eSolo game: ${botCount} bots will play with you.§r\n` : "") +
    `\n§7${describeSettings(getSettings())}§r\n\n` +
    "Everyone takes a turn hiding. The hider builds a spot, the seekers ask questions to narrow it down. " +
    "Longest hide time wins.";
  const buttons = [];
  if (game.isJoined(player)) buttons.push(["§cLeave", () => game.leave(player)]);
  else buttons.push(["§aJoin", () => game.join(player), ICON.lock]);
  if (game.isJoined(player)) {
    buttons.push(["§6Start game\n§8(starts here, at your position)", () => game.start(player), ICON.map]);
  }
  if (isAdmin(player)) buttons.push(["§dGame settings\n§8(admin)", () => settingsMenu(player), ICON.options]);
  buttons.push(["How to play", () => howToPlay(player), ICON.questions]);
  return menu(player, "Extreme Hide & Seek", body, buttons);
}

async function settingsMenu(player) {
  if (!isAdmin(player)) return player.sendMessage("§cOnly the world's admin (an operator) can change settings.");
  if (game.state.phase !== "lobby") return player.sendMessage("§cSettings can only be changed in the lobby.");
  const s = getSettings();
  const morphIndex = Math.max(0, MORPH_TYPES.findIndex(([id]) => id === s.morphType));
  const heightIndex = Math.max(0, HEIGHT_LIMITS.indexOf(s.maxY));
  const form = new ModalFormData()
    .title("Game settings")
    .toggle("Morph mode (hiders disguise themselves)", { defaultValue: s.morph })
    .dropdown("Morph into (when morph mode is on)", MORPH_TYPES.map(([, label]) => label), { defaultValueIndex: morphIndex })
    .dropdown("Height limit for hiding spots", HEIGHT_LIMITS.map((y) => (y ? `Y ${y}` : "No limit")), {
      defaultValueIndex: heightIndex,
    })
    .toggle("Allow hiding in water", { defaultValue: s.allowWater })
    .toggle("Peaceful (no hostile mobs; challenges that need mob drops are left out)", { defaultValue: !!s.peaceful })
    .dropdown("Rotations (after everyone has hidden, move to a new random location)", ROTATIONS.map((n) => `${n}`), {
      defaultValueIndex: Math.max(0, ROTATIONS.indexOf(s.rotations ?? 1)),
    })
    .dropdown("Fill ruled-out areas in the sky (shows dark on maps)", FILL_MODES.map(([, label]) => label), {
      defaultValueIndex: Math.max(0, FILL_MODES.findIndex(([id]) => id === s.fillMode)),
    })
    .toggle("Map station (chest + cartography table at the start, refilled with blank maps and paper each round)", {
      defaultValue: s.zoomKit,
    })
    .toggle("Line up the play area with zoomed-out maps (moves the start point)", { defaultValue: s.alignToMap })
    .dropdown("How seekers find a hider (disguised hiders always have to be hit)", CAPTURE_MODES.map(([, label]) => label), {
      defaultValueIndex: Math.max(0, CAPTURE_MODES.findIndex(([id]) => id === s.captureMode)),
    })
    .submitButton("Save");
  const res = await show(form, player);
  if (!res || res.canceled || !res.formValues) return;
  const [morph, morphType, height, allowWater, peaceful, rotations, fill, zoomKit, alignToMap, capture] = res.formValues;
  const next = {
    morph: !!morph,
    morphType: MORPH_TYPES[morphType]?.[0] ?? "both",
    maxY: HEIGHT_LIMITS[height] ?? 0,
    allowWater: !!allowWater,
    peaceful: !!peaceful,
    rotations: ROTATIONS[rotations] ?? 1,
    fillMode: FILL_MODES[fill]?.[0] ?? "off",
    zoomKit: !!zoomKit,
    alignToMap: !!alignToMap,
    captureMode: CAPTURE_MODES[capture]?.[0] ?? "sight",
  };
  saveSettings(next);
  player.sendMessage("§dSettings saved. They apply from the next game started:");
  for (const line of describeSettings(next).split("\n")) player.sendMessage(`§d${line}`);
  return openMenu(player);
}

function howToPlay(player) {
  const body = [
    "§l1. Hide§r",
    `The hider gets ${game.fmt(CONFIG.hidingSeconds)} in Creative to build or find a spot. ` +
      `Going over costs ${CONFIG.overtimePenaltyPerSecond}s of score per second.`,
    "Your spot must be On Ground, Dry (no water or lava), Above Sea Level, Near Sky Light, in the Overworld " +
      `and Inside the Play Area (${CONFIG.playAreaRadius * 2}x${CONFIG.playAreaRadius * 2}). The admin can change some of these.`,
    "Lock in from the menu. You stay in Creative with every item, but you're frozen in place (you can still " +
      "look around and use or place blocks within reach).",
    "",
    "§l2. Seek§r",
    `Seekers ask questions from the question board (one every ${CONFIG.questionCooldownSeconds}s), taking turns ` +
      `in order. Whoever's turn it is gets ${CONFIG.askTurnSeconds}s to ask once a question is ready, or the turn moves on. ` +
      "\"Me\" means the seeker asking, so where you stand matters.",
    "§9Comparing§r and §aDistance§r narrow down the area (the map blacks it out). §eObservation§r asks about " +
      "the hider's surroundings. §cTask§r makes the hider do something that gives them away: a firework, a fire, " +
      "a bee, a block next to them.",
    "Each question and task can be asked once per round (asked ones are greyed out), and each challenge " +
      "can only be played once per round.",
    "Look straight at the hider with nothing in the way, or hit them, to find them (the admin can change " +
      "this to keeping them in view for a second, or hitting only).",
    `Seekers can teleport from the menu once every ${game.fmt(CONFIG.teleportCooldownSeconds)}, ` +
      "to a teammate or to coordinates, but not into ruled-out areas or during a challenge.",
    "The hider sees every seeker's direction and distance above their hotbar.",
    "",
    "§lThe map§r",
    "Every new hider's round starts with a fresh map for everyone: old lines and markers are gone. Red lines in " +
      "the sky show where the hider can still be, and ruled-out areas turn black. Both show up on your map.",
    "§lMaking the big map (whole play area):§r",
    "1. Get a blank map (it's handed to you, or take one from the map station chest at the start point) and " +
      "3 paper (from the station chest, or craft them from sugar cane).",
    "2. Use the blank map (hold it and press use) to start it.",
    "3. At a cartography table (one appears at the start point with the map station on), put the map in the " +
      "top slot and 1 paper in the bottom slot, then take the zoomed-out map.",
    "4. Do step 3 two more times. After 3 zooms the map covers about 1024x1024 blocks: the whole play area.",
    "5. Hold it in your off hand so it stays on screen.",
    "",
    "§l3. Powerups§r",
    "Every question earns the hider cards (Comparing: draw 3 pick 2 · Distance: draw 2 pick 2 · " +
      `Observation: draw 2 pick 1 · Task: draw 1 pick 1). Hand limit ${CONFIG.handSize}.`,
    "§aTime Bonus§r: +3/5/10 min while in your hand. §cCancel§r: block a question right after it's asked. " +
      "§6Challenge§r: seekers must do something (catch a fish, breed chickens...) before asking again.",
    "",
    "§l4. Score§r",
    "Your hide time counts until you're found, plus time-bonus cards. Highest total wins.",
    "If the admin set more than one rotation, then after everyone has hidden, everybody is teleported to a new " +
      "random location with a new border and it goes around again. Scores add up across rotations.",
    "",
    "§lMorph mode§r",
    "If the admin turns it on, the hider picks a mob or block disguise before locking in. " +
      "Disguised hiders can't be spotted by sight: hit the suspicious mob or block to find them.",
    "",
    "§lSolo§r",
    `Start alone and ${CONFIG.botsWhenSolo} bots join. Bots hide in leafy bushes, ask questions, ` +
      "and hunt you using every answer given so far.",
  ].join("\n");
  return menu(player, "How to play", body, [back(player)]);
}

// --- Hiding phase --------------------------------------------------------------

function hiderBuildMenu(player) {
  const s = game.state;
  const rules = checkSpotRules(player, s.center, s.rules ?? {}, s.disguise);
  const timer = s.hidingLeft > 0 ? `Build time left: ${game.fmt(s.hidingLeft)}` : `§cOVERTIME: +${s.overtime}s§r`;
  const look = s.rules?.morph ? `\nDisguise: ${s.disguise ? prettyId(s.disguise.type) : "§cnot picked§r"}` : "";
  const body = `${timer}${look}\n\nSpot rules (where you're standing now):\n${formatRules(rules)}`;
  const buttons = [];
  if (s.rules?.morph) buttons.push(["§dPick disguise", () => disguiseMenu(player), ICON.disguise]);
  buttons.push([
    "§a§lLock in spot",
    async () => {
      const failed = game.lockIn(player);
      if (failed.length) player.sendMessage(`§cCan't lock in yet. Fix: ${failed.map((r) => r.label).join(", ")}`);
    },
    ICON.lock,
  ]);
  buttons.push(["Refresh", () => hiderBuildMenu(player)]);
  buttons.push(...mapButtons(player));
  buttons.push(["Game options", () => optionsMenu(player), ICON.options]);
  return menu(player, "Your hiding spot", body, buttons);
}

function disguiseMenu(player) {
  const type = game.state.rules?.morphType;
  if (type === "mob") return mobMenu(player);
  if (type === "block") return blockMenu(player);
  return menu(player, "Pick disguise", "Become a mob or a block?", [
    ["Mob", () => mobMenu(player), "textures/items/spawn_eggs/spawn_egg_pig"],
    ["Block", () => blockMenu(player), "textures/blocks/grass_side_carried"],
    ["Back", () => hiderBuildMenu(player), ICON.back],
  ]);
}

function mobMenu(player) {
  const body =
    "Once you lock in you turn into this mob. You can look around but not walk. Seekers find you by hitting you.\n" +
    "§7You're invisible, so armor and your off-hand item go into your inventory and your hands stay empty " +
    "(anything you held would float in the air).§r";
  const buttons = MOBS.map(([id, label]) => [label, () => game.chooseDisguise(player, "mob", id)]);
  buttons.push(["Back", () => hiderBuildMenu(player), ICON.back]);
  return menu(player, "Become a mob", body, buttons);
}

function blockMenu(player) {
  const body =
    "Once you lock in, this block appears where you stand and you watch from inside it. " +
    "It can't match any block touching it. Seekers find you by hitting or breaking it.";
  const buttons = [];
  const held = heldBlock(player);
  if (held) buttons.push([`Block in my hand (${prettyId(held)})`, () => game.chooseDisguise(player, "block", held)]);
  for (const [id, label] of BLOCKS) buttons.push([label, () => game.chooseDisguise(player, "block", id)]);
  buttons.push(["Back", () => hiderBuildMenu(player), ICON.back]);
  return menu(player, "Become a block", body, buttons);
}

function waitingMenu(player) {
  const s = game.state;
  const body =
    s.hidingLeft > 0
      ? `${game.nameOf(game.hiderId())} is building their spot. ${game.fmt(s.hidingLeft)} left.`
      : `${game.nameOf(game.hiderId())} is in overtime (+${s.overtime}s).`;
  return menu(player, "Extreme Hide & Seek", body, [
    ["Question board §8(preview)", () => boardMenu(player, true), ICON.questions],
    ...mapButtons(player),
    ["Game options", () => optionsMenu(player), ICON.options],
    ["Close", () => {}],
  ]);
}

// --- Seeking phase: seekers ------------------------------------------------------

function seekerMenu(player) {
  const s = game.state;
  const blocked = game.canAsk(player);
  const turn = game.currentAsker();
  const order = (s.askOrder ?? []).map((id) => (id === turn ? `§b§l${game.nameOf(id)}§r` : game.nameOf(id))).join(" → ");
  const body = [
    `§7Hider:§r ${game.nameOf(game.hiderId())}    §7Time:§r ${game.fmt(s.hiderSeconds)}`,
    `§7Questions asked:§r ${s.clues.length}    §7Hider's cards:§r ${s.hand.length}/${CONFIG.handSize}`,
    `§7Asking order:§r ${order}`,
    ...statusLines(),
    blocked ? `§7${blocked}§r` : "§a§lYour turn: ask a question!§r",
  ].join("\n");
  const pass = turn === player.id ? [["Pass my turn to ask", () => game.passTurn(player), ICON.back]] : [];
  return menu(player, "Seeker", body, [
    ["§l§9Questions§r\n§8the question board", () => boardMenu(player), ICON.questions],
    ...pass,
    [`§lClues§r §8(${s.clues.length})`, () => cluesMenu(player), ICON.clues],
    [`§l§5Teleport§r\n§8${game.canTeleport(player) ?? "ready"}`, () => teleportMenu(player), ICON.teleport],
    ...mapButtons(player),
    ["Game options", () => optionsMenu(player), ICON.options],
  ]);
}

function teleportMenu(player) {
  const blocked = game.canTeleport(player);
  const body =
    (blocked ? `§c${blocked}§r\n\n` : "§aReady to teleport.§r\n\n") +
    `You can teleport once every ${game.fmt(CONFIG.teleportCooldownSeconds)}, but not into areas the answers ` +
    "have ruled out (dark on the map) and not during a challenge.";
  const buttons = game.teammates(player).map((t) => [`To ${t.name}`, () => game.teleportToTeammate(player, t.id), ICON.teleport]);
  buttons.push(["To coordinates...", () => teleportCoordsMenu(player), ICON.map]);
  const c = game.state.center;
  if (c) buttons.push(["To the start point", () => game.teleportToStart(player), ICON.hud]);
  buttons.push(back(player));
  return menu(player, "Teleport", body, buttons);
}

async function teleportCoordsMenu(player) {
  const l = player.location;
  const form = new ModalFormData()
    .title("Teleport to coordinates")
    .textField("X", "e.g. 120", { defaultValue: String(Math.floor(l.x)) })
    .textField("Z", "e.g. -340", { defaultValue: String(Math.floor(l.z)) })
    .submitButton("Teleport");
  const res = await show(form, player);
  if (!res || res.canceled || !res.formValues) return;
  const x = Number(res.formValues[0]);
  const z = Number(res.formValues[1]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return player.sendMessage("§cEnter numbers for X and Z.");
  game.teleportTo(player, Math.floor(x), Math.floor(z));
}

/** The question board: one row per category with what's left and what the hider earns. */
function boardMenu(player, preview = false) {
  const s = game.state;
  const blocked = preview ? "Questions open once the hider locks in." : game.canAsk(player);
  const body =
    (blocked ? `§c${blocked}§r\n` : "§aPick a category.§r\n") +
    "Answers are about where YOU are standing.\n" +
    "Every question earns the hider powerups. §7Each question and task can be asked once per round.§r";
  const buttons = CATEGORIES.map((cat) => {
    const left = cat.questions.filter((q) => !s.used.includes(q.id)).length;
    return [
      `${cat.color}§l${cat.name}§r §8${left}/${cat.questions.length} left\n§8Hider: ${cat.reward}`,
      () => categoryMenu(player, cat, preview),
      cat.icon,
    ];
  });
  buttons.push(back(player));
  return menu(player, "Question board", body, buttons);
}

function categoryMenu(player, category, preview = false) {
  const s = game.state;
  const blocked = preview ? "Questions open once the hider locks in." : game.canAsk(player);
  const buttons = category.questions.map((q) => {
    const used = s.used.includes(q.id);
    const label = used ? `§8${q.text}\n§8✔ already asked this round` : `${q.text}`;
    return [
      label,
      async () => {
        if (preview || used) return categoryMenu(player, category, preview);
        const now = game.canAsk(player);
        if (now) return player.sendMessage(`§c${now}`);
        game.ask(player, q.id);
      },
      category.icon,
    ];
  });
  buttons.push(["Back", () => boardMenu(player, preview), ICON.back]);
  const body = `${category.color}§l${category.name}§r  §7Hider: ${category.reward}§r\n` + (blocked ? `§c${blocked}§r` : "§aReady to ask.§r");
  return menu(player, category.name, body, buttons);
}

function spectatorMenu(player) {
  return menu(player, "Extreme Hide & Seek", `${game.nameOf(game.hiderId())} is hiding. You're not in this game.`, [
    [`Clues (${game.state.clues.length})`, () => cluesMenu(player), ICON.clues],
    ["Close", () => {}],
  ]);
}

// --- Seeking phase: the hider ----------------------------------------------------

function hiderSeekingMenu(player) {
  const s = game.state;
  const bonus = bonusSeconds(s.hand);
  const body = [
    `§7Hidden for:§r §a${game.fmt(game.currentScore())}§r${bonus ? ` §7(includes +${game.fmt(bonus)} from cards)§r` : ""}`,
    `§7Your cards:§r ${s.hand.length}/${CONFIG.handSize}    §7Questions asked:§r ${s.clues.length}`,
    ...statusLines(),
    "Stay put! You're in Creative with every item, and can look around and use or place blocks, but not walk.",
  ].join("\n");
  const buttons = [];
  if (s.offer) buttons.push([`§d§lPick powerups§r §8(${s.offer.picks} to pick)`, () => cardPicker(player), ICON.hand]);
  if (s.pending && s.hand.some((c) => c.type === "cancel")) {
    buttons.push([`§c§lPlay Cancel§r\n§8on: ${s.pending.text}`, () => powerups.playCancel(player, s.pending?.token), cardIcon({ type: "cancel" })]);
  }
  buttons.push([`§lYour hand§r §8(${s.hand.length}/${CONFIG.handSize})`, () => handMenu(player), ICON.hand]);
  buttons.push([`§lClues§r §8(${s.clues.length})`, () => cluesMenu(player), ICON.clues]);
  buttons.push(...mapButtons(player));
  buttons.push(["Game options", () => optionsMenu(player), ICON.options]);
  return menu(player, "Hider", body, buttons);
}

function handMenu(player) {
  const s = game.state;
  const body = s.hand.length
    ? `Tap a card to see it or play it.\n§7Time bonuses count automatically while they're in your hand.§r`
    : "No cards yet. You earn powerups every time a seeker asks a question.";
  const buttons = s.hand.map((c) => [`${cardColor(c)}§l${cardName(c)}`, () => cardMenu(player, c), cardIcon(c)]);
  buttons.push(back(player));
  return menu(player, `Your hand (${s.hand.length}/${CONFIG.handSize})`, body, buttons);
}

function cardMenu(player, card) {
  const s = game.state;
  const buttons = [];
  if (card.type === "challenge") {
    const busy = s.challenge ? "\n§cA challenge is already running.§r" : "";
    buttons.push(["§6§lPlay this challenge", () => powerups.playChallenge(player, card.id), ICON.challenge]);
    buttons.push(["Back", () => handMenu(player), ICON.back]);
    return menu(player, cardName(card), `${cardDesc(card)}${busy}`, buttons);
  }
  if (card.type === "cancel") {
    if (s.pending) buttons.push(["§c§lCancel the current question", () => powerups.playCancel(player, s.pending?.token), cardIcon(card)]);
    buttons.push(["Back", () => handMenu(player), ICON.back]);
    const when = s.pending ? `\n\nPending: "${s.pending.text}"` : `\n\n§7You'll get a prompt the moment a question is asked.§r`;
    return menu(player, cardName(card), cardDesc(card) + when, buttons);
  }
  return menu(player, cardName(card), cardDesc(card), [["Back", () => handMenu(player), ICON.back]]);
}

let pickerOpen = false;

/**
 * "Pick N powerups" screen. Closing it doesn't skip it: it comes back, then auto-picks after a while.
 * With a full hand, picking a card asks which card to discard (or to decline the new one) in the same step,
 * so the hand never goes over the limit. Every action carries the offer's id, so a stale screen does nothing.
 */
async function cardPicker(player) {
  if (pickerOpen) return; // one picker at a time; merged offers show up in the open one
  pickerOpen = true;
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const s = game.state;
      const o = s.offer;
      if (!o || s.phase !== "seeking" || game.hiderId() !== player.id) return;
      const full = s.hand.length >= CONFIG.handSize;
      const cardsNow = [...o.cards];
      const form = new ActionFormData()
        .title(`Pick ${o.picks} Powerup${o.picks > 1 ? "s" : ""}`)
        .body(
          `Choose powerups to add to your hand (${s.hand.length}/${CONFIG.handSize}).` +
            (full ? "\n§eYour hand is full: taking a card means discarding one.§r" : "")
        );
      for (const c of cardsNow) form.button(`${cardColor(c)}§l${cardName(c)}§r\n§8${shortDesc(c)}`, cardIcon(c));
      const res = await show(form, player);
      if (!res || res.canceled || res.selection === undefined) {
        await wait(40);
        continue;
      }
      const card = cardsNow[res.selection];
      let discardId;
      if (game.state.hand.length >= CONFIG.handSize) {
        discardId = await discardChoice(player, card);
        if (discardId === undefined) continue; // closed: back to the picker
      }
      powerups.takeCard(player, o.id, card.id, discardId);
      attempt = -1; // reset after a successful pick
    }
    if (game.state.offer && game.hiderId() === player.id) {
      player.sendMessage("§7Powerups picked for you.");
      powerups.autoFinish();
    }
  } finally {
    pickerOpen = false;
  }
}

/** Hand is full: which card goes? Returns a hand card's id, the offered card's id (decline), or undefined. */
async function discardChoice(player, card) {
  const h = [...game.state.hand];
  const form = new ActionFormData()
    .title("Hand full: discard one")
    .body(`You can hold ${CONFIG.handSize} cards. Taking §l${cardName(card)}§r means throwing one away.`);
  for (const c of h) form.button(`${cardColor(c)}§l${cardName(c)}§r\n§8throw this away`, cardIcon(c));
  form.button(`§7Don't take ${cardName(card)}`, cardIcon(card));
  const res = await show(form, player);
  if (!res || res.canceled || res.selection === undefined) return undefined;
  return res.selection < h.length ? h[res.selection].id : card.id;
}

function shortDesc(c) {
  if (c.type === "time") return `+${c.minutes} min to your hide time`;
  if (c.type === "cancel") return "block a question";
  return challengeById(c.challenge)?.desc ?? "";
}

/** Prompt the moment a question is asked, if the hider holds a Cancel card. */
async function cancelPrompt(player) {
  const p = game.state.pending;
  if (!p) return;
  const answer = p.answer ?? "(a task you'd have to do)";
  const form = new MessageFormData()
    .title("Cancel this question?")
    .body(
      `${p.by} asked:\n§l${p.text}§r\n\nYour answer would be: §e${answer}§r\n\n` +
        `Play a Cancel card to block it? You have ${CONFIG.cancelWindowSeconds} seconds.`
    )
    .button1("Let it through")
    .button2("§cPlay Cancel");
  const res = await show(form, player);
  if (res?.selection === 1) powerups.playCancel(player, p.token);
  else if (res && !res.canceled) powerups.letThrough(player, p.token);
}

powerups.hooks.offer = (player) => system.run(() => cardPicker(player));
powerups.hooks.cancel = (player) => system.run(() => cancelPrompt(player));

// --- Results / options -----------------------------------------------------------

function resultsMenu(player) {
  const body = game
    .rankings()
    .map((r, i) => `${i + 1}. ${r.name} - ${game.fmt(r.seconds)}`)
    .join("\n");
  return menu(player, "Results", body, [
    ["Back to lobby", () => game.reset(), ICON.back],
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
    back(player),
  ]);
}
