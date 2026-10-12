/* Shared helpers: theme toggle, CSV loading, chart theme. */
(function () {
  const KEY = 'asa-theme';
  const root = document.documentElement;
  try { const t = localStorage.getItem(KEY); if (t) root.setAttribute('data-theme', t); } catch (e) {}
  function isDark() {
    const t = root.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  window.ASA = window.ASA || {};
  ASA.isDark = isDark;
  ASA.onTheme = [];
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.querySelector('.theme-btn');
    const paint = () => { if (btn) { btn.textContent = isDark() ? '☀' : '☾'; btn.setAttribute('aria-label', isDark() ? 'Switch to light theme' : 'Switch to dark theme'); } };
    paint();
    if (btn) btn.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
      paint(); ASA.onTheme.forEach(f => f());
    });
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { paint(); ASA.onTheme.forEach(f => f()); });
    const y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
  });

  /* Small CSV parser (handles quoted fields). Numbers are converted. */
  ASA.parseCSV = function (text) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c !== '\r') f += c;
    }
    if (f.length || row.length) { row.push(f); rows.push(row); }
    const head = rows.shift();
    return rows.filter(r => r.length === head.length).map(r => {
      const o = {}; head.forEach((h, i) => { const v = r[i]; o[h] = v === '' ? null : (isFinite(v) && v.trim() !== '' ? +v : v); }); return o;
    });
  };
  ASA.loadCSV = url => fetch(url).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.text(); }).then(ASA.parseCSV);

  /* Validated categorical palette (fixed order) + status colors. */
  ASA.colors = () => isDark()
    ? { series: ['#4fc9ad', '#5ab4e6', '#9ad677', '#bef29a', '#f5b862', '#82cdfa', '#b4bec0', '#f07a85'], seq: ['#0d4a4c', '#11695f', '#2a9a82', '#6fcdb4', '#bfeedd'] }
    : { series: ['#007d69', '#198cc3', '#6ec34b', '#005055', '#e8a33d', '#82cdfa', '#8c9da0', '#e13c4b'], seq: ['#e3f3ee', '#a8dccb', '#2a9a82', '#007d69', '#005055'] };
  ASA.status = { good: '#2e9e5b', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b', neutral: '#9a9da5' };

  ASA.layout = function (extra) {
    const cs = getComputedStyle(document.documentElement);
    const ink = cs.getPropertyValue('--ink-2').trim(), line = cs.getPropertyValue('--line').trim();
    const base = {
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'Nunito Sans, system-ui, sans-serif', size: 12.5, color: ink },
      margin: { l: 48, r: 12, t: 8, b: 40 },
      xaxis: { gridcolor: line, linecolor: line, zerolinecolor: line, automargin: true, fixedrange: true },
      yaxis: { gridcolor: line, linecolor: line, zerolinecolor: line, automargin: true, fixedrange: true },
      legend: { orientation: 'h', y: -0.18, x: 0, font: { size: 12 } },
      hoverlabel: { font: { family: 'Nunito Sans, system-ui, sans-serif', size: 13 } },
      bargap: 0.28, showlegend: false
    };
    return deepMerge(base, extra || {});
  };
  ASA.config = { displayModeBar: false, responsive: true };
  function deepMerge(a, b) {
    const o = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    for (const k in b) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') ? deepMerge(a[k], b[k]) : b[k];
    return o;
  }
  ASA.merge = deepMerge;

  /* Helpers for filters and grouping */
  ASA.uniq = (rows, k) => [...new Set(rows.map(r => r[k]).filter(v => v !== null))].sort();
  ASA.fillSelect = (el, values, allLabel) => {
    el.innerHTML = ''; const o = document.createElement('option'); o.value = ''; o.textContent = allLabel; el.appendChild(o);
    values.forEach(v => { const x = document.createElement('option'); x.value = v; x.textContent = v; el.appendChild(x); });
  };
  ASA.group = (rows, key, fn) => { const m = new Map(); rows.forEach(r => { const k = typeof key === 'function' ? key(r) : r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); return [...m].map(([k, v]) => [k, fn(v)]); };
  ASA.pct = (n, d) => d ? 100 * n / d : 0;
  ASA.fmt = (v, dec = 0) => v === null || isNaN(v) ? '–' : Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  ASA.table = (el, head, rows) => {
    const t = document.createElement('table'); t.className = 'tbl';
    const tr = document.createElement('tr'); head.forEach(h => { const th = document.createElement('th'); th.textContent = h; tr.appendChild(th); }); t.appendChild(tr);
    rows.forEach(r => { const x = document.createElement('tr'); r.forEach(v => { const td = document.createElement('td'); td.textContent = v; x.appendChild(td); }); t.appendChild(x); });
    el.innerHTML = ''; el.appendChild(t);
  };
})();

/* Clean addresses: no "index.html" and no "#section" left in the address bar */
(function () {
  try {
    var p = location.pathname;
    if (/\/index\.html$/.test(p)) history.replaceState(null, '', p.replace(/index\.html$/, '') + location.search + location.hash);
  } catch (e) {}
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href*="#"]');
    if (!a || !a.hash || a.pathname !== location.pathname || a.host !== location.host) return;
    var id = a.hash.slice(1), el = id && document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try { history.replaceState(null, '', location.pathname + location.search); } catch (err) {}
  });
  window.addEventListener('load', function () {
    if (!location.hash) return;
    var el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView({ block: 'start' });
    try { history.replaceState(null, '', location.pathname + location.search); } catch (err) {}
  });
})();

/* Email chooser: let visitors write from Gmail, Outlook, Yahoo, their mail app, or copy the address */
(function () {
  var menu = null, lastLink = null, y0 = 0;
  function close() { if (menu) { menu.remove(); menu = null; document.removeEventListener('keydown', onKey); if (lastLink) lastLink.focus(); } }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function open(a) {
    close(); lastLink = a; y0 = window.scrollY;
    var to = decodeURIComponent(a.getAttribute('href').replace(/^mailto:/, '').split('?')[0]);
    var su = encodeURIComponent('Hello from your portfolio'), t = encodeURIComponent(to);
    var opts = [
      ['Gmail', 'https://mail.google.com/mail/?view=cm&fs=1&to=' + t + '&su=' + su],
      ['Outlook.com', 'https://outlook.live.com/mail/0/deeplink/compose?to=' + t + '&subject=' + su],
      ['Outlook (work or school)', 'https://outlook.office.com/mail/deeplink/compose?to=' + t + '&subject=' + su],
      ['Yahoo Mail', 'https://compose.mail.yahoo.com/?to=' + t + '&subject=' + su],
      ['My default mail app', 'mailto:' + to + '?subject=' + su]
    ];
    menu = document.createElement('div');
    menu.className = 'mailpick'; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Choose how to email ' + to);
    var h = '<div class="mp-head"><b>Email me</b><span>' + to + '</span></div>';
    opts.forEach(function (o) { h += '<a href="' + o[1] + '"' + (o[1].indexOf('http') === 0 ? ' target="_blank" rel="noopener"' : '') + '>' + o[0] + '</a>'; });
    h += '<button type="button" class="mp-copy">Copy email address</button>';
    menu.innerHTML = h;
    document.body.appendChild(menu);
    var r = a.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    var left = Math.min(Math.max(12, r.left), window.innerWidth - mw - 12);
    var top = r.bottom + 8 + mh > window.innerHeight ? r.top - mh - 8 : r.bottom + 8;
    menu.style.left = left + 'px'; menu.style.top = Math.max(12, top) + 'px';
    menu.querySelectorAll('a').forEach(function (x) { x.addEventListener('click', function () { setTimeout(close, 50); }); });
    var cp = menu.querySelector('.mp-copy');
    cp.addEventListener('click', function () {
      var done = function () { cp.textContent = 'Copied ✓'; setTimeout(close, 900); };
      if (navigator.clipboard) navigator.clipboard.writeText(to).then(done, function () { window.prompt('Copy this email address:', to); close(); });
      else { window.prompt('Copy this email address:', to); close(); }
    });
    menu.querySelector('a').focus();
    document.addEventListener('keydown', onKey);
  }
  document.addEventListener('click', function (e) {
    if (menu && !menu.contains(e.target) && !(e.target.closest && e.target.closest('a[href^="mailto:"]'))) close();
    var a = e.target.closest && e.target.closest('a[href^="mailto:"]');
    if (!a || (menu && menu.contains(a))) return;
    e.preventDefault(); open(a);
  });
  window.addEventListener('scroll', function () { if (menu && Math.abs(window.scrollY - y0) > 80) close(); }, { passive: true });
  window.addEventListener('resize', close);
})();

/* Mega menu (desktop hover/click, mobile accordion) */
(function () {
  function init() {
    var header = document.querySelector('.site-header'); if (!header) return;
    var items = [].slice.call(header.querySelectorAll('.has-mega')), mnav = header.querySelector('.mnav'), mbtn = header.querySelector('.menu-btn');
    var desktop = function () { return window.matchMedia('(min-width:1101px)').matches; };
    function setOpen(li, on) { li.classList.toggle('open', on); var b = li.querySelector('.mtop'); if (b) b.setAttribute('aria-expanded', on ? 'true' : 'false'); }
    function closeAll(except) { items.forEach(function (li) { if (li !== except) setOpen(li, false); }); }
    items.forEach(function (li) {
      var b = li.querySelector('.mtop'), t = null;
      b.addEventListener('click', function (e) { e.stopPropagation(); var on = !li.classList.contains('open'); closeAll(li); setOpen(li, on); });
      li.addEventListener('mouseenter', function () { if (!desktop()) return; clearTimeout(t); closeAll(li); setOpen(li, true); });
      li.addEventListener('mouseleave', function () { if (!desktop()) return; t = setTimeout(function () { setOpen(li, false); }, 160); });
    });
    document.addEventListener('click', function (e) { if (!header.contains(e.target)) { closeAll(); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeAll(); if (mnav.classList.contains('open')) { mnav.classList.remove('open'); mbtn.setAttribute('aria-expanded', 'false'); } } });
    if (mbtn) mbtn.addEventListener('click', function () { var on = !mnav.classList.contains('open'); mnav.classList.toggle('open', on); mbtn.setAttribute('aria-expanded', on ? 'true' : 'false'); if (!on) closeAll(); });
    // mark current page
    var here = location.pathname.replace(/index\.html$/, '');
    header.querySelectorAll('.mega-links a, a.mtop').forEach(function (a) { if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
