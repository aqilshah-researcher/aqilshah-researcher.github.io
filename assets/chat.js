/* Portfolio assistant: answers questions about Aqil from /assets/chat-kb.json.
   Works fully in the browser. If kb.api is set to an AI endpoint, it is used first
   and the local answers are the fallback. */
(function () {
  "use strict";
  var KB = null, SECT = null, DF = {}, NSEC = 0, busy = false, history = [];
  var STORE = "aq-chat-v1", SEEN = "aq-chat-seen";
  var STOP = ("a an the and or of to in on for with at by from is are was were be been am do does did " +
    "i you he she it we they me my your his her our their what which who whom how why when where " +
    "can could would should will shall may might has have had this that these those there here " +
    "about tell please aqil aqils him any some much many more most also just get give show me know").split(" ");
  var STOPSET = {}; STOP.forEach(function (w) { STOPSET[w] = 1; });

  function sget(k, d) { try { var v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function sset(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function norm(s) { return " " + String(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9&.+#'\- ]+/g, " ").replace(/\s+/g, " ").trim() + " "; }
  function stem(w) { return w.length > 4 ? w.replace(/(ing|ies|es|s|ed)$/, "") : w; }
  function toks(s) { return norm(s).trim().split(" ").filter(function (w) { return w && !STOPSET[w]; }).map(stem); }

  function scoreIntent(q, intent) {
    var best = 0, words = " " + toks(q).join(" ") + " ";
    intent.keys.forEach(function (k) {
      var kn = norm(k), n = kn.trim().split(" ").length, sc = 0;
      if (n > 1 || k.charAt(0) === " ") { if (q.indexOf(kn) >= 0) sc = 3 + n; }
      else if (q.indexOf(kn) >= 0 && (" " + q).indexOf(kn) >= 0) sc = 2;
      else if (words.indexOf(" " + stem(kn.trim()) + " ") >= 0) sc = 1.5;
      if (sc > best) best = sc;
    });
    if (best && intent.id.indexOf("case-") === 0) best += 1.5;
    return best;
  }

  function buildIndex() {
    SECT = KB.sections.map(function (s) {
      var tf = {}; toks(s.t + " " + s.t + " " + s.x).forEach(function (w) { tf[w] = (tf[w] || 0) + 1; });
      Object.keys(tf).forEach(function (w) { DF[w] = (DF[w] || 0) + 1; });
      return { s: s, tf: tf };
    });
    NSEC = SECT.length;
  }
  function searchSections(q) {
    var qt = toks(q); if (!qt.length) return [];
    var res = SECT.map(function (d) {
      var sc = 0; qt.forEach(function (w) { if (d.tf[w]) sc += (1 + Math.log(d.tf[w])) * Math.log(1 + NSEC / DF[w]); });
      return { d: d, sc: sc };
    }).filter(function (r) { return r.sc > 2.5; }).sort(function (a, b) { return b.sc - a.sc; });
    var seen = {}, out = [];
    res.forEach(function (r) { var k = r.d.s.t.toLowerCase(); if (!seen[k] && out.length < 2) { seen[k] = 1; out.push(r.d.s); } });
    return out;
  }

  function navAnswer(q) {
    if (!/(take me|go to|open|navigate|link to|where can i (find|see)|show me the|page|visit)/.test(q)) return null;
    var hit = null, len = 0;
    KB.pages.forEach(function (p) {
      [p.label].concat(p.keys).forEach(function (k) { var kn = norm(k); if (q.indexOf(kn) >= 0 && kn.length > len) { hit = p; len = kn.length; } });
    });
    return hit ? { text: "Here you go. This opens the " + hit.label + " page.", links: [{ url: hit.url, label: "Open " + hit.label }] } : null;
  }

  function localAnswer(raw) {
    var q = norm(raw);
    var nav = navAnswer(q); if (nav) return nav;
    var best = null, bs = 0;
    KB.intents.forEach(function (it) { var s = scoreIntent(q, it); if (s > bs) { bs = s; best = it; } });
    if (best && bs >= 1.5) return { text: best.answer, links: best.links || [], follow: best.follow || [], interview: !!best.interview };
    var secs = searchSections(raw);
    if (secs.length) {
      return {
        text: "Here is what I found on the portfolio:",
        cards: secs.map(function (s) { return { title: s.t, text: s.x.length > 240 ? s.x.slice(0, 237).replace(/\s+\S*$/, "") + "…" : s.x, url: s.u }; }),
        follow: ["Tell me about Aqil", "Why should we hire him?"]
      };
    }
    return {
      text: "I am not sure about that one. I can answer questions about Aqil's experience, skills, trainings, dashboards and evaluations, or share how he answers common interview questions. For anything else, Aqil is happy to answer directly.",
      links: [{ url: "/contact/", label: "Contact Aqil" }], follow: KB.starters.slice(0, 3)
    };
  }

  function aiAnswer(raw, done) {
    if (!KB.api) return done(null);
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 20000);
    var local = localAnswer(raw);
    fetch(KB.api, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl ? ctl.signal : undefined,
      body: JSON.stringify({ question: raw, history: history.slice(-8), page: location.pathname, hint: local.text })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      clearTimeout(t); done(j && j.answer ? { text: j.answer, links: j.links || local.links || [], follow: local.follow || [] } : null);
    }).catch(function () { clearTimeout(t); done(null); });
  }

  // ---------- UI ----------
  var root, panel, list, input, teaser, btn;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function addMsg(who, a, save) {
    var m = el("div", "aqc-msg aqc-" + who);
    if (who === "bot" && a.interview) m.appendChild(el("div", "aqc-tag", "Interview answer · in Aqil's usual words"));
    var body = el("div", "aqc-text"); body.textContent = typeof a === "string" ? a : a.text; m.appendChild(body);
    if (a.cards) a.cards.forEach(function (c) {
      var k = el("a", "aqc-card"); k.href = c.url; k.appendChild(el("b", null, c.title)); k.appendChild(el("span", null, c.text)); m.appendChild(k);
    });
    if (a.links && a.links.length) {
      var row = el("div", "aqc-links");
      a.links.forEach(function (l) {
        var x = el("a", "aqc-link", l.label + " →"); x.href = l.url;
        if (/^https?:/.test(l.url) || /\.pdf$/.test(l.url)) { x.target = "_blank"; x.rel = "noopener"; }
        x.setAttribute("data-goatcounter-click", "chat-link-" + l.url);
        row.appendChild(x);
      });
      m.appendChild(row);
    }
    list.appendChild(m);
    if (who === "bot" && a.follow && a.follow.length) chips(a.follow);
    list.scrollTop = list.scrollHeight;
    if (save !== false) { var log = sget(STORE, []); log.push({ w: who, a: a }); sset(STORE, log.slice(-40)); }
  }
  function chips(items) {
    var old = list.querySelector(".aqc-chips"); if (old) old.remove();
    var c = el("div", "aqc-chips");
    items.forEach(function (t) { var b = el("button", "aqc-chip", t); b.type = "button"; b.onclick = function () { ask(t); }; c.appendChild(b); });
    list.appendChild(c); list.scrollTop = list.scrollHeight;
  }
  function typing(on) {
    var t = list.querySelector(".aqc-typing");
    if (on && !t) { t = el("div", "aqc-msg aqc-bot aqc-typing"); t.innerHTML = "<span></span><span></span><span></span>"; list.appendChild(t); list.scrollTop = list.scrollHeight; }
    if (!on && t) t.remove();
  }

  function ask(text) {
    text = String(text || "").trim(); if (!text || busy) return;
    var old = list.querySelector(".aqc-chips"); if (old) old.remove();
    addMsg("me", text); history.push({ role: "user", content: text });
    busy = true; typing(true);
    var finish = function (a) {
      typing(false); busy = false; addMsg("bot", a); history.push({ role: "assistant", content: a.text });
      try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: "chat-question", title: "Chat question", event: true }); } catch (e) {}
    };
    if (KB.api) aiAnswer(text, function (a) { finish(a || localAnswer(text)); });
    else setTimeout(function () { finish(localAnswer(text)); }, 350 + Math.min(900, text.length * 12));
  }

  function open() {
    root.classList.add("open"); btn.setAttribute("aria-expanded", "true");
    if (teaser) { teaser.remove(); teaser = null; }
    lset(SEEN, "1");
    if (!list.children.length) {
      var log = sget(STORE, []);
      if (log.length) log.forEach(function (x) { addMsg(x.w, x.a, false); });
      else { addMsg("bot", { text: "Hi! I am Aqil's portfolio assistant. Ask me about his experience, skills, trainings or dashboards, try an interview question, or ask me to open a page.", follow: KB.starters }, false); }
    }
    setTimeout(function () { input.focus(); }, 60);
  }
  function close() { root.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); btn.focus(); }

  function mount() {
    root = el("div", "aqc"); root.setAttribute("data-nosnippet", "");
    btn = el("button", "aqc-btn"); btn.type = "button"; btn.setAttribute("aria-label", "Ask about Aqil"); btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="9" cy="10.5" r="1.2" fill="currentColor"/><circle cx="12" cy="10.5" r="1.2" fill="currentColor"/><circle cx="15" cy="10.5" r="1.2" fill="currentColor"/></svg><span>Ask about Aqil</span>';
    btn.onclick = function () { root.classList.contains("open") ? close() : open(); };

    panel = el("div", "aqc-panel"); panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Ask about Aqil");
    var head = el("div", "aqc-head");
    var av = el("div", "aqc-av", "AS");
    var ht = el("div", "aqc-ht"); ht.appendChild(el("b", null, "Ask about Aqil")); ht.appendChild(el("span", null, "Automated assistant · answers from this portfolio"));
    var clr = el("button", "aqc-icon", "↺"); clr.type = "button"; clr.title = "Start over"; clr.setAttribute("aria-label", "Start over");
    clr.onclick = function () { sset(STORE, []); history = []; list.innerHTML = ""; open(); };
    var x = el("button", "aqc-icon", "×"); x.type = "button"; x.setAttribute("aria-label", "Close"); x.onclick = close;
    head.appendChild(av); head.appendChild(ht); head.appendChild(clr); head.appendChild(x);
    list = el("div", "aqc-list"); list.setAttribute("aria-live", "polite");
    var form = el("form", "aqc-form");
    input = el("input"); input.type = "text"; input.placeholder = "Type a question…"; input.setAttribute("aria-label", "Your question"); input.maxLength = 300;
    var send = el("button", "aqc-send"); send.type = "submit"; send.setAttribute("aria-label", "Send");
    send.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2-7z" fill="currentColor"/></svg>';
    form.appendChild(input); form.appendChild(send);
    form.onsubmit = function (e) { e.preventDefault(); var v = input.value; input.value = ""; ask(v); };
    var foot = el("div", "aqc-foot", "Answers come from this portfolio and may not cover everything. For anything important, please contact Aqil.");
    panel.appendChild(head); panel.appendChild(list); panel.appendChild(form); panel.appendChild(foot);
    root.appendChild(panel); root.appendChild(btn);
    document.body.appendChild(root);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && root.classList.contains("open")) close(); });

    if (!lget(SEEN) && !sget(STORE, []).length) {
      setTimeout(function () {
        if (root.classList.contains("open")) return;
        teaser = el("div", "aqc-teaser");
        var tt = el("button", "aqc-teaser-text", "Hi! Have a question about Aqil's experience or skills? I can help."); tt.type = "button"; tt.onclick = open;
        var tx = el("button", "aqc-teaser-x", "×"); tx.type = "button"; tx.setAttribute("aria-label", "Dismiss");
        tx.onclick = function () { teaser.remove(); teaser = null; lset(SEEN, "1"); };
        teaser.appendChild(tt); teaser.appendChild(tx); root.insertBefore(teaser, btn);
      }, 3500);
    }
  }

  function init() {
    fetch("/assets/chat-kb.json?v=" + (window.AQ_CHAT_V || "1")).then(function (r) { return r.json(); }).then(function (j) {
      KB = j; buildIndex(); mount();
    }).catch(function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
