# Handoff: "Something Pushed" — Level Designer (dev tool)

## Overview
An internal level editor for **Something Pushed**, a wedding-themed Sokoban puzzle game (pixel art, mobile portrait in-game). Designers paint two-layer tile maps, get live validity checks and an automatic solvability proof, playtest in place, and export JSON consumed by the game.

Companion reference: `Wedding Sokoban Art Style.dc.html` — the in-game art/UI style guide (mobile screens, palette, characters, pushables, terrain, walls, rules). The editor's sprites are the same 16×16 pixel art.

## About the design files
The `.dc.html` files are **design references built in HTML** — working prototypes showing intended look and behavior, not production code. Recreate them in the target codebase's environment (e.g. React + TS + Vite for the editor, whatever engine the game uses). If no environment exists, a React/TS SPA for the editor plus a shared, framework-free `core/` package (level format, rules, solver) used by both editor and game is recommended.

The prototype's logic is already plain JS (one class in the `<script data-dc-script>` block of `Level Designer.dc.html`) — port it rather than reinventing it. It opens directly in a browser (needs `support.js` next to it).

## Fidelity
**High-fidelity.** Colors, type, spacing, sprites, and interactions are final for this dev tool. Game-side screens are hifi in the Art Style file.

---

## Level format (the contract — get this right first)

```json
{
  "name": "Garden Ceremony",
  "lighting": "day" | "golden" | "evening",
  "wallStyle": "hedge" | "blossom" | "fence",
  "floor": ["....", ...],   // h rows of w chars
  "map":   ["####", ...]    // same size; internally called `top`
}
```
- Size: **w 4–24, h 4–30**. Every row padded/truncated to `w`; unknown chars sanitize to `.`.
- `levels.json` = array of these, in stage order.
- Editor also has internal `id` (random string) per level — not exported.

**Floor layer** (`FLOORS = ".=_~xo"`)
| ch | name | notes |
|---|---|---|
| `.` | Meadow | grass, checkerboard of two variants |
| `=` | Aisle runner | red carpet |
| `_` | Stone path | |
| `~` | Pond | **solid**; nothing may sit on it |
| `x` | Petal heart | goal / pressure plate |
| `o` | Warp pad | must be exactly 0 or 2 per level |

**Map layer** (`TOPS = ".#QfhlB@$kOc"`)
| ch | name | behavior |
|---|---|---|
| `#` | Wall | solid; sprite follows `wallStyle` |
| `Q` | Chapel brick | solid |
| `f` | Picket fence | solid |
| `h` | Guest chair | solid |
| `l` | Lantern | solid; light source at `evening` |
| `B` | Bride | solid; win target in cage levels |
| `@` | Groom start | exactly one |
| `$` | Gift | pushable box |
| `k` | Cake | pushable box (identical rules, different sprite) |
| `O` | Rolling stone | pushed → slides until blocked; doesn't count for hearts in standard levels |
| `c` | Heart cage | solid until open |

Solid = `floor ~` or map in `SOLIDTOP = "#fQhlB"`, or out of bounds. `*` (gift on heart) is accepted on import / as a brush = floor `x` + map `$`. Single-layer ASCII import splits floor chars to floor, `*` to both, everything else to map.

## Game rules (implemented in `step`, `isWon`, `cageOpen`)
- Move 4 directions. Push one box (`$`/`k`) one tile if the tile beyond is free (not solid, no box/stone, not a closed cage).
- Stone (`O`): pushing it slides it until the next tile is blocked. Animated (ease-out, 70ms + 75ms per tile, 4-frame rotation).
- Warp: stepping onto a pad teleports to the other pad if its tile has no box/stone.
- **Standard level** (no cages): win when every box is on a heart (box count must equal heart count).
- **Cage level** (≥1 `c`): cages open when *all hearts are occupied* (by boxes, stones, or groom) **or** any cage tile is occupied. Win = groom orthogonally adjacent to a bride (if any bride exists), else groom stepping into an open cage. Note: bride adjacency is not gated on the cage being open — level designers must enclose the bride. Flag this to game design.
- Undo is unlimited in play; R restarts.

## Screens / views
Single full-viewport screen (`100vh`, no page scroll), 3 columns under a header.

**Header** (`#fffaf4`, 2px bottom border `#3a2433`, padding 12/20, wraps):
eyebrow "Something Pushed" 11px `#6e5664` / title "Level designer" Pixelify 20/700; "DEV" pill (`#3a2433` bg, `#f6c94f` text, 11px, .08em); tool group Brush B · Erase E · Fill G · Pick I (36px tall, active = ink bg/cream text, key hint `#f7a1bd` active / `#a8325a` idle); undo/redo 40×36 pixel-icon buttons (disabled: `#f3e9e1` bg, `#d9c9c4` border, no shadow, icon 30% opacity); spacer; PLAYTEST button 40px tall, Pixelify 16/700 .06em, bg `#e0507a` (grey `#c3bec9` when no groom, ink `#3a2433` + "STOP / Esc" while playing).

**Left aside 244px** (scrolls): 
- *Levels* card: list rows (num 01, name ellipsized, size `11×18`), selected row ink bg; grid `1fr 1fr 36px 36px`: New, Duplicate, ▲, ▼; "Delete this level" underlined link `#a8325a` (disabled at 1 level, undo via toast).
- *Tiles* card: 3 groups (Floor / Walls & décor / Puzzle), 4-col grid of 48px tiles with 32px sprite thumb + map char bottom-right 10px; selected = ink bg+border; footer shows brush name + layer ("floor layer" / "map layer" / "floor + map").

**Center**: checkered board (`#f3e9e1`/`#ede0d6`, 24px tiles) holding the canvas framed by 3px ink border, radius 10, `box-shadow:0 5px 0 #3a2433`. Canvas internal = 16px/tile, CSS-scaled by zoom 1–5× (default 2), `image-rendering:pixelated`. Optional grid overlay `rgba(58,36,51,.16)` 1px. Status bar beneath: hover info ("col 3 · row 5 · Meadow + Gift") or hint text, counts line, zoom −/+ controls. Toast: ink pill bottom-center, optional yellow action button (6s with action, 2.2s without). Win overlay: `rgba(58,36,51,.6)` scrim, card max 280px, "CLEARED" gold tag, "Just married!" Pixelify 28/700 `#a8325a`, Replay / Edit buttons.

**Right aside 272px** (scrolls):
- *Level*: Name input (Pixelify 16, max 32 chars), Lighting segmented (day/golden/evening), Wall style segmented (hedge/blossom/fence).
- *Size*: "W × H" readout, ± per edge (Top/Bottom/Left/Right add/remove row/col), Shift map 4 arrows.
- *Checks*: issue rows tinted by kind; click flashes the related cells (yellow pulse, 1.8s); "Solvable" row starts an auto-replay of the solution.
- *Export*: dark textarea (`#2a1a25`/`#fbf3ea`, DM Mono 11.5) showing live JSON; editing turns it into a draft ("edited · not applied"); Copy / Apply / All .json (download `levels.json`).

All cards: `#fffaf4`, 2px ink border, radius 12, padding 14. Buttons: 2px ink border, radius 8 (6 for small), `box-shadow:0 2px 0 #3a2433`, `:active` translateY(2px) and shadow none.

## Interactions
- Left-drag paints (stroke interpolated cell-to-cell, one undo entry per stroke); right-drag erases (erase removes map object first, then floor). Pick sets brush from cell then returns to Brush. Fill = 4-way flood on the brush's layer, bounded by same floor char (map fills) or walls (floor fills); `@` and `o` can't be filled.
- Placing `@` removes any other `@`. A 3rd warp pad is refused with a toast. Painting a map object onto pond turns floor to meadow; painting pond clears the map object.
- Keyboard (ignored while typing in inputs): tile chars select brush (`. = _ ~ x o # Q f h l B @ $ k * O c`), B/E/G/I tools, P playtest, `[`/`]` or `-`/`+` zoom, ⌘/Ctrl-Z undo, ⇧⌘Z or ⌘Y redo, ⇧+arrows shift map, ⌥↑/↓ reorder level.
- Playtest: arrows/WASD/swipe (≥24px), Z undo, R restart, Esc/P stop. Any key during solution replay takes over. Edit controls dim to 45% and are inert during play.
- Edit history: per level, 150 steps, name typing coalesced within 1.5s.
- Autosave: full level list to `localStorage['sp-level-designer-v2']` on every change (migrates v1 `rows` format).

## Validation & solver
`checks(L)` returns error/warn/info items (with cells to highlight): missing/multiple groom, no hearts, box≠heart count (standard) or boxes>hearts (cage), warp count ≠2, cage needing more pressers than exist, unsealed border, boxes on dead squares (reverse-push reachability from hearts), boxes/hearts unreachable from start, cage-level win-mode info. Dead boxes are also marked on canvas (pink square + x), toggle `markDeadlocks`.

`runSolve` = BFS over push states (player normalized to min reachable cell), dead-square and 2×2 freeze pruning (standard levels only), warps and cages modeled, 250k-node cap, run in 14ms time slices via `setTimeout`, debounced 450ms after edits, cached by level signature (max 200). Statuses: pending/running/solved/none/limit/skip (skip when errors exist). `buildMoves` expands push list to step moves for replay (150ms/step). **In production, move the solver into a Web Worker.**

## State
`levels[]`, `cur`, `brush`, `tool`, `hover`, `play` ({player, boxes, stones, dir, push, hist, won} or null), `hist{[levelId]: {past, future}}`, `draft` (export text or null), `flash`, `zoom`, `copied`, `applyErr`, `toast`, `solve`, `watching`. Non-React refs: stroke working copy (`work`, `snap`, `lastP`), stone animation `anim`, cage animation `cageA`, timers.

## Rendering (canvas, 16px tiles, draw order)
1 floor (water 2-frame @650ms + bank lip on top edge; grass alternates A/B by (r+c)%2; wall drop-shadow under `#fQ`; hearts raised or pressed when occupied; warp 2-frame) → 2 static map objects (walls, chair/lantern/bride with ground shadow) → 3 cages (bars slide down 12px over 220ms ease-out when open) → 4 stones (+cyan glow pulsing 0.8–1.0 alpha, sin t/380) → warp sparkles → boxes (glow when off-heart; gold "On" variant + sparkle on heart) → groom (4 facings + push poses) → lighting (golden: multiply `rgba(255,190,130,.45)` + screen diagonal gradient; evening: multiply `rgba(70,55,140,.6)` + screen radial glow r=34 per lantern) → editor overlays (deadlock marks, flash, hover ghost at 60%, hover outline white / pink for erase).

Sprites are defined as 16-row char strings against `PAL` in `buildSprites()` — export them to PNG sprite sheets for the game, or keep the string format as source of truth.

## Design tokens
Colors: ink `#3a2433`, ink-deep `#2a1a25`, paper `#fbf3ea`, card `#fffaf4`, sunk `#f3e9e1`, checker `#ede0d6`, rule `#d9c9c4`, muted `#6e5664`, rose `#e0507a`, wine `#a8325a`, pink `#f7a1bd`, blush `#fde3ea`, gold `#f6c94f`, amber `#c98c2c`, disabled `#c3bec9`.
Issue tints (bg / dot): error `#fde3ea`/`#e0507a`, warn `#fbefd6`/`#c98c2c`, ok `#e5f2dc`/`#4f9e45`, info `#efe8f4`/`#9c86b4`.
Sprite palette: see `PAL` in source (30 entries).
Type: **Pixelify Sans** 400/600/700 (titles, buttons), **DM Mono** 400/500 (UI body 13px, labels 11px uppercase .08em `#a8325a`, meta 11–12px). Google Fonts.
Radii: 999 pill, 12 card, 10 canvas/toast, 8 button/input, 6 small button, 5 segment, 2–4 dots/tags. Spacing: 4/6/8/10/12/14/16/24. Shadows: hard offset only — `0 2px 0 ink` (buttons), `0 3px 0` (play), `0 4px 0 #2a1a25` (toast), `0 5px 0` (canvas, win card).

## Tweakable props (prototype)
`showGrid` (true), `markDeadlocks` (true), `brushGhost` (true).

## Audit — fixed in this pass
- Fast drags skipped cells / could drop paints when React batched updates → strokes now use a local working copy plus line interpolation.
- Releasing the mouse outside the window left the brush "stuck down" → stroke ends when the pointer returns with no buttons pressed.
- Clicking the canvas after typing in Name/Export left focus in the field, so all shortcuts silently stopped working → canvas blurs focused fields.
- Size/shift/Apply were still active during playtest (desynced the board) → blocked while playing.
- Imported JSON / stored levels weren't validated (bad chars, wrong row lengths, unknown lighting, missing ids could crash render or share undo history) → `normalize()` sanitizes everything and dedupes ids.
- "All .json" export had no import path → pasting a levels.json array into Export + Apply appends all levels.
- Copy always said "Copied" even when the clipboard was blocked → real result with fallback.
- Solver cache grew unbounded → capped at 200. "Any key to take over" during replay now works for every key. Cage animation state reset on level switch.

## Known gaps / recommended next steps
1. Solver on main thread (time-sliced) — move to a Web Worker; add a push-count/moves readout and an optimal-push mode for difficulty rating.
2. Touch editing is tap-only (no drag painting on touch); playtest swipes work. Add pointer events if tablets matter.
3. Editing the level discards an unapplied Export draft without warning.
4. Level reordering / delete don't enter undo history (delete has a toast undo).
5. No auto-fit zoom; large levels scroll inside the board.
6. Canvas redraws every animation frame even when idle — fine for a dev tool, gate it for battery if needed.
7. No `par`/metadata fields yet (v1 had `par`, dropped in migration) — decide with game design.
8. Persistence is browser-local only; levels.json should be committed to the game repo as the source of truth.
9. Accessibility: tool/segment buttons lack `aria-pressed`; canvas has no keyboard cursor for editing.

## Files
- `Level Designer.dc.html` — the editor (template + logic). Primary reference.
- `Wedding Sokoban Art Style.dc.html` — game art + in-game UI style guide.
- `support.js` — runtime needed to open the `.dc.html` files in a browser (not part of the design).
- `Level Designer v1.dc.html` (not included) — superseded single-layer version.
