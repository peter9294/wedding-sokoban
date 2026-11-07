// Score transport (Google Form "auto-filler") + leaderboard reader (gviz JSON).
// Submitting: the game calls submitScore() exactly ONCE, at the moment a stage is
// won, and records that stage in localStorage (see storage.js `sentStages`) so a
// replay or a page reload never submits it again. There is NO interval/retry
// submission — a score goes out only on a win.
import { CONFIG, CAN_SUBMIT } from '../config.js';
import { normName } from './storage.js';

// Fire-and-forget: no-cors responses are opaque (we can't read success), and
// keepalive lets the POST complete even if the tab closes right after the win.
// Scoring is open only before the deadline (CONFIG.weddingDate). After it the game
// stays fully playable but submits nothing, so the leaderboard freezes.
export function scoringOpen() {
  if (!CAN_SUBMIT) return false;
  const d = new Date(CONFIG.weddingDate);
  if (isNaN(d.getTime())) return true; // no valid deadline -> scoring stays open
  return Date.now() < d.getTime();
}

export async function submitScore(record) {
  if (!scoringOpen()) return false;
  const e = CONFIG.form.entries;
  const body = new URLSearchParams();
  if (e.name) body.append(e.name, record.name);
  if (e.solved) body.append(e.solved, String(record.solved));
  if (e.stage) body.append(e.stage, String(record.stage));
  if (e.session) body.append(e.session, String(record.session));
  try {
    await fetch(CONFIG.form.actionUrl, { method: 'POST', mode: 'no-cors', keepalive: true, body });
    return true;
  } catch {
    return false;
  }
}

// --- Reading (leaderboard page only) ---------------------------------------
function parseGvizDate(v) {
  // gviz datetimes arrive as the string "Date(2026,10,5,12,34,56)" (month 0-based,
  // which matches JS Date), in the spreadsheet's timezone.
  if (v == null) return null;
  if (typeof v === 'number') return new Date(v);
  const m = String(v).match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
  if (!m) { const d = new Date(v); return isNaN(d) ? null : d; }
  return new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

function labelIndex(labels, names) {
  for (const n of names) {
    const i = labels.findIndex((l) => l && l.toLowerCase() === n);
    if (i >= 0) return i;
  }
  return -1;
}

// Fetch the responses sheet and return rows in sheet (arrival) order.
export async function fetchSheetRows() {
  if (!CONFIG.sheet.readUrl) throw new Error('not-configured');
  const url = CONFIG.sheet.readUrl + (CONFIG.sheet.readUrl.includes('?') ? '&' : '?') + '_cb=' + Date.now();
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('bad-response');
  const obj = JSON.parse(text.slice(start, end + 1));
  if (obj.status === 'error') {
    const reason = (obj.errors && obj.errors.map((x) => x.detailed_message || x.message).join('; ')) || 'sheet-error';
    throw new Error(reason);
  }
  const table = obj.table || { cols: [], rows: [] };
  const labels = (table.cols || []).map((c) => (c && (c.label || c.id)) || '');
  const iTime = labelIndex(labels, ['timestamp', 'time']);
  const iName = labelIndex(labels, ['name', 'player']);
  const iSolved = labelIndex(labels, ['solved', 'stages', 'score']);
  const iStage = labelIndex(labels, ['stage', 'level']);
  const iSession = labelIndex(labels, ['session', 'sessionid', 'session id']);
  const cell = (row, i) => (i >= 0 && row.c && row.c[i] ? row.c[i].v : null);

  return (table.rows || []).map((row, idx) => ({
    rowIndex: idx,
    ts: parseGvizDate(cell(row, iTime)),
    name: cell(row, iName) == null ? '' : String(cell(row, iName)),
    solved: Number(cell(row, iSolved)) || 0,
    stage: cell(row, iStage) == null ? '' : String(cell(row, iStage)),
    session: cell(row, iSession) == null ? '' : String(cell(row, iSession))
  }));
}

// Rank by MOST DISTINCT STAGES cleared. One row per player (keyed on normalized
// name). Tiebreak = who reached that count first (earliest arrival row).
export function buildLeaderboard(rows) {
  const ignore = new Set((CONFIG.leaderboard.ignoreNames || []).map((n) => normName(n)));
  const cutoffStr = CONFIG.leaderboard.cutoff || CONFIG.weddingDate; // cutoff defaults to the deadline
  const cutoffDate = cutoffStr ? new Date(cutoffStr) : null;
  const cutoff = cutoffDate && !isNaN(cutoffDate.getTime()) ? cutoffDate : null;

  const byKey = new Map();
  for (const r of rows) {
    if (!r.name) continue;
    const nkey = normName(r.name);
    if (ignore.has(nkey)) continue;
    if (cutoff && r.ts && r.ts > cutoff) continue;

    // One row per PLAYER, keyed on the per-device session id — so two people who
    // type the same name stay separate rows. Legacy rows with no session fall back
    // to the name key.
    const key = r.session ? 's:' + r.session : 'n:' + nkey;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { name: r.name, solved: r.solved, atRow: r.rowIndex, ts: r.ts, session: r.session });
    } else if (r.solved > cur.solved) {
      cur.solved = r.solved; cur.atRow = r.rowIndex; cur.ts = r.ts; cur.name = r.name;
    }
  }

  // Rank by most stages; tie-break = who reached that count FIRST (earliest finish).
  const t = (x) => (x.ts instanceof Date && !isNaN(x.ts) ? x.ts.getTime() : Infinity);
  const list = [...byKey.values()].sort((a, b) => (b.solved - a.solved) || (t(a) - t(b)) || (a.atRow - b.atRow));
  const top = CONFIG.leaderboard.top || 100;
  return list.slice(0, top).map((e) => ({ ...e, uid: shortId(e.session) }));
}

// A short, stable tag shown faintly beside the name so two players with the same
// name can be told apart (same device -> same tag). Derived from the session id.
function shortId(session) {
  const s = String(session || '').replace(/^s_/, '');
  return s ? s.slice(0, 4).toLowerCase() : '';
}
