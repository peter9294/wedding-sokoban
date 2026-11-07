/**
 * Something Pushed — reset the leaderboard in one click.
 *
 * ONE-TIME SETUP:
 *   1. Go to https://script.google.com and open the project that holds setup.gs
 *      (the one that created your form + responses sheet).
 *   2. Either paste this whole function below your existing code, OR add a new
 *      file (＋ next to "Files" → Script) and paste it there. Save.
 *
 * TO RESET THE SCORES (anytime after that):
 *   - Pick `clearScores` from the function dropdown at the top.
 *   - Press Run. (First run asks for permission — approve it.)
 *   - The leaderboard empties on its next refresh (within ~15s of a reload).
 *
 * It deletes every score row but KEEPS the header, and saves a timestamped
 * backup tab first — so a reset is undoable. Delete old "Backup ..." tabs
 * whenever you like.
 */

// Your responses spreadsheet (from config.js sheet.readUrl). Leave as-is.
var SCORES_SHEET_ID = '1Q9lErOhb8RgtX9hOyNxIdb0OLgxdj_Emoe7XlLwbe-w';

function clearScores() {
  var ss = SpreadsheetApp.openById(SCORES_SHEET_ID);
  var sheet = ss.getSheetByName('Form responses 1') || ss.getSheets()[0];
  var last = sheet.getLastRow();
  if (last < 2) { Logger.log('Leaderboard is already empty — nothing to clear.'); return; }

  // Safety backup first (a full copy of the current responses).
  var stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH-mm');
  sheet.copyTo(ss).setName('Backup ' + stamp);

  // Clear the data rows, keep row 1 (the column headers).
  sheet.deleteRows(2, last - 1);
  Logger.log('Cleared ' + (last - 1) + ' score row(s). Backup saved as "Backup ' + stamp + '".');
}
