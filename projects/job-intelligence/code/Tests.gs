/**
 * Self-tests for the Job Monitor engine and the portal backend.
 *
 * Run: Job Monitor menu > "Run self-tests", or in the Apps Script editor choose runAllTests and click Run.
 * Safe: works on temporary tabs named _TEST_..., uses fake job-site responses and a fake mailer, then
 * deletes the temporary tabs. Your real Companies, Jobs, Settings, triggers and emails are not touched.
 */
function runAllTests() {
  const results = [];
  const test = (name, fn) => {
    try { fn(); results.push(['PASS', name, '']); }
    catch (e) { results.push(['FAIL', name, String(e && e.stack ? e.message : e)]); }
  };
  const eq = (got, want, msg) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error((msg ? msg + ': ' : '') + 'expected ' + JSON.stringify(want) + ', got ' + JSON.stringify(got)); };
  const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

  // ---------------------------------------------------------------- unit tests
  const s = Object.assign(readSettings_(ss_()), { keywords: [], exclude: [], minScore: 3, blockCitizen: true, blockClearance: true,
    locKeywords: splitList_(DEFAULT_LOCATIONS), descBoost: ['power bi', 'stata'] });
  const pats = (() => { const p = DEFAULT_PATTERNS.map(x => ({ text: x[0], type: x[1], weight: x[2], re: patternRe_(x[0]) })); p.minScore = 3; return p; })();
  const pad = ' The team supports programs across the region and reports to senior leadership on results. '.repeat(4);

  test('Matching: target roles match', () => {
    ['Senior Data Analyst', 'Monitoring and Evaluation Specialist', 'MEAL Officer', 'M&E Manager', 'Data Specialist', 'Data Officer', 'Data Manager',
     'Evaluation Specialist', 'Assessment Specialist', 'Research and Data Management Associate', 'Monitoring Officer',
     'Performance Management and Data Analyst II'].forEach(t => ok(titleScore_(t, pats).match, t + ' should match'));
  });
  test('Matching: unrelated, junior and cleared titles do not match', () => {
    ['Accountant II', 'Data Entry Clerk', 'Research Intern', 'Network Monitoring Engineer', 'Data Analyst - TS/SCI', 'Meal Delivery Driver', 'Software Engineer']
      .forEach(t => ok(!titleScore_(t, pats).match, t + ' should not match'));
  });
  test('Eligibility: explicit clearance is blocked', () => eq(eligibility_({ desc: pad + 'Must hold an active Secret clearance.' + pad }, s).status, 'Blocked: Clearance'));
  test('Eligibility: polygraph is blocked', () => eq(eligibility_({ desc: pad + 'Requires a CI polygraph.' + pad }, s).status, 'Blocked: Clearance'));
  test('Eligibility: explicit citizenship is blocked', () => eq(eligibility_({ desc: pad + 'Applicants must be a U.S. citizen.' + pad }, s).status, 'Blocked: Citizenship'));
  test('Eligibility: Public Trust is allowed', () => eq(eligibility_({ desc: pad + 'Ability to obtain a Public Trust.' + pad }, s).status, 'OK'));
  test('Eligibility: unclear wording is Needs Review', () => {
    eq(eligibility_({ desc: pad + 'Selected candidates must pass a federal background check.' + pad }, s).status, 'Needs Review');
    eq(eligibility_({ desc: pad + 'U.S. citizen or green card holder required.' + pad }, s).status, 'Needs Review');
    eq(eligibility_({ desc: 'Short text' }, s).status, 'Needs Review');
  });
  test('Eligibility: USAJOBS clearance field is respected', () => {
    eq(eligibility_({ desc: '', clearance: 'Secret' }, s).status, 'Blocked: Clearance');
    ok(eligibility_({ desc: pad, clearance: 'Not Required' }, s).status !== 'Blocked: Clearance');
  });
  test('Data: Job ID is stable and short', () => {
    const a = jobId_('Greenhouse|acme|123'), b = jobId_('Greenhouse|acme|123'), c = jobId_('Greenhouse|acme|124');
    eq(a, b); ok(a !== c, 'different keys need different ids'); ok(/^J[0-9A-F]{10}$/.test(a), 'format ' + a);
  });
  test('Data: work mode and salary parsing', () => {
    eq(workMode_({ location: 'Washington, DC (Hybrid)' }), 'Hybrid');
    eq(workMode_({ location: 'Remote - US' }), 'Remote');
    eq(workMode_({ location: 'Rockville, MD' }), 'On-site');
    eq(salaryRange_('$81,122.00 - $100,186.00 Annually'), [81122, 100186]);
    eq(salaryRange_('$45 - $55 per hour'), [93600, 114400]);
    eq(salaryRange_('Competitive'), ['', '']);
  });
  test('Feedback: clear reasons propose a rule, vague remarks do not', () => {
    eq(proposeRuleFor_({ skipReason: 'Company not a fit', company: 'Acme' }).type, 'COMPANY');
    eq(proposeRuleFor_({ skipReason: 'Other', remarks: 'avoid title: senior director' }).pattern, 'senior director');
    eq(proposeRuleFor_({ skipReason: 'Seniority mismatch', remarks: 'too junior for me' }), null);
    eq(proposeRuleFor_({ skipReason: 'Other', remarks: 'not interested' }), null);
  });
  test('Parsers: Maryland JobAps rows', () => {
    const html = '<table><tr><td><a href="sup/bulpreview.asp?b=&R1=26&R2=001111&R3=0001">ADMINISTRATOR II (Data Analyst)</a></td><td>Anne Arundel</td><td>MD Department of Health</td><td>$70,000 - $110,000/ year</td><td>Friday, December 19, 2026 11:59 PM</td></tr></table>';
    const r = jobapsRows_(html, 'https://www.jobapscloud.com/MD/')[0];
    eq(r.id, '26-001111-0001'); eq(r.location, 'Anne Arundel, MD'); ok(/Department of Health/.test(r.employer)); eq(r.closing, 'December 19, 2026');
  });
  test('Parsers: RSS item with organization and location', () => {
    const x = rssItems_('<rss><channel><title>Feed</title><item><title>MEAL Officer</title><link>https://x.org/j/1</link><description><![CDATA[Organization: Mercy Corps<br>Country: Afghanistan]]></description></item></channel></rss>', 'https://x.org/rss')[0];
    eq([x.title, x.employer, x.location], ['MEAL Officer', 'Mercy Corps', 'Afghanistan']);
  });
  test('Parsers: USAJOBS internal-only jobs are flagged', () => {
    const j = usajobsJob_({ MatchedObjectId: '1', MatchedObjectDescriptor: { PositionTitle: 'Program Analyst', PositionURI: 'u', UserArea: { Details: { HiringPath: ['fed-internal-search'], SecurityClearance: 'Not Required' } } } });
    ok(j.notPublic, 'notPublic expected');
  });

  // ---------------------------------------------------------------- end-to-end tests in a sandbox
  try {
    withTestSandbox_(ss => {
      const fake = makeFakeWeb_();
      const sent = [];
      HTTP_ = fake;
      MAILER_ = { sendEmail: o => sent.push(o) };
      seedSandbox_(ss);
      const jobs = () => readJobs_(ss, true);
      const byTitle = (t, plat) => { const d = jobs(); return d.rows.map(r => toItem_(r, d.idx)).filter(it => it.title === t && (!plat || it.platform === plat))[0]; };
      const dueAll = () => { const sh = ss.getSheetByName(CFG.SHEET_COMPANIES); const c = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].indexOf('Last Checked') + 1; sh.getRange(2, c, sh.getLastRow() - 1, 1).clearContent(); };

      fake.round = 1; runMonitor_();
      test('Discovery: first scan saves existing matching jobs as a baseline', () => {
        const d = jobs();
        eq(d.rows.length, 2, 'rows after baseline');
        eq(sent.length, 0, 'no email on the first scan');
      });
      test('Data: every saved job has a unique stable Job ID', () => {
        const d = jobs(); const ids = d.rows.map(r => r[d.idx['Job ID']]);
        ok(ids.every(Boolean), 'blank id'); eq(new Set(ids).size, ids.length, 'duplicate ids');
        d.rows.forEach(r => eq(r[d.idx['Job ID']], jobId_(r[d.idx['Job Key']])));
      });

      dueAll(); fake.round = 2; runMonitor_();
      test('Discovery: new jobs are added and emailed once', () => {
        eq(sent.length, 1, 'emails after second scan');
        ok(/Monitoring and Evaluation Specialist/.test(sent[0].htmlBody), 'new job in email');
        eq((sent[0].htmlBody.match(/Monitoring and Evaluation Specialist<\/a>/g) || []).length, 1, 'job listed once');
      });
      test('Eligibility: blocked jobs are saved but never emailed', () => {
        eq(byTitle('Data Manager').eligibility, 'Blocked: Clearance');
        eq(byTitle('Research Data Analyst').eligibility, 'Blocked: Citizenship');
        ok(!/Data Manager|Research Data Analyst/.test(sent[0].htmlBody), 'blocked job was emailed');
      });
      test('Matching: cleared titles are not saved at all', () => ok(!byTitle('Data Analyst (TS/SCI)'), 'cleared title saved'));
      test('Duplicates: same job from a second source is flagged, not re-sent', () => eq(byTitle('Monitoring and Evaluation Specialist', 'RSS').match, 'Possible duplicate'));
      test('Notifications: email links to the job in the portal', () => {
        const j = byTitle('Monitoring and Evaluation Specialist', 'Greenhouse');
        ok(sent[0].htmlBody.indexOf('?job=' + j.id) >= 0, 'portal link missing');
        eq(sent[0].to, 'test@example.com');
      });

      const before = jobs().rows.length;
      dueAll(); fake.round = 2; runMonitor_();
      test('Duplicates: re-checking the same jobs adds no rows and sends no email', () => {
        eq(jobs().rows.length, before, 'rows changed'); eq(sent.length, 1, 'extra email');
      });

      dueAll(); fake.round = 3; runMonitor_();
      test('Data: a job removed from the site is marked as no longer open', () => ok(/^No/.test(byTitle('Senior Data Analyst').stillOpen), 'still open = ' + byTitle('Senior Data Analyst').stillOpen));

      // Portal: status updates
      const me = byTitle('Monitoring and Evaluation Specialist', 'Greenhouse');
      let res = api_updateJob(me.id, { status: 'Applied', notes: 'Referred by a contact' }, me.updatedAt);
      test('Portal: status update saves to the right row', () => {
        ok(res.ok, JSON.stringify(res));
        const it = byTitle('Monitoring and Evaluation Specialist', 'Greenhouse');
        eq([it.status, it.notes], ['Applied', 'Referred by a contact']);
        ok(it.applicationDate, 'application date should be set automatically');
        const others = jobs().rows.map(r => toItem_(r, jobs().idx)).filter(x => x.id !== me.id && x.status === 'Applied');
        eq(others.length, 0, 'another row was changed');
      });
      test('Portal: every change is written to the Activity Log', () => {
        const h = activityFor_(ss, me.id).map(x => x.field);
        ok(h.indexOf('Application Status') >= 0 && h.indexOf('Notes') >= 0, JSON.stringify(h));
      });
      test('Portal: a stale edit is refused instead of overwriting', () => {
        const r2 = api_updateJob(me.id, { status: 'Interview' }, '2000-01-01T00:00:00.000Z');
        ok(r2.conflict, 'expected conflict'); eq(byTitle('Monitoring and Evaluation Specialist', 'Greenhouse').status, 'Applied');
      });
      test('Portal: search views and filters', () => {
        eq(api_search({ view: 'applied' }).items.map(x => x.id), [me.id]);
        const wk = api_search({ view: 'month' }).items.map(x => x.title);
        ok(wk.indexOf('Data Manager') < 0, 'blocked job shown by default');
        ok(api_search({ view: 'month', showAll: true }).items.some(x => x.title === 'Data Manager'), 'showAll should include blocked');
        ok(api_search({ view: 'all', text: 'monitoring evaluation' }).items.length >= 1, 'text search');
        eq(api_search({ view: 'all', eligibility: 'Blocked' }).total, 2);
      });
      test('Portal: dashboard data loads', () => {
        const b = api_bootstrap();
        ok(b.counts && b.charts && b.facets && b.health, 'missing sections');
        eq(b.counts.applied, 1);
      });

      // Feedback rules: proposals need approval
      const skipMe = byTitle('Senior Data Analyst');
      const sk = api_updateJob(skipMe.id, { status: 'Skipped', skipReason: 'Company not a fit' }, skipMe.updatedAt);
      test('Feedback: skipping proposes a rule that is not active yet', () => {
        ok(sk.proposal && sk.proposal.type === 'COMPANY', JSON.stringify(sk.proposal));
        eq(readRules_(ss).length, 0, 'proposed rule must not be active');
      });
      test('Feedback: approving and disabling a rule', () => {
        const r = api_listRules().find(x => x.id === sk.proposal.id);
        api_saveRule(r, 'approve'); eq(readRules_(ss).map(x => x.id), [r.id]);
        api_saveRule(r, 'disable'); eq(readRules_(ss).length, 0);
      });

      // Daily summary: queued jobs are sent once
      setSetting_(ss, 'Alert Mode', 'Daily');
      dueAll(); fake.round = 4; runMonitor_();
      test('Notifications: daily mode queues instead of emailing', () => {
        eq(sent.length, 1, 'no instant email in daily mode');
        eq(byTitle('Evaluation Officer').alert, 'Queued for daily summary');
      });
      sendDailySummary();
      sendDailySummary();
      test('Notifications: daily summary sends each job once', () => {
        eq(sent.length, 3, 'two summaries expected');
        ok(/Evaluation Officer/.test(sent[1].htmlBody), 'job missing from summary');
        ok(!/Evaluation Officer/.test(sent[2].htmlBody), 'job repeated in second summary');
        ok(/^Yes \(daily\)/.test(byTitle('Evaluation Officer').alert));
      });

      // Safe writes when rows were re-ordered
      test('Data: key-based writes survive sorting the Jobs tab', () => {
        const t = table_(ss.getSheetByName(CFG.SHEET_JOBS));
        const sh = t.sh, n = t.rows.length;
        const all = sh.getRange(2, 1, n, t.headers.length).getValues().reverse();
        sh.getRange(2, 1, n, t.headers.length).setValues(all);     // simulate a user sort
        const target = t.rows[0], key = String(target[t.idx['Job Key']]);
        target[t.idx['Still Open']] = 'TEST-VALUE';
        writeColsByKey_(t, 'Job Key', ['Still Open']);
        const after = table_(sh);
        const row = after.rows.find(r => String(r[after.idx['Job Key']]) === key);
        eq(row[after.idx['Still Open']], 'TEST-VALUE');
        eq(after.rows.filter(r => r[after.idx['Still Open']] === 'TEST-VALUE').length, 1);
      });
    });
  } catch (e) {
    results.push(['FAIL', 'Sandbox setup', String(e && e.message || e)]);
  }

  // ---------------------------------------------------------------- report
  const failed = results.filter(r => r[0] === 'FAIL');
  results.forEach(r => Logger.log(r.join(' | ')));
  Logger.log((results.length - failed.length) + ' passed, ' + failed.length + ' failed');
  try {
    const html = '<div style="font-family:Arial;font-size:13px"><p><b>' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed</b></p><table cellpadding="4">' +
      results.map(r => '<tr><td style="color:' + (r[0] === 'PASS' ? '#137333' : '#b3261e') + '">' + r[0] + '</td><td>' + r[1] + '</td><td style="color:#b3261e">' + r[2] + '</td></tr>').join('') + '</table></div>';
    SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(720).setHeight(560), 'Self-test results');
  } catch (e) { /* run from the editor: see the execution log */ }
  return { passed: results.length - failed.length, failed: failed.length, results };
}

/** Points the engine at temporary _TEST_ tabs, then restores everything. */
function withTestSandbox_(fn) {
  const ss = ss_();
  const names = ['SHEET_COMPANIES', 'SHEET_JOBS', 'SHEET_PATTERNS', 'SHEET_RULES', 'SHEET_SETTINGS', 'SHEET_LOG', 'SHEET_SEEN', 'SHEET_ACTIVITY', 'SHEET_DASH'];
  const saved = {};
  const props = PropertiesService.getScriptProperties();
  const cursor = props.getProperty('MON_CURSOR');
  const oldHttp = HTTP_, oldMail = MAILER_;
  names.forEach(n => { saved[n] = CFG[n]; CFG[n] = '_TEST_' + CFG[n]; const old = ss.getSheetByName(CFG[n]); if (old) ss.deleteSheet(old); });
  try { return fn(ss); }
  finally {
    names.forEach(n => { const sh = ss.getSheetByName(CFG[n]); if (sh) ss.deleteSheet(sh); CFG[n] = saved[n]; });
    HTTP_ = oldHttp; MAILER_ = oldMail;
    if (cursor == null) props.deleteProperty('MON_CURSOR'); else props.setProperty('MON_CURSOR', cursor);
  }
}

function seedSandbox_(ss) {
  ensureStructure_(ss, false);
  setSetting_(ss, 'Recipient Email', 'test@example.com');
  setSetting_(ss, 'Send Alerts', 'TRUE');
  setSetting_(ss, 'Alert Mode', 'Instant');
  setSetting_(ss, 'Notify First Scan', 'FALSE');
  setSetting_(ss, 'Allow Unknown Eligibility Alerts', 'TRUE');
  setSetting_(ss, 'Portal URL', 'https://script.google.com/macros/s/TEST/exec');
  const sh = ss.getSheetByName(CFG.SHEET_COMPANIES);
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = (o) => h.map(k => o[k] != null ? o[k] : '');
  sh.getRange(2, 1, 3, h.length).setValues([
    row({ 'Company': 'Test Org A', 'Career Page URL': 'https://a.example.org/careers', 'Platform': 'Greenhouse', 'Board Token / Slug': 'testa', 'Enabled': true, 'Priority': 'Medium', 'Category': 'Test' }),
    row({ 'Company': 'Test State Jobs', 'Career Page URL': 'https://www.jobapscloud.com/MD/', 'Platform': 'JobAps', 'Board Token / Slug': 'MD', 'Enabled': true, 'Priority': 'High', 'Category': 'Test' }),
    row({ 'Company': 'Test Feed', 'Career Page URL': 'https://feed.example.org/rss', 'Platform': 'RSS', 'Board Token / Slug': 'https://feed.example.org/rss', 'Enabled': true, 'Priority': 'Low', 'Category': 'Test' })
  ]);
}

/** Fake job sites. round 1 = baseline, 2 = new jobs, 3 = one job removed, 4 = one more new job. */
function makeFakeWeb_() {
  const clean = '<p>' + 'Lead data analysis and MEL reporting with Power BI and Stata for programs in Washington, DC. '.repeat(5) + 'Ability to obtain a Public Trust.</p>';
  const gh = (id, title, content) => ({ id, title, absolute_url: 'https://a.example.org/jobs/' + id, location: { name: 'Washington, DC' }, first_published: new Date().toISOString(), content: content || clean });
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => body });
  const fake = {
    round: 1,
    route(url) {
      const r = fake.round;
      if (/boards-api\.greenhouse\.io\/v1\/boards\/testa/.test(url)) {
        const jobs = [];
        if (r !== 3) jobs.push(gh(101, 'Senior Data Analyst'));
        if (r >= 2) jobs.push(gh(102, 'Monitoring and Evaluation Specialist'), gh(103, 'Data Analyst (TS/SCI)'),
          gh(104, 'Data Manager', '<p>' + 'Manage data systems. '.repeat(20) + 'Must hold an active Secret clearance.</p>'),
          gh(105, 'Research Data Analyst', '<p>' + 'Analyze research data. '.repeat(20) + 'Applicants must be a U.S. citizen.</p>'));
        if (r >= 4) jobs.push(gh(106, 'Evaluation Officer'));
        return resp(200, JSON.stringify({ jobs }));
      }
      if (/jobapscloud\.com\/MD\/$/.test(url)) {
        return resp(200, '<table><tr><td><a href="sup/bulpreview.asp?b=&R1=26&R2=000001&R3=0001">RESEARCH STATISTICIAN (Data Analyst)</a></td><td>Baltimore City</td><td>MLDS Center</td><td>$70,000 - $110,000/ year</td><td>Open / Continuous</td></tr></table>');
      }
      if (/feed\.example\.org\/rss/.test(url)) {
        const item = r >= 2 ? '<item><title>Monitoring and Evaluation Specialist</title><link>https://feed.example.org/j/9</link><description><![CDATA[Organization: Test Org A<br>Location: Washington, DC<br>' + 'Details. '.repeat(40) + ']]></description></item>' : '';
        return resp(200, '<rss><channel><title>Test Feed</title>' + item + '</channel></rss>');
      }
      if (/bulpreview|feed\.example\.org\/j\//.test(url)) return resp(200, '<html><body>' + clean + '</body></html>');
      return resp(404, 'not found');
    },
    fetch(url) { return fake.route(url); },
    fetchAll(reqs) { return reqs.map(q => fake.route(q.url)); }
  };
  return fake;
}
