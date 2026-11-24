import { world, system, GameMode, ItemStack, ItemLockMode, DisplaySlotId } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { checkSpotRules, formatRules, flatPos, insidePlayArea } from "./rules.js";
import { findQuestion } from "./questions.js";
import { getSettings, describeSettings, morphLabel } from "./settings.js";
import * as disguise from "./disguise.js";
import * as bots from "./bots.js";
import * as map from "./map.js";
import * as powerups from "./powerups.js";
import * as terrain from "./terrain.js";
import * as skylines from "./skylines.js";
import { bonusSeconds } from "./cards.js";
import { challengeById } from "./challenges.js";

export const MENU_ITEM = "hs:menu";
const STATE_KEY = "hs:state";
const OBJECTIVE = "hs_time";

// Enum member casing differs between script API versions; accept either.
const GM_CREATIVE = GameMode.Creative ?? GameMode.creative;
const GM_SURVIVAL = GameMode.Survival ?? GameMode.survival;
const GM_SPECTATOR = GameMode.Spectator ?? GameMode.spectator;
const LOCK_INVENTORY = ItemLockMode.inventory ?? ItemLockMode.Inventory;

export const isBotId = bots.isBotId;

// ---------------------------------------------------------------------------
// State (persisted as JSON in a world dynamic property)
// ---------------------------------------------------------------------------

function freshState(players = []) {
  return {
    phase: "lobby", // lobby | hiding | seeking | between | ended
    players, // [{ id, name, bot?, skin? }] in join order
    gameId: "",
    order: [], // hider order (player ids)
    turn: -1,
    center: null, // start point: seekers return here each round, and the play area is centered on it
    dimId: "minecraft:overworld",
    hidingLeft: 0,
    overtime: 0,
    hiderSeconds: 0,
    spot: null, // { x, y, z, dimId } once the hider locks in
    used: [], // question ids asked this round
    clues: [], // [{ by, text, answer, qid, from }]
    cooldown: 0,
    betweenLeft: 0,
    scores: {}, // id -> final seconds
    rules: null, // the admin's settings (settings.js), copied when the game starts
    disguise: null, // { kind: "mob" | "block", type, applied, entityId } for the current hider
    prevCoords: null, // the showcoordinates gamerule before the game, restored afterwards
    // Powerups (see powerups.js)
    hand: [], // the hider's cards
    offer: null, // { cards, picks, age } waiting for the hider to pick
    pending: null, // a question waiting out the hider's Cancel window
    challenge: null, // { id, left, baseline, botLeft } while seekers must complete a challenge
    tp: {}, // player id -> seconds until they can teleport again
    askOrder: [], // seeker ids taking turns to ask (round robin)
    askTurn: 0, // index into askOrder of whose turn it is
    askIdle: 0, // seconds the current asker has had a question ready without asking
    // Bot state (see bots.js)
    bots: {},
    botHide: null,
    searched: [],
    searchSeq: 0,
    botAskWait: null,
  };
}

export let state = freshState();
let loaded = false;

export function load() {
  try {
    const raw = world.getDynamicProperty(STATE_KEY);
    if (typeof raw === "string") state = { ...freshState(), ...JSON.parse(raw) };
  } catch (e) {
    console.warn(`[hs] could not load state: ${e}`);
  }
  loaded = true;
  bots.removeStray();
}

export function save() {
  try {
    world.setDynamicProperty(STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn(`[hs] could not save state: ${e}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function fmt(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function getPlayer(id) {
  return world.getAllPlayers().find((p) => p.id === id);
}

export function isJoined(player) {
  return state.players.some((x) => x.id === player.id);
}

export function nameOf(id) {
  return state.players.find((x) => x.id === id)?.name ?? "Unknown";
}

export function humans() {
  return state.players.filter((p) => !p.bot);
}

export function hiderId() {
  return state.order[state.turn];
}

export function isHider(player) {
  return (state.phase === "hiding" || state.phase === "seeking") && player.id === hiderId();
}

export function isSeeker(player) {
  return (state.phase === "hiding" || state.phase === "seeking") && isJoined(player) && player.id !== hiderId();
}

function onlineSeekers() {
  return world.getAllPlayers().filter((p) => isSeeker(p));
}

export function humanSeekersOnline() {
  return onlineSeekers().length > 0;
}

/**
 * The current hider as something with id/location/dimension: the Player, the bot's entity, or (if a bot's
 * entity can't be loaded) a stand-in at its spot. Undefined if a human hider is offline.
 */
export function hiderTarget() {
  const id = hiderId();
  if (!isBotId(id)) return getPlayer(id);
  const e = bots.hiderEntity();
  if (e) return e;
  const s = state.spot;
  return s ? { id, location: { x: s.x, y: s.y, z: s.z }, dimension: world.getDimension(s.dimId) } : undefined;
}

export function tell(player, msg) {
  player.sendMessage(msg);
}

export function broadcast(msg) {
  world.sendMessage(msg);
}

function titleAll(title, subtitle = "") {
  for (const p of world.getAllPlayers()) {
    p.onScreenDisplay.setTitle(title, { subtitle, fadeInDuration: 5, stayDuration: 60, fadeOutDuration: 10 });
  }
}

function setMode(player, mode) {
  try {
    player.setGameMode(mode);
  } catch (e) {
    console.warn(`[hs] setGameMode failed: ${e}`);
  }
}

function hideNameTag(player) {
  try {
    player.nameTag = "";
  } catch {}
}

function restoreNameTag(player) {
  try {
    player.nameTag = player.name;
  } catch {}
}

function runCommand(cmd) {
  try {
    world.getDimension("minecraft:overworld").runCommand(cmd);
  } catch {}
}

function getShowCoordinates() {
  try {
    return world.gameRules.showCoordinates;
  } catch {
    return undefined;
  }
}

function setShowCoordinates(on) {
  try {
    world.gameRules.showCoordinates = on;
    return;
  } catch {}
  runCommand(`gamerule showcoordinates ${on}`);
}

/** Coordinates stay on for everyone during a game (re-applied every second in case someone turns them off). */
export function forceCoordinates() {
  if (getShowCoordinates() !== true) setShowCoordinates(true);
}

/** Puts the coordinates setting back to how it was before the game. */
function restoreCoordinates() {
  if (state.prevCoords !== null && state.prevCoords !== undefined) setShowCoordinates(state.prevCoords);
}

/** Hide time so far: seconds hidden, minus any overtime penalty, plus time-bonus cards in hand. */
export function currentScore() {
  return Math.max(0, state.hiderSeconds - state.overtime * CONFIG.overtimePenaltyPerSecond + bonusSeconds(state.hand));
}

// ---------------------------------------------------------------------------
// Scoreboard (sidebar, seconds hidden per player)
// ---------------------------------------------------------------------------

function objective() {
  return world.scoreboard.getObjective(OBJECTIVE) ?? world.scoreboard.addObjective(OBJECTIVE, "§6Hide Time (sec)");
}

function setBoardScore(id, seconds) {
  try {
    objective().setScore(nameOf(id), Math.floor(seconds));
  } catch (e) {
    console.warn(`[hs] setScore failed: ${e}`);
  }
}

function resetBoard() {
  try {
    if (world.scoreboard.getObjective(OBJECTIVE)) world.scoreboard.removeObjective(OBJECTIVE);
    const obj = objective();
    world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, { objective: obj });
    for (const p of state.players) obj.setScore(p.name, 0);
  } catch (e) {
    console.warn(`[hs] scoreboard reset failed: ${e}`);
  }
}

function clearBoard() {
  try {
    if (world.scoreboard.getObjective(OBJECTIVE)) world.scoreboard.removeObjective(OBJECTIVE);
  } catch {}
}

// ---------------------------------------------------------------------------
// Menu item
// ---------------------------------------------------------------------------

export function giveMenuItem(player) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  for (let i = 0; i < inv.size; i++) {
    if (inv.getItem(i)?.typeId === MENU_ITEM) return;
  }
  const item = new ItemStack(MENU_ITEM, 1);
  try {
    if (LOCK_INVENTORY !== undefined) item.lockMode = LOCK_INVENTORY;
    item.keepOnDeath = true;
  } catch {}
  inv.addItem(item);
}

/**
 * Swaps the player's maps for one fresh empty locator map, so every hider's round starts with a blank map
 * (old lines and markers are drawn into map items and would otherwise stay).
 */
function freshMap(player) {
  try {
    player.runCommand("clear @s filled_map");
  } catch {}
  try {
    player.runCommand("clear @s empty_map");
  } catch {}
  try {
    player.runCommand("give @s empty_map 1 2"); // data 2 = empty locator map (shows player markers)
    tell(
      player,
      "§7New round, new map: use your empty locator map to start it, then hold it in your off hand. " +
        "Red lines in the sky show up on it, marking where the hider can still be."
    );
  } catch {}
}

/** Called when a player (re)joins the world. */
export function onPlayerSpawn(player) {
  giveMenuItem(player);
  if (isHider(player)) hideNameTag(player);
  else restoreNameTag(player);
  // A locked-in hider stays frozen after rejoining; anyone else is unfrozen (e.g. after a crash mid-round).
  disguise.setMovement(player, !(isHider(player) && state.phase === "seeking"));
  if (state.phase === "hiding" || state.phase === "seeking") forceCoordinates();
  // Keep the stored display name current.
  const entry = state.players.find((x) => x.id === player.id);
  if (entry && entry.name !== player.name) {
    entry.name = player.name;
    save();
  }
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

export function join(player) {
  if (state.phase !== "lobby") return tell(player, "§cA game is already running. Wait for it to end.");
  if (isJoined(player)) return;
  state.players.push({ id: player.id, name: player.name });
  save();
  broadcast(`§a${player.name} joined Hide & Seek (${humans().length} players).`);
}

export function leave(player) {
  if (state.phase !== "lobby") return tell(player, "§cYou can't leave mid-game. Ask someone to end the game.");
  state.players = state.players.filter((x) => x.id !== player.id);
  save();
  broadcast(`§e${player.name} left Hide & Seek.`);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Bots that will be added if the game starts with the current lobby. */
export function botsForLobby() {
  return humans().length === 1 ? CONFIG.botsWhenSolo : 0;
}

export function start(host) {
  if (state.phase !== "lobby") return tell(host, "§cA game is already running.");
  const people = humans();
  const players = [...people, ...bots.makeBots(botsForLobby())];
  if (players.length < 2) return tell(host, "§cYou need at least 2 joined players to start.");
  const offline = people.filter((x) => !getPlayer(x.id));
  if (offline.length) return tell(host, `§cThese players aren't online: ${offline.map((x) => x.name).join(", ")}`);

  const loc = host.location;
  state = {
    ...freshState(players),
    gameId: String(Date.now()),
    order: shuffle(players.map((x) => x.id)),
    center: { x: Math.floor(loc.x) + 0.5, y: Math.floor(loc.y), z: Math.floor(loc.z) + 0.5 },
    dimId: host.dimension.id,
    rules: getSettings(),
    prevCoords: getShowCoordinates() ?? false,
  };
  for (const p of state.players) state.scores[p.id] = 0;
  runCommand("gamerule locatorbar false");
  forceCoordinates();
  resetBoard();
  const size = CONFIG.playAreaRadius * 2;
  if (players.length > people.length) broadcast(`§6Playing solo with ${players.length - people.length} bots.`);
  broadcast(`§6Hide & Seek started! Play area: ${size}x${size} around here.`);
  broadcast(`§7${describeSettings(state.rules).replace(/\n/g, " · ")}`);
  broadcast(`§6Hider order: ${state.order.map(nameOf).join(" → ")}`);
  startTurn(0);
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

function startTurn(turn) {
  state.turn = turn;
  state.phase = "hiding";
  state.overtime = 0;
  state.hiderSeconds = 0;
  state.spot = null;
  state.used = [];
  state.clues = [];
  state.cooldown = 0;
  state.disguise = null;
  state.hand = [];
  state.offer = null;
  state.pending = null;
  state.challenge = null;
  state.tp = {};
  // Seekers take turns asking, in join order, starting with a different seeker each round.
  const seekers = state.players.map((p) => p.id).filter((pid) => pid !== state.order[turn]);
  const shift = seekers.length ? turn % seekers.length : 0;
  state.askOrder = [...seekers.slice(shift), ...seekers.slice(0, shift)];
  state.askTurn = 0;
  state.askIdle = 0;
  bots.onTurnStart();

  const id = hiderId();
  const botHider = isBotId(id);
  state.hidingLeft = botHider ? CONFIG.botHidingSeconds : CONFIG.hidingSeconds;
  save();

  const dimension = world.getDimension(state.dimId);
  for (const p of world.getAllPlayers()) {
    if (!isJoined(p)) continue;
    if (p.id === id) {
      setMode(p, GM_CREATIVE);
      hideNameTag(p);
      tell(p, `§aYou're hiding! You have ${fmt(CONFIG.hidingSeconds)} in Creative to build your spot. Use the menu to lock in.`);
      if (state.rules?.morph) tell(p, `§dMorph mode (${morphLabel(state.rules.morphType)}): pick your disguise from the menu.`);
    } else {
      setMode(p, GM_SURVIVAL);
      restoreNameTag(p);
      try {
        p.teleport(state.center, { dimension });
      } catch {}
    }
    if (CONFIG.giveMaps) freshMap(p);
  }
  titleAll(`§e${nameOf(id)} is hiding`, `Round ${turn + 1} of ${state.order.length}`);
}

/** Hider locks in their spot. Returns the failed rules (empty on success). */
export function lockIn(player) {
  if (state.phase !== "hiding" || player.id !== hiderId()) return [];
  const failed = checkSpotRules(player, state.center, state.rules ?? {}, state.disguise).filter((r) => !r.ok);
  if (failed.length) return failed;

  const loc = player.location;
  const block = state.disguise?.kind === "block";
  state.spot = block
    ? { x: Math.floor(loc.x) + 0.5, y: Math.floor(loc.y), z: Math.floor(loc.z) + 0.5, dimId: player.dimension.id }
    : { x: loc.x, y: loc.y, z: loc.z, dimId: player.dimension.id };
  state.phase = "seeking";
  setMode(player, GM_SURVIVAL);
  disguise.setMovement(player, false); // frozen in place for the rest of the round
  applyDisguise(player);
  save();

  if (state.overtime > 0) {
    broadcast(
      `§c${player.name} went ${state.overtime}s over and loses ${fmt(state.overtime * CONFIG.overtimePenaltyPerSecond)} of hide time.`
    );
  }
  titleAll("§cSeekers, go!", seekerHint() ?? `${player.name} has locked in their spot`);
  return [];
}

/** What seekers are told about the disguise (the kind is only revealed when the mode allows just one). */
function seekerHint() {
  if (!state.rules?.morph) return undefined;
  if (state.rules.morphType === "mob") return "The hider is a mob. Hit it to find them!";
  if (state.rules.morphType === "block") return "The hider is a block. Hit it to find them!";
  return "The hider is a mob or a block. Hit it to find them!";
}

export function disguiseHint() {
  return seekerHint();
}

/** The hider picks a disguise during the hiding phase; it's applied when they lock in. */
export function chooseDisguise(player, kind, type) {
  if (state.phase !== "hiding" || player.id !== hiderId() || !state.rules?.morph) return;
  if (state.rules.morphType !== "both" && state.rules.morphType !== kind) return;
  state.disguise = { kind, type, applied: false, entityId: null };
  save();
  tell(player, `§dYou'll become ${disguise.prettyId(type)} when you lock in.`);
}

function applyDisguise(player) {
  const d = state.disguise;
  if (!state.rules?.morph || !d) return;
  if (d.kind === "mob") {
    try {
      player.addEffect("invisibility", 20000000, { amplifier: 0, showParticles: false });
    } catch {}
    disguise.emptyHands(player);
    try {
      d.entityId = disguise.spawnDecoy(player.dimension, d.type, player.location, player.getRotation().y).id;
    } catch (e) {
      console.warn(`[hs] could not spawn disguise: ${e}`);
    }
  } else {
    disguise.placeBlock(player.dimension, state.spot, d.type);
    setMode(player, GM_SPECTATOR);
  }
  d.applied = true;
}

/** Undoes the current hider's disguise. The mob stays (with the hider's name) until the next round. */
function removeDisguise() {
  const d = state.disguise;
  if (!d?.applied) return;
  const id = hiderId();
  const p = isBotId(id) ? undefined : getPlayer(id);
  if (p) {
    try {
      p.removeEffect("invisibility");
    } catch {}
    if (d.kind === "block") setMode(p, GM_SURVIVAL);
  }
  if (d.kind === "mob") {
    const e = disguise.liveEntity(d.entityId);
    if (e) {
      try {
        e.nameTag = nameOf(id);
      } catch {}
    }
  } else if (state.spot) {
    disguise.clearBlock(world.getDimension(state.spot.dimId), state.spot, d.type);
  }
  d.applied = false;
}

/** Keeps a mob disguise glued to the hider (or a bot's spot), copying where a person looks. */
function pinDecoy(hider) {
  const d = state.disguise;
  if (d?.kind !== "mob") return;
  const bot = isBotId(hiderId());
  const loc = bot ? state.spot : hider.location;
  if (!loc) return;
  let e = disguise.liveEntity(d.entityId);
  if (!e) {
    if (bot) return; // bots.hiderEntity() respawns it
    try {
      e = disguise.spawnDecoy(hider.dimension, d.type, loc);
      d.entityId = e.id;
    } catch {
      return;
    }
  }
  try {
    const rotation = bot ? undefined : { x: 0, y: hider.getRotation().y };
    e.teleport({ x: loc.x, y: loc.y, z: loc.z }, { dimension: bot ? world.getDimension(state.spot.dimId) : hider.dimension, rotation });
  } catch {}
}

function lockInBot() {
  const h = state.botHide;
  state.spot = { x: h.x, y: h.y, z: h.z, dimId: state.dimId };
  state.phase = "seeking";
  save();
  titleAll("§cSeekers, go!", `${nameOf(hiderId())} is hidden`);
}

export function canAsk(player) {
  if (state.phase !== "seeking") return "Questions open once the hider locks in.";
  if (!isSeeker(player)) return "Only seekers can ask questions.";
  const blocked = powerups.blockedReason();
  if (blocked) return blocked;
  const turn = currentAsker();
  if (turn && turn !== player.id) return `It's ${nameOf(turn)}'s turn to ask.`;
  if (state.cooldown > 0) return `Next question in ${fmt(state.cooldown)}.`;
  if (!hiderTarget()) return "The hider is offline.";
  return undefined;
}

function canTakeTurn(id) {
  return isBotId(id) || !!getPlayer(id);
}

/** Whose turn it is to ask (skipping seekers who are offline), or undefined if nobody can. */
export function currentAsker() {
  const order = state.askOrder ?? [];
  for (let i = 0; i < order.length; i++) {
    const id = order[(state.askTurn + i) % order.length];
    if (canTakeTurn(id)) {
      if (i) state.askTurn = (state.askTurn + i) % order.length;
      return id;
    }
  }
  return undefined;
}

/** Passes the question turn to the next seeker. */
export function advanceAsker() {
  const order = state.askOrder ?? [];
  if (!order.length) return;
  state.askTurn = (state.askTurn + 1) % order.length;
  state.askIdle = 0;
  currentAsker(); // skip anyone offline
  const next = currentAsker();
  if (!next) return;
  const p = getPlayer(next);
  if (p) {
    try {
      p.onScreenDisplay.setTitle(" ", { subtitle: "§bYour turn to ask a question", fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 10 });
    } catch {}
  }
}

/** Ends the current asker's turn early (they don't want to ask). */
export function passTurn(player) {
  if (state.phase !== "seeking" || currentAsker() !== player.id) return;
  broadcast(`§7${player.name} passed their turn to ask.`);
  advanceAsker();
}

/** A person asks a question from the board. Used questions can be asked again for double hider powerups. */
export function ask(asker, questionId) {
  const blocked = canAsk(asker);
  if (blocked) return tell(asker, `§c${blocked}`);
  askAs(asker, questionId);
}

/** Asks a question for any asker with name/location/dimension (a Player or a bot). */
export function askAs(asker, questionId) {
  if (findQuestion(questionId)) powerups.ask(asker, questionId);
}

/** The current challenge (definition), if one is running. */
export function activeChallenge() {
  return state.challenge ? challengeById(state.challenge.id) : undefined;
}

// ---------------------------------------------------------------------------
// Seeker teleports
// ---------------------------------------------------------------------------

/** Why this player can't teleport right now, or undefined. */
export function canTeleport(player) {
  if (state.phase !== "seeking") return "Teleporting opens once the hider locks in.";
  if (!isSeeker(player)) return "Only seekers can teleport.";
  if (state.challenge) return "No teleporting while a challenge is running.";
  const left = state.tp?.[player.id] ?? 0;
  if (left > 0) return `Next teleport in ${fmt(left)}.`;
  return undefined;
}

/** Teleports to the surface at x/z, waiting for far-away chunks to load (floating down meanwhile). */
function surfaceTeleport(player, x, z) {
  const d = world.getDimension(state.dimId);
  const top = () => {
    try {
      return d.getTopmostBlock({ x: Math.floor(x), z: Math.floor(z) });
    } catch {
      return undefined;
    }
  };
  const now = top();
  if (now) {
    try {
      player.teleport({ x, y: now.location.y + 1, z }, { dimension: d });
    } catch {}
    return;
  }
  try {
    player.addEffect("slow_falling", 600, { showParticles: false });
    player.addEffect("resistance", 600, { amplifier: 255, showParticles: false });
    player.teleport({ x, y: 250, z }, { dimension: d });
  } catch {}
  let tries = 0;
  const job = system.runInterval(() => {
    const t = top();
    if (t || ++tries > 30 || !player.isValid) {
      system.clearRun(job);
      try {
        if (t) player.teleport({ x, y: t.location.y + 1, z }, { dimension: d });
        player.removeEffect("slow_falling");
        player.removeEffect("resistance");
      } catch {}
    }
  }, 10);
}

function startTeleport(player, x, z, label) {
  state.tp ??= {};
  state.tp[player.id] = CONFIG.teleportCooldownSeconds;
  save();
  surfaceTeleport(player, x, z);
  broadcast(`§7${player.name} teleported to ${label}.`);
}

/** Seeker teleports to x/z: must be inside the play area and not in an area the answers ruled out. */
export function teleportTo(player, x, z) {
  const blocked = canTeleport(player);
  if (blocked) return tell(player, `§c${blocked}`);
  if (!insidePlayArea({ x, z }, state.center)) return tell(player, "§cThat's outside the play area.");
  if (!map.possibleAt(state, x, z)) return tell(player, "§cYou can't teleport into an area that's already ruled out.");
  startTeleport(player, x + 0.5, z + 0.5, `${Math.floor(x)}, ${Math.floor(z)}`);
}

/** Seeker teleports to a teammate (another seeker, person or bot). */
export function teleportToTeammate(player, targetId) {
  const blocked = canTeleport(player);
  if (blocked) return tell(player, `§c${blocked}`);
  const person = getPlayer(targetId);
  if (person && isSeeker(person) && person.id !== player.id) {
    state.tp ??= {};
    state.tp[player.id] = CONFIG.teleportCooldownSeconds;
    save();
    try {
      player.teleport(person.location, { dimension: person.dimension });
    } catch {}
    return broadcast(`§7${player.name} teleported to ${person.name}.`);
  }
  const bot = bots.seekerList().find((b) => b.id === targetId);
  if (bot) return startTeleport(player, bot.x, bot.z, bot.name);
  tell(player, "§cThat teammate isn't available.");
}

/** Teammates a seeker can teleport to: [{ id, name }]. */
export function teammates(player) {
  const people = world
    .getAllPlayers()
    .filter((p) => p.id !== player.id && isSeeker(p))
    .map((p) => ({ id: p.id, name: p.name }));
  return [...people, ...bots.seekerList().map((b) => ({ id: b.id, name: b.name }))];
}

// ---------------------------------------------------------------------------
// Hider radar and world border
// ---------------------------------------------------------------------------

const ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];

/** Every seeker's direction (relative to where the hider looks) and distance, nearest first. */
function seekerRadar(hider) {
  let yaw = 0;
  try {
    yaw = hider.getRotation().y;
  } catch {}
  const from = flatPos(hider);
  const list = [];
  for (const p of onlineSeekers()) {
    if (p.dimension.id !== hider.dimension.id) {
      list.push({ text: `§b${p.name} §7(other dimension)`, dist: Infinity });
      continue;
    }
    list.push({ name: p.name, color: "§b", ...flatPos(p) });
  }
  for (const b of bots.seekerList()) list.push({ name: b.name, color: "§d", x: b.x, z: b.z });
  for (const s of list) {
    if (s.text) continue;
    const dx = s.x - from.x;
    const dz = s.z - from.z;
    s.dist = Math.hypot(dx, dz);
    const rel = ((((Math.atan2(-dx, dz) * 180) / Math.PI - yaw) % 360) + 540) % 360 - 180;
    s.text = `${s.color}${s.name} ${ARROWS[((Math.round(rel / 45) % 8) + 8) % 8]} ${Math.round(s.dist)}m`;
  }
  return list
    .sort((a, b) => a.dist - b.dist)
    .map((s) => s.text)
    .join("§7 · ");
}

/** Keeps people inside the play area and shows the edge with particles when they get close. */
function enforceBorder() {
  if (!CONFIG.border || !state.center) return;
  const r = CONFIG.playAreaRadius;
  const c = state.center;
  for (const p of world.getAllPlayers()) {
    if (!isJoined(p) || p.dimension.id !== state.dimId) continue;
    const l = p.location;
    const dx = l.x - c.x;
    const dz = l.z - c.z;
    if (Math.abs(dx) > r || Math.abs(dz) > r) {
      const x = c.x + Math.max(-r + 2, Math.min(r - 2, dx));
      const z = c.z + Math.max(-r + 2, Math.min(r - 2, dz));
      let y = l.y;
      try {
        const top = p.dimension.getTopmostBlock({ x: Math.floor(x), z: Math.floor(z) });
        if (top && top.location.y + 1 > y) y = top.location.y + 1;
      } catch {}
      try {
        p.teleport({ x, y, z }, { dimension: p.dimension });
      } catch {}
      actionBar(p, "§cThat's the edge of the play area!");
      continue;
    }
    // Particle wall along any nearby edge.
    const near = CONFIG.borderWarnDistance;
    const edges = [];
    if (r - Math.abs(dx) <= near) edges.push({ axis: "x", at: c.x + Math.sign(dx) * r });
    if (r - Math.abs(dz) <= near) edges.push({ axis: "z", at: c.z + Math.sign(dz) * r });
    for (const e of edges) {
      for (let off = -8; off <= 8; off += 2) {
        for (const h of [0, 1.5, 3]) {
          const loc = e.axis === "x" ? { x: e.at, y: l.y + h, z: l.z + off } : { x: l.x + off, y: l.y + h, z: e.at };
          try {
            p.dimension.spawnParticle(CONFIG.borderParticle, loc);
          } catch {}
        }
      }
    }
  }
}

export function onEntitySpawn(entity, cause) {
  powerups.onSpawn(entity, cause);
}

export function onUseOnBlock(player, block, item) {
  powerups.onUseOnBlock(player, block, item);
}

/** Ends the current round. finder is anything with a name (Player or bot), or undefined (forced). */
export function found(finder) {
  if (state.phase !== "seeking" && state.phase !== "hiding") return;
  const id = hiderId();
  const score = state.phase === "seeking" ? currentScore() : 0;
  state.scores[id] = score;
  setBoardScore(id, score);
  removeDisguise();

  if (isBotId(id)) {
    bots.onHiderFound();
  } else {
    const hider = getPlayer(id);
    if (hider) {
      restoreNameTag(hider);
      disguise.setMovement(hider, true);
    }
  }

  const who = finder ? `${finder.name} found ${nameOf(id)}` : `${nameOf(id)}'s round ended`;
  broadcast(`§6${who}! Hide time: ${fmt(score)}`);
  titleAll(`§6${who}!`, `Hide time: ${fmt(score)}`);

  if (state.turn + 1 < state.order.length) {
    state.phase = "between";
    state.betweenLeft = CONFIG.betweenRoundsSeconds;
    save();
  } else {
    endGame();
  }
}

function endGame() {
  state.phase = "ended";
  bots.cleanup();
  disguise.removeDecoys();
  save();
  for (const p of world.getAllPlayers()) {
    restoreNameTag(p);
    if (isJoined(p)) setMode(p, GM_SURVIVAL);
  }
  const ranking = rankings();
  broadcast("§6=== Hide & Seek results ===");
  ranking.forEach((r, i) => broadcast(`§e${i + 1}. ${r.name} §f- ${fmt(r.seconds)}`));
  if (ranking.length) titleAll(`§6${ranking[0].name} wins!`, `Hidden for ${fmt(ranking[0].seconds)}`);
  runCommand("gamerule locatorbar true");
  restoreCoordinates();
}

export function rankings() {
  return state.players
    .map((p) => ({ name: p.name, seconds: state.scores[p.id] ?? 0 }))
    .sort((a, b) => b.seconds - a.seconds);
}

/** Back to the lobby, keeping the joined people (bots are removed). */
export function reset() {
  if (state.phase === "hiding" || state.phase === "seeking") removeDisguise();
  for (const p of world.getAllPlayers()) {
    restoreNameTag(p);
    if (isJoined(p) && state.phase !== "lobby") {
      setMode(p, GM_SURVIVAL);
      disguise.setMovement(p, true);
    }
  }
  if (state.phase !== "lobby") runCommand("gamerule locatorbar true");
  if (state.phase !== "lobby" && state.phase !== "ended") restoreCoordinates();
  bots.cleanup();
  disguise.removeDecoys();
  state = freshState(humans());
  save();
  clearBoard();
  broadcast("§eHide & Seek reset to the lobby.");
}

/** A seeker punching the hider (person, bot, or their mob disguise) finds them. */
export function onHit(attacker, target) {
  if (state.phase !== "seeking" || attacker?.typeId !== "minecraft:player" || !isSeeker(attacker)) return;
  const hider = hiderTarget();
  const decoy = state.disguise?.entityId;
  if ((hider && hider.id === target.id) || (decoy && decoy === target.id)) found(attacker);
}

/** A seeker hitting or breaking the hider's disguise block finds them. */
export function onBlockHit(player, location, dimension) {
  if (state.phase !== "seeking" || player?.typeId !== "minecraft:player" || !isSeeker(player)) return;
  const d = state.disguise;
  const s = state.spot;
  if (d?.kind !== "block" || !d.applied || !s || dimension.id !== s.dimId) return;
  if (location.x === Math.floor(s.x) && location.y === Math.floor(s.y) && location.z === Math.floor(s.z)) found(player);
}

// ---------------------------------------------------------------------------
// Ticking
// ---------------------------------------------------------------------------

const MAP_DEPS = { hiderId: () => hiderId(), isSeeker: (p) => isSeeker(p), seekerBots: () => bots.seekerPositions() };

/** The minimap for this player as lines of text (empty outside a round). */
export function mapLines(player, size) {
  if (state.phase !== "hiding" && state.phase !== "seeking") return [];
  return map.renderMap(state, player, size, MAP_DEPS);
}

/** Sets the action bar, with the HUD minimap above it for joined players who have it on. */
function actionBar(player, text) {
  try {
    let full = text;
    if (isJoined(player) && map.hudMapOn(player)) {
      const lines = mapLines(player, CONFIG.hudMapSize);
      if (lines.length) full = `${lines.join("\n")}\n${text}`;
    }
    player.onScreenDisplay.setActionBar(full);
  } catch {}
}

/** Runs once per second. */
export function tickSecond() {
  if (!loaded) return;
  skylines.tick(state);
  if (state.phase === "hiding" || state.phase === "seeking" || state.phase === "between") {
    forceCoordinates();
    enforceBorder();
    const gameId = state.gameId;
    terrain.ensureScan(state, () => state.gameId === gameId && state.phase !== "lobby" && state.phase !== "ended");
  }
  switch (state.phase) {
    case "hiding":
      return isBotId(hiderId()) ? tickBotHiding() : tickHiding();
    case "seeking":
      return tickSeeking();
    case "between":
      if (--state.betweenLeft <= 0) startTurn(state.turn + 1);
      return;
  }
}

function tickHiding() {
  const hider = getPlayer(hiderId());
  if (!hider) {
    for (const p of onlineSeekers()) actionBar(p, `§7Waiting for ${nameOf(hiderId())} to come back online...`);
    return;
  }
  if (state.hidingLeft > 0) {
    state.hidingLeft--;
    if (state.hidingLeft === 0) {
      tell(hider, `§cTime's up! Every second until you lock in costs you ${CONFIG.overtimePenaltyPerSecond}s of hide time.`);
    }
  } else {
    state.overtime++;
  }
  if (state.hidingLeft % 10 === 0) save();

  const timer = state.hidingLeft > 0 ? `§eBuild time: ${fmt(state.hidingLeft)}` : `§cOVERTIME +${state.overtime}s`;
  const rules = checkSpotRules(hider, state.center, state.rules ?? {}, state.disguise);
  actionBar(hider, `${timer}\n${formatRules(rules, "  ")}`);
  const seekerText =
    state.hidingLeft > 0 ? `§e${hider.name} is hiding... ${fmt(state.hidingLeft)}` : `§c${hider.name} is in overtime!`;
  for (const p of onlineSeekers()) actionBar(p, seekerText);
  bots.tickSecond();
}

function tickBotHiding() {
  bots.ensureHidePlan();
  if (state.hidingLeft > 0) state.hidingLeft--;
  else if (bots.hideReady()) return lockInBot();
  const name = nameOf(hiderId());
  const text = state.hidingLeft > 0 ? `§e${name} is hiding... ${fmt(state.hidingLeft)}` : `§e${name} is finishing their spot...`;
  for (const p of onlineSeekers()) actionBar(p, text);
  bots.tickSecond();
}

function tickSeeking() {
  const id = hiderId();
  const hider = hiderTarget();
  if (!hider) {
    for (const p of onlineSeekers()) actionBar(p, `§7Paused: ${nameOf(id)} is offline`);
    return;
  }
  state.hiderSeconds++;
  if (state.cooldown > 0) state.cooldown--;
  if (state.hiderSeconds % 10 === 0) save();
  setBoardScore(id, currentScore());

  powerups.tickSecond();
  if (state.phase !== "seeking") return;

  for (const id2 of Object.keys(state.tp ?? {})) if (state.tp[id2] > 0) state.tp[id2]--;

  if (!isBotId(id) && !leashHider(hider)) {
    const cardsText = state.hand.length ? `  §d${state.hand.length}/${CONFIG.handSize} cards` : "";
    const pick = state.offer ? "  §d§lpick your powerups (menu)" : "";
    const radar = seekerRadar(hider);
    actionBar(hider, `§aHidden for ${fmt(currentScore())}${cardsText}${pick}${radar ? `\n${radar}` : ""}`);
  }
  // Round-robin asking: a seeker who sits on a ready question too long loses their turn.
  const asker = currentAsker();
  const ready = !state.challenge && !state.pending && state.cooldown <= 0;
  if (ready && asker && !isBotId(asker)) {
    if (++state.askIdle >= CONFIG.askTurnSeconds) {
      broadcast(`§7${nameOf(asker)} took too long and missed their turn to ask.`);
      advanceAsker();
    }
  } else {
    state.askIdle = 0;
  }

  const ch = activeChallenge();
  for (const p of onlineSeekers()) {
    const mine = currentAsker() === p.id;
    const q = ch
      ? `§6CHALLENGE: ${ch.name} §7(${fmt(state.challenge.left)})`
      : state.pending
        ? "§7waiting for the hider..."
        : state.cooldown > 0
          ? `§7next question in ${fmt(state.cooldown)}${mine ? " §b(your turn next)" : ""}`
          : mine
            ? `§a§lyour turn to ask! §r§7(${fmt(CONFIG.askTurnSeconds - state.askIdle)})`
            : `§7${nameOf(currentAsker())}'s turn to ask`;
    actionBar(p, `§eSeeking ${nameOf(id)} §f${fmt(state.hiderSeconds)}  ${q}`);
  }
  bots.tickSecond();
}

/** Pulls the hider back to their locked spot if they wander. Returns true if it had to. */
function leashHider(hider) {
  const s = state.spot;
  if (!s) return false;
  const loc = hider.location;
  const far = Math.hypot(loc.x - s.x, loc.y - s.y, loc.z - s.z) > CONFIG.hiderLeash;
  if (hider.dimension.id !== s.dimId || far) {
    try {
      hider.teleport({ x: s.x, y: s.y, z: s.z }, { dimension: world.getDimension(s.dimId) });
    } catch {}
    actionBar(hider, "§cStay in your spot!");
    return true;
  }
  return false;
}

/** True if the seeker is looking straight at the hider with nothing solid in between. */
export function canSee(seeker, hider) {
  if (seeker.dimension.id !== hider.dimension.id) return false;
  let hit;
  try {
    hit = seeker
      .getEntitiesFromViewDirection({ maxDistance: CONFIG.spotDistance })
      .find((h) => h.entity.id === hider.id);
  } catch {
    return false;
  }
  if (!hit) return false;
  try {
    const block = seeker.getBlockFromViewDirection({
      maxDistance: hit.distance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });
    return !block;
  } catch {
    return true;
  }
}

/** Runs a few times per second: seekers (people and bots) spotting the hider. */
export function tickFast() {
  if (!loaded || state.phase !== "seeking") return;
  const hider = hiderTarget();
  if (!hider) return;
  if (!isBotId(hiderId())) leashHider(hider);
  if (state.disguise?.applied) {
    // Disguised hiders are only found by hitting them, so no line-of-sight check.
    pinDecoy(hider);
  } else {
    for (const seeker of onlineSeekers()) {
      if (canSee(seeker, hider)) return found(seeker);
    }
  }
  bots.tickFast(hider);
}

/** Skip the current hider's turn (they keep 0 or their time so far). */
export function skipTurn() {
  if (state.phase === "hiding" || state.phase === "seeking") found(undefined);
}
