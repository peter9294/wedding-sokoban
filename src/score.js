// Score transport (Google Form "auto-filler") + leaderboard reader (gviz JSON).
// Shared by the game (writes) and the leaderboard page (reads).
import { CONFIG, CAN_SUBMIT, CAN_READ } from '../config.js';
import { normName } from './storage.js';

const OUTBOX_KEY = 'sp-outbox-v1';

// --- Outbox (survives reloads; lets us retry silently-failed submits) -------
function readOutbox() {
  try { const r = localStorage.getItem(OUTBOX_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
}
function writeOutbox(list) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

// --- Writing ----------------------------------------------------------------
// One record = one stage clear: { name, solved, stage, session }.
async function postRecord(record) {
  if (!CAN_SUBMIT) return false;
  const e = CONFIG.form.entries;
  const body = new URLSearchParams();
  if (e.name) body.append(e.name, record.name);
  if (e.solved) body.append(e.solved, String(record.solved));
  if (e.stage) body.append(e.stage, String(record.stage));
  if (e.session) body.append(e.session, String(record.session));
  try {
    // no-cors: the response is opaque (we can't read success) — confirmation
    // comes later from read-after-write against the Sheet.
    await fetch(CONFIG.form.actionUrl, { method: 'POST', mode: 'no-cors', keepalive: true, body });
    return true;
  } catch {
    return false;
  }
}

// Queue a stage clear and attempt to send it now. `key` = the distinct-stage id
// so we never enqueue the same clear twice.
export function enqueueScore(record, key) {
  if (!CAN_SUBMIT) return; // scoring not wired up yet — nothing to queue
  const list = readOutbox();
  if (!list.some((x) => x.key === key)) {
    list.push({ key, record, tries: 0, firstAt: Date.now() });
    writeOutbox(list);
  }
  flushOutbox();
}

export async function flushOutbox() {
  if (!CAN_SUBMIT) return;
  const list = readOutbox();
  if (!list.length) return;
  for (const item of list) {
    // light backoff: skip items we've already tried a lot this session
    if (item.tries >= 6) continue;
    item.tries += 1;
    await postRecord(item.record);
  }
  writeOutbox(list);
}

// Remove outbox items we can now SEE in the Sheet (read-after-write ack).
export function confirmSent(rows) {
  const list = readOutbox();
  if (!list.length) return;
  const seen = new Set(rows.map((r) => r.session + '|' + r.stage));
  const remaining = list.filter((it) => !seen.has(it.record.session + '|' + it.record.stage));
  if (remaining.length !== list.length) writeOutbox(remaining);
}

// --- Reading ----------------------------------------------------------------
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
  if (!CAN_READ) throw new Error('not-configured');
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
  const cutoff = CONFIG.leaderboard.cutoff ? new Date(CONFIG.leaderboard.cutoff) : null;

  const byKey = new Map();
  for (const r of rows) {
    if (!r.name) continue;
    const key = normName(r.name);
    if (ignore.has(key)) continue;
    if (cutoff && r.ts && r.ts > cutoff) continue;

    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { name: r.name, solved: r.solved, atRow: r.rowIndex, ts: r.ts });
    } else {
      if (r.solved > cur.solved) { cur.solved = r.solved; cur.atRow = r.rowIndex; cur.ts = r.ts; cur.name = r.name; }
    }
  }

  const list = [...byKey.values()].sort((a, b) => (b.solved - a.solved) || (a.atRow - b.atRow));
  const top = CONFIG.leaderboard.top || 100;
  return list.slice(0, top);
}
