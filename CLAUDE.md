# Working on this repo

Extreme Hide & Seek, a Minecraft Bedrock add-on. See README.md for what it does and docs/parity.md for how it
compares to the original Java mod.

## Change procedure (always follow this)

Every requested change goes through a branch and a test build. Nothing lands on `main` until the owner
approves it.

1. **Branch.** Start from an up-to-date `main` and create a branch named for the change, for example
   `feature/rotations`, `fix/border-height`, `tweak/challenge-list`:
   ```
   git checkout main
   git pull
   git checkout -b fix/short-description
   ```
   Several requests in a row can share one branch only if the owner says so; otherwise one branch per change.
2. **Make the change** on the branch. Keep README.md, docs/parity.md and the in-game How to play text in line
   with the behavior. Bump the pack version in both `manifest.json` files (and the version note in the
   README) so the test build replaces the old one in Minecraft and on Realms.
3. **Check it.**
   - Syntax-check every script and run the pure-JS tests (see "Testing" below). Report the actual results.
   - Never claim something works in game unless it was tested in game.
4. **Build a test pack** and commit the change on the branch:
   ```
   powershell -ExecutionPolicy Bypass -File tools\build.ps1 -Test
   ```
   This creates `dist\ExtremeHideAndSeek-test-<branch>.mcaddon` (dist/ is git-ignored). Tell the owner the
   file's full path and what to test. Push the branch only if the owner asks.
5. **Wait for approval.** Fix anything the owner reports on the same branch, rebuild the test pack, repeat.
6. **On approval, merge to main and push:**
   ```
   git checkout main
   git pull
   git merge --no-ff fix/short-description
   git push
   powershell -ExecutionPolicy Bypass -File tools\build.ps1
   git branch -d fix/short-description
   ```
   The last build makes the release `dist\ExtremeHideAndSeek.mcaddon` from main.

Never commit straight to `main` and never merge without the owner's approval. Commits end with the attribution
line given in the session instructions.

## Testing

- No Node.js on the owner's machine; Python 3 is installed.
- Pure-JS tests: `node tests/geometry.test.js` / `node tests/hand.test.js` with Node, or serve the repo with
  `python -m http.server 8765 --bind 127.0.0.1` and open `http://127.0.0.1:8765/tests/run.html` in the
  browser (Claude in Chrome can read the result).
- Syntax check without Node: from that same page, fetch each `behavior_packs/modpack_bp/scripts/*.js`, strip
  the `import` lines and the `export` keywords, and parse it with `new Function(...)`.
- Anything that uses the Minecraft API can only be verified in game: the owner tests the test pack.

## Notes

- Stable Script API only (`@minecraft/server` 2.0.0, `@minecraft/server-ui` 2.0.0), no experimental
  toggles, so it runs on Realms and consoles. Look up optional enums through `import * as mc` rather than
  named imports, so a missing one can't stop the whole add-on loading.
- Dev install links the packs into Minecraft's development folders (tools/dev-install.ps1); folder and pack
  ids (`modpack_bp`, `hs:*`, manifest UUIDs) must not change.
