// Leaderboard — interval-fetches the scores sheet and ranks by most stages.
// Two presentations from one page: a compact phone view, and a "big screen" view
// (toggle, or ?tv=1) for the venue projector — top-3 podium, a 4–10 list, and an
// 11–25 grid. Ranking is most distinct stages; ties break by earliest finish.
import { CONFIG, CAN_READ } from '../config.js';
import { fetchSheetRows, buildLeaderboard } from '../src/score.js';

const bodyEl = document.getElementById('lb-body');
const statusEl = document.getElementById('lb-status');
const tvBtn = document.getElementById('tv-toggle');

let timer = null;
let lastGood = null;    // last successfully rendered board
let backoff = 0;        // grows on consecutive errors

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function hhmmss(d) {
  const z = (n) => String(n).padStart(2, '0');
  return z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
}
// Short finish time shown as the tie-break cue, e.g. "9:05 PM".
function fmtTime(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  const h = d.getHours(), m = d.getMinutes();
  return (((h + 11) % 12) + 1) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
}

const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
const nameHtml = (e) => '<span class="nm">' + escapeHtml(e.name) + '</span>' +
  (e.uid ? '<span class="uid">(' + escapeHtml(e.uid) + ')</span>' : '');

function renderBoard(board) {
  if (!board || !board.length) {
    bodyEl.innerHTML = '<div class="lb-empty">No scores yet &mdash; be the first to clear a stage!</div>';
    return;
  }
  // A row is "tied" when another player shares its stage count — show the finish
  // time on those so the ordering (earliest-first) is visible.
  const counts = {};
  board.forEach((e) => { counts[e.solved] = (counts[e.solved] || 0) + 1; });
  const tie = (e) => counts[e.solved] > 1;

  const top3 = board.slice(0, 3);
  const mid = board.slice(3, 10);
  const rest = board.slice(10, 25);

  const podium = '<div class="lb-podium">' + top3.map((e, i) =>
    '<div class="pod pod' + (i + 1) + '">' +
      '<div class="medal">' + medals[i] + '</div>' +
      '<div class="pod-name">' + nameHtml(e) + '</div>' +
      '<div class="pod-score">' + e.solved + '<small>' + (e.solved === 1 ? 'stage' : 'stages') + '</small></div>' +
      (tie(e) ? '<div class="fin">' + fmtTime(e.ts) + '</div>' : '') +
      '<div class="prize">\u{1F381} Prize</div>' +
    '</div>').join('') + '</div>';

  const list = mid.length ? '<div class="lb-list">' + mid.map((e, i) =>
    '<div class="lb-row">' +
      '<div class="rank">' + (i + 4) + '</div>' +
      '<div class="who">' + nameHtml(e) + '</div>' +
      '<span class="fin">' + (tie(e) && e.ts ? fmtTime(e.ts) : '') + '</span>' +
      '<div class="score">' + e.solved + '</div>' +
    '</div>').join('') + '</div>' : '';

  const grid = rest.length ? '<div class="lb-grid">' + rest.map((e, i) =>
    '<div class="cell">' +
      '<span class="rank">' + (i + 11) + '</span>' +
      '<span class="who">' + nameHtml(e) + '</span>' +
      '<span class="score">' + e.solved + '</span>' +
    '</div>').join('') + '</div>' : '';

  bodyEl.innerHTML = podium + list + grid;
}

function setStatus(live, text) {
  statusEl.innerHTML = '<span class="dot' + (live ? ' live' : '') + '"></span>' + escapeHtml(text);
}

async function poll() {
  try {
    const rows = await fetchSheetRows();
    const board = buildLeaderboard(rows);
    lastGood = board;
    renderBoard(board);
    setStatus(true, 'Updated ' + hhmmss(new Date()));
    backoff = 0;
  } catch (e) {
    // Keep the last good board on screen; never blank it on a transient error.
    if (lastGood) { renderBoard(lastGood); setStatus(false, 'Reconnecting…'); }
    else { bodyEl.innerHTML = '<div class="lb-empty">Couldn’t load scores yet. Retrying…</div>'; setStatus(false, 'Reconnecting…'); }
    backoff = Math.min(backoff + 1, 5);
  } finally {
    schedule();
  }
}

function schedule() {
  clearTimeout(timer);
  if (document.hidden) return; // paused; visibilitychange resumes
  const base = CONFIG.leaderboard.pollMs || 15000;
  const jitter = Math.random() * base * 0.4; // spread many clients out so they don't all poll in lockstep
  timer = setTimeout(poll, base * (1 + backoff) + jitter);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(timer);
  else poll();
});

// ---- Big-screen (venue) toggle ----
function setTv(on) {
  document.body.classList.toggle('tv', on);
  if (tvBtn) tvBtn.textContent = on ? '✕ Exit big screen' : '⛶ Big screen';
  try { localStorage.setItem('sp-lb-tv', on ? '1' : '0'); } catch { /* ignore */ }
  if (on && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => { /* user can full-screen manually */ });
  } else if (!on && document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}
if (tvBtn) tvBtn.addEventListener('click', () => setTv(!document.body.classList.contains('tv')));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('tv')) setTv(false); });
// Start in big-screen mode from ?tv=1 (for the venue laptop) or a remembered choice.
(function initTv() {
  let want = new URLSearchParams(location.search).get('tv') === '1';
  if (!want) { try { want = localStorage.getItem('sp-lb-tv') === '1'; } catch { /* ignore */ } }
  if (want) setTv(true);
})();

if (!CAN_READ) {
  bodyEl.innerHTML = '<div class="lb-empty">The leaderboard isn’t connected yet.<br><br>Run the one-time setup (see <b>SETUP.md</b>) and paste the sheet URL into <b>config.js</b>.</div>';
  setStatus(false, 'Not configured');
} else if (!document.hidden) {
  poll();                      // fetch only while the leaderboard page is actually visible
} else {
  setStatus(false, 'Paused');  // opened in a background tab — wait until it's viewed (visibilitychange resumes)
}
