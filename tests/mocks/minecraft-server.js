// A small fake of @minecraft/server for running the add-on's modules in a browser (see tests/run.html, which
// maps "@minecraft/server" here with an import map). Only what the tested modules touch is implemented.
// Tests build worlds with makeDimension() and fake players with makePlayer().

export const GameMode = { Creative: "Creative", Survival: "Survival", Spectator: "Spectator", Adventure: "Adventure" };
export const ItemLockMode = { inventory: "inventory", slot: "slot", none: "none" };
export const DisplaySlotId = { Sidebar: "Sidebar" };
export const InputPermissionCategory = { Movement: 0 };

export const system = {
  currentTick: 0,
  run: (fn) => fn(),
  runTimeout: () => 0,
  runInterval: () => 0,
  clearRun: () => {},
  afterEvents: { scriptEventReceive: { subscribe() {} } },
};

export class BlockPermutation {
  constructor(id, states = {}) {
    this.type = { id };
    this.states = states;
  }
  static resolve(id, states = {}) {
    if (!id || typeof id !== "string") throw new Error("bad block id");
    return new BlockPermutation(id, states);
  }
  getAllStates() {
    return { ...this.states };
  }
}

export class ItemStack {
  constructor(typeId, amount = 1) {
    this.typeId = typeId;
    this.amount = amount;
  }
  getComponent() {
    return undefined;
  }
}

const LIQUIDS = new Set(["minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava"]);

/**
 * A fake dimension. blocks: { "x,y,z": "minecraft:stone" | { typeId, waterlogged } }. Anything unset is air.
 * unloaded(x, z) -> true makes those columns throw like an unloaded chunk.
 */
export function makeDimension({ id = "minecraft:overworld", blocks = {}, unloaded = () => false, minY = -64, maxY = 320 } = {}) {
  const map = new Map(Object.entries(blocks).map(([k, v]) => [k, typeof v === "string" ? { typeId: v } : { ...v }]));
  const dim = {
    id,
    spawned: [],
    heightRange: { min: minY, max: maxY },
    getBlock(loc) {
      const x = Math.floor(loc.x);
      const y = Math.floor(loc.y);
      const z = Math.floor(loc.z);
      if (unloaded(x, z)) throw new Error("LocationInUnloadedChunkError");
      if (y < minY || y >= maxY) return undefined;
      return blockAt(dim, map, x, y, z);
    },
    getTopmostBlock(xz) {
      const x = Math.floor(xz.x);
      const z = Math.floor(xz.z);
      if (unloaded(x, z)) throw new Error("LocationInUnloadedChunkError");
      for (let y = maxY - 1; y >= minY; y--) {
        const b = map.get(`${x},${y},${z}`);
        if (b && b.typeId !== "minecraft:air") return blockAt(dim, map, x, y, z);
      }
      return undefined;
    },
    getBlockFromRay(origin, dir) {
      // Only straight down is needed (surface.js).
      const x = Math.floor(origin.x);
      const z = Math.floor(origin.z);
      for (let y = Math.floor(origin.y); y >= minY; y--) {
        const b = map.get(`${x},${y},${z}`);
        if (b && b.typeId !== "minecraft:air") return { block: blockAt(dim, map, x, y, z) };
      }
      return undefined;
    },
    spawnEntity(typeId, loc) {
      const e = { typeId, location: loc, isValid: true, id: `e${dim.spawned.length}` };
      dim.spawned.push(e);
      return e;
    },
    spawnItem(item, loc) {
      dim.spawned.push({ typeId: "minecraft:item", item, location: loc, isValid: true });
      return {};
    },
    getEntities() {
      return [];
    },
    set(x, y, z, typeId) {
      map.set(`${x},${y},${z}`, { typeId });
    },
    typeAt(x, y, z) {
      return map.get(`${x},${y},${z}`)?.typeId ?? "minecraft:air";
    },
  };
  return dim;
}

function blockAt(dim, map, x, y, z) {
  const data = map.get(`${x},${y},${z}`) ?? { typeId: "minecraft:air" };
  return {
    typeId: data.typeId,
    location: { x, y, z },
    dimension: dim,
    isAir: data.typeId === "minecraft:air",
    isLiquid: LIQUIDS.has(data.typeId),
    isWaterlogged: !!data.waterlogged,
    permutation: new BlockPermutation(data.typeId, data.states ?? {}),
    above: () => dim.getBlock({ x, y: y + 1, z }),
    below: () => dim.getBlock({ x, y: y - 1, z }),
    setPermutation(p) {
      map.set(`${x},${y},${z}`, { typeId: p.type.id, states: p.states });
    },
    setType(t) {
      map.set(`${x},${y},${z}`, { typeId: t });
    },
  };
}

export function makePlayer({ dimension, x = 0.5, y = 64, z = 0.5, onGround = true, inWater = false, name = "Tester", id = "p1" }) {
  return {
    id,
    name,
    typeId: "minecraft:player",
    dimension,
    location: { x, y, z },
    isOnGround: onGround,
    isInWater: inWater,
    isValid: true,
    hasTag: () => false,
  };
}

const overworld = makeDimension();
export const world = {
  getDimension: () => overworld,
  getAllPlayers: () => [],
  getEntity: () => undefined,
  getDynamicProperty: () => undefined,
  setDynamicProperty: () => {},
  sendMessage: () => {},
  afterEvents: new Proxy({}, { get: () => ({ subscribe() {} }) }),
  beforeEvents: new Proxy({}, { get: () => ({ subscribe() {} }) }),
  scoreboard: { getObjective: () => undefined, addObjective: () => ({ setScore() {} }), removeObjective() {}, setObjectiveAtDisplaySlot() {} },
};
