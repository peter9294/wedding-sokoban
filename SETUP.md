# Setup & deploy — Something Pushed

Two things to do: **(A) put the site online** (free, GitHub Pages) and **(B) wire up score saving** (a Google Form + Sheet in your own Google account). Then **(C) smoke-test** it.

The game is fully playable *without* B — scores just won't save and the leaderboard shows "not connected yet."

---

## A. Put it online (GitHub Pages, free)

1. Create a new GitHub repo (e.g. `something-pushed`).
2. Push this folder to it:
   ```bash
   git remote add origin https://github.com/<you>/something-pushed.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
4. Wait ~1 minute. Your sites are live at:
   - Game: `https://<you>.github.io/something-pushed/`
   - Leaderboard: `https://<you>.github.io/something-pushed/leaderboard/`

No build step — it's plain static files, so editing a file and pushing re-deploys it.

---

## B. Wire up score saving (one-time, ~2 minutes)

This uses the "Google Form auto-filler" technique: the game quietly submits to a Google Form; the leaderboard reads the linked Sheet. A script does all the fiddly parts for you.

1. Go to **[script.google.com](https://script.google.com)** signed in with a **personal Gmail** account.
   > Work/Workspace accounts often block anonymous form posts and public sheet sharing — if you only have a work account, the form may silently reject scores. A personal Gmail is the safe choice.
2. **New project** → delete the sample code → paste the entire contents of **`apps-script/setup.gs`**.
3. (Optional) change `TIMEZONE` at the top if you're not in Bangkok.
4. Press **Run**, pick the `setup` function, and **approve** the permission prompts (it's your own script creating your own form/sheet).
5. Open **View → Logs** (or the "Execution log"). It prints a block like:
   ```js
   form: {
     actionUrl: 'https://docs.google.com/forms/d/e/XXXX/formResponse',
     entries: { name: 'entry.111', solved: 'entry.222', stage: 'entry.333', session: 'entry.444' }
   },
   sheet: { readUrl: 'https://docs.google.com/spreadsheets/d/YYYY/gviz/tq?tqx=out:json&sheet=Form%20Responses%201&headers=1' }
   ```
   It also prints `Self-test submission: PASSED` if a test row landed in the sheet.
6. Open **`config.js`** in this repo, paste those values in, and set your real `weddingDate`.
7. Commit & push:
   ```bash
   git commit -am "Wire up scoring"
   git push
   ```
   Pages redeploys in ~1 minute.

That's it — no more questions, no server to run.

---

## C. Smoke test (do this once on the live URL, ideally the night before)

1. Open the **live game URL** on your phone. Enter a name, clear stage 1.
2. Open the **live leaderboard URL**. Within ~15 seconds your name should appear with "1 stage".

If it doesn't show up, check, in order:
- You used a **personal Gmail** for the Apps Script (not a work account).
- The `entry.*` values in your config aren't blank. If `setup.gs` printed blank entries or "could not read some entry IDs", run **`apps-script/fix-entries.gs`** — it reads them from your existing form (no need to recreate the form or sheet).
- `Self-test submission: PASSED` appeared in the script log. If it said FAILED but the entries are now filled in, confirm the form is on a personal Gmail and accepting responses.
- In Google Drive, the **responses spreadsheet is shared "Anyone with the link → Viewer"** (the script tries to set this; some accounts need you to do it by hand).
- `config.js` `actionUrl` ends in **`/formResponse`** and every `entry.*` value is filled in.
- Your test name isn't in `leaderboard.ignoreNames` (defaults hide `test`/`tester`).

Test rows: the script submits one row named `tester`, which is hidden on the leaderboard by `ignoreNames`. Delete it (and any of your own test rows) directly in the Sheet whenever you like.

---

## Adding your real levels

The game ships **5 tested cage→bride tutorial stages** in **`levels.json`** (from the stage-design pass; an opt-in copy also lives at `contrib/levels.sample.json`, and `tools/stage-tester.mjs` validates any level set). To add or replace stages:

- `levels.json` is an array of `{ name, lighting, wallStyle, floor[], map[] }` (the handoff format). The **Level Designer** tool in the original handoff zip authors and validates these and exports exactly this file.
- After editing `levels.json`, **bump `levelsVersion`** in `config.js` (e.g. `'1'` → `'2'`) and push — otherwise GitHub Pages may serve a cached copy for ~10 minutes.
- Keep the level **order append-only** once people start playing: the leaderboard counts *distinct stages cleared*, and saved progress is keyed to each level's content, so reordering/replacing a level restarts that stage for anyone mid-way (handled gracefully, but it resets their spot).

> A separate helper may have dropped `contrib/levels.sample.json`, `tools/stage-tester.mjs`, and `docs/stage-design.md` — a sample level set plus a Node solver/validator. They are **not** used by the game. If you want to use the sample levels, copy `contrib/levels.sample.json` → `levels.json` and bump `levelsVersion`.

---

## Tuning (all in `config.js`)

- `leaderboard.pollMs` — how often the board refreshes (default 15s).
- `leaderboard.cutoff` — hide scores submitted after this moment (freeze the podium once the party ends). `''` = no cutoff.
- `leaderboard.ignoreNames` — names to hide (your test runs).
- `weddingDate` — the countdown shown in the play HUD.

**No anti-cheat.** Scores are submitted by the browser and are trivially spoofable — fine for a friendly wedding game, not for anything that matters.
