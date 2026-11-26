import * as mc from "@minecraft/server";
import { world, system, GameMode, ItemStack, ItemLockMode, DisplaySlotId } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { surfaceBlock } from "./surface.js";
import { constraintsFrom, areaFraction } from "./geometry.js";
import { checkSpotRules, formatRules, flatPos, insidePlayArea } from "./rules.js";
import { findQuestion } from "./questions.js";
import { getSettings, describeSettings, morphLabel } from "./settings.js";
import * as disguise from "./disguise.js";
import * as bots from "./bots.js";
import * as map from "./map.js";
import * as powerups from "./powerups.js";
import * as terrain from "./terrain.js";
import * as skylines from "./skylines.js";
import * as watch from "./challengewatch.js";
import { roundScore, rankings as rankScores } from "./scoring.js";
import { challengeById } from "./challenges.js";

export const MENU_ITEM = "hs:menu";
const STATE_KEY = "hs:state";
const OBJECTIVE = "hs_time";

// Enum member casing differs between script API versions; accept either.
const GM_CREATIVE = GameMode.Creative ?? GameMode.creative;
const GM_SURVIVAL = GameMode.Survival ?? GameMode.survival;
const GM_SPECTATOR = GameMode.Spectator ?? GameMode.spectator;
const LOCK_INVENTORY = ItemLockMode.inventory ?? ItemLockMode.Inventory;
const LOCK_SLOT = ItemLockMode.slot ?? ItemLockMode.Slot;
const MASK_TAG = "§7Hider's mask";

/**
 * Puts a locked player head on the hider. Mob heads hide a player from other players' locator bars, so the
 * hider sees the seekers on the native locator bar but the seekers don't see the hider.
 */
function maskHider(player) {
  if (!CONFIG.hiderLocatorBar) return;
  try {
    const eq = player.getComponent("minecraft:equippable");
    if (!eq) return;
    const current = eq.getEquipment("Head");
    if (current?.nameTag === MASK_TAG) return;
    if (current) {
      // Keep whatever they were wearing: into the inventory, or dropped at their feet if it's full.
      const left = player.getComponent("minecraft:inventory")?.container?.addItem(current);
      if (left) player.dimension.spawnItem(left, player.location);
    }
    let head;
    try {
      head = new ItemStack(CONFIG.hiderHeadItem, 1);
    } catch {
      head = new ItemStack("minecraft:skeleton_skull", 1);
    }
    head.nameTag = MASK_TAG;
    try {
      if (LOCK_SLOT !== undefined) head.lockMode = LOCK_SLOT;
      head.keepOnDeath = true;
    } catch {}
    eq.setEquipment("Head", head);
  } catch (e) {
    console.warn(`[hs] could not mask hider: ${e}`);
  }
}

/** Takes the hider's mask off again (only ever removes our own head item). */
function unmask(player) {
  try {
    const eq = player.getComponent("minecraft:equippable");
    if (eq?.getEquipment("Head")?.nameTag === MASK_TAG) eq.setEquipment("Head", undefined);
  } catch {}
}

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
    centerYKnown: true, // false until a moved (map-aligned) start point's ground height is found
    tablePlaced: false, // zoom kit cartography table placed at the start point
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
    prevDaylight: null, // the daylight-cycle gamerule before the game, restored afterwards
    prevDifficulty: null, // the difficulty before the game, restored afterwards
    // Powerups (see powerups.js)
    hand: [], // the hider's cards
    offer: null, // { cards, picks, age } waiting for the hider to pick
    pending: null, // a question waiting out the hider's Cancel window
    challenge: null, // { id, left, baseline, botLeft } while seekers must complete a challenge
    usedChallenges: [], // challenge ids played this round (each once per round)
    stationTurn: "", // roundKey() the map station was last set up for
    cycle: 0, // which rotation this is (0-based); each rotation happens at a new random location
    relocating: false, // between rotations: looking for the next location
    nextCenter: null, // { x, y?, z } found for the next rotation
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
  clearLeftoverTickingAreas();
}

/**
 * Ticking areas are removed when the job that made them finishes, but a crash or a closed world mid-job would
 * leave one behind (keeping chunks loaded forever). On load, remove any of ours that aren't in use: the scan,
 * cleanup and scouting ones always (those jobs restart by themselves), and a bot hider's area unless that bot
 * is hiding right now.
 */
function clearLeftoverTickingAreas() {
  const botHiding = (state.phase === "hiding" || state.phase === "seeking") && isBotId(hiderId()) && !!state.botHide;
  const names = ["hs_scan", "hs_skyclean", "hs_scout", "hs_relocate", ...(botHiding ? [] : ["hs_hide"])];
  for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    for (const name of names) {
      try {
        world.getDimension(dimId).runCommand(`tickingarea remove ${name}`);
      } catch {}
    }
  }
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

const NOON = 6000;

function getDaylightCycle() {
  try {
    return world.gameRules.doDayLightCycle;
  } catch {
    return undefined;
  }
}

function setDaylightCycle(on) {
  try {
    world.gameRules.doDayLightCycle = on;
    return;
  } catch {}
  runCommand(`gamerule dodaylightcycle ${on}`);
}

/** It stays midday during a game: the day/night cycle is stopped and the time is held at noon. */
function forceDaylight() {
  if (getDaylightCycle() !== false) setDaylightCycle(false);
  try {
    const t = world.getTimeOfDay();
    if (Math.abs(t - NOON) > 200) world.setTimeOfDay(NOON);
  } catch {
    runCommand(`time set ${NOON}`);
  }
}

// Difficulty: Peaceful during a game (no hostile mobs, no hunger), restored afterwards.
// (Looked up optionally: older script API versions don't have the Difficulty enum.)
const PEACEFUL = mc.Difficulty?.Peaceful ?? "Peaceful";
let peacefulByCommand = false;

function getDifficulty() {
  try {
    return world.getDifficulty();
  } catch {
    return undefined;
  }
}

function setDifficulty(value, commandName) {
  try {
    world.setDifficulty(value);
    return;
  } catch {}
  if (commandName) runCommand(`difficulty ${commandName}`);
}

/** Peaceful only when the admin chose it (hostile mobs are on by default). */
function forcePeaceful() {
  if (!state.rules?.peaceful) return;
  const now = getDifficulty();
  if (now === undefined) {
    // Can't read the difficulty here: set it by command once per session instead of every second.
    if (!peacefulByCommand) runCommand("difficulty peaceful");
    peacefulByCommand = true;
    return;
  }
  if (now !== PEACEFUL) setDifficulty(PEACEFUL, "peaceful");
}

function restoreDifficulty() {
  peacefulByCommand = false;
  const prev = state.prevDifficulty;
  if (prev === null || prev === undefined) return;
  setDifficulty(prev, String(prev).toLowerCase());
}

/** Puts the day/night cycle back to how it was before the game. */
function restoreDaylight() {
  if (state.prevDaylight !== null && state.prevDaylight !== undefined) setDaylightCycle(state.prevDaylight);
}

/** Puts the coordinates setting back to how it was before the game. */
function restoreCoordinates() {
  if (state.prevCoords !== null && state.prevCoords !== undefined) setShowCoordinates(state.prevCoords);
}

/** Hide time so far: seconds hidden, minus any overtime penalty, plus time-bonus cards in hand. */
export function currentScore() {
  return roundScore({
    hiderSeconds: state.hiderSeconds,
    overtime: state.overtime,
    penaltyPerSecond: CONFIG.overtimePenaltyPerSecond,
    hand: state.hand,
    handSize: CONFIG.handSize,
  });
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
 * Swaps the player's maps for one fresh empty map, so every hider's round starts with a blank map (old lines
 * and markers are drawn into map items and would otherwise stay). Seekers get a plain map: a locator map would
 * show the hider's position. The hider gets a locator map, which shows them the seekers.
 */
function freshMap(player, isHiderPlayer, fromStation = false) {
  try {
    player.runCommand("clear @s filled_map");
  } catch {}
  try {
    player.runCommand("clear @s empty_map");
  } catch {}
  if (fromStation) {
    tell(player, "§7New round, new map: grab a blank map and 3 paper from the map station chest at the start point. Use the map, then zoom it 3 times at the cartography table (map on top, 1 paper below each time) to see the whole play area.");
    return;
  }
  try {
    // data 0 = plain empty map (no player markers), data 2 = empty locator map (shows players)
    player.runCommand(`give @s empty_map 1 ${isHiderPlayer ? 2 : 0}`);
    tell(
      player,
      isHiderPlayer
        ? "§7New round, new map: your locator map shows where the seekers are. Use it to start it, then hold it in your off hand."
        : "§7New round, new map: use your empty map to start it, then hold it in your off hand. " +
            "Red lines in the sky show up on it, marking where the hider can still be. To see the whole play area, zoom it out 3 times at a cartography table with paper (menu → How to play)."
    );
  } catch {}
}

const COMPASSES = new Set(["minecraft:compass", "minecraft:lodestone_compass", "minecraft:recovery_compass"]);

/** Seekers can't carry compasses during a round (they'd be able to make a locator map that shows the hider). */
function confiscateCompasses() {
  for (const p of onlineSeekers()) {
    try {
      const inv = p.getComponent("minecraft:inventory")?.container;
      let took = false;
      for (let i = 0; i < (inv?.size ?? 0); i++) {
        if (COMPASSES.has(inv.getItem(i)?.typeId)) {
          inv.setItem(i, undefined);
          took = true;
        }
      }
      try {
        const eq = p.getComponent("minecraft:equippable");
        if (COMPASSES.has(eq?.getEquipment("Offhand")?.typeId)) {
          eq.setEquipment("Offhand", undefined);
          took = true;
        }
      } catch {}
      if (took) tell(p, "§cNo compasses for seekers during a round: a locator map would show the hider.");
    } catch {}
  }
}

/** Called when a player (re)joins the world. */
export function onPlayerSpawn(player) {
  giveMenuItem(player);
  if (isHider(player)) hideNameTag(player);
  else restoreNameTag(player);
  // The hider keeps their locator-bar mask after rejoining (unless they're an invisible mob); nobody else wears it.
  const mobMorph = state.disguise?.applied && state.disguise.kind === "mob";
  if (isHider(player) && !mobMorph) maskHider(player);
  else unmask(player);
  // A locked-in hider stays frozen after rejoining; anyone else is unfrozen (e.g. after a crash mid-round).
  disguise.setMovement(player, !(isHider(player) && state.phase === "seeking"));
  // Someone who logged off while morphed and came back after their round ended: undo the morph's effects.
  const stillMorphed = isHider(player) && state.phase === "seeking" && state.disguise?.applied;
  try {
    if (player.hasTag(disguise.MORPH_TAG) && !stillMorphed) {
      player.removeTag(disguise.MORPH_TAG);
      player.removeEffect("invisibility");
      if (player.getGameMode?.() === GM_SPECTATOR) setMode(player, GM_SURVIVAL);
      tell(player, "§7Your disguise from an earlier round has been removed.");
    }
  } catch {}
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
  broadcast(`§a${player.name} joined Extreme Hide & Seek (${humans().length} players).`);
}

export function leave(player) {
  if (state.phase !== "lobby") return tell(player, "§cYou can't leave mid-game. Ask someone to end the game.");
  state.players = state.players.filter((x) => x.id !== player.id);
  save();
  broadcast(`§e${player.name} left Extreme Hide & Seek.`);
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

  if (host.dimension.id !== "minecraft:overworld") return tell(host, "§cStart the game in the Overworld.");
  const loc = host.location;
  const rules = getSettings();
  let center = { x: Math.floor(loc.x) + 0.5, y: Math.floor(loc.y), z: Math.floor(loc.z) + 0.5 };
  let moved = false;
  if (rules.alignToMap && host.dimension.id === "minecraft:overworld") {
    // A fully zoomed-out map covers a fixed 1024x1024 grid square. Center the play area on the one the host
    // is standing in, so a zoomed-out map shows the whole play area.
    const w = 1024;
    const snap = (v) => Math.floor((v + 64) / w) * w + w / 2 - 64;
    center = { x: snap(loc.x) + 0.5, y: Math.floor(loc.y), z: snap(loc.z) + 0.5 };
    moved = true;
  }
  state = {
    ...freshState(players),
    gameId: String(Date.now()),
    order: shuffle(players.map((x) => x.id)),
    center,
    centerYKnown: !moved,
    dimId: host.dimension.id,
    rules,
    prevCoords: getShowCoordinates() ?? false,
    prevDaylight: getDaylightCycle() ?? true,
    prevDifficulty: rules.peaceful ? getDifficulty() ?? null : null, // only touched (and restored) in Peaceful games
  };
  forceDaylight();
  forcePeaceful();
  if (moved) broadcast(`§7The play area is lined up with the map grid: the start point is ${Math.floor(center.x)}, ${Math.floor(center.z)}.`);
  for (const p of state.players) state.scores[p.id] = 0;
  // On with the hider masked (hider-only bar), or off for everyone.
  runCommand(`gamerule locatorbar ${CONFIG.hiderLocatorBar ? "true" : "false"}`);
  forceCoordinates();
  resetBoard();
  const size = CONFIG.playAreaRadius * 2;
  if (players.length > people.length) broadcast(`§6Playing solo with ${players.length - people.length} bots.`);
  broadcast(`§6Extreme Hide & Seek started! Play area: ${size}x${size} around here.`);
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
  state.usedChallenges = [];
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
      maskHider(p);
      tell(p, `§aYou're hiding! You have ${fmt(CONFIG.hidingSeconds)} in Creative to build your spot. Use the menu to lock in.`);
      if (state.rules?.morph) tell(p, `§dMorph mode (${morphLabel(state.rules.morphType)}): pick your disguise from the menu.`);
    } else {
      setMode(p, GM_SURVIVAL);
      restoreNameTag(p);
      unmask(p);
      if (state.centerYKnown) {
        try {
          p.teleport(state.center, { dimension });
        } catch {}
      } else {
        surfaceTeleport(p, state.center.x, state.center.z); // start point may be far away and unloaded
      }
    }
    // With the map station on, seekers take their blank map (and paper to zoom it) from the station chest.
    if (CONFIG.giveMaps) freshMap(p, p.id === id, !!state.rules?.zoomKit && p.id !== id);
  }
  const rotations = state.rules?.rotations ?? 1;
  const rot = rotations > 1 ? ` · rotation ${(state.cycle ?? 0) + 1} of ${rotations}` : "";
  titleAll(`§e${nameOf(id)} is hiding`, `Round ${turn + 1} of ${state.order.length}${rot}`);
}

/** Identifies the current hider's round (game, rotation, turn); stale callbacks compare against it. */
export function roundKey() {
  return `${state.gameId}:${state.cycle ?? 0}:${state.turn}`;
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
  // The hider stays in Creative (every item available) but is frozen in place for the rest of the round.
  setMode(player, GM_CREATIVE);
  disguise.setMovement(player, false);
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

/**
 * Applies the picked disguise at lock-in. The mob or block is created first, and the hider is only made
 * invisible / put in Spectator if that worked. If it fails they hide undisguised (and are told), rather than
 * ending up invisible with no mob, or a spectator with no block.
 */
function applyDisguise(player) {
  const d = state.disguise;
  if (!state.rules?.morph || !d) return;
  if (d.kind === "mob") {
    let decoy;
    try {
      decoy = disguise.spawnDecoy(player.dimension, d.type, player.location, player.getRotation().y);
    } catch (e) {
      console.warn(`[hs] could not spawn disguise: ${e}`);
    }
    if (!decoy) {
      tell(player, `§cCouldn't become a ${disguise.prettyId(d.type)} here, so you're hiding without a disguise.`);
      d.applied = false;
      return;
    }
    d.entityId = decoy.id;
    try {
      player.addEffect("invisibility", 20000000, { amplifier: 0, showParticles: false });
    } catch {}
    try {
      player.addTag(disguise.MORPH_TAG);
    } catch {}
    unmask(player); // invisible already hides them from the locator bar; a head would float in the air
    // Armor, the off-hand item and anything held would float in mid-air: put them away.
    const stuck = disguise.stripVisibleGear(player);
    disguise.emptyHands(player);
    tell(player, "§dYou're invisible: armor and your off-hand item went into your inventory, and your hands stay empty.");
    if (stuck.length) tell(player, `§cYour inventory is full, so your ${stuck.join(", ").toLowerCase()} still shows. Make room!`);
  } else {
    const original = disguise.placeBlock(player.dimension, state.spot, d.type);
    if (!original) {
      tell(player, `§cCouldn't place ${disguise.prettyId(d.type)} here, so you're hiding without a disguise.`);
      d.applied = false;
      return;
    }
    d.original = original; // what was there before, put back when the round ends
    try {
      player.addTag(disguise.MORPH_TAG);
    } catch {}
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
      p.removeTag(disguise.MORPH_TAG);
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
    disguise.clearBlock(world.getDimension(state.spot.dimId), state.spot, d.type, d.original);
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

/** A person asks a question from the board. Each question or task can be asked once per round. */
export function ask(asker, questionId) {
  const blocked = canAsk(asker);
  if (blocked) return tell(asker, `§c${blocked}`);
  if (state.used.includes(questionId)) return tell(asker, "§cThat was already asked this round.");
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

/**
 * Teleports to the surface at x/z, waiting for far-away chunks to load (floating down meanwhile). The delayed
 * landing is re-checked first: if the round has changed since, the player isn't moved again (only the
 * temporary effects are cleaned up).
 */
function surfaceTeleport(player, x, z) {
  const d = world.getDimension(state.dimId);
  const round = roundKey();
  const top = () => {
    try {
      return surfaceBlock(d, { x: Math.floor(x), z: Math.floor(z) });
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
    const stale = !player.isValid || roundKey() !== round;
    const t = stale ? undefined : top();
    if (stale || t || ++tries > 30) {
      system.clearRun(job);
      try {
        if (t) player.teleport({ x, y: t.location.y + 1, z }, { dimension: d });
        player.removeEffect("slow_falling");
        player.removeEffect("resistance");
      } catch {}
    }
  }, 10);
}

/**
 * The one check every seeker teleport destination goes through: a real number, inside the play area, and not
 * in an area the answers have ruled out. Returns the reason it's refused, or undefined if it's allowed.
 */
function destinationProblem(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return "That's not a valid location.";
  if (!insidePlayArea({ x, z }, state.center)) return "That's outside the play area.";
  if (!map.possibleAt(state, x, z)) return "You can't teleport into an area that's already ruled out.";
  return undefined;
}

function startTeleport(player, x, z, label) {
  state.tp ??= {};
  state.tp[player.id] = CONFIG.teleportCooldownSeconds;
  save();
  surfaceTeleport(player, x, z);
  broadcast(`§7${player.name} teleported to ${label}.`);
}

/** Seeker teleports to x/z (block coordinates; they land in the middle of that block). */
export function teleportTo(player, x, z) {
  const blocked = canTeleport(player);
  if (blocked) return tell(player, `§c${blocked}`);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return tell(player, "§cThat's not a valid location.");
  const tx = Math.floor(x) + 0.5;
  const tz = Math.floor(z) + 0.5;
  const problem = destinationProblem(tx, tz); // checked on the exact spot they'll land on
  if (problem) return tell(player, `§c${problem}`);
  startTeleport(player, tx, tz, `${Math.floor(x)}, ${Math.floor(z)}`);
}

/**
 * Seeker teleports back to the start point. It's the gathering point, so it's always allowed (cooldown and
 * challenge rules still apply) and says nothing about where the hider is.
 */
export function teleportToStart(player) {
  const blocked = canTeleport(player);
  if (blocked) return tell(player, `§c${blocked}`);
  const c = state.center;
  if (!c) return;
  startTeleport(player, c.x, c.z, "the start point");
}

/** Seeker teleports to a teammate (another seeker, person or bot), under the same destination rules. */
export function teleportToTeammate(player, targetId) {
  const blocked = canTeleport(player);
  if (blocked) return tell(player, `§c${blocked}`);
  const person = getPlayer(targetId);
  if (person && isSeeker(person) && person.id !== player.id) {
    if (person.dimension.id !== state.dimId) return tell(player, `§c${person.name} isn't in the play area's dimension.`);
    const l = person.location;
    const problem = destinationProblem(l.x, l.z);
    if (problem) return tell(player, `§c${person.name} is somewhere you can't teleport to. ${problem}`);
    state.tp ??= {};
    state.tp[player.id] = CONFIG.teleportCooldownSeconds;
    save();
    try {
      player.teleport(l, { dimension: person.dimension });
    } catch {}
    return broadcast(`§7${player.name} teleported to ${person.name}.`);
  }
  const bot = bots.seekerList().find((b) => b.id === targetId);
  if (bot) {
    const problem = destinationProblem(bot.x, bot.z);
    if (problem) return tell(player, `§c${bot.name} is somewhere you can't teleport to. ${problem}`);
    return startTeleport(player, bot.x, bot.z, bot.name);
  }
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

/**
 * Once the start point's chunk is loaded: fixes its height (if it was moved to line up with maps) and, with
 * the map station on, sets up the station for the current round.
 */
function settleStartPoint() {
  const c = state.center;
  if (!c) return;
  const wantStation = !!state.rules?.zoomKit && state.stationTurn !== roundKey();
  if (state.centerYKnown && !wantStation) return;
  const d = world.getDimension(state.dimId);
  if (!state.centerYKnown) {
    try {
      const top = surfaceBlock(d, { x: Math.floor(c.x), z: Math.floor(c.z) });
      if (!top) return;
      c.y = top.location.y + 1;
      state.centerYKnown = true;
      save();
    } catch {
      return;
    }
  }
  if (wantStation && setUpStation(d, c)) {
    state.stationTurn = roundKey();
    save();
  }
}

/** A block of this type on the ground at x/z (reusing one that's already there), or undefined if unloaded. */
function stationBlock(d, x, z, type) {
  const top = surfaceBlock(d, { x, z });
  if (!top) return undefined;
  if (top.typeId === type) return top;
  const above = d.getBlock({ x, y: top.location.y + 1, z });
  if (!above) return undefined;
  above.setType(type);
  return above;
}

/**
 * Map station: a cartography table and a chest next to the start point, put back if missing and the chest
 * refilled each round with one blank map and 3 paper per seeker (zoom 3 times = the whole play area).
 */
function setUpStation(d, c) {
  try {
    const x = Math.floor(c.x) + 2;
    const z = Math.floor(c.z);
    const table = stationBlock(d, x, z, "minecraft:cartography_table");
    const chest = stationBlock(d, x, z + 1, "minecraft:chest");
    if (!table || !chest) return false;
    const inv = chest.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;
    inv.clearAll();
    const seekers = humans().filter((p) => p.id !== hiderId()).length;
    for (let i = 0; i < Math.max(1, seekers); i++) {
      inv.addItem(new ItemStack("minecraft:empty_map", 1));
      inv.addItem(new ItemStack("minecraft:paper", 3));
    }
    broadcast(
      "§7Map station ready at the start point: take a blank map and 3 paper from the chest, then zoom the map " +
        "out 3 times at the cartography table to see the whole play area."
    );
    return true;
  } catch {
    return false;
  }
}

/** Keeps people inside the play area and shows the edge with particles when they get close. */
function enforceBorder() {
  if (!CONFIG.border || !state.center) return;
  const r = CONFIG.playAreaRadius;
  const c = state.center;
  for (const p of world.getAllPlayers()) {
    if (!isJoined(p)) continue;
    if (p.dimension.id !== state.dimId) {
      // Games are Overworld-only: anyone who goes through a portal is brought back to the start point.
      surfaceTeleport(p, c.x, c.z);
      tell(p, "§cThe game is Overworld-only, so you've been brought back to the start point.");
      continue;
    }
    const l = p.location;
    const dx = l.x - c.x;
    const dz = l.z - c.z;
    if (Math.abs(dx) > r || Math.abs(dz) > r) {
      const x = c.x + Math.max(-r + 2, Math.min(r - 2, dx));
      const z = c.z + Math.max(-r + 2, Math.min(r - 2, dz));
      let y = l.y;
      try {
        const top = surfaceBlock(p.dimension, { x: Math.floor(x), z: Math.floor(z) });
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
  watch.onSpawn(entity, cause);
}

export function onUseOnBlock(player, block, item) {
  watch.onUseOnBlock(player, block, item);
}

/** Ends the current round. finder is anything with a name (Player or bot), or undefined (forced). */
export function found(finder) {
  if (state.phase !== "seeking" && state.phase !== "hiding") return;
  const id = hiderId();
  const score = state.phase === "seeking" ? currentScore() : 0;
  state.scores[id] = (state.scores[id] ?? 0) + score; // totals add up across rotations
  setBoardScore(id, state.scores[id]);
  removeDisguise();

  if (isBotId(id)) {
    bots.onHiderFound();
  } else {
    const hider = getPlayer(id);
    if (hider) {
      restoreNameTag(hider);
      unmask(hider);
      disguise.setMovement(hider, true);
      setMode(hider, GM_SURVIVAL); // back out of Creative now they're found
    }
  }

  const who = finder ? `${finder.name} found ${nameOf(id)}` : `${nameOf(id)}'s round ended`;
  broadcast(`§6${who}! Hide time: ${fmt(score)}`);
  titleAll(`§6${who}!`, `Hide time: ${fmt(score)}`);

  if (state.turn + 1 < state.order.length) {
    state.phase = "between";
    state.betweenLeft = CONFIG.betweenRoundsSeconds;
    save();
  } else if ((state.cycle ?? 0) + 1 < (state.rules?.rotations ?? 1)) {
    // Everyone has hidden: go around again somewhere new.
    state.phase = "between";
    state.betweenLeft = CONFIG.betweenRoundsSeconds;
    state.relocating = true;
    state.nextCenter = null;
    save();
    broadcast("§6Everyone has hidden! Finding a new location for the next rotation...");
  } else {
    endGame();
  }
}

// ---------------------------------------------------------------------------
// Rotations: a new random location after everyone has hidden
// ---------------------------------------------------------------------------

const RELOCATE_AREA = "hs_relocate";
let relocating = false;

const waitTicks = (ticks) => new Promise((resolve) => system.runTimeout(resolve, ticks));

/** Looks for dry land far enough away that the new play area doesn't overlap the old one. */
async function findNewCenter(from, gameId) {
  const d = world.getDimension(state.dimId);
  let last;
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      if (state.gameId !== gameId || !state.relocating) return;
      const angle = Math.random() * Math.PI * 2;
      const dist = CONFIG.relocateMinDistance + Math.random() * (CONFIG.relocateMaxDistance - CONFIG.relocateMinDistance);
      const x = Math.floor(from.x + Math.cos(angle) * dist);
      const z = Math.floor(from.z + Math.sin(angle) * dist);
      last = { x, z };
      try {
        d.runCommand(`tickingarea remove ${RELOCATE_AREA}`);
      } catch {}
      try {
        d.runCommand(`tickingarea add circle ${x} 64 ${z} 1 ${RELOCATE_AREA}`);
      } catch {}
      let top;
      for (let t = 0; t < 60 && !top; t++) {
        try {
          top = surfaceBlock(d, { x, z });
        } catch {}
        if (!top) await waitTicks(5);
      }
      // Land at or above sea level, not water/lava or treetops.
      if (top && !top.isLiquid && !/leaves|log/.test(top.typeId) && top.location.y + 1 >= CONFIG.seaLevel) {
        return { x, y: top.location.y + 1, z };
      }
    }
  } finally {
    try {
      d.runCommand(`tickingarea remove ${RELOCATE_AREA}`);
    } catch {}
  }
  return last; // no dry land found: use the last pick anyway (seekers float down safely)
}

function tickRelocation() {
  if (!relocating && !state.nextCenter) {
    relocating = true;
    const gameId = state.gameId;
    findNewCenter({ ...state.center }, gameId)
      .then((c) => {
        if (c && state.gameId === gameId && state.relocating) {
          state.nextCenter = c;
          save();
        }
      })
      .catch((e) => console.warn(`[hs] relocation failed: ${e}`))
      .finally(() => {
        relocating = false;
      });
  }
  if (state.betweenLeft > 0) state.betweenLeft--;
  for (const p of world.getAllPlayers()) if (isJoined(p)) actionBar(p, "§6Finding a new location...");
  if (state.betweenLeft <= 0 && state.nextCenter) beginRotation();
}

/** Moves everyone to the new location (new border, fresh hider order) and starts the next rotation. */
function beginRotation() {
  const c = state.nextCenter;
  let center = { x: Math.floor(c.x) + 0.5, y: c.y ?? 64, z: Math.floor(c.z) + 0.5 };
  let yKnown = c.y != null;
  if (state.rules?.alignToMap) {
    const w = 1024;
    const snap = (v) => Math.floor((v + 64) / w) * w + w / 2 - 64;
    center = { x: snap(c.x) + 0.5, y: center.y, z: snap(c.z) + 0.5 };
    yKnown = false;
  }
  state.center = center;
  state.centerYKnown = yKnown;
  state.cycle = (state.cycle ?? 0) + 1;
  state.order = shuffle(state.order);
  state.relocating = false;
  state.nextCenter = null;
  state.stationTurn = "";
  state.tablePlaced = false;
  save();
  const rotations = state.rules?.rotations ?? 1;
  broadcast(`§6Rotation ${state.cycle + 1} of ${rotations}: new play area around ${Math.floor(center.x)}, ${Math.floor(center.z)}.`);
  broadcast(`§6Hider order: ${state.order.map(nameOf).join(" → ")}`);
  // startTurn moves every seeker to the new start point; then bring the first hider along too.
  startTurn(0);
  const hider = getPlayer(hiderId());
  if (hider) surfaceTeleport(hider, center.x, center.z);
}

function endGame() {
  state.phase = "ended";
  bots.cleanup();
  disguise.removeDecoys();
  save();
  for (const p of world.getAllPlayers()) {
    restoreNameTag(p);
    unmask(p);
    if (isJoined(p)) setMode(p, GM_SURVIVAL);
  }
  const ranking = rankings();
  broadcast("§6=== Extreme Hide & Seek results ===");
  ranking.forEach((r, i) => broadcast(`§e${i + 1}. ${r.name} §f- ${fmt(r.seconds)}`));
  if (ranking.length) titleAll(`§6${ranking[0].name} wins!`, `Hidden for ${fmt(ranking[0].seconds)}`);
  runCommand("gamerule locatorbar true");
  restoreCoordinates();
  restoreDaylight();
  restoreDifficulty();
}

export function rankings() {
  return rankScores(state.players, state.scores);
}

/** Back to the lobby, keeping the joined people (bots are removed). */
export function reset() {
  if (state.phase === "hiding" || state.phase === "seeking") removeDisguise();
  for (const p of world.getAllPlayers()) {
    restoreNameTag(p);
    unmask(p);
    if (isJoined(p) && state.phase !== "lobby") {
      setMode(p, GM_SURVIVAL);
      disguise.setMovement(p, true);
    }
  }
  if (state.phase !== "lobby") runCommand("gamerule locatorbar true");
  if (state.phase !== "lobby" && state.phase !== "ended") {
    restoreCoordinates();
    restoreDaylight();
    restoreDifficulty();
  }
  bots.cleanup();
  disguise.removeDecoys();
  state = freshState(humans());
  save();
  clearBoard();
  broadcast("§eExtreme Hide & Seek reset to the lobby.");
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
export function mapLines(player, size, rowLabels = false) {
  if (state.phase !== "hiding" && state.phase !== "seeking") return [];
  return map.renderMap(state, player, size, MAP_DEPS, rowLabels);
}

let areaCache = { key: "", values: [] };

/** "x% of the area left" after each clue, in order (for the clue log). Cached until a new clue arrives. */
export function clueAreaLeft() {
  if (!state.center) return [];
  const key = `${roundKey()}:${state.clues.length}`;
  if (areaCache.key === key) return areaCache.values;
  const out = [];
  const so = [];
  for (const c of state.clues) {
    so.push(c);
    out.push(areaFraction(constraintsFrom(so), state.center.x, state.center.z, CONFIG.playAreaRadius, 60));
  }
  areaCache = { key, values: out };
  return out;
}

/**
 * Seeker teleports to a square of the menu map (row 0 = A at the top, col 0 = leftmost): to the square's
 * middle if that's allowed, otherwise the allowed spot in the square closest to the middle.
 */
export function teleportToCell(player, row, col) {
  const blocked = canTeleport(player);
  if (blocked) return tell(player, `§c${blocked}`);
  const size = CONFIG.menuMapSize;
  if (!state.center || !(row >= 0 && row < size && col >= 0 && col < size)) return tell(player, "§cThat's not a map square.");
  const b = map.cellBounds(state, size, row, col);
  const mx = (b.x0 + b.x1) / 2;
  const mz = (b.z0 + b.z1) / 2;
  const spots = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const x = Math.floor(b.x0 + ((b.x1 - b.x0 - 1) * i) / n) + 0.5;
      const z = Math.floor(b.z0 + ((b.z1 - b.z0 - 1) * j) / n) + 0.5;
      spots.push({ x, z, d: Math.hypot(x - mx, z - mz) });
    }
  }
  spots.unshift({ x: Math.floor(mx) + 0.5, z: Math.floor(mz) + 0.5, d: 0 });
  spots.sort((a, c) => a.d - c.d);
  const spot = spots.find((p) => !destinationProblem(p.x, p.z));
  const name = `${map.ROW_LETTERS[row]}${col + 1}`;
  if (!spot) return tell(player, `§cSquare ${name} is completely ruled out (or outside the play area).`);
  startTeleport(player, spot.x, spot.z, `map square ${name}`);
}

function actionBar(player, text) {
  try {
    player.onScreenDisplay.setActionBar(text);
  } catch {}
}

/** Runs once per second. */
export function tickSecond() {
  if (!loaded) return;
  skylines.tick(state);
  if (state.phase === "hiding" || state.phase === "seeking" || state.phase === "between") {
    forceCoordinates();
    forceDaylight();
    forcePeaceful();
    enforceBorder();
    settleStartPoint();
    if (state.phase !== "between") confiscateCompasses();
    const gameId = state.gameId;
    terrain.ensureScan(state, () => state.gameId === gameId && state.phase !== "lobby" && state.phase !== "ended");
  }
  switch (state.phase) {
    case "hiding":
      return isBotId(hiderId()) ? tickBotHiding() : tickHiding();
    case "seeking":
      return tickSeeking();
    case "between":
      if (state.relocating) return tickRelocation();
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
  setBoardScore(id, (state.scores[id] ?? 0) + currentScore()); // total so far, including earlier rotations

  powerups.tickSecond();
  watch.tickSecond();
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
      ? `§6CHALLENGE: ${ch.name} §7(${CONFIG.challengeSeconds > 0 ? fmt(state.challenge.left) : "no questions until it's done"})`
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

const sightStreak = new Map(); // seeker id -> consecutive checks with the hider in view
let gearWarned = 0; // tick of the last "your gear shows" warning

/**
 * Keeps a disguise honest while seeking. Returns true if the round ended because of it.
 * - Mob morph (person): the hider is invisible, so anything held or worn would float. Hands are kept empty
 *   and new armor / off-hand items are put away.
 * - Block morph: if the disguise block is gone or replaced without a seeker breaking it (it fell, blew up,
 *   got pushed by a piston...), the hider has been exposed, so the round ends.
 */
function guardDisguise(hider) {
  const d = state.disguise;
  if (d.kind === "mob" && !isBotId(hiderId()) && disguise.showsGear(hider)) {
    disguise.stripVisibleGear(hider);
    disguise.emptyHands(hider);
    if (disguise.showsGear(hider) && system.currentTick - gearWarned > 200) {
      gearWarned = system.currentTick;
      tell(hider, "§cYou're invisible, but what you're holding or wearing still shows. Make room in your inventory!");
    }
  }
  if (d.kind === "block" && state.spot) {
    const s = state.spot;
    let block;
    try {
      block = world.getDimension(s.dimId).getBlock({ x: Math.floor(s.x), y: Math.floor(s.y), z: Math.floor(s.z) });
    } catch {
      return false; // not loaded: can't tell, so don't end the round
    }
    if (block && block.typeId !== d.type) {
      broadcast(`§6${nameOf(hiderId())}'s disguise block was knocked out of place!`);
      found({ name: "The seekers" });
      return true;
    }
  }
  return false;
}

/** Runs a few times per second: seekers (people and bots) spotting the hider. */
export function tickFast() {
  if (!loaded || state.phase !== "seeking") return;
  const hider = hiderTarget();
  if (!hider) return;
  if (!isBotId(hiderId())) leashHider(hider);
  const mode = state.rules?.captureMode ?? "sight";
  if (state.disguise?.applied) {
    // Disguised hiders are only found by hitting them, so no line-of-sight check.
    pinDecoy(hider);
    if (guardDisguise(hider)) return;
  } else if (mode !== "hit") {
    // "sight": spotted the moment a seeker looks at them. "sustained": they must stay in view for a while.
    const need = mode === "sustained" ? CONFIG.sustainedSightChecks : 1;
    for (const seeker of onlineSeekers()) {
      const streak = canSee(seeker, hider) ? (sightStreak.get(seeker.id) ?? 0) + 1 : 0;
      sightStreak.set(seeker.id, streak);
      if (streak >= need) {
        sightStreak.clear();
        return found(seeker);
      }
    }
  }
  watch.tickFast();
  bots.tickFast(hider);
}

/** Skip the current hider's turn (they keep 0 or their time so far). */
export function skipTurn() {
  if (state.phase === "hiding" || state.phase === "seeking") found(undefined);
}
