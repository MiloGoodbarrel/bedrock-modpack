// Seeker questions. Each answer() gets the asker and the hider (anything with `location`, plus `dimension`
// for biome checks: players, bot entities, or plain objects) and returns the answer string.
// "Me" always means the seeker who asked. `planar` questions depend only on x/z, so bots can use them
// to rule out areas.

function biomeId(player) {
  try {
    if (typeof player.dimension.getBiome !== "function") return undefined;
    return player.dimension.getBiome(player.location)?.id;
  } catch {
    return undefined;
  }
}

function prettyBiome(id) {
  return id ? id.replace("minecraft:", "").replace(/_/g, " ") : "unknown";
}

const DISTANCES = [500, 250, 100, 50, 25];

export const CATEGORIES = [
  {
    id: "comparing",
    name: "Comparing",
    reward: "Draw 3, pick 2",
    questions: [
      {
        id: "north_south",
        text: "Are you north or south of me?",
        planar: true,
        answer: (asker, hider) => (hider.location.z < asker.location.z ? "North" : "South"),
      },
      {
        id: "east_west",
        text: "Are you east or west of me?",
        planar: true,
        answer: (asker, hider) => (hider.location.x > asker.location.x ? "East" : "West"),
      },
      {
        id: "above_below",
        text: "Are you above or below me?",
        answer: (asker, hider) => (hider.location.y > asker.location.y ? "Above" : "Below"),
      },
      {
        id: "same_biome",
        text: "Is your biome the same as mine?",
        answer: (asker, hider) => {
          const a = biomeId(asker);
          const h = biomeId(hider);
          if (!a || !h) return "Unknown (biome check not supported on this game version)";
          return a === h ? `Yes (${prettyBiome(a)})` : `No (not ${prettyBiome(a)})`;
        },
      },
    ],
  },
  {
    id: "distance",
    name: "Distance",
    reward: "Draw 2, pick 2",
    questions: DISTANCES.map((r) => ({
      id: `within_${r}`,
      text: `Are you within ${r} blocks of me?`,
      planar: true,
      radius: r,
      answer: (asker, hider) => {
        const dx = hider.location.x - asker.location.x;
        const dz = hider.location.z - asker.location.z;
        return Math.hypot(dx, dz) <= r ? "Yes" : "No";
      },
    })),
  },
];

export function findQuestion(id) {
  for (const cat of CATEGORIES) {
    const q = cat.questions.find((x) => x.id === id);
    if (q) return { category: cat, question: q };
  }
  return undefined;
}
