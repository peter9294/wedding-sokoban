// Something Pushed — game controller.
// Screens: name -> tutorial -> play -> (win overlay) -> next stage -> all-clear.
import { CONFIG, CAN_SUBMIT } from '../config.js';
import { Level, levelSignature } from './engine.js';
import { buildSprites } from './sprites.js';
import { Renderer } from './render.js';
import { loadProgress, saveProgress, clampName, newSessionId } from './storage.js';
import { submitScore } from './score.js';

const $ = (id) => document.getElementById(id);

const FALLBACK_LEVELS = [{
  name: 'Warm-up', lighting: 'day', wallStyle: 'hedge',
  floor: ['.......', '.......', '...x...', '.......', '.......', '.......', '.......'],
  map: ['#######', '#.....#', '#.....#', '#..$..#', '#..@..#', '#.....#', '#######']
}];

let LEVELS = [];
let IDS = [];
let sprites, renderer, ctx;
let level = null;
let stageIdx = 0;
let state = null;
let anim = null;
let won = false;
let progress;
let currentScreen = 'name';

// ---- boot ------------------------------------------------------------------
async function init() {
  progress = loadProgress();
  if (!progress.sessionId) progress.sessionId = newSessionId();

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
  } catch (e) {
    LEVELS = FALLBACK_LEVELS;
    toast('Using a built-in level (levels.json not found)');
  }
  IDS = LEVELS.map(levelSignature);

  // Scores are submitted ONLY on a win (see handleWin) — never on an interval/retry.

  bindEvents();
  startLoop();
  startClock();

  // Prefill + route.
  $('name-input').value = progress.name || '';
  if (progress.name && progress.tutorialSeen) enterGame();
  else if (progress.name) { $('tut-welcome').textContent = 'Welcome, ' + progress.name + '!'; showScreen('tutorial'); }
  else showScreen('name');
}

// ---- screen routing --------------------------------------------------------
function showScreen(name) {
  currentScreen = name;
  $('screen-name').hidden = name !== 'name';
  $('screen-tutorial').hidden = name !== 'tutorial';
  $('screen-play').hidden = name !== 'play';
  if (name !== 'play') { hideOverlay('overlay-win'); hideOverlay('overlay-allclear'); }
  if (name === 'play') requestAnimationFrame(fitCanvas);
  if (name === 'name') setTimeout(() => $('name-input').focus(), 30);
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
  const res = level.step(state, dr, dc, dir);
  state = res.state;
  if (res.anim) anim = res.anim;
  saveCurrent();
  updateControls();
  if (res.won && !won) handleWin();
}

function handleWin() {
  won = true;
  const id = IDS[stageIdx];
  if (!progress.cleared.includes(id)) progress.cleared.push(id);
  const solved = progress.cleared.length;

  // Submit the score — ONLY here (on a win), and only once per distinct stage.
  // sentStages is persisted in localStorage, so a replay or reload never resubmits.
  if (CAN_SUBMIT && !progress.sentStages.includes(id)) {
    progress.sentStages.push(id);
    submitScore({ name: progress.name, solved, stage: stageIdx + 1, session: progress.sessionId });
  }
  saveCurrent();
  updateHUD();
  updateControls();

  $('win-note').textContent = 'Every gift found its heart, ' + progress.name + '.';
  $('win-solved').textContent = 'Solved ' + solved + (solved === 1 ? ' stage' : ' stages');
  $('next-stage').textContent = (stageIdx + 1 >= LEVELS.length) ? 'FINISH' : 'NEXT STAGE';
  showOverlay('overlay-win');
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
  if (!progress.tutorialSeen) {
    $('tut-welcome').textContent = 'Welcome, ' + name + '!';
    showScreen('tutorial');
  } else {
    enterGame();
  }
}

function gotIt() {
  progress.tutorialSeen = true;
  saveProgress(progress);
  enterGame();
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
  $('hud-stage').textContent = (stageIdx + 1) + ' · ' + level.name;
  $('hud-user').textContent = 'Hi, ' + (progress.name || 'friend');
  $('hud-solved').textContent = 'Solved ' + progress.cleared.length;
}
function updateControls() {
  const u = $('btn-undo');
  u.disabled = won || !state || state.hist.length === 0;
}
function clockVals() {
  const end = new Date(CONFIG.weddingDate);
  const ok = !isNaN(end);
  const left = ok ? Math.max(0, end - Date.now()) : 0;
  const t = Math.floor(left / 1000), d = Math.floor(t / 86400), hh = Math.floor((t % 86400) / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
  const z = (n) => String(n).padStart(2, '0');
  const countdown = !ok ? '--:--:--' : left === 0 ? "TIME'S UP" : (d ? d + 'd ' : '') + z(hh) + ':' + z(mm) + ':' + z(ss);
  const countLabel = left === 0 && ok ? '' : 'Ends in';
  return { countdown, countLabel };
}
function startClock() {
  const tick = () => { const v = clockVals(); $('hud-countdown').textContent = v.countdown; $('hud-countlabel').textContent = v.countLabel; };
  tick();
  setInterval(tick, 1000);
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

// ---- input -----------------------------------------------------------------
function bindEvents() {
  $('confirm-name').addEventListener('click', confirmName);
  $('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmName(); } });
  $('got-it').addEventListener('click', gotIt);
  $('btn-undo').addEventListener('click', undo);
  $('btn-restart').addEventListener('click', restart);
  $('next-stage').addEventListener('click', nextStage);
  $('replay-all').addEventListener('click', replayAll);

  const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  document.querySelectorAll('.dpad .pad[data-dir]').forEach((pad) => {
    pad.addEventListener('pointerdown', (e) => { e.preventDefault(); const [dr, dc] = DIRS[pad.dataset.dir]; doMove(dr, dc, pad.dataset.dir); });
  });

  window.addEventListener('keydown', (e) => {
    if (currentScreen !== 'play') return;
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
