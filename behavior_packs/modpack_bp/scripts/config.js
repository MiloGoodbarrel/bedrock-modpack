// Tunable game settings. Times are in seconds, distances in blocks.
export const CONFIG = {
  // How long the hider has (in Creative) to build their spot.
  hidingSeconds: 300,
  // House rule from the video: every second over the hiding timer costs this many seconds of score.
  overtimePenaltyPerSecond: 60,
  // Minimum gap between seeker questions.
  questionCooldownSeconds: 60,
  // Seekers take turns asking (round robin). Once a question is ready, the seeker whose turn it is has this
  // long to ask before the turn passes to the next seeker.
  askTurnSeconds: 60,
  // Hider powerups: hand limit, how long the hider has to play Cancel on a question, and how long they have to
  // pick cards before the best ones are picked for them.
  handSize: 5,
  cancelWindowSeconds: 10,
  offerSeconds: 45,
  // A challenge blocks all questions (and teleports) until a seeker completes it. 0 = no time limit; set a
  // number of seconds to let challenges expire instead.
  challengeSeconds: 0,
  // Hider rule: "Above Sea Level" means feet at or above this Y.
  seaLevel: 63,
  // Hider rule: "Near Sky Light" checks columns within this many blocks for open sky.
  skyLightRadius: 2,
  // Hider rule: "Open to Outside" (admin toggle) must reach open sky through see-through blocks within this
  // many blocks of the hider (glass doesn't count). Stops sealed bunkers, trapdoor pits and tunnels.
  openToOutsideSteps: 6,
  // ...or the hider must be in a natural open space (a cave, a ravine) at least this many blocks big. Blocks the
  // hider dug out or blew up don't count, so hand-dug pits, tunnels and bunkers still fail.
  naturalSpaceBlocks: 30,
  // Half the width of the square play area, centered on where the game starts (500 = 1000x1000).
  playAreaRadius: 500,
  // A seeker "finds" the hider by looking straight at them, unobstructed, within this range.
  spotDistance: 24,
  // "Sustained sight" capture mode (admin setting): checks in a row (5 per second) the hider must stay in view.
  sustainedSightChecks: 5,
  // How often each powerup card is drawn (relative weights). The original mod's odds aren't known.
  cardWeights: { time3: 25, time5: 14, time10: 6, cancel: 12, challenge: 20 },
  // Locked-in hiders can't walk (looking around and using blocks still works). As a backup, a hider who
  // ends up further than this from their spot (pushed, knocked back, or walking isn't lockable) is put back.
  hiderLeash: 0.4,
  // Delay between one hider being found and the next hiding phase starting.
  betweenRoundsSeconds: 8,
  // Native locator bar for the hider only: the bar is turned on during games and the hider wears a locked
  // player head, which (like in Java) should hide them from other players' bars. If seekers can still see
  // the hider on their bar, set this to false: the bar is then off for everyone during games.
  hiderLocatorBar: true,
  hiderHeadItem: "minecraft:player_head",
  // Nobody starts in water: a start point on water moves to the nearest land within this many blocks, and
  // gets a plank platform built on the water if there's none.
  startLandSearch: 96,
  // Rotations (admin setting): after everyone has hidden, everyone moves to a new random location this far from
  // the old start point (far enough that the new play area doesn't overlap the old one).
  relocateMinDistance: 1500,
  relocateMaxDistance: 3000,
  // Seekers can teleport (menu → Teleport) once per this many seconds, never into ruled-out areas or during a
  // challenge.
  teleportCooldownSeconds: 60,
  // Scripted world border around the play area: players who cross it are put back inside, and particles
  // show the edge when someone is within borderWarnDistance of it.
  border: true,
  borderWarnDistance: 12,
  borderParticle: "minecraft:villager_happy",
  // Red lines at build height outlining where the hider can still be, so they show on real map items. Drawn
  // near players, skyLineWidth blocks wide (wider shows better on zoomed-out maps), a few chunks per second.
  // Everyone gets a fresh empty locator map each round.
  skyLines: true,
  // Height for the sky lines and fill. null = build height (the top block the world allows, Y 319 normally).
  skyLineY: null,
  skyLineWidth: 4,
  // Red wool top slab (lets light through); full red wool if this game version has no wool slabs.
  skyLineBlock: "minecraft:red_wool_slab",
  skyLineStates: { "minecraft:vertical_half": "top" },
  skyLineFallback: "minecraft:red_wool",
  skyLineChunksPerSecond: 8,
  giveMaps: true,
  // Scan the play area's terrain in the background so the map shows water, forests, snow... (saved per start
  // point). terrainGrid samples per side: 25 = one sample every 40 blocks on a 1000-block area.
  terrainScan: true,
  terrainGrid: 25,
  // Menu map grid size (cells per side).
  menuMapSize: 15,

  // --- Bots ----------------------------------------------------------------
  // Bots added when only one person joins (0 turns solo play off).
  botsWhenSolo: 2,
  botNames: ["Bot Steve", "Bot Alex", "Bot Sam", "Bot Riley"],
  // How long seekers wait while a bot hides.
  botHidingSeconds: 30,
  // Bot hiders pick a spot at least this far from the start point.
  botMinHideDistance: 100,
  // Walking speed in blocks per second (a player walks about 4.3).
  botWalkSpeed: 4.3,
  // Half-angle of a bot's field of view, in degrees.
  botFov: 70,
  // A bot must see the hider this many checks in a row (5 per second) to find them.
  botSightChecks: 3,
  // A bot this close to the hider finds them even without line of sight.
  botTouchRange: 2.5,
  // Area a bot counts as searched once it has walked to a point.
  botSearchRadius: 10,
  // Bots appear in the world when this close to a person (or a bot's hiding spot).
  botActiveRange: 48,
};
