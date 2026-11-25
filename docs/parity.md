# Parity matrix

Tracks how Extreme Hide & Seek compares to EightSidedSquare's Java Hide and Seek mod, as seen in the reference
videos (see [game-rules.md](game-rules.md)). Maintained alongside `BEDROCK_PARITY_SPEC.md` work.

**Nothing in this add-on has been validated in game yet.** Every row is also *runtime unverified* until a
playtest confirms it. "Tested" below means the pure-JS unit tests in `tests/` (run in a browser, since this
machine has no Node.js).

Statuses: **verified reference** (seen clearly in a video) · **inferred reference** (likely from the videos,
not confirmed) · **Bedrock adaptation** (same idea, different mechanism because of Bedrock limits) ·
**original extension** (not in the reference) · **missing**.

## Core

| Feature | Status | Notes |
|---|---|---|
| Lobby, everyone hides once per rotation | verified reference | |
| 5-minute Creative build phase, manual lock-in | verified reference | |
| Overtime penalty, 60 score-seconds per second late | inferred reference | Video house rule; configurable |
| Stationary hider after lock-in | verified reference | Movement input lock plus a 0.4-block snap-back |
| Hider keeps Creative after lock-in | original extension | Requested by the project owner |
| Spot rules: ground, dry, above sea level, near sky light | verified reference | Sky light is a geometric check (no light API in the pinned Script API 2.0.0); lava always rejected |
| 1000×1000 arena | inferred reference | From "within 500 blocks" being useful; configurable |
| Score = hide time + bonus cards − overtime, highest total wins | verified reference | Totals add up across rotations |
| Rotations at new random locations | original extension | Requested by the project owner |
| Overworld only | original extension | Nether/End options removed by request |
| Capture by line of sight (24 blocks) or hit | Bedrock adaptation | Admin presets: sight-or-hit (default), sustained sight (1s), hit only. Range is an approximation; configurable |

## Questions

| Feature | Status | Notes |
|---|---|---|
| Comparing: N/S, E/W, above/below, same biome | verified reference | Reference shows about 6; the other 2 are unidentified |
| Distance 500/250/100/50/25, horizontal | verified reference | |
| Observation (9) | inferred reference | Grass, leaves, same block, water 4, lava 6, snow 4, flowers 4, mobs 16, sky. Cube scan; original metric unknown; unloaded areas answer "Unknown" |
| Generated-structure question | missing | No reliable structure detection in the stable API; not faked |
| Task (8) | Bedrock adaptation | Performed automatically next to the hider so it can't be skipped; only ever fills empty air and only reports success if it really happened; reference count about 12 (rest unidentified) |
| Each question once per round | original extension | **Intentional deviation from the spec**: the spec has repeats doubling rewards; the project owner chose once-only |
| Round-robin asking | original extension | |

## Map

| Feature | Status | Notes |
|---|---|---|
| Blackout of ruled-out area | Bedrock adaptation | Menu grid + sky layer on real map items. **Conservative**: a cell is only blacked out when proven impossible (`geometry.js`, tested) |
| Map never shows the hider to seekers | Bedrock adaptation | Seekers get plain maps, compasses confiscated; hider gets a locator map |
| Fresh map every hider's round | original extension | **Intentional**: deletes players' maps each round, by owner's request (`giveMaps` in config.js) |
| Terrain on the map | Bedrock adaptation | Background scan; reference map shows biomes |
| Clickable map teleport | Bedrock adaptation | Coordinates/teammate/start point via menu, same validation on every path |
| Sky outline/fill at build height | original extension | Only places into air; only removes its own block types at that height; stale chunks tracked and cleaned |

## Cards

| Feature | Status | Notes |
|---|---|---|
| Draw/pick per category (3/2, 2/2, 2/1, 1/1) | verified reference | |
| 5-card hand, forced discard | verified reference | Hand can never exceed 5 (discard happens in the same step); tested |
| Time bonus 3/5/10 | verified reference | Draw weights unverified; `cardWeights` in config.js |
| Cancel | verified reference | 10s window is an adaptation |
| Challenge blocks questions and teleports | verified reference | No timeout by default (owner's choice); configurable |
| Challenges: fish, mud, breed chickens, hatch chicken, bonemeal, iron golem, TNT | verified reference | Credited to the seeker who did it (`challengewatch.js`): births/hatching/golems/TNT must appear near that seeker's own action; bone meal and mud need a real block change. Fish is still an inventory count (no fishing event). Mob-dependent ones skipped in Peaceful; water-dependent ones skipped when the scan finds no water |
| Bread challenge | original extension | |
| Light a Nether portal, fall 100 blocks, break an iron tool | verified reference | Added in P1. Portal: lighting only (Overworld-only game). Fall: tracked per seeker, teleports and deaths excluded (`trackers.js`, tested). Tool: the API has no item-break event, so a nearly broken iron tool vanishing from the held slot counts (dropping it at that moment would too) |

## Morphs

| Feature | Status | Notes |
|---|---|---|
| Mob morph | Bedrock adaptation | Invisible hider + pinned decoy; decoy is spawned first, so no invisible-without-decoy state |
| Block morph | Bedrock adaptation | Block placed at feet, hider in Spectator; original block saved and restored; must differ from all 6 neighbours |
| Capture by hitting/mining | verified reference | |

## P0 status (spec batch 1)

| Item | Result |
|---|---|
| P0.1 Conservative map elimination | Done. Shared constraints in `geometry.js` used by the map, sky layer, teleports and bots; tested (including a check that the old 9-sample method fails) |
| P0.2 Atomic hand and scoring | Done. `hand.js`; offers merge instead of overwrite; stale/unauthorized card actions ignored; bonus capped; tested |
| P0.3 Dry and sky-light rules | Done. Lava always rejected; sky layer ignored by rules (`surface.js`); unloaded scans answer "Unknown" |
| P0.4 Teleport validation | Done. One destination check for coordinates, teammates and bots; delayed landing re-checks the round |
| P0.5 World edits and morph restoration | Done. Disguise block only replaces air/water/small plants and restores the original; failed spawn/placement leaves the hider undisguised (not invisible/spectating); leftover ticking areas removed on load |

## P1 status (spec batch 2)

| Item | Result |
|---|---|
| Missing challenges (portal, fall 100, break iron tool) | Done (see Cards). Fall and tool trackers are pure functions with tests |
| Challenge false positives | Done where the API can attribute it: actor-attributed births, hatching, golems and TNT; real block changes for bone meal, mud and portals. Fish and bread remain inventory counts (documented) |
| Impossible challenges on the arena | Done for what can be known: mob drops in Peaceful, water from the finished terrain scan. Other terrain needs (e.g. no chickens nearby) aren't detectable |
| Task safety | Done: tasks only fill empty air and report failure honestly |
| Card weights | Configurable (`cardWeights`); still unverified against the original |
| Capture presets | Done: sight-or-hit, sustained sight, hit only (manual confirmation not added) |
| Generated-structure question | Not added: the pinned stable API (2.0.0) has no structure lookup, and `/locate` output can't be read from scripts |
| Biome/elevation map filtering | Not added: biome needs loaded chunks everywhere, and elevation is unreliable with player-built spots. The map only uses x/z clues, which is always correct |
| Cancelled questions | Count as used and earn no powerups. Unverified against the original |
| Separate pig/cow/sheep/rabbit task buttons | Not added: not confirmed in the reference |
