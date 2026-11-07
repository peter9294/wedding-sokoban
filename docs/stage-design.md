# Stage design — *Something Pushed*

How the teaching stages were built, how to test any stage, and the rules a stage must
follow so it actually works in the shipped game.

> **Where these live & how to use them.** Level design is intentionally deferred to you, so
> these **21 stages** ship as an **opt-in sample** at
> [`contrib/levels.sample.json`](../contrib/levels.sample.json) — they are **not** the game's
> live `levels.json` (which keeps throwaway placeholders until you decide). They are **drafts
> to playtest**: weak stages get cut or reworked as the user plays, so the count and order move
> (the table below and the tester are the live source of truth). To play the set
> locally, use the playtest harness (below) — or copy it over the shipped file:
> ```bash
> cp contrib/levels.sample.json levels.json
> ```
> Then design your own clever/hard stages — on top of these or from scratch — and run every
> one through the tester (below) before shipping.

> **Playtest harness.** [`playtest/`](../playtest/) is a local, no-score, no-form player:
> pick any stage from the dropdown and solve it with the arrow keys / WASD / a D-pad. It
> imports the **exact same rules** as the tester, so what you play is what the tester
> validates. Serve the repo root over http and open `/playtest/` (a `.claude/launch.json`
> entry is set up for it). Hit **⟳ Reload stages** after any edit to `contrib/levels.sample.json`.

---

## The win model (read this first)

Two kinds of level exist in the engine:

- **Standard** (no `c` cages): you win when **every gift is on a petal heart**.
- **Cage + bride** (has `c` and a `B`): you win the moment the **groom steps ONTO the
  bride's tile**. The bride is walkable by the groom (she's the goal he reaches), but
  boxes and stones can't be pushed onto her.

The whole set uses the **cage + bride** model, because that's the feel we want:
*you can walk right up to the bride, but a locked cage blocks the last step; solve the
gift-puzzle to open it, then step through onto her.* The cage opens when **every heart is
covered** (by a matching gift — see colors below — a stone, or the groom, per heart type).

### The one gotcha that will bite you

**Reaching the bride is gated only by the CAGE, not by any on-win check.** `isWon` just
asks "is the groom standing on the bride's tile?" — it does *not* check that the cage is
open. The cage matters because it is **solid while closed** and so physically blocks the
only path to her.

➡️ **Therefore every tile orthogonally next to the bride must be a wall or a cage.** If you
leave one open-floor tile next to her, the groom can stroll over and win without solving
anything. The tester fails any level that does this ("bride is NOT enclosed").

So the reliable recipe is: **wall the bride in on three sides, put a cage on the fourth as
the gate.** The groom covers all hearts → the gate opens → he steps through it onto the
bride.

---

## Mechanics reference (what each piece does)

- **Gift `$` / cake `k`** — pushable one tile at a time; you can only push (never pull), so
  you must get *behind* a box to move it. Cake is a gift with a different sprite, same rules.
- **Rolling stone `O`** — when pushed it **slides until something stops it** (a wall, the
  board edge, another box/stone, or a bride tile). It can't be nudged one tile; it commits to
  the full slide. A stone can cover a **neutral** heart but never a colored one.
- **Warp pad `o`** (must come in a pair) — stepping onto one teleports **the groom** to its
  twin. **Boxes and stones do NOT warp** — only the player. This is what makes a warp
  *essential*: it's the only way to reach a region (e.g. to get *behind* a box) that has no
  walking path. If the twin is blocked by a box/stone, the warp does nothing that step.
- **Colored hearts & gifts `1`–`9`** — a colored heart is filled **only** by a gift of the
  **same** color. A neutral gift `$` can **not** fill a colored heart. A **neutral heart `x`**
  is a wildcard: any gift (any color) *or* a stone fills it — which is a trap, because spending
  a colored gift on a wildcard can strand the matching colored heart (see *The Right Gift*).
- **Cage `c`** — solid while closed; opens when every heart is covered. Opening also counts a
  box/stone/groom sitting on a cage tile, so never leave a heart on a bride-adjacent cage.

---

## Testing a stage (do this before shipping any level)

`tools/stage-tester.mjs` is a headless Node port of the **exact** game rules
(`solid`/`cageOpen`/`isWon`/`step`, verified line-for-line against `src/engine.js`,
including the step-onto-bride win rule and the color mechanic). It does three things for
every level:

1. **Validates structure** — one groom, gifts == hearts (stones may legitimately cover a
   heart), per-color gift/heart balance, warps are 0 or 2, and the bride is properly enclosed.
2. **Solves it** — a full breadth-first search over every reachable `(player, gifts, stones)`
   state (the player can't be normalized away, because the win depends on *where he stands*).
   It prints the **shortest solution** as a move string (`U`/`D`/`L`/`R`) and the push count,
   or **UNSOLVABLE**.
3. **Detects exploits** — it checks whether *any* win is reachable **without** covering every
   heart with the right cargo (matching-color gift for a colored heart; any box/stone for a
   neutral one). If so, it prints **EXPLOIT FOUND** and fails the level.

```bash
node tools/stage-tester.mjs contrib/levels.sample.json   # test the whole sample set
node tools/stage-tester.mjs levels.json                  # ...or whatever file you're shipping
node tools/stage-tester.mjs --selftest                   # run the engine's own unit tests (15)
```

A stage is good only when it reports **VERDICT: ✓ PASS** (solvable *and* exploit-free).
The BFS is exact for small boards; it has a 4,000,000-node cap (`--cap N` to change) and
uses dead-square pruning (when every gift must land on a heart, no stones, no cheese risk) to
stay fast. If a giant level hits the cap the result is marked inconclusive — keep boards
compact and gifts ≤3 and it never happens (the whole 21-stage set verifies in a few seconds).
Full-state BFS tracks the groom *and* every box, so it doesn't scale to 4+ gifts on an open
board; that's the practical ceiling for an auto-verified level.

> Note: the tester proves a level **can** be solved and **can't** be cheesed. It does
> **not** promise you can never get stuck — pushing a gift into a corner is a normal,
> intended way to fail (undo/restart exist). That's a feature: it's how players learn.

---

## Design rules a stage must satisfy (tester-enforced)

| Rule | Why |
|---|---|
| Exactly one groom `@` | start position |
| `gifts == hearts` | the cage opens only when **all** hearts are covered, so every gift must be needed (a rolling stone `O` may legitimately cover one heart — then gifts < hearts and the tester just **warns**) |
| Enough matching gifts per color | a color-`N` heart can only be filled by a color-`N` gift; too few is an unsolvable error |
| Every bride neighbour is wall/décor/pond or a cage `c` | otherwise the groom reaches her without solving (see gotcha) |
| At least one cage touches the bride | otherwise she's sealed off forever (unsolvable) |
| No heart `x` under a bride-adjacent cage | else the groom covers it himself and skips a gift |
| Keep hearts ≥3 tiles from the bride | a nearer heart lets the groom stand on it to open the cage and step straight in (cheese) — tester **warns**, and the BFS flags it as an exploit |
| Warp pads `o`: exactly 0 or 2 | engine only teleports with a matching pair |
| Center path to the gate stays open after solving | or the groom can't walk to the bride (tester catches as UNSOLVABLE) |

Solid chars (block movement): `# Q f h l B` and pond `~`, plus a **closed** cage `c`.

---

## The stages

All 21 use the cage+bride model. Legend (merged floor + map view): `@` groom · `$` gift ·
`k` cake · `O` rolling stone · `o` warp pad · `x` neutral heart · `1`/`2` colored heart or
gift · `c` cage gate · `B` bride · `=` aisle · `#`/`~` wall/pond.

Difficulty by solution length is only a rough gauge — a new mechanic or a forced order can
make a short level feel harder than a long straightforward one. Counts below are the tester's
current verified shortest solve (all include the final step onto the bride).

| # | Stage | Scene | Teaches | Verified |
|--:|-------|-------|---------|----------|
| **1** | First Steps Down the Aisle | day · hedge | the core loop: push a gift onto a heart → cage opens → reach the bride (impossible to fail) | 4 / 2 |
| **2** | Mind Your Approach | day · hedge | you can't *pull* — loop around to push from the right side | 9 / 1 |
| **3** | Don't Box Yourself In | golden · blossom | the corner/pocket **deadlock** — one shove is fatal | 20 / 4 |
| **4** | First Things First | golden · hedge | **order matters** — don't plug the only gap to the far room | 26 / 6 |
| **5** | Single File | day · hedge | **funnel** — two gifts through one 1-wide gap, spread to corners | 40 / 14 |
| **6** | Through the Looking-Glass | golden · blossom | **warp pad** intro — warp into a sealed pocket to push, warp back | 11 / 2 |
| **7** | Rolling Stones | day · fence | **rolling stone** intro — slide it to a heart against the far wall | 11 / 2 |
| **8** | Something Blue, Something New | golden · blossom | **colour** intro — each gift must cross to its *matching* heart | 32 / 14 |
| **9** | The Rehearsal | evening · hedge | **forge-graded** — tight room; the obvious plan bricks | 46 / 9 |
| **10** | The Keystone | day · fence | **stone + colour** — the *easier* of the two stone stages | 36 / 10 |
| **11** | Save the Date | golden · blossom | **forge-graded** — a forced return and a long detour | 26 / 9 |
| **12** | The Dress Code | evening · fence | **deep colour** — the nearest-match plan bricks (the set's highest trap) | 60 / 16 |
| **13** | The Guest List | day · hedge | **forge-graded** — two returns + a detour | 55 / 10 |
| **14** | The Getaway Car | golden · hedge | **deep warp** — the first deep warp: the gifts are only reachable *through* the pads | 44 / 17 |
| **15** | Something Borrowed, Something Blue | evening · hedge | **colour funnel** — two coloured gifts through a gap, matched across | 40 / 14 |
| **16** | The Narrow Path | golden · hedge | **big funnel** — three gifts through one gap, spread to three hearts | 47 / 18 |
| **17** | Cold Feet | day · fence | expert: **stone** — a counterintuitive bounce; the obvious push dead-ends | 48 / 13 |
| **18** | The Bridesmaids | golden · hedge | **deep colour** — the most back-and-forth of any stage (returns + long detours) | 70 / 16 |
| **19** | Tying the Knot | evening · fence | **forge-graded boss** — one solution; the obvious plan always bricks | 40 / 10 |
| **20** | The Color Procession | evening · hedge | expert: **colour** — a three-colour procession | 60 / 22 |
| **21** | Stone Bridge | day · fence | expert: **stone** — clear the runway, then aim the L-slide (the *harder* stone, finale) | 22 / 6 |

> **Tiers.** *Basics* 1–5 (one idea each) · *Mechanics & deepening* 6–14 (warp / stone / colour
> introduced at 6/7/8; 9 / 11 / 13 are **forge-generated deep** neutral puzzles where the obvious
> "each gift to its nearest heart" plan bricks; 10 The Keystone is the *easier* stone stage; 12 The
> Dress Code and 14 The Getaway Car are the first **deep colour** and **deep warp** stages, promoted
> from a rating round) · *Advanced* 15–21 (funnels and the expert mechanics, ending 19 → 21: **neutral
> boss → colour showpiece → stone finale**; no two colour/stone neighbours alike). The two stone
> stages run easy→hard — **Keystone (10)** before **Stone Bridge (21)**. Weak stages get cut as the
> user plays, so the list moves; re-run the tester for the live arc.
>
> **Difficulty is how hard a stage is to _solve_, not how long it is.** A clever setup that
> executes in two pushes — a warp you step through, a stone that slides home — reads as *easy*: the
> search space can be huge and the human still sees the move at a glance. What reads as *hard* is
> when the **obvious plan has a hidden trap** — the gift you'd push first silently seals a corridor,
> or the nearest heart has to be filled last. `tools/puzzle-forge.mjs` grades exactly that (trap /
> returns / detour), which is why the deep stages are forge-picked, not hand-authored. (Learned
> twice the hard way: a batch graded "hard" by solver node-count played as *trivial* — node-count
> is the machine's work, not the human's — and a batch of "forgiving/guessable" stages played as
> *shallow*. Depth = the obvious plan must fail.) Re-run the tester after any change.

### The deepening & expert stages (9–21)

The arc iterates fast as the user plays — weak stages get cut or swapped — so the per-stage
walkthroughs that used to live here went stale faster than they were worth keeping. The **table
above is the authoritative list**, and `node tools/stage-tester.mjs contrib/levels.sample.json`
prints the current solution and push count for every stage.

In short: 9 / 11 / 13 / 19 are **puzzle-forge** picks — deep neutral rooms where the obvious "each
gift to its nearest heart" plan bricks (returns, detours, hidden traps). 12 The Dress Code, 14 The
Getaway Car, and 18 The Bridesmaids are forge-graded **deep colour / warp** stages the user picked
from a rating round and promoted into the arc (Dress Code has the set's highest trap; Getaway Car is
the first deep warp; Bridesmaids has the most returns). 10 The Keystone and 21 Stone Bridge are the
two **stone** stages, ordered easy → hard. The arc closes on the expert run 19 → 21 (neutral boss →
three-colour procession → stone finale).

---

## Methodology & sources

Grounded in standard puzzle-teaching practice:

- **One new concept per level, reinforced by repetition; early levels teach, not
  challenge** — the widely-recommended approach for puzzle onboarding. Here each new
  mechanic is *introduced* (6/7/8), then *deepened* into something essential (9/10/11).
- **Deadlock teaching order: corner first**, since a crate pushed into a corner can never
  move again — the first deadlock every Sokoban player meets.
- **Microban (David W. Skinner) philosophy** — small, deliberate levels that each
  demonstrate one or two ideas, with every tile placed on purpose.
- **Automated solvability + reachability checks** are standard practice for catching
  unsolvable/broken levels — which is exactly what `tools/stage-tester.mjs` does, plus an
  exploit check specific to the cage+bride win.

The levels here are **original designs** built from those canonical patterns (corner trap,
go-around, forced order, L-push, funnel) rather than copies — the cage+bride win condition
changes the structure from classic Sokoban anyway. A new mechanic is proven *essential* by
testing a control with it removed and confirming the stage becomes unsolvable.

Sources:
- [Sokoban — Wikipedia](https://en.wikipedia.org/wiki/Sokoban)
- [Sokoban deadlocks (jsokoapplet)](https://jsokoapplet.sourceforge.io/sokoban/deadlocks.html)
- [Microban I (David W. Skinner)](https://au-voleur.itch.io/microban-1)
- [Mastering Sokoban: deadlock avoidance & path planning](https://dinogame.gg/blog/mastering-sokoban/)
