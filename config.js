// ============================================================================
//  Something Pushed — configuration
//  Edit this ONE file to wire up score-saving + the leaderboard, then push.
//  Run apps-script/setup.gs once (see SETUP.md); it prints every value below.
// ============================================================================

export const CONFIG = {
  // Cosmetic ---------------------------------------------------------------
  // Shown on the countdown in the play HUD. Use the real wedding date/time.
  weddingDate: '2026-12-31T16:00',       // ISO local time, e.g. '2026-12-31T16:00'

  // Initials shown above the characters (the couple). One letter each.
  couple: { bride: 'A', groom: 'P' },    // Anna / Peter

  // Levels -----------------------------------------------------------------
  // GitHub Pages caches files ~10 min. Bump this whenever you edit levels.json
  // so players fetch the new version instead of a stale cached copy.
  levelsVersion: '2',

  // Google Form (score saving) --------------------------------------------
  // The form's POST endpoint (the PUBLISHED url, ending in /formResponse):
  //   https://docs.google.com/forms/d/e/1FAIpQL.../formResponse
  // Leave '' to run the game WITHOUT saving scores (local play still works).
  form: {
    actionUrl: '',
    // Field IDs from the form, e.g. 'entry.1234567890'.
    entries: {
      name: '',     // the player's name
      solved: '',   // number of DISTINCT stages they've cleared
      stage: '',    // the stage number they just cleared
      session: ''   // random per-player id (for manual de-duping in the Sheet)
    }
  },

  // Leaderboard (reading scores back) -------------------------------------
  // The responses sheet exposed as gviz JSON (the setup script prints this):
  //   https://docs.google.com/spreadsheets/d/SHEET_ID/gviz/tq?tqx=out:json&sheet=Form%20Responses%201&headers=1
  // Leave '' to show a friendly "leaderboard not configured yet" message.
  sheet: {
    readUrl: ''
  },

  leaderboard: {
    pollMs: 15000,     // how often the leaderboard re-fetches (ms)
    top: 100,          // max rows to display
    // Optional: ignore scores submitted after this moment (keeps the podium
    // stable once the party is over). '' = no cutoff.
    cutoff: '',
    // Names to hide from the board (your test runs, etc.). Case-insensitive.
    ignoreNames: ['test', 'tester']
  }
};

// Convenience flags (don't edit).
export const CAN_SUBMIT = !!(CONFIG.form.actionUrl && CONFIG.form.entries.name && CONFIG.form.entries.solved);
export const CAN_READ = !!CONFIG.sheet.readUrl;
