import { world, system } from "@minecraft/server";
import * as game from "./game.js";
import * as bots from "./bots.js";
import * as watch from "./challengewatch.js";
import { openMenu } from "./ui.js";

// Punching the hider (person or bot) finds them.
world.afterEvents.entityHitEntity.subscribe((event) => {
  game.onHit(event.damagingEntity, event.hitEntity);
});

// Hitting or breaking a disguised hider's block finds them.
world.afterEvents.entityHitBlock.subscribe((event) => {
  game.onBlockHit(event.damagingEntity, event.hitBlock.location, event.hitBlock.dimension);
});
world.beforeEvents.explosion?.subscribe((event) => game.beforeExplosion(event)); // blown-up blocks count as dug
world.afterEvents.playerBreakBlock.subscribe((event) => {
  watch.onBreak(event.player, event.brokenBlockPermutation); // mine-diamonds challenge
  game.onBreakBlock(event.player, event.block.location); // dug-out blocks (Open Spot rule)
  game.onBlockHit(event.player, event.block.location, event.block.dimension);
});

// Challenge detection (challengewatch.js): who fed chickens, threw eggs, placed a golem's pumpkin or lit TNT,
// and whether using an item on a block really changed it. Optional subscriptions (?.) so a missing event on
// some game version can't stop the whole add-on from loading.
world.afterEvents.entitySpawn.subscribe((event) => {
  game.onEntitySpawn(event.entity, event.cause);
});
world.beforeEvents.playerInteractWithBlock?.subscribe((event) => {
  game.beforeUseOnBlock(event); // stops the hider placing unbreakable blocks (may cancel the event)
  if (!event.cancel) watch.beforeUseOnBlock(event.player, event.block, event.itemStack);
});
world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  game.onUseOnBlock(event.player, event.block, event.beforeItemStack ?? event.itemStack);
});
world.afterEvents.playerPlaceBlock?.subscribe((event) => {
  game.onPlaceBlock(event.player, event.block); // backup: removes unbreakable blocks the hider placed
  watch.onPlace(event.player, event.block);
});
world.afterEvents.playerInteractWithEntity?.subscribe((event) => {
  watch.onInteractEntity(event.player, event.target, event.beforeItemStack ?? event.itemStack);
});

// A seeker dying gives the hider a powerup.
world.afterEvents.entityDie.subscribe((event) => game.onEntityDie(event.deadEntity));

// Bot entities left behind in chunks that were unloaded get cleaned up when they load again.
world.afterEvents.entityLoad?.subscribe((event) => bots.onEntityLoad(event.entity));

world.afterEvents.worldLoad.subscribe(() => {
  game.load();
  for (const p of world.getAllPlayers()) game.onPlayerSpawn(p);
});

world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;
  if (!event.initialSpawn) {
    // Respawning after death: Bedrock puts you on the highest block, which can be the sky lines.
    system.runTimeout(() => {
      if (player.isValid) game.onRespawn(player);
    }, 2);
    return;
  }
  system.runTimeout(() => {
    if (player.isValid) game.onPlayerSpawn(player);
  }, 20);
});

world.afterEvents.itemUse.subscribe((event) => {
  watch.onItemUse(event.source, event.itemStack); // eggs, for the hatch-a-chicken challenge
  game.onItemUse(event.source, event.itemStack); // fire charge / firework tasks
  if (event.itemStack?.typeId !== game.MENU_ITEM) return;
  const player = event.source;
  system.run(() => openMenu(player));
});

// Fallback commands, e.g. `/scriptevent hs:menu` or `/scriptevent hs:reset`.
system.afterEvents.scriptEventReceive.subscribe((event) => {
  const player = event.sourceEntity?.typeId === "minecraft:player" ? event.sourceEntity : undefined;
  switch (event.id) {
    case "hs:menu":
      if (player) system.run(() => openMenu(player));
      break;
    case "hs:give":
      if (player) game.giveMenuItem(player);
      break;
    case "hs:skip":
      game.skipTurn();
      break;
    case "hs:reset":
      game.reset();
      break;
  }
});

system.runInterval(() => game.tickSecond(), 20);
system.runInterval(() => game.tickFast(), 4);
