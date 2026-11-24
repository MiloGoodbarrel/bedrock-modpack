# Hide & Seek for Minecraft Bedrock

A build-your-own-spot hide and seek add-on for Minecraft Bedrock Edition. Every player takes a turn as the hider:
they get five minutes in Creative to find and build a hiding spot, then the seekers hunt them down by asking
questions that narrow down where they are. The hider's clock runs until someone spots them, and the player with the
**longest total hide time wins**.

Inspired by the gameplay of EightSidedSquare's Java Hide and Seek mod, as played by The Losers, PaulGG and
ConnorIGL on YouTube. This is an independent rebuild for Bedrock. No code or assets from the original mod are used.

Works on Windows, Xbox, PlayStation, Switch, mobile and Realms. **No experimental toggles needed.**
Requires Minecraft Bedrock **1.21.90 or newer**.

## How to play

1. Everyone gets a glowing **Hide & Seek Menu** book when they join. Use it to open the menu.
2. Each player picks **Join**. The host stands where the game should start and picks **Start game**.
3. **Hiding (5 minutes):** the hider goes into Creative and builds a spot. Their screen shows a live checklist
   of the spot rules. Seekers wait at the start point.
4. **Lock in:** the hider locks in from the menu once every rule shows a green check. Going over 5 minutes costs
   1 minute of score per second of overtime.
5. **Seeking:** seekers go into Survival and search on foot. They use the menu to ask questions, which are
   answered automatically from everyone's real positions.
6. **Found:** as soon as a seeker has the hider in clear line of sight (within 24 blocks), the hider is found
   and their time goes on the scoreboard. The next player hides.
7. When everyone has hidden, the longest hide time wins.

### Spot rules

| Rule | Meaning |
|---|---|
| On Ground | Standing on a block, not flying or falling |
| Dry | Not in water, bubble columns, powder snow, or waterlogged blocks |
| Above Sea Level | At Y 63 or higher |
| Near Sky Light | Open sky within 2 blocks of the hider |

Once locked in, the hider is held to their spot.

### Questions

Each question can be asked once per hider, and there is a 1-minute cooldown between questions.

| Category | Questions |
|---|---|
| Comparing | North or south of me? · East or west of me? · Above or below me? · Same biome as me? |
| Distance | Within 500 / 250 / 100 / 50 / 25 blocks of me? (horizontal distance) |

Every answer is saved in the **Clues** log in the menu.

## Installing

### Players

1. Download `HideAndSeek.mcaddon` (or build it yourself, see below) and open it. Minecraft imports both packs.
2. Create or edit a world, go to **Behavior Packs**, and turn on **Hide & Seek BP**. The resource pack is
   added automatically.

### Realms and consoles

Turn the pack on for a world on PC, then upload that world to your Realm with **Replace World**. Players who join
on any device download the pack automatically. Replacing the world overwrites the Realm's current world, so back
it up first. To ship an update, raise the pack versions in both `manifest.json` files and upload the world again.

## Development

```
behavior_packs/modpack_bp/   # game logic (scripts/) and the menu item
resource_packs/modpack_rp/   # textures
docs/                        # reference rules and design notes
tools/                       # dev-install and build scripts
```

The scripts use the stable Script API (`@minecraft/server` 2.0.0 and `@minecraft/server-ui` 2.0.0).

- `scripts/main.js`: event wiring and timers
- `scripts/game.js`: game state, turns, scoring and found detection
- `scripts/ui.js`: menus
- `scripts/questions.js`: question definitions and answers
- `scripts/rules.js`: spot rule checks
- `scripts/config.js`: timers, distances and other settings

### Testing locally (Windows)

1. Link the packs into Minecraft's development folders. You only need to do this once:
   ```
   powershell -ExecutionPolicy Bypass -File tools\dev-install.ps1
   ```
2. Turn on **Hide & Seek BP** on a test world.
3. After editing scripts, run `/reload` in game.

Backup commands (these need cheats on): `/scriptevent hs:menu` opens the menu, `hs:give` gives the menu book,
`hs:skip` ends the current turn, and `hs:reset` returns everyone to the lobby.

### Building

```
powershell -ExecutionPolicy Bypass -File tools\build.ps1
```

This creates `dist/HideAndSeek.mcaddon`.

## Roadmap

- [x] Lobby, hider rotation, Creative build phase with a spot-rule checklist, and overtime penalty
- [x] Seeking phase, Comparing and Distance questions, clue log, automatic found detection, scoreboard
- [ ] Observation and Task questions, and re-asking a used question for double rewards
- [ ] Hider powerup cards: time bonuses, challenges and cancels, with a 5-card hand
- [ ] Mob and block disguise game modes
- [ ] A map that shrinks as questions rule out areas, plus seeker teleports

See [docs/game-rules.md](docs/game-rules.md) for the full reference rules gathered from the videos.

## Credits

Game concept: EightSidedSquare's [Hide and Seek mod](https://modrinth.com/mod/hide-plusseek) for Java Edition.
This project is not affiliated with EightSidedSquare, Mojang or Microsoft.
