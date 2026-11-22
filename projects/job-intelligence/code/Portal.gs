/**
 * Job Intelligence Portal: web app backend.
 *
 * Needs JobMonitor.gs (v3.1) in the same Apps Script project; it reuses its sheet helpers, settings,
 * locks and rule logic. The Google Sheet stays the only database: the portal reads the Jobs tab,
 * writes edits back to the matching row by Job ID (never by row number), and logs every change in
 * the Activity Log tab.
 *
 * Deploy: Deploy > New deployment > Web app. Execute as: Me. Who has access: Only myself.
 */

const PORTAL = {
  PAGE_SIZE: 25,
  EDITABLE: {
    status: 'Application Status', applicationDate: 'Application Date', followUp: 'Next Follow-up',
    notes: 'Notes', skipReason: 'Skip Reason', remarks: 'Remarks'
  },
  DATE_FIELDS: ['applicationDate', 'followUp'],
  VIEWS: ['today', 'week', 'month', 'all', 'saved', 'applied', 'interviews', 'closed', 'skipped', 'review']
};

// =============================================================================================
// Web app entry points
// =============================================================================================
function doGet(e) {
  portalGuard_();
  savePortalUrl_();
  const t = HtmlService.createTemplateFromFile('Index');
  t.initialJob = String((e && e.parameter && e.parameter.job) || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
  return t.evaluate()
    .setTitle('Job Intelligence Portal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Used by Index.html to pull in Styles.html and App.html. */
function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Only the owner of the script may use the portal (in addition to the "Only myself" deployment). */
function portalGuard_() {
  let me = '', who = '';
  try { me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) {}
  try { who = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) {}
  if (who && me && who !== me) throw new Error('Access denied. This portal is private.');
}

function savePortalUrl_() {
  try {
    const url = ScriptApp.getService().getUrl();
    if (!url) return;
    const ss = ss_();
    if (readSettings_(ss).portalUrl !== url) setSetting_(ss, 'Portal URL', url);
  } catch (e) { /* not deployed yet, or running from the editor */ }
}

function setSetting_(ss, name, value) {
  const sh = ss.getSheetByName(CFG.SHEET_SETTINGS);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === name) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
  const def = SETTING_DEFAULTS.find(d => d[0] === name);
  sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([[name, value, def ? def[2] : '']]);
}

// =============================================================================================
// Reading jobs
// =============================================================================================
/** Reads the Jobs tab. withDesc = false skips the (large) Job Description column when it is last. */
function readJobs_(ss, withDesc) {
  const sh = ss.getSheetByName(CFG.SHEET_JOBS);
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, Math.max(1, lastCol)).getValues()[0].map(h => String(h).trim());
  const idx = {};
  headers.forEach((h, i) => { if (h && idx[h] == null) idx[h] = i; });
  if (lastRow < 2) return { sh, headers, idx, rows: [] };
  const descCol = idx['Job Description'];
  const width = (!withDesc && descCol === headers.length - 1) ? headers.length - 1 : headers.length;
  const rows = sh.getRange(2, 1, lastRow - 1, width).getValues();
  return { sh, headers, idx, rows: rows.filter(r => r[idx['Job Key']]) };
}

function iso_(v) { return v instanceof Date && !isNaN(v) ? v.toISOString() : (v == null ? '' : String(v)); }

function normStatus_(v) {
  const s = String(v || '').trim();
  if (!s || s === 'Reviewing') return 'New';
  return STATUS_OPTIONS.indexOf(s) >= 0 ? s : s;
}

function eligGroup_(v) {
  const s = String(v || '');
  if (/^Blocked/.test(s)) return 'Blocked';
  if (/^OK/.test(s)) return 'Eligible';
  if (/^Needs Review|^Unknown|check wording|^Not checked/.test(s)) return 'Needs Review';
  return s || 'Needs Review';
}

function toItem_(r, J) {
  const g = h => (J[h] == null ? '' : r[J[h]]);
  const key = String(g('Job Key'));
  return {
    id: String(g('Job ID') || jobId_(key)), key,
    title: String(g('Job Title')), company: String(g('Company')), location: String(g('Location')),
    url: String(g('Job URL')), posted: iso_(g('Posting Date')), firstSeen: iso_(g('First Seen (ET)')), lastSeen: iso_(g('Last Seen (ET)')),
    status: normStatus_(g('Application Status')), eligibility: String(g('Eligibility') || 'Needs Review'), eligGroup: eligGroup_(g('Eligibility')),
    evidence: String(g('Eligibility Evidence')), match: String(g('Match Result')), score: Number(g('Match Score')) || 0,
    terms: String(g('Matched Terms')), salary: String(g('Salary')), salaryMin: Number(g('Salary Min')) || 0, salaryMax: Number(g('Salary Max')) || 0,
    workMode: String(g('Work Mode') || workMode_({ location: g('Location'), title: g('Job Title'), desc: g('Job Description Snippet') })),
    platform: String(g('Source Platform')), sourceFeed: String(g('Source Feed')), category: String(g('Category')), priority: String(g('Priority')),
    stillOpen: String(g('Still Open') || 'Yes'), closing: iso_(g('Closing Date')), type: String(g('Job Type')),
    applicationDate: iso_(g('Application Date')), followUp: iso_(g('Next Follow-up')), notes: String(g('Notes')),
    skipReason: String(g('Skip Reason')), remarks: String(g('Remarks')), feedbackRule: String(g('Feedback Rule')),
    alert: String(g('Alert Sent')), decisionDate: iso_(g('Decision Date')), updatedAt: iso_(g('Updated At')),
    snippet: String(g('Job Description Snippet'))
  };
}

function viewTest_(view, it, now, tz) {
  const t = Date.parse(it.firstSeen) || 0;
  const dayStart = startOfDay_(now, tz);
  switch (view) {
    case 'today': return t >= dayStart;
    case 'week': return t >= now - 7 * 864e5;
    case 'month': return t >= now - 30 * 864e5;
    case 'saved': return it.status === 'Saved';
    case 'applied': return it.status === 'Applied';
    case 'interviews': return it.status === 'Interview' || it.status === 'Offer';
    case 'closed': return it.status === 'Rejected' || it.status === 'Closed';
    case 'skipped': return it.status === 'Skipped';
    case 'review': return it.eligGroup === 'Needs Review' && isMatch_(it) && ['Skipped', 'Rejected', 'Closed'].indexOf(it.status) < 0;
    default: return true;
  }
}

/** Discovery views show real matches that are not blocked; status views show everything you acted on. */
function isMatch_(it) { return /^(Match|Location unknown|Possible duplicate)$/.test(it.match); }
function defaultVisible_(view, it) {
  if (['saved', 'applied', 'interviews', 'closed', 'skipped'].indexOf(view) >= 0) return true;
  return isMatch_(it) && it.eligGroup !== 'Blocked';
}

function startOfDay_(now, tz) {
  const d = Utilities.formatDate(new Date(now), tz || 'America/New_York', 'yyyy-MM-dd');
  const off = Utilities.formatDate(new Date(now), tz || 'America/New_York', 'Z'); // e.g. -0500
  return Date.parse(d + 'T00:00:00' + off.slice(0, 3) + ':' + off.slice(3));
}

// =============================================================================================
// API: bootstrap, search, detail
// =============================================================================================
function api_bootstrap() {
  portalGuard_();
  const ss = ss_();
  ensureStructure_(ss, false);
  const s = readSettings_(ss);
  const data = readJobs_(ss, false);
  const items = data.rows.map(r => toItem_(r, data.idx));
  const now = Date.now();
  const counts = {};
  PORTAL.VIEWS.forEach(v => { counts[v] = items.filter(it => viewTest_(v, it, now, s.tz) && defaultVisible_(v, it)).length; });

  const tally = (arr, f) => arr.reduce((m, x) => { const k = f(x); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
  const top = (obj, n) => Object.keys(obj).map(k => ({ k, n: obj[k] })).sort((a, b) => b.n - a.n).slice(0, n);
  const matches = items.filter(it => isMatch_(it) && it.eligGroup !== 'Blocked');
  // Jobs discovered per day, last 30 days
  const perDay = [];
  for (let i = 29; i >= 0; i--) {
    const d = Utilities.formatDate(new Date(now - i * 864e5), s.tz, 'yyyy-MM-dd');
    perDay.push({ d, all: 0, matches: 0 });
  }
  const dayIdx = {};
  perDay.forEach((p, i) => dayIdx[p.d] = i);
  items.forEach(it => {
    const t = Date.parse(it.firstSeen);
    if (!t) return;
    const k = Utilities.formatDate(new Date(t), s.tz, 'yyyy-MM-dd');
    if (dayIdx[k] == null) return;
    perDay[dayIdx[k]].all++;
    if (isMatch_(it) && it.eligGroup !== 'Blocked') perDay[dayIdx[k]].matches++;
  });
  // Applications per week, last 12 weeks
  const perWeek = [];
  for (let w = 11; w >= 0; w--) perWeek.push({ start: now - (w + 1) * 7 * 864e5, end: now - w * 7 * 864e5, n: 0 });
  items.forEach(it => {
    const t = Date.parse(it.applicationDate);
    if (!t) return;
    perWeek.forEach(p => { if (t > p.start && t <= p.end) p.n++; });
  });

  const comp = table_(ss.getSheetByName(CFG.SHEET_COMPANIES)), C = comp.idx;
  const enabled = comp.rows.filter(r => bool_(r[C['Enabled']], false));
  const logSh = ss.getSheetByName(CFG.SHEET_LOG);
  const logRows = logSh.getLastRow() > 1 ? logSh.getRange(Math.max(2, logSh.getLastRow() - 199), 1, Math.min(200, logSh.getLastRow() - 1), 6).getValues() : [];
  const lastRun = logRows.filter(r => r[1] === '(run summary)').pop();
  const recentErrors = logRows.filter(r => r[2] === 'Error').slice(-10).reverse().map(r => ({ at: iso_(r[0]), company: r[1], error: r[5] }));

  return {
    version: CFG.VERSION, sheetUrl: ss.getUrl(), portalUrl: s.portalUrl, tz: s.tz,
    counts, total: items.length,
    stats: {
      matchesAll: matches.length,
      openMatches: matches.filter(it => it.stillOpen === 'Yes' && it.status === 'New').length,
      applied: items.filter(it => it.status === 'Applied').length,
      interviews: items.filter(it => it.status === 'Interview' || it.status === 'Offer').length,
      followUpsDue: items.filter(it => it.followUp && Date.parse(it.followUp) <= now + 864e5 && ['Applied', 'Interview', 'Saved'].indexOf(it.status) >= 0).length,
      blocked: items.filter(it => it.eligGroup === 'Blocked').length
    },
    charts: {
      perDay,
      perWeek: perWeek.map(p => ({ d: Utilities.formatDate(new Date(p.end), s.tz, 'MMM d'), n: p.n })),
      status: top(tally(items.filter(it => it.status !== 'New' || isMatch_(it)), it => it.status), 8),
      eligibility: top(tally(items.filter(isMatch_), it => it.eligGroup), 5),
      topOrgs: top(tally(matches, it => it.company), 10),
      categories: top(tally(matches, it => it.category || 'Other'), 10)
    },
    facets: {
      companies: Object.keys(tally(items, it => it.company)).sort(),
      platforms: Object.keys(tally(items, it => it.platform)).sort(),
      categories: Object.keys(tally(items, it => it.category)).sort(),
      statuses: STATUS_OPTIONS, skipReasons: SKIP_REASONS,
      eligibility: ['Eligible', 'Needs Review', 'Blocked'], workModes: ['Remote', 'Hybrid', 'On-site']
    },
    health: {
      orgsTotal: comp.rows.length, orgsEnabled: enabled.length,
      orgsWithErrors: enabled.filter(r => String(r[C['Last Error']] || '').trim()).length,
      lastRun: lastRun ? { at: iso_(lastRun[0]), checked: lastRun[3], result: lastRun[4], errors: lastRun[5] } : null,
      recentErrors
    },
    settings: {
      alertMode: s.alertMode, dailyHour: s.dailyHour, interval: s.interval, recipient: s.recipient,
      minScore: s.minScore, maxAge: s.maxAge, allowUnknown: s.allowUnknown, instantMinScore: s.instantMinScore, sendAlerts: s.sendAlerts
    },
    pendingRules: countPendingRules_(ss)
  };
}

/**
 * q: { view, text, inDesc, org, location, workMode, discFrom, discTo, postFrom, postTo, salaryMin,
 *      eligibility, status, source, category, showAll, sort, page }
 */
function api_search(q) {
  portalGuard_();
  q = q || {};
  const ss = ss_();
  const s = readSettings_(ss);
  const data = readJobs_(ss, !!q.inDesc && !!q.text);
  const J = data.idx;
  const now = Date.now();
  const view = PORTAL.VIEWS.indexOf(q.view) >= 0 ? q.view : 'week';
  const tokens = String(q.text || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const loc = String(q.location || '').toLowerCase().trim();
  const dt = (v, end) => { if (!v) return null; const t = Date.parse(v + (end ? 'T23:59:59' : 'T00:00:00')); return isNaN(t) ? null : t; };
  const dF = dt(q.discFrom), dT = dt(q.discTo, true), pF = dt(q.postFrom), pT = dt(q.postTo, true);
  const minSal = Number(q.salaryMin) || 0;

  let out = [];
  data.rows.forEach(r => {
    const it = toItem_(r, J);
    if (!viewTest_(view, it, now, s.tz)) return;
    if (!q.showAll && !q.eligibility && !defaultVisible_(view, it)) return;
    if (q.eligibility && it.eligGroup !== q.eligibility) return;
    if (q.status && it.status !== q.status) return;
    if (q.org && it.company !== q.org) return;
    if (q.source && it.platform !== q.source) return;
    if (q.category && it.category !== q.category) return;
    if (q.workMode && it.workMode !== q.workMode) return;
    if (loc && it.location.toLowerCase().indexOf(loc) < 0) return;
    const fs = Date.parse(it.firstSeen) || 0, ps = Date.parse(it.posted) || 0;
    if (dF && fs < dF) return; if (dT && fs > dT) return;
    if (pF && (!ps || ps < pF)) return; if (pT && (!ps || ps > pT)) return;
    if (minSal && !(it.salaryMax >= minSal || it.salaryMin >= minSal)) return;
    if (tokens.length) {
      const hay = (it.title + ' ' + it.company + ' ' + it.location + ' ' + it.terms + ' ' + it.snippet + ' ' +
        (q.inDesc && J['Job Description'] != null ? String(r[J['Job Description']] || '') : '')).toLowerCase();
      if (!tokens.every(tk => hay.indexOf(tk) >= 0)) return;
    }
    delete it.snippet;
    out.push(it);
  });
  const sorters = {
    discovered: (a, b) => (Date.parse(b.firstSeen) || 0) - (Date.parse(a.firstSeen) || 0),
    posted: (a, b) => (Date.parse(b.posted) || 0) - (Date.parse(a.posted) || 0),
    score: (a, b) => b.score - a.score || (Date.parse(b.firstSeen) || 0) - (Date.parse(a.firstSeen) || 0),
    salary: (a, b) => (b.salaryMax || b.salaryMin) - (a.salaryMax || a.salaryMin),
    followUp: (a, b) => (Date.parse(a.followUp) || 9e15) - (Date.parse(b.followUp) || 9e15)
  };
  out.sort(sorters[q.sort] || sorters.discovered);
  const page = Math.max(0, Number(q.page) || 0);
  const total = out.length;
  out = out.slice(page * PORTAL.PAGE_SIZE, (page + 1) * PORTAL.PAGE_SIZE);
  return { items: out, total, page, pageSize: PORTAL.PAGE_SIZE, hasMore: (page + 1) * PORTAL.PAGE_SIZE < total };
}

function findRow_(sh, idx, jobId) {
  const last = sh.getLastRow();
  if (last < 2 || idx['Job ID'] == null) return -1;
  const ids = sh.getRange(2, idx['Job ID'] + 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === jobId) return i + 2;
  return -1;
}

function readRowItem_(sh, headers, idx, rowNum) {
  const r = sh.getRange(rowNum, 1, 1, headers.length).getValues()[0];
  const it = toItem_(r, idx);
  it.description = idx['Job Description'] != null ? String(r[idx['Job Description']] || '') : '';
  if (!it.description) it.description = it.snippet;
  return { row: r, item: it };
}

function api_getJob(jobId) {
  portalGuard_();
  const ss = ss_();
  ensureStructure_(ss, false);
  const sh = ss.getSheetByName(CFG.SHEET_JOBS);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const idx = {};
  headers.forEach((h, i) => { if (h && idx[h] == null) idx[h] = i; });
  const rowNum = findRow_(sh, idx, String(jobId));
  if (rowNum < 0) return { notFound: true };
  const it = readRowItem_(sh, headers, idx, rowNum).item;
  it.history = activityFor_(ss, it.id);
  return it;
}

function activityFor_(ss, jobId) {
  const sh = ss.getSheetByName(CFG.SHEET_ACTIVITY);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, ACTIVITY_HEADERS.length).getValues()
    .filter(r => String(r[1]) === jobId).slice(-50).reverse()
    .map(r => ({ at: iso_(r[0]), field: r[3], from: iso_(r[4]), to: iso_(r[5]), source: r[6] }));
}

// =============================================================================================
// API: updates
// =============================================================================================
/**
 * Saves edits for one job. changes: { status, applicationDate, followUp, notes, skipReason, remarks }.
 * expectedUpdatedAt: the Updated At value the browser last saw. If someone (or a scheduled run) changed
 * the row since, nothing is written and { conflict: true, job } is returned so the page can refresh.
 */
function api_updateJob(jobId, changes, expectedUpdatedAt) {
  portalGuard_();
  changes = changes || {};
  const ss = ss_();
  return withDocLock_(() => {
    const sh = ss.getSheetByName(CFG.SHEET_JOBS);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const idx = {};
    headers.forEach((h, i) => { if (h && idx[h] == null) idx[h] = i; });
    const rowNum = findRow_(sh, idx, String(jobId));
    if (rowNum < 0) return { notFound: true };
    const cur = readRowItem_(sh, headers, idx, rowNum);
    if (expectedUpdatedAt && cur.item.updatedAt && cur.item.updatedAt !== expectedUpdatedAt) {
      cur.item.history = activityFor_(ss, cur.item.id);
      return { conflict: true, job: cur.item };
    }
    const now = new Date();
    const writes = {};   // header -> value
    const log = [];
    Object.keys(PORTAL.EDITABLE).forEach(k => {
      if (!(k in changes)) return;
      const h = PORTAL.EDITABLE[k];
      if (idx[h] == null) return;
      let v = changes[k] == null ? '' : changes[k];
      if (k === 'status' && STATUS_OPTIONS.indexOf(String(v)) < 0) throw new Error('Unknown status: ' + v);
      if (k === 'skipReason' && v && SKIP_REASONS.indexOf(String(v)) < 0) throw new Error('Unknown skip reason: ' + v);
      if (PORTAL.DATE_FIELDS.indexOf(k) >= 0) v = parseDay_(v);
      else v = String(v).slice(0, 5000);
      const old = cur.row[idx[h]];
      const same = (old instanceof Date && v instanceof Date) ? old.getTime() === v.getTime() : String(old == null ? '' : iso_(old)) === String(iso_(v));
      if (same) return;
      writes[h] = v;
      log.push([now, cur.item.id, cur.item.key, h, iso_(old), iso_(v), 'Portal']);
    });
    if ('Application Status' in writes) {
      if (idx['Decision Date'] != null) writes['Decision Date'] = now;
      if (writes['Application Status'] === 'Applied' && idx['Application Date'] != null && !cur.row[idx['Application Date']] && !('Application Date' in writes)) {
        writes['Application Date'] = parseDay_(Utilities.formatDate(now, readSettings_(ss).tz, 'yyyy-MM-dd'));
        log.push([now, cur.item.id, cur.item.key, 'Application Date', '', iso_(writes['Application Date']), 'Portal (auto)']);
      }
    }
    let proposal = null;
    const newStatus = writes['Application Status'] || cur.item.status;
    const newReason = 'Skip Reason' in writes ? writes['Skip Reason'] : cur.item.skipReason;
    if (newStatus === 'Skipped' && newReason && !String(cur.item.feedbackRule || '').trim() && ('Skip Reason' in writes || 'Application Status' in writes || 'Remarks' in writes)) {
      const prop = proposeRuleFor_({ skipReason: newReason, remarks: 'Remarks' in writes ? writes['Remarks'] : cur.item.remarks, title: cur.item.title, company: cur.item.company, location: cur.item.location });
      if (prop) {
        const id = addProposedRule_(ss, prop, cur.item.key, newReason);
        writes['Feedback Rule'] = 'Proposed ' + id;
        proposal = Object.assign({ id }, prop);
      } else if (idx['Feedback Rule'] != null) writes['Feedback Rule'] = 'No rule (reason saved)';
    }
    if (!Object.keys(writes).length) { cur.item.history = activityFor_(ss, cur.item.id); return { ok: true, job: cur.item, unchanged: true }; }
    writes['Updated At'] = now;
    Object.keys(writes).forEach(h => { if (idx[h] != null) sh.getRange(rowNum, idx[h] + 1).setValue(writes[h]); });
    logActivity_(ss, log);
    const after = readRowItem_(sh, headers, idx, rowNum).item;
    after.history = activityFor_(ss, after.id);
    return { ok: true, job: after, proposal };
  });
}

/** "2026-11-21" -> Date at local midnight; blank -> '' */
function parseDay_(v) {
  if (!v) return '';
  if (v instanceof Date) return v;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error('Dates must look like 2026-11-21');
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Quick status change for several jobs at once (for example: Save, Skip, Close). */
function api_bulkStatus(jobIds, status) {
  portalGuard_();
  const res = [];
  (jobIds || []).slice(0, 100).forEach(id => {
    try { res.push(Object.assign({ id }, api_updateJob(id, { status }, null))); } catch (e) { res.push({ id, error: String(e.message || e) }); }
  });
  return res.map(r => ({ id: r.id, ok: !!r.ok, error: r.error || '' }));
}

// =============================================================================================
// API: feedback rules (review, approve, edit, disable)
// =============================================================================================
function countPendingRules_(ss) {
  const t = table_(ss.getSheetByName(CFG.SHEET_RULES)), R = t.idx;
  return R['Status'] == null ? 0 : t.rows.filter(r => String(r[R['Status']]) === 'Proposed' && !bool_(r[R['Enabled']], false)).length;
}

function ruleMatches_(rule, items) {
  const p = String(rule.pattern || '').toLowerCase().trim();
  if (!p) return [];
  const scope = String(rule.scope || '').toLowerCase().trim();
  return items.filter(it => {
    if (scope && it.company.toLowerCase() !== scope) return false;
    switch (String(rule.type).toUpperCase()) {
      case 'TITLE_CONTAINS': return it.title.toLowerCase().indexOf(p) >= 0;
      case 'TEXT_CONTAINS': return (it.title + ' ' + it.snippet).toLowerCase().indexOf(p) >= 0;
      case 'LOCATION_CONTAINS': return it.location.toLowerCase().indexOf(p) >= 0;
      case 'COMPANY': return it.company.toLowerCase() === p;
      default: return false;
    }
  });
}

function api_listRules() {
  portalGuard_();
  const ss = ss_();
  ensureStructure_(ss, false);
  const t = table_(ss.getSheetByName(CFG.SHEET_RULES)), R = t.idx;
  const data = readJobs_(ss, false);
  const items = data.rows.map(r => toItem_(r, data.idx));
  return t.rows.filter(r => r[R['Rule ID']]).map(r => {
    const rule = {
      id: String(r[R['Rule ID']]), enabled: bool_(r[R['Enabled']], false), type: String(r[R['Rule Type']] || '').toUpperCase(),
      pattern: String(r[R['Pattern']] || ''), scope: String(r[R['Scope Company']] || ''), reason: String(r[R['Reason']] || ''),
      status: String((R['Status'] != null ? r[R['Status']] : '') || (bool_(r[R['Enabled']], false) ? 'Approved' : 'Proposed')),
      created: iso_(r[R['Created At']]), sourceKey: String(r[R['Source Job Key']] || '')
    };
    const hits = ruleMatches_(rule, items);
    rule.matchesNow = hits.length;
    rule.sample = hits.slice(0, 5).map(it => it.title + ' - ' + it.company);
    return rule;
  });
}

function api_previewRule(rule) {
  portalGuard_();
  const ss = ss_();
  const data = readJobs_(ss, false);
  const hits = ruleMatches_(rule || {}, data.rows.map(r => toItem_(r, data.idx)));
  return { count: hits.length, sample: hits.slice(0, 10).map(it => it.title + ' - ' + it.company) };
}

/** Create or update a rule. action: 'approve' | 'disable' | 'save'. A new rule (no id) starts as Proposed unless approved. */
function api_saveRule(rule, action) {
  portalGuard_();
  rule = rule || {};
  const type = String(rule.type || '').toUpperCase();
  if (RULE_TYPES.indexOf(type) < 0) throw new Error('Pick a rule type');
  const pattern = String(rule.pattern || '').toLowerCase().trim();
  if (pattern.length < 2) throw new Error('The pattern is too short');
  if (type === 'TEXT_CONTAINS' && pattern.length < 4) throw new Error('Text rules need at least 4 characters, to avoid broad exclusions');
  const ss = ss_();
  return withDocLock_(() => {
    const sh = ss.getSheetByName(CFG.SHEET_RULES);
    const t = table_(sh), R = t.idx;
    const now = new Date();
    const enabled = action === 'approve' ? true : (action === 'disable' ? false : !!rule.enabled);
    const status = action === 'approve' ? 'Approved' : (action === 'disable' ? 'Disabled' : (rule.status || (enabled ? 'Approved' : 'Proposed')));
    let i = rule.id ? t.rows.findIndex(r => String(r[R['Rule ID']]) === String(rule.id)) : -1;
    if (i < 0) {
      const next = t.rows.reduce((mx, r) => Math.max(mx, Number(String(r[R['Rule ID']]).replace(/\D/g, '')) || 0), 0) + 1;
      const row = new Array(t.headers.length).fill('');
      const put = (h, v) => { if (R[h] != null) row[R[h]] = v; };
      put('Rule ID', 'R' + next); put('Enabled', enabled); put('Rule Type', type); put('Pattern', pattern);
      put('Scope Company', String(rule.scope || '').trim()); put('Reason', String(rule.reason || 'Added in portal'));
      put('Created At', now); put('Status', status); put('Updated At', now);
      appendRows_(sh, [row]);
      return { ok: true, id: 'R' + next };
    }
    const rowNum = i + 2;
    const set = (h, v) => { if (R[h] != null) sh.getRange(rowNum, R[h] + 1).setValue(v); };
    set('Enabled', enabled); set('Rule Type', type); set('Pattern', pattern); set('Scope Company', String(rule.scope || '').trim());
    if (rule.reason != null) set('Reason', String(rule.reason));
    set('Status', status); set('Updated At', now);
    return { ok: true, id: String(rule.id) };
  });
}

// =============================================================================================
// API: settings and actions
// =============================================================================================
function api_saveSettings(v) {
  portalGuard_();
  v = v || {};
  const ss = ss_();
  const map = {
    alertMode: ['Alert Mode', x => ({ instant: 'Instant', daily: 'Daily', both: 'Both' })[String(x).toLowerCase()] || 'Instant'],
    dailyHour: ['Daily Summary Hour', x => Math.min(23, Math.max(0, Number(x) || 0))],
    interval: ['Check Interval Minutes', x => [10, 15, 30, 60].indexOf(Number(x)) >= 0 ? Number(x) : 60],
    recipient: ['Recipient Email', x => String(x || '').trim()],
    minScore: ['Minimum Match Score', x => Math.max(1, Number(x) || 3)],
    maxAge: ['Max Posting Age Days', x => Math.max(1, Number(x) || 45)],
    allowUnknown: ['Allow Unknown Eligibility Alerts', x => x ? 'TRUE' : 'FALSE'],
    instantMinScore: ['Instant Alert Min Score', x => Math.max(1, Number(x) || 6)],
    sendAlerts: ['Send Alerts', x => x ? 'TRUE' : 'FALSE']
  };
  withDocLock_(() => Object.keys(map).forEach(k => { if (k in v) setSetting_(ss, map[k][0], map[k][1](v[k])); }));
  // Re-apply the schedule only if automatic checks are already on
  const on = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'monitorJobBoards');
  if (on && ('interval' in v || 'alertMode' in v || 'dailyHour' in v)) installJobMonitoringTrigger();
  return { ok: true, scheduleUpdated: on };
}

function api_runCheckNow() {
  portalGuard_();
  monitorJobBoards();
  const sh = ss_().getSheetByName(CFG.SHEET_LOG);
  const last = sh.getLastRow() > 1 ? sh.getRange(sh.getLastRow(), 1, 1, 6).getValues()[0] : null;
  return last ? { at: iso_(last[0]), checked: last[3], result: last[4], errors: last[5] } : null;
}

function api_sendTestEmail() { portalGuard_(); sendTestEmail(); return { ok: true }; }
