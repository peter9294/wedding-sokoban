# Something Pushed

A wedding-themed Sokoban. Push every gift onto a petal heart before the vows.
Two static sites in one repo: the **game** and a live **leaderboard**.

- **Play:** enter a name → tutorial → push gifts onto hearts. Clearing a stage auto-submits your score.
- **Leaderboard:** a separate page that polls the scores on an interval and ranks players by **most stages cleared**.
- **Resume:** your progress (and the exact in-progress board) is saved locally, so you can close the tab and pick up where you left off.
- **Free hosting:** plain static files on GitHub Pages. No build step, no server.
- **Scores** are saved with the "Google Form auto-filler" technique (a Google Form + linked Sheet in your own Google account).

## Get it running

- **Online + score saving:** see **[SETUP.md](SETUP.md)** (deploy to GitHub Pages + run one Apps Script).
- **Locally:** any static server from the repo root, e.g.
  ```bash
  python3 -m http.server 8777
  ```
  then open `http://localhost:8777/` (game) and `http://localhost:8777/leaderboard/` (leaderboard).
  ES modules need http(s) — opening `index.html` as a `file://` won't work.

## Layout

```
index.html            game shell
leaderboard/          the leaderboard page
config.js             <-- the ONE file you edit to connect Google (see SETUP.md)
levels.json           stages (5 tested cage->bride tutorial levels; extensible)
src/
  engine.js           pure rules: push / cages / warps / stones / win  (ported from the handoff)
  sprites.js          16x16 pixel-art sprite builder (ported)
  render.js           canvas renderer: animations + lighting (ported)
  game.js             screens, input (keyboard + D-pad + swipe), HUD, resume, submit-on-win
  storage.js          localStorage progress (version-guarded, resume)
  score.js            Google Form submit (+ retry outbox) and gviz-JSON leaderboard reader
apps-script/setup.gs  one-click creator for the Form + Sheet (prints your config)
SETUP.md              deploy + wiring + smoke test
```

The engine, sprites, and renderer are faithful ports of the "Wedding Sokoban" prototype;
the game screens, persistence, scoring, and leaderboard are new.

## Design / levels

The game ships **5 tested cage→bride tutorial stages**, built in a dedicated stage-design pass and
validated by `tools/stage-tester.mjs` (solvable + exploit-free). Author more with the **Level
Designer** tool from the handoff and export `levels.json` (same format); run every new stage through
the tester — especially the bride-enclosure rule documented in `docs/stage-design.md`. The couple's
initials shown above the characters are set in `config.js` (`couple`).

## Notes

- Ranking is by distinct stages cleared, keyed on the player's (normalized) name; ties go to whoever reached the count first. The whole point is clearing clever, hard stages — not move/time optimization.
- No anti-cheat. Scores are client-submitted (fine for a wedding, not for anything serious).
