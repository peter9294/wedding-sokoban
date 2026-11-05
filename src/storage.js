// Local persistence — survives closing the tab (localStorage, not sessionStorage),
// so players resume where they left off. All access is wrapped: Safari private
// mode throws on write, cleared storage returns null, etc.

const KEY = 'sp-game-v1';
const SCHEMA = 1;
const HIST_CAP = 300;

function readRaw() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
function writeRaw(str) {
  try { localStorage.setItem(KEY, str); return true; } catch { return false; }
}

// Grapheme-aware clamp so Thai/emoji names aren't cut mid-cluster.
export function clampName(input, max = 24) {
  const str = String(input == null ? '' : input).trim().replace(/\s+/g, ' ');
  let units;
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      units = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str)].map((s) => s.segment);
    } else {
      units = Array.from(str);
    }
  } catch { units = Array.from(str); }
  return units.slice(0, max).join('');
}

// Normalized identity key for the leaderboard (trim, casefold, collapse spaces).
export function normName(name) {
  return String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function newSessionId() {
  const rnd = (typeof crypto !== 'undefined' && crypto.getRandomValues)
    ? [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')
    : Math.random().toString(16).slice(2) + Date.now().toString(16);
  return 's_' + rnd; // 's_' prefix keeps the Sheet from coercing it to a number
}

function blank() {
  return { v: SCHEMA, name: '', sessionId: '', cleared: [], sentStages: [], current: null, tutorialSeen: false };
}

export function loadProgress() {
  const raw = readRaw();
  if (!raw) return blank();
  let data;
  try { data = JSON.parse(raw); } catch { return blank(); }
  if (!data || typeof data !== 'object') return blank();
  if (data.v !== SCHEMA) {
    // Unknown version: keep only identity + tutorial flag, drop the rest.
    return { ...blank(), name: typeof data.name === 'string' ? data.name : '', sessionId: typeof data.sessionId === 'string' ? data.sessionId : '', tutorialSeen: !!data.tutorialSeen };
  }
  return {
    v: SCHEMA,
    name: typeof data.name === 'string' ? data.name : '',
    sessionId: typeof data.sessionId === 'string' ? data.sessionId : '',
    cleared: Array.isArray(data.cleared) ? data.cleared.filter((x) => typeof x === 'string') : [],
    sentStages: Array.isArray(data.sentStages) ? data.sentStages.filter((x) => typeof x === 'string') : [],
    current: data.current && typeof data.current === 'object' ? data.current : null,
    tutorialSeen: !!data.tutorialSeen
  };
}

export function saveProgress(progress) {
  const p = { ...blank(), ...progress, v: SCHEMA };
  if (p.current && Array.isArray(p.current.hist) && p.current.hist.length > HIST_CAP) {
    p.current = { ...p.current, hist: p.current.hist.slice(-HIST_CAP) };
  }
  // De-dupe the id arrays.
  p.cleared = [...new Set(p.cleared)];
  p.sentStages = [...new Set(p.sentStages)];
  return writeRaw(JSON.stringify(p));
}

export function clearProgress() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
