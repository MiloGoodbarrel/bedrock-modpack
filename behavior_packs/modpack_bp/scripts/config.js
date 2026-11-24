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
  // A seeker "finds" the hider by looking straight at them, unobstructed, within this range.
  spotDistance: 24,
  // After locking in, the hider may not stray further than this from their spot.
  hiderLeash: 1.5,
  // Delay between one hider being found and the next hiding phase starting.
  betweenRoundsSeconds: 8,
};
