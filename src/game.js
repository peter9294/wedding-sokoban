// Something Pushed — game controller.
// Screens: name -> tutorial -> play -> (win overlay) -> next stage -> all-clear.
import { CONFIG } from '../config.js';
import { Level, levelSignature } from './engine.js';
import { buildSprites } from './sprites.js';
import { Renderer } from './render.js';
import { loadProgress, saveProgress, clampName, newSessionId } from './storage.js';
import { submitScore, scoringOpen } from './score.js';
import { escapeHtml, shortId } from './util.js';

const $ = (id) => document.getElementById(id);

const FALLBACK_LEVELS = [{
  name: 'Warm-up', lighting: 'day', wallStyle: 'hedge',
  floor: ['.......', '.......', '...x...', '.......', '.......', '.......', '.......'],
  map: ['#######', '#.....#', '#.....#', '#..$..#', '#..@..#', '#.....#', '#######']
}];

// The last stage is a surprise: each player gets one board drawn at random from a
// pre-generated, solver-verified pool, then pinned in localStorage so replays show the
// same board. Content (not an index) is stored, so editing the pool never shifts anyone.
const FINALE_KEY = 'sp-finale-v1';
const FINALE_WRAP = { name: 'Happily Ever After', lighting: 'golden', wallStyle: 'blossom' };

// Tutorial: three tiny looping demos (real engine + sprites) shown as rows —
// push a gift onto a heart, match a colour, then reach the bride to win.
const DEMO_DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
const DEMOS = [
  { id: 'tut-demo-1', def: { lighting: 'golden', wallStyle: 'hedge', floor: ['......', '....x.', '......'], map: ['######', '#@.$.#', '######'] }, script: ['right', 'right'] },
  { id: 'tut-demo-2', def: { lighting: 'golden', wallStyle: 'hedge', floor: ['......', '....1.', '......'], map: ['######', '#@.1.#', '######'] }, script: ['right', 'right'] },
  { id: 'tut-demo-3', def: { lighting: 'golden', wallStyle: 'hedge', floor: ['.....', '...x.', '.....', '.....', '.....'], map: ['#####', '#@$.#', '#.c.#', '#.B.#', '#####'] }, script: ['right', 'down', 'down'] }
];
let demoControllers = [];

let LEVELS = [];
let IDS = [];
let sprites, renderer, ctx;
let level = null;
let stageIdx = 0;
let state = null;
let anim = null;
let won = false;
let progress;
let currentScreen = 'menu';
let tutorialFrom = 'play';   // where GOT IT returns to: 'play' (start) or 'menu' (just reading)

// Event fresh-start: once we're at/after CONFIG.freshStartAt, clear any saved
// progress that was STARTED before that moment, so pre-event practice is wiped and
// everyone begins clean for the party. Progress started at/after the cutoff is kept.
function maybeFreshStart() {
  const cutoff = new Date(CONFIG.freshStartAt || '').getTime();
  if (isNaN(cutoff) || Date.now() < cutoff) return;   // no cutoff set, or not time yet
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('sp-game-v1') || 'null'); } catch { /* ignore */ }
  const startedAt = (saved && Number(saved.startedAt)) || 0;
  if (startedAt < cutoff) {                            // pre-event (or legacy, no stamp) → wipe
    try { localStorage.removeItem('sp-game-v1'); localStorage.removeItem('sp-finale-v1'); } catch { /* ignore */ }
  }
}

// ---- boot ------------------------------------------------------------------
async function init() {
  maybeFreshStart();
  progress = loadProgress();
  if (!progress.sessionId) progress.sessionId = newSessionId();
  // Stamp when this session began, so the fresh-start cutoff can tell pre-event
  // saves from ones made during the event. Persist it right away.
  if (!progress.startedAt) { progress.startedAt = Date.now(); saveProgress(progress); }

  sprites = buildSprites();
  renderer = new Renderer(sprites);
  renderer.initials = {
    bride: (CONFIG.couple && CONFIG.couple.bride) || '',
    groom: (CONFIG.couple && CONFIG.couple.groom) || ''
  };
  ctx = $('board').getContext('2d');

  try {
    const res = await fetch('./levels.json?v=' + encodeURIComponent(CONFIG.levelsVersion || '1'));
    if (!res.ok) throw new Error('fetch ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error('empty');
    LEVELS = data;
    await appendFinale();           // adds the per-player surprise stage at the end
  } catch (e) {
    LEVELS = FALLBACK_LEVELS;
    toast('Using a built-in level (levels.json not found)');
  }
  IDS = LEVELS.map(levelSignature);

  // Scores are submitted ONLY on a win (see handleWin) — never on an interval/retry.

  bindEvents();
  startLoop();

  // Everyone lands on the main menu — no name needed to get here or to view the
  // leaderboard. The name is asked only when they actually start playing (stage 1).
  $('name-input').value = progress.name || '';
  showScreen('menu');
}

// FNV-1a hash → a stable non-negative int, for a deterministic-but-varied finale pick.
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Pick (once) and pin the surprise finale board, then append it as the last stage.
// Any failure here is swallowed: the game simply plays the scripted stages.
async function appendFinale() {
  try {
    const res = await fetch('./finale-pool.json?v=' + encodeURIComponent(CONFIG.levelsVersion || '1'));
    if (!res.ok) throw new Error('fetch ' + res.status);
    const pool = await res.json();
    if (!Array.isArray(pool) || !pool.length) throw new Error('empty pool');

    let board = null;
    try {
      const saved = JSON.parse(localStorage.getItem(FINALE_KEY) || 'null');
      if (saved && Array.isArray(saved.floor) && Array.isArray(saved.map)) board = saved;
    } catch { /* ignore a corrupt/blocked store */ }

    if (!board) {
      // Deterministic pick from the player's session id, so the finale is stable for a
      // given player even if the pin write fails — the localStorage pin is just a cache.
      // (Pure private mode regenerates the session id each load, so it can still vary there.)
      const seed = (progress && progress.sessionId) ? hashStr(progress.sessionId) : Math.floor(Math.random() * pool.length);
      const pick = pool[seed % pool.length];
      board = { floor: pick.floor, map: pick.map };
      try { localStorage.setItem(FINALE_KEY, JSON.stringify(board)); } catch { /* private mode: still playable, just not pinned */ }
    }

    LEVELS.push({ ...FINALE_WRAP, floor: board.floor, map: board.map });
  } catch (e) {
    /* no finale appended */
  }
}

// ---- screen routing --------------------------------------------------------
function showScreen(name) {
  currentScreen = name;
  $('screen-menu').hidden = name !== 'menu';
  $('screen-tutorial').hidden = name !== 'tutorial';
  $('screen-play').hidden = name !== 'play';
  if (name !== 'play') { hideOverlay('overlay-win'); hideOverlay('overlay-allclear'); hideOverlay('overlay-reset'); hideOverlay('overlay-name'); $('id-tip').hidden = true; }
  if (name === 'tutorial') startTutorialDemos(); else stopTutorialDemos();
  if (name === 'play') requestAnimationFrame(fitCanvas);
}

function firstUnclearedStage() {
  for (let i = 0; i < LEVELS.length; i++) if (!progress.cleared.includes(IDS[i])) return i;
  return LEVELS.length; // all cleared
}

function enterGame() {
  const idx = firstUnclearedStage();
  if (idx >= LEVELS.length) { showAllClear(); return; }
  // Restore an in-progress board only if it still matches this stage.
  let restore = null;
  if (progress.current && progress.current.levelId === IDS[idx]) restore = progress.current;
  loadStage(idx, restore);
  showScreen('play');
  // First time playing with no name yet → ask it here, on the first stage.
  if (!progress.name) { showOverlay('overlay-name'); setTimeout(() => $('name-input').focus(), 40); }
}

// Main-menu PLAY: show the tutorial first (first time only), otherwise jump in.
function onPlay() {
  if (!progress.tutorialSeen) {
    tutorialFrom = 'play';
    $('tut-welcome').textContent = progress.name ? ('Welcome, ' + progress.name + '!') : 'Welcome!';
    showScreen('tutorial');
  } else {
    enterGame();
  }
}

// "How to play" from the menu — read the tips and return to the menu.
function openHowTo() {
  tutorialFrom = 'menu';
  $('tut-welcome').textContent = progress.name ? ('Welcome back, ' + progress.name + '!') : 'How to play';
  showScreen('tutorial');
}

// Back to the main menu from the game (progress is saved, so PLAY resumes here).
function goMenu() {
  if (state && currentScreen === 'play') saveCurrent();
  showScreen('menu');
}

function loadStage(idx, restore) {
  stageIdx = idx;
  level = new Level(LEVELS[idx]);
  anim = null;
  won = false;
  renderer.reset();

  let s = level.fresh();
  if (restore) {
    const candidate = {
      player: restore.player, boxes: restore.boxes, stones: restore.stones,
      dir: restore.dir || 'down', push: false, moves: restore.moves || 0,
      hist: Array.isArray(restore.hist) ? restore.hist : []
    };
    if (level.legalState(candidate)) s = candidate;
  }
  state = s;
  won = level.isWon(state);

  // Canvas internal resolution = art pixels; CSS scales it up crisply.
  const cv = $('board');
  cv.width = level.w * 16; cv.height = level.h * 16;
  fitCanvas();

  saveCurrent();
  updateHUD();
  updateControls();
}

// ---- actions ---------------------------------------------------------------
function doMove(dr, dc, dir) {
  if (currentScreen !== 'play' || won || !level) return;
  if (!$('overlay-name').hidden || !$('overlay-reset').hidden) return;  // a modal is open
  const prevPlayer = state.player, prevBoxes = state.boxes;
  const res = level.step(state, dr, dc, dir);
  state = res.state;
  if (res.anim) anim = res.anim;

  // Drive the render-only motion tweens (logic positions stay integer cells).
  if (res.moved) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dist = Math.abs(state.player.r - prevPlayer.r) + Math.abs(state.player.c - prevPlayer.c);
    renderer.pA = { fr: prevPlayer.r, fc: prevPlayer.c, start: now, dur: dist > 1 ? 280 : 120, warp: dist > 1 };
    const pb = state.boxes.findIndex((b, i) => b !== prevBoxes[i]);
    renderer.bA = pb >= 0 ? { i: pb, fr: prevBoxes[pb].r, fc: prevBoxes[pb].c, start: now, dur: 120 } : null;
    if (res.won && !won) {
      const cx = state.player.c * 16 + 8, cy = state.player.r * 16 + 4;
      const cols = ['#e0507a', '#f7a1bd', '#f6c94f', '#fffaf4', '#b0e8f7', '#9ad35b'];
      renderer.confetti = {
        t: now + 120, // burst once the final step tween lands
        ps: Array.from({ length: 80 }, (_, i) => {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, v = 70 + Math.random() * 120;
          return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, col: cols[i % cols.length], s: Math.random() < 0.3 ? 2 : 1, spin: 2 + Math.random() * 6 };
        })
      };
    }
  }

  saveCurrent();
  updateControls();
  if (res.won && !won) handleWin();
}

function handleWin() {
  won = true;
  const id = IDS[stageIdx];
  if (!progress.cleared.includes(id)) progress.cleared.push(id);
  const solved = progress.cleared.length;

  // Submit the score — ONLY here (on a win), only once per distinct stage, and only
  // before the deadline. sentStages (localStorage) stops any replay/reload resubmit.
  if (scoringOpen() && !progress.sentStages.includes(id)) {
    progress.sentStages.push(id);
    submitScore({ name: progress.name, solved, stage: stageIdx + 1, session: progress.sessionId });
  }
  saveCurrent();
  updateHUD();
  updateControls();

  $('win-note').textContent = 'Every gift found its heart, ' + progress.name + '.';
  $('win-solved').textContent = 'Solved ' + solved + (solved === 1 ? ' stage' : ' stages');
  $('next-stage').textContent = (stageIdx + 1 >= LEVELS.length) ? 'FINISH' : 'NEXT STAGE';
  // Let the confetti burst (render.js) play over the board before the board-covering
  // popup rises. Inputs are already inert once `won` is set, so the pause is safe.
  setTimeout(() => { if (won && currentScreen === 'play') showOverlay('overlay-win'); }, 750);
}

function nextStage() {
  hideOverlay('overlay-win');
  const next = stageIdx + 1;
  if (next >= LEVELS.length) { progress.current = null; saveProgress(progress); showAllClear(); return; }
  loadStage(next, null);
}

function showAllClear() {
  const solved = progress.cleared.length;
  $('allclear-solved').textContent = 'Solved ' + solved + (solved === 1 ? ' stage' : ' stages');
  showScreen('play');
  showOverlay('overlay-allclear');
}

function replayAll() {
  progress.cleared = [];        // sentStages kept, so we never double-submit
  progress.current = null;
  saveProgress(progress);
  hideOverlay('overlay-allclear');
  loadStage(0, null);
}

function undo() {
  if (won || !state || !state.hist.length) return;
  const h = state.hist;
  const prev = h[h.length - 1];
  anim = null;
  renderer.pA = renderer.bA = renderer.confetti = null;
  state = { ...state, player: prev.player, boxes: prev.boxes, stones: prev.stones, dir: prev.dir, moves: prev.moves, push: false, hist: h.slice(0, -1) };
  saveCurrent();
  updateControls();
}

function restart() {
  if (!level || won) return;
  anim = null;
  renderer.reset();
  state = level.fresh();
  won = false;
  saveCurrent();
  updateControls();
}

function confirmName() {
  const name = clampName($('name-input').value);
  if (!name) { $('name-input').focus(); return; }
  progress.name = name;
  if (!progress.sessionId) progress.sessionId = newSessionId();
  saveProgress(progress);
  hideOverlay('overlay-name');
  updateHUD();
}

function gotIt() {
  progress.tutorialSeen = true;
  saveProgress(progress);
  if (tutorialFrom === 'play-help') showScreen('play');   // resume the live stage, no reload
  else if (tutorialFrom === 'menu') showScreen('menu');
  else enterGame();
}

// Back out of the name prompt without naming/playing, so "just looking" guests
// (who tapped PLAY then changed their mind) aren't trapped on the overlay.
function cancelName() {
  hideOverlay('overlay-name');
  showScreen('menu');
}

// Tapping the player's name reveals their leaderboard tag (matches the "(xxxx)"
// shown next to names on the board), so they can find their own row.
let idTipTimer = null;
function toggleIdTip() {
  const el = $('id-tip');
  if (!el.hidden) { el.hidden = true; clearTimeout(idTipTimer); return; }
  const tag = shortId(progress.sessionId);
  el.textContent = tag ? ('You’re (' + tag + ') on the leaderboard') : 'Your tag appears once you play';
  el.hidden = false;
  clearTimeout(idTipTimer);
  idTipTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

// "?" button on the play screen — reread the tips, then return to the current stage.
function openHelp() {
  tutorialFrom = 'play-help';
  $('tut-welcome').textContent = 'How to play';
  showScreen('tutorial');
}

// ---- persistence of the live board ----------------------------------------
function saveCurrent() {
  progress.current = {
    levelId: IDS[stageIdx],
    player: state.player, boxes: state.boxes, stones: state.stones,
    moves: state.moves, dir: state.dir, hist: state.hist
  };
  saveProgress(progress);
}

// ---- HUD / controls --------------------------------------------------------
function updateHUD() {
  $('hud-stage').innerHTML = '<span class="num">' + (stageIdx + 1) + '</span> · ' + escapeHtml(level.name);
  $('hud-user').textContent = 'Hi, ' + (progress.name || 'friend');
  $('hud-solved').textContent = 'Solved ' + progress.cleared.length;
}
function updateControls() {
  const u = $('btn-undo');
  u.disabled = won || !state || state.hist.length === 0;
}

// ---- overlays / toast ------------------------------------------------------
function showOverlay(id) { $(id).hidden = false; }
function hideOverlay(id) { $(id).hidden = true; }
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---- canvas fit ------------------------------------------------------------
function fitCanvas() {
  if (!level) return;
  const cv = $('board');
  const wrap = cv.parentElement;
  const availW = Math.max(40, wrap.clientWidth - 20);
  const availH = Math.max(40, wrap.clientHeight - 20);
  const artW = level.w * 16, artH = level.h * 16;
  let scale = Math.min(availW / artW, availH / artH);
  if (scale >= 1) scale = Math.floor(scale);           // integer scale when upscaling = crisp pixels
  scale = Math.max(scale, 0.1);
  cv.style.width = Math.round(artW * scale) + 'px';
  cv.style.height = Math.round(artH * scale) + 'px';
}

// ---- render loop -----------------------------------------------------------
function startLoop() {
  const loop = (t) => {
    if (currentScreen === 'play' && level && state) renderer.draw(ctx, level, state, t, anim);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ---- tutorial demos (looping animations) -----------------------------------
function startTutorialDemos() {
  stopTutorialDemos();
  if (!sprites) return;
  demoControllers = DEMOS.map(makeDemo).filter(Boolean);
}
function stopTutorialDemos() {
  demoControllers.forEach((c) => c.stop());
  demoControllers = [];
}
function makeDemo(spec) {
  const cv = $(spec.id);
  if (!cv) return null;
  const rnd = new Renderer(sprites); rnd.initials = { bride: '', groom: '' };
  const level = new Level(spec.def);
  cv.width = level.w * 16; cv.height = level.h * 16;
  const ctx = cv.getContext('2d');
  let state = level.fresh(), anim = null, raf = 0, timer = 0, alive = true, si = 0;
  const loop = (t) => { if (!alive) return; rnd.draw(ctx, level, state, t, anim); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  const reset = () => { state = level.fresh(); rnd.reset(); anim = null; si = 0; timer = setTimeout(step, 700); };
  const step = () => {
    if (si >= spec.script.length) { timer = setTimeout(reset, 1600); return; }  // hold solved frame, then loop
    const dir = spec.script[si++], [dr, dc] = DEMO_DIRS[dir];
    const pP = state.player, pB = state.boxes;
    const res = level.step(state, dr, dc, dir);
    state = res.state;
    if (res.anim) anim = res.anim;
    if (res.moved) {
      const now = performance.now();
      rnd.pA = { fr: pP.r, fc: pP.c, start: now, dur: 160, warp: false };
      const pb = state.boxes.findIndex((b, i) => b !== pB[i]);
      rnd.bA = pb >= 0 ? { i: pb, fr: pB[pb].r, fc: pB[pb].c, start: now, dur: 160 } : null;
      if (res.won && level.BRIDES && level.BRIDES.length) {  // celebrate only the reach-the-bride demo
        const cx = state.player.c * 16 + 8, cy = state.player.r * 16 + 4;
        const cols = ['#e0507a', '#f7a1bd', '#f6c94f', '#fffaf4', '#b0e8f7', '#9ad35b'];
        rnd.confetti = { t: now + 120, ps: Array.from({ length: 48 }, (_, i) => { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, v = 60 + Math.random() * 90; return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, col: cols[i % cols.length], s: Math.random() < 0.3 ? 2 : 1, spin: 2 + Math.random() * 6 }; }) };
      }
    }
    timer = setTimeout(step, 780);
  };
  timer = setTimeout(step, 800);
  return { stop: () => { alive = false; if (raf) cancelAnimationFrame(raf); if (timer) clearTimeout(timer); } };
}

// ---- input -----------------------------------------------------------------
function bindEvents() {
  $('menu-play').addEventListener('click', onPlay);
  $('menu-howto').addEventListener('click', openHowTo);
  $('btn-menu').addEventListener('click', goMenu);
  $('btn-help').addEventListener('click', openHelp);
  $('hud-user').addEventListener('click', toggleIdTip);
  $('confirm-name').addEventListener('click', confirmName);
  $('name-back').addEventListener('click', cancelName);
  $('overlay-name').addEventListener('click', (e) => { if (e.target.id === 'overlay-name') cancelName(); });
  $('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmName(); } });
  $('got-it').addEventListener('click', gotIt);
  $('btn-undo').addEventListener('click', undo);
  $('btn-restart').addEventListener('click', restart);
  $('next-stage').addEventListener('click', nextStage);
  $('replay-all').addEventListener('click', replayAll);

  // Hard reset — clears all saved progress on this device and reloads. Uses an in-page
  // confirm overlay, because native confirm() is silently blocked in some mobile and
  // in-app webviews (the button would appear to do nothing).
  $('hard-reset').addEventListener('click', () => showOverlay('overlay-reset'));
  $('reset-cancel').addEventListener('click', () => hideOverlay('overlay-reset'));
  $('reset-confirm').addEventListener('click', () => {
    try { localStorage.clear(); } catch { /* ignore */ }
    location.reload();
  });
  $('overlay-reset').addEventListener('click', (e) => { if (e.target.id === 'overlay-reset') hideOverlay('overlay-reset'); });

  const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  document.querySelectorAll('.dpad .pad[data-dir]').forEach((pad) => {
    pad.addEventListener('pointerdown', (e) => { e.preventDefault(); const [dr, dc] = DIRS[pad.dataset.dir]; doMove(dr, dc, pad.dataset.dir); });
  });

  window.addEventListener('keydown', (e) => {
    if (currentScreen !== 'play') return;
    if (!$('overlay-name').hidden) { if (e.key === 'Escape') cancelName(); return; }  // typing a name — don't hijack letter keys
    if (!$('overlay-reset').hidden) { if (e.key === 'Escape') hideOverlay('overlay-reset'); return; }
    if (!$('overlay-win').hidden || !$('overlay-allclear').hidden) return; // popup open: ignore game keys
    const k = e.key.toLowerCase();
    const map = { arrowup: ['up'], w: ['up'], arrowdown: ['down'], s: ['down'], arrowleft: ['left'], a: ['left'], arrowright: ['right'], d: ['right'] };
    if (map[k]) { e.preventDefault(); const dir = map[k][0]; const [dr, dc] = DIRS[dir]; doMove(dr, dc, dir); }
    else if (k === 'z') undo();
    else if (k === 'r') restart();
  });

  // Swipe on the board (pointer events; touch-action:none in CSS stops scroll).
  const cv = $('board');
  let p0 = null;
  cv.addEventListener('pointerdown', (e) => { p0 = { x: e.clientX, y: e.clientY }; try { cv.setPointerCapture(e.pointerId); } catch {} });
  cv.addEventListener('pointerup', (e) => {
    if (!p0) return;
    const dx = e.clientX - p0.x, dy = e.clientY - p0.y; p0 = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) doMove(0, dx > 0 ? 1 : -1, dx > 0 ? 'right' : 'left');
    else doMove(dy > 0 ? 1 : -1, 0, dy > 0 ? 'down' : 'up');
  });
  cv.addEventListener('pointercancel', () => { p0 = null; });

  window.addEventListener('resize', fitCanvas);
  window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 120));
}

init();
