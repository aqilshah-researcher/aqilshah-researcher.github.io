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
    ? { series: ['#4fc9ad', '#5ab4e6', '#e9c46a', '#e9c46a', '#f5b862', '#e9c46a', '#b4bec0', '#f07a85'], seq: ['#0d4a4c', '#11695f', '#2a9d8f', '#8fd0c6', '#d3eeea'] }
    : { series: ['#1f7a70', '#2a9d8f', '#e9c46a', '#2f5866', '#e8a33d', '#e9c46a', '#8c9da0', '#e13c4b'], seq: ['#e1f1ee', '#a8dcd4', '#2a9d8f', '#1f7a70', '#2f5866'] };
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

/* Donors wall: filter tabs, tap to flip, count-up numbers */
(function () {
  function init() {
    var sec = document.querySelector('.donors-sec'); if (!sec) return;
    var tabs = [].slice.call(sec.querySelectorAll('.dtab')), cards = [].slice.call(sec.querySelectorAll('.dg-donors .dcard')), allcards = [].slice.call(sec.querySelectorAll('.dcard'));
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var g = t.dataset.g;
        tabs.forEach(function (x) { var on = x === t; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        var i = 0;
        cards.forEach(function (c) {
          var show = g === 'all' || c.dataset.g === g;
          c.classList.toggle('hide', !show); c.classList.remove('pop', 'flipped');
          if (show) { c.style.animationDelay = (i++ * 30) + 'ms'; void c.offsetWidth; c.classList.add('pop'); }
        });
      });
    });
    allcards.forEach(function (c) {
      c.querySelector('.dflip').addEventListener('click', function () {
        var on = !c.classList.contains('flipped');
        allcards.forEach(function (x) { x.classList.remove('flipped'); });
        c.classList.toggle('flipped', on);
      });
    });
    var nums = [].slice.call(sec.querySelectorAll('.dstats b[data-count]'));
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return; io.unobserve(e.target);
        var el = e.target, end = +el.dataset.count, t0 = null;
        function step(ts) { if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / 1100); el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); }
        el.textContent = '0'; requestAnimationFrame(step);
      });
    }, { threshold: .6 });
    nums.forEach(function (n) { io.observe(n); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

/* Atmosphere: soft drifting light in the page headers that reacts to the cursor,
   plus a short sparkle trail when the cursor moves quickly. Off for reduced motion. */
(function () {
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  var COLORS = ['#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#8fd0c6'];
  var fine = window.matchMedia && matchMedia('(pointer: fine)').matches;
  var mouse = { x: -9999, y: -9999 };

  function heroAtmosphere(host) {
    var c = document.createElement('canvas'); c.className = 'atmo'; c.setAttribute('aria-hidden', 'true');
    host.insertBefore(c, host.firstChild.nextSibling);
    var ctx = c.getContext('2d'), W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1), parts = [], on = true, raf = 0;
    function size() {
      var r = host.getBoundingClientRect(); W = r.width; H = r.height;
      c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.round(Math.min(70, W * H / 14000)); parts = [];
      for (var i = 0; i < n; i++) parts.push({ x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 2.6, vx: (Math.random() - .5) * .18, vy: -.05 - Math.random() * .22, a: .25 + Math.random() * .55, c: COLORS[i % COLORS.length], ox: 0, oy: 0, t: Math.random() * 6.28 });
    }
    function frame() {
      raf = 0; if (!on) return;
      ctx.clearRect(0, 0, W, H);
      var r = host.getBoundingClientRect(), mx = mouse.x - r.left, my = mouse.y - r.top;
      // soft glow that follows the cursor
      if (mx > -50 && my > -50 && mx < W + 50 && my < H + 50) {
        var g = ctx.createRadialGradient(mx, my, 0, mx, my, 220);
        g.addColorStop(0, 'rgba(233,196,106,0.20)'); g.addColorStop(.5, 'rgba(42,157,143,0.10)'); g.addColorStop(1, 'rgba(42,157,143,0)');
        ctx.fillStyle = g; ctx.fillRect(mx - 220, my - 220, 440, 440);
      }
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i]; p.t += .01;
        p.x += p.vx + Math.sin(p.t) * .08; p.y += p.vy;
        var dx = p.x + p.ox - mx, dy = p.y + p.oy - my, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 120) { var f = (120 - d) / 120 * 3; p.ox += dx / (d || 1) * f; p.oy += dy / (d || 1) * f; }
        p.ox *= .94; p.oy *= .94;
        if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
        if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10;
        var x = p.x + p.ox, y = p.y + p.oy;
        ctx.globalAlpha = p.a * (.7 + .3 * Math.sin(p.t * 2));
        ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      raf = requestAnimationFrame(frame);
    }
    size(); window.addEventListener('resize', size);
    if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { on = e[0].isIntersecting; if (on && !raf) raf = requestAnimationFrame(frame); }).observe(host);
    raf = requestAnimationFrame(frame);
  }

  function sparkleTrail() {
    var c = document.createElement('canvas'); c.className = 'atmo-trail'; c.setAttribute('aria-hidden', 'true'); document.body.appendChild(c);
    var ctx = c.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1), sp = [], raf = 0, last = null;
    function size() { c.width = innerWidth * dpr; c.height = innerHeight * dpr; c.style.width = innerWidth + 'px'; c.style.height = innerHeight + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size(); window.addEventListener('resize', size);
    window.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      if (last) {
        var dx = e.clientX - last.x, dy = e.clientY - last.y, v = Math.sqrt(dx * dx + dy * dy);
        if (v > 14) { // a quick move or a shake
          var n = Math.min(4, Math.floor(v / 14));
          for (var i = 0; i < n; i++) sp.push({ x: e.clientX - dx * i / n, y: e.clientY - dy * i / n, vx: (Math.random() - .5) * 1.6 - dx * .02, vy: (Math.random() - .5) * 1.6 - dy * .02, life: 1, r: 1.5 + Math.random() * 2.5, c: COLORS[(Math.random() * COLORS.length) | 0] });
          if (sp.length > 160) sp.splice(0, sp.length - 160);
          if (!raf) raf = requestAnimationFrame(draw);
        }
      }
      last = { x: e.clientX, y: e.clientY };
    }, { passive: true });
    function draw() {
      raf = 0; ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (var i = sp.length - 1; i >= 0; i--) {
        var s = sp[i]; s.x += s.vx; s.y += s.vy; s.vy += .03; s.life -= .028;
        if (s.life <= 0) { sp.splice(i, 1); continue; }
        ctx.globalAlpha = s.life * .85; ctx.fillStyle = s.c; ctx.shadowColor = s.c; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * s.life + .4, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      if (sp.length) raf = requestAnimationFrame(draw);
    }
  }

  function start() {
    window.addEventListener('pointermove', function (e) { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
    document.querySelectorAll('.hero2, .phero').forEach(heroAtmosphere);
    if (fine) sparkleTrail();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

/* Mark the current page in the main menu */
document.addEventListener('DOMContentLoaded', function () {
  var p = location.pathname.replace(/index\.html$/, '');
  document.querySelectorAll('.mlist a.mtop').forEach(function (a) {
    var h = a.getAttribute('href');
    if (h !== '/' && (p === h || p.indexOf(h) === 0 || (h === '/case-studies/' && p.indexOf('/case-studies') === 0))) a.setAttribute('aria-current', 'page');
  });
});
