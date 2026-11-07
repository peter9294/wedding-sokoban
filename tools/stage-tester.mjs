#!/usr/bin/env node
// stage-tester.mjs — Something Pushed (wedding Sokoban) stage validator + solver + exploit detector.
//
// Ports the EXACT runtime rules from the game script (solid / cageOpen / isWon / move)
// so results match what a player actually experiences. Runs a full-state BFS
// (player + boxes + stones are all tracked, because the win condition in cage+bride
// levels depends on the PLAYER's position, so the player cannot be normalized away).
//
// For each level it reports:
//   - structural validation (groom count, box==heart count, warp count, bride enclosure, ...)
//   - solvability + a shortest-move solution (the "intended" solve that covers every heart)
//   - exploit detection: is ANY win reachable WITHOUT covering every heart with boxes/stones?
//     (that would mean the groom can reach the bride without really solving the puzzle)
//
// Usage:
//   node stage-tester.mjs levels.json              # test every level in the array
//   node stage-tester.mjs levels.json --cap 3000000
//   node stage-tester.mjs --selftest              # run engine unit tests

const SOLID_TOPS = '#fhlQ';       // always-solid map chars (wall, fence, chair, lantern, chapel brick)
// NOTE: the bride 'B' is NOT solid: the groom WINS by stepping ONTO her tile (groom on bride),
// so her tile must be walkable by the groom. Boxes/stones still can't enter a bride tile
// (blocked explicitly in stepState / deadSquares).
const PUSHABLE = { '$': 'gift', 'k': 'cake' };

// ---------- parsing ----------
function parseLevel(L) {
  const floor = (L.floor || []).map(r => r);
  const map = (L.map || []).map(r => r);
  const H = map.length;
  const W = Math.max(0, ...map.map(r => r.length), ...floor.map(r => r.length));
  // pad rows to W so indexing is uniform; pad floor to meadow '.', map to empty '.'
  const F = [], M = [];
  for (let r = 0; r < H; r++) {
    F.push(((floor[r] || '') + '.'.repeat(W)).slice(0, W));
    M.push(((map[r] || '') + '.'.repeat(W)).slice(0, W));
  }
  const idx = (r, c) => r * W + c;
  const isDigit = (ch) => ch >= '1' && ch <= '9';   // color id 1..9
  let player = -1;
  const boxes = [], stones = [], TG = new Set(), heartColor = {}, WARPS = [], CAGES = [], BRIDES = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const f = F[r][c], m = M[r][c];
      if (f === 'x') { TG.add(idx(r, c)); heartColor[idx(r, c)] = 0; }           // neutral heart (any gift)
      else if (isDigit(f)) { TG.add(idx(r, c)); heartColor[idx(r, c)] = +f; }    // colored heart (matching gift only)
      if (f === 'o') WARPS.push(idx(r, c));
      if (m === '@') player = idx(r, c);
      else if (m === '$') boxes.push({ pos: idx(r, c), kind: 'gift', color: 0 });
      else if (m === 'k') boxes.push({ pos: idx(r, c), kind: 'cake', color: 0 });
      else if (isDigit(m)) boxes.push({ pos: idx(r, c), kind: 'gift', color: +m }); // colored gift
      else if (m === 'O') stones.push(idx(r, c));
      else if (m === 'c') CAGES.push(idx(r, c));
      else if (m === 'B') BRIDES.push(idx(r, c));
    }
  }
  return { name: L.name || '(unnamed)', W, H, F, M, idx,
           rc: (p) => [Math.floor(p / W), p % W],
           player, boxes, stones, TG, heartColor, WARPS, CAGES, BRIDES };
}

// ---------- rules (faithful ports) ----------
function solid(mdl, r, c, open) {
  if (r < 0 || c < 0 || r >= mdl.H || c >= mdl.W) return true; // out of bounds
  if (mdl.F[r][c] === '~') return true;                        // pond
  const ch = mdl.M[r][c];
  if (SOLID_TOPS.includes(ch)) return true;
  if (ch === 'c' && !open) return true;                        // closed cage
  return false;
}

// st = { p:int, boxes:Map<int,int> (pos->color), stones:Set<int> }
function cageOpen(mdl, st) {
  if (!mdl.CAGES.length) return false;
  const occ = (pos) => st.boxes.has(pos) || st.stones.has(pos) || st.p === pos;
  let allHearts = mdl.TG.size > 0;
  for (const h of mdl.TG) {
    const hc = mdl.heartColor[h] || 0;
    // neutral heart: any occupant fills it; colored heart: only a matching-color gift fills it
    const filled = hc === 0 ? occ(h) : (st.boxes.has(h) && st.boxes.get(h) === hc);
    if (!filled) { allHearts = false; break; }
  }
  if (allHearts) return true;
  for (const g of mdl.CAGES) if (occ(g)) return true;
  return false;
}

function isWon(mdl, st) {
  if (!mdl.CAGES.length) {
    if (mdl.boxes.length === 0) return false;
    for (const [pos, col] of st.boxes) {            // every box on a heart it matches
      const hc = mdl.heartColor[pos];
      if (hc === undefined) return false;           // box not on any heart
      if (hc !== 0 && hc !== col) return false;     // colored heart needs matching gift
    }
    return true;
  }
  if (mdl.BRIDES.length) {
    return mdl.BRIDES.some(b => b === st.p);   // win when the groom stands ON the bride's tile
  }
  return cageOpen(mdl, st) && mdl.CAGES.some(g => g === st.p);
}

// The "real" solve, independent of where the groom stands: every heart filled by the right cargo.
// Neutral heart = a box or stone; colored heart = a MATCHING-color gift only (not stone/wrong gift).
// A reachable win where this is false is an exploit (groom reached the bride without really solving).
function heartsCoveredByCargo(mdl, st) {
  if (mdl.TG.size === 0) return false;
  for (const h of mdl.TG) {
    const hc = mdl.heartColor[h] || 0;
    if (hc === 0) { if (!(st.boxes.has(h) || st.stones.has(h))) return false; }
    else { if (!(st.boxes.has(h) && st.boxes.get(h) === hc)) return false; }
  }
  return true;
}

const DIRS = [[-1, 0, 'U'], [1, 0, 'D'], [0, -1, 'L'], [0, 1, 'R']];

// returns successor st or null if the move changes nothing (blocked / immovable)
function stepState(mdl, st, dr, dc) {
  const open = cageOpen(mdl, st);          // cage openness is frozen at pre-move, as in the game
  const [pr, pc] = mdl.rc(st.p);
  const nr = pr + dr, nc = pc + dc;
  if (solid(mdl, nr, nc, open)) return null;
  const nPos = nr * mdl.W + nc;
  let boxes = st.boxes, stones = st.stones;
  if (st.boxes.has(nPos)) {
    const br = nr + dr, bc = nc + dc, bPos = br * mdl.W + bc;
    if (solid(mdl, br, bc, open) || mdl.BRIDES.includes(bPos) || st.boxes.has(bPos) || st.stones.has(bPos)) return null;
    boxes = new Map(st.boxes); const col = boxes.get(nPos); boxes.delete(nPos); boxes.set(bPos, col);
  } else if (st.stones.has(nPos)) {
    let r = nr, c = nc;
    while (true) {
      const rr = r + dr, cc = c + dc, pos = rr * mdl.W + cc;
      if (solid(mdl, rr, cc, open) || mdl.BRIDES.includes(pos) || st.boxes.has(pos) || st.stones.has(pos)) break;
      r = rr; c = cc;
    }
    if (r === nr && c === nc) return null;
    stones = new Set(st.stones); stones.delete(nPos); stones.add(r * mdl.W + c);
  }
  let p = nPos;
  if (mdl.WARPS.length === 2) {
    const wi = mdl.WARPS.indexOf(nPos);
    if (wi >= 0) {
      const t = mdl.WARPS[1 - wi];
      if (!boxes.has(t) && !stones.has(t)) p = t;
    }
  }
  return { p, boxes, stones };
}

function keyOf(st) {
  // include gift color: two same-position different-color assignments are DIFFERENT states
  const b = [...st.boxes.entries()].sort((a, z) => a[0] - z[0]).map(([p, c]) => c ? p + '.' + c : '' + p).join(',');
  const s = [...st.stones].sort((a, z) => a - z).join(',');
  return st.p + '|' + b + '|' + s;
}

// Simple-deadlock (dead-square) set: free squares from which a box can NEVER be pushed to any
// heart. Computed by reverse "pull" BFS from every heart, treating cages as passable (liberal,
// so it never marks a reachable square dead) and ignoring other boxes. Pushing a box onto one of
// these can never reach an all-hearts-covered win, so such successors are safe to prune — but ONLY
// when every box must land on a heart (boxes==hearts, no stones) and no cheese is possible.
function deadSquares(mdl) {
  const isSolid = (r, c) => r < 0 || c < 0 || r >= mdl.H || c >= mdl.W || mdl.F[r][c] === '~' || SOLID_TOPS.includes(mdl.M[r][c]) || mdl.M[r][c] === 'B'; // boxes can't traverse a bride tile
  const live = new Set(), q = [];
  for (const h of mdl.TG) { live.add(h); q.push(h); }
  const D = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  while (q.length) {
    const p = q.pop(), r = Math.floor(p / mdl.W), c = p % mdl.W;
    for (const [dr, dc] of D) {
      const br = r - dr, bc = c - dc, pr = r - 2 * dr, pc = c - 2 * dc;  // box-before + pusher squares
      if (isSolid(br, bc) || isSolid(pr, pc)) continue;
      const bp = br * mdl.W + bc;
      if (!live.has(bp)) { live.add(bp); q.push(bp); }
    }
  }
  const dead = new Set();
  for (let r = 0; r < mdl.H; r++) for (let c = 0; c < mdl.W; c++)
    if (!isSolid(r, c) && !live.has(r * mdl.W + c)) dead.add(r * mdl.W + c);
  return dead;
}

// ---------- BFS: solvability + shortest legit solution + exploit detection ----------
function solve(mdl, cap = 4_000_000) {
  // Pruning is only sound when every box is required on a heart AND no cheese win is possible
  // (a box could otherwise be a legit "spare", and a cheese path could route a box through a dead
  // square). Then it preserves both solvability and exploit-detection correctness.
  const noCheese = mdl.BRIDES.every(b => { const [br, bc] = mdl.rc(b); return [...mdl.TG].every(h => { const [hr, hc] = mdl.rc(h); return Math.abs(hr - br) + Math.abs(hc - bc) > 2; }); });
  const prunable = mdl.stones.length === 0 && mdl.boxes.length === mdl.TG.size && noCheese;
  const dead = prunable ? deadSquares(mdl) : null;
  const start = { p: mdl.player, boxes: new Map(mdl.boxes.map(b => [b.pos, b.color || 0])), stones: new Set(mdl.stones) };
  const startKey = keyOf(start);
  const came = new Map();                 // key -> {prev, mv}
  came.set(startKey, { prev: null, mv: null });
  const depth = new Map([[startKey, 0]]);
  let queue = [start], qKeys = [startKey];
  let head = 0, nodes = 0, capped = false;

  let bestLegitKey = null, bestLegitDepth = Infinity;
  let exploitKey = null, exploitDepth = Infinity, exploitCovered = 0;
  let anyWin = false;

  // check the start itself for a win (degenerate / badly-enclosed bride)
  const consider = (st, k, d) => {
    if (!isWon(mdl, st)) return;
    anyWin = true;
    if (heartsCoveredByCargo(mdl, st)) {
      if (d < bestLegitDepth) { bestLegitDepth = d; bestLegitKey = k; }
    } else if (d < exploitDepth) {
      exploitDepth = d; exploitKey = k;
      exploitCovered = [...mdl.TG].filter(h => { const hc = mdl.heartColor[h] || 0; return hc === 0 ? (st.boxes.has(h) || st.stones.has(h)) : (st.boxes.has(h) && st.boxes.get(h) === hc); }).length;
    }
  };
  consider(start, startKey, 0);

  while (head < queue.length) {
    const st = queue[head], k = qKeys[head]; head++;
    if (isWon(mdl, st)) continue;         // never expand a won state (game stops on win)
    const d = depth.get(k);
    for (const [dr, dc, mv] of DIRS) {
      const ns = stepState(mdl, st, dr, dc);
      if (!ns) continue;
      if (dead) { let bad = false; for (const b of ns.boxes.keys()) if (dead.has(b)) { bad = true; break; } if (bad) continue; }
      const nk = keyOf(ns);
      if (came.has(nk)) continue;
      came.set(nk, { prev: k, mv });
      depth.set(nk, d + 1);
      consider(ns, nk, d + 1);
      queue.push(ns); qKeys.push(nk);
      nodes++;
      if (nodes >= cap) { capped = true; break; }
    }
    if (capped) break;
  }

  const reconstruct = (k) => {
    const out = [];
    let cur = k;
    while (cur && came.get(cur) && came.get(cur).mv) { out.push(came.get(cur).mv); cur = came.get(cur).prev; }
    return out.reverse().join('');
  };

  return {
    nodes, capped,
    solvable: bestLegitKey !== null,
    anyWin,
    solutionMoves: bestLegitKey ? reconstruct(bestLegitKey) : null,
    solutionLen: bestLegitKey ? bestLegitDepth : null,
    exploit: exploitKey !== null ? { moves: reconstruct(exploitKey), len: exploitDepth, covered: exploitCovered } : null,
  };
}

// count pushes in a solution (replays it)
function countPushes(mdl, moveStr) {
  let st = { p: mdl.player, boxes: new Map(mdl.boxes.map(b => [b.pos, b.color || 0])), stones: new Set(mdl.stones) };
  let pushes = 0;
  for (const ch of moveStr) {
    const d = DIRS.find(x => x[2] === ch);
    const beforeBoxes = [...st.boxes.keys()].sort((a, z) => a - z).join(','), beforeStones = [...st.stones].sort((a, z) => a - z).join(',');
    const ns = stepState(mdl, st, d[0], d[1]);
    if (!ns) continue;
    if ([...ns.boxes.keys()].sort((a, z) => a - z).join(',') !== beforeBoxes || [...ns.stones].sort((a, z) => a - z).join(',') !== beforeStones) pushes++;
    st = ns;
  }
  return pushes;
}

// ---------- structural validation ----------
function validate(mdl) {
  const issues = [];
  const err = (m) => issues.push({ lvl: 'error', m });
  const warn = (m) => issues.push({ lvl: 'warn', m });

  // dimensions
  if (mdl.H < 4 || mdl.W < 4) warn(`tiny board ${mdl.W}x${mdl.H} (format allows 4..24 x 4..30)`);
  if (mdl.W > 24 || mdl.H > 30) warn(`board ${mdl.W}x${mdl.H} exceeds format max 24x30`);

  // groom
  const grooms = mdl.M.flatMap(row => [...row]).filter(ch => ch === '@').length;
  if (grooms !== 1) err(`need exactly one groom '@', found ${grooms}`);

  // boxes vs hearts
  const nBoxes = mdl.boxes.length, nHearts = mdl.TG.size;
  if (nHearts === 0) err('no petal hearts (x) to deliver gifts onto');
  if (mdl.CAGES.length) {
    if (nBoxes !== nHearts) warn(`cage level: ${nBoxes} gifts vs ${nHearts} hearts — not equal (cage opens only when ALL hearts are covered, so clean design uses boxes == hearts)`);
  } else {
    if (nBoxes !== nHearts) err(`standard level: ${nBoxes} gifts vs ${nHearts} hearts — must be equal`);
  }

  // per-color balance: a color-N heart can ONLY be filled by a color-N gift, so there must be
  // at least as many color-N gifts as color-N hearts, or the level can't be solved.
  const colorHearts = {}, colorGifts = {};
  for (const h of mdl.TG) { const c = mdl.heartColor[h] || 0; if (c) colorHearts[c] = (colorHearts[c] || 0) + 1; }
  for (const b of mdl.boxes) { const c = b.color || 0; if (c) colorGifts[c] = (colorGifts[c] || 0) + 1; }
  for (const c of Object.keys(colorHearts)) {
    if ((colorGifts[c] || 0) < colorHearts[c]) err(`color ${c}: only ${colorGifts[c] || 0} matching gift(s) for ${colorHearts[c]} color-${c} heart(s) — cannot be filled`);
  }

  // warps
  if (mdl.WARPS.length !== 0 && mdl.WARPS.length !== 2) err(`warp pads (o) must be 0 or 2, found ${mdl.WARPS.length}`);

  // bride enclosure (the key gotcha) — ONLY relevant in cage levels, where the win is
  // "groom adjacent to bride" and is NOT gated on the cage being open. In a standard level
  // (no cages) the bride is decorative and adjacency never decides the win, so skip it.
  if (mdl.CAGES.length) {
    for (const b of mdl.BRIDES) {
      const [br, bc] = mdl.rc(b);
      let cageDoors = 0;
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const r = br + dr, c = bc + dc;
        if (r < 0 || c < 0 || r >= mdl.H || c >= mdl.W) continue;          // OOB = solid, fine
        const f = mdl.F[r][c], m = mdl.M[r][c];
        if (f === '~') continue;                                            // pond = solid, fine
        if (SOLID_TOPS.includes(m)) continue;                              // wall/decor, fine
        if (m === 'c') {
          cageDoors++;
          if (f === 'x') err(`bride at (${br},${bc}): adjacent cage at (${r},${c}) sits on a heart — groom could cover it himself and cheese the win`);
          continue;
        }
        err(`bride at (${br},${bc}) is NOT enclosed: neighbour (${r},${c}) is passable ('${m === '.' ? f : m}') — groom can reach the bride without opening the cage`);
      }
      if (cageDoors === 0) err(`bride at (${br},${bc}) has no cage door — it is sealed off and can never be reached`);
      // cheese guard (design guidance; the BFS below is the hard authority): a heart within
      // Manhattan distance 2 of the bride lets the groom stand on it to open the cage and step
      // straight to her. Keep hearts >=3 tiles away. (Full-state BFS still flags it as an exploit.)
      for (const h of mdl.TG) {
        const [hr, hc] = mdl.rc(h);
        if (Math.abs(hr - br) + Math.abs(hc - bc) <= 2)
          warn(`heart at (${hr},${hc}) is within 2 tiles of the bride at (${br},${bc}) — possible cheese; keep hearts >=3 away`);
      }
    }
    if (mdl.BRIDES.length === 0) warn('cages present but no bride: win = groom steps onto an open cage tile');
  } else if (mdl.BRIDES.length) {
    warn('bride present but no cages: STANDARD level (win = all gifts on hearts); the bride is decorative');
  }

  return issues;
}

// ---------- report ----------
function analyze(L, cap) {
  const mdl = parseLevel(L);
  const issues = validate(mdl);
  const hasErr = issues.some(i => i.lvl === 'error');
  const mode = mdl.CAGES.length ? (mdl.BRIDES.length ? 'cage+bride' : 'cage') : 'standard';
  let res = null;
  if (!hasErr) res = solve(mdl, cap);
  let pushes = null;
  if (res && res.solutionMoves) pushes = countPushes(mdl, res.solutionMoves);

  const pass = !hasErr && res && res.solvable && !res.exploit;
  return { mdl, mode, issues, res, pushes, pass };
}

function printReport(L, cap) {
  const a = analyze(L, cap);
  const { mdl, mode, issues, res } = a;
  const line = (s) => process.stdout.write(s + '\n');
  line(`\n── ${mdl.name} ──`);
  line(`   ${mdl.W}x${mdl.H} · mode:${mode} · gifts:${mdl.boxes.length} hearts:${mdl.TG.size} cages:${mdl.CAGES.length} warps:${mdl.WARPS.length} brides:${mdl.BRIDES.length} stones:${mdl.stones.length}`);
  for (const i of issues) line(`   ${i.lvl === 'error' ? '✗ ERROR' : '⚠ warn '}: ${i.m}`);
  if (issues.length === 0) line('   structure: OK');
  if (res) {
    if (res.solvable) {
      line(`   solver: SOLVABLE in ${res.solutionLen} moves (${a.pushes} pushes) · nodes:${res.nodes}${res.capped ? ' (CAP HIT)' : ''}`);
      line(`   solution: ${res.solutionMoves}`);
    } else {
      line(`   solver: ✗ UNSOLVABLE (no legit win reachable)${res.capped ? ' — node cap hit, inconclusive' : ''} · nodes:${res.nodes}`);
    }
    if (res.exploit) {
      line(`   exploit: ✗ FOUND — win reachable in ${res.exploit.len} moves with only ${res.exploit.covered}/${mdl.TG.size} hearts covered by gifts`);
      line(`            e.g. ${res.exploit.moves || '(0 moves — bride already reachable!)'}`);
    } else if (!res.capped) {
      line('   exploit: CLEAN — every win requires all hearts covered by gifts');
    } else {
      line('   exploit: (inconclusive — node cap hit)');
    }
  }
  line(`   VERDICT: ${a.pass ? '✓ PASS' : '✗ FAIL'}`);
  return a;
}

// ---------- self-test of the engine ----------
function selftest() {
  let ok = 0, fail = 0;
  const check = (name, cond) => { if (cond) { ok++; } else { fail++; console.log('  ✗ FAIL: ' + name); } };

  // 1) push mechanics on a trivial board
  //    #####
  //    #@$.#   groom(1,1), gift(1,2); wall at (1,4)
  //    #...#
  //    #####
  const U = parseLevel({ name: 'prim',
    floor: ['.....', '.....', '.....', '.....'],
    map:   ['#####', '#@$.#', '#...#', '#####'] });
  const st0 = { p: U.player, boxes: new Map(U.boxes.map(b => [b.pos, b.color || 0])), stones: new Set() };
  const pushed = stepState(U, st0, 0, 1);                  // push gift right
  check('push moves groom onto gift tile', pushed && pushed.p === U.idx(1, 2));
  check('push moves gift one tile', pushed && pushed.boxes.has(U.idx(1, 3)) && !pushed.boxes.has(U.idx(1, 2)));
  check('push into wall is blocked (no pull)', stepState(U, pushed, 0, 1) === null);
  check('walk into wall is blocked', stepState(U, st0, -1, 0) === null);

  // 2) warp: two pads; stepping onto one teleports to the twin
  //    ######
  //    #@...#   groom(1,1); floor warps at (1,2) and (1,4)
  //    ######
  const Wv = parseLevel({ name: 'warp',
    floor: ['......', '..o.o.', '......'],
    map:   ['######', '#@...#', '######'] });
  const w0 = { p: Wv.player, boxes: new Map(), stones: new Set() };
  const warped = stepState(Wv, w0, 0, 1);                  // step right onto (1,2) warp -> twin (1,4)
  check('warp teleports to twin', warped && warped.p === Wv.idx(1, 4));

  // 3) a correct cage+bride level: must be SOLVABLE and EXPLOIT-FREE
  //    cols 0..5
  //    ######
  //    #@...#
  //    #x$..#   heart(2,1), gift(2,2)
  //    #..c.#   cage door(3,3)
  //    #.#B##   bride(4,3) walled except the cage above it
  //    ######
  const good = { name: 'good-cagebride',
    floor: ['......', '......', '.x....', '......', '......', '......'],
    map:   ['######', '#@...#', '#.$..#', '#..c.#', '#.#B##', '######'] };
  const ga = analyze(good, 2_000_000);
  check('good level: structure has no errors', !ga.issues.some(i => i.lvl === 'error'));
  check('good level: solvable', ga.res && ga.res.solvable);
  check('good level: no exploit', ga.res && !ga.res.exploit);
  check('good level: PASS verdict', ga.pass === true);

  // 4) a badly-enclosed bride: a passable neighbour means the groom reaches her without
  //    opening the cage -> must be caught (structural error AND exploit) -> FAIL verdict
  //    ######
  //    #@...#
  //    #.$..#
  //    #.xcB#   cage(3,3), bride(3,4); neighbour (2,4) is open floor -> not enclosed
  //    ######
  const bad = { name: 'bad-open-bride',
    floor: ['......', '......', '......', '..x...', '......'],
    map:   ['######', '#@...#', '#.$..#', '#..cB#', '######'] };
  const ba = analyze(bad, 2_000_000);
  check('bad level: structural error flags un-enclosed bride',
        ba.issues.some(i => i.lvl === 'error' && /not enclosed/i.test(i.m)));
  check('bad level: FAIL verdict', ba.pass === false);

  // 5) color-matched gift<->heart. Same shape as the good level, but the heart is color 1.
  const base = { floor: ['......', '......', '.H....', '......', '......', '......'],
                 map:   ['######', '#@...#', '#.G..#', '#..c.#', '#.#B##', '######'] };
  const sub = (s, from, to) => s.map(r => r.split(from).join(to));
  // 5a) matching color-1 gift on a color-1 heart -> solvable, exploit-free
  const cMatch = analyze({ name: 'c-match', floor: sub(base.floor, 'H', '1'), map: sub(base.map, 'G', '1') }, 2_000_000);
  check('color: matching gift solves', cMatch.pass === true);
  // 5b) wrong-color gift (2) for a color-1 heart -> cannot be filled -> FAIL
  const cWrong = analyze({ name: 'c-wrong', floor: sub(base.floor, 'H', '1'), map: sub(base.map, 'G', '2') }, 2_000_000);
  check('color: wrong-color gift fails', cWrong.pass === false);
  // 5c) neutral gift ($) does NOT satisfy a colored heart -> FAIL
  const cNeutralGift = analyze({ name: 'c-neutral-gift', floor: sub(base.floor, 'H', '1'), map: sub(base.map, 'G', '\$') }, 2_000_000);
  check('color: neutral gift cannot fill a colored heart', cNeutralGift.pass === false);
  // 5d) a colored gift DOES satisfy a neutral heart (x) -> PASS
  const cColoredOnNeutral = analyze({ name: 'c-on-neutral', floor: sub(base.floor, 'H', 'x'), map: sub(base.map, 'G', '1') }, 2_000_000);
  check('color: colored gift satisfies a neutral heart', cColoredOnNeutral.pass === true);

  console.log(`\nselftest: ${ok} passed, ${fail} failed`);
  return fail === 0;
}

// ---------- main (only when run directly in Node; skipped when imported or in a browser) ----------
let isMain = false;
if (typeof process !== 'undefined' && process.argv && process.argv[1]) {
  const { pathToFileURL } = await import('node:url');          // Node-only; never reached in a browser
  isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
}
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) {
    process.exit(selftest() ? 0 : 1);
  } else {
    const file = args.find(a => !a.startsWith('--'));
    let cap = 4_000_000;
    const ci = args.indexOf('--cap'); if (ci >= 0) cap = parseInt(args[ci + 1], 10);
    if (!file) { console.error('usage: node stage-tester.mjs levels.json [--cap N] | --selftest'); process.exit(2); }
    const fs = await import('node:fs');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const levels = Array.isArray(data) ? data : [data];
    let allPass = true;
    const results = [];
    for (const L of levels) { const a = printReport(L, cap); results.push(a); if (!a.pass) allPass = false; }
    console.log(`\n${'='.repeat(40)}\nSUMMARY: ${results.filter(r => r.pass).length}/${results.length} stages PASS`);
    process.exit(allPass ? 0 : 1);
  }
}

export { parseLevel, solid, cageOpen, isWon, stepState, solve, validate, analyze, heartsCoveredByCargo };
