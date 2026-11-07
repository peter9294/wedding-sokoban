// Shared helpers used by both the game and the leaderboard.

// Escape text for safe insertion into HTML (covers element text and attributes).
export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Short, stable tag derived from a session id — shown beside names on the leaderboard
// and revealed in-game so a player can find their own row. Must match on both sides.
export const shortId = (session) => {
  const s = String(session || '').replace(/^s_/, '');
  return s ? s.slice(0, 4).toLowerCase() : '';
};
