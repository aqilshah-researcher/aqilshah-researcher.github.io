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
    ? { series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'], seq: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'] }
    : { series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'], seq: ['#cde2fb', '#86b6ef', '#3987e5', '#256abf', '#0d366b'] };
  ASA.status = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b', neutral: '#9a9da5' };

  ASA.layout = function (extra) {
    const cs = getComputedStyle(document.documentElement);
    const ink = cs.getPropertyValue('--ink-2').trim(), line = cs.getPropertyValue('--line').trim();
    const base = {
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'DM Sans, system-ui, sans-serif', size: 12.5, color: ink },
      margin: { l: 48, r: 12, t: 8, b: 40 },
      xaxis: { gridcolor: line, linecolor: line, zerolinecolor: line, automargin: true, fixedrange: true },
      yaxis: { gridcolor: line, linecolor: line, zerolinecolor: line, automargin: true, fixedrange: true },
      legend: { orientation: 'h', y: -0.18, x: 0, font: { size: 12 } },
      hoverlabel: { font: { family: 'DM Sans, system-ui, sans-serif', size: 13 } },
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
