/**
 * Fix the missing entry IDs for an ALREADY-created "Something Pushed" form.
 * (Use this if setup.gs printed blank entries / "could not read some entry IDs".)
 *
 * HOW TO RUN:
 *   1. script.google.com → same project (or a new one) → paste this whole file.
 *   2. Run `fixEntries`, approve permissions.
 *   3. View → Logs. Copy the printed block into config.js. Done — no need to
 *      recreate the form or sheet.
 */

var FORM_ID  = '1u650B7SRzz4kILfTj9j6HEIFHcDyPtfwrColQ6gp2CY';
var SHEET_ID = '1Q9lErOhb8RgtX9hOyNxIdb0OLgxdj_Emoe7XlLwbe-w';

function fixEntries() {
  var form = FormApp.openById(FORM_ID);
  var entries = resolveEntries(form);                 // { Name, Solved, Stage, Session } -> 'entry.N'
  var action = form.getPublishedUrl().replace(/viewform.*$/, 'formResponse');

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var respSheet = ss.getSheets().filter(function (s) { return /form responses/i.test(s.getName()); })[0] || ss.getSheets()[ss.getSheets().length - 1];
  var sheetName = respSheet.getName();
  var readUrl = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(sheetName) + '&headers=1';

  // Self-test: post a real response and confirm the row lands.
  var testOk = false;
  try {
    var payload = {};
    if (entries.Name) payload[entries.Name] = 'tester';
    if (entries.Solved) payload[entries.Solved] = '1';
    if (entries.Stage) payload[entries.Stage] = '1';
    if (entries.Session) payload[entries.Session] = 's_fix';
    UrlFetchApp.fetch(action, { method: 'post', payload: payload, muteHttpExceptions: true, followRedirects: true });
    Utilities.sleep(3500);
    var last = respSheet.getLastRow();
    if (last >= 2) {
      var vals = respSheet.getRange(2, 1, last - 1, respSheet.getLastColumn()).getValues();
      testOk = vals.some(function (r) { return r.some(function (c) { return String(c).toLowerCase() === 'tester'; }); });
    }
  } catch (e) {}

  var L = [];
  L.push('\n==================  COPY INTO config.js  ==================');
  L.push("  weddingDate: '2026-12-31T16:00',   // <-- set your real date");
  L.push('  form: {');
  L.push("    actionUrl: '" + action + "',");
  L.push('    entries: {');
  L.push("      name: '" + (entries.Name || '') + "',");
  L.push("      solved: '" + (entries.Solved || '') + "',");
  L.push("      stage: '" + (entries.Stage || '') + "',");
  L.push("      session: '" + (entries.Session || '') + "'");
  L.push('    }');
  L.push('  },');
  L.push('  sheet: {');
  L.push("    readUrl: '" + readUrl + "'");
  L.push('  },');
  L.push('===========================================================');
  L.push('Self-test submission: ' + (testOk ? 'PASSED (a "tester" row appeared — hidden on the board by ignoreNames)' : 'FAILED — if entries above are filled, check the form is accepting responses on a personal Gmail'));
  if (!entries.Name || !entries.Solved) L.push('WARNING: still missing entries — paste me the Apps Script log and I will read them from it.');
  Logger.log(L.join('\n'));
}

// Read entry IDs robustly: fresh items + one prefilled URL, then an HTML fallback.
function resolveEntries(form) {
  var items = form.getItems(FormApp.ItemType.TEXT);
  var out = {};
  try {
    var resp = form.createResponse();
    items.forEach(function (it, i) { resp = resp.withItemResponse(it.asTextItem().createResponse('ZZ' + i + 'ZZ')); });
    var url = resp.toPrefilledUrl();
    items.forEach(function (it, i) { var m = url.match(new RegExp('entry\\.(\\d+)=ZZ' + i + 'ZZ')); if (m) out[it.getTitle()] = 'entry.' + m[1]; });
  } catch (e) {}
  if (items.some(function (it) { return !out[it.getTitle()]; })) {
    try {
      var html = UrlFetchApp.fetch(form.getPublishedUrl(), { muteHttpExceptions: true }).getContentText();
      var re = /"([^"]+)",(?:null|"[^"]*"),\d+,\[\[(\d+)/g, m, byTitle = {};
      while ((m = re.exec(html))) { byTitle[m[1]] = 'entry.' + m[2]; }
      items.forEach(function (it) { if (!out[it.getTitle()] && byTitle[it.getTitle()]) out[it.getTitle()] = byTitle[it.getTitle()]; });
    } catch (e) {}
  }
  Logger.log('resolved entries: ' + JSON.stringify(out));
  return out;
}
