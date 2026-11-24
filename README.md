# Hide & Seek for Minecraft Bedrock

A build-your-own-spot hide and seek add-on for Minecraft Bedrock Edition. Every player takes a turn as the hider:
they get five minutes in Creative to find and build a hiding spot, then the seekers hunt them down by asking
questions that narrow down where they are. The hider's clock runs until someone spots them, and the player with the
**longest total hide time wins**.

Inspired by the gameplay of EightSidedSquare's Java Hide and Seek mod, as played by The Losers, PaulGG and
ConnorIGL on YouTube. This is an independent rebuild for Bedrock. No code or assets from the original mod are used.

Works on Windows, Xbox, PlayStation, Switch, mobile and Realms. **No experimental toggles needed.**
Requires Minecraft Bedrock **1.21.90 or newer**.

> **Status:** early development (v0.10.0). Every feature below is written, but none of it has been playtested
> in game yet, so expect bugs. Please report anything that shows up in the Content Log (Settings → Creator).

## How to play

1. Everyone gets a glowing **Hide & Seek Menu** book when they join. Use it to open the menu.
2. Each player picks **Join**. The host stands where the game should start and picks **Start game**.
   The play area is a 1000×1000 square centered on that spot.
3. **Hiding (5 minutes):** the hider goes into Creative and builds a spot. Their screen shows a live checklist
   of the spot rules. Seekers wait at the start point.
4. **Lock in:** the hider locks in from the menu once every rule shows a green check. Going over 5 minutes costs
   1 minute of score per second of overtime.
5. **Seeking:** the hider is frozen in place, and the seekers go into Survival and search. They ask questions
   from the question board (answered automatically from everyone's real positions), watch the map black out
   ruled-out areas, and can teleport once a minute. Every question earns the hider powerup cards.
6. **Found:** as soon as a seeker has the hider in clear line of sight (within 24 blocks), or hits them, the
   hider is found and their time goes on the scoreboard. A disguised hider has to be hit. The next player
   hides.
7. When everyone has hidden, the longest hide time (including time-bonus cards) wins.

### Admin settings

The world's admin (anyone with operator permission, which includes the owner in single player and on a
Realm) gets a **Game settings** button in the lobby. Settings are saved with the world and lock in when a
game starts.

| Setting | Options |
|---|---|
| Morph mode | Off / On |
| Morph into | Mobs · Blocks · Mobs or blocks (hider picks) |
| Height limit | No limit · Y 80 / 100 / 120 / 160 / 200 |
| Allow hiding in water | Removes the Dry rule |
| Allow hiding in the Nether | Nether spots count 8× for directions and distances. No sky light rule there |
| Allow hiding in the End | No play-area or sea-level rule there |

To make someone an admin without operator permission, run `/tag <name> add hs_admin`.

### Morph mode

With morph mode on, the hider picks a disguise from the menu before locking in:

- **Mob:** the hider turns invisible and can't walk, but can still look around. A real mob of the chosen
  type stays on their spot and copies where they look.
- **Block:** the chosen block (from a list, or whatever block you're holding) appears where the hider stands,
  and the hider watches from inside it. It can't be the same as any block touching it.

Disguised hiders can't be found by sight. Seekers have to **hit** the suspicious mob or block. Bot hiders
disguise themselves too, and bot seekers find a disguised hider by walking right up to it.

### Solo play

If only one person joins, two bots join the game. Bots look like players and take full turns:

- **Bot hiders** pick a spot somewhere in the play area that passes the spot rules, plant a leafy bush around
  it, and wait. You have 30 seconds before you can start seeking.
- **Bot seekers** take their turns asking like everyone else, picking whichever question narrows things down
  most (or passing if nothing helps). They use every answer to rule out areas, split up to search what's
  left, and find you by sight. They also find you if they walk right up to you.

Bots only appear in the world near people (or near a bot's hiding spot). Further away they keep moving in the
background, so they never load far-off chunks.

### Spot rules

| Rule | Meaning |
|---|---|
| On Ground | Standing on a block, not flying or falling |
| Dry | Not in water, bubble columns, powder snow, or waterlogged blocks |
| Above Sea Level | At Y 63 or higher |
| Near Sky Light | Open sky within 2 blocks of the hider |
| Inside Play Area | Within the 1000×1000 square around the start point |

Once locked in, the hider is frozen in place. They can still look around and use or break blocks within
reach, but they can't walk. Coordinates are forced on for everyone during a game, and the setting goes back
to how it was once the game ends.

### Questions

Seekers ask from the **question board** (menu → Questions), with a 1-minute cooldown between questions. Asked
questions are greyed out, but they can be asked again, which gives the hider double powerups.

**Seekers take turns asking (round robin)**, so one seeker can't ask every question. The asking order is shown
in the seeker menu and above the hotbar, and it starts with a different seeker each round. Once a question is
ready, the seeker whose turn it is has 60 seconds to ask. They can also pass. Otherwise the turn moves on.
Offline seekers are skipped, and bots take their turns too.

| Category | Hider earns | Questions |
|---|---|---|
| Comparing | Draw 3, pick 2 | North or south of me? · East or west of me? · Above or below me? · Same biome? · Same dimension? |
| Distance | Draw 2, pick 2 | Within 500 / 250 / 100 / 50 / 25 blocks of me? (horizontal distance) |
| Observation | Draw 2, pick 1 | Standing on grass? · On leaves? · On the same block as me? · Water within 4? · Lava within 6? · Snow within 4? · Flowers within 4? · Mobs within 16? · Open sky above you? |
| Task | Draw 1, pick 1 | Launch a firework · Light a fire · Spawn a bee · Spawn a farm animal · Place gravel · Place sand · Place the block I'm standing on |

Tasks happen automatically right next to the hider, so they can't be skipped. Every answer is saved in the
**Clues** log.

### Teleporting, radar and border

- **Teleport (seekers):** from the menu, teleport to a teammate, to typed-in coordinates, or back to the
  start point. You can do this once a minute, but not into ruled-out (dark) areas and not while a challenge
  is running. Far-away chunks load in while you float down.
- **Seeker radar (hider):** above the hotbar, the hider sees every seeker's direction (an arrow relative to
  where they're looking) and distance. The vanilla locator bar stays off, because it's world-wide and would
  show the hider to the seekers too.
- **World border:** Bedrock has no world border command, so the add-on scripts one. A particle wall appears
  when you get within 12 blocks of the edge, and anyone who crosses it is put back inside.

### Hider powerups

Every question earns the hider cards. They pick from a "Pick N Powerups" screen, can hold 5 cards, and must
discard any extras.

- **Time Bonus (3 / 5 / 10 min):** added to the hider's time while the card is in their hand.
- **Cancel:** when a question is asked, a hider holding Cancel gets 10 seconds to block it. The seekers get
  no answer, and the hider earns nothing for that question.
- **Challenge:** stops all questions until a seeker completes it. Options: catch a fish, make mud, breed
  chickens, hatch a chicken, bonemeal a plant, build an iron golem, ignite TNT, enter the Nether, or get
  bread. Completion is detected automatically. A challenge times out after 5 minutes so an impossible one
  can't stall the game.

### Map

The play area is drawn as a grid of colored squares, with north at the top. When a game starts, the add-on
scans the play area's terrain in the background, sampling every 40 blocks. This takes a few minutes, about
one build phase. After that the map shows water, ice, grass, forest, sand, badlands, snow, stone and lava.
The scan is saved, so later games from the same start point skip it.

As answers come in, ruled-out squares turn black and partly ruled-out squares turn dark grey. Players show up
as colored dots, and the hider only appears on their own map. The blackout starts over with each new hider.
There are two versions:

- **HUD minimap:** a small 9×9 map above the hotbar. It's on by default, and each player can turn it on or
  off with the **HUD minimap** button in the menu.
- **Map** (menu button): a bigger 15×15 map with a legend and the scan's progress.

### Real maps: red lines in the sky

The ordinary map item works too. Add-ons can't draw on maps, but a map shows the highest block in each column.
So during a round, the add-on places a band of **red wool high in the sky (Y 316)** along the edge of where
the hider can still be. Before any answers, that edge is the play area's square border. After each answer it's
the new, smaller shape.

- **Every hider's round starts with a clean map.** At the start of each turn, everyone's maps are taken away
  and replaced with one fresh **empty locator map**, so old lines and markers are gone. Use it to start
  mapping, then hold it in your off hand. The map fills in as you explore, and the red outline appears on it.
- Lines are drawn only in chunks near players, a few per second. Those are the only places maps update anyway.
- Old lines from an earlier answer, round or game are cleared in the background, including far-away ones,
  which get loaded briefly to do it. The sky is clean again shortly after each new round starts.
- A fresh map covers 128×128 blocks. Zoom out at a cartography table (with paper) to see more. The lines are
  4 blocks wide so they still show on zoomed-out maps; `skyLineWidth` in config.js changes that.

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
behavior_packs/modpack_bp/   # game logic (scripts/), the menu item, the bot entity
resource_packs/modpack_rp/   # textures, bot model
docs/                        # reference rules and design notes
tools/                       # dev-install and build scripts
```

The scripts use the stable Script API (`@minecraft/server` 2.0.0 and `@minecraft/server-ui` 2.0.0).

- `scripts/main.js`: event wiring and timers
- `scripts/game.js`: game state, turns, scoring and found detection
- `scripts/bots.js`: AI players for solo games
- `scripts/disguise.js`: mob and block morphs
- `scripts/settings.js`: admin game settings
- `scripts/map.js`, `terrain.js`: the minimap and the background terrain scan
- `scripts/skylines.js`: red sky lines that show the search area on real map items
- `scripts/powerups.js`, `cards.js`, `challenges.js`: answers, hider cards, Cancel and challenges
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
3. After editing scripts, run `/reload` in game. Changes to entities, items or the resource pack need you to
   leave and re-enter the world.

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
- [x] Solo play against two bots, and a 1000×1000 play area
- [x] Observation and Task questions, and re-asking a used question for double rewards
- [x] Hider powerup cards: time bonuses, challenges and cancels, with a 5-card hand
- [x] Admin game settings: mob and block morph modes, height limit, water / Nether / End hiding
- [x] A map that blacks out areas as questions rule them out (HUD minimap and menu map)
- [x] Seeker teleports, hider seeker radar, scripted world border
- [ ] First full playtest and bug fixes
- [x] Terrain scan, so the map shows the landscape under the blackout
- [x] Real map items: search-area outline drawn as red wool in the sky, with a fresh map every round
- [x] Round-robin question turns between seekers
- [ ] Custom HUD layout so the minimap sits in a screen corner
See [docs/game-rules.md](docs/game-rules.md) for the full reference rules gathered from the videos.

## Credits

Game concept: EightSidedSquare's [Hide and Seek mod](https://modrinth.com/mod/hide-plusseek) for Java Edition.
This project is not affiliated with EightSidedSquare, Mojang or Microsoft.
