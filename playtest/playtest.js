// Local playtest harness for Something Pushed stages.
// Uses the SAME verified rules as tools/stage-tester.mjs, so what you play here is exactly
// what the tester validates (new "groom ON the bride" win rule + color-matched gifts included).
// No name screen, no score, no Google Form, no leaderboard — just pick a stage and play.
import { parseLevel, stepState, isWon, cageOpen } from '../tools/stage-tester.mjs';

const LEVELS_URL = new URLSearchParams(location.search).get('src') || '../contrib/levels.sample.json';
const COLORHEX = { 1:'#5bc3e8', 2:'#bba6c9', 3:'#9ad35b', 4:'#f6c94f', 5:'#e0507a', 6:'#c0643a', 7:'#86c34d', 8:'#d8445a', 9:'#b0e8f7' };
const HEARTEMOJI = { 1:'💙', 2:'💜', 3:'💚', 4:'💛', 5:'❤️', 6:'🧡', 7:'💚', 8:'❤️', 9:'🩵' };

let LEVELS = [], cur = 0, mdl = null, st = null, hist = [], moves = 0, pushes = 0, won = false;
let kindAt = new Map();   // pos -> 'gift'|'cake' (cosmetic only; follows a box as it's pushed)
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

async function loadLevels() {
  try {
    const res = await fetch(LEVELS_URL + '?v=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    LEVELS = await res.json();
  } catch (e) {
    $('status').textContent = 'Could not load ' + LEVELS_URL + ' — serve the repo root over http (see README).';
    return;
  }
  $('stage').innerHTML = LEVELS.map((l, i) => `<option value="${i}">${i + 1}. ${esc(l.name)}</option>`).join('');
  if (cur >= LEVELS.length) cur = 0;
  loadStage(cur);
}

function initState() {
  return { p: mdl.player, boxes: new Map(mdl.boxes.map(b => [b.pos, b.color || 0])), stones: new Set(mdl.stones) };
}
const bKey = (s) => [...s.boxes.keys()].sort((a, z) => a - z).join(',');
const sKey = (s) => [...s.stones].sort((a, z) => a - z).join(',');

function loadStage(i) {
  cur = i;
  mdl = parseLevel(LEVELS[i]);
  st = initState(); hist = []; moves = 0; pushes = 0; won = false;
  kindAt = new Map(mdl.boxes.map(b => [b.pos, b.kind]));
  $('stage').value = i;
  hideWin(); render();
}

function move(dr, dc) {
  if (won || !mdl) return;
  const beforeBoxes = new Set(st.boxes.keys());
  const ns = stepState(mdl, st, dr, dc);
  if (!ns) return;                                   // blocked / no-op
  const pushedBox = bKey(ns) !== bKey(st), pushedStone = sKey(ns) !== sKey(st);
  hist.push({ p: st.p, boxes: [...st.boxes.entries()], stones: [...st.stones], kind: [...kindAt], moves, pushes });
  if (pushedBox) {                                    // carry the box's kind to its new tile
    let from = -1, to = -1;
    for (const k of beforeBoxes) if (!ns.boxes.has(k)) from = k;
    for (const k of ns.boxes.keys()) if (!beforeBoxes.has(k)) to = k;
    if (from >= 0 && to >= 0 && kindAt.has(from)) { const kd = kindAt.get(from); kindAt.delete(from); kindAt.set(to, kd); }
  }
  st = ns; moves++; if (pushedBox || pushedStone) pushes++;
  if (isWon(mdl, st)) won = true;
  render();
  if (won) showWin();
}
function undo() {
  if (!hist.length) return;
  const s = hist.pop();
  st = { p: s.p, boxes: new Map(s.boxes), stones: new Set(s.stones) };
  kindAt = new Map(s.kind); moves = s.moves; pushes = s.pushes; won = false;
  hideWin(); render();
}
const restart = () => loadStage(cur);
const nextStage = () => { if (cur + 1 < LEVELS.length) loadStage(cur + 1); };
const prevStage = () => { if (cur > 0) loadStage(cur - 1); };

function render() {
  if (!mdl) return;
  const W = mdl.W, H = mdl.H, open = cageOpen(mdl, st);
  const board = $('board');
  const avail = Math.min(window.innerWidth - 44, 560);
  const cellPx = Math.max(20, Math.min(46, Math.floor(avail / W)));
  board.style.gridTemplateColumns = `repeat(${W}, ${cellPx}px)`;
  board.style.fontSize = Math.round(cellPx * 0.52) + 'px';

  let covered = 0;
  const heartFilled = (h) => {
    const hc = mdl.heartColor[h] || 0;
    return hc === 0 ? (st.boxes.has(h) || st.stones.has(h)) : (st.boxes.has(h) && st.boxes.get(h) === hc);
  };
  for (const h of mdl.TG) if (heartFilled(h)) covered++;

  let html = '';
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const pos = r * W + c, f = mdl.F[r][c], m = mdl.M[r][c];
    const groom = st.p === pos, box = st.boxes.has(pos), stone = st.stones.has(pos);
    const isHeart = mdl.TG.has(pos), hc = isHeart ? (mdl.heartColor[pos] || 0) : -1;
    let cls = 'cell', glyph = '', ring = '';
    const wallLike = '#Qfhl'.includes(m);
    const solidObj = wallLike || (m === 'B' && !groom) || m === 'c';
    // floor colour shows ONLY when no solid object covers the tile (so a wall never looks like grass)
    if (!solidObj) {
      if (f === '~') cls += ' pond'; else if (f === '=') cls += ' aisle';
      else if (f === '_') cls += ' path'; else cls += ((r + c) % 2 ? ' grass2' : ' grass');
      if (f === 'o') glyph = '🌀';
    }
    if (wallLike) { cls += ' wall'; glyph = m === 'h' ? '🪑' : m === 'l' ? '🏮' : ''; }
    else if (m === 'B' && !groom) { cls += ' bride'; glyph = '👰'; }
    else if (m === 'c') cls += open ? ' cage-open' : ' cage';

    if (isHeart && !box && !stone && !groom && !'#Qfhl'.includes(m)) {
      if (hc > 0) { glyph = HEARTEMOJI[hc] || '🤍'; ring = COLORHEX[hc] || '#888'; } else glyph = '💗';
    }
    if (m === 'c' && !box && !stone && !groom) glyph = open ? '🔓' : '🔒';
    if (stone) glyph = '🪨';
    if (box) {
      const col = st.boxes.get(pos);
      glyph = kindAt.get(pos) === 'cake' ? '🍰' : '🎁';
      if (col > 0) ring = COLORHEX[col] || '#888';
      if (isHeart && (hc === 0 || hc === col)) cls += ' delivered';
    }
    if (groom) { cls += ' groom'; glyph = mdl.BRIDES.includes(pos) ? '💑' : '🤵'; }

    html += `<div class="${cls}"${ring ? ` style="box-shadow:inset 0 0 0 4px ${ring}"` : ''}>${glyph}</div>`;
  }
  board.innerHTML = html;

  const cageTxt = mdl.CAGES.length ? (open ? 'OPEN 🔓' : 'locked 🔒') : '—';
  $('status').innerHTML =
    `Stage ${cur + 1}/${LEVELS.length} · <b>${esc(mdl.name)}</b> &nbsp;|&nbsp; Moves ${moves} · Pushes ${pushes}` +
    ` &nbsp;|&nbsp; Hearts ${covered}/${mdl.TG.size} &nbsp;|&nbsp; Cage ${cageTxt}`;
}

function showWin() {
  $('win-sub').textContent = `Stage ${cur + 1} cleared in ${moves} moves (${pushes} pushes).`;
  $('win-next').style.display = (cur + 1 < LEVELS.length) ? '' : 'none';
  $('win').style.display = 'flex';
}
const hideWin = () => { $('win').style.display = 'none'; };

// ---- input ----
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  const DIRS = { arrowup:[-1,0], w:[-1,0], arrowdown:[1,0], s:[1,0], arrowleft:[0,-1], a:[0,-1], arrowright:[0,1], d:[0,1] };
  if (DIRS[k]) { e.preventDefault(); move(...DIRS[k]); }
  else if (k === 'z') { e.preventDefault(); undo(); }
  else if (k === 'r') restart();
  else if (k === 'n') nextStage();
  else if (k === 'p') prevStage();
});

const DIRMAP = { U:[-1,0], D:[1,0], L:[0,-1], R:[0,1] };
document.querySelectorAll('.pad button[data-dir]').forEach(b =>
  b.addEventListener('click', () => move(...DIRMAP[b.dataset.dir])));
$('undo').addEventListener('click', undo);
$('restart').addEventListener('click', restart);
$('next').addEventListener('click', nextStage);
$('prev').addEventListener('click', prevStage);
$('reload').addEventListener('click', loadLevels);
$('stage').addEventListener('change', (e) => loadStage(+e.target.value));
$('win-replay').addEventListener('click', () => { hideWin(); restart(); });
$('win-next').addEventListener('click', () => { hideWin(); nextStage(); });
window.addEventListener('resize', render);

// swipe on the board (touch)
let t0 = null;
const board = $('board');
board.addEventListener('touchstart', (e) => { const t = e.touches[0]; t0 = { x: t.clientX, y: t.clientY }; }, { passive: true });
board.addEventListener('touchend', (e) => {
  if (!t0) return;
  const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y; t0 = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
  if (Math.abs(dx) > Math.abs(dy)) move(0, dx > 0 ? 1 : -1); else move(dy > 0 ? 1 : -1, 0);
}, { passive: true });

loadLevels();
