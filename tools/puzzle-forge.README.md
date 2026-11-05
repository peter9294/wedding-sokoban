# Puzzle Forge

A generator for **genuinely interesting** Sokoban stages — ones with a real
"oh, I see it" moment — for *Something Pushed*. It does **not** ask an LLM to
write levels (that produces bland, straight-push puzzles). It brute-forces
quality the way human designers actually do: generate a huge pile of candidates,
then throw ~98% of them away by measuring the properties that make a puzzle hard
to *solve*, not hard to *look at*.

```bash
node tools/puzzle-forge.mjs --count 300 --boxes 3 --w 5 --h 5 --keep 8 --seed 7
```

Output: `tools/puzzle-forge.out.json` — a batch of stages in the normal level
format (`floor`/`map`), each already **wrapped** with the bride-cage finish and
**verified against the real engine** (`src/engine.js`) to actually win. Re-theme
freely (lighting, wallStyle, colors, names); the `_meta` block is advisory and
can be deleted on promotion.

## Why it works (the one idea)

A Sokoban puzzle's quality lives in the **tree of all possible push-sequences**,
not in how the grid looks. So for every candidate the tool enumerates that whole
tree (tiny levels → under 10⁵ states), finds the optimal solution, and scores
what the solution *demands* of the player.

Generation is **reverse-BFS**: start from a solved board (gifts on hearts) and
pull gifts backwards. Every pull is the reverse of a push, so every candidate is
guaranteed solvable — no dead ends, no wasted search.

## What the scores mean

Hover the `_meta` of any emitted level. Highest-leverage first:

| metric | meaning | good |
|---|---|---|
| **returns** | gifts you must push, abandon, and **come back to** later (forced box-changes, minus the free ones). The single best sign of real planning. | ≥ 1 |
| **detour** | optimal pushes minus the min-cost **assignment** lower bound. The gift goes the long way, or not to the heart you'd guess. | ≥ 2 |
| **trap** | does the **obvious human plan** ("each gift to its nearest heart") brick, and how deep? Hidden traps (a push that silently seals a corridor) count 3×. | ≥ 0.3 |
| **realDecisions** | points where ≥2 plausible pushes exist and at least one **loses**. One real fork, not ten. | 1–3 |
| **distinctOptimal** | how many optimal solutions exist. Few = designed; many = sandbox. | ≤ 5 |
| **cellsUsed** | fraction of floor the solution actually touches. Small-but-whole beats big-but-empty. | ≥ 0.4 |
| **pushes** | optimal push count (difficulty is about *solving*, never moves/time). | 6–20 |

The tool **gates first, then ranks** (no weighted-sum mush). A candidate is
rejected outright unless it is solvable, small (≤30 floor cells), 2–4 gifts, 6–22
pushes, and clears at least one real idea (`detour≥2` or `returns≥1` or a real
trap) **and** the obvious plan fails often enough. Survivors are ranked by
returns + detour + trap, de-duplicated under the 8 symmetries **and** by "trick
signature" (so ten levels with the same gimmick don't all rank), and the kept set
is curated easy → hard.

## Example of what it finds

```
#######
#@    #
# #  x#
#  $  #
#  *# #
#  *  #
#######     returns 3 · detour 6 · trap: the obvious plan always bricks
```

Two gifts already sit on hearts. The "obvious" move — push the free gift right
toward the top heart — **seals off** the only corner the player needs to finish,
so all three gifts must be shuffled off their hearts and back in the right order.
That trap is invisible at the moment you commit to it. An LLM writing this by
hand would never feel it; the solver does.

## Options

```
--count N    room/heart layouts to try      (default 200)
--boxes N    gifts per puzzle, 2–4           (default 3)
--colors N   colour-matched gifts/hearts     (default 0 = neutral; 2 = blue+lavender)
--warps      add two warp pads (player teleports between them)   (off)
--w N --h N  interior room size              (default 6 x 6; use 5x5 / 5x6 so
                                              floor cells stay ≤ 30)
--keep N     how many top puzzles to emit    (default 8)
--seed N     reproducible RNG                (default 1)
--minpush N  reject solutions shorter        (default 6)
--maxpush N  reject solutions longer         (default 22)
--out FILE   batch JSON path
```

Sweet spot for this audience (wedding guests, phones, ~2 min, unlimited undo):
**2–3 gifts, 5×5 or 5×6, ≤ 30 cells, one idea per level.** 4 gifts mostly get
rejected as "grind" — many small fiddly choices, which plays as a chore, not a
puzzle. That's intentional.

## Colour matching (`--colors`)

With `--colors 2`, gifts and hearts come in two colours (blue = `1`, lavender =
`2` in the emitted `floor`/`map`); a blue gift can only satisfy a blue heart. The
gifts split evenly across colours and the solved board matches like to like. This
*sharpens* the grading rather than complicating it: a gift can no longer slide to
the nearest heart, so detour and returns climb — a 4-gift / 2-colour batch
routinely hits returns 5–6 and detour 8–10 where neutral tops out around 3 and 6.
Still engine-verified end to end. Colours compose with warps.

## Warp pads (`--warps`)

Adds two warp pads (`o` on `floor`); stepping onto one teleports the player to
the other. Teleport only changes *player* reachability (gifts never teleport), so
the solver's reachability and the verifier are both warp-aware — in fact the
verifier now routes the player through the **real engine** at every step, so a
teleport (or, later, a stone-slide) can never make it falsely pass. Warp levels
that survive the gates are ones where the pad genuinely matters (it's the only
way to get behind a gift in time); where it doesn't, the level plays like a
no-warp room and gets filtered out.

One honest caveat: for a tiny fraction of warp candidates (~0.2%) the solver's
teleport model and the engine disagree on an edge case (the player can't rest on
a pad when its partner is blocked). The engine-truth verifier catches every one
and **drops** it, so nothing broken is ever emitted — you just lose a few
candidates. Warps also enlarge the search, so a 4-gift `--colors 2 --warps` batch
is slow (~1 min); drop to 3 gifts or a 5×5 room if you want it snappy.

## Grading existing levels (`--grade FILE`)

Point it at any level file — the live `levels.json`, the designers'
`contrib/levels.sample.json`, a single stage — and it scores each one on the same
scale by FORWARD-solving the board:

```bash
node tools/puzzle-forge.mjs --grade contrib/levels.sample.json
```

It handles every mechanic, **stones included**: it models the real win (fill the
hearts — a neutral heart can be filled by a gift *or* a stone — so the cage opens,
then the groom reaches the bride), solves to optimality, and reports pushes,
returns, detour, trap, distinct optimal solutions, and a `✓` when the solution is
confirmed by replaying it through the real engine. It's cross-checked against the
generator — it reproduces the generated levels' numbers exactly. Use it to put an
objective number on a hand-made stage ("is this actually hard, or does it just
look busy?") before shipping.

## Rolling stones — graded, not generated

Stones slide until they hit something, which makes them wonderful hand-authored
pieces (Stone Bridge, Cold Feet) but a poor fit for *reverse* generation:
"un-sliding" a stone is ambiguous and the solved board doesn't pin it anywhere.
So the tool **grades** stone stages (via `--grade`) rather than generating them.
One honest caveat: returns / detour / trap are gift-centric, so a stone-heavy
stage grades as solvable with a modest difficulty read even when the stone
routing is the clever part — lean on `pushes` and `distinctOpt` there, and on your
own eye. A full stone *generator* would need forward-search generation; grading
was the higher-value half.

## Honest limits

This reliably clears **"basic."** It produces stages with surprise, forced
returns, and real traps. It will **not** match a David Skinner hand-built
classic — the very best levels still need human taste, and the tool is a
candidate **generator + grader**, not a designer. Use it two ways:

1. **Mine it** — run a big batch, skim the top, steal the ones that spark an idea.
2. **Grade your own** — the metrics are the real payoff. Drop a hand-made level's
   `floor`/`map` through the same analysis to get a second opinion on whether it's
   actually hard or just looks it.
