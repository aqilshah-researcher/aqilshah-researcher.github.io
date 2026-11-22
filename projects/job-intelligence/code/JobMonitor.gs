/**
 * DMV Job Monitor v3.1  (Google Apps Script, bound to the DMV_Job_Monitoring_Master sheet)
 *
 * v3.1 adds what the Job Intelligence Portal (Portal.gs + Index/Styles/App html) needs: a stable Job ID,
 * full job descriptions, work mode and numeric salary, a Needs Review eligibility status, feedback rules
 * that wait for your approval, an Activity Log of status changes, and locked, key-based writes so the
 * portal, the sheet and the scheduled checks never overwrite each other.
 *
 * What it does
 *  1. Finds the job feed behind each organization's career page and tests it. Supported:
 *     Workday, Oracle Cloud, ADP, UKG/UltiPro, Paylocity, iCIMS, Greenhouse, Lever, Ashby,
 *     SmartRecruiters, BambooHR, Recruitee, Workable, Breezy, JazzHR, Jobvite,
 *     GovernmentJobs/NEOGOV (counties, cities, MDOT, colleges), JobAps (State of Maryland),
 *     PeopleAdmin (universities), RSS/Atom feeds (ReliefWeb, UN Careers, association job boards),
 *     USAJOBS API, ReliefWeb API, and "Page Watch" for plain HTML career pages.
 *  2. Checks enabled organizations on a schedule (High priority every run, Medium and Low less often).
 *  3. Scores each job title against the Title Patterns tab (data, M&E, evaluation, assessment,
 *     research and data roles), screens out clearance and citizenship requirements, applies your
 *     feedback rules, and removes duplicates found through more than one source.
 *  4. Emails new matches right away and/or in one daily summary, and keeps a Dashboard tab current.
 *
 * Install: Extensions > Apps Script > replace all code with this file > Save > reload the sheet.
 * Then use the Job Monitor menu: 1. Set up, 2. Add recommended organizations, 3. Find job feeds,
 * 4. Turn on automatic checks. Full steps are written to the Start Here tab.
 */

// =============================================================================================
// Configuration
// =============================================================================================
const CFG = {
  VERSION: '3.1',
  SHEET_START: 'Start Here',
  SHEET_DASH: 'Dashboard',
  SHEET_COMPANIES: 'Companies',
  SHEET_JOBS: 'Jobs',
  SHEET_PATTERNS: 'Title Patterns',
  SHEET_RULES: 'Feedback Rules',
  SHEET_SETTINGS: 'Settings',
  SHEET_LOG: 'Run Log',
  SHEET_SEEN: 'Seen Keys',
  SHEET_ACTIVITY: 'Activity Log',
  DESC_MAX_CHARS: 20000,
  MAX_RUNTIME_MS: 4.5 * 60 * 1000,
  BATCH_SIZE: 15,
  LOG_MAX_ROWS: 3000,
  DUP_WINDOW_DAYS: 60,
  UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
};

const COMPANY_HEADERS = ['Company', 'Career Page URL', 'Platform', 'Board Token / Slug', 'Enabled', 'Location Notes',
  'Last Checked', 'Last Success', 'Last Error', 'Category', 'Priority', 'Source File', 'Fit Notes', 'Feed Status'];
const JOB_HEADERS = ['Job Key', 'Company', 'Job Title', 'Location', 'Job URL', 'Posting Date', 'First Seen (ET)',
  'Last Seen (ET)', 'Application Status', 'Alert Sent', 'Source Platform', 'Eligibility', 'Eligibility Evidence',
  'Match Result', 'Skip Reason', 'Remarks', 'Feedback Rule', 'Job Description Snippet', 'Job Type', 'Salary', 'Decision Date',
  'Match Score', 'Matched Terms', 'Still Open', 'Closing Date', 'Category', 'Priority', 'Source Feed',
  'Job ID', 'Work Mode', 'Salary Min', 'Salary Max', 'Notes', 'Application Date', 'Next Follow-up', 'Updated At',
  'Job Description']; // keep Job Description last: the portal list view reads every column except this one
const PATTERN_HEADERS = ['Pattern', 'Type', 'Weight', 'Enabled', 'Notes'];
const RULE_HEADERS = ['Rule ID', 'Enabled', 'Rule Type', 'Pattern', 'Scope Company', 'Source Job Key', 'Reason', 'Created At', 'Status', 'Updated At'];
const ACTIVITY_HEADERS = ['Timestamp', 'Job ID', 'Job Key', 'Field', 'Old Value', 'New Value', 'Source'];
const LOG_HEADERS = ['Run Timestamp (ET)', 'Company', 'Outcome', 'Jobs Found', 'New Jobs', 'Error Message'];
const SEEN_HEADERS = ['Job Key', 'Company', 'First Seen (ET)', 'Fingerprint'];

const OLD_DEFAULT_KEYWORDS = 'data analyst, data scientist, business intelligence, power bi, tableau, monitoring, evaluation, research, assessment, clinical data, analytics, data visualization';
const OLD_DEFAULT_LOCATIONS = 'washington, dc, maryland, virginia, remote, hybrid, rockville, bethesda, arlington, alexandria, fairfax, silver spring, gaithersburg, germantown';
const DEFAULT_LOCATIONS = 'washington, dc, d.c., district of columbia, maryland, md, virginia, va, remote, hybrid, telework, home-based, home based, nationwide, rockville, north bethesda, bethesda, chevy chase, silver spring, gaithersburg, germantown, columbia, college park, greenbelt, hyattsville, landover, largo, laurel, annapolis, baltimore, frederick, arlington, alexandria, fairfax, falls church, mclean, tysons, reston, herndon, vienna';

const SETTING_DEFAULTS = [
  ['Recipient Email', '', 'Blank = the Google account that runs the script. Separate several with commas'],
  ['Keywords', '', 'Optional extra title terms (weight 3). The main list is the Title Patterns tab'],
  ['Location Keywords', DEFAULT_LOCATIONS, 'Comma separated. Jobs with no clear location are sent under "Check these"'],
  ['Send Alerts', 'TRUE', 'TRUE or FALSE'],
  ['Time Zone', 'America/New_York', 'Used for dates and emails'],
  ['Allow Unknown Eligibility Alerts', 'TRUE', 'TRUE also emails Needs Review jobs, in a separate "Check these" section. They are never treated as eligible'],
  ['Block US Citizenship Requirement', 'TRUE', 'TRUE or FALSE'],
  ['Block Clearance Requirement', 'TRUE', 'TRUE or FALSE. Public Trust is never blocked'],
  ['Notify First Scan', 'FALSE', 'Keep FALSE to avoid alerts for jobs that existed before monitoring'],
  ['Check Interval Minutes', '60', '10, 15, 30 or 60. 60 is safest for free Gmail quotas'],
  ['Exclude Title Keywords', '', 'Optional extra excluded words. The main list is the Title Patterns tab'],
  ['Log Non-Matching Jobs', 'FALSE', 'TRUE also logs jobs that score below the minimum'],
  ['Max Description Fetches Per Run', '40', 'Extra page loads used to read job descriptions'],
  ['Workday Max Jobs Per Company', '1000', 'Paging cap for very large Workday sites'],
  ['Full Scan Max Jobs', '400', 'Above this many open jobs, Workday and Oracle sites are searched by Search Terms instead'],
  ['Search Terms', 'data analyst; data specialist; data manager; data officer; monitoring evaluation; evaluation; assessment; research analyst; research data; data management; business intelligence; analytics; performance management', 'Used for very large employers and keyword feeds. Separate with semicolons'],
  ['Minimum Match Score', '3', 'Title score needed to count as a match. See Title Patterns'],
  ['Description Boost Terms', 'power bi, tableau, sql, python, stata, spss, r studio, dhis2, kobotoolbox, kobo, odk, surveycto, logframe, indicators, mel plan, usaid, data quality assessment, dashboards', 'Each term found in the description adds 1 to the score (max 3)'],
  ['Max Posting Age Days', '45', 'Jobs posted longer ago than this are saved but not emailed'],
  ['Alert Mode', 'Instant', 'Instant, Daily or Both. Both = high priority or high score jobs right away, the rest in the daily summary (each job is emailed once)'],
  ['Instant Alert Min Score', '6', 'Used when Alert Mode is Both'],
  ['Portal URL', '', 'Filled in automatically the first time you open the portal'],
  ['Daily Summary Hour', '7', '0 to 23, local time'],
  ['High Priority Every N Runs', '1', 'High priority organizations are checked every run'],
  ['Medium Priority Every N Runs', '2', ''],
  ['Low Priority Every N Runs', '4', ''],
  ['USAJOBS API Key', '', 'Free key from developer.usajobs.gov (optional)'],
  ['USAJOBS Email', '', 'The email you registered the USAJOBS key with'],
  ['USAJOBS Location', 'Washington, District of Columbia; Maryland; Virginia', 'Semicolon separated. Blank = nationwide'],
  ['ReliefWeb Appname', '', 'Approved appname from apidoc.reliefweb.int (optional; the RSS feed works without it)']
];

const STATUS_OPTIONS = ['New', 'Saved', 'Applied', 'Interview', 'Offer', 'Rejected', 'Skipped', 'Closed'];
const TRACKED_FIELDS = ['Application Status', 'Skip Reason', 'Remarks', 'Notes', 'Application Date', 'Next Follow-up'];
const SKIP_REASONS = ['Title not a fit', 'Seniority mismatch', 'Location not workable', 'Citizenship required',
  'Clearance required', 'Salary too low', 'Company not a fit', 'Duplicate', 'Other'];
const RULE_TYPES = ['TITLE_CONTAINS', 'TEXT_CONTAINS', 'LOCATION_CONTAINS', 'COMPANY'];

// Title Patterns: INCLUDE adds weight; EXCLUDE removes the job; BOOST adds to ranking only.
// A pattern is a plain phrase (word-boundary match) or a /regex/.
const DEFAULT_PATTERNS = [
  // Core data roles
  ['data analyst', 'INCLUDE', 3, 'Core role'], ['data specialist', 'INCLUDE', 3, 'Core role'], ['data officer', 'INCLUDE', 3, 'Core role'],
  ['data manager', 'INCLUDE', 3, 'Core role'], ['data management', 'INCLUDE', 3, 'Core role'], ['data coordinator', 'INCLUDE', 3, ''],
  ['data associate', 'INCLUDE', 3, ''], ['data quality', 'INCLUDE', 3, ''], ['data steward', 'INCLUDE', 3, ''], ['data governance', 'INCLUDE', 2, ''],
  ['data lead', 'INCLUDE', 3, ''], ['director of data', 'INCLUDE', 3, ''], ['data director', 'INCLUDE', 3, ''], ['head of data', 'INCLUDE', 3, ''],
  ['data and evaluation', 'INCLUDE', 3, ''], ['data & evaluation', 'INCLUDE', 3, ''], ['data and research', 'INCLUDE', 3, ''], ['data & research', 'INCLUDE', 3, ''],
  ['performance management and data analyst', 'INCLUDE', 3, 'Montgomery County title'], ['performance management & data analyst', 'INCLUDE', 3, ''],
  ['information management officer', 'INCLUDE', 3, 'Humanitarian IM'], ['information management specialist', 'INCLUDE', 3, ''], ['information management analyst', 'INCLUDE', 3, ''],
  ['health data', 'INCLUDE', 3, ''], ['clinical data', 'INCLUDE', 3, ''], ['data scientist', 'INCLUDE', 2, ''], ['data engineer', 'INCLUDE', 1, ''],
  // M&E family
  ['monitoring and evaluation', 'INCLUDE', 3, 'Core role'], ['monitoring & evaluation', 'INCLUDE', 3, 'Core role'], ['monitoring, evaluation', 'INCLUDE', 3, ''],
  ['m&e', 'INCLUDE', 3, 'Core role'], ['m & e', 'INCLUDE', 3, ''], ['meal', 'INCLUDE', 3, 'MEAL'], ['mel', 'INCLUDE', 3, 'MEL'], ['merl', 'INCLUDE', 3, ''], ['mle', 'INCLUDE', 2, ''],
  ['monitoring officer', 'INCLUDE', 3, ''], ['monitoring specialist', 'INCLUDE', 3, ''], ['monitoring manager', 'INCLUDE', 3, ''], ['monitoring coordinator', 'INCLUDE', 3, ''],
  ['evaluation specialist', 'INCLUDE', 3, ''], ['evaluation officer', 'INCLUDE', 3, ''], ['evaluation manager', 'INCLUDE', 3, ''], ['evaluation associate', 'INCLUDE', 3, ''],
  ['evaluation analyst', 'INCLUDE', 3, ''], ['evaluation director', 'INCLUDE', 3, ''], ['director of evaluation', 'INCLUDE', 3, ''], ['evaluator', 'INCLUDE', 3, ''],
  ['program evaluation', 'INCLUDE', 3, ''], ['impact evaluation', 'INCLUDE', 3, ''], ['impact measurement', 'INCLUDE', 3, ''], ['impact analyst', 'INCLUDE', 3, ''],
  ['measurement and evaluation', 'INCLUDE', 3, ''], ['measurement & evaluation', 'INCLUDE', 3, ''], ['evaluation and learning', 'INCLUDE', 3, ''], ['learning and evaluation', 'INCLUDE', 3, ''],
  ['evidence and learning', 'INCLUDE', 2, ''], ['performance monitoring', 'INCLUDE', 3, ''], ['results measurement', 'INCLUDE', 3, ''], ['knowledge management', 'INCLUDE', 1, ''],
  ['monitoring analyst', 'INCLUDE', 3, ''], ['evaluation lead', 'INCLUDE', 3, ''], ['research and evaluation', 'INCLUDE', 3, ''], ['evaluation and research', 'INCLUDE', 3, ''],
  ['evaluation', 'INCLUDE', 2, 'Single word'], ['monitoring', 'INCLUDE', 1, 'Single word'],
  // Assessment
  ['assessment specialist', 'INCLUDE', 3, 'Core role'], ['assessment officer', 'INCLUDE', 3, ''], ['assessment analyst', 'INCLUDE', 3, ''], ['assessment manager', 'INCLUDE', 3, ''],
  ['assessment coordinator', 'INCLUDE', 3, ''], ['assessment and accountability', 'INCLUDE', 3, 'School district title'], ['psychometrician', 'INCLUDE', 2, ''], ['assessment', 'INCLUDE', 1, 'Single word'],
  // Research and analytics
  ['research analyst', 'INCLUDE', 3, ''], ['research specialist', 'INCLUDE', 3, ''], ['research and data', 'INCLUDE', 3, ''], ['research & data', 'INCLUDE', 3, ''],
  ['research data', 'INCLUDE', 3, ''], ['research associate', 'INCLUDE', 2, ''], ['research manager', 'INCLUDE', 2, ''], ['research coordinator', 'INCLUDE', 2, ''],
  ['research director', 'INCLUDE', 3, ''], ['director of research', 'INCLUDE', 3, ''], ['research scientist', 'INCLUDE', 1, ''], ['survey research', 'INCLUDE', 3, ''],
  ['survey methodologist', 'INCLUDE', 2, ''], ['statistician', 'INCLUDE', 3, ''], ['biostatistician', 'INCLUDE', 2, ''], ['epidemiologist', 'INCLUDE', 2, 'Health data, MD background'],
  ['business intelligence', 'INCLUDE', 3, ''], ['bi analyst', 'INCLUDE', 3, ''], ['bi developer', 'INCLUDE', 2, ''], ['power bi', 'INCLUDE', 3, ''], ['tableau', 'INCLUDE', 2, ''],
  ['reporting analyst', 'INCLUDE', 3, ''], ['reporting specialist', 'INCLUDE', 2, ''], ['data visualization', 'INCLUDE', 3, ''], ['analytics', 'INCLUDE', 2, ''],
  ['insights analyst', 'INCLUDE', 2, ''], ['decision support', 'INCLUDE', 2, ''], ['quality improvement analyst', 'INCLUDE', 2, ''], ['performance analyst', 'INCLUDE', 3, ''],
  ['program analyst', 'INCLUDE', 2, ''], ['management analyst', 'INCLUDE', 2, ''], ['management and program analyst', 'INCLUDE', 2, 'Federal title'], ['policy analyst', 'INCLUDE', 1, ''],
  ['fiscal and policy analyst', 'INCLUDE', 1, ''], ['gis analyst', 'INCLUDE', 1, ''], ['quantitative', 'INCLUDE', 1, ''], ['data', 'INCLUDE', 1, 'Single word'], ['research', 'INCLUDE', 1, 'Single word'],
  // Exclusions: junior, unrelated, clearance in title
  ['intern', 'EXCLUDE', 0, ''], ['internship', 'EXCLUDE', 0, ''], ['volunteer', 'EXCLUDE', 0, ''], ['fellowship', 'EXCLUDE', 0, 'Remove this line if you want fellowships'],
  ['postdoctoral', 'EXCLUDE', 0, ''], ['postdoc', 'EXCLUDE', 0, ''], ['professor', 'EXCLUDE', 0, ''], ['lecturer', 'EXCLUDE', 0, ''], ['teacher', 'EXCLUDE', 0, ''],
  ['data entry', 'EXCLUDE', 0, ''], ['data center', 'EXCLUDE', 0, ''], ['network monitoring', 'EXCLUDE', 0, ''], ['patient monitoring', 'EXCLUDE', 0, ''],
  ['monitoring technician', 'EXCLUDE', 0, ''], ['telemetry', 'EXCLUDE', 0, ''], ['tax assess', 'EXCLUDE', 0, ''], ['assessor', 'EXCLUDE', 0, ''],
  ['nurse', 'EXCLUDE', 0, ''], ['driver', 'EXCLUDE', 0, ''], ['custodian', 'EXCLUDE', 0, ''], ['security officer', 'EXCLUDE', 0, ''], ['police', 'EXCLUDE', 0, ''],
  ['cleared', 'EXCLUDE', 0, 'Clearance'], ['ts/sci', 'EXCLUDE', 0, 'Clearance'], ['ts sci', 'EXCLUDE', 0, 'Clearance'], ['top secret', 'EXCLUDE', 0, 'Clearance'],
  ['secret clearance', 'EXCLUDE', 0, 'Clearance'], ['polygraph', 'EXCLUDE', 0, 'Clearance'], ['/\\bw\\/\\s*(?:ts|secret|clearance)\\b/', 'EXCLUDE', 0, 'Clearance shorthand'],
  // Ranking boosts (do not create a match on their own)
  ['senior', 'BOOST', 1, ''], ['sr.', 'BOOST', 1, ''], ['lead', 'BOOST', 1, ''], ['manager', 'BOOST', 1, ''], ['principal', 'BOOST', 1, ''],
  ['director', 'BOOST', 2, 'Leadership goal'], ['head of', 'BOOST', 2, ''], ['chief', 'BOOST', 1, ''], ['supervisor', 'BOOST', 1, ''], ['deputy', 'BOOST', 1, '']
];

// Services the tests can replace. Leave as null in normal use.
var HTTP_ = null;    // object with fetch(url, opts) and fetchAll(requests)
var MAILER_ = null;  // object with sendEmail(options)
var SS_ = null;      // a Spreadsheet to use instead of the bound one
function http_() { return HTTP_ || UrlFetchApp; }
function mail_(o) { return (MAILER_ || MailApp).sendEmail(o); }
/** The bound spreadsheet, also when running as a web app or from a trigger. */
function ss_() {
  if (SS_) return SS_;
  let a = null;
  try { a = SpreadsheetApp.getActive(); } catch (e) {}
  const props = PropertiesService.getScriptProperties();
  if (a) { try { if (props.getProperty('SHEET_ID') !== a.getId()) props.setProperty('SHEET_ID', a.getId()); } catch (e) {} return a; }
  const id = props.getProperty('SHEET_ID');
  if (!id) throw new Error('Open the sheet once and run Job Monitor > 1. Set up sheet');
  return SpreadsheetApp.openById(id);
}

// =============================================================================================
// Menu and simple triggers
// =============================================================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Job Monitor')
    .addItem('1. Set up sheet', 'setupJobMonitor')
    .addItem('2. Add recommended organizations', 'addRecommendedOrganizations')
    .addItem('3. Find job feeds (runs in background)', 'startFeedDiscovery')
    .addItem('4. Turn on automatic checks', 'installJobMonitoringTrigger')
    .addSeparator()
    .addItem('Check for new jobs now', 'monitorJobBoards')
    .addItem('Send daily summary now', 'sendDailySummary')
    .addItem('Send a test email', 'sendTestEmail')
    .addItem('Turn skipped jobs into feedback rules', 'applyFeedbackNow')
    .addItem('Re-score saved jobs with current patterns', 'rescoreJobs')
    .addItem('Re-check organizations without a feed', 'restartFeedDiscovery')
    .addItem('Update dashboard', 'updateDashboardNow')
    .addItem('Open the Job Portal', 'openPortalLink')
    .addItem('Run self-tests (safe, uses temporary tabs)', 'runAllTests')
    .addSeparator()
    .addItem('Turn off all automatic runs', 'removeAllJobMonitorTriggers')
    .addToUi();
}

/** Simple trigger for edits made directly in the Jobs tab: logs tracked changes, stamps Updated At,
 *  Decision Date (status change) and Application Date (first time status becomes Applied). */
function onEdit(e) {
  try {
    const sh = e.range.getSheet();
    if (sh.getName() !== CFG.SHEET_JOBS || e.range.getRow() < 2 || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const field = headers[e.range.getColumn() - 1];
    if (TRACKED_FIELDS.indexOf(field) < 0) return;
    const row = e.range.getRow();
    const col = h => headers.indexOf(h) + 1;
    const now = new Date();
    if (col('Updated At') > 0) sh.getRange(row, col('Updated At')).setValue(now);
    if (field === 'Application Status') {
      if (col('Decision Date') > 0) sh.getRange(row, col('Decision Date')).setValue(now);
      if (String(e.value) === 'Applied' && col('Application Date') > 0 && !sh.getRange(row, col('Application Date')).getValue()) sh.getRange(row, col('Application Date')).setValue(now);
    }
    const act = e.source.getSheetByName(CFG.SHEET_ACTIVITY);
    if (act) act.appendRow([now, col('Job ID') > 0 ? sh.getRange(row, col('Job ID')).getValue() : '', sh.getRange(row, col('Job Key')).getValue(),
      field, e.oldValue === undefined ? '' : e.oldValue, e.value === undefined ? '' : e.value, 'Sheet']);
  } catch (err) { /* never block editing */ }
}

// =============================================================================================
// Setup
// =============================================================================================
function setupJobMonitor() {
  const ss = ss_();
  ensureStructure_(ss, true);
  migrateSettings_(ss);
  const s = readSettings_(ss);
  try { ss.setSpreadsheetTimeZone(s.tz); } catch (e) {}
  updateDashboard_(ss, s);
  toast_('Setup done. Next: Job Monitor > 2. Add recommended organizations.');
}

function ensureStructure_(ss, full) {
  const sheets = [
    [CFG.SHEET_COMPANIES, COMPANY_HEADERS], [CFG.SHEET_JOBS, JOB_HEADERS], [CFG.SHEET_PATTERNS, PATTERN_HEADERS],
    [CFG.SHEET_RULES, RULE_HEADERS], [CFG.SHEET_LOG, LOG_HEADERS], [CFG.SHEET_SEEN, SEEN_HEADERS], [CFG.SHEET_ACTIVITY, ACTIVITY_HEADERS]
  ];
  sheets.forEach(([name, headers]) => {
    let sh = ss.getSheetByName(name);
    const isNew = !sh;
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    else {
      const existing = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(x => String(x).trim());
      const missing = headers.filter(h => existing.indexOf(h) < 0);
      if (missing.length) sh.getRange(1, existing.filter(String).length + 1, 1, missing.length).setValues([missing]);
    }
    if (name === CFG.SHEET_PATTERNS && (isNew || sh.getLastRow() < 2)) {
      sh.getRange(2, 1, DEFAULT_PATTERNS.length, 5).setValues(DEFAULT_PATTERNS.map(p => [p[0], p[1], p[2], true, p[3]]));
    }
    if (full) { sh.setFrozenRows(1); sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold'); }
  });
  const seen = ss.getSheetByName(CFG.SHEET_SEEN);
  if (!seen.isSheetHidden()) seen.hideSheet();

  let st = ss.getSheetByName(CFG.SHEET_SETTINGS);
  if (!st) { st = ss.insertSheet(CFG.SHEET_SETTINGS); st.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'Notes']]); }
  const have = st.getDataRange().getValues().map(r => String(r[0]).trim());
  const add = SETTING_DEFAULTS.filter(d => have.indexOf(d[0]) < 0);
  if (add.length) st.getRange(st.getLastRow() + 1, 1, add.length, 3).setValues(add);
  backfillJobIds_(ss);

  if (!full) return;

  const setList = (sh, name, list) => {
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const c = headers.indexOf(name) + 1;
    if (c < 1) return;
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();
    sh.getRange(2, c, Math.max(sh.getMaxRows() - 1, 1000), 1).setDataValidation(rule);
  };
  const setFmt = (sh, name, fmt) => {
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const c = headers.indexOf(name) + 1;
    if (c > 0) sh.getRange(2, c, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat(fmt);
  };
  const jobs = ss.getSheetByName(CFG.SHEET_JOBS);
  setList(jobs, 'Application Status', STATUS_OPTIONS);
  setList(jobs, 'Skip Reason', SKIP_REASONS);
  ['Posting Date', 'Closing Date'].forEach(h => setFmt(jobs, h, 'yyyy-mm-dd'));
  ['First Seen (ET)', 'Last Seen (ET)', 'Decision Date', 'Updated At'].forEach(h => setFmt(jobs, h, 'yyyy-mm-dd hh:mm'));
  ['Application Date', 'Next Follow-up'].forEach(h => setFmt(jobs, h, 'yyyy-mm-dd'));
  setList(ss.getSheetByName(CFG.SHEET_RULES), 'Status', ['Proposed', 'Approved', 'Disabled']);
  setList(ss.getSheetByName(CFG.SHEET_RULES), 'Rule Type', RULE_TYPES);
  setList(ss.getSheetByName(CFG.SHEET_PATTERNS), 'Type', ['INCLUDE', 'EXCLUDE', 'BOOST']);
  const comp = ss.getSheetByName(CFG.SHEET_COMPANIES);
  setList(comp, 'Platform', Object.keys(PLATFORMS));
  setList(comp, 'Priority', ['High', 'Medium', 'Low']);
  setFmt(comp, 'Last Checked', 'yyyy-mm-dd hh:mm');
  setFmt(comp, 'Last Success', 'yyyy-mm-dd hh:mm');
  writeStartHere_(ss);
}

/** One-time changes for sheets built by earlier versions. Only replaces values that still equal old defaults. */
function migrateSettings_(ss) {
  const st = ss.getSheetByName(CFG.SHEET_SETTINGS);
  const vals = st.getDataRange().getValues();
  vals.forEach((r, i) => {
    const k = String(r[0]).trim(), v = String(r[1]).trim();
    if (k === 'Keywords' && v === OLD_DEFAULT_KEYWORDS) st.getRange(i + 1, 2, 1, 2).setValues([['', 'Optional extra title terms (weight 3). The main list is the Title Patterns tab']]);
    if (k === 'Location Keywords' && v === OLD_DEFAULT_LOCATIONS) st.getRange(i + 1, 2).setValue(DEFAULT_LOCATIONS);
  });
}

function writeStartHere_(ss) {
  let sh = ss.getSheetByName(CFG.SHEET_START);
  if (!sh) sh = ss.insertSheet(CFG.SHEET_START, 0);
  sh.clear();
  const rows = [
    ['STEP', 'WHAT TO DO', 'DETAIL'],
    [1, 'Set up', 'Job Monitor menu > 1. Set up sheet. Adds tabs (Title Patterns, Dashboard), dropdowns, formats and new settings. Safe to run again.'],
    [2, 'Add organizations', 'Job Monitor > 2. Add recommended organizations. Adds about 175 more employers (consulting, NGOs/INGOs, startups, private sector, accounting and finance, DC and Maryland government, associations, research institutes, universities) and job feeds (Maryland JobAps, ReliefWeb, UN Careers, USAJOBS). Existing rows are never overwritten.'],
    [3, 'Recipient', 'Settings: Recipient Email. Blank uses the Google account that runs the script.'],
    [4, 'Find feeds', 'Job Monitor > 3. Find job feeds. Reads each career page, finds and tests the job system, and fills Platform, Board Token and Enabled. Runs every 10 minutes in the background until done, then emails a summary.'],
    [5, 'Turn on checks', 'Job Monitor > 4. Turn on automatic checks. High priority organizations are checked every run, Medium every 2nd run, Low every 4th (Settings).'],
    [6, 'First scan', 'The first scan of each organization saves existing jobs without emailing. Matching existing jobs still appear in Jobs so you can apply.'],
    [7, 'Matching', 'Title Patterns tab controls matching. INCLUDE adds weight, EXCLUDE removes the job, BOOST only improves ranking. A job matches when its INCLUDE score reaches Minimum Match Score (default 3). After editing, use "Re-score saved jobs".'],
    [8, 'Daily use', 'Open the alert email and apply. In Jobs set Application Status. Filter Jobs by Match Result = Match and Still Open = Yes.'],
    [9, 'Teach it', 'For Skipped jobs pick a Skip Reason. Optional Remarks: "avoid title: senior director", "avoid text: ts/sci", "avoid location: baltimore", "avoid company". Rules appear in Feedback Rules.'],
    [10, 'Skip an organization', 'Set Enabled to FALSE and write "Skip:" at the start of Feed Status. Discovery will leave it alone.'],
    [11, 'Manual feeds', 'If an organization shows "No supported feed found", open its job list in a browser and paste that link into Board Token with Platform = Page Watch, or use a format below.'],
    [12, 'Token formats', 'Greenhouse/Lever/Ashby/SmartRecruiters/Workable/Jobvite: board slug. Workday: tenant|wd1|SiteName. ADP: cid|ccId. UKG: host|TENANT|board-guid. Paylocity: board guid. Oracle Cloud: host|CX_1. GovernmentJobs: governmentjobs|agency (or schooljobs|agency). JobAps: MD. PeopleAdmin: host. BambooHR/Recruitee/Breezy/JazzHR: subdomain. iCIMS: careers-xxx.icims.com. RSS: feed URL. USAJOBS / ReliefWeb: search terms separated by semicolons. Page Watch: full URL.'],
    [13, 'Optional keys', 'USAJOBS API Key (free, developer.usajobs.gov) enables federal job search with the clearance field. ReliefWeb Appname (apidoc.reliefweb.int) enables the ReliefWeb API; the ReliefWeb RSS row works without it.'],
    [14, 'Eligibility', 'Jobs that clearly require a security clearance or U.S. citizenship are marked Blocked and not emailed. Public Trust is not blocked. This is a text check, not a legal decision, so read each posting.'],
    [15, 'Limits', 'Some sites block automated checks or load jobs only with JavaScript (DC Government careers.dc.gov is one). Those keep a note in Feed Status. Free Gmail accounts get about 90 minutes of script run time per day and 100 emails per day.']
  ];
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold');
  sh.setColumnWidth(1, 60); sh.setColumnWidth(2, 170); sh.setColumnWidth(3, 900);
  sh.getRange(1, 3, rows.length, 1).setWrap(true);
}

// =============================================================================================
// Triggers
// =============================================================================================
function installJobMonitoringTrigger() {
  const ss = ss_();
  ensureStructure_(ss, false);
  const s = readSettings_(ss);
  deleteTriggers_('monitorJobBoards');
  deleteTriggers_('sendDailySummary');
  const allowed = [10, 15, 30];
  const tb = ScriptApp.newTrigger('monitorJobBoards').timeBased();
  if (allowed.indexOf(s.interval) >= 0) tb.everyMinutes(s.interval); else tb.everyHours(1);
  tb.create();
  if (s.alertMode !== 'instant') {
    ScriptApp.newTrigger('sendDailySummary').timeBased().everyDays(1).atHour(Math.min(23, Math.max(0, s.dailyHour))).inTimezone(s.tz).create();
  }
  toast_('Automatic checks are on (' + (allowed.indexOf(s.interval) >= 0 ? 'every ' + s.interval + ' minutes' : 'every hour') + (s.alertMode !== 'instant' ? ', daily summary at ' + s.dailyHour + ':00' : '') + ').');
}

function startFeedDiscovery() {
  deleteTriggers_('discoverFeeds');
  ScriptApp.newTrigger('discoverFeeds').timeBased().everyMinutes(10).create();
  toast_('Feed discovery started. It runs every 10 minutes until done, then emails you.');
  discoverFeeds();
}

function restartFeedDiscovery() {
  PropertiesService.getScriptProperties().deleteProperty('DISC_CURSOR');
  startFeedDiscovery();
}

function removeAllJobMonitorTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  toast_('All automatic runs are off.');
}

function deleteTriggers_(fn) {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t); });
}

// =============================================================================================
// Monitoring
// =============================================================================================
function monitorJobBoards() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try { runMonitor_(); } finally { lock.releaseLock(); }
}

function runMonitor_() {
  const deadline = Date.now() + CFG.MAX_RUNTIME_MS;
  const ss = ss_();
  ensureStructure_(ss, false);
  const s = readSettings_(ss);
  applyFeedback_(ss);
  const rules = readRules_(ss);
  const patterns = readPatterns_(ss, s);
  const ctx = makeCtx_(s, deadline, false);
  const now0 = new Date();

  const comp = table_(ss.getSheetByName(CFG.SHEET_COMPANIES));
  const C = comp.idx;
  const orgIndex = buildOrgIndex_(comp);

  // Seen keys, feed prefixes and duplicate fingerprints
  const seenSh = ss.getSheetByName(CFG.SHEET_SEEN);
  const seen = new Set(), prefixes = new Set(), fps = new Map();
  if (seenSh.getLastRow() > 1) {
    seenSh.getRange(2, 1, seenSh.getLastRow() - 1, 4).getValues().forEach(r => {
      const k = String(r[0]);
      if (!k) return;
      seen.add(k);
      prefixes.add(keyPrefix_(k));
      if (r[3]) fps.set(String(r[3]), { key: k, at: r[2] instanceof Date ? r[2] : new Date(r[2]) });
    });
  }
  const jobsSh = ss.getSheetByName(CFG.SHEET_JOBS);
  const jobs = table_(jobsSh);
  const J = jobs.idx;
  const jobRow = new Map();
  jobs.rows.forEach((r, i) => { if (r[J['Job Key']]) jobRow.set(String(r[J['Job Key']]), i); });

  // Which organizations are due this run
  const intervalMs = (([10, 15, 30].indexOf(s.interval) >= 0) ? s.interval : 60) * 60000;
  const active = [];
  comp.rows.forEach((r, i) => {
    const p = normPlatform_(r[C['Platform']]);
    const t = String(r[C['Board Token / Slug']] || '').trim();
    if (!(bool_(r[C['Enabled']], false) && p && PLATFORMS[p] && t)) return;
    const pr = PLATFORMS[p].search ? 'high' : String(r[C['Priority']] || 'Medium').trim().toLowerCase();
    const n = pr === 'high' ? s.everyHigh : (pr === 'low' ? s.everyLow : s.everyMedium);
    const last = r[C['Last Checked']];
    const due = !(last instanceof Date) || (now0 - last) >= n * intervalMs - 10 * 60000;
    if (due) active.push({ i, p, t, name: String(r[C['Company']]).trim(), category: r[C['Category']] || '', priority: r[C['Priority']] || '' });
  });
  const logRows = [];
  if (!active.length) {
    appendRows_(ss.getSheetByName(CFG.SHEET_LOG), [[new Date(), '(run summary)', 'Nothing due', '', '', 'No enabled organizations are due. Run "Find job feeds" if none are enabled.']]);
    updateDashboard_(ss, s);
    return;
  }

  const props = PropertiesService.getScriptProperties();
  const cursor = Number(props.getProperty('MON_CURSOR') || 0) % active.length;
  const newSeen = [], candidates = [], openSets = new Map();
  let processed = 0, errors = 0;

  while (processed < active.length && Date.now() < deadline - 60000) {
    const batch = [];
    for (let k = 0; k < CFG.BATCH_SIZE && processed + k < active.length; k++) batch.push(active[(cursor + processed + k) % active.length]);
    const reqErr = [];
    const reqs = batch.map((b, j) => { try { return PLATFORMS[b.p].req(b.t, ctx); } catch (e) { reqErr[j] = e; return null; } });
    const resps = fetchAllSafe_(reqs);
    batch.forEach((b, j) => {
      const row = comp.rows[b.i];
      const now = new Date();
      row[C['Last Checked']] = now;
      try {
        if (reqErr[j]) throw reqErr[j];
        if (!reqs[j]) throw new Error('Board Token / Slug format is not valid for ' + b.p);
        if (!resps[j]) throw new Error('No response');
        if (resps[j] instanceof Error) throw resps[j];
        const raw = PLATFORMS[b.p].parse(b.t, resps[j], ctx) || [];
        const list = raw.filter(x => x && x.id && x.title);
        row[C['Last Success']] = now;
        row[C['Last Error']] = '';
        const prefix = b.p + '|' + b.t;
        const baseline = !prefixes.has(prefix);
        if (baseline) { newSeen.push([prefix + '|__baseline__', b.name, now, '']); prefixes.add(prefix); }
        const current = new Set();
        let nNew = 0;
        list.forEach(job => {
          job.id = String(job.id).replace(/\|/g, '/');
          const key = prefix + '|' + job.id;
          current.add(key);
          if (seen.has(key)) {
            const rr = jobRow.get(key);
            if (rr != null && J['Last Seen (ET)'] != null) jobs.rows[rr][J['Last Seen (ET)']] = now;
            return;
          }
          seen.add(key);
          nNew++;
          job.title = cleanTitle_(job.title);
          const employer = String(job.employer || b.name).trim();
          const org = PLATFORMS[b.p].search ? (orgIndex.get(normOrg_(employer)) || {}) : { category: b.category, priority: b.priority };
          Object.assign(job, {
            key, company: employer, sourceFeed: b.name, platform: b.p, token: b.t, baseline, seenAt: now,
            category: org.category || b.category || '', priority: org.priority || (PLATFORMS[b.p].search ? '' : b.priority) || ''
          });
          job.fp = fingerprint_(employer, job.title);
          newSeen.push([key, employer, now, job.fp]);
          job.ts = titleScore_(job.title, patterns);
          if (job.ts.match || s.logAll) candidates.push(job);
        });
        if (!raw.partial) openSets.set(prefix, current);
        row[C['Feed Status']] = 'OK: ' + list.length + (raw.partial ? ' recent/matching' : ' open') + ' jobs' + (baseline ? ' (baseline saved ' + fmtDate_(now, s.tz) + ')' : '');
        if (nNew) logRows.push([now, b.name, baseline ? 'Baseline' : 'New jobs', list.length, nNew, '']);
      } catch (e) {
        errors++;
        const msg = String(e && e.message || e).slice(0, 300);
        row[C['Last Error']] = msg;
        logRows.push([now, b.name, 'Error', '', '', msg]);
      }
    });
    processed += batch.length;
  }

  // Enrich, screen and score
  let budget = s.maxDesc;
  candidates.sort((a, b) => b.ts.score - a.ts.score);
  candidates.forEach(job => {
    job.desc = job.desc || '';
    if (!job.ts.match) { job.match = job.ts.excluded ? 'Excluded title (' + job.ts.excluded + ')' : 'Below match score'; job.elig = { status: 'Not checked', evidence: '' }; job.score = job.ts.score; return; }
    const quiet = job.baseline && !s.notifyFirstScan;
    if (!quiet && job.desc.length < 300 && budget > 0 && Date.now() < deadline - 20000) {
      budget--;
      try { enrichJob_(job, ctx); } catch (e) {}
    }
    job.elig = (quiet && job.desc.length < 200 && !job.clearance) ? { status: 'Needs Review', evidence: 'Existing job; description not read yet' } : eligibility_(job, s);
    job.score = job.ts.score + descBoost_(job.desc, s);
    job.match = finalMatch_(job, s, rules);
    const prior = fps.get(job.fp);
    if (prior && prior.key !== job.key && (now0 - prior.at) < CFG.DUP_WINDOW_DAYS * 864e5 && job.match === 'Match') job.match = 'Possible duplicate';
    if (!prior) fps.set(job.fp, { key: job.key, at: now0 });
  });

  // Decide alerts
  const alerts = [];
  candidates.forEach(job => {
    let reason = '';
    const posted = toSheetDate_(job.posted);
    const age = posted instanceof Date ? Math.floor((now0 - posted) / 864e5) : null;
    if (job.baseline && !s.notifyFirstScan) reason = 'No - existed before monitoring';
    else if (['Match', 'Location unknown'].indexOf(job.match) < 0) reason = 'No - ' + job.match;
    else if (/^Blocked/.test(job.elig.status)) reason = 'No - ' + job.elig.status;
    else if (job.elig.status === 'Needs Review' && !s.allowUnknown) reason = 'No - needs eligibility review';
    else if (age != null && age > s.maxAge) reason = 'No - posted ' + age + ' days ago';
    else if (!s.sendAlerts) reason = 'No - alerts turned off';
    job.alertNote = reason;
    job.jobId = jobId_(job.key);
    if (!reason) alerts.push(job);
  });
  // Each job is emailed once: instantly, or queued for the daily summary
  const instant = alerts.filter(j => s.alertMode === 'instant' || (s.alertMode === 'both' && (Number(j.score) >= s.instantMinScore || /^high$/i.test(j.priority || ''))));
  alerts.filter(j => instant.indexOf(j) < 0).forEach(j => j.alertNote = 'Queued for daily summary');
  if (instant.length) {
    try {
      sendDigest_(instant, s, ss.getUrl(), 'New jobs found ' + fmtDateTime_(new Date(), s.tz));
      const stamp = 'Yes ' + fmtDateTime_(new Date(), s.tz);
      instant.forEach(j => j.alertNote = stamp);
    } catch (e) {
      instant.forEach(j => j.alertNote = 'Failed: ' + String(e.message || e).slice(0, 100));
    }
  }

  // Still open / closed
  if (J['Still Open'] != null) {
    jobs.rows.forEach(r => {
      const key = String(r[J['Job Key']] || '');
      const set = openSets.get(keyPrefix_(key));
      if (!set) return;
      const cur = String(r[J['Still Open']] || '');
      if (set.has(key)) { if (cur !== 'Yes') r[J['Still Open']] = 'Yes'; }
      else if (!/^No/.test(cur)) r[J['Still Open']] = 'No (gone ' + Utilities.formatDate(now0, s.tz, 'yyyy-MM-dd') + ')';
    });
  }

  // Write everything back
  const newRows = candidates.map(job => jobToRow_(job, jobs));
  withDocLock_(() => {
    if (jobs.rows.length) writeColsByKey_(jobs, 'Job Key', ['Last Seen (ET)', 'Still Open']);
    appendRows_(jobsSh, newRows);
    appendRows_(seenSh, newSeen);
  });
  writeCols_(comp, ['Last Checked', 'Last Success', 'Last Error', 'Feed Status']);
  logRows.push([new Date(), '(run summary)', 'Done', processed + ' of ' + active.length + ' due organizations checked',
    candidates.length + ' saved, ' + instant.length + ' emailed, ' + (alerts.length - instant.length) + ' queued for daily summary', errors ? errors + ' errors' : '']);
  const logSh = ss.getSheetByName(CFG.SHEET_LOG);
  appendRows_(logSh, logRows);
  trimLog_(logSh);
  props.setProperty('MON_CURSOR', String((cursor + processed) % active.length));
  try { updateDashboard_(ss, s); } catch (e) {}
}

function jobToRow_(job, jobs) {
  const J = jobs.idx;
  const r = new Array(jobs.headers.length).fill('');
  const put = (h, v) => { if (J[h] != null) r[J[h]] = v; };
  put('Job Key', job.key); put('Company', job.company); put('Job Title', job.title);
  put('Location', job.location || ''); put('Job URL', job.url || ''); put('Posting Date', toSheetDate_(job.posted));
  put('First Seen (ET)', job.seenAt); put('Last Seen (ET)', job.seenAt); put('Application Status', 'New');
  put('Alert Sent', job.alertNote); put('Source Platform', job.platform);
  put('Eligibility', job.elig.status); put('Eligibility Evidence', String(job.elig.evidence || '').slice(0, 500));
  put('Match Result', job.match); put('Job Description Snippet', String(job.desc || '').replace(/\s+/g, ' ').slice(0, 400));
  put('Job Type', job.type || ''); put('Salary', job.salary || '');
  put('Match Score', job.score != null ? job.score : job.ts.score); put('Matched Terms', job.ts.terms.join(', '));
  put('Still Open', 'Yes'); put('Closing Date', toSheetDate_(job.closing)); put('Category', job.category || '');
  put('Priority', job.priority || ''); put('Source Feed', job.sourceFeed || '');
  const sal = salaryRange_(job.salary);
  put('Job ID', jobId_(job.key)); put('Work Mode', workMode_(job)); put('Salary Min', sal[0]); put('Salary Max', sal[1]);
  put('Updated At', job.seenAt); put('Job Description', String(job.desc || '').slice(0, CFG.DESC_MAX_CHARS));
  return r;
}

/** Stable short id derived from the Job Key, so the same job always has the same id. */
function jobId_(key) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(key), Utilities.Charset.UTF_8);
  return 'J' + bytes.slice(0, 5).map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Fills Job ID (and Work Mode) for older rows that do not have one yet. */
function backfillJobIds_(ss) {
  const sh = ss.getSheetByName(CFG.SHEET_JOBS);
  if (!sh || sh.getLastRow() < 2) return 0;
  const t = table_(sh), J = t.idx;
  if (J['Job ID'] == null) return 0;
  let n = 0;
  t.rows.forEach(r => {
    if (!r[J['Job ID']] && r[J['Job Key']]) { r[J['Job ID']] = jobId_(r[J['Job Key']]); n++; }
    if (J['Work Mode'] != null && !r[J['Work Mode']] && r[J['Job Key']]) r[J['Work Mode']] = workMode_({ location: r[J['Location']], title: r[J['Job Title']], desc: r[J['Job Description Snippet']] });
    if (String(r[J['Application Status']] || '') === 'Reviewing') r[J['Application Status']] = 'New';
    if (/^(Unknown|OK - check wording|Not checked \(existing job\))$/.test(String(r[J['Eligibility']] || ''))) r[J['Eligibility']] = 'Needs Review';
  });
  if (n) withDocLock_(() => writeColsByKey_(t, 'Job Key', ['Job ID', 'Work Mode', 'Application Status', 'Eligibility']));
  return n;
}

/** Remote / Hybrid / On-site from location, title and description. */
function workMode_(job) {
  const head = (String(job.location || '') + ' ' + String(job.title || '')).toLowerCase();
  const desc = String(job.desc || '').slice(0, 4000).toLowerCase();
  if (/\bhybrid\b/.test(head)) return 'Hybrid';
  if (/\b(remote|telework|home[- ]based|virtual|work from home|anywhere)\b/.test(head)) return 'Remote';
  if (/\b(hybrid (?:role|position|schedule|work)|this (?:role|position) is hybrid)\b/.test(desc)) return 'Hybrid';
  if (/\b(fully remote|100% remote|remote (?:role|position)|this (?:role|position) is remote)\b/.test(desc)) return 'Remote';
  return String(job.location || '').trim() ? 'On-site' : '';
}

/** Numeric yearly range from salary text, e.g. "$81,122 - $100,186 Annually" or "$45/hour". */
function salaryRange_(text) {
  const t = String(text || '').replace(/,/g, '');
  const nums = (t.match(/\$?\s?\d+(?:\.\d+)?\s?[kK]?/g) || []).map(x => {
    const v = parseFloat(x.replace(/[^\d.]/g, ''));
    return /k/i.test(x) ? v * 1000 : v;
  }).filter(v => v >= 10);
  if (!nums.length) return ['', ''];
  const hourly = /hour|hr\b|hourly/i.test(t) || Math.max.apply(null, nums) < 300;
  const yr = nums.map(v => Math.round(hourly ? v * 2080 : v)).filter(v => v >= 15000 && v <= 1000000);
  if (!yr.length) return ['', ''];
  return [Math.min.apply(null, yr), Math.max.apply(null, yr)];
}

// =============================================================================================
// Matching
// =============================================================================================
function readPatterns_(ss, s) {
  const out = [];
  const sh = ss.getSheetByName(CFG.SHEET_PATTERNS);
  const rows = sh && sh.getLastRow() > 1 ? table_(sh) : null;
  const src = rows ? rows.rows.filter(r => bool_(r[rows.idx['Enabled']], true)).map(r => [r[rows.idx['Pattern']], r[rows.idx['Type']], r[rows.idx['Weight']]])
    : DEFAULT_PATTERNS.map(p => [p[0], p[1], p[2]]);
  src.forEach(([p, t, w]) => {
    const pat = String(p || '').trim();
    if (!pat) return;
    out.push({ text: pat, type: String(t || 'INCLUDE').trim().toUpperCase(), weight: Number(w) || 0, re: patternRe_(pat) });
  });
  s.keywords.forEach(k => out.push({ text: k, type: 'INCLUDE', weight: 3, re: patternRe_(k) }));
  s.exclude.forEach(k => out.push({ text: k, type: 'EXCLUDE', weight: 0, re: patternRe_(k) }));
  out.minScore = s.minScore;
  return out;
}

function patternRe_(p) {
  const m = String(p).match(/^\/(.+)\/([a-z]*)$/);
  if (m) { try { return new RegExp(m[1], m[2].indexOf('i') >= 0 ? m[2] : m[2] + 'i'); } catch (e) { return null; } }
  return new RegExp('(^|[^a-z0-9])' + escapeRe_(String(p).toLowerCase()) + '($|[^a-z0-9])', 'i');
}

/** Returns {match, score, includeScore, terms[], excluded} */
function titleScore_(title, patterns) {
  const t = ' ' + String(title || '').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ') + ' ';
  let inc = 0, boost = 0, excluded = '';
  const terms = [];
  for (const p of patterns) {
    if (!p.re || !p.re.test(t)) continue;
    if (p.type === 'EXCLUDE') { excluded = p.text; break; }
    if (p.type === 'INCLUDE') { inc += p.weight; terms.push(p.text); }
    else if (p.type === 'BOOST') boost += p.weight;
  }
  const min = patterns.minScore || 3;
  if (excluded) return { match: false, score: 0, includeScore: inc, terms, excluded };
  return { match: inc >= min, score: inc >= min ? inc + boost : inc, includeScore: inc, terms, excluded: '' };
}

function descBoost_(desc, s) {
  if (!desc) return 0;
  const d = String(desc).slice(0, 20000);
  let n = 0;
  s.descBoost.forEach(k => { if (n < 3 && hasWord_(d, k)) n++; });
  return n;
}

function finalMatch_(job, s, rules) {
  const hit = ruleHit_(job, rules);
  if (hit) return 'Blocked by rule ' + hit;
  if (job.notPublic) return 'Not open to the public';
  if (!s.locKeywords.length) return 'Match';
  const loc = String(job.location || '').trim();
  const generic = !loc || /^(united states( of america)?|usa?|u\.s\.a?\.?|us-?\s*remote|multiple locations|various locations|anywhere|\d+ locations|global|worldwide|nationwide|multiple)$/i.test(loc);
  if (!generic) return s.locKeywords.some(k => hasWord_(loc, k)) ? 'Match' : 'Location mismatch';
  if (job.desc && s.locKeywords.some(k => hasWord_(job.desc.slice(0, 6000), k))) return 'Match';
  return 'Location unknown';
}

/** Job keys are Platform|Token|JobId. Tokens may contain "|", job ids never do. */
function keyPrefix_(k) { k = String(k); return k.slice(0, k.lastIndexOf('|')); }

function cleanTitle_(t) {
  return decodeEntities_(String(t || ''))
    .replace(/\s+/g, ' ')
    .replace(/\s*[\(\[]\s*(?:req(?:uisition)?\.?\s*(?:id|#|no\.?)?\s*:?\s*)?[A-Z]{0,4}[-_]?\d{4,}[\)\]]\s*$/i, '')
    .replace(/\s*[-|]\s*(?:job\s*id|req(?:uisition)?\s*(?:id|#)?)\s*:?\s*[\w-]+\s*$/i, '')
    .trim().slice(0, 200);
}

function fingerprint_(employer, title) {
  const norm = x => String(x || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(the|inc|llc|ltd|corp|corporation|company|co|of|at|in|for|a|an|i|ii|iii|iv)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return norm(employer).slice(0, 40) + '|' + norm(title).slice(0, 80);
}

function normOrg_(name) {
  return String(name || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|inc|llc|ltd|corp|corporation|company|co|group|international|intl|us|usa|dc|office)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function buildOrgIndex_(comp) {
  const C = comp.idx, m = new Map();
  comp.rows.forEach(r => {
    const k = normOrg_(r[C['Company']]);
    if (k && !m.has(k)) m.set(k, { category: r[C['Category']] || '', priority: r[C['Priority']] || '' });
  });
  return m;
}

/** Re-applies current Title Patterns and Settings to saved jobs that are still New. */
function rescoreJobs() {
  const ss = ss_();
  const s = readSettings_(ss);
  const patterns = readPatterns_(ss, s);
  const rules = readRules_(ss);
  const jobs = table_(ss.getSheetByName(CFG.SHEET_JOBS));
  const J = jobs.idx;
  let n = 0;
  jobs.rows.forEach(r => {
    if (['New', 'Saved', ''].indexOf(String(r[J['Application Status']] || '')) < 0) return;
    const ts = titleScore_(r[J['Job Title']], patterns);
    const job = { title: r[J['Job Title']], company: r[J['Company']], location: r[J['Location']], desc: r[J['Job Description Snippet']] || '' };
    const elig = String(r[J['Eligibility']] || '');
    r[J['Match Score']] = ts.match ? ts.score + descBoost_(job.desc, s) : ts.score;
    r[J['Matched Terms']] = ts.terms.join(', ');
    r[J['Match Result']] = !ts.match ? (ts.excluded ? 'Excluded title (' + ts.excluded + ')' : 'Below match score') : (/^Blocked/.test(elig) ? 'Match' : finalMatch_(job, s, rules));
    n++;
  });
  withDocLock_(() => writeColsByKey_(jobs, 'Job Key', ['Match Score', 'Matched Terms', 'Match Result']));
  toast_(n + ' saved jobs re-scored.');
}

// =============================================================================================
// Eligibility screening (text heuristics, not a legal determination)
// =============================================================================================
const US = '(?:u\\.?\\s?s\\.?|united states)';
const CLEARANCE_RES = [
  /\b(?:active|current|existing|interim)\s+(?:dod\s+|u\.?s\.?\s+government\s+|federal\s+)?(?:top secret|ts\s?\/\s?sci|ts-sci|secret|security)\s*(?:\/\s*sci\s*)?(?:security\s+)?clearance/i,
  /\bts\s?\/\s?sci\b|\bts-sci\b|\btop secret\b/i,
  /\bsecret (?:security |level )?clearance\b/i,
  /\b(?:ability|able|eligib\w*) to (?:obtain|maintain|hold|receive)\s+(?:and maintain\s+)?(?:an?\s+)?(?:dod\s+|federal\s+)?(?:top secret|secret|security)\s+clearance/i,
  /\b(?:obtain|maintain|hold|possess)\s+(?:and maintain\s+)?(?:an?\s+)?(?:active\s+)?(?:dod\s+)?(?:top secret|secret)\b(?!\s*(?:sauce|ingredient|weapon|to\b))/i,
  /\bsecurity clearance (?:is\s+)?(?:required|mandatory|needed)\b/i,
  /\bclearance (?:is\s+)?required\b/i,
  /\bmust (?:possess|hold|have|obtain|maintain)\s+(?:and maintain\s+)?(?:an?\s+)?(?:active\s+)?(?:top secret|secret|security)\s+clearance/i,
  /\b(?:full[- ]scope|ci|counterintelligence|lifestyle)\s+poly(?:graph)?\b|\bpolygraph\b/i,
  /\b(?:active|current)\s+(?:dod\s+)?clearance\b/i,
  /\bcleared (?:candidates|professionals|applicants|personnel)\b/i
];
const CITIZEN_RES = [
  new RegExp('\\bmust be (?:a\\s+)?' + US + ' citizens?\\b[^.;]{0,90}', 'i'),
  new RegExp('\\b' + US + ' citizenship (?:is\\s+)?(?:required|mandatory|a requirement)[^.;]{0,60}', 'i'),
  new RegExp('\\bonly ' + US + ' citizens\\b[^.;]{0,60}', 'i'),
  new RegExp('\\brequires? ' + US + ' citizenship[^.;]{0,60}', 'i'),
  new RegExp('\\b' + US + ' citizens? only\\b', 'i'),
  new RegExp('\\b(?:applicants|candidates) must be ' + US + ' citizens?[^.;]{0,60}', 'i'),
  new RegExp('\\b' + US + ' citizens?\\b[^.;]{0,80}\\b(?:required|only)\\b', 'i')
];

function eligibility_(job, s) {
  // Structured clearance field (USAJOBS)
  if (job.clearance && s.blockClearance && !/not\s+(?:required|applicable)|none|public trust|^\s*$/i.test(job.clearance)) {
    return { status: 'Blocked: Clearance', evidence: 'Clearance field: ' + job.clearance };
  }
  const t = String(job.desc || '').replace(/\s+/g, ' ');
  if (t.length < 200) return { status: 'Needs Review', evidence: 'Could not read the full job description' };
  const clear = findPhrase_(t, CLEARANCE_RES);
  if (clear && s.blockClearance) return { status: 'Blocked: Clearance', evidence: clear };
  const cit = findPhrase_(t, CITIZEN_RES);
  if (cit && s.blockCitizen) {
    if (/permanent resident|green card|lawful(ly)? permanent|authorized to work|work authorization/i.test(cit)) return { status: 'Needs Review', evidence: cit };
    return { status: 'Blocked: Citizenship', evidence: cit };
  }
  if (clear || cit) return { status: 'Needs Review', evidence: clear || cit };
  const vague = findPhrase_(t, VAGUE_ELIG_RES);
  if (vague) return { status: 'Needs Review', evidence: vague };
  if (/\bpublic trust\b/i.test(t)) return { status: 'OK', evidence: 'Mentions Public Trust (not a clearance)' };
  return { status: 'OK', evidence: 'No citizenship or clearance requirement found' };
}

/** Wording that may limit eligibility but is not an explicit citizenship or clearance requirement. */
const VAGUE_ELIG_RES = [
  /\b(?:background investigation|suitability determination|security (?:investigation|screening)|government security|federal background check)\b[^.;]{0,80}/i,
  /\b(?:clearance|cleared)\b[^.;]{0,60}(?:preferred|a plus|desired)/i,
  /\bcitizen(?:ship)?\b[^.;]{0,60}(?:preferred|may be required)/i,
  /\b(?:will not|unable to|cannot|does not)\s+(?:provide|offer)?\s*(?:visa\s+)?sponsor(?:ship)?\b[^.;]{0,60}/i
];

function findPhrase_(t, res) {
  for (const re of res) {
    const m = t.match(re);
    if (m) {
      const a = Math.max(0, m.index - 60);
      return '...' + t.slice(a, m.index + m[0].length + 60).trim() + '...';
    }
  }
  return '';
}

// =============================================================================================
// Feedback rules
// =============================================================================================
function applyFeedbackNow() {
  const n = applyFeedback_(ss_());
  toast_(n + ' rule(s) proposed. Review them in Feedback Rules or the portal: tick Enabled to approve.');
}

/** Suggests a rule for a skipped job. Only clear, specific signals become proposals, and every
 *  proposal starts disabled (Status = Proposed) until you approve it. Free-text remarks never
 *  become a rule unless they use the "avoid title: ..." style. */
function proposeRuleFor_(job) {
  const reason = String(job.skipReason || '').trim();
  const remarks = String(job.remarks || '').trim();
  const m = remarks.match(/^avoid\s+(title|text|location|company)\s*(?::\s*(.+))?$/i);
  if (m) {
    const type = { title: 'TITLE_CONTAINS', text: 'TEXT_CONTAINS', location: 'LOCATION_CONTAINS', company: 'COMPANY' }[m[1].toLowerCase()];
    const pattern = type === 'COMPANY' ? job.company : (m[2] || '').trim();
    return pattern ? { type, pattern: String(pattern).toLowerCase(), why: 'From your remark' } : null;
  }
  if (reason === 'Title not a fit' && job.title) return { type: 'TITLE_CONTAINS', pattern: String(job.title).toLowerCase(), why: 'Exact title of the skipped job' };
  if (reason === 'Location not workable' && job.location) return { type: 'LOCATION_CONTAINS', pattern: String(job.location).toLowerCase(), why: 'Exact location of the skipped job' };
  if (reason === 'Company not a fit' && job.company) return { type: 'COMPANY', pattern: String(job.company).toLowerCase(), why: 'Organization of the skipped job' };
  return null;
}

/** Adds a Proposed (disabled) rule unless the same rule already exists. Returns the rule id or ''. */
function addProposedRule_(ss, prop, sourceKey, reasonText) {
  const sh = ss.getSheetByName(CFG.SHEET_RULES);
  const t = table_(sh), R = t.idx;
  const dupe = t.rows.find(r => String(r[R['Rule Type']]).toUpperCase() === prop.type && String(r[R['Pattern']]).toLowerCase() === prop.pattern);
  if (dupe) return String(dupe[R['Rule ID']]);
  const next = t.rows.reduce((mx, r) => Math.max(mx, Number(String(r[R['Rule ID']]).replace(/\D/g, '')) || 0), 0) + 1;
  const row = new Array(t.headers.length).fill('');
  const put = (h, v) => { if (R[h] != null) row[R[h]] = v; };
  const now = new Date();
  put('Rule ID', 'R' + next); put('Enabled', false); put('Rule Type', prop.type); put('Pattern', prop.pattern); put('Scope Company', '');
  put('Source Job Key', sourceKey); put('Reason', reasonText + (prop.why ? ' (' + prop.why + ')' : '')); put('Created At', now);
  put('Status', 'Proposed'); put('Updated At', now);
  appendRows_(sh, [row]);
  return 'R' + next;
}

function applyFeedback_(ss) {
  const jobs = table_(ss.getSheetByName(CFG.SHEET_JOBS));
  const J = jobs.idx;
  if (!jobs.rows.length || J['Feedback Rule'] == null) return 0;
  let n = 0, changed = false;
  withDocLock_(() => {
    jobs.rows.forEach(r => {
      if (String(r[J['Application Status']]).trim() !== 'Skipped') return;
      const reason = String(r[J['Skip Reason']] || '').trim();
      if (!reason || String(r[J['Feedback Rule']] || '').trim()) return;
      const prop = proposeRuleFor_({ skipReason: reason, remarks: r[J['Remarks']], title: r[J['Job Title']], company: r[J['Company']], location: r[J['Location']] });
      if (prop) { r[J['Feedback Rule']] = 'Proposed ' + addProposedRule_(ss, prop, r[J['Job Key']], reason); n++; }
      else r[J['Feedback Rule']] = 'No rule (reason saved)';
      changed = true;
    });
    if (changed) writeColsByKey_(jobs, 'Job Key', ['Feedback Rule']);
  });
  return n;
}

function readRules_(ss) {
  const t = table_(ss.getSheetByName(CFG.SHEET_RULES));
  const I = t.idx;
  return t.rows.filter(r => bool_(r[I['Enabled']], false) && String(r[I['Pattern']] || '').trim()).map(r => ({
    id: String(r[I['Rule ID']]), type: String(r[I['Rule Type']]).trim().toUpperCase(),
    pattern: String(r[I['Pattern']]).trim().toLowerCase(), scope: String(r[I['Scope Company']] || '').trim().toLowerCase()
  }));
}

function ruleHit_(job, rules) {
  const title = String(job.title || '').toLowerCase(), comp = String(job.company || '').toLowerCase();
  const loc = String(job.location || '').toLowerCase(), desc = String(job.desc || '').toLowerCase();
  for (const r of rules) {
    if (r.scope && r.scope !== comp) continue;
    if (r.type === 'TITLE_CONTAINS' && title.indexOf(r.pattern) >= 0) return r.id;
    if (r.type === 'TEXT_CONTAINS' && (title + ' ' + desc).indexOf(r.pattern) >= 0) return r.id;
    if (r.type === 'LOCATION_CONTAINS' && loc.indexOf(r.pattern) >= 0) return r.id;
    if (r.type === 'COMPANY' && comp === r.pattern) return r.id;
  }
  return '';
}

// =============================================================================================
// Email
// =============================================================================================
function sendDigest_(jobs, s, sheetUrl, heading, extraHtml) {
  jobs = jobs.slice().sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const strong = jobs.filter(j => j.match === 'Match' && /^OK/.test(j.elig.status));
  const check = jobs.filter(j => strong.indexOf(j) < 0);
  const esc = x => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const day = d => d instanceof Date ? fmtDate_(d, s.tz) : '';
  const posted = j => {
    const d = toSheetDate_(j.posted);
    if (!(d instanceof Date)) return esc(d || 'Not listed');
    const age = Math.floor((Date.now() - d) / 864e5);
    return day(d) + (age > 30 ? ' <span style="color:#b06000">(older posting)</span>' : '');
  };
  const note = j => {
    const n = [];
    if (j.match === 'Location unknown') n.push('Check location');
    if (j.elig.status === 'Needs Review') n.push('Needs eligibility review');
    else if (j.elig.status !== 'OK') n.push(j.elig.status);
    const cd = toSheetDate_(j.closing);
    if (cd instanceof Date) n.push('Closes ' + day(cd));
    return esc(n.join('; '));
  };
  const star = j => /^high$/i.test(j.priority || '') ? ' &#9733;' : '';
  const table = (list, title) => !list.length ? '' :
    '<h3 style="font-family:Arial;margin:18px 0 6px">' + title + ' (' + list.length + ')</h3>' +
    '<table cellpadding="6" style="border-collapse:collapse;font-family:Arial;font-size:13px">' +
    '<tr style="background:#f1f3f4"><th align="left">Job</th><th align="left">Organization</th><th align="left">Location</th><th align="left">Posted</th><th align="left">Salary</th><th align="left">Score</th><th align="left">Note</th></tr>' +
    list.map(j => '<tr style="border-top:1px solid #e0e0e0"><td><a href="' + esc(j.url) + '">' + esc(j.title) + '</a>' +
      (s.portalUrl && j.jobId ? '<br><a style="font-size:12px;color:#1a73e8" href="' + esc(s.portalUrl + '?job=' + j.jobId) + '">Open in portal</a>' : '') + '</td><td>' + esc(j.company) + star(j) +
      '</td><td>' + esc(j.location || '-') + '</td><td>' + posted(j) + '</td><td>' + esc(j.salary || '') + '</td><td>' + esc(j.score) +
      '</td><td>' + note(j) + '</td></tr>').join('') + '</table>';
  const first = strong[0] || check[0];
  const subject = '[Job Alert] ' + jobs.length + ' new: ' + first.title + ' at ' + first.company + (jobs.length > 1 ? ' (+' + (jobs.length - 1) + ' more)' : '');
  const html = '<div style="font-family:Arial;font-size:14px"><p>' + esc(heading) + '.</p>' +
    table(strong, 'Good matches') + table(check, 'Check these') + (extraHtml || '') +
    '<p style="margin-top:18px;color:#555">&#9733; = high priority organization. Score = title match plus seniority and skills found in the description.</p>' +
    (s.portalUrl ? '<p>Portal: <a href="' + esc(s.portalUrl) + '">' + esc(s.portalUrl) + '</a></p>' : '') +
    '<p>Tracker: <a href="' + esc(sheetUrl) + '">' + esc(sheetUrl) + '</a></p></div>';
  mail_({ to: s.recipient, subject: subject.slice(0, 180), htmlBody: html, name: 'Job Monitor' });
}

/** Daily summary: last 24 hours of matches plus feed health. Runs from its own trigger or the menu. */
function sendDailySummary() {
  const ss = ss_();
  const s = readSettings_(ss);
  const jobs = table_(ss.getSheetByName(CFG.SHEET_JOBS));
  const J = jobs.idx;
  const picked = [];
  jobs.rows.forEach(r => {
    const note = String(r[J['Alert Sent']] || '');
    if (note !== 'Queued for daily summary') return; // jobs already emailed instantly are not repeated
    picked.push({ row: r, jobId: r[J['Job ID']], key: r[J['Job Key']], title: r[J['Job Title']], company: r[J['Company']], location: r[J['Location']], url: r[J['Job URL']],
      posted: r[J['Posting Date']], closing: r[J['Closing Date']], salary: r[J['Salary']], score: r[J['Match Score']],
      priority: r[J['Priority']], match: r[J['Match Result']], elig: { status: String(r[J['Eligibility']] || '') } });
  });
  const comp = table_(ss.getSheetByName(CFG.SHEET_COMPANIES));
  const C = comp.idx;
  const enabled = comp.rows.filter(r => bool_(r[C['Enabled']], false));
  const failing = enabled.filter(r => String(r[C['Last Error']] || '').trim());
  const openNew = jobs.rows.filter(r => String(r[J['Application Status']]) === 'New' && String(r[J['Match Result']]) === 'Match' && String(r[J['Still Open']] || 'Yes') === 'Yes').length;
  const health = '<h3 style="font-family:Arial;margin:18px 0 6px">Monitor health</h3><p style="font-family:Arial;font-size:13px">' +
    enabled.length + ' organizations monitored; ' + failing.length + ' with errors on the last check' +
    (failing.length ? ' (for example: ' + failing.slice(0, 5).map(r => r[C['Company']]).join(', ') + ')' : '') +
    '. ' + openNew + ' matching jobs are still open and marked New in your tracker.</p>';
  if (!picked.length) {
    mail_({ to: s.recipient, subject: '[Job Alert] Daily summary: no new matches', name: 'Job Monitor',
      htmlBody: '<div style="font-family:Arial;font-size:14px"><p>No new matching jobs since the last summary.</p>' + health + '<p><a href="' + ss.getUrl() + '">' + ss.getUrl() + '</a></p></div>' });
    return;
  }
  sendDigest_(picked, s, ss.getUrl(), 'Daily summary for ' + fmtDate_(new Date(), s.tz), health);
  const stamp = 'Yes (daily) ' + fmtDateTime_(new Date(), s.tz);
  picked.forEach(p => { p.row[J['Alert Sent']] = stamp; });
  withDocLock_(() => writeColsByKey_(jobs, 'Job Key', ['Alert Sent']));
}

function sendTestEmail() {
  const ss = ss_();
  const s = readSettings_(ss);
  mail_({ to: s.recipient, subject: 'Job Monitor test email', name: 'Job Monitor',
    htmlBody: '<p style="font-family:Arial">Your job alerts will arrive at this address.</p><p style="font-family:Arial">Tracker: <a href="' + ss.getUrl() + '">' + ss.getUrl() + '</a></p>' });
  toast_('Test email sent to ' + s.recipient);
}

// =============================================================================================
// Dashboard
// =============================================================================================
function updateDashboardNow() { const ss = ss_(); updateDashboard_(ss, readSettings_(ss)); toast_('Dashboard updated.'); }

function updateDashboard_(ss, s) {
  let sh = ss.getSheetByName(CFG.SHEET_DASH);
  if (!sh) sh = ss.insertSheet(CFG.SHEET_DASH, 1);
  const comp = table_(ss.getSheetByName(CFG.SHEET_COMPANIES)), C = comp.idx;
  const jobs = table_(ss.getSheetByName(CFG.SHEET_JOBS)), J = jobs.idx;
  const now = Date.now(), week = now - 7 * 864e5;
  const count = (arr, f) => arr.reduce((n, x) => n + (f(x) ? 1 : 0), 0);
  const enabled = comp.rows.filter(r => bool_(r[C['Enabled']], false));
  const byPlat = {}, byStatus = {}, byCat = {};
  enabled.forEach(r => { const p = normPlatform_(r[C['Platform']]) || '?'; byPlat[p] = (byPlat[p] || 0) + 1; });
  jobs.rows.forEach(r => {
    const st = String(r[J['Application Status']] || 'New'); byStatus[st] = (byStatus[st] || 0) + 1;
    if (String(r[J['Match Result']]) === 'Match') { const c = String(r[J['Category']] || 'Other'); byCat[c] = (byCat[c] || 0) + 1; }
  });
  const rows = [
    ['Job Monitor Dashboard', 'Updated ' + fmtDateTime_(new Date(), s.tz) + ' (v' + CFG.VERSION + ')'],
    ['', ''],
    ['Organizations in tracker', comp.rows.length],
    ['Organizations monitored (Enabled)', enabled.length],
    ['Organizations with errors on last check', count(enabled, r => String(r[C['Last Error']] || '').trim())],
    ['Organizations still without a feed', count(comp.rows, r => !normPlatform_(r[C['Platform']]) && !/^skip/i.test(String(r[C['Feed Status']] || '')))],
    ['', ''],
    ['Jobs saved (all time)', jobs.rows.length],
    ['New jobs saved in last 7 days', count(jobs.rows, r => r[J['First Seen (ET)']] instanceof Date && r[J['First Seen (ET)']].getTime() >= week)],
    ['Matches in last 7 days', count(jobs.rows, r => r[J['First Seen (ET)']] instanceof Date && r[J['First Seen (ET)']].getTime() >= week && String(r[J['Match Result']]) === 'Match')],
    ['Matches still open and marked New', count(jobs.rows, r => String(r[J['Match Result']]) === 'Match' && String(r[J['Application Status']] || 'New') === 'New' && String(r[J['Still Open']] || 'Yes') === 'Yes')],
    ['Blocked for clearance', count(jobs.rows, r => /Clearance/.test(String(r[J['Eligibility']])))],
    ['Blocked for citizenship', count(jobs.rows, r => /Citizenship/.test(String(r[J['Eligibility']])))],
    ['Needs eligibility review', count(jobs.rows, r => String(r[J['Eligibility']]) === 'Needs Review')],
    ['', ''],
    ['Application status', 'Jobs']
  ].concat(Object.keys(byStatus).sort().map(k => [k, byStatus[k]]))
    .concat([['', ''], ['Matches by category', 'Jobs']]).concat(Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]).slice(0, 20).map(k => [k, byCat[k]]))
    .concat([['', ''], ['Monitored organizations by job system', 'Count']]).concat(Object.keys(byPlat).sort((a, b) => byPlat[b] - byPlat[a]).map(k => [k, byPlat[k]]));
  sh.clear();
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  rows.forEach((r, i) => { if (/^(Application status|Matches by category|Monitored organizations by job system)$/.test(r[0])) sh.getRange(i + 1, 1, 1, 2).setFontWeight('bold'); });
  sh.setColumnWidth(1, 330); sh.setColumnWidth(2, 260);
}

// =============================================================================================
// Recommended organizations
// =============================================================================================
/** Adds the SEED_ORGS list (bottom of this file). Never overwrites existing rows; fills a blank Platform on a same-name row. */
function addRecommendedOrganizations() {
  const ss = ss_();
  ensureStructure_(ss, false);
  const sh = ss.getSheetByName(CFG.SHEET_COMPANIES);
  const comp = table_(sh), C = comp.idx;
  const byName = new Map(), byHost = new Map();
  comp.rows.forEach((r, i) => {
    byName.set(normOrg_(r[C['Company']]), i);
    const h = hostOf_(r[C['Career Page URL']]);
    if (h) byHost.set(h, i);
  });
  const add = [];
  let upgraded = 0, skippedDup = 0;
  SEED_ORGS.forEach(sd => {
    const [name, url, category, location, priority, notes, platform, token] = sd;
    const k = normOrg_(name), h = hostOf_(url);
    const i = byName.has(k) ? byName.get(k) : (h && !GENERIC_HOSTS.test(h) && byHost.has(h) ? byHost.get(h) : null);
    if (i != null) {
      const r = comp.rows[i];
      if (platform && !normPlatform_(r[C['Platform']])) {
        r[C['Platform']] = platform; r[C['Board Token / Slug']] = token || '';
        if (!String(r[C['Career Page URL']] || '').trim()) r[C['Career Page URL']] = url;
        r[C['Feed Status']] = 'Preset feed added (v3). Will be tested by Find job feeds';
        upgraded++;
      } else skippedDup++;
      return;
    }
    const row = new Array(comp.headers.length).fill('');
    const put = (hname, v) => { if (C[hname] != null) row[C[hname]] = v; };
    put('Company', name); put('Career Page URL', url); put('Platform', platform || ''); put('Board Token / Slug', token || '');
    put('Enabled', false); put('Location Notes', location); put('Category', category); put('Priority', priority);
    put('Source File', 'Recommended v3 (Nov 2026)'); put('Fit Notes', notes);
    put('Feed Status', platform ? 'Preset feed. Will be tested by Find job feeds' : 'New. Run Find job feeds');
    add.push(row);
    byName.set(k, -1);
    if (h) byHost.set(h, -1);
  });
  // Mark networking groups and meetups that are not employers
  let skippedNonEmployer = 0;
  comp.rows.forEach(r => {
    if (NON_EMPLOYER.test(String(r[C['Company']] || '')) && !/^skip/i.test(String(r[C['Feed Status']] || ''))) {
      r[C['Enabled']] = false; r[C['Feed Status']] = 'Skip: networking group or chapter, not an employer'; skippedNonEmployer++;
    }
  });
  if (comp.rows.length) writeCols_(comp, ['Platform', 'Board Token / Slug', 'Career Page URL', 'Enabled', 'Feed Status']);
  appendRows_(sh, add);
  toast_(add.length + ' organizations added, ' + upgraded + ' existing rows given a preset feed, ' + skippedDup + ' already present, ' + skippedNonEmployer + ' non-employers marked Skip. Next: 3. Find job feeds.');
}

const NON_EMPLOYER = /(meetup|\bchapter\b|\(dc2\)|pydata|data science dc|tableau meetup|professional network|data science association)/i;
const GENERIC_HOSTS = /(^|\.)(dc\.gov|maryland\.gov|montgomerycountymd\.gov|governmentjobs\.com|jobapscloud\.com|usajobs\.gov|reliefweb\.int|myworkdayjobs\.com|greenhouse\.io|lever\.co)$/i;
function hostOf_(u) { const m = String(u || '').match(/^https?:\/\/([^\/?#]+)/i); return m ? m[1].toLowerCase().replace(/^www\./, '') : ''; }

// =============================================================================================
// Feed discovery
// =============================================================================================
function discoverFeeds() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try { runDiscovery_(); } finally { lock.releaseLock(); }
}

function runDiscovery_() {
  const deadline = Date.now() + CFG.MAX_RUNTIME_MS;
  const ss = ss_();
  ensureStructure_(ss, false);
  const s = readSettings_(ss);
  const ctx = makeCtx_(s, deadline, true);
  const comp = table_(ss.getSheetByName(CFG.SHEET_COMPANIES));
  const C = comp.idx;
  const props = PropertiesService.getScriptProperties();
  let i = Number(props.getProperty('DISC_CURSOR') || 0);
  const feedOwner = new Map();
  comp.rows.forEach(r => {
    const p = normPlatform_(r[C['Platform']]), t = String(r[C['Board Token / Slug']] || '').trim();
    if (p && t && bool_(r[C['Enabled']], false)) feedOwner.set(p + '|' + t, String(r[C['Company']]));
  });

  while (i < comp.rows.length && Date.now() < deadline - 45000) {
    const batch = [];
    while (i < comp.rows.length && batch.length < 10) {
      const r = comp.rows[i];
      const p = normPlatform_(r[C['Platform']]);
      const t = String(r[C['Board Token / Slug']] || '').trim();
      const url = String(r[C['Career Page URL']] || '').trim();
      const enabled = bool_(r[C['Enabled']], false);
      const everWorked = !!r[C['Last Success']];
      i++;
      if (/^skip/i.test(String(r[C['Feed Status']] || ''))) continue;
      if (p && (enabled || everWorked)) continue;
      batch.push({ row: r, p, t, url, name: String(r[C['Company']]) });
    }
    const reqs = batch.map(b => (!b.p && /^https?:\/\//i.test(b.url)) ? get_(b.url, { Accept: 'text/html,application/xhtml+xml' }) : null);
    const resps = fetchAllSafe_(reqs);
    batch.forEach((b, j) => {
      let res;
      try {
        if (b.p) res = b.t ? testFeed_(b.p, b.t, ctx, 'Configured') : { status: 'Add the Board Token / Slug for ' + b.p };
        else if (!b.url) res = { status: 'Add a career page URL' };
        else res = discoverFromResponse_(b.url, resps[j], ctx);
      } catch (e) {
        res = { status: 'Discovery failed: ' + String(e && e.message || e).slice(0, 200) };
      }
      if (res.platform) { b.row[C['Platform']] = res.platform; b.row[C['Board Token / Slug']] = res.token; }
      if (res.ok) {
        const fk = res.platform + '|' + res.token;
        if (feedOwner.has(fk) && feedOwner.get(fk) !== b.name) { res.ok = false; res.status = 'Skip: same job feed as "' + feedOwner.get(fk) + '"'; }
        else feedOwner.set(fk, b.name);
      }
      b.row[C['Enabled']] = !!res.ok;
      b.row[C['Feed Status']] = res.status;
    });
  }
  writeCols_(comp, ['Platform', 'Board Token / Slug', 'Enabled', 'Feed Status']);

  if (i >= comp.rows.length) {
    props.deleteProperty('DISC_CURSOR');
    deleteTriggers_('discoverFeeds');
    const counts = {};
    let on = 0;
    comp.rows.forEach(r => { if (bool_(r[C['Enabled']], false)) { on++; const p = normPlatform_(r[C['Platform']]) || '?'; counts[p] = (counts[p] || 0) + 1; } });
    const lines = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map(p => '<li>' + p + ': ' + counts[p] + '</li>').join('');
    try {
      mail_({ to: s.recipient, subject: 'Job Monitor: feed discovery finished (' + on + ' organizations ready)', name: 'Job Monitor',
        htmlBody: '<div style="font-family:Arial"><p>' + on + ' of ' + comp.rows.length + ' organizations can now be monitored.</p><ul>' + lines +
          '</ul><p>Organizations without a feed have a note in Feed Status. If automatic checks are not on yet, use Job Monitor &gt; 4. Turn on automatic checks.</p><p><a href="' +
          ss.getUrl() + '">' + ss.getUrl() + '</a></p></div>' });
    } catch (e) {}
    try { updateDashboard_(ss, s); } catch (e) {}
  } else {
    props.setProperty('DISC_CURSOR', String(i));
  }
}

function discoverFromResponse_(url, resp, ctx) {
  const direct = detectInHtml_(url, '', ctx);
  if (direct && direct.ok) return direct;
  if (!resp) return { status: 'Discovery failed: no response' };
  if (resp instanceof Error) return { status: 'Discovery failed: ' + String(resp.message || resp).slice(0, 150) };
  const code = resp.getResponseCode();
  if (code >= 400) return { status: 'Discovery failed: HTTP ' + code + ' (site blocks automated checks). Add the feed manually, see Start Here step 11.' };
  const html = resp.getContentText();
  let res = detectInHtml_(url, html, ctx);
  if (res && res.ok) return res;
  const rss = rssLinks_(html, url);
  for (const f of rss) {
    const r = testFeed_('RSS', f, ctx, 'Auto-detected');
    if (r.ok) return r;
  }
  const pages = [{ url, html }];
  for (const c of candidateLinks_(html, url).slice(0, 4)) {
    if (ctx.timeLeft() < 40000) break;
    try {
      const h = ctx.text(get_(c, { Accept: 'text/html' }));
      const r2 = detectInHtml_(c, h, ctx);
      if (r2 && r2.ok) return r2;
      if (!res && r2) res = r2;
      pages.push({ url: c, html: h });
    } catch (e) {}
  }
  const det = detectOnly_(pages.map(p => p.html).join('\n'));
  if (det && ctx.timeLeft() > 30000) {
    try { pages.push({ url: det.url, html: ctx.text(get_(det.url, { Accept: 'text/html' })) }); } catch (e) {}
  }
  for (const pg of pages) {
    const links = jobLinks_(pg.html, pg.url);
    if (links.length >= 3) return { ok: true, platform: 'Page Watch', token: pg.url, status: 'Page Watch: ' + links.length + ' job-like links on ' + pg.url + ' (no job system feed found, so new links are tracked)' };
  }
  if (res) return res;
  if (det) return { status: 'Uses ' + det.p + ' (' + det.url.slice(0, 120) + '), which has no direct feed yet. Try Platform = Page Watch with a job list URL that loads without JavaScript.' };
  return { status: 'No supported feed found. Jobs may load with JavaScript. Open the page, find the job list link, and add it (Start Here step 11).' };
}

function detectInHtml_(url, html, ctx) {
  const hay = normalizeHay_(url + '\n' + (html || ''));
  let failed = null;
  const tried = {};
  for (const sig of SIGNATURES) {
    const re = new RegExp(sig.re.source, 'gi');
    let m, n = 0;
    while ((m = re.exec(hay)) && n++ < 20) {
      if (sig.bad && sig.bad(m)) continue;
      const token = sig.tok ? sig.tok(m, hay) : m[1];
      const k = sig.p + '|' + token;
      if (tried[k]) continue;
      tried[k] = true;
      const r = testFeed_(sig.p, token, ctx, 'Auto-detected');
      if (r.ok) return r;
      failed = failed || r;
      if (ctx.timeLeft() < 30000) return failed;
      break;
    }
  }
  return failed;
}

function testFeed_(p, token, ctx, label) {
  const def = PLATFORMS[p];
  if (!def) return { status: 'Platform "' + p + '" is not supported' };
  try {
    const req = def.req(token, ctx);
    if (!req) return { platform: p, token, status: 'Detected ' + p + ' but token "' + token + '" looks wrong' };
    const list = (def.parse(token, ctx.fetch(req), ctx) || []).filter(j => j && j.id && j.title);
    if ((p === 'Page Watch' || p === 'PeopleAdmin') && list.length < 2) return { status: 'Page has too few job links for ' + p };
    return { ok: true, platform: p, token, status: label + ' ' + p + ': feed works, ' + list.length + (ctx.testMode && list.length >= 20 ? '+' : '') + ' jobs (' + fmtDate_(new Date(), ctx.settings.tz) + ')' };
  } catch (e) {
    return { platform: p, token, status: (label === 'Configured' ? 'Feed test failed for ' : 'Detected ') + p + ' (' + String(token).slice(0, 80) + '): ' + String(e && e.message || e).slice(0, 140) };
  }
}

const SIGNATURES = [
  { p: 'Greenhouse', re: /greenhouse\.io\/embed\/job_board(?:\/js)?\?(?:amp;)?for=([\w-]+)/ },
  { p: 'Greenhouse', re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([\w-]+)/, bad: m => /^(embed|v1)$/i.test(m[1]) },
  { p: 'Lever', re: /jobs\.lever\.co\/([\w.-]+)/, bad: m => /^(v0)$/i.test(m[1]) },
  { p: 'Ashby', re: /jobs\.ashbyhq\.com\/([\w.%-]+)/, tok: m => decodeURIComponent(m[1]) },
  { p: 'SmartRecruiters', re: /(?:careers|jobs)\.smartrecruiters\.com\/([\w-]+)/, bad: m => /^(oneclick-ui|ui|static)$/i.test(m[1]) },
  { p: 'Workday', re: /([\w-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)/, tok: m => m[1] + '|' + m[2] + '|' + m[3], bad: m => /^(wday|en-us|login)$/i.test(m[3]) },
  { p: 'Workday', re: /(wd\d+)\.myworkdaysite\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?recruiting\/([\w-]+)\/([\w-]+)/, tok: m => m[2] + '|' + m[1] + '|' + m[3] + '|site' },
  { p: 'ADP', re: /workforcenow\.adp\.com\/[^"'\s<>]*?[?&](?:amp;)?cid=([0-9a-f-]{36})/, tok: (m, hay) => { const c = hay.match(/ccId=(\d{8}_\d{6})/i); return m[1] + '|' + (c ? c[1] : '19000101_000001'); } },
  { p: 'UKG', re: /(recruiting2?\.ultipro\.com)\/(\w+)\/JobBoard\/([0-9a-f-]{36})/, tok: m => m[1].toLowerCase() + '|' + m[2] + '|' + m[3] },
  { p: 'Paylocity', re: /recruiting\.paylocity\.com\/recruiting\/jobs\/(?:All|List)\/([0-9a-f-]{36})/ },
  { p: 'Oracle Cloud', re: /([\w.-]+\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/[a-z]{2}(?:-[A-Z]{2})?\/sites\/([\w-]+)/, tok: m => m[1].toLowerCase() + '|' + m[2] },
  { p: 'GovernmentJobs', re: /(governmentjobs|schooljobs)\.com\/careers\/([\w-]+)/, tok: m => m[1].toLowerCase() + '|' + m[2].toLowerCase(), bad: m => /^(home|search|jobs|login|careers)$/i.test(m[2]) },
  { p: 'JobAps', re: /jobaps(?:cloud)?\.com\/([A-Za-z]{2,12})(?=[\/?"'#]|$)/, tok: m => m[1].toUpperCase(), bad: m => /^(www|images|css|js|sup)$/i.test(m[1]) },
  { p: 'iCIMS', re: /((?:[\w-]+)\.icims\.com)/, tok: m => m[1].toLowerCase(), bad: m => /^(www|cdn|login|developer|community|careers)\.icims\.com$/i.test(m[1]) },
  { p: 'Jobvite', re: /jobs\.jobvite\.com\/([\w-]+)/, bad: m => /^(careers|css|js|__assets__|common)$/i.test(m[1]) },
  { p: 'BambooHR', re: /([\w-]+)\.bamboohr\.com\/(?:careers|jobs)/, bad: m => /^(www|api)$/i.test(m[1]) },
  { p: 'Recruitee', re: /([\w-]+)\.recruitee\.com/, bad: m => /^(www|api|app|careers|blog|support)$/i.test(m[1]) },
  { p: 'Workable', re: /apply\.workable\.com\/([\w-]+)/, bad: m => /^(api|j)$/i.test(m[1]) },
  { p: 'Breezy', re: /([\w-]+)\.breezy\.hr/, bad: m => /^(www|app|assets|marketing|help)$/i.test(m[1]) },
  { p: 'JazzHR', re: /([\w-]+)\.applytojob\.com/, bad: m => /^(www|app)$/i.test(m[1]) },
  { p: 'PeopleAdmin', re: /https?:\/\/([\w.-]+)\/postings\/(?:search|\d+)/, tok: m => m[1].toLowerCase() }
];

const DETECT_ONLY = [
  { p: 'Taleo', re: /https?:\/\/[\w-]+\.taleo\.net\/careersection\/[^"'\s<>]+/i },
  { p: 'Dayforce', re: /https?:\/\/jobs\.dayforcehcm\.com\/[^"'\s<>]+/i },
  { p: 'Paycom', re: /https?:\/\/[\w.]*paycomonline\.net\/[^"'\s<>]+/i },
  { p: 'Paycor', re: /https?:\/\/recruitingbypaycor\.com\/[^"'\s<>]+/i },
  { p: 'ApplicantPro', re: /https?:\/\/[\w-]+\.applicantpro\.com\/[^"'\s<>]*/i },
  { p: 'ClearCompany', re: /https?:\/\/[\w-]+\.hrmdirect\.com\/[^"'\s<>]*/i },
  { p: 'SuccessFactors', re: /https?:\/\/[\w.-]*(?:successfactors|sapsf)\.(?:com|eu)\/[^"'\s<>]+/i },
  { p: 'Avature', re: /https?:\/\/[\w.-]+\.avature\.net\/[^"'\s<>]*/i },
  { p: 'PeopleSoft', re: /https?:\/\/[\w.-]+\/psc\/[^"'\s<>]*HRS_CG_SEARCH[^"'\s<>]*/i },
  { p: 'Cornerstone', re: /https?:\/\/[\w-]+\.csod\.com\/ux\/ats\/careersite\/[^"'\s<>]*/i }
];

function detectOnly_(html) {
  const hay = normalizeHay_(html);
  for (const d of DETECT_ONLY) { const m = hay.match(d.re); if (m) return { p: d.p, url: m[0] }; }
  return null;
}

function normalizeHay_(s) {
  return String(s || '').replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/&#x2F;|&#47;/gi, '/');
}

function rssLinks_(html, base) {
  const out = [];
  const re = /<link\b[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const h = m[0].match(/href=["']([^"']+)["']/i);
    const t = (m[0].match(/title=["']([^"']*)["']/i) || [, ''])[1];
    if (h && /(job|career|vacanc|position|opening|employ)/i.test(h[1] + ' ' + t)) out.push(resolveUrl_(base, decodeEntities_(h[1])));
  }
  return out.slice(0, 2);
}

const CTA_TEXT = /(open positions|current openings|job openings|view (?:all |our )?(?:jobs|openings|positions|opportunities)|search (?:all )?jobs|job opportunities|career opportunities|see (?:all )?(?:openings|jobs)|employment opportunities|join our team|vacancies|open roles|job listings|explore (?:jobs|careers|opportunities)|apply (?:now|today)|current vacancies|find (?:a )?job|job board)/i;
const CAREER_TEXT = /^(careers?|jobs|work (?:with|for) us|employment|opportunities|join us|career center|we're hiring|now hiring)$/i;

function candidateLinks_(html, base) {
  const out = [], seen = {};
  const add = u => { if (u && /^https?:/i.test(u) && !seen[u] && stripSlash_(u) !== stripSlash_(base)) { seen[u] = 1; out.push(u); } };
  let m;
  const ifr = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  while ((m = ifr.exec(html))) add(resolveUrl_(base, decodeEntities_(m[1])));
  const a = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const strong = [], mid = [], weak = [];
  while ((m = a.exec(html))) {
    const href = resolveUrl_(base, decodeEntities_(m[1]).trim());
    const text = htmlToText_(m[2]);
    if (CTA_TEXT.test(text)) strong.push(href);
    else if (CAREER_TEXT.test(text.trim())) mid.push(href);
    else if (/(\/jobs?\b|\/careers?\b|openings|positions|vacanc|opportunit|job-?board|join-?us|employment)/i.test(href) && sameSite_(href, base)) weak.push(href);
  }
  strong.concat(mid, weak).forEach(add);
  return out;
}

// =============================================================================================
// Platforms. Each has req(token, ctx) -> request, parse(token, response, ctx) -> jobs (array; set
// .partial = true when the list is not the full set of open jobs), optional detail(job, token, ctx),
// and search: true for keyword feeds that cover many employers.
// Job shape: {id, title, location, url, posted, closing, desc, type, salary, employer, clearance}
// =============================================================================================
const PLATFORMS = {
  'Greenhouse': {
    req: t => get_('https://boards-api.greenhouse.io/v1/boards/' + enc_(t) + '/jobs?content=true'),
    parse: (t, resp) => (json_(resp).jobs || []).map(j => ({
      id: j.id, title: j.title, location: (j.location && j.location.name) || '', url: j.absolute_url,
      posted: j.first_published || j.updated_at || '', desc: htmlToText_(decodeEntities_(j.content || '')), type: '', salary: ''
    }))
  },
  'Lever': {
    req: t => get_('https://api.lever.co/v0/postings/' + enc_(t) + '?mode=json'),
    parse: (t, resp) => (json_(resp) || []).map(j => {
      const c = j.categories || {};
      const sr = j.salaryRange;
      return {
        id: j.id, title: j.text, url: j.hostedUrl, posted: j.createdAt ? new Date(j.createdAt) : '',
        location: [c.location || (c.allLocations || []).join('; '), j.workplaceType === 'remote' ? 'Remote' : ''].filter(Boolean).join(' / '),
        desc: [j.descriptionPlain, (j.lists || []).map(l => l.text + ': ' + htmlToText_(l.content)).join(' '), j.additionalPlain].filter(Boolean).join(' '),
        type: c.commitment || '', salary: sr ? fmtSalary_(sr.min, sr.max, sr.currency, sr.interval) : ''
      };
    })
  },
  'Ashby': {
    req: t => get_('https://api.ashbyhq.com/posting-api/job-board/' + enc_(t) + '?includeCompensation=true'),
    parse: (t, resp) => (json_(resp).jobs || []).filter(j => j.isListed !== false).map(j => ({
      id: j.id, title: j.title, url: j.jobUrl, posted: j.publishedAt || '',
      location: [j.location, j.isRemote ? 'Remote' : ''].filter(Boolean).join(' / '),
      desc: j.descriptionPlain || '', type: j.employmentType || '',
      salary: (j.compensation && j.compensation.compensationTierSummary) || ''
    }))
  },
  'SmartRecruiters': {
    req: t => get_('https://api.smartrecruiters.com/v1/companies/' + enc_(t) + '/postings?limit=100&offset=0'),
    parse: (t, resp, ctx) => {
      let d = json_(resp), all = d.content || [];
      const total = d.totalFound || all.length;
      for (let off = 100; all.length < total && off < 2000 && ctx.morePages(off / 100); off += 100) {
        const page = ctx.json(get_('https://api.smartrecruiters.com/v1/companies/' + enc_(t) + '/postings?limit=100&offset=' + off)).content || [];
        if (!page.length) break;
        all = all.concat(page);
      }
      const out = all.map(p => {
        const l = p.location || {};
        return {
          id: p.id, title: p.name, url: 'https://jobs.smartrecruiters.com/' + t + '/' + p.id, posted: p.releasedDate || '',
          location: [l.city, l.region, l.remote ? 'Remote' : ''].filter(Boolean).join(', '),
          desc: '', type: (p.typeOfEmployment && p.typeOfEmployment.label) || '', salary: ''
        };
      });
      if (all.length < total) out.partial = true;
      return out;
    },
    detail: (job, t, ctx) => {
      const d = ctx.json(get_('https://api.smartrecruiters.com/v1/companies/' + enc_(t) + '/postings/' + enc_(job.id)));
      const s = (d.jobAd && d.jobAd.sections) || {};
      return { desc: htmlToText_(['jobDescription', 'qualifications', 'additionalInformation'].map(k => (s[k] && s[k].text) || '').join(' ')) };
    }
  },
  'Workday': {
    req: t => { const p = wdParts_(t); return p && post_(p.api + '/jobs', { appliedFacets: {}, limit: 20, offset: 0, searchText: '' }); },
    parse: (t, resp, ctx) => {
      const p = wdParts_(t);
      const d = json_(resp);
      let all = d.jobPostings || [];
      const total = d.total || all.length;
      let partial = false;
      if (total > ctx.settings.fullScanMax && !ctx.testMode) {
        // Very large employer: search by your terms instead of paging everything
        partial = true;
        const byPath = new Map(all.map(j => [j.externalPath, j]));
        for (const term of ctx.settings.searchTerms) {
          if (ctx.timeLeft() < 45000) break;
          for (let off = 0; off < 40; off += 20) {
            const page = ctx.json(post_(p.api + '/jobs', { appliedFacets: {}, limit: 20, offset: off, searchText: term })).jobPostings || [];
            page.forEach(j => byPath.set(j.externalPath, j));
            if (page.length < 20) break;
          }
        }
        all = Array.from(byPath.values());
      } else {
        const cap = Math.min(total, ctx.settings.workdayMax);
        for (let off = 20; all.length < cap && ctx.morePages(off / 20) && ctx.timeLeft() > 45000; off += 20) {
          const page = ctx.json(post_(p.api + '/jobs', { appliedFacets: {}, limit: 20, offset: off, searchText: '' })).jobPostings || [];
          if (!page.length) break;
          all = all.concat(page);
        }
        if (all.length < total) partial = true;
      }
      const out = all.filter(j => j && j.externalPath).map(j => ({
        id: j.externalPath, title: j.title, location: j.locationsText || '', url: p.web + j.externalPath,
        posted: wdPosted_(j.postedOn), desc: '', type: '', salary: ''
      }));
      out.partial = partial;
      return out;
    },
    detail: (job, t, ctx) => {
      const p = wdParts_(t);
      const info = ctx.json(get_(p.api + job.id)).jobPostingInfo || {};
      return { desc: htmlToText_(info.jobDescription || ''), posted: info.startDate || '', type: info.timeType || '', location: info.location || '' };
    }
  },
  'ADP': {
    req: t => { const a = adpParts_(t); return a && get_(a.base + a.q + '&%24top=100&%24skip=0'); },
    parse: (t, resp, ctx) => {
      const a = adpParts_(t);
      const d = json_(resp);
      let all = d.jobRequisitions || [];
      const total = (d.meta && d.meta.totalNumber) || all.length;
      for (let skip = 100; all.length < total && skip < 2000 && ctx.morePages(skip / 100); skip += 100) {
        const page = ctx.json(get_(a.base + a.q + '&%24top=100&%24skip=' + skip)).jobRequisitions || [];
        if (!page.length) break;
        all = all.concat(page);
      }
      const out = all.map(r => ({
        id: r.itemID, title: r.requisitionTitle, posted: r.postDate || '', location: adpLoc_(r),
        url: 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=' + a.cid + '&ccId=' + a.ccId + '&jobId=' + enc_(adpJobId_(r)) + '&lang=en_US',
        desc: htmlToText_(r.requisitionDescription || ''), type: (r.workLevelCode && r.workLevelCode.shortName) || '', salary: ''
      }));
      if (all.length < total) out.partial = true;
      return out;
    },
    detail: (job, t, ctx) => {
      const a = adpParts_(t);
      const d = ctx.json(get_(a.base + '/' + enc_(job.id) + a.q));
      return { desc: htmlToText_(d.requisitionDescription || '') };
    }
  },
  'UKG': {
    req: t => { const u = ukgParts_(t); return u && post_(u.base + '/JobBoardView/LoadSearchResults', ukgBody_(0)); },
    parse: (t, resp, ctx) => {
      const u = ukgParts_(t);
      const d = json_(resp);
      let all = d.opportunities || [];
      const total = d.totalCount || all.length;
      for (let skip = 50; all.length < total && skip < 2000 && ctx.morePages(skip / 50); skip += 50) {
        const page = ctx.json(post_(u.base + '/JobBoardView/LoadSearchResults', ukgBody_(skip))).opportunities || [];
        if (!page.length) break;
        all = all.concat(page);
      }
      const out = all.map(o => ({
        id: o.Id, title: o.Title, posted: o.PostedDate || '', url: u.base + '/OpportunityDetail?opportunityId=' + o.Id,
        location: (o.Locations || []).map(l => l.LocalizedDescription || (l.Address ? [l.Address.City, l.Address.State && l.Address.State.Code].filter(Boolean).join(', ') : '')).filter(Boolean).join('; '),
        desc: o.BriefDescription || '', type: o.FullTime === true ? 'Full-time' : (o.FullTime === false ? 'Part-time' : ''), salary: ''
      }));
      if (all.length < total) out.partial = true;
      return out;
    }
  },
  'Paylocity': {
    req: t => get_('https://recruiting.paylocity.com/recruiting/jobs/All/' + enc_(t), { Accept: 'text/html' }),
    parse: (t, resp) => {
      const html = text_(resp);
      const m = html.match(/window\.pageData\s*=\s*(\{[\s\S]*?\})\s*;\s*(?:<\/script>|window\.|\n)/);
      if (m) {
        try {
          const data = JSON.parse(m[1]);
          return (data.Jobs || []).map(j => ({
            id: j.JobId, title: j.JobTitle, posted: j.PublishedDate || '', url: 'https://recruiting.paylocity.com/Recruiting/Jobs/Details/' + j.JobId,
            location: (j.LocationName || (j.JobLocation ? [j.JobLocation.City, j.JobLocation.State].filter(Boolean).join(', ') : '')) + (j.IsRemote ? ' (Remote)' : ''),
            desc: '', type: '', salary: ''
          }));
        } catch (e) { /* fall through */ }
      }
      return linksByPattern_(html, 'https://recruiting.paylocity.com/', /\/Recruiting\/Jobs\/Details\/(\d+)/i);
    }
  },
  'Oracle Cloud': {
    req: t => { const o = oracleParts_(t); return o && get_(o.list(0, '')); },
    parse: (t, resp, ctx) => {
      const o = oracleParts_(t);
      const first = (json_(resp).items || [])[0] || {};
      let all = first.requisitionList || [];
      const total = first.TotalJobsCount || all.length;
      let partial = false;
      if (total > ctx.settings.fullScanMax && !ctx.testMode) {
        partial = true;
        const byId = new Map(all.map(r => [r.Id, r]));
        for (const term of ctx.settings.searchTerms) {
          if (ctx.timeLeft() < 45000) break;
          const it = (ctx.json(get_(o.list(0, term))).items || [])[0] || {};
          (it.requisitionList || []).forEach(r => byId.set(r.Id, r));
        }
        all = Array.from(byId.values());
      } else {
        for (let off = 100; all.length < total && off < 2000 && ctx.morePages(off / 100); off += 100) {
          const it = (ctx.json(get_(o.list(off, ''))).items || [])[0] || {};
          const page = it.requisitionList || [];
          if (!page.length) break;
          all = all.concat(page);
        }
        if (all.length < total) partial = true;
      }
      const out = all.map(r => ({
        id: r.Id, title: r.Title, posted: r.PostedDate || '', location: r.PrimaryLocation || '',
        url: 'https://' + o.host + '/hcmUI/CandidateExperience/en/sites/' + o.site + '/job/' + r.Id,
        desc: r.ShortDescriptionStr || '', type: r.WorkplaceType || '', salary: ''
      }));
      out.partial = partial;
      return out;
    },
    detail: (job, t, ctx) => {
      const o = oracleParts_(t);
      const it = (ctx.json(get_('https://' + o.host + '/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22' + enc_(job.id) + '%22,siteNumber=' + o.site)).items || [])[0] || {};
      return { desc: htmlToText_([it.ExternalDescriptionStr, it.ExternalResponsibilitiesStr, it.ExternalQualificationsStr].filter(Boolean).join(' ')) };
    }
  },
  'GovernmentJobs': {
    // NEOGOV boards used by many counties, cities, state agencies (MDOT) and colleges. Newest postings first.
    req: t => { const g = neoParts_(t); return g && get_(g.base + '?sort=PostingDate%7CDescending', { Accept: 'text/html' }); },
    parse: (t, resp, ctx) => {
      const g = neoParts_(t);
      const re = new RegExp('/careers/' + escapeRe_(g.slug) + '/jobs/(\\d+)', 'i');
      let all = neoRows_(text_(resp), g, re);
      if (!all.length) {
        // Some boards render the list with a follow-up request
        try {
          const r2 = ctx.fetch(get_('https://www.' + g.site + '.com/careers/home/index?agency=' + enc_(g.slug) + '&sort=PostingDate&isDescendingSort=true', { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' }));
          all = neoRows_(text_(r2), g, re);
        } catch (e) {}
      }
      const ids = new Set(all.map(j => j.id));
      for (let page = 2; page <= 3 && ctx.morePages(page); page++) {
        try {
          const more = neoRows_(ctx.text(get_(g.base + '?sort=PostingDate%7CDescending&page=' + page, { Accept: 'text/html' })), g, re).filter(j => !ids.has(j.id));
          if (!more.length) break;
          more.forEach(j => ids.add(j.id));
          all = all.concat(more);
        } catch (e) { break; }
      }
      all.partial = true; // newest pages only
      return all;
    }
  },
  'JobAps': {
    // State of Maryland (token MD) and other JobAps sites
    req: t => get_('https://www.jobapscloud.com/' + enc_(t) + '/', { Accept: 'text/html' }),
    parse: (t, resp) => jobapsRows_(text_(resp), 'https://www.jobapscloud.com/' + t + '/')
  },
  'PeopleAdmin': {
    // University job boards (host/postings/search)
    req: t => get_('https://' + t + '/postings/search', { Accept: 'text/html' }),
    parse: (t, resp, ctx) => {
      const base = 'https://' + t + '/';
      const re = /\/postings\/(\d+)(?=[\/?"'#]|$)/;
      let all = linksByPattern_(text_(resp), base, re);
      const ids = new Set(all.map(j => j.id));
      for (let page = 2; page <= 6 && ctx.morePages(page); page++) {
        const more = linksByPattern_(ctx.text(get_(base + 'postings/search?page=' + page, { Accept: 'text/html' })), base, re).filter(j => !ids.has(j.id));
        if (!more.length) break;
        more.forEach(j => ids.add(j.id));
        all = all.concat(more);
      }
      all.partial = true;
      return all;
    }
  },
  'RSS': {
    req: t => /^https?:\/\//i.test(t) ? get_(t, { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }) : null,
    parse: (t, resp) => { const out = rssItems_(text_(resp), t); out.partial = true; return out; },
    search: true
  },
  'USAJOBS': {
    req: (t, ctx) => usajobsReq_(splitTerms_(t)[0], ctx),
    parse: (t, resp, ctx) => {
      const terms = splitTerms_(t);
      const byId = new Map();
      const take = d => (((d || {}).SearchResult || {}).SearchResultItems || []).forEach(it => { const j = usajobsJob_(it); if (j) byId.set(j.id, j); });
      take(json_(resp));
      for (let k = 1; k < terms.length && ctx.timeLeft() > 40000; k++) {
        try { take(json_(ctx.fetch(usajobsReq_(terms[k], ctx)))); } catch (e) {}
      }
      const out = Array.from(byId.values());
      out.partial = true;
      return out;
    },
    search: true
  },
  'ReliefWeb': {
    req: (t, ctx) => {
      const app = ctx.settings.reliefwebApp;
      if (!app) throw new Error('Add ReliefWeb Appname in Settings (or use the ReliefWeb RSS row)');
      return post_('https://api.reliefweb.int/v2/jobs?appname=' + enc_(app), {
        query: { value: splitTerms_(t).map(x => '"' + x + '"').join(' OR ') },
        fields: { include: ['title', 'url_alias', 'url', 'source.name', 'date.created', 'date.closing', 'city.name', 'country.name', 'body', 'type.name'] },
        sort: ['date.created:desc'], limit: 100
      });
    },
    parse: (t, resp) => {
      const out = (json_(resp).data || []).map(d => {
        const f = d.fields || {};
        const names = a => (a || []).map(x => x.name).filter(Boolean).join(', ');
        return {
          id: d.id, title: f.title, url: f.url_alias || f.url || ('https://reliefweb.int/job/' + d.id), employer: names(f.source) || 'ReliefWeb',
          location: [names(f.city), names(f.country)].filter(Boolean).join(', '), posted: (f.date || {}).created || '',
          closing: (f.date || {}).closing || '', desc: String(f.body || ''), type: names(f.type), salary: ''
        };
      });
      out.partial = true;
      return out;
    },
    search: true
  },
  'iCIMS': {
    req: t => get_('https://' + t + '/jobs/search?ss=1&in_iframe=1&pr=0', { Accept: 'text/html' }),
    parse: (t, resp, ctx) => {
      const base = 'https://' + t + '/';
      const re = /\/jobs\/(\d+)\/[^"'?#\s]*\/job/i;
      let all = linksByPattern_(text_(resp), base, re);
      const ids = new Set(all.map(j => j.id));
      for (let pr = 1; pr < 15 && ctx.morePages(pr); pr++) {
        const more = linksByPattern_(ctx.text(get_(base + 'jobs/search?ss=1&in_iframe=1&pr=' + pr, { Accept: 'text/html' })), base, re).filter(j => !ids.has(j.id));
        if (!more.length) break;
        more.forEach(j => ids.add(j.id));
        all = all.concat(more);
      }
      return all.map(j => Object.assign(j, { url: j.url.replace(/([?&])in_iframe=1&?/, '$1').replace(/[?&]$/, '') }));
    }
  },
  'Jobvite': {
    req: t => get_('https://jobs.jobvite.com/' + enc_(t) + '/jobs', { Accept: 'text/html' }),
    parse: (t, resp) => linksByPattern_(text_(resp), 'https://jobs.jobvite.com/', /\/job\/(o[A-Za-z0-9]+)/)
  },
  'BambooHR': {
    req: t => get_('https://' + enc_(t) + '.bamboohr.com/careers/list'),
    parse: (t, resp) => (json_(resp).result || []).map(j => ({
      id: j.id, title: j.jobOpeningName, url: 'https://' + t + '.bamboohr.com/careers/' + j.id, posted: '',
      location: [j.location && j.location.city, j.location && j.location.state].filter(Boolean).join(', ') + (j.isRemote ? ' (Remote)' : ''),
      desc: '', type: j.employmentStatusLabel || '', salary: ''
    })),
    detail: (job, t, ctx) => {
      const o = (ctx.json(get_('https://' + enc_(t) + '.bamboohr.com/careers/' + enc_(job.id) + '/detail')).result || {}).jobOpening || {};
      return { desc: htmlToText_(o.description || ''), posted: o.datePosted || '', salary: o.compensation || '' };
    }
  },
  'Recruitee': {
    req: t => get_('https://' + enc_(t) + '.recruitee.com/api/offers/'),
    parse: (t, resp) => (json_(resp).offers || []).map(o => ({
      id: o.id, title: o.title, url: o.careers_url, posted: o.published_at || o.created_at || '',
      location: (o.location || [o.city, o.state_name || o.state_code].filter(Boolean).join(', ')) + (o.remote ? ' (Remote)' : ''),
      desc: htmlToText_((o.description || '') + ' ' + (o.requirements || '')), type: o.employment_type_code || '',
      salary: o.salary && o.salary.min ? fmtSalary_(o.salary.min, o.salary.max, o.salary.currency, o.salary.period) : ''
    }))
  },
  'Workable': {
    req: t => get_('https://apply.workable.com/api/v1/widget/accounts/' + enc_(t) + '?details=true'),
    parse: (t, resp) => (json_(resp).jobs || []).map(j => ({
      id: j.shortcode, title: j.title, url: j.url || j.shortlink || ('https://apply.workable.com/' + t + '/j/' + j.shortcode + '/'),
      posted: j.published_on || j.created_at || '', location: [j.city, j.state, j.country].filter(Boolean).join(', ') + (j.telecommuting ? ' (Remote)' : ''),
      desc: htmlToText_(j.description || ''), type: j.employment_type || '', salary: ''
    }))
  },
  'Breezy': {
    req: t => get_('https://' + enc_(t) + '.breezy.hr/json'),
    parse: (t, resp) => (json_(resp) || []).map(j => ({
      id: j.id || j.friendly_id, title: j.name, url: j.url, posted: j.published_date || '',
      location: ((j.location && j.location.name) || '') + (j.location && j.location.is_remote ? ' (Remote)' : ''),
      desc: '', type: (j.type && j.type.name) || '', salary: typeof j.salary === 'string' ? j.salary : ''
    }))
  },
  'JazzHR': {
    req: t => get_('https://' + enc_(t) + '.applytojob.com/apply/jobs', { Accept: 'text/html' }),
    parse: (t, resp) => linksByPattern_(text_(resp), 'https://' + t + '.applytojob.com/', /\/apply\/([A-Za-z0-9]{6,})\/[\w-]+/)
  },
  'Page Watch': {
    req: t => /^https?:\/\//i.test(t) ? get_(t, { Accept: 'text/html' }) : null,
    parse: (t, resp) => jobLinks_(text_(resp), t).map(l => ({ id: canonUrl_(l.href), title: l.text, url: l.href, location: '', posted: '', desc: '', type: '', salary: '' }))
  }
};

function normPlatform_(v) {
  const k = String(v || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!k) return '';
  const map = {
    'greenhouse': 'Greenhouse', 'lever': 'Lever', 'ashby': 'Ashby', 'smartrecruiters': 'SmartRecruiters', 'smart recruiters': 'SmartRecruiters',
    'workday': 'Workday', 'adp': 'ADP', 'adp workforce now': 'ADP', 'ukg': 'UKG', 'ultipro': 'UKG', 'ukg ultipro': 'UKG',
    'paylocity': 'Paylocity', 'oracle': 'Oracle Cloud', 'oracle cloud': 'Oracle Cloud', 'icims': 'iCIMS', 'jobvite': 'Jobvite',
    'bamboohr': 'BambooHR', 'bamboo hr': 'BambooHR', 'recruitee': 'Recruitee', 'workable': 'Workable', 'breezy': 'Breezy', 'breezy hr': 'Breezy',
    'jazzhr': 'JazzHR', 'jazz hr': 'JazzHR', 'page watch': 'Page Watch', 'pagewatch': 'Page Watch', 'html': 'Page Watch',
    'governmentjobs': 'GovernmentJobs', 'government jobs': 'GovernmentJobs', 'neogov': 'GovernmentJobs', 'schooljobs': 'GovernmentJobs',
    'jobaps': 'JobAps', 'peopleadmin': 'PeopleAdmin', 'people admin': 'PeopleAdmin', 'rss': 'RSS', 'atom': 'RSS', 'feed': 'RSS',
    'usajobs': 'USAJOBS', 'reliefweb': 'ReliefWeb'
  };
  return map[k] || '';
}

// ---- Platform helpers ----
function wdParts_(t) {
  const [tenant, wd, site, kind] = String(t).split('|').map(x => (x || '').trim());
  if (!tenant || !wd || !site) return null;
  if (kind === 'site') {
    const host = wd + '.myworkdaysite.com';
    return { tenant, wd, site, host, api: 'https://' + host + '/wday/cxs/' + tenant + '/' + site, web: 'https://' + host + '/recruiting/' + tenant + '/' + site };
  }
  const host = tenant + '.' + wd + '.myworkdayjobs.com';
  return { tenant, wd, site, host, api: 'https://' + host + '/wday/cxs/' + tenant + '/' + site, web: 'https://' + host + '/' + site };
}
function wdPosted_(s) {
  const t = String(s || '').toLowerCase();
  const day = 864e5;
  if (/today/.test(t)) return new Date();
  if (/yesterday/.test(t)) return new Date(Date.now() - day);
  if (/30\+/.test(t)) return '30+ days ago';
  const m = t.match(/(\d+)\s+days?\s+ago/);
  return m ? new Date(Date.now() - Number(m[1]) * day) : String(s || '');
}
function adpParts_(t) {
  const [cid, ccIdRaw] = String(t).split('|').map(x => (x || '').trim());
  if (!/^[0-9a-f-]{36}$/i.test(cid)) return null;
  const ccId = ccIdRaw || '19000101_000001';
  return { cid, ccId, base: 'https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions', q: '?cid=' + cid + '&ccId=' + ccId + '&lang=en_US&locale=en_US' };
}
function adpJobId_(r) {
  const f = ((r.customFieldGroup && r.customFieldGroup.stringFields) || []).find(x => x.nameCode && x.nameCode.codeValue === 'ExternalJobID');
  return (f && f.stringValue) || r.itemID;
}
function adpLoc_(r) {
  return (r.requisitionLocations || []).map(l => {
    const a = l.address;
    const s = a ? [a.cityName, a.countrySubdivisionLevel1 && a.countrySubdivisionLevel1.codeValue].filter(Boolean).join(', ') : '';
    return s || (l.nameCode && l.nameCode.shortName) || '';
  }).filter(Boolean).join('; ');
}
function ukgParts_(t) {
  const [host, tenant, guid] = String(t).split('|').map(x => (x || '').trim());
  if (!host || !tenant || !guid) return null;
  return { base: 'https://' + host + '/' + tenant + '/JobBoard/' + guid };
}
function ukgBody_(skip) {
  return {
    opportunitySearch: { Top: 50, Skip: skip, QueryString: '', OrderBy: [{ Value: 'postedDateDesc', PropertyName: 'PostedDate', Ascending: false }],
      Filters: [4, 5, 6].map(n => ({ t: 'TermsSearchFilterDto', fieldName: n, extra: null, values: [] })) },
    matchCriteria: { PreferredJobs: [], Educations: [], LicenseAndCertifications: [], Skills: [], hasNoLicenses: false, SkippedSkills: [] }
  };
}
function oracleParts_(t) {
  const [host, site] = String(t).split('|').map(x => (x || '').trim());
  if (!host || !site) return null;
  return {
    host, site,
    list: (off, kw) => 'https://' + host + '/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=' + site +
      (kw ? ',keyword=%22' + encodeURIComponent(kw) + '%22' : '') + ',facetsList=NONE,limit=100,offset=' + off + ',sortBy=POSTING_DATES_DESC'
  };
}
function neoParts_(t) {
  let [site, slug] = String(t).split('|').map(x => (x || '').trim().toLowerCase());
  if (!slug) { slug = site; site = 'governmentjobs'; }
  if (!/^(governmentjobs|schooljobs)$/.test(site) || !/^[\w-]+$/.test(slug)) return null;
  return { site, slug, base: 'https://www.' + site + '.com/careers/' + slug };
}
function neoRows_(html, g, re) {
  // Each NEOGOV list item holds a title link plus location/salary/type lines
  const out = [], seen = {};
  const items = html.split(/<li\b[^>]*class=["'][^"']*list-item/i).slice(1).map(c => c.slice(c.indexOf('>') + 1));
  const chunks = items.length ? items : [html];
  chunks.forEach(chunk => {
    linksByPattern_(chunk, 'https://www.' + g.site + '.com/', re).forEach(j => {
      if (seen[j.id]) return;
      seen[j.id] = 1;
      if (items.length) {
        const meta = htmlToText_(chunk).split('\n').map(x => x.trim()).filter(Boolean);
        const loc = meta.map(x => x.replace(j.title, '').trim()).find(x => x && /,\s*(MD|VA|DC|Maryland|Virginia)\b|remote|county|city/i.test(x));
        const sal = meta.find(x => /\$\s?[\d,]+/.test(x));
        const typ = meta.find(x => /full[- ]time|part[- ]time|temporary|seasonal|contract/i.test(x));
        const posted = meta.find(x => /posted/i.test(x));
        j.location = loc ? loc.slice(0, 120) : '';
        j.salary = sal ? sal.slice(0, 120) : '';
        j.type = typ ? (typ.match(/full[- ]time|part[- ]time|temporary|seasonal|contract/i) || [''])[0] : '';
        j.posted = posted ? neoPosted_(posted) : '';
      }
      out.push(j);
    });
  });
  return out;
}
function neoPosted_(s) {
  const t = String(s).toLowerCase();
  const m = t.match(/(\d+)\s+(day|week|month)s?\s+ago/);
  if (m) return new Date(Date.now() - Number(m[1]) * { day: 1, week: 7, month: 30 }[m[2]] * 864e5);
  if (/today|hours? ago|minutes? ago/.test(t)) return new Date();
  if (/yesterday/.test(t)) return new Date(Date.now() - 864e5);
  return '';
}
function jobapsRows_(html, base) {
  const out = [], seen = {};
  html.split(/<tr\b/i).forEach(seg => {
    const m = seg.match(/href\s*=\s*["']([^"']*bulpreview\.asp\?[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!m) return;
    const href = resolveUrl_(base, decodeEntities_(m[1]));
    const q = k => (href.match(new RegExp('[?&]' + k + '=([^&]*)', 'i')) || [, ''])[1];
    const id = [q('R1'), q('R2'), q('R3')].join('-');
    if (!q('R2') || seen[id]) return;
    seen[id] = 1;
    const cells = (seg.match(/<td\b[\s\S]*?<\/td>/gi) || []).map(c => htmlToText_(c).replace(/\s+/g, ' ').trim());
    let title = htmlToText_(m[2]).replace(/\s+/g, ' ').trim();
    if (/^\d{2}-\d{6}-\d{4}$/.test(title) && cells[0]) title = cells[0].replace(/\d{2}-\d{6}-\d{4}/, '').trim();
    title = title.replace(/\s*\d{2}-\d{6}-\d{4}\s*$/, '').trim();
    const deadline = cells[4] || '';
    out.push({
      id, title, url: href, location: cells[1] ? cells[1] + (/,\s*MD\b|maryland/i.test(cells[1]) ? '' : ', MD') : 'Maryland', employer: cells[2] ? 'State of Maryland - ' + cells[2] : '', salary: cells[3] || '',
      closing: /open\s*\/\s*continuous/i.test(deadline) ? 'Open / Continuous' : deadline.replace(/^[A-Za-z]+,\s*/, '').replace(/\s+\d{1,2}:\d{2}\s*[AP]M\s*$/i, ''),
      posted: '', desc: '', type: ''
    });
  });
  return out;
}
function rssItems_(xml, feedUrl) {
  const channel = (xml.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/i) || xml.match(/<feed\b[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1];
  const feedName = htmlToText_(cdata_(channel)) || hostOf_(feedUrl);
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return items.map(it => {
    const tag = n => { const m = it.match(new RegExp('<' + n + '\\b[^>]*>([\\s\\S]*?)<\\/' + n + '>', 'i')); return m ? cdata_(m[1]).trim() : ''; };
    let link = tag('link');
    if (!link) { const m = it.match(/<link\b[^>]*href=["']([^"']+)["']/i); link = m ? m[1] : ''; }
    const descHtml = decodeEntities_(tag('description') || tag('summary') || tag('content') || tag('content:encoded'));
    const desc = htmlToText_(descHtml);
    const field = re => { const m = desc.match(re); return m ? m[1].trim().slice(0, 100) : ''; };
    const guid = tag('guid') || tag('id') || link;
    return {
      id: canonUrl_(guid || link), title: htmlToText_(decodeEntities_(tag('title'))), url: decodeEntities_(link).trim(),
      posted: tag('pubDate') || tag('published') || tag('updated') || tag('dc:date') || '',
      employer: field(/(?:Organi[sz]ation|Source|Employer|Agency|Company)\s*:\s*([^\n]+)/i) || htmlToText_(tag('author')) || htmlToText_(tag('dc:creator')) || feedName,
      location: field(/(?:Country|Location|Duty Station|City)\s*:\s*([^\n]+)/i),
      closing: field(/(?:Closing date|Deadline|Apply by)\s*:\s*([^\n]+)/i), desc, type: '', salary: ''
    };
  });
}
function cdata_(s) { return String(s || '').replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, ''); }
function splitTerms_(t) { return String(t || '').split(/;|\n/).map(x => x.trim()).filter(Boolean); }
function usajobsReq_(term, ctx) {
  const s = ctx.settings;
  if (!s.usajobsKey || !s.usajobsEmail) throw new Error('Add USAJOBS API Key and USAJOBS Email in Settings (free at developer.usajobs.gov)');
  let url = 'https://data.usajobs.gov/api/search?ResultsPerPage=250&DatePosted=14&Keyword=' + enc_(term);
  if (s.usajobsLocation) url += '&LocationName=' + enc_(s.usajobsLocation);
  return get_(url, { 'User-Agent': s.usajobsEmail, 'Authorization-Key': s.usajobsKey, Accept: 'application/json' });
}
function usajobsJob_(it) {
  const d = it && it.MatchedObjectDescriptor;
  if (!d) return null;
  const det = (d.UserArea && d.UserArea.Details) || {};
  const pay = (d.PositionRemuneration || [])[0] || {};
  const paths = [].concat(det.HiringPath || []).map(String);
  const job = {
    id: it.MatchedObjectId || d.PositionID, title: d.PositionTitle, url: d.PositionURI,
    employer: d.OrganizationName || d.DepartmentName || 'Federal Government', location: d.PositionLocationDisplay || '',
    posted: d.PublicationStartDate || '', closing: d.ApplicationCloseDate || '',
    salary: pay.MinimumRange ? fmtSalary_(pay.MinimumRange, pay.MaximumRange, 'USD', pay.RateIntervalCode === 'PA' ? 'year' : pay.RateIntervalCode) : '',
    type: ((d.PositionSchedule || [])[0] || {}).Name || '',
    desc: [det.JobSummary, [].concat(det.MajorDuties || []).join(' '), d.QualificationSummary, det.SecurityClearance ? 'Security clearance: ' + det.SecurityClearance : ''].filter(Boolean).join(' '),
    clearance: det.SecurityClearance || ''
  };
  if (paths.length && !paths.some(p => /public/i.test(p))) job.notPublic = true;
  return job;
}

// =============================================================================================
// Job detail enrichment
// =============================================================================================
function enrichJob_(job, ctx) {
  const def = PLATFORMS[job.platform] || {};
  let d = null;
  if (def.detail) { try { d = def.detail(job, job.token, ctx); } catch (e) { d = null; } }
  if ((!d || !d.desc || d.desc.length < 200) && job.url) {
    try { const g = genericDetail_(job.url, ctx); d = Object.assign({}, g, d && d.desc && d.desc.length >= 200 ? d : {}); } catch (e) {}
  }
  if (!d) return;
  if (d.desc && d.desc.length > (job.desc || '').length) job.desc = d.desc;
  if (d.posted && !(toSheetDate_(job.posted) instanceof Date)) job.posted = d.posted;
  if (d.closing && !job.closing) job.closing = d.closing;
  if (d.type && !job.type) job.type = d.type;
  if (d.salary && !job.salary) job.salary = d.salary;
  if (d.location && !job.location) job.location = d.location;
}

function genericDetail_(url, ctx) {
  const html = ctx.text(get_(url, { Accept: 'text/html' }));
  const ld = jsonLdJob_(html);
  if (ld) {
    const loc = [].concat(ld.jobLocation || []).map(l => {
      const a = (l && l.address) || {};
      return [a.addressLocality, a.addressRegion].filter(Boolean).join(', ');
    }).filter(Boolean).join('; ');
    return {
      desc: htmlToText_(decodeEntities_(ld.description || '')).slice(0, 30000), posted: ld.datePosted || '', closing: ld.validThrough || '',
      type: [].concat(ld.employmentType || []).join(', '), salary: ldSalary_(ld.baseSalary),
      location: (ld.jobLocationType === 'TELECOMMUTE' ? 'Remote' : '') || loc
    };
  }
  return { desc: htmlToText_(html).slice(0, 30000) };
}

function jsonLdJob_(html) {
  const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1].trim());
      const stack = [].concat(data);
      while (stack.length) {
        const o = stack.shift();
        if (!o || typeof o !== 'object') continue;
        if ([].concat(o['@type'] || []).indexOf('JobPosting') >= 0) return o;
        if (o['@graph']) stack.push.apply(stack, [].concat(o['@graph']));
      }
    } catch (e) {}
  }
  return null;
}

function ldSalary_(b) {
  if (!b || typeof b !== 'object') return '';
  const v = b.value || {};
  if (typeof v === 'number') return fmtSalary_(v, null, b.currency, '');
  return fmtSalary_(v.minValue || v.value, v.maxValue, b.currency, v.unitText);
}

// =============================================================================================
// HTML helpers
// =============================================================================================
const JOB_HREF = /(\/jobs?\/|\/jobs?\?|\/careers?\/[^?#]+|\/positions?\/|\/openings?\/|\/vacanc|\/opportunit|requisition|jobid=|job_id=|\/posting|\/apply\/|\/job-|bulpreview|\/jobdetail)/i;
const NAV_WORDS = /^(careers?|jobs?|home|about( us)?|apply( now| today)?|learn more|read more|view (all )?(jobs|openings|positions|opportunities)|search( jobs)?|see all|back|next|previous|more|benefits|our (culture|team|values)|log ?in|sign (in|up)|contact( us)?|donate|faq|privacy( policy)?|terms.*|internships?|job alerts?|current openings|open positions|share|email|facebook|linkedin|twitter|x|instagram|youtube|careers? (home|at .*)|why work (here|with us)|life at .*|students?|veterans?|diversity.*|our people|job opportunities|career opportunities|employment|join (us|our team)|working here|how we hire|hiring process|events?|news|blog|status|details)$/i;

function jobLinks_(html, baseUrl) {
  const out = [], seen = {};
  const re = /<a\b([^>]*?)href\s*=\s*["']([^"'#]+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = resolveUrl_(baseUrl, decodeEntities_(m[2]).trim());
    if (!/^https?:/i.test(href) || !JOB_HREF.test(href)) continue;
    if (stripSlash_(href) === stripSlash_(baseUrl)) continue;
    let text = htmlToText_(m[4]).replace(/\s+/g, ' ').trim();
    if (!text) { const t = (m[1] + m[3]).match(/(?:title|aria-label)\s*=\s*["']([^"']+)["']/i); text = t ? decodeEntities_(t[1]).trim() : ''; }
    if (text.length < 4 || text.length > 160 || NAV_WORDS.test(text)) continue;
    const key = canonUrl_(href);
    if (seen[key]) continue;
    seen[key] = 1;
    out.push({ href, text });
  }
  return out;
}

function linksByPattern_(html, base, re) {
  const out = [], seen = {};
  const a = /<a\b([^>]*?)href\s*=\s*["']([^"'#]+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = a.exec(html))) {
    const href = resolveUrl_(base, decodeEntities_(m[2]).trim());
    const mm = href.match(re);
    if (!mm) continue;
    let text = htmlToText_(m[4]).replace(/\s+/g, ' ').trim();
    if (!text) { const t = (m[1] + m[3]).match(/title\s*=\s*["']([^"']+)["']/i); text = t ? decodeEntities_(t[1]) : ''; }
    text = text.replace(/^\s*(job title|title)\s*/i, '').trim();
    if (!text) { const slug = href.split('?')[0].split('/').filter(Boolean).slice(-1)[0] || ''; text = /^\d+$/.test(slug) ? '' : slug.replace(/[-_]+/g, ' ').trim(); }
    if (seen[mm[1]]) { if (text.length > seen[mm[1]].title.length && text.length < 160) seen[mm[1]].title = text; continue; }
    if (!text || NAV_WORDS.test(text)) continue;
    const job = { id: mm[1], title: text.slice(0, 160), url: href, location: '', posted: '', desc: '', type: '', salary: '' };
    seen[mm[1]] = job;
    out.push(job);
  }
  return out;
}

function htmlToText_(h) {
  return decodeEntities_(String(h || '')
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|span)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

function decodeEntities_(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&ndash;|&mdash;/g, '-')
    .replace(/&#(\d+);/g, (x, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (x, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function resolveUrl_(base, href) {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (/^(mailto|tel|javascript):/i.test(href)) return '';
  const m = String(base).match(/^(https?:)\/\/([^\/?#]+)(\/[^?#]*)?/i);
  if (!m) return href;
  if (href.indexOf('//') === 0) return m[1] + href;
  if (href.charAt(0) === '/') return m[1] + '//' + m[2] + href;
  if (href.charAt(0) === '?') return m[1] + '//' + m[2] + (m[3] || '/') + href;
  const dir = (m[3] || '/').replace(/[^\/]*$/, '');
  return m[1] + '//' + m[2] + dir + href.replace(/^\.\//, '');
}

function canonUrl_(u) {
  return String(u).replace(/[?&](utm_[^=&]+|source|src|ref|gh_src|in_iframe|b)=[^&]*/gi, '').replace(/[?&]$/, '').replace(/\/$/, '').toLowerCase();
}
function stripSlash_(u) { return String(u || '').replace(/\/+$/, '').toLowerCase(); }
function sameSite_(a, b) {
  const h = u => (String(u).match(/^https?:\/\/([^\/?#]+)/i) || [, ''])[1].replace(/^www\./i, '').toLowerCase();
  const ha = h(a), hb = h(b);
  return !!ha && (ha === hb || ha.endsWith('.' + hb) || hb.endsWith('.' + ha));
}

// =============================================================================================
// HTTP helpers
// =============================================================================================
function get_(url, headers) {
  return { url, method: 'get', muteHttpExceptions: true, followRedirects: true,
    headers: Object.assign({ 'User-Agent': CFG.UA, 'Accept': 'application/json, text/html;q=0.9, */*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' }, headers || {}) };
}
function post_(url, body) {
  return { url, method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true, followRedirects: true,
    headers: { 'User-Agent': CFG.UA, 'Accept': 'application/json', 'Accept-Language': 'en-US,en;q=0.9' } };
}
function opts_(r) { const o = Object.assign({}, r); delete o.url; return o; }
function check_(resp) {
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('HTTP ' + code);
  return resp;
}
function json_(resp) {
  const txt = check_(resp).getContentText();
  try { return JSON.parse(txt); } catch (e) { throw new Error('Response was not JSON (page may need a different token)'); }
}
function text_(resp) { return check_(resp).getContentText(); }

function fetchAllSafe_(reqs) {
  const out = new Array(reqs.length).fill(null);
  const idx = [], arr = [];
  reqs.forEach((r, i) => { if (r) { idx.push(i); arr.push(r); } });
  if (!arr.length) return out;
  try {
    http_().fetchAll(arr).forEach((r, k) => { out[idx[k]] = r; });
  } catch (e) {
    arr.forEach((r, k) => { try { out[idx[k]] = http_().fetch(r.url, opts_(r)); } catch (err) { out[idx[k]] = err; } });
  }
  return out;
}

function makeCtx_(settings, deadline, testMode) {
  const ctx = {
    settings, testMode,
    timeLeft: () => deadline - Date.now(),
    morePages: n => !testMode && n < 100 && Date.now() < deadline - 30000,
    fetch: req => http_().fetch(req.url, opts_(req))
  };
  ctx.json = req => json_(ctx.fetch(req));
  ctx.text = req => text_(ctx.fetch(req));
  return ctx;
}

// =============================================================================================
// Sheet helpers
// =============================================================================================
function table_(sh) {
  const vals = sh.getDataRange().getValues();
  const headers = (vals[0] || []).map(h => String(h).trim());
  const idx = {};
  headers.forEach((h, i) => { if (h && idx[h] == null) idx[h] = i; });
  // keep row positions aligned with the sheet: trim only trailing empty rows
  let rows = vals.slice(1);
  while (rows.length && !rows[rows.length - 1].some(c => c !== '' && c !== null)) rows.pop();
  return { sh, headers, idx, rows };
}

function writeCols_(tbl, names) {
  if (!tbl.rows.length) return;
  names.forEach(n => {
    const c = tbl.idx[n];
    if (c == null) return;
    tbl.sh.getRange(2, c + 1, tbl.rows.length, 1).setValues(tbl.rows.map(r => [r[c] === undefined ? '' : r[c]]));
  });
}

/** Runs fn while holding the document lock, so the portal, the sheet and scheduled runs take turns. */
function withDocLock_(fn) {
  let lock = null;
  try { lock = LockService.getDocumentLock(); } catch (e) {}
  if (!lock) { try { lock = LockService.getScriptLock(); } catch (e) {} }
  if (lock && !lock.tryLock(30000)) throw new Error('The sheet is busy (another update is running). Please try again in a moment.');
  try { return fn(); } finally { if (lock) lock.releaseLock(); }
}

/** Writes the named columns of tbl back to the sheet, matching rows by keyHeader on the sheet as it is NOW.
 *  Safe if rows were sorted, filtered or added since tbl was read. Values for rows not in tbl are left alone. */
function writeColsByKey_(tbl, keyHeader, names) {
  const sh = tbl.sh;
  const last = sh.getLastRow();
  if (last < 2 || !tbl.rows.length) return;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const kc = headers.indexOf(keyHeader);
  if (kc < 0) return;
  const keys = sh.getRange(2, kc + 1, last - 1, 1).getValues().map(r => String(r[0]));
  const ti = tbl.idx[keyHeader];
  const byKey = new Map();
  tbl.rows.forEach(r => { const k = String(r[ti] || ''); if (k) byKey.set(k, r); });
  names.forEach(n => {
    const c = headers.indexOf(n), tc = tbl.idx[n];
    if (c < 0 || tc == null) return;
    const rng = sh.getRange(2, c + 1, last - 1, 1);
    const cur = rng.getValues();
    let dirty = false;
    keys.forEach((k, i) => {
      const r = byKey.get(k);
      if (!r) return;
      const v = r[tc] === undefined ? '' : r[tc];
      const a = cur[i][0];
      const same = (a instanceof Date && v instanceof Date) ? a.getTime() === v.getTime() : a === v;
      if (!same) { cur[i][0] = v; dirty = true; }
    });
    if (dirty) rng.setValues(cur);
  });
}

function logActivity_(ss, rows) {
  const sh = ss.getSheetByName(CFG.SHEET_ACTIVITY);
  if (sh && rows.length) appendRows_(sh, rows);
}

function appendRows_(sh, rows) {
  if (!rows || !rows.length) return;
  const width = Math.max.apply(null, rows.map(r => r.length));
  const norm = rows.map(r => r.concat(new Array(width - r.length).fill('')));
  sh.getRange(sh.getLastRow() + 1, 1, norm.length, width).setValues(norm);
}

function trimLog_(sh) {
  const extra = sh.getLastRow() - 1 - CFG.LOG_MAX_ROWS;
  if (extra > 0) sh.deleteRows(2, extra);
}

function readSettings_(ss) {
  const sh = ss.getSheetByName(CFG.SHEET_SETTINGS);
  const m = {};
  if (sh) sh.getDataRange().getValues().slice(1).forEach(r => { if (r[0]) m[String(r[0]).trim()] = r[1]; });
  let me = '';
  try { me = Session.getEffectiveUser().getEmail(); } catch (e) {}
  const mode = String(m['Alert Mode'] || 'Instant').trim().toLowerCase();
  return {
    recipient: String(m['Recipient Email'] || '').trim() || me,
    keywords: String(m['Keywords'] || '').trim() === OLD_DEFAULT_KEYWORDS ? [] : splitList_(m['Keywords']),
    locKeywords: splitList_(m['Location Keywords'] || DEFAULT_LOCATIONS),
    exclude: splitList_(m['Exclude Title Keywords']),
    sendAlerts: bool_(m['Send Alerts'], true),
    tz: String(m['Time Zone'] || 'America/New_York').trim(),
    allowUnknown: bool_(m['Allow Unknown Eligibility Alerts'], true),
    blockCitizen: bool_(m['Block US Citizenship Requirement'], true),
    blockClearance: bool_(m['Block Clearance Requirement'], true),
    notifyFirstScan: bool_(m['Notify First Scan'], false),
    logAll: bool_(m['Log Non-Matching Jobs'], false),
    maxDesc: num_(m['Max Description Fetches Per Run'], 40),
    workdayMax: num_(m['Workday Max Jobs Per Company'], 1000),
    fullScanMax: num_(m['Full Scan Max Jobs'], 400),
    searchTerms: splitTerms_(m['Search Terms'] || SETTING_DEFAULTS.find(d => d[0] === 'Search Terms')[1]),
    minScore: num_(m['Minimum Match Score'], 3),
    descBoost: splitList_(m['Description Boost Terms']),
    maxAge: num_(m['Max Posting Age Days'], 45),
    alertMode: /daily/.test(mode) ? 'daily' : (/both/.test(mode) ? 'both' : 'instant'),
    dailyHour: Number(m['Daily Summary Hour']) >= 0 && m['Daily Summary Hour'] !== '' ? Number(m['Daily Summary Hour']) : 7,
    interval: num_(m['Check Interval Minutes'], 60),
    everyHigh: num_(m['High Priority Every N Runs'], 1),
    everyMedium: num_(m['Medium Priority Every N Runs'], 2),
    everyLow: num_(m['Low Priority Every N Runs'], 4),
    usajobsKey: String(m['USAJOBS API Key'] || '').trim(),
    usajobsEmail: String(m['USAJOBS Email'] || '').trim(),
    usajobsLocation: String(m['USAJOBS Location'] || '').trim(),
    reliefwebApp: String(m['ReliefWeb Appname'] || '').trim(),
    instantMinScore: num_(m['Instant Alert Min Score'], 6),
    portalUrl: String(m['Portal URL'] || '').trim()
  };
}

// =============================================================================================
// Small utilities
// =============================================================================================
function splitList_(v) { return String(v || '').split(/[,\n;]/).map(x => x.trim().toLowerCase()).filter(Boolean); }
function bool_(v, def) {
  if (v === '' || v === null || v === undefined) return def;
  if (typeof v === 'boolean') return v;
  return /^(true|yes|y|1|on)$/i.test(String(v).trim());
}
function num_(v, def) { const n = Number(v); return isFinite(n) && n > 0 ? n : def; }
function enc_(s) { return encodeURIComponent(String(s).trim()); }
function escapeRe_(s) { return String(s).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }
function hasWord_(text, kw) {
  return new RegExp('(^|[^a-z0-9])' + escapeRe_(String(kw).toLowerCase()) + '($|[^a-z0-9])').test(String(text || '').toLowerCase());
}
function fmtSalary_(min, max, cur, interval) {
  if (!min && !max) return '';
  const f = n => (n == null || n === '') ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return [(cur || '').toUpperCase(), [f(min), f(max)].filter(Boolean).join(' - '), interval ? '/ ' + String(interval).toLowerCase().replace(/^per[- ]?/, '') : ''].filter(Boolean).join(' ').trim();
}
function toSheetDate_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return isNaN(v) ? '' : v;
  if (typeof v === 'number') return new Date(v > 1e11 ? v : v * 1000);
  const s = String(v).trim();
  const ms = s.match(/\/Date\((\d+)/);
  if (ms) return new Date(Number(ms[1]));
  const d0 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (d0) return new Date(Number(d0[1]), Number(d0[2]) - 1, Number(d0[3]));
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) || /^[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{4}/.test(s) ||
      /^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4}/.test(s) || /^\d{1,2} [A-Z][a-z]{2,8} \d{4}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) return d;
  }
  return s;
}
function fmtDate_(d, tz) {
  try { return Utilities.formatDate(d, tz || 'America/New_York', 'MMM d, yyyy'); } catch (e) { return String(d); }
}
function fmtDateTime_(d, tz) {
  try { return Utilities.formatDate(d, tz || 'America/New_York', 'yyyy-MM-dd HH:mm'); } catch (e) { return String(d); }
}
function openPortalLink() {
  const s = readSettings_(ss_());
  let url = s.portalUrl;
  try { url = url || ScriptApp.getService().getUrl(); } catch (e) {}
  if (!url) { toast_('Deploy the portal first: Deploy > New deployment > Web app (see the setup guide).'); return; }
  const html = HtmlService.createHtmlOutput('<p style="font-family:Arial">Open your portal: <a href="' + url + '" target="_blank">' + url + '</a></p>').setWidth(420).setHeight(110);
  SpreadsheetApp.getUi().showModalDialog(html, 'Job Intelligence Portal');
}

function toast_(msg) {
  try { ss_().toast(msg, 'Job Monitor', 10); } catch (e) {}
}

// =============================================================================================
// SEED_ORGS: recommended organizations added by "2. Add recommended organizations".
// [Company, Career Page URL, Category, Location, Priority, Fit Notes, Platform (optional), Token (optional)]
// URLs point to the organization's careers page or home page. Discovery follows links from there,
// finds the job system and tests it, so a home page is fine.
// =============================================================================================
const SEED_ORGS = [
  [
  "Maryland State Jobs Portal",
  "https://www.jobapscloud.com/MD/",
  "Maryland State Government",
  "Statewide, MD",
  "High",
  "All Executive Branch agencies post here (MDH, MSDE, Labor, DHS, Commerce, MLDS Center, etc.). Includes agency, salary and filing deadline.",
  "JobAps",
  "MD"
  ],
  [
  "Maryland Department of Transportation (MDOT)",
  "https://www.governmentjobs.com/careers/mdotmd",
  "Maryland State Government",
  "Hanover / Baltimore, MD",
  "Medium",
  "Data, performance and planning analyst roles",
  "GovernmentJobs",
  "governmentjobs|mdotmd"
  ],
  [
  "ReliefWeb Jobs RSS (M&E, data, information management)",
  "https://reliefweb.int/jobs/rss.xml?search=%22monitoring%20and%20evaluation%22%20OR%20MEAL%20OR%20%22data%20analyst%22%20OR%20%22information%20management%22",
  "Job Feed (multi-employer)",
  "Global / home-based",
  "High",
  "Humanitarian and INGO jobs from hundreds of employers. Location filter keeps DMV and remote roles.",
  "RSS",
  "https://reliefweb.int/jobs/rss.xml?search=%22monitoring%20and%20evaluation%22%20OR%20MEAL%20OR%20%22data%20analyst%22%20OR%20%22information%20management%22"
  ],
  [
  "UN Careers job feed",
  "https://careers.un.org/jobfeed",
  "Job Feed (multi-employer)",
  "Global (New York, DC offices)",
  "Medium",
  "UN Secretariat openings (statistics, M&E, information management)",
  "RSS",
  "https://careers.un.org/jobfeed"
  ],
  [
  "USAJOBS API search (data, M&E, program analysis)",
  "https://developer.usajobs.gov/",
  "Job Feed (multi-employer)",
  "DC, MD, VA",
  "Medium",
  "Needs free API key in Settings. Uses the official clearance and hiring-path fields to drop cleared and internal-only jobs.",
  "USAJOBS",
  "data analyst; management and program analyst; statistician; program evaluation; data management; research analyst; data scientist"
  ],
  [
  "ReliefWeb API search (optional)",
  "https://apidoc.reliefweb.int/",
  "Job Feed (multi-employer)",
  "Global / home-based",
  "Low",
  "Needs approved ReliefWeb Appname in Settings. The RSS row above works without it.",
  "ReliefWeb",
  "monitoring and evaluation; MEAL; data analyst; information management officer"
  ],
  [
  "DC Office of the Chief Financial Officer (OCFO)",
  "https://cfo.dc.gov",
  "DC Government",
  "Washington, DC",
  "High",
  "Revenue, economic and fiscal analysts; own hiring system"
  ],
  [
  "DC Water",
  "https://www.dcwater.com",
  "DC Government",
  "Washington, DC",
  "Medium",
  "Independent authority; data and performance analysts"
  ],
  [
  "DC Housing Authority",
  "https://www.dchousing.org",
  "DC Government",
  "Washington, DC",
  "Medium",
  "Research and data roles"
  ],
  [
  "DC Public Charter School Board",
  "https://dcpcsb.org",
  "DC Government",
  "Washington, DC",
  "High",
  "School performance, assessment and data analysts"
  ],
  [
  "Office of the District of Columbia Auditor",
  "https://dcauditor.org",
  "DC Government",
  "Washington, DC",
  "Medium",
  "Audit and evaluation analysts"
  ],
  [
  "Council of the District of Columbia",
  "https://dccouncil.gov",
  "DC Government",
  "Washington, DC",
  "Medium",
  "Budget office and committee analysts"
  ],
  [
  "DC Health Benefit Exchange Authority",
  "https://hbx.dc.gov",
  "DC Government",
  "Washington, DC",
  "Medium",
  "Health data and reporting roles"
  ],
  [
  "University of the District of Columbia",
  "https://www.udc.edu",
  "DC Government",
  "Washington, DC",
  "Medium",
  "Institutional research and assessment roles"
  ],
  [
  "DC Courts",
  "https://www.dccourts.gov",
  "DC Government",
  "Washington, DC",
  "Low",
  "Research and statistics roles"
  ],
  [
  "DC Sustainable Energy Utility",
  "https://www.dcseu.com",
  "DC Government",
  "Washington, DC",
  "Low",
  "Program evaluation and data"
  ],
  [
  "DC Policy Center",
  "https://www.dcpolicycenter.org",
  "Think Tank / Research Institute",
  "Washington, DC",
  "Medium",
  "DC-focused research and data"
  ],
  [
  "DC Fiscal Policy Institute",
  "https://www.dcfpi.org",
  "Think Tank / Research Institute",
  "Washington, DC",
  "Medium",
  "Policy and data analysts"
  ],
  [
  "Raise DC",
  "https://raisedc.org",
  "Domestic Nonprofit",
  "Washington, DC",
  "Medium",
  "Education data partnership; data and evaluation"
  ],
  [
  "DC Primary Care Association",
  "https://www.dcpca.org",
  "Domestic Nonprofit",
  "Washington, DC",
  "Medium",
  "Health data and quality analysts"
  ],
  [
  "KIPP DC",
  "https://www.kippdc.org",
  "Domestic Nonprofit",
  "Washington, DC",
  "Medium",
  "Data, assessment and research team"
  ],
  [
  "Maryland Judiciary",
  "https://www.mdcourts.gov",
  "Maryland State Government",
  "Annapolis, MD",
  "Medium",
  "Court research and data analysts"
  ],
  [
  "Maryland Department of Legislative Services",
  "https://dls.maryland.gov",
  "Maryland State Government",
  "Annapolis, MD",
  "Medium",
  "Policy and fiscal analysts"
  ],
  [
  "Maryland Longitudinal Data System Center",
  "https://mldscenter.maryland.gov",
  "Maryland State Government",
  "Baltimore, MD",
  "High",
  "State education and workforce data center; research and data management"
  ],
  [
  "Maryland Health Benefit Exchange",
  "https://www.marylandhbe.com",
  "Maryland State Government",
  "Baltimore, MD",
  "Medium",
  "Health data and analytics"
  ],
  [
  "Health Services Cost Review Commission (HSCRC)",
  "https://hscrc.maryland.gov",
  "Maryland State Government",
  "Baltimore, MD",
  "High",
  "Hospital data and health economics analysts"
  ],
  [
  "University of Maryland, Baltimore (UMB)",
  "https://www.umaryland.edu",
  "University / Academic",
  "Baltimore, MD",
  "High",
  "Institute of Human Virology global health M&E, research data roles; MD background valued"
  ],
  [
  "Morgan State University",
  "https://www.morgan.edu",
  "University / Academic",
  "Baltimore, MD",
  "Medium",
  "Research and institutional assessment"
  ],
  [
  "Bowie State University",
  "https://www.bowiestate.edu",
  "University / Academic",
  "Bowie, MD",
  "Low",
  "Institutional research"
  ],
  [
  "Prince George's County Public Schools",
  "https://www.pgcps.org",
  "Local Government",
  "Upper Marlboro, MD",
  "Medium",
  "Testing, research and accountability office"
  ],
  [
  "Maryland-National Capital Park and Planning Commission",
  "https://www.mncppc.org",
  "Local Government",
  "Wheaton / Riverdale, MD",
  "Medium",
  "Montgomery Planning research and data analysts"
  ],
  [
  "WSSC Water",
  "https://www.wsscwater.com",
  "Local Government",
  "Laurel, MD",
  "Low",
  "Performance and data analysts"
  ],
  [
  "Housing Opportunities Commission of Montgomery County",
  "https://www.hocmc.org",
  "Local Government",
  "Kensington, MD",
  "Low",
  "Data and compliance"
  ],
  [
  "Anne Arundel County Government",
  "https://www.aacounty.org",
  "Local Government",
  "Annapolis, MD",
  "Low",
  "Performance and budget analysts"
  ],
  [
  "Baltimore County Government",
  "https://www.baltimorecountymd.gov",
  "Local Government",
  "Towson, MD",
  "Low",
  "Data and policy analysts"
  ],
  [
  "Baltimore City Government",
  "https://www.baltimorecity.gov",
  "Local Government",
  "Baltimore, MD",
  "Low",
  "Office of Performance and Innovation analysts"
  ],
  [
  "Montgomery County Collaboration Council",
  "https://www.collaborationcouncil.org",
  "Domestic Nonprofit",
  "Rockville, MD",
  "High",
  "Local data and evaluation for children and youth programs; close to home"
  ],
  [
  "Montgomery County Economic Development Corporation",
  "https://thinkmoco.com",
  "Local Government",
  "Rockville, MD",
  "Low",
  "Research and data"
  ],
  [
  "Insight Policy Research",
  "https://insightpolicyresearch.com",
  "Private Company - Consulting and Research",
  "Arlington, VA",
  "High",
  "Evaluation and research; data analyst roles"
  ],
  [
  "Manhattan Strategy Group",
  "https://www.manhattanstrategy.com",
  "Private Company - Consulting and Research",
  "Bethesda, MD",
  "High",
  "Evaluation, data and TA for education and workforce programs; near Rockville"
  ],
  [
  "JBS International",
  "https://www.jbsinternational.com",
  "Private Company - Consulting and Research",
  "North Bethesda, MD",
  "High",
  "Data, evaluation and health services research; near Rockville"
  ],
  [
  "MEF Associates",
  "https://www.mefassociates.com",
  "Private Company - Consulting and Research",
  "Alexandria, VA",
  "High",
  "Evaluation of social programs"
  ],
  [
  "2M Research",
  "https://www.2mresearch.com",
  "Private Company - Consulting and Research",
  "Arlington, VA",
  "Medium",
  "Research and evaluation"
  ],
  [
  "Atlas Research",
  "https://atlasresearch.us",
  "Private Company - Consulting and Research",
  "Washington, DC",
  "Medium",
  "Health and veterans research and analytics"
  ],
  [
  "Synergy Enterprises",
  "https://www.seiservices.com",
  "Private Company - Consulting and Research",
  "Silver Spring, MD",
  "Medium",
  "Evaluation and data for federal health and education"
  ],
  [
  "Cloudburst Group",
  "https://www.cloudburstgroup.com",
  "Private Company - Consulting and Research",
  "Landover, MD",
  "High",
  "Evaluation and data for housing and international programs"
  ],
  [
  "Apprio",
  "https://www.apprioinc.com",
  "Private Company - Consulting and Research",
  "Washington, DC",
  "Low",
  "Federal data and analytics (some cleared roles; screening applies)"
  ],
  [
  "Bixal",
  "https://www.bixal.com",
  "Private Company - Consulting and Research",
  "Fairfax, VA",
  "Medium",
  "Digital and data services for USAID and federal clients"
  ],
  [
  "Reingold",
  "https://reingold.com",
  "Private Company - Consulting and Research",
  "Alexandria, VA",
  "Low",
  "Research and insights roles"
  ],
  [
  "Ad Hoc LLC",
  "https://adhoc.team",
  "Startup / Tech",
  "Remote / DC",
  "Medium",
  "Government digital services; data roles"
  ],
  [
  "Nava PBC",
  "https://www.navapbc.com",
  "Startup / Tech",
  "Remote / DC",
  "Medium",
  "Public benefit tech company; data and research roles"
  ],
  [
  "Fearless",
  "https://fearless.tech",
  "Startup / Tech",
  "Baltimore, MD",
  "Medium",
  "Gov tech; data analysts"
  ],
  [
  "Skylight",
  "https://skylight.digital",
  "Startup / Tech",
  "Remote",
  "Low",
  "Gov digital services"
  ],
  [
  "Coforma",
  "https://coforma.io",
  "Startup / Tech",
  "Remote / DC",
  "Low",
  "Gov digital services; research and data"
  ],
  [
  "QED Group",
  "https://www.qedgroupllc.com",
  "Private Company - Development Contractor",
  "Washington, DC",
  "High",
  "USAID MEL contractor"
  ],
  [
  "Headlight Consulting Services",
  "https://headlightconsultingservices.com",
  "Private Company - Development Contractor",
  "DC area / remote",
  "High",
  "MEL and data services"
  ],
  [
  "Environmental Incentives",
  "https://enviroincentives.com",
  "Private Company - Development Contractor",
  "Washington, DC",
  "Medium",
  "MEL and learning roles"
  ],
  [
  "Pragma Corporation",
  "https://www.pragmacorp.com",
  "Private Company - Development Contractor",
  "Falls Church, VA",
  "Medium",
  "International development; M&E roles"
  ],
  [
  "DevTech Systems",
  "https://devtechsys.com",
  "Private Company - Development Contractor",
  "Arlington, VA",
  "Medium",
  "Economic analysis and M&E"
  ],
  [
  "Inclusive Development Partners",
  "https://www.inclusivedevpartners.com",
  "Private Company - Development Contractor",
  "Washington, DC",
  "Low",
  "Education M&E"
  ],
  [
  "IDinsight",
  "https://www.idinsight.org",
  "Research Institution",
  "DC / remote",
  "High",
  "M&E, impact evaluation and data roles"
  ],
  [
  "Innovations for Poverty Action (IPA)",
  "https://poverty-action.org",
  "Research Institution",
  "DC / remote",
  "High",
  "Research and data management roles"
  ],
  [
  "International Initiative for Impact Evaluation (3ie)",
  "https://www.3ieimpact.org",
  "Research Institution",
  "Washington, DC",
  "High",
  "Impact evaluation and evidence synthesis"
  ],
  [
  "International Center for Research on Women (ICRW)",
  "https://www.icrw.org",
  "Research Institution",
  "Washington, DC",
  "High",
  "Research and MEL"
  ],
  [
  "Results for America",
  "https://results4america.org",
  "Think Tank / Research Institute",
  "Washington, DC",
  "High",
  "Evidence and data policy"
  ],
  [
  "Data Quality Campaign",
  "https://dataqualitycampaign.org",
  "Domestic Nonprofit",
  "Washington, DC",
  "High",
  "Education data policy"
  ],
  [
  "Center for Law and Social Policy (CLASP)",
  "https://www.clasp.org",
  "Think Tank / Research Institute",
  "Washington, DC",
  "Medium",
  "Policy research and data"
  ],
  [
  "National Academy of Public Administration",
  "https://napawash.org",
  "Think Tank / Research Institute",
  "Washington, DC",
  "Medium",
  "Research and analysis"
  ],
  [
  "Information Technology and Innovation Foundation (ITIF)",
  "https://itif.org",
  "Think Tank / Research Institute",
  "Washington, DC",
  "Low",
  "Data and policy research"
  ],
  [
  "Henry M. Jackson Foundation (HJF)",
  "https://www.hjf.org",
  "Research Institution",
  "Bethesda, MD",
  "High",
  "Research data management and analyst roles; some cleared roles are screened out"
  ],
  [
  "J. Craig Venter Institute",
  "https://www.jcvi.org",
  "Research Institution",
  "Rockville, MD",
  "Medium",
  "Research data roles in Rockville"
  ],
  [
  "Howard Hughes Medical Institute (HHMI)",
  "https://www.hhmi.org",
  "Research Institution",
  "Chevy Chase, MD",
  "Medium",
  "Data and research operations"
  ],
  [
  "Frederick National Laboratory for Cancer Research",
  "https://frederick.cancer.gov",
  "Research Institution",
  "Frederick / Rockville, MD",
  "Medium",
  "Clinical and research data management"
  ],
  [
  "Kennedy Krieger Institute",
  "https://www.kennedykrieger.org",
  "Research Institution",
  "Baltimore, MD",
  "Medium",
  "Research data and evaluation"
  ],
  [
  "Carnegie Science",
  "https://carnegiescience.edu",
  "Research Institution",
  "Washington, DC",
  "Low",
  "Research data"
  ],
  [
  "Morning Consult",
  "https://morningconsult.com",
  "Startup / Tech",
  "Washington, DC",
  "Medium",
  "Survey research and data analysts"
  ],
  [
  "Pathfinder International",
  "https://www.pathfinder.org",
  "International Development NGO",
  "Washington, DC",
  "Medium",
  "MEL and research roles"
  ],
  [
  "PAI",
  "https://pai.org",
  "International Development NGO",
  "Washington, DC",
  "Medium",
  "Research and data"
  ],
  [
  "Helen Keller Intl",
  "https://helenkellerintl.org",
  "International Development NGO",
  "Remote / NY",
  "Medium",
  "M&E and data roles"
  ],
  [
  "International Medical Corps",
  "https://internationalmedicalcorps.org",
  "International Development NGO",
  "Washington, DC",
  "Medium",
  "MEAL and information management"
  ],
  [
  "Relief International",
  "https://www.ri.org",
  "International Development NGO",
  "Washington, DC",
  "Medium",
  "MEAL roles; Afghanistan program history"
  ],
  [
  "Oxfam America",
  "https://www.oxfamamerica.org",
  "International Development NGO",
  "Washington, DC / Boston",
  "Medium",
  "MEL and research"
  ],
  [
  "Conservation International",
  "https://www.conservation.org",
  "International Development NGO",
  "Arlington, VA",
  "Medium",
  "MEL and data roles"
  ],
  [
  "The Nature Conservancy",
  "https://www.nature.org",
  "International Development NGO",
  "Arlington, VA",
  "Medium",
  "Measures and data roles"
  ],
  [
  "World Wildlife Fund",
  "https://www.worldwildlife.org",
  "International Development NGO",
  "Washington, DC",
  "Medium",
  "MEL and data roles"
  ],
  [
  "American Councils for International Education",
  "https://www.americancouncils.org",
  "International Development NGO",
  "Washington, DC",
  "Medium",
  "Research and assessment"
  ],
  [
  "Institute of International Education (IIE)",
  "https://www.iie.org",
  "International Development NGO",
  "Washington, DC",
  "Medium",
  "Research and evaluation"
  ],
  [
  "Meridian International Center",
  "https://www.meridian.org",
  "International Development NGO",
  "Washington, DC",
  "Low",
  "Program data"
  ],
  [
  "PYXERA Global",
  "https://www.pyxeraglobal.org",
  "International Development NGO",
  "Washington, DC",
  "Low",
  "Impact measurement"
  ],
  [
  "Pan American Development Foundation (PADF)",
  "https://www.padf.org",
  "International Development NGO",
  "Washington, DC",
  "Medium",
  "M&E roles"
  ],
  [
  "World Food Program USA",
  "https://www.wfpusa.org",
  "International Development NGO",
  "Washington, DC",
  "Medium",
  "Data and research"
  ],
  [
  "United Nations Foundation",
  "https://unfoundation.org",
  "International Development NGO",
  "Washington, DC",
  "Medium",
  "MEL and data"
  ],
  [
  "ChildFund International",
  "https://www.childfund.org",
  "International Development NGO",
  "Richmond, VA / remote",
  "Medium",
  "MEAL roles"
  ],
  [
  "Clinton Health Access Initiative (CHAI)",
  "https://www.clintonhealthaccess.org",
  "International Development NGO",
  "Remote / Boston",
  "Medium",
  "Health data and M&E roles"
  ],
  [
  "ActionAid USA",
  "https://www.actionaidusa.org",
  "International Development NGO",
  "Washington, DC",
  "Low",
  "Program and data"
  ],
  [
  "DataKind",
  "https://www.datakind.org",
  "Domestic Nonprofit",
  "Remote",
  "Medium",
  "Data science for social impact"
  ],
  [
  "Code for America",
  "https://codeforamerica.org",
  "Domestic Nonprofit",
  "Remote",
  "Medium",
  "Data and research roles"
  ],
  [
  "International Monetary Fund (IMF)",
  "https://www.imf.org/en/About/Recruitment",
  "International Organization",
  "Washington, DC",
  "Medium",
  "Statistics and data management roles"
  ],
  [
  "Inter-American Development Bank (IDB)",
  "https://www.iadb.org",
  "International Organization",
  "Washington, DC",
  "High",
  "Evaluation (OVE), data and research roles"
  ],
  [
  "Pan American Health Organization (PAHO)",
  "https://www.paho.org",
  "International Organization",
  "Washington, DC",
  "High",
  "Health information, data and M&E; MD background valued"
  ],
  [
  "Organization of American States (OAS)",
  "https://www.oas.org",
  "International Organization",
  "Washington, DC",
  "Medium",
  "Program evaluation and data"
  ],
  [
  "CohnReznick",
  "https://www.cohnreznick.com",
  "Accounting and Financial",
  "Bethesda, MD",
  "High",
  "HQ near Rockville; government and nonprofit advisory, data analytics"
  ],
  [
  "Aprio",
  "https://www.aprio.com",
  "Accounting and Financial",
  "Rockville, MD office",
  "Medium",
  "Rockville office; advisory and analytics"
  ],
  [
  "CBIZ",
  "https://www.cbiz.com",
  "Accounting and Financial",
  "Bethesda / Rockville, MD",
  "Medium",
  "Advisory and data roles"
  ],
  [
  "RSM US",
  "https://rsmus.com",
  "Accounting and Financial",
  "McLean, VA",
  "Medium",
  "Data analytics and government consulting"
  ],
  [
  "BDO USA",
  "https://www.bdo.com",
  "Accounting and Financial",
  "McLean, VA",
  "Medium",
  "Public sector advisory"
  ],
  [
  "CliftonLarsonAllen (CLA)",
  "https://www.claconnect.com",
  "Accounting and Financial",
  "Arlington, VA / Baltimore, MD",
  "Medium",
  "Nonprofit and government advisory"
  ],
  [
  "Baker Tilly",
  "https://www.bakertilly.com",
  "Accounting and Financial",
  "Tysons, VA",
  "Medium",
  "Analytics and public sector"
  ],
  [
  "Cotton & Company",
  "https://www.cottoncpa.com",
  "Accounting and Financial",
  "Alexandria, VA",
  "Medium",
  "Federal audit; data analytics"
  ],
  [
  "Williams Adley",
  "https://www.williamsadley.com",
  "Accounting and Financial",
  "Washington, DC",
  "Medium",
  "Federal audit and performance"
  ],
  [
  "SB & Company",
  "https://www.sbandcompany.com",
  "Accounting and Financial",
  "Hunt Valley, MD / DC",
  "Medium",
  "Public sector audit and advisory"
  ],
  [
  "Forvis Mazars",
  "https://www.forvismazars.us",
  "Accounting and Financial",
  "Tysons, VA",
  "Low",
  "Advisory"
  ],
  [
  "Crowe",
  "https://www.crowe.com",
  "Accounting and Financial",
  "Washington, DC",
  "Low",
  "Advisory and analytics"
  ],
  [
  "Withum",
  "https://www.withum.com",
  "Accounting and Financial",
  "Washington, DC area",
  "Low",
  "Advisory"
  ],
  [
  "FINRA",
  "https://www.finra.org/careers",
  "Financial Organization",
  "Rockville, MD / DC",
  "High",
  "Rockville office; many data analyst roles"
  ],
  [
  "Navy Federal Credit Union",
  "https://www.navyfederal.org",
  "Financial Organization",
  "Vienna, VA",
  "Medium",
  "Data and analytics roles"
  ],
  [
  "PenFed Credit Union",
  "https://www.penfed.org",
  "Financial Organization",
  "Tysons, VA",
  "Low",
  "Data and analytics"
  ],
  [
  "Farmer Mac",
  "https://www.farmermac.com",
  "Financial Organization",
  "Washington, DC",
  "Low",
  "Data and risk analytics"
  ],
  [
  "Calvert Impact",
  "https://calvertimpact.org",
  "Financial Organization",
  "Bethesda, MD",
  "Medium",
  "Impact measurement and data"
  ],
  [
  "Opportunity Finance Network",
  "https://www.ofn.org",
  "Financial Organization",
  "Washington, DC",
  "Medium",
  "Research and data"
  ],
  [
  "LISC (Local Initiatives Support Corporation)",
  "https://www.lisc.org",
  "Financial Organization",
  "Washington, DC",
  "Medium",
  "Research, data and impact measurement"
  ],
  [
  "Enterprise Community Partners",
  "https://www.enterprisecommunity.org",
  "Financial Organization",
  "Columbia, MD",
  "High",
  "Research, data and impact roles"
  ],
  [
  "T. Rowe Price",
  "https://www.troweprice.com",
  "Financial Organization",
  "Baltimore, MD",
  "Low",
  "Data and analytics"
  ],
  [
  "Carlyle Group",
  "https://www.carlyle.com",
  "Financial Organization",
  "Washington, DC",
  "Low",
  "Data and analytics"
  ],
  [
  "Aledade",
  "https://aledade.com",
  "Startup / Tech",
  "Bethesda, MD",
  "High",
  "Health data analytics; close to Rockville; MD background fits"
  ],
  [
  "Arcadia",
  "https://arcadia.io",
  "Startup / Tech",
  "Remote",
  "Medium",
  "Health data platform"
  ],
  [
  "FiscalNote",
  "https://fiscalnote.com",
  "Startup / Tech",
  "Washington, DC",
  "Medium",
  "Policy data and analysts"
  ],
  [
  "Quorum",
  "https://www.quorum.us",
  "Startup / Tech",
  "Washington, DC",
  "Medium",
  "Public affairs data"
  ],
  [
  "Socially Determined",
  "https://www.sociallydetermined.com",
  "Startup / Tech",
  "Washington, DC",
  "Medium",
  "Social risk data analytics"
  ],
  [
  "CoStar Group",
  "https://www.costargroup.com",
  "Private Company",
  "Washington, DC",
  "Medium",
  "Data research analysts"
  ],
  [
  "GEICO",
  "https://www.geico.com",
  "Private Company",
  "Chevy Chase, MD",
  "Medium",
  "Data analyst roles near Rockville"
  ],
  [
  "Axios",
  "https://www.axios.com",
  "Startup / Tech",
  "Arlington, VA",
  "Low",
  "Data roles"
  ],
  [
  "Higher Logic",
  "https://www.higherlogic.com",
  "Startup / Tech",
  "Arlington, VA",
  "Low",
  "Analytics"
  ],
  [
  "Cvent",
  "https://www.cvent.com",
  "Startup / Tech",
  "Tysons, VA",
  "Low",
  "Analytics"
  ],
  [
  "Appian",
  "https://appian.com",
  "Startup / Tech",
  "McLean, VA",
  "Low",
  "Data and analytics"
  ],
  [
  "Hughes Network Systems",
  "https://www.hughes.com",
  "Private Company",
  "Germantown, MD",
  "Low",
  "Data analysts; near Rockville"
  ],
  [
  "Host Hotels & Resorts",
  "https://www.hosthotels.com",
  "Private Company",
  "Bethesda, MD",
  "Low",
  "Analytics"
  ],
  [
  "Optoro",
  "https://www.optoro.com",
  "Startup / Tech",
  "Washington, DC",
  "Low",
  "Data analytics"
  ],
  [
  "Catalist",
  "https://catalist.us",
  "Startup / Tech",
  "Washington, DC",
  "Low",
  "Data and analytics"
  ],
  [
  "U.S. Pharmacopeia (USP)",
  "https://www.usp.org",
  "Association / Industry Organization",
  "Rockville, MD",
  "High",
  "Rockville; data, analytics and global health programs"
  ],
  [
  "American Speech-Language-Hearing Association (ASHA)",
  "https://www.asha.org",
  "Association / Industry Organization",
  "Rockville, MD",
  "High",
  "Rockville; research and data analyst roles"
  ],
  [
  "American Occupational Therapy Association (AOTA)",
  "https://www.aota.org",
  "Association / Industry Organization",
  "North Bethesda, MD",
  "Medium",
  "Research and data"
  ],
  [
  "FASEB",
  "https://www.faseb.org",
  "Association / Industry Organization",
  "Rockville, MD",
  "Medium",
  "Data and research analysis"
  ],
  [
  "American Society of Health-System Pharmacists (ASHP)",
  "https://www.ashp.org",
  "Association / Industry Organization",
  "Bethesda, MD",
  "Medium",
  "Research and data"
  ],
  [
  "AcademyHealth",
  "https://academyhealth.org",
  "Association / Industry Organization",
  "Washington, DC",
  "High",
  "Health services research and data"
  ],
  [
  "National Committee for Quality Assurance (NCQA)",
  "https://www.ncqa.org",
  "Association / Industry Organization",
  "Washington, DC",
  "High",
  "Health quality measurement and data analysts"
  ],
  [
  "Council of Chief State School Officers (CCSSO)",
  "https://ccsso.org",
  "Association / Industry Organization",
  "Washington, DC",
  "High",
  "Assessment and education data roles"
  ],
  [
  "Association of Schools and Programs of Public Health (ASPPH)",
  "https://www.aspph.org",
  "Association / Industry Organization",
  "Washington, DC",
  "Medium",
  "Data analytics and research"
  ],
  [
  "National Association of State Workforce Agencies (NASWA)",
  "https://www.naswa.org",
  "Association / Industry Organization",
  "Washington, DC",
  "Medium",
  "Workforce data and research"
  ],
  [
  "Council for Community and Economic Research (C2ER)",
  "https://www.c2er.org",
  "Association / Industry Organization",
  "Arlington, VA",
  "Medium",
  "Economic data research"
  ],
  [
  "American Association for Public Opinion Research (AAPOR)",
  "https://aapor.org",
  "Association / Industry Organization",
  "Alexandria, VA",
  "Medium",
  "Survey research community"
  ],
  [
  "Association for Public Policy Analysis and Management (APPAM)",
  "https://www.appam.org",
  "Association / Industry Organization",
  "Washington, DC",
  "Low",
  "Policy research"
  ],
  [
  "National Association of Medicaid Directors",
  "https://medicaiddirectors.org",
  "Association / Industry Organization",
  "Washington, DC",
  "Low",
  "Health policy data"
  ],
  [
  "Maryland Hospital Association",
  "https://www.mhaonline.org",
  "Association / Industry Organization",
  "Elkridge, MD",
  "Medium",
  "Hospital data analysts"
  ],
  [
  "Mid-Atlantic Association of Community Health Centers",
  "https://www.machc.com",
  "Association / Industry Organization",
  "Columbia, MD",
  "Medium",
  "Health center data and quality"
  ],
  [
  "Endocrine Society",
  "https://www.endocrine.org",
  "Association / Industry Organization",
  "Washington, DC",
  "Low",
  "Data and research"
  ],
  [
  "American Society for Microbiology",
  "https://asm.org",
  "Association / Industry Organization",
  "Washington, DC",
  "Low",
  "Data and programs"
  ],
  [
  "American Chemical Society",
  "https://www.acs.org",
  "Association / Industry Organization",
  "Washington, DC",
  "Low",
  "Data and analytics"
  ],
  [
  "American Bankers Association",
  "https://www.aba.com",
  "Association / Industry Organization",
  "Washington, DC",
  "Low",
  "Research and data"
  ],
  [
  "Mortgage Bankers Association",
  "https://www.mba.org",
  "Association / Industry Organization",
  "Washington, DC",
  "Low",
  "Research and economics"
  ],
  [
  "National Association of Realtors",
  "https://www.nar.realtor",
  "Association / Industry Organization",
  "Washington, DC",
  "Low",
  "Research group data analysts"
  ],
  [
  "AICPA & CIMA",
  "https://www.aicpa-cima.com",
  "Association / Industry Organization",
  "Washington, DC / Durham, NC",
  "Low",
  "Research and analytics"
  ],
  [
  "Maryland Association of CPAs",
  "https://www.macpa.org",
  "Association / Industry Organization",
  "Timonium, MD",
  "Low",
  "Accounting industry body"
  ],
  [
  "Consumer Technology Association",
  "https://www.cta.tech",
  "Association / Industry Organization",
  "Arlington, VA",
  "Low",
  "Market research and data"
  ],
  [
  "Edison Electric Institute",
  "https://www.eei.org",
  "Association / Industry Organization",
  "Washington, DC",
  "Low",
  "Data and analysis"
  ],
  [
  "Catholic University of America",
  "https://www.catholic.edu",
  "University / Academic",
  "Washington, DC",
  "Medium",
  "Institutional research and assessment"
  ],
  [
  "Gallaudet University",
  "https://gallaudet.edu",
  "University / Academic",
  "Washington, DC",
  "Low",
  "Institutional research"
  ],
  [
  "Trinity Washington University",
  "https://www.trinitydc.edu",
  "University / Academic",
  "Washington, DC",
  "Low",
  "Assessment and data"
  ],
  [
  "Loyola University Maryland",
  "https://www.loyola.edu",
  "University / Academic",
  "Baltimore, MD",
  "Low",
  "Institutional research"
  ],
  [
  "Hood College",
  "https://www.hood.edu",
  "University / Academic",
  "Frederick, MD",
  "Low",
  "Institutional research"
  ],
  [
  "Marymount University",
  "https://marymount.edu",
  "University / Academic",
  "Arlington, VA",
  "Low",
  "Institutional research"
  ],
  [
  "Prince George's Community College",
  "https://www.pgcc.edu",
  "University / Academic",
  "Largo, MD",
  "Low",
  "Institutional research and assessment"
  ],
  [
  "Northern Virginia Community College",
  "https://www.nvcc.edu",
  "University / Academic",
  "Annandale, VA",
  "Low",
  "Institutional research"
  ],
  [
  "Bainum Family Foundation",
  "https://bainumfdn.org",
  "Domestic Nonprofit",
  "Bethesda, MD",
  "Medium",
  "Evaluation and learning roles"
  ],
  [
  "Latino Economic Development Center",
  "https://www.ledcmetro.org",
  "Domestic Nonprofit",
  "Washington, DC",
  "Low",
  "Program data and evaluation"
  ],
  [
  "City Year Washington DC",
  "https://www.cityyear.org",
  "Domestic Nonprofit",
  "Washington, DC",
  "Low",
  "Impact and data roles"
  ],
  [
  "Maryland Center on Economic Policy",
  "https://www.mdeconomy.org",
  "Think Tank / Research Institute",
  "Baltimore, MD",
  "Low",
  "Policy research"
  ]
  ];
