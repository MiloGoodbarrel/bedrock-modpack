# In-game test matrix

What the automated tests can't cover: everything that needs Minecraft itself. Tick items off as they're
confirmed in game, note the game version and platform, and report anything odd along with the red errors
from the Content Log (Settings → Creator → Content Log).

Setup for most tests: a fresh Overworld test world with **Extreme Hide & Seek BP** turned on, cheats on (only
for the `/scriptevent hs:*` backup commands), and at least two players unless a test says otherwise.

## 1. Basics and permissions

- [ ] World loads with no Content Log errors; everyone gets the glowing menu book.
- [ ] A brand-new world shows **Become admin** in the lobby; the first claim works, and after that nobody
      else sees the button.
- [ ] Admin → Game settings → Admins: add a second player, remove them again; the last admin can't be removed.
- [ ] A non-admin never sees Game settings; `/tag <name> add hs_admin` makes them an admin.
- [ ] Presets: each one saves, and the summary shows "Preset: <name>"; changing one option shows "Custom".
- [ ] Settings from the previous version still load (no errors, values kept where they still exist).

## 2. Full multiplayer rotation

- [ ] Join → Start: coordinates turn on, it becomes midday and stays there, and the hider order is announced.
- [ ] Each new turn (including the first): every player's inventory, armor and off hand are emptied; everyone has the game book again, the hider wears the locked head, seekers get their map (or take it from the station chest).
- [ ] Start while standing in a lake: everyone starts on the nearest land. Start far out at sea: a plank
      platform appears and everyone starts on it. Map station on water gets its own platform.
- [ ] Hider gets 5 minutes in Creative; the spot rules on the action bar update live as they move.
- [ ] Locking in fails with a clear reason when a rule is red; succeeds when all are green.
- [ ] After lock-in the hider can't walk or fly, but can look around and place/break blocks; Creative stays.
- [ ] Open Spot: a pit dug straight down with a trapdoor lid fails; a sealed dug tunnel fails; a deep dug shaft
      fails; a pocket cut into tree leaves passes; under a mushroom cap passes; against a natural cave wall
      passes; blowing a hole with TNT counts as digging. Turning the rule off in settings allows bunkers.
- [ ] Hider can't place bedrock, barriers, end portal frames, command blocks or light blocks (blocked with a
      message, and removed from their inventory); can't pick one as a block disguise.
- [ ] Overtime: locking in late subtracts 60 score-seconds per second late.
- [ ] Seekers in Survival; asking order shown; only the current asker can ask; the turn passes after 60s.
- [ ] Each question can only be asked once per round (greyed out afterwards).
- [ ] Found by sight (default capture) and by hitting; scores add up on the sidebar; next hider starts.
- [ ] Every new round: everyone's maps are replaced (seekers plain, hider locator); old sky lines disappear.
- [ ] With rotations > 1: after everyone has hidden, everyone moves together to a new dry location with a new
      border; scores carry over; the game ends after the last rotation and settings go back to normal.
- [ ] Reset from Game options mid-round restores everyone (modes, movement, name tags, coordinates, time).

## 3. Questions and cards

- [ ] Comparing / Distance answers are correct at exact boundaries (stand exactly 25 blocks away, etc.).
- [ ] "Same biome" is hidden on game versions without biome support (2.0.0 API), and shows up otherwise.
- [ ] Observation answers match what's actually there; an unloaded area answers "Unknown".
- [ ] Every Task happens next to the hider, never replaces a block, and reports failure honestly.
- [ ] Card picker: pick N cards; with a full hand, picking asks what to discard (or to decline the new card);
      the hand never shows more than 5; closing the picker reopens it, then auto-picks after 45s.
- [ ] Cancel: the hider gets the 10-second prompt; blocked questions give no answer and no cards.
- [ ] Time-bonus cards count in the score only while in the hand.

## 4. Challenges (genuine completion vs false positives)

For each: confirm it completes when a seeker really does it, and does NOT complete for the "false" case.

- [ ] Fish: catch one (complete). *(Known: taking fish from a chest also counts.)*
- [ ] Mud: water bottle on dirt (complete) / picking up mud from elsewhere (not).
- [ ] Breed animals: feed two cows (complete) / a baby born far from any seeker (not).
- [ ] Hatch a chicken: throw eggs until one hatches (complete).
- [ ] Bonemeal: on a sapling that grows (complete) / on a block where nothing happens (not).
- [ ] Create a golem: iron golem and snow golem (complete) / a village golem spawning (not).
- [ ] TNT: light it with flint and steel (complete) / TNT lit by someone who isn't seeking (not).
- [ ] Nether portal: build and light one (complete); walking through brings you back to the start point.
- [ ] Fall 100: into water from 100+ blocks (complete) / dying from the fall (not) / teleporting (not).
- [ ] Break an iron tool: wear one out (complete) / switching slots (not).
- [ ] Break an iron tool also counts shears and flint and steel.
- [ ] Dye: sheep, cat collar, wolf collar, sign (complete).
- [ ] Glazed terracotta, written book: get one (complete).
- [ ] Poison: eat a poisonous potato / spider eye (complete).
- [ ] Mine diamonds: diamond ore and deepslate diamond ore (complete).
- [ ] Share a boat: seeker + mob in one boat (complete) / two players (not).
- [ ] Tame: wolf with bones, cat with fish (complete).
- [ ] Touch bedrock: stand on it (complete).
- [ ] Seeker dies mid-round: hider gets a draw 1, pick 1 offer.
- [ ] Sounds play for: round start, seekers go, question asked, answer, cancel, challenge start/complete, time bonus, caught.

## Questions board, tasks and time bonuses (v0.31.0)

- [ ] Seeker uses the book: the Questions board opens with four headed sections and coloured tiles (icons load, not the pink/black missing texture).
- [ ] Tapping a tile asks that question (the right one: check a tile late in the list, like Spawn a Rabbit).
- [ ] Asked questions show a dimmed tile; tapping one says it was already asked.
- [ ] More opens the old seeker menu (clues, map, teleport, options).
- [ ] Task asked: hider gets the item, the hide timer stops, seekers can't ask. Doing it (place grass, spawn a cow, use a fire charge, fire a rocket, break a block) completes it and unpauses.
- [ ] Task not done in 60 s: it happens automatically.
- [ ] Mob-morph hider can hold the task item while the task runs.
- [ ] Time bonus: hand → card → Play adds the minutes to the hider menu's time; an unplayed card adds nothing.
- [ ] In block light: near a torch → Yes; in an unlit cave → No.
- [ ] Nearest mob same type: both next to a cow → Yes.
- [ ] While a challenge is active: no questions, no teleports. With only bot seekers, it completes by itself.
- [ ] Peaceful: TNT and fishing never get dealt. No water in the play area: fishing and mud never get dealt.

## 5. Morphs

- [ ] Mob morph: armor and the off-hand map go into the inventory; nothing floats; held items get put away;
      the mob stays on the hider and turns with them; hitting the mob finds the hider.
- [ ] Mob morph: does an invisible player cast a shadow? (Can't be controlled from scripts; just note it.)
- [ ] Block morph: the block appears; it must differ from all 6 neighbours; no room (e.g. a slab) blocks
      lock-in; hitting or breaking it finds the hider; the original block (e.g. grass) comes back afterwards.
- [ ] Block morph with sand/gravel: break the block under it so it falls → counts as found.
- [ ] Spectator block hider can't move the camera away from the block.
- [ ] Reconnect: leave while morphed, end the game, rejoin → visible, not Spectator, can move.
- [ ] Decoy killed or despawned (e.g. `/kill @e[type=pig]`) → a new one appears on the hider.

## 6. Map, teleports, border

- [ ] Menu map: terrain appears after the scan; ruled-out squares go black; row letters line up on the right.
- [ ] Real map: red outline and black fill appear in the sky at build height and on the map; the ground under
      them stays bright; the border pushes you back to the ground (not onto the slabs).
- [ ] Teleport to a teammate / map square / coordinates / start point; ruled-out destinations are refused;
      a delayed (floating) teleport doesn't land after the round changed.
- [ ] Locator bar: the hider sees seekers; seekers don't see the hider. (Mob head trick: needs confirming.)
- [ ] Compasses are taken from seekers during a round.

## 7. Solo bots

- [ ] One player + Start → 2 bots join; bots hide (bush or disguise), ask questions on their turns, search,
      and find you; bot hiders can be found by sight and by hitting.
- [ ] Bots don't load far-away chunks (no lag spikes while they're out of view).

## 8. Dimensions, reloads, platforms

- [ ] Going through a Nether/End portal mid-game brings you back to the start point.
- [ ] Close and reopen the world during each phase (lobby, hiding, seeking, between rounds, relocating):
      the game resumes; pending questions, offers and challenges survive or resolve cleanly; no leftover
      ticking areas (`/tickingarea list`).
- [ ] Windows local world.
- [ ] Realm (upload with the pack on; console/mobile players download it automatically).
- [ ] Controller / console player can use every menu.
- [ ] Mobile (touch) player can use every menu.
- [ ] No experimental toggles needed anywhere.
- [ ] Performance: no noticeable lag from the terrain scan, sky lines/fill, or bots.
