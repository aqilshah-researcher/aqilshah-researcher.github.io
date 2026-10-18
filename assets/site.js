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

/* Atmosphere: a living data network in the page headers. Points drift and link up,
   reach toward the cursor, scatter on click, over a slow aurora glow.
   A short sparkle trail follows quick cursor moves. Off for reduced motion. */
(function () {
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  var COLORS = ['#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#8fd0c6'];
  var RGB = { '#2a9d8f': '42,157,143', '#e9c46a': '233,196,106', '#f4a261': '244,162,97', '#e76f51': '231,111,81', '#8fd0c6': '143,208,198' };
  var fine = window.matchMedia && matchMedia('(pointer: fine)').matches;
  var mouse = { x: -9999, y: -9999 };

  function network(host) {
    var dense = host.classList.contains('hero2');
    var c = document.createElement('canvas'); c.className = 'atmo'; c.setAttribute('aria-hidden', 'true');
    host.insertBefore(c, host.firstChild.nextSibling);
    var ctx = c.getContext('2d'), W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
    var nodes = [], ripples = [], on = true, raf = 0, t = 0, LINK = 140, px = 0, py = 0;
    var LINE = '168,220,212', ACC = ['233,196,106', '244,162,97', '231,111,81'];
    function size() {
      var r = host.getBoundingClientRect(); W = r.width; H = r.height;
      c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      LINK = W < 700 ? 100 : (dense ? 150 : 135);
      var n = Math.round(Math.max(30, Math.min(dense ? 210 : 120, W * H / (dense ? 5200 : 7500)))); nodes = [];
      for (var i = 0; i < n; i++) {
        var z = .35 + Math.random() * .65, acc = Math.random() < .12;
        nodes.push({ x: Math.random() * (W + 80) - 40, y: Math.random() * (H + 80) - 40, z: z, vx: (Math.random() - .5) * .28 * z, vy: (Math.random() - .5) * .28 * z,
          r: (.6 + Math.random() * 1.6) * (.6 + z * .7), rgb: acc ? ACC[i % 3] : '214,236,232', acc: acc, ph: Math.random() * 6.28, sx: 0, sy: 0 });
      }
    }
    // quiet zones: the grid fades over text and photos so it never gets in the way of reading
    var Z = [];
    function zones() {
      var hr = host.getBoundingClientRect(); Z = [];
      host.querySelectorAll('h1,h2,p,.kicker,.actions,.crumbs,.eyebrow,.role,.btn').forEach(function (el) {
        var b = el.getBoundingClientRect(); if (!b.width) return;
        Z.push([b.left - hr.left - 18, b.top - hr.top - 14, b.right - hr.left + 18, b.bottom - hr.top + 14, .14]);
      });
      host.querySelectorAll('.phero-img').forEach(function (el) { var b = el.getBoundingClientRect(); Z.push([b.left - hr.left, b.top - hr.top, b.right - hr.left, b.bottom - hr.top, .3]); });
      if (dense) Z.push([W * .52, 0, W, H, .4]);          // the photo on the right of the home banner
      if (host.matches('section.cta')) Z.push([0, 0, W, H, .55]);
    }
    function q(x, y) { var f = 1; for (var i = 0; i < Z.length; i++) { var z = Z[i]; if (x > z[0] && x < z[2] && y > z[1] && y < z[3] && z[4] < f) f = z[4]; } return f; }
    host.addEventListener('pointerdown', function (e) {
      var r = host.getBoundingClientRect(); var x = e.clientX - r.left, y = e.clientY - r.top;
      ripples.push({ x: x, y: y, r: 0, a: .7 });
      nodes.forEach(function (n) { var dx = n.sx - x, dy = n.sy - y, d = Math.sqrt(dx * dx + dy * dy) || 1; if (d < 240) { n.vx += dx / d * (240 - d) / 55; n.vy += dy / d * (240 - d) / 55; } });
    });
    function frame(now) {
      raf = 0; if (!on) return; t = now || 0;
      ctx.clearRect(0, 0, W, H);
      var r = host.getBoundingClientRect(), mx = mouse.x - r.left, my = mouse.y - r.top;
      var near = mx > -40 && my > -40 && mx < W + 40 && my < H + 40;
      // parallax: the field leans away from the cursor, deeper points move less
      var tx = near ? (mx / W - .5) : 0, ty = near ? (my / H - .5) : 0;
      px += (tx - px) * .05; py += (ty - py) * .05;
      // soft colored depth glow
      var g1 = ctx.createRadialGradient(W * (.78 - px * .1), H * (.25 - py * .1), 0, W * .78, H * .25, Math.max(W, H) * .55);
      g1.addColorStop(0, 'rgba(42,157,143,0.16)'); g1.addColorStop(1, 'rgba(42,157,143,0)'); ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);
      var g2 = ctx.createRadialGradient(W * (.15 - px * .08), H * (.85 - py * .08), 0, W * .15, H * .85, Math.max(W, H) * .45);
      g2.addColorStop(0, 'rgba(231,111,81,0.08)'); g2.addColorStop(1, 'rgba(231,111,81,0)'); ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        n.vx *= .99; n.vy *= .99;
        var sp = Math.abs(n.vx) + Math.abs(n.vy); if (sp < .08 * n.z) { n.vx += (Math.random() - .5) * .03; n.vy += (Math.random() - .5) * .03; }
        n.x += n.vx; n.y += n.vy;
        if (n.x < -60) n.x = W + 60; if (n.x > W + 60) n.x = -60; if (n.y < -60) n.y = H + 60; if (n.y > H + 60) n.y = -60;
        n.sx = n.x - px * 60 * n.z; n.sy = n.y - py * 40 * n.z;
        if (near) { var dx = mx - n.sx, dy = my - n.sy, d = Math.sqrt(dx * dx + dy * dy); if (d < 170 && d > 40) { n.vx += dx / d * .008; n.vy += dy / d * .008; } }
      }
      // fine web of links
      ctx.lineWidth = .7;
      var L2 = LINK * LINK;
      for (var i = 0; i < nodes.length; i++) { var a = nodes[i];
        for (var j = i + 1; j < nodes.length; j++) { var b = nodes[j], dx = a.sx - b.sx, dy = a.sy - b.sy, d2 = dx * dx + dy * dy;
          if (d2 < L2) { var o = (1 - d2 / L2) * .32 * Math.min(a.z, b.z) * 1.4;
            // links brighten near the cursor
            if (near) { var cx = (a.sx + b.sx) / 2 - mx, cy = (a.sy + b.sy) / 2 - my, cd = cx * cx + cy * cy; if (cd < 40000) o += (1 - cd / 40000) * .35; }
            o *= q((a.sx + b.sx) / 2, (a.sy + b.sy) / 2);
            ctx.strokeStyle = 'rgba(' + LINE + ',' + o.toFixed(3) + ')'; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); } } }
      if (near) {
        ctx.lineWidth = 1;
        for (var i = 0; i < nodes.length; i++) { var n = nodes[i], dx = n.sx - mx, dy = n.sy - my, d = Math.sqrt(dx * dx + dy * dy);
          if (d < 180) { ctx.strokeStyle = 'rgba(233,196,106,' + ((1 - d / 180) * .55 * q((n.sx + mx) / 2, (n.sy + my) / 2)).toFixed(3) + ')'; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(n.sx, n.sy); ctx.stroke(); } }
        var g = ctx.createRadialGradient(mx, my, 0, mx, my, 150); g.addColorStop(0, 'rgba(233,196,106,' + (0.16 * q(mx, my)).toFixed(3) + ')'); g.addColorStop(1, 'rgba(233,196,106,0)');
        ctx.fillStyle = g; ctx.fillRect(mx - 150, my - 150, 300, 300);
      }
      for (var i = 0; i < nodes.length; i++) { var n = nodes[i], pulse = .7 + .3 * Math.sin(t * .0018 + n.ph);
        var qq = q(n.sx, n.sy); ctx.fillStyle = 'rgba(' + n.rgb + ',' + ((n.acc ? .95 : .75) * pulse * (.5 + n.z * .5) * qq).toFixed(3) + ')';
        if (n.acc && qq > .5) { ctx.shadowColor = 'rgba(' + n.rgb + ',1)'; ctx.shadowBlur = 10; }
        ctx.beginPath(); ctx.arc(n.sx, n.sy, n.r * (n.acc ? 1.4 : 1), 0, 6.283); ctx.fill(); ctx.shadowBlur = 0; }
      for (var k = ripples.length - 1; k >= 0; k--) { var rp = ripples[k]; rp.r += 4; rp.a -= .014;
        if (rp.a <= 0) { ripples.splice(k, 1); continue; }
        ctx.strokeStyle = 'rgba(233,196,106,' + (rp.a * .7).toFixed(3) + ')'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(rp.x, rp.y, rp.r, 0, 6.283); ctx.stroke(); }
      raf = requestAnimationFrame(frame);
    }
    size(); zones(); window.addEventListener('resize', function () { size(); zones(); }); setTimeout(zones, 800); setInterval(function () { if (on) zones(); }, 2000);
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
        if (v > 12) {
          var n = Math.min(5, Math.floor(v / 12));
          for (var i = 0; i < n; i++) sp.push({ x: e.clientX - dx * i / n, y: e.clientY - dy * i / n, vx: (Math.random() - .5) * 1.8 - dx * .02, vy: (Math.random() - .5) * 1.8 - dy * .02, life: 1, r: 1.5 + Math.random() * 2.8, c: COLORS[(Math.random() * COLORS.length) | 0] });
          if (sp.length > 180) sp.splice(0, sp.length - 180);
          if (!raf) raf = requestAnimationFrame(draw);
        }
      }
      last = { x: e.clientX, y: e.clientY };
    }, { passive: true });
    function draw() {
      raf = 0; ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (var i = sp.length - 1; i >= 0; i--) {
        var s = sp[i]; s.x += s.vx; s.y += s.vy; s.vy += .03; s.life -= .026;
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
    document.querySelectorAll('.hero2, .phero, section.cta').forEach(network);
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
