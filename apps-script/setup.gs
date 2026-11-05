/**
 * Something Pushed — one-time score backend setup.
 *
 * HOW TO RUN (takes ~15 seconds, see SETUP.md for screenshots-in-words):
 *   1. Go to https://script.google.com  (signed in with a PERSONAL Gmail —
 *      Workspace/work accounts often block public sharing + anonymous form posts).
 *   2. New project → delete the sample code → paste this whole file.
 *   3. Press Run, choose the `setup` function, and approve the permissions.
 *   4. Open "Execution log" (View → Logs). It prints a config block — copy the
 *      4 values into config.js in the game repo, commit, and push.
 *
 * Re-running creates a NEW form+sheet each time; just use the latest log.
 */

var TIMEZONE = 'Asia/Bangkok';   // responses sheet timezone (affects the cutoff filter)
var TITLE    = 'Something Pushed — Scores';

function setup() {
  // --- 1. Create the form -------------------------------------------------
  var form = FormApp.create(TITLE);
  form.setDescription('Auto-filled by the Something Pushed game. Do not edit the questions.');

  // One short-answer question per field, in this exact order.
  var qName    = form.addTextItem().setTitle('Name').setRequired(false);
  var qSolved  = form.addTextItem().setTitle('Solved').setRequired(false);
  var qStage   = form.addTextItem().setTitle('Stage').setRequired(false);
  var qSession = form.addTextItem().setTitle('Session').setRequired(false);

  // Harden the settings that silently reject anonymous posts.
  form.setAcceptingResponses(true);
  tryDo(function () { form.setCollectEmail(false); });
  tryDo(function () { form.setLimitOneResponsePerUser(false); });
  tryDo(function () { form.setRequireLogin(false); });          // throws on consumer Gmail (already off)
  tryDo(function () { form.setAllowResponseEdits(false); });
  tryDo(function () { form.setShowLinkToRespondAgain(false); });
  tryDo(function () { form.setProgressBar(false); });

  // --- 2. Create + link the responses spreadsheet -------------------------
  var ss = SpreadsheetApp.create(TITLE + ' (Responses)');
  ss.setSpreadsheetTimeZone(TIMEZONE);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  // The "Form Responses 1" tab is created asynchronously — wait for it.
  var sheetName = waitForResponseSheet(ss);

  // Make the sheet readable by the leaderboard (anonymous, CORS-friendly gviz).
  var shared = true;
  try {
    DriveApp.getFileById(ss.getId()).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    shared = false;
  }

  // --- 3. Derive the URLs + entry IDs the game needs ----------------------
  var viewUrl = form.getPublishedUrl();                 // .../viewform
  var actionUrl = viewUrl.replace(/viewform.*$/, 'formResponse');
  var e = resolveEntries(form); // fresh item refs -> entry IDs, keyed by question title
  var entries = { name: e.Name || '', solved: e.Solved || '', stage: e.Stage || '', session: e.Session || '' };
  var readUrl = 'https://docs.google.com/spreadsheets/d/' + ss.getId() +
    '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(sheetName) + '&headers=1';

  // --- 4. Self-test: post a real response and confirm the row lands -------
  var testOk = selfTest(actionUrl, entries, ss, sheetName);

  // --- 5. Print the config block ------------------------------------------
  var lines = [];
  lines.push('');
  lines.push('==================  COPY INTO config.js  ==================');
  lines.push("  weddingDate: '2026-12-31T16:00',   // <-- set your real date");
  lines.push('  form: {');
  lines.push("    actionUrl: '" + actionUrl + "',");
  lines.push('    entries: {');
  lines.push("      name: '" + entries.name + "',");
  lines.push("      solved: '" + entries.solved + "',");
  lines.push("      stage: '" + entries.stage + "',");
  lines.push("      session: '" + entries.session + "'");
  lines.push('    }');
  lines.push('  },');
  lines.push('  sheet: {');
  lines.push("    readUrl: '" + readUrl + "'");
  lines.push('  },');
  lines.push('===========================================================');
  lines.push('');
  lines.push('Form (edit/preview):  ' + form.getEditUrl());
  lines.push('Responses sheet:      ' + ss.getUrl());
  lines.push('Public sharing set:   ' + (shared ? 'YES' : 'NO — set the sheet to "Anyone with the link: Viewer" by hand'));
  lines.push('Self-test submission: ' + (testOk ? 'PASSED (a test row appeared — it is hidden on the leaderboard by ignoreNames)' : 'FAILED — see SETUP.md troubleshooting'));
  if (!entries.name || !entries.solved) lines.push('WARNING: could not read some entry IDs — re-run setup.');
  Logger.log(lines.join('\n'));
}

function tryDo(fn) { try { fn(); } catch (e) { /* not supported on this account — ignore */ } }

// Read entry IDs robustly: re-fetch items FRESH (refs captured before setDestination
// can go stale), read all IDs from one prefilled URL, then fall back to the form's
// published HTML for any still missing. Returns { <title>: 'entry.N' }.
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
  return out;
}

function waitForResponseSheet(ss) {
  for (var i = 0; i < 10; i++) {
    var sheets = ss.getSheets();
    for (var j = 0; j < sheets.length; j++) {
      var n = sheets[j].getName();
      if (n.indexOf('Form Responses') === 0 || n.indexOf('Form responses') === 0) return n;
    }
    Utilities.sleep(1000);
  }
  // Fallback: last sheet (destination sheet is appended).
  var all = ss.getSheets();
  return all[all.length - 1].getName();
}

function selfTest(actionUrl, entries, ss, sheetName) {
  try {
    var payload = {};
    if (entries.name) payload[entries.name] = 'tester';
    if (entries.solved) payload[entries.solved] = '1';
    if (entries.stage) payload[entries.stage] = '1';
    if (entries.session) payload[entries.session] = 's_setup';
    UrlFetchApp.fetch(actionUrl, { method: 'post', payload: payload, muteHttpExceptions: true, followRedirects: true });
    Utilities.sleep(3500);
    var sh = ss.getSheetByName(sheetName);
    if (!sh) return false;
    var last = sh.getLastRow();
    if (last < 2) return false;
    var values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
    for (var i = 0; i < values.length; i++) {
      for (var k = 0; k < values[i].length; k++) {
        if (String(values[i][k]).toLowerCase() === 'tester') return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}
