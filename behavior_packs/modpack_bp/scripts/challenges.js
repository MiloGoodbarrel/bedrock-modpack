// Challenges the hider can force on the seekers with a Challenge card. While one is active the seekers can't
// ask questions. It ends when any seeker completes it (detected automatically) or when it times out.
//
// Detection types:
//   items:     a seeker gains one of these items (compared to what they had when the challenge started)
//   spawn:     fn(entity, cause) is true for an entity spawning within 24 blocks of a seeker
//   useItem:   a seeker uses this item on a block
//   blockAfter: a block a seeker used something on turns into this block
//   dimension: a seeker enters this dimension

//   needsMobs: only dealt when hostile mobs are on (it depends on drops that are near-impossible to get in
//              Peaceful, like gunpowder or string)

export const CHALLENGES = [
  {
    id: "fish",
    name: "Catch a fish",
    desc: "Any seeker gets a raw fish (cod, salmon, tropical fish or pufferfish).",
    items: ["minecraft:cod", "minecraft:salmon", "minecraft:tropical_fish", "minecraft:pufferfish"],
    needsMobs: true, // a fishing rod needs string, which realistically comes from spiders
  },
  {
    id: "mud",
    name: "Make mud",
    desc: "Pour a water bottle on dirt to make mud.",
    blockAfter: "minecraft:mud",
    items: ["minecraft:mud"],
  },
  {
    id: "breed_chickens",
    name: "Breed chickens",
    desc: "Feed seeds to two chickens so a baby chicken is born.",
    spawn: (e, cause) => e.typeId === "minecraft:chicken" && cause === "Born",
  },
  {
    id: "hatch_chicken",
    name: "Hatch a chicken",
    desc: "Throw eggs until a baby chicken hatches.",
    spawn: (e, cause) => e.typeId === "minecraft:chicken" && cause !== "Born" && cause !== "Loaded" && isBaby(e),
  },
  {
    id: "bonemeal",
    name: "Bonemeal a plant",
    desc: "Use bone meal on any plant or grass.",
    useItem: "minecraft:bone_meal",
  },
  {
    id: "iron_golem",
    name: "Build an iron golem",
    desc: "Build an iron golem from iron blocks and a carved pumpkin.",
    spawn: (e) => e.typeId === "minecraft:iron_golem",
  },
  {
    id: "tnt",
    name: "Ignite TNT",
    desc: "Light a block of TNT.",
    spawn: (e) => e.typeId === "minecraft:tnt",
    needsMobs: true, // gunpowder comes from creepers
  },
  {
    id: "bread",
    name: "Bake bread",
    desc: "Any seeker crafts or finds a loaf of bread.",
    items: ["minecraft:bread"],
  },
];

function isBaby(e) {
  try {
    return !!e.getComponent("minecraft:is_baby");
  } catch {
    return true;
  }
}

/** Ids of challenges that can't realistically be done with these settings (never dealt). */
export function unattainableChallenges(rules) {
  return CHALLENGES.filter((c) => c.needsMobs && rules?.peaceful).map((c) => c.id);
}

export function challengeById(id) {
  return CHALLENGES.find((c) => c.id === id);
}

export function randomChallenge() {
  return CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
}

/** How many of the challenge's items the player has. */
export function itemCount(player, items) {
  if (!items) return 0;
  let n = 0;
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    for (let i = 0; i < (inv?.size ?? 0); i++) {
      const it = inv.getItem(i);
      if (it && items.includes(it.typeId)) n += it.amount;
    }
  } catch {}
  return n;
}
