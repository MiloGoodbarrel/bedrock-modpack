# Hide & Seek — Reference Rules

Reverse-engineered from The Losers' video "Who Can Build The Best Hide and Seek Spot in Minecraft?"
(https://www.youtube.com/watch?v=NeKQBtZ05hQ, uploaded 2026-11-16), which uses **EightSidedSquare's Hide and Seek mod**
(Java/Fabric, https://modrinth.com/mod/hide-plusseek) — the mod's name is watermarked on screen.

The mod is All Rights Reserved: we replicate the *gameplay* on Bedrock, not its code or art.
Items marked **(?)** are inferred, not directly confirmed in the footage.

## Overview

Everyone takes a turn as the hider. Seekers ask questions that narrow down the hider's location on a shared map.
The hider's clock runs until they are found. **Highest total hide time wins.**

## Flow

1. **Join** — players open the game menu (TAB in the mod) and click *Join*; host clicks *Start*.
2. **Hider chosen** — one player becomes the hider (rotation; each player hides once per game).
3. **Hiding phase — 5 minutes**
   - Hider goes into **Creative mode** and flies off to pick and build a spot.
   - Seekers wait (in the video they gathered at a village).
   - Overtime penalty used in the video (house rule): **1 minute off the hider's score per second over** (?).
   - Hider "locks in" from the menu → switches to Survival, timer starts.
4. **Seeking phase**
   - Seekers are in Survival and search on foot (they gathered food, tools, etc.).
   - Seekers take turns asking questions; spacing between questions was a house rule (≈ one every few minutes, later "whenever").
   - Host can teleport seekers together (not allowed while a challenge is active).
5. **Found** — a seeker spots the hider → hider's timer stops, their time goes on the scoreboard. Next hider.

## Hiding-spot rules (live checklist on the hider's HUD, top-left, ✓ green / ✗ red)

| Rule | Notes from the video |
|---|---|
| **On Ground** | Must be standing on a block |
| **Dry** | Not in water; **powder snow counts as wet** |
| **Above Sea Level** | Y above sea level (63) |
| **Near Sky Light** | Must be near sky light / be able to see the sky |

The hider can build anything (or nothing — one player just tucked into pumpkins). Building false walls etc. is allowed.
Wearing a carved pumpkin was removed when hiding (?: the mod strips disguises/head items).

## Seeker UI — tab menu with 3 tabs

- **Minimap** — top-down map of the play area centered on spawn (~500-block radius in the video).
  Each answer **blacks out** the region the hider can't be in, so the possible area shrinks. Player heads are shown on it.
- **Clues** — log of questions asked and their answers (?).
- **Questions** — the question board (below). Used questions are greyed out (each can be asked once per round).

## Questions

Four categories. Asking a question rewards the **hider** with powerup cards.

| Category | Hider reward | Questions seen / mentioned |
|---|---|---|
| **Comparing** (6) | Draw 3, pick 2 | Are you north or south of me? · Are you east or west of me? · Are you above or below me? · Is your biome the same as mine? · (2 more, unidentified) |
| **Distance** (5) | Draw 2, pick 2 | Are you within **500 / 250 / 100 / 50 / 25** blocks of me? |
| **Observation** (5) | Draw 2, pick 1 | Is there water nearby? (within 4 blocks) · Is there lava nearby? · Are you standing on leaves? · Are you inside a structure? (must be a generated/registered structure, not player-built) · Is the sky visible? / Is there snow nearby? (?) |
| **Task** (~12) | Draw 1, pick 1 | The hider must perform an action that reveals them, e.g. **launch a firework**, **place gravel** (visible on the map/landscape), **light a fire with a fire charge** (can't put it out) |

Answers are computed automatically from real positions (the asker's position for "of me" questions).
"Biome" compares the hider's biome to the asking seeker's biome.

## Hider powerups (cards)

- Hand of **5 slots**. When drawing over the limit you must discard.
- Picker screen: "Pick N Powerups — Choose powerups to add to your hand".
- Card types seen:
  - **Time Bonus** (green hourglass +) — e.g. **3 Minute Bonus**; adds to the hider's final time.
  - **Challenge** (orange "!") — forces seekers to do a task before they can ask another question
    (examples from the video: make mud, breed chickens, catch a fish). *No questions while a challenge is active.*
  - **Cancel** — vetoes the question just asked (seekers saw it get "blocked"). Limited count.

## HUD

- Top-left (hider): spot rule checklist.
- Top-right: scoreboard — each player's head + hide time; current hider's time counting up.
- Seekers' minimap darkness updates live after each answer.

## Additions from later videos

Sources: PaulGG — "Minecraft EXTREME Hide And Seek BUT You Can Shapeshift Into Mobs!"
(https://www.youtube.com/watch?v=WCk914LLNH8) and ConnorIGL — "Minecraft EXTREME Hide And Seek BUT You Can
Shapeshift Into Blocks!" (https://www.youtube.com/watch?v=XE8WuXAcpzg). Same EightSidedSquare mod, plus a
shapeshift mod layered on top.

### Disguise variants (game modes)

- **Mob disguise** — hider picks any mob and becomes it.
  - Once locked in the hider **can't move** (can still turn and look around).
  - Seekers find a mob-hider by hitting it: a real mob takes damage and runs, the hider doesn't.
    (The video joked about killing a hider-mob and "nothing happened".)
  - Spot rules still apply (above sea level, etc.). Hiding as a mob in lava was discussed as a cheese — lava should count as wet.
- **Block disguise** — hider picks a block and becomes it (Y key opened the block picker).
  - **Can't be the same block as any adjacent block** (a coal block on a stone mountain is fine; stone is not).
  - Seekers right-clicking the block didn't work, so the house rule was: say "I think you're X", the hider confirms,
    or mine it — mining the disguised block reveals the hider.
  - Spot rules still apply (on ground — can't float as a block, dry, above sea level, near sky light).

### Map

- Play area **1000×1000** (500 blocks each way from spawn), shown on the minimap with biomes visible.
  A 500×500 map would make the "within 500 blocks" question almost useless, since it would cover nearly the
  whole field from anywhere. On 1000×1000 it rules out a meaningful chunk. The add-on uses a 1000×1000 square
  centered on the start point (`playAreaRadius` in config.js).
- Players appear on the map as dots.
- **Teleport from the map:** seekers click any point of the map to teleport there (or to a teammate).
  Has a short cooldown; **can't teleport into eliminated (grey) area**; disabled while a challenge is active.
- Distance questions are **horizontal only** ("25 blocks" ignores height).

### Questions (expanded)

- **Re-asking a question is allowed** — an already-used (greyed) question can be asked again, but the hider gets
  **double powerups** for it. (They only discovered this when they ran out of questions.)
- Observation grew to **8** questions. Seen/used:
  Are you standing on grass? · Standing on the same block as me? · Standing on leaves? · Snow within 4 blocks? ·
  Water within 4 blocks? · Inside a structure? · Same biome as me? · (lava / flowers / mobs nearby — likely)
- Height: an "above/below me" answer was used to rule out everything under the asker's Y.
- Task (hider must do it, which reveals them):
  **Place gravel**, **place sand**, **light a fire (fire charge)**, **launch a firework**,
  **spawn a mob** (bee, pig, cow, rabbit — seekers then look for out-of-place mobs; mobs falling to their death
  hinted at a high spot).

### Powerups (expanded)

- **Time bonus** cards seen: **3, 5 and 10 minutes**.
- **Cancel** — vetoes the question just asked. Commonly held 1–2 at a time.
- **Challenge** — hider assigns to seekers; **no questions and no teleports until it's completed.**
  Seen: make mud · breed chickens · catch a fish · hatch a baby chicken · bonemeal a plant ·
  build an iron golem · light a nether portal · fall 100 blocks and survive · ignite TNT ·
  break an iron tool. (Some were nearly impossible on the map they had — e.g. no sand near the snow biome.)
- Hand is 5 cards. When the picker offers more than fit, you **must** discard — closing the picker doesn't skip it.

### House rules observed (not mod features)

- "Three honest answers": the hider offered to truthfully answer three free-form questions.
- Hider volunteering hints like "I've seen one of you" in exchange for a cancel being used.

## Bedrock implementation notes

- **Engine**: Script API (`@minecraft/server`, `@minecraft/server-ui`) in the behavior pack.
- **Menus**: `ActionFormData` / `ModalFormData` for join/start, question board, card picker, hand.
  Opened with a custom item (e.g. a "Seeker's Compass") since Bedrock can't rebind TAB.
- **Rule checklist / scoreboard / timers**: action bar + sidebar scoreboard (`world.scoreboard`), or a custom
  JSON UI HUD in the resource pack for the nicer look.
- **Answers**: all computable server-side: positions, `dimension.getBiome()`, block checks around the hider,
  `getBlockFromRay`/sky-light checks, structure checks (?: limited — may need village/structure detection heuristics).
- **Minimap blackout — hardest part.** Bedrock scripts can't draw custom map textures. Options:
  1. A text/emoji grid "map" inside a form (simple, works everywhere).
  2. In-world visual: particle walls / block outlines marking eliminated areas.
  3. Custom JSON UI with a grid of tiles toggled via scoreboard/title data (best-looking, most work).
