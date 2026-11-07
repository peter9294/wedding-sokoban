// ============================================================================
//  Something Pushed — configuration
//  Edit this ONE file to wire up score-saving + the leaderboard, then push.
//  Run apps-script/setup.gs once (see SETUP.md); it prints every value below.
// ============================================================================

export const CONFIG = {
  // Deadline ---------------------------------------------------------------
  // The game's end time. Drives the "Ends in" countdown AND the cutoff: after this
  // moment the game STOPS submitting scores (still fully playable) and the leaderboard
  // freezes. ISO local time, in the players' timezone.
  weddingDate: '2026-11-08T21:00',       // Nov 8, 9:00 PM

  // Fresh start for the event. Any saved progress that was STARTED before this
  // moment is cleared the next time the player opens the game at/after it — so
  // everyone begins clean when the party starts. Sessions started at/after this
  // time are kept (only the in-game "Start over" clears those). Local time.
  freshStartAt: '2026-11-08T19:00',      // Nov 8, 7:00 PM

  // Initials shown above the characters (the couple). One letter each.
  couple: { bride: 'A', groom: 'P' },    // Anna / Peter

  // Levels -----------------------------------------------------------------
  // GitHub Pages caches files ~10 min. Bump this whenever you edit levels.json
  // so players fetch the new version instead of a stale cached copy.
  levelsVersion: '5',

  // Google Form (score saving) --------------------------------------------
  // The form's POST endpoint (the PUBLISHED url, ending in /formResponse):
  //   https://docs.google.com/forms/d/e/1FAIpQL.../formResponse
  // Leave '' to run the game WITHOUT saving scores (local play still works).
  form: {
    actionUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSdkAJcKblDam7ApLsBe1o38-dKbSRSKKMG9RloZMhh9uMLx7w/formResponse',
    // Field IDs from the form, e.g. 'entry.1234567890'.
    entries: {
      name: 'entry.1798356637',     // the player's name
      solved: 'entry.177947520',    // number of DISTINCT stages they've cleared
      stage: 'entry.1780119524',    // the stage number they just cleared
      session: 'entry.1193715062'   // random per-player id (for manual de-duping in the Sheet)
    }
  },

  // Leaderboard (reading scores back) -------------------------------------
  // The responses sheet exposed as gviz JSON (the setup script prints this):
  //   https://docs.google.com/spreadsheets/d/SHEET_ID/gviz/tq?tqx=out:json&sheet=Form%20Responses%201&headers=1
  // Leave '' to show a friendly "leaderboard not configured yet" message.
  sheet: {
    readUrl: 'https://docs.google.com/spreadsheets/d/1Q9lErOhb8RgtX9hOyNxIdb0OLgxdj_Emoe7XlLwbe-w/gviz/tq?tqx=out:json&sheet=Form%20responses%201&headers=1'
  },

  leaderboard: {
    pollMs: 15000,     // how often the leaderboard re-fetches (ms)
    top: 100,          // max rows to display
    // Ignore scores submitted after this moment. '' = use weddingDate (the deadline above).
    cutoff: '',
    // Names to hide from the board (your test runs, etc.). Case-insensitive.
    ignoreNames: ['test', 'tester']
  }
};

// Convenience flags (don't edit).
export const CAN_SUBMIT = !!(CONFIG.form.actionUrl && CONFIG.form.entries.name && CONFIG.form.entries.solved);
export const CAN_READ = !!CONFIG.sheet.readUrl;
