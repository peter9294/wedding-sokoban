// =============================================================================
//  Puzzle Forge  —  generate GENUINELY interesting Sokoban puzzles
// =============================================================================
//
//  Why this exists
//  ---------------
//  LLMs (me included) design bland Sokoban: a puzzle's quality lives in the TREE
//  of all possible push-sequences, not in how the grid looks, and a text model
//  never walks that tree. So this tool doesn't "ask a model for a good level."
//  It brute-forces quality the way human designers (and the research loops) do:
//
//    1. ENUMERATE, for a given room + heart placement, the ENTIRE push-state
//       graph by reverse-BFS (pulls) from the solved board. Every state that can
//       pull back from "solved" is a guaranteed-solvable start; its BFS depth is
//       its optimal push count. The graph gives us, for free: optimal length,
//       an alive/dead label for every state, and the full optimal-move DAG.
//    2. SCORE every start on what actually makes a puzzle interesting to a human:
//         - RETURNS (forced box-changes): a gift you must push, abandon, and come
//           back to. The single most reliable sign of planning (Taylor & Parberry
//           2011). Measured as min box-changes over optimal solutions, minus the
//           free (boxes-1).
//         - DETOUR: optimal pushes minus the min-cost ASSIGNMENT lower bound
//           (Hungarian/permutation over the box->heart pull-distance matrix). A
//           gift must go the long way, or not to the heart you'd guess.
//         - NAIVE-PLAN TRAP: simulate the obvious human plan ("each gift to its
//           nearest free heart, in every order") and see if/where it bricks.
//           Replaces the straw-man greedy player AND the fiddly "deadlock density"
//           metric. Hidden traps (sealed corridor / region cut) count ~3x the
//           visible corner kind.
//         - Supporting: real decision points (want 1-3, not a grind), distinct
//           optimal solutions (1-2 = designed, lots = sandbox), cells actually
//           used (small-but-whole beats big-but-empty).
//    3. GATE, then RANK (no weighted-sum mush). A level must clear hard gates to
//       be a puzzle at all; survivors are ranked by returns + detour + trap.
//    4. DEDUPE under the 8 symmetries and by "trick signature", relocate the
//       player away from the first push (so the start isn't a tell), and curate
//       the kept set into a difficulty progression.
//
//  Output is the pure pushing puzzle in the project's level format (floor+map),
//  each annotated with its metrics + a solution VERIFIED against the real engine
//  (src/engine.js), with the bride-cage finish auto-added. Colour-matched gifts
//  and hearts are supported (--colors); lighting and names stay the designers'.
//  Ranking is by solving structure, never moves/time.
//
//  Usage:
//    node tools/puzzle-forge.mjs [--count 200] [--boxes 3] [--w 6] [--h 6]
//                                [--keep 8] [--seed 1] [--out FILE] [--colors 0]
//                                [--warps] [--minpush 6] [--maxpush 22]
//    node tools/puzzle-forge.mjs --grade FILE    # score existing levels (stones incl.)
// =============================================================================

import { Level } from '../src/engine.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INF = 1e9;

// ---- deterministic RNG ------------------------------------------------------
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[(rng() * arr.length) | 0];
const shuffle = (rng, arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; };
const DIRS = [[-1, 0, 'up'], [1, 0, 'down'], [0, -1, 'left'], [0, 1, 'right']];
const dirName = (dr, dc) => (dr === -1 ? 'up' : dr === 1 ? 'down' : dc === -1 ? 'left' : 'right');

// Boxes carry a colour. We pack (cell, colour) into one int so state keys stay
// cheap: box = pos*BM + colour (colour 0 = neutral gift '$'). POS/COL unpack it.
const BM = 100;
const POS = (b) => (b / BM) | 0;
const COL = (b) => b % BM;
const MK = (p, c) => p * BM + c;
const occ = (boxes) => { const s = new Set(); for (const b of boxes) s.add(POS(b)); return s; };

// =============================================================================
//  Grid model
// =============================================================================
class Grid {
  constructor(W, H) {
    this.W = W; this.H = H; this.N = W * H;
    this.warps = [];                       // 0 or 2 warp-pad cells (player teleports between them)
    this.wall = new Uint8Array(this.N);
    this.goal = new Uint8Array(this.N);
    this.gcol = new Int8Array(this.N);     // heart colour (0 = neutral 'x', 1..9 = digit)
    this.dead = new Uint8Array(this.N);
    this.colors = [0];
    this.distByColor = new Map();          // colour -> box-push-distance-to-nearest-matching-heart table
    this.boxGoalDist = new Int32Array(this.N);
  }
  rc(i) { return [(i / this.W) | 0, i % this.W]; }
  idx(r, c) { return r * this.W + c; }
  inb(r, c) { return r >= 0 && r < this.H && c >= 0 && c < this.W; }
  step(i, dr, dc) { const r = (i / this.W) | 0, c = i % this.W, nr = r + dr, nc = c + dc; return this.inb(nr, nc) ? nr * this.W + nc : -1; }
  step2(i, dr, dc) { const a = this.step(i, dr, dc); return a < 0 ? -1 : this.step(a, dr, dc); }

  // Player-reachable cells. Warp-aware: marking a warp pad also marks its pair
  // (stepping onto a pad teleports the player to the other), so the two pads and
  // their neighbourhoods form one connected region.
  reach(start, boxSet) {
    const seen = new Uint8Array(this.N); const q = []; let min = this.N;
    const push = (n) => {
      if (n < 0 || seen[n] || this.wall[n] || boxSet.has(n)) return;
      seen[n] = 1; q.push(n); if (n < min) min = n;
      if (this.warps.length === 2) { const wi = this.warps.indexOf(n); if (wi >= 0) push(this.warps[1 - wi]); }
    };
    if (start < 0 || this.wall[start] || boxSet.has(start)) return { seen, canon: start };
    push(start);
    for (let h = 0; h < q.length; h++) for (const [dr, dc] of DIRS) push(this.step(q[h], dr, dc));
    return { seen, canon: min === this.N ? start : min };
  }

  // For every gift colour present, a box-push-distance table to the nearest
  // heart that colour can legally fill. A cell dead for ITS colour can never be
  // solved from; a cell dead for EVERY colour is a universal dead square.
  computeDead() {
    const cset = new Set();
    for (let i = 0; i < this.N; i++) if (this.goal[i]) cset.add(this.gcol[i]);
    this.colors = cset.size ? [...cset] : [0];
    this.distByColor = new Map();
    for (const c of this.colors) {
      const d = new Int32Array(this.N).fill(INF); const q = [];
      for (let i = 0; i < this.N; i++) {
        if (!this.goal[i]) continue;
        if (this.gcol[i] === 0 || this.gcol[i] === c) { d[i] = 0; q.push(i); } // neutral heart fills for any colour
      }
      for (let h = 0; h < q.length; h++) {
        const cur = q[h], dc = d[cur];
        for (const [dr, dcc] of DIRS) {
          const from = this.step(cur, -dr, -dcc), push = this.step2(cur, -dr, -dcc);
          if (from < 0 || push < 0 || this.wall[from] || this.wall[push]) continue;
          if (d[from] > dc + 1) { d[from] = dc + 1; q.push(from); }
        }
      }
      this.distByColor.set(c, d);
    }
    for (let i = 0; i < this.N; i++) {
      let allDead = true;
      for (const c of this.colors) if (this.distByColor.get(c)[i] < INF) { allDead = false; break; }
      this.dead[i] = (!this.wall[i] && allDead) ? 1 : 0;
    }
    this.boxGoalDist = this.distByColor.get(0) || this.distByColor.get(this.colors[0]);
  }
}

const keyOf = (boxes, player) => boxes.join(',') + '|' + player;
// A gift of colour `col` is placed on `pos` iff it's a heart and colours match
// (a neutral heart, colour 0, accepts any gift — mirrors the engine).
const placed = (grid, pos, col) => !!grid.goal[pos] && (grid.gcol[pos] === 0 || col === grid.gcol[pos]);
const isSolved = (grid, boxes) => boxes.every((b) => placed(grid, POS(b), COL(b)));

// Freeze deadlock (geometry only): a box wedged immovable on both axes and not
// on a matching heart. Conservative — only flags genuinely stuck boxes.
function frozenGeom(grid, cell, cells, asWall) {
  const blk = (n) => n < 0 || grid.wall[n] || asWall.has(n) || (cells.has(n) && frozenRec(grid, n, cells, asWall));
  const axis = (d) => blk(grid.step(cell, d[0][0], d[0][1])) || blk(grid.step(cell, d[1][0], d[1][1]));
  return axis([[0, -1], [0, 1]]) && axis([[-1, 0], [1, 0]]);
}
function frozenRec(grid, cell, cells, asWall) { if (asWall.has(cell)) return true; asWall.add(cell); const f = frozenGeom(grid, cell, cells, asWall); asWall.delete(cell); return f; }
function freezeDead(grid, cell, col, nb) { return frozenGeom(grid, cell, occ(nb), new Set([cell])) && !placed(grid, cell, col); }

// forward (push) successors, with dead-square + freeze pruning — the "plausible"
// moves a player sees. Colour-aware: a gift can't fill a heart of another colour.
function forwardSucc(grid, boxes, player) {
  const boxSet = occ(boxes);
  const { seen: region } = grid.reach(player, boxSet);
  const out = [];
  for (let k = 0; k < boxes.length; k++) {
    const bp = POS(boxes[k]), bc = COL(boxes[k]);
    const dcol = grid.distByColor.get(bc);
    for (const [dr, dc] of DIRS) {
      const to = grid.step(bp, dr, dc), pusher = grid.step(bp, -dr, -dc);
      if (to < 0 || pusher < 0) continue;
      if (grid.wall[to] || boxSet.has(to) || (dcol && dcol[to] >= INF)) continue;
      if (grid.wall[pusher] || boxSet.has(pusher) || !region[pusher]) continue;
      const nb = boxes.slice(); nb[k] = MK(to, bc); nb.sort((a, b) => a - b);
      if (freezeDead(grid, to, bc, nb)) continue;
      const { canon } = grid.reach(bp, occ(nb));
      out.push({ boxes: nb, player: canon });
    }
  }
  return out;
}

// =============================================================================
//  Enumerate the full push-state graph by reverse-BFS (pulls) from solved.
//  Returns optimal-move DAG (fwd edges toward solved) + dist (= optimal pushes).
// =============================================================================
function enumerate(grid, cap = 120000) {
  const goals = [];
  for (let i = 0; i < grid.N; i++) if (grid.goal[i]) goals.push(i);
  goals.sort((a, b) => a - b);
  // solved = each gift sits on a heart it matches (gift colour = heart colour).
  const solvedBoxes = goals.map((g) => MK(g, grid.gcol[g]));
  const boxSet0 = new Set(goals);
  let solvedPlayer = -1;
  for (let i = 0; i < grid.N; i++) { if (!grid.wall[i] && !boxSet0.has(i)) { solvedPlayer = grid.reach(i, boxSet0).canon; break; } }
  if (solvedPlayer < 0) return null;
  const solvedKey = keyOf(solvedBoxes, solvedPlayer);
  const dist = new Map([[solvedKey, 0]]);
  const node = new Map([[solvedKey, { boxes: solvedBoxes, player: solvedPlayer }]]);
  const fwd = new Map();                         // key -> [{toKey, from(cell), to(cell), dir}]  (optimal pushes)
  const q = [solvedKey];
  let truncated = false;

  for (let h = 0; h < q.length; h++) {
    if (node.size > cap) { truncated = true; break; }
    const sKey = q[h]; const { boxes, player } = node.get(sKey); const dS = dist.get(sKey);
    const boxSet = occ(boxes);
    const { seen: region } = grid.reach(player, boxSet);
    // generate pull-predecessors P (one push further from solved); colour rides along
    for (let k = 0; k < boxes.length; k++) {
      const bp = POS(boxes[k]), bc = COL(boxes[k]);
      for (const [dr, dc] of DIRS) {
        const stand = grid.step(bp, dr, dc);       // Bx+g : player stands here to pull
        const back = grid.step2(bp, dr, dc);       // Bx+2g: player retreats here
        if (stand < 0 || back < 0) continue;
        if (grid.wall[stand] || boxSet.has(stand) || !region[stand]) continue;
        if (grid.wall[back] || boxSet.has(back)) continue;
        const nb = boxes.slice(); nb[k] = MK(stand, bc); nb.sort((a, b) => a - b);
        const { canon } = grid.reach(back, occ(nb));
        const pKey = keyOf(nb, canon);
        const dP = dS + 1;
        if (!dist.has(pKey)) { dist.set(pKey, dP); node.set(pKey, { boxes: nb, player: canon }); q.push(pKey); }
        if (dist.get(pKey) === dP) { // optimal forward edge P -> S : box at `stand` pushed (dir -g) to `bp`
          if (!fwd.has(pKey)) fwd.set(pKey, []);
          fwd.get(pKey).push({ toKey: sKey, from: stand, to: bp, dir: dirName(-dr, -dc) });
        }
      }
    }
  }
  return { grid, goals, dist, node, fwd, solvedKey, truncated };
}

// =============================================================================
//  Per-start analysis
// =============================================================================

// min-cost assignment (brute over permutations; boxes <= 4) of boxes->goals by
// pull-distance. Returns the lower-bound sum of pushes.
function assignmentLB(grid, boxes, goals) {
  const n = boxes.length;
  const cost = boxes.map((b) => goals.map((g) => {
    // pushes to move this gift to heart g, ignoring other boxes; INF if colours clash
    return placed(grid, g, COL(b)) ? boxPushDist(grid, POS(b), g) : INF;
  }));
  let best = INF;
  const perm = (used, i, acc) => {
    if (acc >= best) return;
    if (i === n) { best = Math.min(best, acc); return; }
    for (let j = 0; j < n; j++) if (!(used & (1 << j))) perm(used | (1 << j), i + 1, acc + cost[i][j]);
  };
  perm(0, 0, 0);
  return best;
}
const _bpdCache = new Map();
function boxPushDist(grid, from, to) {
  const ck = from + '>' + to + '@' + grid._sig;
  if (_bpdCache.has(ck)) return _bpdCache.get(ck);
  // BFS: box moves one cell if dest free(non-wall) and opposite cell free (pusher space)
  const d = new Int32Array(grid.N).fill(INF); d[from] = 0; const q = [from];
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    for (const [dr, dc] of DIRS) {
      const dest = grid.step(cur, dr, dc), push = grid.step(cur, -dr, -dc);
      if (dest < 0 || push < 0 || grid.wall[dest] || grid.wall[push]) continue;
      if (d[dest] > d[cur] + 1) { d[dest] = d[cur] + 1; q.push(dest); }
    }
  }
  const r = d[to]; _bpdCache.set(ck, r); return r;
}

// min "runs" (box-lines) over optimal solutions from startKey, via DP on the DAG.
// returns = minRuns - boxes.  Also returns a concrete least-interleaved path.
function returnsAndPath(graph, startKey) {
  const { fwd, node, solvedKey } = graph;
  const memo = new Map();             // key:  nodeKey + '#' + prevBoxDestCell(-1 for none)
  const choice = new Map();
  function h(k, prev) {
    if (k === solvedKey) return 0;
    const mk = k + '#' + prev;
    if (memo.has(mk)) return memo.get(mk);
    memo.set(mk, INF);                 // guard cycles (DAG, but be safe)
    let best = INF, bestEdge = null;
    for (const e of (fwd.get(k) || [])) {
      const inc = (e.from === prev) ? 0 : 1; // same box as previous push iff it starts where the last box landed
      const sub = h(e.toKey, e.to);
      if (sub + inc < best) { best = sub + inc; bestEdge = e; }
    }
    memo.set(mk, best); choice.set(mk, bestEdge); return best;
  }
  const minRuns = h(startKey, -1);
  // reconstruct least-interleaved path
  const path = []; let cur = startKey, prev = -1;
  while (cur !== solvedKey) {
    const e = choice.get(cur + '#' + prev); if (!e) break;
    path.push({ from: e.from, to: e.to, toKey: e.toKey, dir: e.dir });
    prev = e.to; cur = e.toKey;
  }
  const boxes = node.get(startKey).boxes.length;
  return { minRuns, returns: minRuns - boxes, path };
}

// count distinct optimal solutions (capped)
function distinctOptimal(graph, startKey, capN = 40) {
  const { fwd, solvedKey } = graph; const memo = new Map();
  function cnt(k) {
    if (k === solvedKey) return 1;
    if (memo.has(k)) return memo.get(k);
    memo.set(k, 0); let s = 0;
    for (const e of (fwd.get(k) || [])) { s += cnt(e.toKey); if (s >= capN) { s = capN; break; } }
    memo.set(k, s); return s;
  }
  return cnt(startKey);
}

// decision points along the solution: states with >=2 plausible pushes; alive-
// forcedness = share of plausible pushes that keep the goal reachable.
function decisionProfile(grid, graph, startKey) {
  const { path } = returnsAndPath(graph, startKey);
  let state = graph.node.get(startKey);
  let branch = 0, real = 0, aliveSum = 0, aliveN = 0;
  for (let step = 0; step < path.length; step++) {
    const succ = forwardSucc(grid, state.boxes, state.player);
    if (succ.length >= 2) {
      branch++;
      let alive = 0;
      for (const s of succ) if (graph.node.has(keyOf(s.boxes, s.player))) alive++;
      aliveSum += alive / succ.length; aliveN++;
      if (alive < succ.length) real++;   // >=1 plausible push actually loses -> a real choice you can get wrong
    }
    state = graph.node.get(path[step].toKey) || state;
  }
  return { branch, real, aliveForced: aliveN ? aliveSum / aliveN : 1 };
}

// cells actually touched by a box or the player over the solution / total floor
function cellsUsed(grid, graph, startKey) {
  const { path, } = returnsAndPath(graph, startKey);
  const start = graph.node.get(startKey);
  const touched = new Set([...start.boxes.map(POS), start.player]);
  let cells = start.boxes.map(POS);
  for (const p of path) { touched.add(p.from); touched.add(p.to); const i = cells.indexOf(p.from); if (i >= 0) cells[i] = p.to; }
  let floor = 0; for (let i = 0; i < grid.N; i++) if (!grid.wall[i]) floor++;
  return touched.size / floor;
}

// =============================================================================
//  Naive-plan trap simulator  (replaces greedy straw-man + deadlock density)
//  Simulate the obvious human plan: each gift to its nearest free heart, in
//  every ordering. Record if/where it bricks, and whether the trap is hidden.
// =============================================================================
function naiveTrap(grid, startBoxes, goals, stoneCells = []) {
  const orderings = permutations([...startBoxes.keys()]);
  let failN = 0, depthSum = 0, hidden = 0, total = 0;
  for (const order of orderings) {
    total++;
    let cells = startBoxes.map(POS); const cols = startBoxes.map(COL);
    const freeGoals = new Set(goals);
    // gifts already on a matching heart: lock them
    cells.forEach((p, j) => { if (freeGoals.has(p) && placed(grid, p, cols[j])) freeGoals.delete(p); });
    let planned = 0, done = 0, failedAt = -1, hiddenFail = false;
    for (const oi of order) {
      if (freeGoals.has(cells[oi]) && placed(grid, cells[oi], cols[oi])) { freeGoals.delete(cells[oi]); continue; }
      // nearest free COLOUR-COMPATIBLE heart for this gift
      let tgt = -1, bd = INF;
      for (const g of freeGoals) { if (!placed(grid, g, cols[oi])) continue; const d = boxPushDist(grid, cells[oi], g); if (d < bd) { bd = d; tgt = g; } }
      if (tgt < 0 || bd >= INF) { failedAt = done; hiddenFail = false; break; }
      // push it there one cell at a time, treating other gifts AND stones as walls
      const others = new Set([...cells.filter((_, j) => j !== oi), ...stoneCells]);
      const route = boxRoute(grid, cells[oi], tgt, others);
      planned += bd;
      if (!route) { failedAt = done; hiddenFail = others.size > 0 /*blocked by a gift = hidden*/; break; }
      done += route.length;
      cells[oi] = tgt; freeGoals.delete(tgt);
    }
    if (failedAt >= 0) {
      failN++;
      const frac = planned > 0 ? failedAt / Math.max(planned, done + 1) : 0.5;
      depthSum += frac; if (hiddenFail) hidden++;
    }
  }
  const failFrac = failN / total;
  const meanDepth = failN ? depthSum / failN : 0;
  const hiddenFrac = failN ? hidden / failN : 0;
  // trap score: fraction that fail * depth, hidden weighted 3x
  const trap = failFrac * meanDepth * (1 + 2 * hiddenFrac);
  return { failFrac: +failFrac.toFixed(2), meanDepth: +meanDepth.toFixed(2), hiddenFrac: +hiddenFrac.toFixed(2), trap: +trap.toFixed(2) };
}
// single-box push route from->to with `others` as extra walls; returns cell list or null
function boxRoute(grid, from, to, others) {
  const prev = new Map(); const seen = new Set([from]); const q = [from];
  const blocked = (n) => n < 0 || grid.wall[n] || others.has(n);
  let ok = from === to;
  for (let h = 0; h < q.length && !ok; h++) {
    for (const [dr, dc] of DIRS) {
      const dest = grid.step(q[h], dr, dc), push = grid.step(q[h], -dr, -dc);
      if (blocked(dest) || push < 0 || grid.wall[push] || others.has(push)) continue;
      if (seen.has(dest)) continue; seen.add(dest); prev.set(dest, q[h]); q.push(dest);
      if (dest === to) { ok = true; break; }
    }
  }
  if (!ok) return null;
  const route = []; let c = to; while (c !== from) { route.push(c); c = prev.get(c); } return route.reverse();
}
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i++) { const rest = arr.slice(0, i).concat(arr.slice(i + 1)); for (const p of permutations(rest)) out.push([arr[i], ...p]); }
  return out.length > 24 ? out.slice(0, 24) : out;
}

// =============================================================================
//  Gates + rank
// =============================================================================
function evaluate(grid, graph, startKey, opts) {
  const start = graph.node.get(startKey);
  const pushes = graph.dist.get(startKey);
  const { returns, path } = returnsAndPath(graph, startKey);
  const lb = assignmentLB(grid, start.boxes, graph.goals);
  const detour = pushes - lb;
  const trapM = naiveTrap(grid, start.boxes, graph.goals);
  const distinct = distinctOptimal(graph, startKey);
  const decM = decisionProfile(grid, graph, startKey);
  const used = cellsUsed(grid, graph, startKey);
  const movedBoxes = new Set(path.map((p) => p.from)).size; // approx distinct boxes moved
  let floor = 0; for (let i = 0; i < grid.N; i++) if (!grid.wall[i]) floor++;

  const reasons = [];
  if (pushes < opts.minpush) reasons.push('too-short');
  if (pushes > opts.maxpush) reasons.push('too-long');
  if (floor > 30) reasons.push('too-big');
  if (!(detour >= 2 || returns >= 1 || trapM.trap >= 0.15)) reasons.push('obvious');
  if (trapM.failFrac < 0.34) reasons.push('no-trap');       // the obvious plan usually works -> dull
  if (decM.branch < 1) reasons.push('linear');              // a corridor, no choices at all
  if (decM.real > 6) reasons.push('grind');                 // too many ways to go wrong -> fiddly, not clever
  if (movedBoxes < Math.min(2, start.boxes.length)) reasons.push('static-boxes');

  const score =
    Math.min(returns, 4) * 30 +
    Math.min(detour, 8) * 7.5 +
    trapM.trap * 20 +
    (decM.real >= 1 && decM.real <= 3 ? 10 : decM.real === 0 ? -6 : 0) +
    used * 10 +
    (distinct <= 2 ? 6 : distinct <= 5 ? 2 : 0);

  return {
    rejected: reasons.length > 0, reasons, score: +score.toFixed(1),
    metrics: {
      pushes, lowerBound: lb, detour, returns,
      trapFail: trapM.failFrac, trapDepth: trapM.meanDepth, trapHidden: trapM.hiddenFrac, trap: trapM.trap,
      realDecisions: decM.real, branches: decM.branch, aliveForced: +decM.aliveForced.toFixed(2),
      distinctOptimal: distinct, cellsUsed: +used.toFixed(2), boxes: start.boxes.length, floorCells: floor
    },
    path, start
  };
}

// =============================================================================
//  Symmetry canonicalization  (dedupe mirror/rotation twins)
// =============================================================================
function levelSig(floor, map) {
  const variants = [];
  let f = floor, m = map;
  for (let r = 0; r < 4; r++) { variants.push(f.join('/') + '::' + m.join('/')); variants.push(mirror(f).join('/') + '::' + mirror(m).join('/')); f = rot90(f); m = rot90(m); }
  return variants.sort()[0];
}
const rot90 = (rows) => { const H = rows.length, W = rows[0].length, out = []; for (let c = 0; c < W; c++) { let s = ''; for (let r = H - 1; r >= 0; r--) s += rows[r][c]; out.push(s); } return out; };
const mirror = (rows) => rows.map((r) => r.split('').reverse().join(''));

// =============================================================================
//  Emit / render / engine verification
// =============================================================================
function toLevel(grid, boxes, player, name, lighting, wallStyle) {
  const boxCol = new Map(); for (const b of boxes) boxCol.set(POS(b), COL(b));
  const floor = [], map = [];
  for (let r = 0; r < grid.H; r++) {
    let fr = '', mr = '';
    for (let c = 0; c < grid.W; c++) {
      const i = grid.idx(r, c);
      fr += grid.goal[i] ? (grid.gcol[i] === 0 ? 'x' : String(grid.gcol[i])) : (grid.warps.includes(i) ? 'o' : '.');
      if (grid.wall[i]) mr += '#';
      else if (i === player) mr += '@';
      else if (boxCol.has(i)) { const col = boxCol.get(i); mr += col === 0 ? '$' : String(col); }
      else mr += '.';
    }
    floor.push(fr); map.push(mr);
  }
  return { name, lighting, wallStyle, floor, map };
}
function ascii(grid, boxes, player) {
  const boxCol = new Map(); for (const b of boxes) boxCol.set(POS(b), COL(b)); let s = '';
  for (let r = 0; r < grid.H; r++) {
    for (let c = 0; c < grid.W; c++) {
      const i = grid.idx(r, c);
      if (grid.wall[i]) s += '#';
      else if (i === player) s += grid.goal[i] ? '+' : '@';
      else if (boxCol.has(i)) { const col = boxCol.get(i); s += col === 0 ? (grid.goal[i] ? '*' : '$') : String(col); }
      else if (grid.goal[i]) s += grid.gcol[i] === 0 ? 'x' : String(grid.gcol[i]);
      else if (grid.warps.includes(i)) s += 'o';
      else s += ' ';
    }
    s += '\n';
  }
  return s;
}
// relocate player to a reachable cell far from the first push (so start isn't a tell)
function relocatePlayer(grid, boxes, player, path) {
  if (!path.length) return player;
  const first = path[0].from; const { seen } = grid.reach(player, occ(boxes));
  let best = player, bd = -1;
  for (let i = 0; i < grid.N; i++) if (seen[i]) { const [r1, c1] = grid.rc(i), [r2, c2] = grid.rc(first); const d = Math.abs(r1 - r2) + Math.abs(c1 - c2); if (d > bd) { bd = d; best = i; } }
  return best;
}
// Walk the player to (pr,pc) using the REAL engine for every step — so warps
// (and, later, stones) resolve exactly as the game does. Never pushes a gift or
// stone (those cells are skipped). Returns the unit-move list, or null.
function walkPlayer(L, st, pr, pc) {
  if (st.player.r === pr && st.player.c === pc) return [];
  const key = (p) => p.r + ',' + p.c;
  const seen = new Set([key(st.player)]); const q = [{ st, path: [] }];
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    for (const [dr, dc] of DIRS) {
      const nr = cur.st.player.r + dr, nc = cur.st.player.c + dc;
      if (cur.st.boxes.some((b) => b.r === nr && b.c === nc)) continue;          // don't shove a gift
      if ((cur.st.stones || []).some((o) => o.r === nr && o.c === nc)) continue; // don't shove a stone
      const res = L.step(cur.st, dr, dc, dirName(dr, dc));
      if (!res.moved) continue;
      const k = key(res.state.player);
      if (seen.has(k)) continue; seen.add(k);
      const npath = [...cur.path, [dr, dc]];
      if (res.state.player.r === pr && res.state.player.c === pc) return npath;
      q.push({ st: res.state, path: npath });
    }
  }
  return null;
}
// Replay the push-path against the real engine, routing the player through it at
// every step, and confirm it wins. Engine-truth, so it can never falsely pass.
function verifyWithEngine(grid, boxes, player, path) {
  const L = new Level(toLevel(grid, boxes, player, 'v', 'day', 'hedge'));
  let st = L.fresh(); const moves = [];
  for (const push of path) {
    const [fr, fc] = grid.rc(push.from), [tr, tc] = grid.rc(push.to);
    const ddr = tr - fr, ddc = tc - fc; const pr = fr - ddr, pc = fc - ddc;
    const walk = walkPlayer(L, st, pr, pc);
    if (!walk) return { ok: false };
    for (const [dr, dc] of walk) { st = L.step(st, dr, dc, dirName(dr, dc)).state; moves.push([dr, dc]); }
    if (st.player.r !== pr || st.player.c !== pc) return { ok: false };
    const res = L.step(st, ddr, ddc, dirName(ddr, ddc));
    if (!res.moved) return { ok: false };
    st = res.state; moves.push([ddr, ddc]);
  }
  return { ok: L.isWon(st), moveList: moves, moves: moves.length, pushes: path.length };
}

// ---- wedding wrap: add the bride-cage finish so the puzzle is drop-in ---------
const setChar = (s, i, ch) => s.slice(0, i) + ch + s.slice(i + 1);
// Fill hearts (via pushMoves), then the cage opens and the groom walks onto the
// bride. Returns a drop-in level verified to win under the real engine, or null.
function wrapWedding(grid, boxes, player, pushMoves) {
  const W = grid.W, H = grid.H, Rroom = H - 2;
  let C = -1;
  for (let c = 1; c <= W - 2; c++) { const i = grid.idx(Rroom, c); if (!grid.wall[i] && !grid.goal[i]) { C = c; break; } }
  if (C < 0) return null;
  const base = toLevel(grid, boxes, player, 'w', 'day', 'hedge');
  const floor = base.floor.slice(), map = base.map.slice();
  map[H - 1] = setChar(map[H - 1], C, 'c');          // cage in the bottom border
  floor.push('.'.repeat(W));
  let bRow = ''; for (let c = 0; c < W; c++) bRow += c === C ? 'B' : '#';
  map.push(bRow);                                     // bride just beyond the cage
  const wrapped = { lighting: 'day', wallStyle: 'hedge', floor, map };
  const L = new Level(wrapped); let st = L.fresh();
  for (const [dr, dc] of pushMoves) st = L.step(st, dr, dc, dirName(dr, dc)).state;
  const walk = walkPlayer(L, st, H, C);
  if (!walk) return null;
  for (const [dr, dc] of walk) st = L.step(st, dr, dc, dirName(dr, dc)).state;
  if (!L.isWon(st)) return null;
  return { floor, map, extraMoves: walk.length };
}

// =============================================================================
//  Wall templates  (legibility > random noise)
// =============================================================================
function templates(iw, ih) {
  const empty = () => [];
  const cell = (r, c) => [r, c];
  const centerPillar = () => [cell((ih >> 1) + 1, (iw >> 1) + 1)];
  const twoPillars = () => [cell(2, 2), cell(ih - 1, iw - 1)];
  const lbend = () => { const o = []; for (let c = 2; c <= Math.ceil(iw / 2) + 1; c++) o.push(cell((ih >> 1) + 1, c)); for (let r = 2; r <= (ih >> 1); r++) o.push(cell(r, Math.ceil(iw / 2) + 1)); return o; };
  const shortWall = () => { const o = []; const r = (ih >> 1) + 1; for (let c = 2; c <= Math.max(2, iw - 2); c++) if (c !== (iw >> 1) + 1) o.push(cell(r, c)); return o; };
  const sidePillars = () => [cell(2, iw - 1), cell(ih - 1, 2)];
  return [empty, centerPillar, twoPillars, lbend, shortWall, sidePillars];
}
function makeGridFromTemplate(iw, ih, tmpl) {
  const W = iw + 2, H = ih + 2, g = new Grid(W, H);
  for (let i = 0; i < g.N; i++) g.wall[i] = 1;
  for (let r = 1; r <= ih; r++) for (let c = 1; c <= iw; c++) g.wall[g.idx(r, c)] = 0;
  for (const [r, c] of tmpl()) if (r >= 1 && r <= ih && c >= 1 && c <= iw) g.wall[g.idx(r, c)] = 1;
  // connectivity check
  const free = []; for (let i = 0; i < g.N; i++) if (!g.wall[i]) free.push(i);
  const { seen } = g.reach(free[0], new Set());
  if (free.some((i) => !seen[i])) return null;
  return g;
}

// =============================================================================
//  Driver
// =============================================================================
function parseArgs(argv) {
  const o = { count: 200, boxes: 3, w: 6, h: 6, keep: 8, seed: 1, out: path.join(__dirname, 'puzzle-forge.out.json'), minpush: 6, maxpush: 22, colors: 0, warps: false, grade: null };
  for (let i = 2; i < argv.length; i++) { const a = argv[i], nx = () => argv[++i]; const m = { '--count': 'count', '--boxes': 'boxes', '--w': 'w', '--h': 'h', '--keep': 'keep', '--seed': 'seed', '--minpush': 'minpush', '--maxpush': 'maxpush', '--colors': 'colors' }; if (a === '--out') o.out = nx(); else if (a === '--grade') o.grade = nx(); else if (a === '--warps') o.warps = true; else if (m[a]) o[m[a]] = +nx(); }
  return o;
}

// =============================================================================
//  Grade mode  —  score an EXISTING level (incl. stones) on the same metrics.
//  Stones slide, so they can't be reverse-generated; instead we FORWARD-search
//  the given board to the solved set and read the metrics off that graph.
// =============================================================================
function parseLevel(level) {
  const floor = Array.isArray(level.floor) ? level.floor : [];
  const map = Array.isArray(level.map) ? level.map : [];
  const H = Math.max(floor.length, map.length, 1);
  let W = 1; for (const r of floor) W = Math.max(W, r.length); for (const r of map) W = Math.max(W, r.length);
  const g = new Grid(W, H);
  const boxes = [], stones = []; let player = 0, hasCage = false;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = g.idx(r, c);
    const fc = (floor[r] || '')[c] || '.';
    const mc = (map[r] || '')[c] || '.';
    if (fc === 'x') { g.goal[i] = 1; g.gcol[i] = 0; }
    else if (fc >= '1' && fc <= '9') { g.goal[i] = 1; g.gcol[i] = +fc; }
    else if (fc === 'o') g.warps.push(i);
    else if (fc === '~') g.wall[i] = 1;                        // pond = solid
    if (mc === 'c') hasCage = true;
    if (mc === '#' || mc === 'Q' || mc === 'f' || mc === 'h' || mc === 'l' || mc === 'c' || mc === 'B') g.wall[i] = 1; // cage/bride walled for the pushing phase
    else if (mc === '@') player = i;
    else if (mc === '$' || mc === 'k') boxes.push(MK(i, 0));
    else if (mc >= '1' && mc <= '9') boxes.push(MK(i, +mc));
    else if (mc === 'O') stones.push(i);
    else if (mc === '*') { boxes.push(MK(i, 0)); g.goal[i] = 1; g.gcol[i] = 0; }
  }
  if (g.warps.length !== 2) g.warps = [];
  boxes.sort((a, b) => a - b); stones.sort((a, b) => a - b);
  return { grid: g, boxes, stones, player, hasCage };
}

// Win model: without a cage, win = all gifts on matching hearts. With a cage, win
// = every heart FILLED (neutral heart by a box OR a stone; colour heart by a
// matching box) so the cage opens — then the groom reaches the bride.
function makeGoal(grid, hasCage) {
  const hearts = []; for (let i = 0; i < grid.N; i++) if (grid.goal[i]) hearts.push(i);
  if (!hasCage) return (boxes) => isSolved(grid, boxes);
  return (boxes, stones) => {
    const bc = new Map(); for (const b of boxes) bc.set(POS(b), COL(b));
    const ss = new Set(stones);
    for (const k of hearts) {
      const hc = grid.gcol[k];
      if (hc === 0) { if (!(bc.has(k) || ss.has(k))) return false; }
      else if (bc.get(k) !== hc) return false;
    }
    return true;
  };
}

// forward push-state graph from a given start (gift pushes + stone slides).
function forwardGraph(grid, start, goalFn, cap = 200000) {
  const key = (b, s, p) => b.join(',') + '|' + s.join(',') + '|' + p;
  const occAll = (b, s) => { const set = occ(b); for (const x of s) set.add(x); return set; };
  const p0 = grid.reach(start.player, occAll(start.boxes, start.stones)).canon;
  const startKey = key(start.boxes, start.stones, p0);
  const g = new Map([[startKey, 0]]), node = new Map([[startKey, { boxes: start.boxes, stones: start.stones, player: p0 }]]);
  const fwd = new Map(); const q = [startKey]; let L = -1; const solvedKeys = []; let truncated = false;
  for (let h = 0; h < q.length; h++) {
    if (node.size > cap) { truncated = true; break; }
    const k = q[h]; const { boxes, stones, player } = node.get(k); const gc = g.get(k);
    if (goalFn(boxes, stones)) { solvedKeys.push(k); if (L < 0) L = gc; continue; }
    if (L >= 0 && gc >= L) continue;
    const blockers = occAll(boxes, stones);
    const { seen: region } = grid.reach(player, blockers);
    const edges = []; fwd.set(k, edges);
    for (let bi = 0; bi < boxes.length; bi++) {
      const bp = POS(boxes[bi]), bc = COL(boxes[bi]); const dcol = grid.distByColor.get(bc);
      for (const [dr, dc] of DIRS) {
        const to = grid.step(bp, dr, dc), pusher = grid.step(bp, -dr, -dc);
        if (to < 0 || pusher < 0) continue;
        if (grid.wall[to] || blockers.has(to) || (dcol && dcol[to] >= INF)) continue;
        if (grid.wall[pusher] || blockers.has(pusher) || !region[pusher]) continue;
        const nb = boxes.slice(); nb[bi] = MK(to, bc); nb.sort((a, b) => a - b);
        if (freezeDead(grid, to, bc, nb)) continue;
        const np = grid.reach(bp, occAll(nb, stones)).canon;
        const nk = key(nb, stones, np);
        edges.push({ to: nk, obj: 'g', from: bp, dest: to, dr, dc });
        if (!g.has(nk)) { g.set(nk, gc + 1); node.set(nk, { boxes: nb, stones, player: np }); q.push(nk); }
      }
    }
    for (let si = 0; si < stones.length; si++) {
      const sp = stones[si];
      for (const [dr, dc] of DIRS) {
        const pusher = grid.step(sp, -dr, -dc);
        if (pusher < 0 || grid.wall[pusher] || blockers.has(pusher) || !region[pusher]) continue;
        let cur = sp; while (true) { const nx = grid.step(cur, dr, dc); if (nx < 0 || grid.wall[nx] || blockers.has(nx)) break; cur = nx; } // slide to blocker
        if (cur === sp) continue;
        const ns = stones.slice(); ns[si] = cur; ns.sort((a, b) => a - b);
        const np = grid.reach(sp, occAll(boxes, ns)).canon;
        const nk = key(boxes, ns, np);
        edges.push({ to: nk, obj: 's', from: sp, dest: cur, dr, dc });
        if (!g.has(nk)) { g.set(nk, gc + 1); node.set(nk, { boxes, stones: ns, player: np }); q.push(nk); }
      }
    }
  }
  return { g, node, fwd, solvedKeys, L, truncated, startKey };
}

// min gift-runs (returns) + distinct optimal solutions, over the optimal DAG.
function analyzeGraph(graph) {
  const { g, fwd, solvedKeys, L, startKey } = graph;
  const rev = new Map();
  for (const [u, edges] of fwd) for (const e of edges) { if (!rev.has(e.to)) rev.set(e.to, []); rev.get(e.to).push(u); }
  const dist = new Map(); const q = [];
  for (const k of solvedKeys) { dist.set(k, 0); q.push(k); }
  for (let h = 0; h < q.length; h++) { const cur = q[h], d = dist.get(cur); for (const u of (rev.get(cur) || [])) if (!dist.has(u)) { dist.set(u, d + 1); q.push(u); } }
  const optEdge = (u, e) => { const dv = dist.get(e.to); return dv !== undefined && g.get(u) + 1 + dv === L; };
  const memo = new Map(), choice = new Map();
  function rec(k, last) {
    if (dist.get(k) === 0) return 0;
    const mk = k + '#' + last; if (memo.has(mk)) return memo.get(mk);
    memo.set(mk, INF); let best = INF, bestE = null;
    for (const e of (fwd.get(k) || [])) {
      if (!optEdge(k, e)) continue;
      const inc = e.obj === 'g' ? (e.from === last ? 0 : 1) : 0;      // stone pushes pass through a gift run
      const nl = e.obj === 'g' ? e.dest : last;
      const sub = rec(e.to, nl); if (sub + inc < best) { best = sub + inc; bestE = e; }
    }
    memo.set(mk, best); choice.set(mk, bestE); return best;
  }
  const minRuns = rec(startKey, -1);
  const path = []; let cur = startKey, last = -1;
  while (dist.get(cur) !== 0) { const e = choice.get(cur + '#' + last); if (!e) break; path.push(e); if (e.obj === 'g') last = e.dest; cur = e.to; }
  const cmemo = new Map();
  function cnt(k) { if (dist.get(k) === 0) return 1; if (cmemo.has(k)) return cmemo.get(k); cmemo.set(k, 0); let s = 0; for (const e of (fwd.get(k) || [])) { if (!optEdge(k, e)) continue; s += cnt(e.to); if (s >= 50) { s = 50; break; } } cmemo.set(k, s); return s; }
  return { minRuns, path, distinct: cnt(startKey) };
}

// Replay a solution through the real engine and confirm it actually wins (fills
// the hearts, and for a cage level walks the groom to the bride afterwards).
function gradeVerify(level, grid, path) {
  const L = new Level(level); let st = L.fresh();
  for (const e of path) {
    const [fr, fc] = grid.rc(e.from); const pr = fr - e.dr, pc = fc - e.dc;
    const walk = walkPlayer(L, st, pr, pc);
    if (!walk) return false;
    for (const [dr, dc] of walk) st = L.step(st, dr, dc, dirName(dr, dc)).state;
    if (st.player.r !== pr || st.player.c !== pc) return false;
    const res = L.step(st, e.dr, e.dc, dirName(e.dr, e.dc));
    if (!res.moved) return false;
    st = res.state;
  }
  if (L.BRIDES && L.BRIDES.length) {                 // cage open now — walk to the bride
    const b = L.BRIDES[0]; const walk = walkPlayer(L, st, b.r, b.c);
    if (walk) for (const [dr, dc] of walk) st = L.step(st, dr, dc, dirName(dr, dc)).state;
  }
  return L.isWon(st);
}

function gradeLevel(level) {
  const { grid, boxes, stones, player, hasCage } = parseLevel(level);
  grid._sig = 'grade:' + grid.wall.join('') + ':' + grid.warps.join(','); _bpdCache.clear();
  grid.computeDead();
  const goals = []; for (let i = 0; i < grid.N; i++) if (grid.goal[i]) goals.push(i);
  const r = { name: level.name || 'Untitled', gifts: boxes.length, stones: stones.length, warps: grid.warps.length === 2 ? 'yes' : 'no', colors: grid.colors.filter((c) => c > 0).length };
  if (goals.length === 0) { r.solvable = false; r.note = 'no hearts'; return r; }
  if (!hasCage && boxes.length === 0) { r.solvable = false; r.note = 'no gifts, no cage'; return r; }
  const graph = forwardGraph(grid, { boxes, stones, player }, makeGoal(grid, hasCage));
  if (!graph.solvedKeys.length) { r.solvable = false; r.note = graph.truncated ? 'too big (search capped)' : 'no solution'; return r; }
  r.solvable = true; r.pushes = graph.L;
  const a = analyzeGraph(graph);
  r.giftPushes = a.path.filter((e) => e.obj === 'g').length;
  r.stonePushes = a.path.filter((e) => e.obj === 's').length;
  r.returns = boxes.length ? a.minRuns - boxes.length : 0;
  r.detour = (boxes.length === goals.length) ? r.giftPushes - assignmentLB(grid, boxes, goals) : null; // gift-centric; n/a when stones fill hearts
  const tr = naiveTrap(grid, boxes, goals, stones);
  r.trap = tr.trap; r.trapFail = tr.failFrac; r.trapHidden = tr.hiddenFrac;
  r.distinctOptimal = a.distinct;
  r.verified = gradeVerify(level, grid, a.path);
  return r;
}

function gradeMode(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const levels = Array.isArray(raw) ? raw : [raw];
  console.log(`Grading ${levels.length} level(s) from ${file}\n`);
  for (const lv of levels) {
    const r = gradeLevel(lv);
    if (!r.solvable) { console.log(`✗ ${r.name} — UNSOLVABLE (${r.note || ''})`); continue; }
    const tags = [r.colors > 0 ? r.colors + ' colours' : '', r.stones ? r.stones + ' stones' : '', r.warps === 'yes' ? 'warp' : ''].filter(Boolean).join(', ') || 'neutral';
    console.log(`${r.verified ? '✓' : '?'} ${r.name}  [${tags}]`);
    console.log(`    pushes ${r.pushes} (gift ${r.giftPushes}, stone ${r.stonePushes})  returns ${r.returns}  detour ${r.detour == null ? 'n/a' : r.detour}  trap ${r.trap} (fail ${r.trapFail}, hidden ${r.trapHidden})  distinctOpt ${r.distinctOptimal}${r.verified ? '' : '  [UNVERIFIED]'}`);
  }
  console.log('\nreturns = gifts handled in multiple phases · detour = gift pushes beyond the straight assignment · trap = does the obvious plan brick · distinctOpt low = tight/designed');
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.grade) { gradeMode(opts.grade); return; }
  const rng = makeRng(opts.seed);
  const LIGHTS = ['day', 'golden', 'evening'], WSTY = ['hedge', 'blossom', 'fence'];
  console.log(`Puzzle Forge — ${opts.count} room/heart layouts, ${opts.boxes} gifts, ${opts.w}x${opts.h}, ${opts.colors > 0 ? opts.colors + ' colours' : 'neutral'}${opts.warps ? ', warps' : ''}, seed ${opts.seed}`);
  const t0 = Date.now();
  const tmpls = templates(opts.w, opts.h);
  const kept = []; const seenSig = new Set();
  let enums = 0, scored = 0, rejected = 0, verifyFail = 0; const tally = {};

  for (let n = 0; n < opts.count; n++) {
    const tmpl = pick(rng, tmpls);
    const grid = makeGridFromTemplate(opts.w, opts.h, tmpl);
    if (!grid) continue;
    grid._sig = n + ':' + grid.wall.join(''); _bpdCache.clear();
    const free = []; for (let i = 0; i < grid.N; i++) if (!grid.wall[i]) free.push(i);
    if (free.length < opts.boxes + 2 || free.length > 34) continue;
    // random heart placement (+ colours round-robin so each colour's gift/heart counts match)
    const goals = shuffle(rng, free).slice(0, opts.boxes);
    for (let i = 0; i < grid.N; i++) { grid.goal[i] = 0; grid.gcol[i] = 0; }
    for (const gi of goals) grid.goal[gi] = 1;
    if (opts.colors > 0) { shuffle(rng, goals).forEach((g, idx) => grid.gcol[g] = (idx % opts.colors) + 1); }
    grid.warps = [];
    if (opts.warps) {
      const wc = shuffle(rng, free.filter((i) => !grid.goal[i]));
      if (wc.length < 2) continue;
      grid.warps = [wc[0], wc[1]].sort((a, b) => a - b);
    }
    grid.computeDead();
    if (goals.some((gi) => grid.dead[gi])) continue;

    const graph = enumerate(grid);
    if (!graph || graph.truncated) continue;
    enums++;

    // candidate starts: in push-range, prelim interesting (quick returns check via dist only is cheap)
    const cands = [];
    for (const [k, d] of graph.dist) {
      if (d < opts.minpush || d > opts.maxpush) continue;
      const st = graph.node.get(k);
      if (isSolved(grid, st.boxes)) continue;
      cands.push({ k, d });
    }
    if (!cands.length) continue;
    // score a sample of the deepest/most promising (cap work)
    cands.sort((a, b) => b.d - a.d);
    const sample = cands.slice(0, 40);
    for (const c of sample) {
      const ev = evaluate(grid, graph, c.k, opts);
      scored++;
      if (ev.rejected) { rejected++; for (const r of ev.reasons) tally[r] = (tally[r] || 0) + 1; continue; }
      const player2 = relocatePlayer(grid, ev.start.boxes, ev.start.player, ev.path);
      const verify = verifyWithEngine(grid, ev.start.boxes, player2, ev.path);
      if (!verify.ok) { verifyFail++; continue; }
      const lvl = toLevel(grid, ev.start.boxes, player2, 'x', 'day', 'hedge');
      const sig = levelSig(lvl.floor, lvl.map);
      if (seenSig.has(sig)) continue; seenSig.add(sig);
      kept.push({ grid, boxes: ev.start.boxes, player: player2, ev, verify, sig });
    }
  }

  // dedupe by trick signature, then rank, then curate a progression
  const byTrick = new Map();
  for (const e of kept) {
    const m = e.ev.metrics;
    const trick = `${m.boxes}|${m.returns}|${Math.min(m.detour, 6)}|${m.trapHidden >= 0.5 ? 'H' : 'V'}`;
    if (!byTrick.has(trick) || byTrick.get(trick).ev.score < e.ev.score) byTrick.set(trick, e);
  }
  const unique = [...byTrick.values()].sort((a, b) => b.ev.score - a.ev.score);
  const top = unique.slice(0, opts.keep).sort((a, b) => a.ev.metrics.pushes - b.ev.metrics.pushes); // easy->hard

  console.log(`\nenumerations ${enums} | scored ${scored} | rejected ${rejected} | verify-fail ${verifyFail} | unique survivors ${unique.length}`);
  console.log('reject reasons:', Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none');
  console.log(`kept ${top.length} (curated easy->hard) in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  top.forEach((e, i) => {
    const m = e.ev.metrics;
    console.log(`#${i + 1} score ${e.ev.score}  pushes ${m.pushes}(lb ${m.lowerBound})  returns ${m.returns}  detour ${m.detour}  trap ${m.trap}(fail ${m.trapFail},hid ${m.trapHidden})  decisions ${m.realDecisions}  distinctOpt ${m.distinctOptimal}  used ${m.cellsUsed}`);
    console.log(ascii(e.grid, e.boxes, e.player));
  });

  let wrapN = 0;
  const out = top.map((e, i) => {
    const lvl = toLevel(e.grid, e.boxes, e.player, `Forged #${i + 1}`, pick(rng, LIGHTS), pick(rng, WSTY));
    const w = wrapWedding(e.grid, e.boxes, e.player, e.verify.moveList);
    if (w) { lvl.floor = w.floor; lvl.map = w.map; wrapN++; }
    lvl._meta = {
      note: w ? 'Drop-in: fill the hearts, the cage opens, the groom steps onto the bride. Re-theme/colors freely.'
             : 'Pure pushing puzzle — add the bride-cage finish to make it drop-in.',
      ...e.ev.metrics, score: e.ev.score, engineVerified: true, weddingWrapped: !!w, solutionPushes: e.verify.pushes
    };
    return lvl;
  });
  fs.writeFileSync(opts.out, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${out.length} puzzles (${wrapN} wedding-wrapped & engine-verified) -> ${opts.out}`);
  console.log('returns = a gift you must come back to · detour = goes the long/unexpected way · trap = the obvious plan bricks (hidden traps count 3x) · decisions want 1-3 · distinctOpt low = designed');
}

main();
