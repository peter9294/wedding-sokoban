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
//  (src/engine.js). Wedding framing (bride cage, colors, names) is left to the
//  designers. Ranking is by solving structure, never moves/time.
//
//  Usage:
//    node tools/puzzle-forge.mjs [--count 200] [--boxes 3] [--w 6] [--h 6]
//                                [--keep 8] [--seed 1] [--out FILE]
//                                [--minpush 6] [--maxpush 22]
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

// =============================================================================
//  Grid model
// =============================================================================
class Grid {
  constructor(W, H) {
    this.W = W; this.H = H; this.N = W * H;
    this.wall = new Uint8Array(this.N);
    this.goal = new Uint8Array(this.N);
    this.dead = new Uint8Array(this.N);
    this.boxGoalDist = new Int32Array(this.N);
  }
  rc(i) { return [(i / this.W) | 0, i % this.W]; }
  idx(r, c) { return r * this.W + c; }
  inb(r, c) { return r >= 0 && r < this.H && c >= 0 && c < this.W; }
  step(i, dr, dc) { const r = (i / this.W) | 0, c = i % this.W, nr = r + dr, nc = c + dc; return this.inb(nr, nc) ? nr * this.W + nc : -1; }
  step2(i, dr, dc) { const a = this.step(i, dr, dc); return a < 0 ? -1 : this.step(a, dr, dc); }

  reach(start, boxSet) {
    const seen = new Uint8Array(this.N);
    if (start < 0 || this.wall[start] || boxSet.has(start)) return { seen, canon: start };
    const q = [start]; seen[start] = 1; let min = start;
    for (let h = 0; h < q.length; h++) {
      for (const [dr, dc] of DIRS) {
        const n = this.step(q[h], dr, dc);
        if (n < 0 || seen[n] || this.wall[n] || boxSet.has(n)) continue;
        seen[n] = 1; q.push(n); if (n < min) min = n;
      }
    }
    return { seen, canon: min };
  }

  // simple-deadlock squares + box->goal pull-distance table
  computeDead() {
    this.boxGoalDist.fill(INF);
    const q = [];
    for (let i = 0; i < this.N; i++) if (this.goal[i] && !this.wall[i]) { this.boxGoalDist[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const cur = q[h], d = this.boxGoalDist[cur];
      for (const [dr, dc] of DIRS) {
        const from = this.step(cur, -dr, -dc), push = this.step2(cur, -dr, -dc);
        if (from < 0 || push < 0 || this.wall[from] || this.wall[push]) continue;
        if (this.boxGoalDist[from] > d + 1) { this.boxGoalDist[from] = d + 1; q.push(from); }
      }
    }
    for (let i = 0; i < this.N; i++) this.dead[i] = (!this.wall[i] && this.boxGoalDist[i] >= INF) ? 1 : 0;
  }

  frozen(i, boxSet, asWall) {
    const blk = (n) => n < 0 || this.wall[n] || asWall.has(n) || (boxSet.has(n) && this._frozenRec(n, boxSet, asWall));
    const axis = (d) => {
      const a = this.step(i, d[0][0], d[0][1]), b = this.step(i, d[1][0], d[1][1]);
      if (blk(a) || blk(b)) return true;
      if (a >= 0 && b >= 0 && this.dead[a] && this.dead[b]) return true;
      return false;
    };
    return axis([[0, -1], [0, 1]]) && axis([[-1, 0], [1, 0]]);
  }
  _frozenRec(i, boxSet, asWall) { if (asWall.has(i)) return true; asWall.add(i); const f = this.frozen(i, boxSet, asWall); asWall.delete(i); return f; }
  freezeDead(movedBox, boxSet) { return this.frozen(movedBox, boxSet, new Set([movedBox])) && !this.goal[movedBox]; }
}

const keyOf = (boxes, player) => boxes.join(',') + '|' + player;
const isSolved = (grid, boxes) => boxes.every((b) => grid.goal[b]);

// forward (push) successors, with dead-square + freeze pruning — the "plausible"
// moves a player sees.
function forwardSucc(grid, boxes, player) {
  const boxSet = new Set(boxes);
  const { seen: region } = grid.reach(player, boxSet);
  const out = [];
  for (let k = 0; k < boxes.length; k++) {
    const bi = boxes[k];
    for (const [dr, dc] of DIRS) {
      const to = grid.step(bi, dr, dc), pusher = grid.step(bi, -dr, -dc);
      if (to < 0 || pusher < 0) continue;
      if (grid.wall[to] || boxSet.has(to) || grid.dead[to]) continue;
      if (grid.wall[pusher] || boxSet.has(pusher) || !region[pusher]) continue;
      const nb = boxes.slice(); nb[k] = to; nb.sort((a, b) => a - b);
      if (grid.freezeDead(to, new Set(nb))) continue;
      const { canon } = grid.reach(bi, new Set(nb));
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
  // canonical solved player = min reachable free cell with all boxes on goals
  const boxSet0 = new Set(goals);
  let solvedPlayer = -1;
  for (let i = 0; i < grid.N; i++) { if (!grid.wall[i] && !boxSet0.has(i)) { solvedPlayer = grid.reach(i, boxSet0).canon; break; } }
  if (solvedPlayer < 0) return null;
  const solvedKey = keyOf(goals, solvedPlayer);
  const dist = new Map([[solvedKey, 0]]);
  const node = new Map([[solvedKey, { boxes: goals, player: solvedPlayer }]]);
  const fwd = new Map();                         // key -> [{to, from(cell), dir}]  (optimal pushes)
  const q = [solvedKey];
  let truncated = false;

  for (let h = 0; h < q.length; h++) {
    if (node.size > cap) { truncated = true; break; }
    const sKey = q[h]; const { boxes, player } = node.get(sKey); const dS = dist.get(sKey);
    const boxSet = new Set(boxes);
    const { seen: region } = grid.reach(player, boxSet);
    // generate pull-predecessors P (one push further from solved)
    for (let k = 0; k < boxes.length; k++) {
      const bi = boxes[k];
      for (const [dr, dc] of DIRS) {
        const stand = grid.step(bi, dr, dc);       // Bx+g : player stands here to pull
        const back = grid.step2(bi, dr, dc);       // Bx+2g: player retreats here
        if (stand < 0 || back < 0) continue;
        if (grid.wall[stand] || boxSet.has(stand) || !region[stand]) continue;
        if (grid.wall[back] || boxSet.has(back)) continue;
        const nb = boxes.slice(); nb[k] = stand; nb.sort((a, b) => a - b);
        const { canon } = grid.reach(back, new Set(nb));
        const pKey = keyOf(nb, canon);
        const dP = dS + 1;
        if (!dist.has(pKey)) { dist.set(pKey, dP); node.set(pKey, { boxes: nb, player: canon }); q.push(pKey); }
        if (dist.get(pKey) === dP) { // optimal forward edge P -> S : box at `stand` pushed (dir -g) to `bi`
          if (!fwd.has(pKey)) fwd.set(pKey, []);
          fwd.get(pKey).push({ toKey: sKey, from: stand, to: bi, dir: dirName(-dr, -dc) });
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
    // pushes to move a box from b to g, ignoring other boxes: BFS in box space
    return boxPushDist(grid, b, g);
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
  const touched = new Set([...start.boxes, start.player]);
  let boxes = start.boxes.slice();
  for (const p of path) { touched.add(p.from); touched.add(p.to); const i = boxes.indexOf(p.from); if (i >= 0) boxes[i] = p.to; }
  let floor = 0; for (let i = 0; i < grid.N; i++) if (!grid.wall[i]) floor++;
  return touched.size / floor;
}

// =============================================================================
//  Naive-plan trap simulator  (replaces greedy straw-man + deadlock density)
//  Simulate the obvious human plan: each gift to its nearest free heart, in
//  every ordering. Record if/where it bricks, and whether the trap is hidden.
// =============================================================================
function naiveTrap(grid, startBoxes, goals) {
  const orderings = permutations([...startBoxes.keys()]);
  let failN = 0, depthSum = 0, hidden = 0, total = 0;
  for (const order of orderings) {
    total++;
    let boxes = startBoxes.slice();
    const freeGoals = new Set(goals);
    // boxes already on a goal: lock them
    boxes.forEach((b) => { if (freeGoals.has(b)) freeGoals.delete(b); });
    let planned = 0, done = 0, failedAt = -1, hiddenFail = false;
    for (const oi of order) {
      if (freeGoals.has(boxes[oi])) { freeGoals.delete(boxes[oi]); continue; }
      // nearest free goal for this box
      let tgt = -1, bd = INF;
      for (const g of freeGoals) { const d = boxPushDist(grid, boxes[oi], g); if (d < bd) { bd = d; tgt = g; } }
      if (tgt < 0 || bd >= INF) { failedAt = done; hiddenFail = false; break; }
      // push it there one cell at a time, treating other current boxes as walls
      const others = new Set(boxes.filter((_, j) => j !== oi));
      const route = boxRoute(grid, boxes[oi], tgt, others);
      planned += bd;
      if (!route) { failedAt = done; hiddenFail = others.size > 0 /*blocked by a gift = hidden*/; break; }
      // check freeze at the end
      done += route.length;
      boxes[oi] = tgt; freeGoals.delete(tgt);
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
  const boxSet = new Set(boxes), floor = [], map = [];
  for (let r = 0; r < grid.H; r++) {
    let fr = '', mr = '';
    for (let c = 0; c < grid.W; c++) {
      const i = grid.idx(r, c);
      fr += grid.goal[i] ? 'x' : '.';
      mr += grid.wall[i] ? '#' : i === player ? '@' : boxSet.has(i) ? '$' : '.';
    }
    floor.push(fr); map.push(mr);
  }
  return { name, lighting, wallStyle, floor, map };
}
function ascii(grid, boxes, player) {
  const boxSet = new Set(boxes); let s = '';
  for (let r = 0; r < grid.H; r++) { for (let c = 0; c < grid.W; c++) { const i = grid.idx(r, c); s += grid.wall[i] ? '#' : i === player ? (grid.goal[i] ? '+' : '@') : boxSet.has(i) ? (grid.goal[i] ? '*' : '$') : grid.goal[i] ? 'x' : ' '; } s += '\n'; } return s;
}
// relocate player to a reachable cell far from the first push (so start isn't a tell)
function relocatePlayer(grid, boxes, player, path) {
  if (!path.length) return player;
  const first = path[0].from; const { seen } = grid.reach(player, new Set(boxes));
  let best = player, bd = -1;
  for (let i = 0; i < grid.N; i++) if (seen[i]) { const [r1, c1] = grid.rc(i), [r2, c2] = grid.rc(first); const d = Math.abs(r1 - r2) + Math.abs(c1 - c2); if (d > bd) { bd = d; best = i; } }
  return best;
}
function verifyWithEngine(grid, boxes, player, path) {
  const moves = []; let curBoxes = boxes.slice(), curPlayer = player;
  for (const push of path) {
    const [fr, fc] = grid.rc(push.from), [tr, tc] = grid.rc(push.to);
    const ddr = tr - fr, ddc = tc - fc; const pusher = grid.idx(fr - ddr, fc - ddc);
    const boxSet = new Set(curBoxes), prev = new Map(), seen = new Set([curPlayer]), q = [curPlayer];
    let ok = curPlayer === pusher;
    for (let h = 0; h < q.length && !ok; h++) for (const [mdr, mdc] of DIRS) {
      const n = grid.step(q[h], mdr, mdc);
      if (n < 0 || seen.has(n) || grid.wall[n] || boxSet.has(n)) continue;
      seen.add(n); prev.set(n, [q[h], mdr, mdc]); q.push(n); if (n === pusher) { ok = true; break; }
    }
    if (!ok) return { ok: false };
    const walk = []; let nd = pusher; while (nd !== curPlayer) { const [p, mdr, mdc] = prev.get(nd); walk.push([mdr, mdc]); nd = p; } walk.reverse();
    for (const m of walk) moves.push(m);
    moves.push([ddr, ddc]);
    curBoxes = curBoxes.map((b) => (b === push.from ? push.to : b)); curPlayer = push.from;
  }
  const L = new Level(toLevel(grid, boxes, player, 'v', 'day', 'hedge'));
  let st = L.fresh();
  for (const [dr, dc] of moves) st = L.step(st, dr, dc, dirName(dr, dc)).state;
  return { ok: L.isWon(st), moveList: moves, moves: moves.length, pushes: path.length };
}

// ---- wedding wrap: add the bride-cage finish so the puzzle is drop-in ---------
const setChar = (s, i, ch) => s.slice(0, i) + ch + s.slice(i + 1);
function bfsToCell(L, st, target) {
  const seen = new Set([st.player.r + ',' + st.player.c]);
  const q = [{ p: st.player, path: [] }];
  for (let h = 0; h < q.length; h++) {
    const { p, path } = q[h];
    if (p.r === target.r && p.c === target.c) return path;
    for (const [dr, dc] of DIRS) {
      const nr = p.r + dr, nc = p.c + dc;
      if (L.solid(st, nr, nc)) continue;
      if (st.boxes.some((b) => b.r === nr && b.c === nc)) continue;
      const k = nr + ',' + nc; if (seen.has(k)) continue; seen.add(k);
      q.push({ p: { r: nr, c: nc }, path: [...path, [dr, dc]] });
    }
  }
  return null;
}
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
  const walk = bfsToCell(L, st, { r: H, c: C });
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
  const o = { count: 200, boxes: 3, w: 6, h: 6, keep: 8, seed: 1, out: path.join(__dirname, 'puzzle-forge.out.json'), minpush: 6, maxpush: 22 };
  for (let i = 2; i < argv.length; i++) { const a = argv[i], nx = () => argv[++i]; const m = { '--count': 'count', '--boxes': 'boxes', '--w': 'w', '--h': 'h', '--keep': 'keep', '--seed': 'seed', '--minpush': 'minpush', '--maxpush': 'maxpush' }; if (a === '--out') o.out = nx(); else if (m[a]) o[m[a]] = +nx(); }
  return o;
}

function main() {
  const opts = parseArgs(process.argv);
  const rng = makeRng(opts.seed);
  const LIGHTS = ['day', 'golden', 'evening'], WSTY = ['hedge', 'blossom', 'fence'];
  console.log(`Puzzle Forge — ${opts.count} room/heart layouts, ${opts.boxes} gifts, ${opts.w}x${opts.h}, seed ${opts.seed}`);
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
    // random heart placement
    const goals = shuffle(rng, free).slice(0, opts.boxes);
    for (let i = 0; i < grid.N; i++) grid.goal[i] = 0;
    for (const gi of goals) grid.goal[gi] = 1;
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
