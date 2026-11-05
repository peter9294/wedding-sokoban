# Stage design — *Something Pushed*

How the teaching stages were built, how to test any stage, and the rules a stage must
follow so it actually works in the shipped game.

> **Where these live & how to use them.** Level design is intentionally deferred to you, so
> these 5 stages ship as an **opt-in sample** at [`contrib/levels.sample.json`](../contrib/levels.sample.json) —
> they are **not** the game's live `levels.json` (which keeps throwaway placeholders until you
> decide). To play this set, copy it over the shipped file:
> ```bash
> cp contrib/levels.sample.json levels.json
> ```
> Then design your own clever/hard stages — on top of these or from scratch — and run every
> one through the tester (below) before shipping.

---

## The win model (read this first)

Two kinds of level exist in the engine:

- **Standard** (no `c` cages): you win when **every gift is on a petal heart**.
- **Cage + bride** (has `c` and a `B`): you win the moment the **groom is orthogonally
  adjacent to the bride**.

The whole tutorial uses the **cage + bride** model, because that's the feel we want:
*you can walk right up to the bride, but a locked cage blocks the last step; solve the
gift-puzzle to open it.* The cage opens when **every heart is covered** (by a gift, a
stone, or the groom).

### The one gotcha that will bite you

**Bride-adjacency is NOT gated on the cage being open.** The engine's `isWon` for a
cage+bride level only checks "is the groom next to the bride?" — it does *not* check that
the cage is open. The cage only matters because it is **solid while closed** and so
physically blocks the path.

➡️ **Therefore every tile orthogonally next to the bride must be a wall or a cage.** If you
leave one open-floor tile next to her, the groom can stroll over and win without solving
anything. The tester fails any level that does this ("bride is NOT enclosed").

So the reliable recipe is: **wall the bride in on three sides, put a cage on the fourth as
the gate.** The gate only becomes passable once all hearts are covered → the puzzle is the
real lock.

---

## Testing a stage (do this before shipping any level)

`tools/stage-tester.mjs` is a headless Node port of the **exact** game rules
(`solid`/`cageOpen`/`isWon`/`step`, verified line-for-line against `src/engine.js`). It
does three things for every level:

1. **Validates structure** — one groom, gifts == hearts, warps are 0 or 2, and the bride
   is properly enclosed.
2. **Solves it** — a full breadth-first search over every reachable `(player, gifts,
   stones)` state. If a win is reachable it prints the **shortest solution** as a move
   string (`U`/`D`/`L`/`R`) and the push count. If not, it says **UNSOLVABLE**.
3. **Detects exploits** — it checks whether *any* win is reachable **without** covering
   every heart with gifts. If so (e.g. a badly-enclosed bride, or a heart the groom can
   stand on himself), it prints **EXPLOIT FOUND** and fails the level.

```bash
node tools/stage-tester.mjs contrib/levels.sample.json   # test this teaching set
node tools/stage-tester.mjs levels.json                  # ...or whatever file you're shipping
node tools/stage-tester.mjs --selftest                   # run the engine's own unit tests (11)
```

A stage is good only when it reports **VERDICT: ✓ PASS** (solvable *and* exploit-free).
The BFS is exact for small boards; it has a 2,000,000-node cap (`--cap N` to change). If a
giant level hits the cap the result is marked inconclusive — keep tutorial-ish levels
small and it never happens.

> Note: the tester proves a level **can** be solved and **can't** be cheesed. It does
> **not** promise you can never get stuck — pushing a gift into a corner is a normal,
> intended way to fail (undo/restart exist). That's a feature: it's how players learn.

---

## Design rules a stage must satisfy (tester-enforced)

| Rule | Why |
|---|---|
| Exactly one groom `@` | start position |
| `gifts == hearts` | the cage opens only when **all** hearts are covered, so every gift must be needed |
| Every bride neighbour is wall/décor/pond or a cage `c` | otherwise the groom reaches her without solving (see gotcha) |
| At least one cage touches the bride | otherwise she's sealed off forever (unsolvable) |
| No heart `x` under a bride-adjacent cage | else the groom covers it himself and skips a gift |
| Warp pads `o`: exactly 0 or 2 | engine only teleports with a matching pair |
| Center path to the gate stays open after solving | or the groom can't walk to the bride (tester catches as UNSOLVABLE) |

Solid chars (block movement): `# Q f h l B` and pond `~`, plus a **closed** cage `c`.

---

## The tutorial set (5 stages)

One new idea per stage, reinforced — the standard way to teach a puzzle game. Difficulty
ramps by solution length: **3 → 9 → 11 → 25 → 19 moves**. Legend below is the merged view
(floor + map): `@` groom · `$` gift · `x` heart · `c` cage gate · `B` bride · `#` wall.

### 1 · First Steps Down the Aisle — *the core loop* (day / hedge)
```
# # # # # #
# @ $ . x #
# # # c # #
# # # B # #
# # # # # #
```
**Teaches:** push a gift onto a heart → the cage opens → walk to the bride. **Pitfall:**
none — this stage is deliberately *impossible to fail*. The gift sits in a 1-wide corridor,
so the only thing you can do is push it right onto the heart (it can't overshoot into the
wall, and you can't get around to push it back). **Solution:** `RRD` (3 moves, 2 pushes).

### 2 · Mind Your Approach — *you can't pull* (day / hedge)
```
# # # # # # #
# . . . . . #
# . x $ . . #
# . . . . . #
# @ . . . . #
# # # c # # #
# # # B # # #
# # # # # # #
```
**Teaches:** to move a gift *left*, you must stand on its *right*. The heart is left of the
gift and the groom starts on the left — you have to walk **around** to the far side to push
it. **Pitfall:** the instinct to "pull it toward you," which the game never allows.
**Solution:** `URRRULDDD` (9 moves, 1 push).

### 3 · Don't Box Yourself In — *the corner trap* (golden / blossom)
```
# # # # # # #
# . . . . . #
# . . . . . #
# . . $ . . #
# . . . . @ #
# # # c # # #
# # # B # # #
# # # # # # #
```
Heart is at the far left (row 3, col 1). **Teaches:** a gift pushed into a corner is lost
forever. The correct line pushes the gift left to the wall, then **up** onto the heart;
pushing it **down** from the wall jams it in the bottom-left corner (dead). **Pitfall:** the
tempting wrong push at the wall. **Solution:** `ULLLDLUDRRD` (11 moves, 3 pushes).

### 4 · First Things First — *order matters* (golden / hedge)
```
# # # # # # #
# x . . $ . #
# . . . . . #
# # # x # # #     <- this heart is the ONLY gap between the two rooms
# . . $ . . #
# . . @ . . #
# # # c # # #
# # # B # # #
# # # # # # #
```
**Teaches:** sequencing. The top room (with its own gift + heart) is reachable **only**
through the gap at the middle heart. If you deliver the lower gift onto that gap **first**,
you wall yourself out of the top room and the level becomes unsolvable. So: clear the top
room first, then plug the gap last. **Pitfall:** solving the near gift first (provably
dead-ends — verified). **Solution:** `LURUURRULLLDRDDDRRULDLUDD` (25 moves, 6 pushes).

### 5 · The Garden Gate — *synthesis* (evening / fence)
```
# # # # # # #
# x . . . x #
# . . . . . #
# . $ . $ . #
# . . @ . . #
# # # c # # #
# # # B # # #
# # # # # # #
```
**Teaches:** the composite skill — two gifts, each needing an **L-shaped push** (shove to
the wall, then up into the corner heart) plus repositioning between them. A graduation
victory lap that uses everything from stages 2–3. **Solution:** `ULDLUUDRRRDRUUDDLLD`
(19 moves, 6 pushes).

---

## Methodology & sources

Grounded in standard puzzle-teaching practice:

- **One new concept per level, reinforced by repetition; early levels teach, not
  challenge** — the widely-recommended approach for puzzle onboarding.
- **Deadlock teaching order: corner first**, since a crate pushed into a corner can never
  move again — the first deadlock every Sokoban player meets.
- **Microban (David W. Skinner) philosophy** — small, deliberate levels that each
  demonstrate one or two ideas, with every tile placed on purpose.
- **Automated solvability + reachability checks** are standard practice for catching
  unsolvable/broken levels — which is exactly what `tools/stage-tester.mjs` does.

The levels here are **original designs** built from those canonical patterns (corner trap,
go-around, forced order, L-push) rather than copies — the cage+bride win condition changes
the structure from classic Sokoban anyway.

Sources:
- [Sokoban — Wikipedia](https://en.wikipedia.org/wiki/Sokoban)
- [Sokoban deadlocks (jsokoapplet)](https://jsokoapplet.sourceforge.io/sokoban/deadlocks.html)
- [Microban I (David W. Skinner)](https://au-voleur.itch.io/microban-1)
- [Mastering Sokoban: deadlock avoidance & path planning](https://dinogame.gg/blog/mastering-sokoban/)
