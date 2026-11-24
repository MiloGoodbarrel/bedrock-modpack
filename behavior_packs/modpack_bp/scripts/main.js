import { world, system } from "@minecraft/server";
import * as game from "./game.js";
import { openMenu } from "./ui.js";

world.afterEvents.worldLoad.subscribe(() => {
  game.load();
  for (const p of world.getAllPlayers()) game.onPlayerSpawn(p);
});

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  const player = event.player;
  system.runTimeout(() => {
    if (player.isValid) game.onPlayerSpawn(player);
  }, 20);
});

world.afterEvents.itemUse.subscribe((event) => {
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
