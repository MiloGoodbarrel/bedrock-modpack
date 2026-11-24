// Tunable game settings. Times are in seconds, distances in blocks.
export const CONFIG = {
  // How long the hider has (in Creative) to build their spot.
  hidingSeconds: 300,
  // House rule from the video: every second over the hiding timer costs this many seconds of score.
  overtimePenaltyPerSecond: 60,
  // Minimum gap between seeker questions.
  questionCooldownSeconds: 60,
  // Hider rule: "Above Sea Level" means feet at or above this Y.
  seaLevel: 63,
  // Hider rule: "Near Sky Light" checks columns within this many blocks for open sky.
  skyLightRadius: 2,
  // Half the width of the square play area, centered on where the game starts (500 = 1000x1000).
  playAreaRadius: 500,
  // A seeker "finds" the hider by looking straight at them, unobstructed, within this range.
  spotDistance: 24,
  // After locking in, the hider may not stray further than this from their spot.
  hiderLeash: 1.5,
  // Delay between one hider being found and the next hiding phase starting.
  betweenRoundsSeconds: 8,

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
  // When people are seeking too, bots wait this long after the cooldown before asking, so people get first pick.
  botAskDelay: 20,
};
