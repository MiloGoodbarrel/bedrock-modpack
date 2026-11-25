# Extreme Hide & Seek for Minecraft Bedrock

A build-your-own-spot hide and seek add-on for Minecraft Bedrock Edition. Every player takes a turn as the hider:
they get five minutes in Creative to find and build a hiding spot, then the seekers hunt them down by asking
questions that narrow down where they are. The hider's clock runs until someone spots them, and the player with the
**longest total hide time wins**.

Inspired by the gameplay of EightSidedSquare's Java Hide and Seek mod, as played by The Losers, PaulGG and
ConnorIGL on YouTube. This is an independent rebuild for Bedrock. No code or assets from the original mod are used.

Works on Windows, Xbox, PlayStation, Switch, mobile and Realms. **No experimental toggles needed.**
Requires Minecraft Bedrock **1.21.90 or newer**.

> **Status:** early development (v0.24.0). Every feature below is written, but none of it has been playtested
> in game yet, so expect bugs. Please report anything that shows up in the Content Log (Settings → Creator).

## How to play

1. Everyone gets a glowing **Extreme Hide & Seek Menu** book when they join. Use it to open the menu.
2. Each player picks **Join**. The host stands where the game should start and picks **Start game**.
   The play area is a 1000×1000 square centered on that spot.
3. **Hiding (5 minutes):** the hider goes into Creative and builds a spot. Their screen shows a live checklist
   of the spot rules. Seekers wait at the start point.
4. **Lock in:** the hider locks in from the menu once every rule shows a green check. Going over 5 minutes costs
   1 minute of score per second of overtime.
5. **Seeking:** the hider is frozen in place (still in Creative, with every item), and the seekers go into
   Survival and search. They ask questions
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
| Allow hiding in water | Removes the water part of the Dry rule (lava is never allowed) |
| Peaceful | Off by default (hostile mobs on). On: no hostile mobs or hunger, and challenges that need mob drops (TNT, fishing) are never dealt |
| Rotations | 1–5 (default 3). After everyone has hidden, everyone is moved to a new random location with a new border and it goes around again |
| Fill ruled-out areas in the sky | Black wool top slabs (default) · off · black stained glass · blackstone slabs (see Real maps below) |
| Map station | Chest + cartography table at the start, refilled with blank maps and paper each round |
| Line up the play area with zoomed-out maps | Moves the start point so one zoomed-out map covers the play area |

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
| Dry | Not in water, lava, bubble columns, powder snow, or waterlogged blocks (with water allowed: "Not in Lava") |
| Above Sea Level | At Y 63 or higher |
| Near Sky Light | Open sky within 2 blocks of the hider (any block overhead counts as cover, including glass and leaves; the add-on's own sky layer is ignored) |
| In the Overworld | Games are Overworld-only |
| Inside Play Area | Within the 1000×1000 square around the start point |
| Room for the Block | Block morph only: nothing solid where the disguise block goes |

Once locked in, the hider is frozen in place but **stays in Creative, with access to every item**. They can
look around and use, place or break blocks within reach, but they can't walk or fly away (anything that moves
them, like an ender pearl, just puts them back). They return to Survival when they're found.

During a game, coordinates are forced on for everyone and it stays **midday**: the day/night cycle is stopped
and the time is held at noon, so it never gets dark. Hostile mobs stay on unless the admin turns on
**Peaceful**. Games are **Overworld-only**: anyone who goes through a portal is brought back to the start
point. All of these settings go back to how they were once the game ends.

### Rotations: new location each time around

The admin picks how many rotations to play (default 3). When everyone has had a turn hiding, the add-on looks
for dry land 1,500–3,000 blocks away. Everyone is teleported there together, the play area and border move
with them, the hider order is reshuffled, and the next rotation starts. Hide times add up across rotations,
and the highest total wins. The menu map and the map station move with the start point too.

### Questions

Seekers ask from the **question board** (menu → Questions), with a 1-minute cooldown between questions.
**Each question and each task can be asked only once per hider's round.** Asked ones are greyed out. Each
challenge can also be played only once per round.

**Seekers take turns asking (round robin)**, so one seeker can't ask every question. The asking order is shown
in the seeker menu and above the hotbar, and it starts with a different seeker each round. Once a question is
ready, the seeker whose turn it is has 60 seconds to ask. They can also pass. Otherwise the turn moves on.
Offline seekers are skipped, and bots take their turns too.

| Category | Hider earns | Questions |
|---|---|---|
| Comparing | Draw 3, pick 2 | North or south of me? · East or west of me? · Above or below me? · Same biome? |
| Distance | Draw 2, pick 2 | Within 500 / 250 / 100 / 50 / 25 blocks of me? (horizontal distance) |
| Observation | Draw 2, pick 1 | Standing on grass? · On leaves? · On the same block as me? · Water within 4? · Lava within 6? · Snow within 4? · Flowers within 4? · Mobs within 16? · Open sky above you? |
| Task | Draw 1, pick 1 | Launch a firework · Light a fire · Spawn a bee · Spawn a farm animal · Place gravel · Place sand · Drop the block you're standing on · Place the block I'm standing on |

Tasks happen automatically right next to the hider, so they can't be skipped. Every answer is saved in the
**Clues** log.

### Teleporting, radar and border

- **Teleport (seekers):** from the menu, teleport to a teammate, to typed-in coordinates, or back to the
  start point. You can do this once a minute, but not into ruled-out (dark) areas and not while a challenge
  is running. Far-away chunks load in while you float down.
- **Seeker radar (hider):** above the hotbar, the hider sees every seeker's direction (an arrow relative to
  where they're looking) and distance.
- **Native locator bar, for the hider only:** the locator bar is on during games, and the hider wears a locked
  **player head** for their whole turn. A player wearing a mob head is left off other players' locator bars,
  so the hider sees every seeker on their bar but the seekers don't see the hider. In mob morph the hider is
  invisible instead, which also keeps them off the bar. Anything the hider was wearing on their head goes
  into their inventory. *Needs a test:* if seekers can still see the hider on their bar, set
  `hiderLocatorBar` to `false` in config.js, which turns the bar off for everyone during games.
- **World border:** Bedrock has no world border command, so the add-on scripts one. A particle wall appears
  when you get within 12 blocks of the edge, and anyone who crosses it is put back inside.

### Hider powerups

Every question earns the hider cards. They pick from a "Pick N Powerups" screen, can hold 5 cards, and must
discard any extras.

- **Time Bonus (3 / 5 / 10 min):** added to the hider's time while the card is in their hand.
- **Cancel:** when a question is asked, a hider holding Cancel gets 10 seconds to block it. The seekers get
  no answer, and the hider earns nothing for that question.
- **Challenge:** stops all questions until a seeker completes it. Options: catch a fish, make mud, breed
  chickens, hatch a chicken, bonemeal a plant, build an iron golem, ignite TNT, or get bread. Challenges are
  only dealt if they're attainable: in Peaceful, TNT (gunpowder comes from creepers) and fishing (a rod needs
  string, which realistically comes from spiders) are left out. Completion is detected automatically. **No questions can be asked (and nobody can teleport) until a
  seeker completes the challenge.** There's no time limit by default; `challengeSeconds` in config.js adds one.
  With only bot seekers, a bot "completes" it after a minute or two. Each challenge comes up at most once per
  round: once it's been played or is in the hider's hand, it isn't dealt again.

### Map

The play area is drawn as a grid of colored squares, with north at the top. When a game starts, the add-on
scans the play area's terrain in the background, sampling every 40 blocks. This takes a few minutes, about
one build phase. After that the map shows water, ice, grass, forest, sand, badlands, snow, stone and lava.
The scan is saved, so later games from the same start point skip it.

As answers come in, ruled-out squares turn black and partly ruled-out squares turn dark grey. Players show up
as colored dots, and the hider only appears on their own map. The blackout starts over with each new hider.
Open it with the **Map** button in the menu: a 15×15 grid with a legend and the scan's progress. There's no
on-screen minimap; the real map item (below) does that job.

### Real maps: red lines in the sky

The ordinary map item works too. Add-ons can't draw on maps, but a map shows the highest block in each column.
So during a round, the add-on places a band of **red wool top slabs at build height (Y 319)** along the edge of
where the hider can still be. Before any answers, that edge is the play area's square border. After each answer
it's the new, smaller shape. By default the ruled-out part of the play area is also covered in **black wool
top slabs**, so it shows black on maps, like the Java mod's blackout. Top slabs let light through, so the
ground below stays bright. On a game version without wool slabs, full wool blocks are used instead.

- **Every hider's round starts with a clean map.** At the start of each turn, everyone's maps are taken away
  and replaced with one fresh empty map, so old lines and markers are gone. Use it to start mapping, then
  hold it in your off hand. The map fills in as you explore, and the red outline appears on it.
- **Seekers get a plain map, and the hider gets a locator map.** A locator map shows every player, so it
  would give the hider away. The hider's locator map shows them where the seekers are. To stop seekers from
  crafting their own locator map, compasses are taken from seekers during a round. Teammate positions are
  still on the menu map.
- Lines are drawn only in chunks near players, a few per second. Those are the only places maps update anyway.
- Old lines from an earlier answer, round or game are cleared in the background, including far-away ones,
  which get loaded briefly to do it. The sky is clean again shortly after each new round starts.
- A fresh map covers 128×128 blocks. The lines are 4 blocks wide so they still show on zoomed-out maps;
  `skyLineWidth` in config.js changes that.

**Making the big map (whole play area).** These steps are also in the in-game How to play:

1. Get a blank map (it's handed to you, or take one from the map station chest) and 3 paper (station chest,
   or craft from sugar cane).
2. Use the blank map to start it.
3. At a cartography table (one appears at the start point with the map station on), put the map in the top
   slot and 1 paper in the bottom slot, then take the zoomed-out map.
4. Repeat step 3 two more times. After 3 zooms the map covers about 1024×1024 blocks.
5. Hold it in your off hand.

Admin settings for real maps:

| Setting | What it does |
|---|---|
| Fill ruled-out areas in the sky | **Black wool top slabs** (default), off (outline only), black stained glass, or blackstone slabs. The fill sits at build height over the ruled-out part of the play area, and it's only placed near players. |
| Map station | Each round, a cartography table and a chest appear next to the start point (put back if broken). The chest is refilled with one blank map and 3 paper per seeker, and seekers take their map from it instead of getting one handed to them. Zooming a map out 3 times at the table makes it cover about 1024×1024 blocks: the whole play area. Add-ons can't create zoomed maps themselves, so this is the quickest way to start zoomed out with a clean map every round. |
| Line up the play area with zoomed-out maps | Zoomed-out maps snap to a fixed grid. This moves the start point (up to ~500 blocks) to the center of the grid square the host is in, so one fully zoomed-out map shows the whole play area. Seekers are teleported there. |

## Installing

### Players

1. Download `ExtremeHideAndSeek.mcaddon` (or build it yourself, see below) and open it. Minecraft imports both packs.
2. Create or edit a world, go to **Behavior Packs**, and turn on **Extreme Hide & Seek BP**. The resource pack is
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
tests/                       # tests for the pure-JS modules
```

The scripts use the stable Script API (`@minecraft/server` 2.0.0 and `@minecraft/server-ui` 2.0.0).

- `scripts/main.js`: event wiring and timers
- `scripts/game.js`: game state, turns, scoring and found detection
- `scripts/bots.js`: AI players for solo games
- `scripts/disguise.js`: mob and block morphs
- `scripts/settings.js`: admin game settings
- `scripts/map.js`, `terrain.js`: the menu map and the background terrain scan
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
2. Turn on **Extreme Hide & Seek BP** on a test world.
3. After editing scripts, run `/reload` in game. Changes to entities, items or the resource pack need you to
   leave and re-enter the world.

### Automated tests

The pure-JavaScript parts (search-area geometry in `geometry.js`, hand rules in `hand.js`) have tests in
`tests/`. With Node 18+: `node tests/geometry.test.js` and `node tests/hand.test.js`. Without Node, serve the
repo (`python -m http.server 8765 --bind 127.0.0.1`) and open `http://127.0.0.1:8765/tests/run.html`.
Nothing that touches the Minecraft API can be tested outside the game.

Backup commands (these need cheats on): `/scriptevent hs:menu` opens the menu, `hs:give` gives the menu book,
`hs:skip` ends the current turn, and `hs:reset` returns everyone to the lobby.

### Building

```
powershell -ExecutionPolicy Bypass -File tools\build.ps1
```

This creates `dist/ExtremeHideAndSeek.mcaddon`. Add `-Test` to build a test pack named after the current
branch (`dist/ExtremeHideAndSeek-test-<branch>.mcaddon`).

### Change procedure

Every change is made on its own branch and comes with a test pack. It's merged into `main` only after the
owner has tried it and approved it. The full steps are in [CLAUDE.md](CLAUDE.md).

## Roadmap

- [x] Lobby, hider rotation, Creative build phase with a spot-rule checklist, and overtime penalty
- [x] Seeking phase, Comparing and Distance questions, clue log, automatic found detection, scoreboard
- [x] Solo play against two bots, and a 1000×1000 play area
- [x] Observation and Task questions; each question, task and challenge once per round
- [x] Hider powerup cards: time bonuses, challenges and cancels, with a 5-card hand
- [x] Admin game settings: mob and block morph modes, height limit, water hiding, Peaceful, rotations
- [x] A map that blacks out areas as questions rule them out (menu map)
- [x] Seeker teleports, hider seeker radar, scripted world border
- [ ] First full playtest and bug fixes
- [x] Terrain scan, so the map shows the landscape under the blackout
- [x] Real map items: search-area outline drawn as red wool in the sky, with a fresh map every round
- [x] Round-robin question turns between seekers
- [x] Parity spec P0 (correctness and integrity): conservative map blackout, capped hand, lava rule,
      teleport validation, safe morph world edits. See [docs/parity.md](docs/parity.md)
- [ ] Parity spec P1–P4: question/challenge parity, morph polish, presets, more tests

See [docs/game-rules.md](docs/game-rules.md) for the full reference rules gathered from the videos.

## Credits

Game concept: EightSidedSquare's [Hide and Seek mod](https://modrinth.com/mod/hide-plusseek) for Java Edition.
This project is not affiliated with EightSidedSquare, Mojang or Microsoft.
