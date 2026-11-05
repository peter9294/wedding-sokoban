// Leaderboard — interval-fetches the scores sheet and ranks by most stages.
import { CONFIG, CAN_READ } from '../config.js';
import { fetchSheetRows, buildLeaderboard } from '../src/score.js';

const bodyEl = document.getElementById('lb-body');
const statusEl = document.getElementById('lb-status');

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

function renderBoard(board) {
  if (!board || !board.length) {
    bodyEl.innerHTML = '<div class="lb-empty">No scores yet &mdash; be the first to clear a stage!</div>';
    return;
  }
  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
  bodyEl.innerHTML = board.map((e, i) => {
    const topCls = i < 3 ? ' top' + (i + 1) : '';
    const rank = i < 3 ? '<span class="medal">' + medals[i] + '</span>' : (i + 1);
    const s = e.solved;
    return (
      '<div class="lb-row' + topCls + '">' +
        '<div class="rank">' + rank + '</div>' +
        '<div class="who">' + escapeHtml(e.name) + '</div>' +
        '<div class="score">' + s + '<small>' + (s === 1 ? 'stage' : 'stages') + '</small></div>' +
      '</div>'
    );
  }).join('');
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

if (!CAN_READ) {
  bodyEl.innerHTML = '<div class="lb-empty">The leaderboard isn’t connected yet.<br><br>Run the one-time setup (see <b>SETUP.md</b>) and paste the sheet URL into <b>config.js</b>.</div>';
  setStatus(false, 'Not configured');
} else if (!document.hidden) {
  poll();                      // fetch only while the leaderboard page is actually visible
} else {
  setStatus(false, 'Paused');  // opened in a background tab — wait until it's viewed (visibilitychange resumes)
}
