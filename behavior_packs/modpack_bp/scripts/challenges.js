// Challenges the hider can force on the seekers with a Challenge card. While one is active the seekers can't
// ask questions or teleport. It ends when a seeker actually completes it (see challengewatch.js).
//
// Each challenge says how completion is detected ("detect"), and what it needs to be attainable:
//   needsMobs:  only dealt when hostile mobs are on (it depends on drops that are near-impossible to get in
//               Peaceful, like gunpowder or string)
//   needsWater: only dealt if the play area has water (when the terrain scan says there's none, it's skipped)
//
// Detection is credited to the seeker who did it wherever the API allows (see challengewatch.js). Where it
// can't be (fish, glazed terracotta), it's an inventory count that went up, which a chest or a teammate could
// also cause. The list matches the original mod's 18 challenges.

const COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "silver",
  "cyan", "purple", "blue", "brown", "green", "red", "black"];
const GLAZED_TERRACOTTA = COLORS.map((c) => `minecraft:${c}_glazed_terracotta`);

export const CHALLENGES = [
  {
    id: "fish",
    name: "Catch a fish",
    desc: "Any seeker gets a raw fish (cod, salmon, tropical fish or pufferfish).",
    detect: "items",
    items: ["minecraft:cod", "minecraft:salmon", "minecraft:tropical_fish", "minecraft:pufferfish"],
    needsMobs: true, // a fishing rod needs string, which realistically comes from spiders
    needsWater: true,
  },
  {
    id: "mud",
    name: "Make mud",
    desc: "Pour a water bottle on dirt to turn it into mud.",
    detect: "turnsInto",
    into: "minecraft:mud",
    needsWater: true,
  },
  {
    id: "breed_animals",
    name: "Breed animals",
    desc: "Feed two animals of the same kind so a baby is born.",
    detect: "bred",
  },
  {
    id: "hatch_chicken",
    name: "Hatch a chicken",
    desc: "Throw eggs until a baby chicken hatches.",
    detect: "hatched",
  },
  {
    id: "bonemeal",
    name: "Bonemeal a plant",
    desc: "Use bone meal on a plant or grass so it grows.",
    detect: "bonemeal",
  },
  {
    id: "create_golem",
    name: "Create a golem",
    desc: "Build an iron golem or a snow golem (finish it with a carved pumpkin).",
    detect: "golem",
  },
  {
    id: "tnt",
    name: "Ignite TNT",
    desc: "Light a block of TNT with flint and steel or a fire charge.",
    detect: "tnt",
    needsMobs: true, // gunpowder comes from creepers
  },
  {
    id: "nether_portal",
    name: "Light a Nether portal",
    desc: "Build an obsidian frame and light it (the game stays in the Overworld, so don't go through).",
    detect: "portal",
  },
  {
    id: "fall_100",
    name: "Fall 100 blocks and survive",
    desc: "Any seeker drops at least 100 blocks in one fall and lives (water landings count).",
    detect: "fall",
  },
  {
    id: "break_iron_tool",
    name: "Break an iron tool",
    desc: "Use an iron pickaxe, axe, shovel, hoe or sword, shears, or flint and steel until it breaks.",
    detect: "toolBreak",
  },
  {
    id: "dye_something",
    name: "Dye something",
    desc: "Use a dye on a sheep, a cat's or wolf's collar, or a sign.",
    detect: "dye",
  },
  {
    id: "glazed_terracotta",
    name: "Get glazed terracotta",
    desc: "Any seeker gets a glazed terracotta block (smelt dyed terracotta).",
    detect: "items",
    items: GLAZED_TERRACOTTA,
  },
  {
    id: "get_poisoned",
    name: "Get poisoned",
    desc: "Any seeker gets the Poison effect (a spider eye, a poisonous potato, a pufferfish...).",
    detect: "effect",
    effect: "poison",
  },
  {
    id: "mine_diamonds",
    name: "Mine diamonds",
    desc: "Any seeker mines a diamond ore block.",
    detect: "mined",
    blocks: ["minecraft:diamond_ore", "minecraft:deepslate_diamond_ore"],
  },
  {
    id: "share_boat",
    name: "Share a boat with a mob",
    desc: "Sit in a boat together with a mob.",
    detect: "boat",
  },
  {
    id: "tame_animal",
    name: "Tame an animal",
    desc: "Tame a wolf, cat, parrot, horse or any other tameable animal.",
    detect: "tame",
  },
  {
    id: "write_book",
    name: "Write and sign a book",
    desc: "Write in a book and quill and sign it.",
    detect: "items",
    items: ["minecraft:written_book"],
  },
  {
    id: "touch_bedrock",
    name: "Touch bedrock",
    desc: "Any seeker stands on bedrock.",
    detect: "bedrock",
  },
];

/**
 * Ids of challenges that can't realistically be done with these settings / this terrain (never dealt).
 * hasWater: true / false from the terrain scan, or undefined when it isn't finished (then nothing is skipped).
 */
export function unattainableChallenges(rules, hasWater) {
  return CHALLENGES.filter((c) => (c.needsMobs && rules?.peaceful) || (c.needsWater && hasWater === false)).map((c) => c.id);
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
