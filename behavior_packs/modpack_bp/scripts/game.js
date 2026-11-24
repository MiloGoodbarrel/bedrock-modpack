import { world, system, GameMode, ItemStack, ItemLockMode, DisplaySlotId } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { checkSpotRules, formatRules } from "./rules.js";
import { findQuestion } from "./questions.js";

export const MENU_ITEM = "hs:menu";
const STATE_KEY = "hs:state";
const OBJECTIVE = "hs_time";

// Enum member casing differs between script API versions; accept either.
const GM_CREATIVE = GameMode.Creative ?? GameMode.creative;
const GM_SURVIVAL = GameMode.Survival ?? GameMode.survival;
const LOCK_INVENTORY = ItemLockMode.inventory ?? ItemLockMode.Inventory;

// ---------------------------------------------------------------------------
// State (persisted as JSON in a world dynamic property)
// ---------------------------------------------------------------------------

function freshState(players = []) {
  return {
    phase: "lobby", // lobby | hiding | seeking | between | ended
    players, // [{ id, name }] in join order
    order: [], // hider order (player ids)
    turn: -1,
    center: null, // gathering point seekers return to each round
    dimId: "minecraft:overworld",
    hidingLeft: 0,
    overtime: 0,
    hiderSeconds: 0,
    spot: null, // { x, y, z, dimId } once the hider locks in
    used: [], // question ids asked this round
    clues: [], // [{ by, text, answer }]
    cooldown: 0,
    betweenLeft: 0,
    scores: {}, // id -> final seconds
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
}

function save() {
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

function tell(player, msg) {
  player.sendMessage(msg);
}

function broadcast(msg) {
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

export function currentScore() {
  return Math.max(0, state.hiderSeconds - state.overtime * CONFIG.overtimePenaltyPerSecond);
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

/** Called when a player (re)joins the world. */
export function onPlayerSpawn(player) {
  giveMenuItem(player);
  if (isHider(player)) hideNameTag(player);
  else restoreNameTag(player);
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
  broadcast(`§a${player.name} joined Hide & Seek (${state.players.length} players).`);
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

export function start(host) {
  if (state.phase !== "lobby") return tell(host, "§cA game is already running.");
  if (state.players.length < 2) return tell(host, "§cYou need at least 2 joined players to start.");
  const offline = state.players.filter((x) => !getPlayer(x.id));
  if (offline.length) return tell(host, `§cThese players aren't online: ${offline.map((x) => x.name).join(", ")}`);

  const loc = host.location;
  state = {
    ...freshState(state.players),
    order: shuffle(state.players.map((x) => x.id)),
    center: { x: Math.floor(loc.x) + 0.5, y: Math.floor(loc.y), z: Math.floor(loc.z) + 0.5 },
    dimId: host.dimension.id,
  };
  for (const p of state.players) state.scores[p.id] = 0;
  runCommand("gamerule locatorbar false");
  resetBoard();
  broadcast(`§6Hide & Seek started! Hider order: ${state.order.map(nameOf).join(" → ")}`);
  startTurn(0);
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

function startTurn(turn) {
  state.turn = turn;
  state.phase = "hiding";
  state.hidingLeft = CONFIG.hidingSeconds;
  state.overtime = 0;
  state.hiderSeconds = 0;
  state.spot = null;
  state.used = [];
  state.clues = [];
  state.cooldown = 0;
  save();

  const id = hiderId();
  const dimension = world.getDimension(state.dimId);
  for (const p of world.getAllPlayers()) {
    if (!isJoined(p)) continue;
    if (p.id === id) {
      setMode(p, GM_CREATIVE);
      hideNameTag(p);
      tell(p, `§aYou're hiding! You have ${fmt(CONFIG.hidingSeconds)} in Creative to build your spot. Use the menu to lock in.`);
    } else {
      setMode(p, GM_SURVIVAL);
      restoreNameTag(p);
      try {
        p.teleport(state.center, { dimension });
      } catch {}
    }
  }
  titleAll(`§e${nameOf(id)} is hiding`, `Round ${turn + 1} of ${state.order.length}`);
}

/** Hider locks in their spot. Returns the failed rules (empty on success). */
export function lockIn(player) {
  if (state.phase !== "hiding" || player.id !== hiderId()) return [];
  const failed = checkSpotRules(player).filter((r) => !r.ok);
  if (failed.length) return failed;

  const loc = player.location;
  state.spot = { x: loc.x, y: loc.y, z: loc.z, dimId: player.dimension.id };
  state.phase = "seeking";
  setMode(player, GM_SURVIVAL);
  save();

  if (state.overtime > 0) {
    broadcast(
      `§c${player.name} went ${state.overtime}s over and loses ${fmt(state.overtime * CONFIG.overtimePenaltyPerSecond)} of hide time.`
    );
  }
  titleAll("§cSeekers, go!", `${player.name} has locked in their spot`);
  return [];
}

export function canAsk(player) {
  if (state.phase !== "seeking") return "Questions open once the hider locks in.";
  if (!isSeeker(player)) return "Only seekers can ask questions.";
  if (state.cooldown > 0) return `Next question in ${fmt(state.cooldown)}.`;
  if (!getPlayer(hiderId())) return "The hider is offline.";
  return undefined;
}

export function ask(asker, questionId) {
  const blocked = canAsk(asker);
  if (blocked) return tell(asker, `§c${blocked}`);
  if (state.used.includes(questionId)) return tell(asker, "§cThat question was already asked this round.");
  const found = findQuestion(questionId);
  if (!found) return;
  const hider = getPlayer(hiderId());

  const answer = found.question.answer(asker, hider);
  state.used.push(questionId);
  state.clues.push({ by: asker.name, text: found.question.text, answer });
  state.cooldown = CONFIG.questionCooldownSeconds;
  save();

  broadcast(`§b[${found.category.name}] §f${asker.name}: ${found.question.text} §e→ ${answer}`);
  for (const p of world.getAllPlayers()) {
    if (isSeeker(p) || p.id === hider.id) {
      p.onScreenDisplay.setTitle(`§e${answer}`, {
        subtitle: found.question.text,
        fadeInDuration: 5,
        stayDuration: 60,
        fadeOutDuration: 10,
      });
    }
  }
}

/** Ends the current seeking phase. finder is a Player or undefined (forced). */
export function found(finder) {
  if (state.phase !== "seeking" && state.phase !== "hiding") return;
  const id = hiderId();
  const score = state.phase === "seeking" ? currentScore() : 0;
  state.scores[id] = score;
  setBoardScore(id, score);

  const hider = getPlayer(id);
  if (hider) restoreNameTag(hider);

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
}

export function rankings() {
  return state.players
    .map((p) => ({ name: p.name, seconds: state.scores[p.id] ?? 0 }))
    .sort((a, b) => b.seconds - a.seconds);
}

/** Back to the lobby, keeping the joined players. */
export function reset() {
  for (const p of world.getAllPlayers()) {
    restoreNameTag(p);
    if (isJoined(p) && state.phase !== "lobby") setMode(p, GM_SURVIVAL);
  }
  if (state.phase !== "lobby") runCommand("gamerule locatorbar true");
  state = freshState(state.players);
  save();
  clearBoard();
  broadcast("§eHide & Seek reset to the lobby.");
}

// ---------------------------------------------------------------------------
// Ticking
// ---------------------------------------------------------------------------

function actionBar(player, text) {
  try {
    player.onScreenDisplay.setActionBar(text);
  } catch {}
}

/** Runs once per second. */
export function tickSecond() {
  if (!loaded) return;
  switch (state.phase) {
    case "hiding":
      return tickHiding();
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
  actionBar(hider, `${timer}\n${formatRules(checkSpotRules(hider), "  ")}`);
  const seekerText =
    state.hidingLeft > 0 ? `§e${hider.name} is hiding... ${fmt(state.hidingLeft)}` : `§c${hider.name} is in overtime!`;
  for (const p of onlineSeekers()) actionBar(p, seekerText);
}

function tickSeeking() {
  const hider = getPlayer(hiderId());
  if (!hider) {
    for (const p of onlineSeekers()) actionBar(p, `§7Paused: ${nameOf(hiderId())} is offline`);
    return;
  }
  state.hiderSeconds++;
  if (state.cooldown > 0) state.cooldown--;
  if (state.hiderSeconds % 10 === 0) save();
  setBoardScore(hider.id, currentScore());

  if (!leashHider(hider)) actionBar(hider, `§aHidden for ${fmt(currentScore())}`);
  const q = state.cooldown > 0 ? `§7next question in ${fmt(state.cooldown)}` : "§aquestion ready";
  for (const p of onlineSeekers()) actionBar(p, `§eSeeking ${hider.name} §f${fmt(state.hiderSeconds)}  ${q}`);
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

/** Runs a few times per second: auto-detects a seeker spotting the hider. */
export function tickFast() {
  if (!loaded || state.phase !== "seeking") return;
  const hider = getPlayer(hiderId());
  if (!hider) return;
  for (const seeker of onlineSeekers()) {
    if (canSee(seeker, hider)) return found(seeker);
  }
}

/** Skip the current hider's turn (they keep 0 or their time so far). */
export function skipTurn() {
  if (state.phase === "hiding" || state.phase === "seeking") found(undefined);
}
