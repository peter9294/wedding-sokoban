// Pure game engine — one Level instance per stage.
// Rules ported verbatim from the prototype (step / isWon / cageOpen / solid).
//
// Level format (the contract):
//   { name, lighting:'day'|'golden'|'evening', wallStyle:'hedge'|'blossom'|'fence',
//     floor:[ "....", ... ], map:[ "####", ... ] }
//
// Floor chars: . Meadow  = Aisle  _ Stone  ~ Pond(solid)  x Petal heart(goal)  o Warp pad
// Map chars:   # Wall  Q Chapel brick  f Picket fence  h Guest chair  l Lantern
//              B Bride  @ Groom start  $ Gift(push)  k Cake(push)  O Rolling stone  c Heart cage

const FLOORS = '.=_~xo';
const TOPS = '.#QfhlB@$kOc';
const SOLIDTOP = '#fhlBQ'; // solid map objects (matches prototype's solid() test)

function sanitizeFloor(ch) { return FLOORS.includes(ch) ? ch : '.'; }
function sanitizeTop(ch) {
  if (ch === '*') return '$'; // gift-on-heart shorthand -> gift (floor heart handled separately)
  return TOPS.includes(ch) ? ch : '.';
}

// Pad/truncate every row to width w and height h, sanitizing unknown chars.
function normalizeLayer(rows, w, h, kind) {
  const out = [];
  const san = kind === 'floor' ? sanitizeFloor : sanitizeTop;
  for (let r = 0; r < h; r++) {
    const row = rows[r] || '';
    let s = '';
    for (let c = 0; c < w; c++) s += san(row[c] ?? '.');
    out.push(s);
  }
  return out;
}

export class Level {
  constructor(level) {
    const floor = Array.isArray(level.floor) ? level.floor : [];
    const map = Array.isArray(level.map) ? level.map : [];
    const w = Math.max(1, ...floor.map((r) => r.length), ...map.map((r) => r.length));
    const h = Math.max(1, floor.length, map.length);

    this.name = typeof level.name === 'string' ? level.name : 'Untitled';
    this.lighting = ['day', 'golden', 'evening'].includes(level.lighting) ? level.lighting : 'day';
    this.wallStyle = ['hedge', 'blossom', 'fence'].includes(level.wallStyle) ? level.wallStyle : 'hedge';
    this.w = w; this.h = h;

    // Handle the '*' shorthand (gift on heart): heart on floor, gift on map.
    const rawMap = map.map((row) => row || '');
    this.F = normalizeLayer(
      floor.map((row, r) => [...(row || '')].map((ch, c) => (rawMap[r] && rawMap[r][c] === '*' ? 'x' : ch)).join('')),
      w, h, 'floor'
    );
    this.MAP = normalizeLayer(rawMap, w, h, 'top');

    // Derived sets.
    this.TG = new Set();   // goal (heart) tiles "r,c"
    this.CAGES = [];
    this.BRIDES = [];
    this.WARPS = [];
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (this.F[r][c] === 'x') this.TG.add(r + ',' + c);
        if (this.F[r][c] === 'o') this.WARPS.push({ r, c });
        const m = this.MAP[r][c];
        if (m === 'c') this.CAGES.push({ r, c });
        if (m === 'B') this.BRIDES.push({ r, c });
      }
    }
  }

  // Initial dynamic state from the map's @ / $ / k / O glyphs.
  fresh() {
    const boxes = [];
    const stones = [];
    let player = { r: 0, c: 0 };
    for (let r = 0; r < this.h; r++) {
      for (let c = 0; c < this.w; c++) {
        const ch = this.MAP[r][c];
        if (ch === '@') player = { r, c };
        else if (ch === '$') boxes.push({ r, c, kind: 'gift' });
        else if (ch === 'k') boxes.push({ r, c, kind: 'cake' });
        else if (ch === 'O') stones.push({ r, c });
      }
    }
    return { player, boxes, stones, dir: 'down', push: false, moves: 0, hist: [] };
  }

  solid(state, r, c) {
    const row = this.MAP[r];
    const ch = row ? row[c] : undefined;
    return (
      ch === undefined ||
      this.F[r][c] === '~' ||
      SOLIDTOP.includes(ch) ||
      (ch === 'c' && !this.cageOpen(state))
    );
  }

  placedCount(boxes) { return boxes.filter((b) => this.TG.has(b.r + ',' + b.c)).length; }

  cageOpen(state) {
    if (!this.CAGES.length) return false;
    const occ = new Set([...state.boxes, ...(state.stones || []), state.player].map((o) => o.r + ',' + o.c));
    return (this.TG.size > 0 && [...this.TG].every((k) => occ.has(k))) || this.CAGES.some((g) => occ.has(g.r + ',' + g.c));
  }

  isWon(state) {
    if (!this.CAGES.length) return state.boxes.length > 0 && this.placedCount(state.boxes) === state.boxes.length;
    const p = state.player;
    if (this.BRIDES.length) return this.BRIDES.some((b) => Math.abs(b.r - p.r) + Math.abs(b.c - p.c) === 1);
    return this.cageOpen(state) && this.CAGES.some((g) => g.r === p.r && g.c === p.c);
  }

  // Is a (restored) dynamic state legal for this level? Guards against a saved
  // board that no longer matches an edited levels.json.
  legalState(state) {
    if (!state || !state.player || !Array.isArray(state.boxes) || !Array.isArray(state.stones)) return false;
    const fresh = this.fresh();
    if (state.boxes.length !== fresh.boxes.length || state.stones.length !== fresh.stones.length) return false;
    // Same multiset of box kinds.
    const kinds = (arr) => arr.map((b) => b.kind || 'gift').sort().join(',');
    if (kinds(state.boxes) !== kinds(fresh.boxes)) return false;
    const inBounds = (o) => o && o.r >= 0 && o.r < this.h && o.c >= 0 && o.c < this.w;
    const staticSolid = (r, c) => this.F[r][c] === '~' || SOLIDTOP.includes(this.MAP[r][c]) || this.MAP[r][c] === 'c';
    const all = [state.player, ...state.boxes, ...state.stones];
    const seen = new Set();
    for (const o of all) {
      if (!inBounds(o)) return false;
      if (staticSolid(o.r, o.c)) return false;
      const k = o.r + ',' + o.c;
      if (seen.has(k)) return false; // two objects on one cell
      seen.add(k);
    }
    return true;
  }

  // Attempt a move. Returns { state, anim, moved, won }.
  // `anim` is a stone-slide descriptor (or null) for the renderer.
  step(state, dr, dc, dir) {
    const s = state;
    const nr = s.player.r + dr, nc = s.player.c + dc;
    if (this.solid(s, nr, nc)) return { state: { ...s, dir, push: false }, anim: null, moved: false, won: this.isWon(s) };

    const occ = (r, c, boxes, stones) => boxes.some((b) => b.r === r && b.c === c) || stones.some((o) => o.r === r && o.c === c);
    let boxes = s.boxes, stones = s.stones, pushed = false, anim = null;
    const bi = boxes.findIndex((b) => b.r === nr && b.c === nc);
    const si = stones.findIndex((o) => o.r === nr && o.c === nc);

    if (bi >= 0) {
      const br = nr + dr, bc = nc + dc;
      if (this.solid(s, br, bc) || occ(br, bc, boxes, stones)) return { state: { ...s, dir, push: true }, anim: null, moved: false, won: this.isWon(s) };
      boxes = boxes.map((b, i) => (i === bi ? { ...b, r: br, c: bc } : b));
      pushed = true;
    } else if (si >= 0) {
      let r = nr, c = nc;
      while (!this.solid(s, r + dr, c + dc) && !occ(r + dr, c + dc, boxes, stones)) { r += dr; c += dc; }
      if (r === nr && c === nc) return { state: { ...s, dir, push: true }, anim: null, moved: false, won: this.isWon(s) };
      stones = stones.map((o, i) => (i === si ? { r, c } : o));
      pushed = true;
      const dist = Math.abs(r - nr) + Math.abs(c - nc);
      anim = { i: si, fr: nr, fc: nc, tr: r, tc: c, start: (typeof performance !== 'undefined' ? performance.now() : Date.now()), dur: 70 + dist * 75, cw: dr + dc > 0 };
    }

    let player = { r: nr, c: nc };
    const wi = this.WARPS.findIndex((w) => w.r === nr && w.c === nc);
    if (wi >= 0 && this.WARPS.length === 2) {
      const t = this.WARPS[1 - wi];
      if (!occ(t.r, t.c, boxes, stones)) player = { r: t.r, c: t.c };
    }

    const next = {
      ...s, player, boxes, stones, dir, push: pushed, moves: s.moves + 1,
      hist: [...s.hist, { player: s.player, boxes: s.boxes, stones: s.stones, dir: s.dir, moves: s.moves }]
    };
    return { state: next, anim, moved: true, won: this.isWon(next) };
  }
}

// A stable fingerprint of a level's static layout — used to invalidate a saved
// in-progress board if the user later edits levels.json and the stage shifts.
export function levelSignature(level) {
  const f = (Array.isArray(level.floor) ? level.floor : []).join('|');
  const m = (Array.isArray(level.map) ? level.map : []).join('|');
  let hash = 2166136261;
  const str = f + '#' + m + '#' + (level.lighting || '') + '#' + (level.wallStyle || '');
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
