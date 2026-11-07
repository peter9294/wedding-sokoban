// Shared helpers used by both the game and the leaderboard.

// Escape text for safe insertion into HTML (covers element text and attributes).
export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
