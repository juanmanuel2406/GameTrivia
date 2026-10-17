/* Gaming City · Duelo 1v1
   Estructura: utilidades → sonido → jugador/registro → pantallas → red (WebRTC + plan B) → motor del duelo. */
"use strict";
(() => {
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const fmt = (n) => Number(n || 0).toLocaleString("es-AR");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => performance.now();
const newId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
const isTouch = () => matchMedia("(pointer:coarse)").matches || "ontouchstart" in window;
async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) { const e = new Error(j.error || ("HTTP " + r.status)); e.status = r.status; throw e; }
  return j;
}

/* =========================================================
   SONIDO (sintetizado, sin archivos)
   ========================================================= */
const AU = (() => {
  let ctx = null, noise = null, on = store.get("gc_sound", true);
  function ensure() {
    if (!on) return null;
    try {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }
  function burst(freq, dur, vol, q = 1.2, type = "bandpass") {
    const c = ensure(); if (!c || vol <= 0.001) return;
    const s = c.createBufferSource(); s.buffer = noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); const t = c.currentTime;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(c.destination); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  function tone(freq, dur, type = "square", vol = 0.04, to = 0) {
    const c = ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const SHOT = { classic: [2100, .07, .16], sheriff: [900, .18, .26], spectre: [2500, .05, .12], vandal: [1300, .09, .2], operator: [420, .35, .34] };
  return {
    unlock: ensure,
    isOn: () => on,
    toggle() { on = !on; store.set("gc_sound", on); if (on) tone(880, .06); return on; },
    shot(w, vol = 1) { const s = SHOT[w] || SHOT.classic; burst(s[0], s[1], s[2] * vol, .9); burst(160, s[1] * 1.4, s[2] * .5 * vol, .7, "lowpass"); },
    hit() { tone(1600, .05, "triangle", .06); },
    hurt() { tone(170, .14, "sawtooth", .05, 90); },
    kill() { tone(660, .08, "square", .05); setTimeout(() => tone(990, .14, "square", .05), 70); },
    step(vol) { burst(260, .05, .05 * vol, 2, "lowpass"); },
    ui() { tone(720, .04, "triangle", .035); },
    buy() { tone(520, .05, "triangle", .04); setTimeout(() => tone(780, .07, "triangle", .04), 50); },
    deny() { tone(150, .12, "square", .035); },
    reload() { burst(3000, .04, .05, 3); setTimeout(() => burst(2200, .05, .06, 3), 160); },
    ability(id) {
      if (id === "dash") burst(900, .22, .12, .5, "highpass");
      else if (id === "smoke") { burst(400, .5, .12, .4, "lowpass"); }
      else if (id === "wall") { tone(220, .25, "sawtooth", .05, 440); }
      else { tone(1200, .3, "sine", .05, 300); }
    },
    beep(f = 990) { tone(f, .1, "square", .045); },
    win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .16, "square", .04), i * 90)); },
    lose() { [440, 349, 262].forEach((f, i) => setTimeout(() => tone(f, .2, "triangle", .05), i * 120)); },
  };
})();
function renderSound() { const b = $("#sound-btn"); b.setAttribute("aria-pressed", String(AU.isOn())); }
$("#sound-btn").addEventListener("click", () => { AU.toggle(); renderSound(); });
renderSound();

/* =========================================================
   JUGADOR, REGISTRO E INSTAGRAM
   ========================================================= */
let PID = store.get("gc_pid", null); if (!PID) { PID = newId(); store.set("gc_pid", PID); }
let PLAYER = store.get("gc_player", null); // {pid,nick,ig,synced}
const nick = () => (PLAYER && PLAYER.nick) || "";
const igOpened = new Set(store.get("gc_ig_opened", []));
const cleanIg = (v) => String(v || "").trim().toLowerCase().replace(/^@+/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "");

function gateStep(id) { ["gate-follow", "gate-register", "gate-login"].forEach((k) => ($("#" + k).hidden = k !== id)); $("#gate").scrollTop = 0; }
function openGate(step) { $("#gate").hidden = false; document.body.style.overflow = "hidden"; gateStep(step || (store.get("gc_follow", false) ? "gate-register" : "gate-follow")); renderIg(); }
function closeGate() { $("#gate").hidden = true; document.body.style.overflow = ""; }
function renderIg() {
  $$(".ig-btn").forEach((a) => { const ok = igOpened.has(a.dataset.ig); a.classList.toggle("done", ok); a.querySelector(".ig-state").textContent = ok ? "✓ Listo" : "Seguir"; });
  $("#gate-follow-ok").disabled = igOpened.size < 2;
}
$$(".ig-btn").forEach((a) => a.addEventListener("click", () => { igOpened.add(a.dataset.ig); store.set("gc_ig_opened", [...igOpened]); setTimeout(renderIg, 400); }));
$("#gate-follow-ok").addEventListener("click", () => { store.set("gc_follow", true); AU.ui(); gateStep("gate-register"); setTimeout(() => $("#reg-nick").focus(), 50); });
$("#to-login").addEventListener("click", () => gateStep("gate-login"));
$("#to-register").addEventListener("click", () => gateStep("gate-register"));
function requirePlayer() { if (PLAYER) return true; openGate(); return false; }
function setPlayer(pl) { PLAYER = pl; store.set("gc_player", pl); if (pl.pid) { PID = pl.pid; store.set("gc_pid", pl.pid); } closeGate(); renderMe(); refreshHome(); AU.win(); }
$("#reg-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const n = $("#reg-nick").value.trim().toUpperCase(), ig = cleanIg($("#reg-ig").value), pin = $("#reg-pin").value.trim(), msg = $("#reg-msg");
  msg.style.color = "var(--red)";
  if (!n) { msg.textContent = "Poné un apodo."; return; }
  if (!/^[a-z0-9._]{1,30}$/.test(ig)) { msg.textContent = "Revisá tu usuario de Instagram (solo letras, números, punto y guion bajo)."; return; }
  if (!/^\d{4}$/.test(pin)) { msg.textContent = "El PIN tiene que ser de 4 números."; return; }
  msg.style.color = "var(--muted)"; msg.textContent = "Creando tu jugador…";
  try {
    const j = await api("/api/player", { action: "register", pid: PID, nick: n, ig, pin });
    setPlayer({ pid: j.pid, nick: j.nick, ig: j.ig, synced: true });
  } catch (err) {
    msg.style.color = "var(--red)";
    if (/registrado/.test(err.message)) { msg.textContent = err.message; $("#log-ig").value = "@" + ig; setTimeout(() => gateStep("gate-login"), 1400); return; }
    if (/inválido|PIN|apodo/i.test(err.message)) { msg.textContent = err.message; return; }
    setPlayer({ pid: PID, nick: n, ig, pin, synced: false }); // sin servidor: se sincroniza después
  }
});
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ig = cleanIg($("#log-ig").value), pin = $("#log-pin").value.trim(), msg = $("#log-msg");
  msg.style.color = "var(--muted)"; msg.textContent = "Buscando tu cuenta…";
  try { const j = await api("/api/player", { action: "login", ig, pin }); setPlayer({ pid: j.pid, nick: j.nick, ig: j.ig, synced: true }); }
  catch (err) { msg.style.color = "var(--red)"; msg.textContent = /fetch|HTTP 5/i.test(err.message) ? "No hay conexión con el servidor. Probá de nuevo en un rato." : err.message; }
});
async function syncPlayer() {
  if (!PLAYER || PLAYER.synced || !PLAYER.pin) return;
  try { await api("/api/player", { action: "register", pid: PLAYER.pid, nick: PLAYER.nick, ig: PLAYER.ig, pin: PLAYER.pin }); PLAYER.synced = true; delete PLAYER.pin; store.set("gc_player", PLAYER); } catch (e) {}
}
$("#me-logout").addEventListener("click", () => { PLAYER = null; store.set("gc_player", null); PID = newId(); store.set("gc_pid", PID); renderMe(); openGate("gate-login"); });

/* =========================================================
   PANTALLAS
   ========================================================= */
const VIEWS = ["home", "select", "profile"];
let homeTimer = 0;
function show(id) {
  VIEWS.forEach((v) => ($("#" + v).hidden = v !== id));
  clearInterval(homeTimer);
  if (id === "home") { refreshHome(); homeTimer = setInterval(refreshHome, 15000); }
  if (id !== "select") NET.cancel();
  window.scrollTo({ top: 0 });
}
$$("[data-back]").forEach((b) => b.addEventListener("click", () => show("home")));
$("#home-btn").addEventListener("click", () => { if ($("#game").hidden) show("home"); });
$("#me-chip").addEventListener("click", () => openProfile());
$("#me-profile").addEventListener("click", () => openProfile());

let meStats = null;
function renderMe() {
  const n = nick();
  $("#me-chip").hidden = !n; $("#me-chip-nick").textContent = n || "—";
  $("#me-nick").textContent = n || "—"; $("#me-ig").textContent = PLAYER && PLAYER.ig ? "@" + PLAYER.ig : "";
  $("#me-pts").textContent = fmt(meStats ? meStats.total : 0);
  $("#me-rank").textContent = meStats && meStats.rank ? "#" + meStats.rank : "—";
  $("#me-wins").textContent = fmt(meStats ? meStats.wins : 0);
}
function renderBoard(list, rows, limit) {
  list.innerHTML = "";
  if (!rows.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = "Todavía nadie jugó. Sé el primero en el podio."; list.appendChild(li); return; }
  rows.slice(0, limit).forEach((r, i) => {
    const li = document.createElement("li"); if (r.tag === PID.slice(-4) && r.nick === nick()) li.className = "me";
    li.innerHTML = '<span class="pos"></span><span class="nm"></span><span class="w"></span><span class="pts"></span>';
    li.children[0].textContent = i + 1;
    li.children[1].textContent = r.nick; const sm = document.createElement("small"); sm.textContent = "#" + r.tag; li.children[1].appendChild(sm);
    li.children[2].textContent = r.wins + " V · " + r.matches + " P";
    li.children[3].textContent = fmt(r.total);
    list.appendChild(li);
  });
}
/* quién está conectado ahora (se ve en el inicio) */
let presenceT = 0;
async function presence() {
  clearTimeout(presenceT); presenceT = setTimeout(presence, 15000);
  if (document.hidden) return;
  const state = GAME.active() ? (NET.searching() ? "searching" : "playing") : NET.searching() ? "searching" : "lobby";
  try {
    const j = await api("/api/presence", { pid: PID, state });
    $("#live").hidden = false; $("#live-on").textContent = j.online; $("#live-search").textContent = j.searching; $("#live-play").textContent = j.playing;
  } catch (e) { $("#live").hidden = true; }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) presence(); });
async function refreshHome() {
  renderMe(); syncPlayer();
  try {
    const j = await api("/api/leaderboard");
    renderBoard($("#board-list"), j.top, 5);
    $("#board-meta").textContent = j.players + " jugador" + (j.players === 1 ? "" : "es") + " anotados";
  } catch (e) { $("#board-meta").textContent = "Ranking no disponible por ahora"; if (!$("#board-list").children.length) renderBoard($("#board-list"), [], 5); }
  if (PLAYER) {
    try { const j = await api("/api/player?pid=" + encodeURIComponent(PID)); meStats = j; renderMe(); } catch (e) {}
  }
}

async function openProfile() {
  if (!requirePlayer()) return;
  show("profile");
  $("#pf-nick").textContent = PLAYER.nick; $("#pf-ig").textContent = PLAYER.ig ? "@" + PLAYER.ig : "";
  const paint = (s, hist, src) => {
    const rows = [["Puntos", fmt(s.total)], ["Puesto", s.rank ? "#" + s.rank : "—"], ["Victorias", fmt(s.wins) + " / " + fmt(s.matches)], ["Rondas", fmt(s.roundsWon)]];
    $("#pf-stats").innerHTML = rows.map((r) => "<div><dt>" + r[0] + "</dt><dd>" + r[1] + "</dd></div>").join("");
    const ul = $("#pf-hist"); ul.innerHTML = "";
    if (!hist.length) { ul.innerHTML = '<li><span class="res">—</span><span class="det">Todavía no jugaste. Tus partidas van a aparecer acá.</span></li>'; }
    hist.forEach((h) => {
      const li = document.createElement("li");
      li.innerHTML = '<span class="res"></span><span class="det"></span><span class="pp"></span>';
      li.children[0].textContent = h.won ? "Victoria" : "Derrota"; li.children[0].classList.add(h.won ? "w" : "l");
      const vs = h.mode === "online" ? "vs " + (h.opp || "rival") : "vs bot " + (h.diff || "");
      li.children[1].innerHTML = "<b></b> · ";
      li.children[1].firstChild.textContent = h.rw + "–" + h.rl;
      li.children[1].append(vs + (h.forfeit ? " (abandono)" : "") + " · " + new Date(h.t).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));
      li.children[2].textContent = "+" + fmt(h.pts || 0);
      ul.appendChild(li);
    });
    $("#pf-src").textContent = src;
  };
  paint({ total: 0, wins: 0, matches: 0, roundsWon: 0 }, store.get("gc_hist2", []), "Guardado en este celular");
  try { const j = await api("/api/player?pid=" + encodeURIComponent(PID)); if (!$("#profile").hidden) paint(j, j.history || [], "Guardado en el servidor"); } catch (e) {}
}

/* =========================================================
   AGENTES Y ARMAS (datos)
   ========================================================= */
const AGENTS = {
  rafaga: { name: "Ráfaga", role: "Duelista", color: "#ff4655", ab: { id: "dash", name: "Impulso", desc: "Un dash veloz hacia donde te movés.", charges: 2 } },
  niebla: { name: "Niebla", role: "Controlador", color: "#a78bfa", ab: { id: "smoke", name: "Nube", desc: "Tirá una nube donde apuntás. Tapa la visión 8 s.", charges: 2 } },
  bastion: { name: "Bastión", role: "Centinela", color: "#3fe0c5", ab: { id: "wall", name: "Barrera", desc: "Levantá un muro frente a vos. Frena balas 10 s.", charges: 1 } },
  pulso: { name: "Pulso", role: "Iniciador", color: "#f2c14e", ab: { id: "radar", name: "Eco", desc: "Revelá al rival a través de paredes por 3 s.", charges: 2 } },
};
const AGENT_SVG = {
  dash: '<svg viewBox="0 0 56 56"><path d="M6 36 L30 12 L30 24 L50 20 L26 44 L26 32 Z" fill="currentColor"/></svg>',
  smoke: '<svg viewBox="0 0 56 56"><circle cx="22" cy="30" r="13" fill="currentColor" opacity=".55"/><circle cx="34" cy="24" r="15" fill="currentColor" opacity=".8"/><circle cx="34" cy="36" r="10" fill="currentColor"/></svg>',
  wall: '<svg viewBox="0 0 56 56"><rect x="8" y="10" width="40" height="9" fill="currentColor"/><rect x="8" y="23" width="40" height="9" fill="currentColor" opacity=".75"/><rect x="8" y="36" width="40" height="9" fill="currentColor" opacity=".5"/></svg>',
  radar: '<svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="3.5"><circle cx="28" cy="28" r="6" fill="currentColor"/><circle cx="28" cy="28" r="15" opacity=".7"/><circle cx="28" cy="28" r="24" opacity=".4"/></svg>',
};
const WEAPONS = {
  classic: { name: "Classic", cls: "Pistola", cost: 0, dmg: 26, fire: 165, mag: 12, reload: 1750, spread: .018, move: .05, spray: .006, speed: 1, note: "Gratis" },
  sheriff: { name: "Sheriff", cls: "Pistola", cost: 800, dmg: 55, fire: 420, mag: 6, reload: 2250, spread: .008, move: .11, spray: .02, speed: 1, note: "2 tiros sin escudo" },
  spectre: { name: "Spectre", cls: "Subfusil", cost: 1600, dmg: 26, fire: 82, mag: 30, reload: 2250, spread: .026, move: .04, spray: .009, speed: 1, note: "Precisa en movimiento" },
  vandal: { name: "Vandal", cls: "Rifle", cost: 2900, dmg: 40, fire: 105, mag: 25, reload: 2500, spread: .01, move: .1, spray: .014, speed: .95, note: "Daño fijo, todo terreno" },
  operator: { name: "Operator", cls: "Francotirador", cost: 4700, dmg: 150, fire: 1400, mag: 5, reload: 3700, spread: .002, move: .3, spray: 0, speed: .78, note: "Un tiro, quieto" },
};
const SHIELDS = { light: { name: "Escudo liviano", cls: "Escudo", cost: 400, val: 25 }, heavy: { name: "Escudo pesado", cls: "Escudo", cost: 1000, val: 50 } };
const BUY_LIST = ["classic", "sheriff", "spectre", "vandal", "operator", "light", "heavy"];
const GUN_SHAPE = { // rectángulos en coordenadas locales (x hacia adelante)
  classic: [[0, -3, 13, 6], [13, -2, 5, 4]], sheriff: [[0, -3.5, 14, 7], [14, -2.5, 9, 5]],
  spectre: [[-4, -3.5, 20, 7], [16, -2, 8, 4], [4, 3, 4, 7]], vandal: [[-8, -3.5, 28, 7], [20, -2, 10, 4], [6, 3, 4, 8], [-8, -4.5, 6, 9]],
  operator: [[-10, -3.5, 34, 7], [24, -2, 14, 4], [4, -7, 12, 4], [-10, -5, 7, 10]],
};

/* =========================================================
   SELECCIÓN DE AGENTE + EMPAREJAMIENTO
   ========================================================= */
let selMode = "online", agentId = store.get("gc_agent", "rafaga"), botDiff = store.get("gc_diff", "oro");
if (!AGENTS[agentId]) agentId = "rafaga";
function renderAgents() {
  const box = $("#agents"); box.innerHTML = "";
  Object.entries(AGENTS).forEach(([id, a]) => {
    const b = document.createElement("button"); b.className = "agent"; b.style.setProperty("--ac", a.color);
    b.setAttribute("aria-pressed", String(id === agentId));
    b.innerHTML = '<span style="color:' + a.color + '">' + AGENT_SVG[a.ab.id] + '</span><span class="ag-role">' + a.role + '</span><span class="ag-name">' + a.name + '</span><span class="ag-ab"><b>' + a.ab.name + " · " + a.ab.charges + (a.ab.charges > 1 ? " cargas" : " carga") + "</b>" + a.ab.desc + "</span>";
    b.addEventListener("click", () => { agentId = id; store.set("gc_agent", id); AU.ui(); renderAgents(); });
    box.appendChild(b);
  });
}
function renderDiffs() { $$("[data-diff]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.diff === botDiff))); }
$$("[data-diff]").forEach((b) => b.addEventListener("click", () => { botDiff = b.dataset.diff; store.set("gc_diff", botDiff); AU.ui(); renderDiffs(); }));
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => navigator.standalone || matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches;
function openSelect(mode) {
  if (!requirePlayer()) return;
  AU.unlock();
  selMode = mode; show("select");
  $("#sel-mode-label").textContent = mode === "online" ? "Duelo online" : "Práctica contra bot";
  $("#sel-online").hidden = mode !== "online"; $("#sel-bot").hidden = mode !== "bot";
  renderAgents(); renderDiffs();
  $("#ios-tip").hidden = !(isIOS && !standalone());
  $("#sel-friend").hidden = mode !== "online"; $("#f-msg").textContent = "";
  if (mode === "online") setSearch("Listo para buscar rival", "Funciona con wifi o datos, desde cualquier lugar.", false);
}
$("#play-online").addEventListener("click", () => { if (!requirePlayer()) return; openSelect("online"); goFullscreen(); NET.search(); });
$("#play-bot").addEventListener("click", () => openSelect("bot"));
$("#s-bot").addEventListener("click", () => { // practicar sin dejar de buscar rival
  AU.unlock(); goFullscreen();
  GAME.start({ mode: "bot", diff: botDiff, agent: agentId, oppNick: "BOT " + botDiff.toUpperCase(), oppAgent: "rafaga", bg: true });
});
function setSearch(h, sub, searching) {
  $("#s-title").textContent = h; $("#s-sub").textContent = sub || "";
  $("#radar").hidden = !searching; $("#s-find").hidden = !!searching; $("#s-cancel").hidden = !searching;
  $("#s-bot").hidden = !searching; $("#s-bot-note").hidden = !searching;
  if (!$("#f-code-box").hidden) $("#f-status").textContent = sub || h;
  const er = $("#end-rematch"); if (!er.hidden) er.textContent = h + (sub ? " · " + sub : "");
}
/* jugar con un amigo: sala con código */
$("#f-create").addEventListener("click", () => {
  AU.unlock(); goFullscreen(); $("#f-msg").textContent = "";
  $("#f-code-box").hidden = false; $("#f-code").textContent = "····"; $("#f-status").textContent = "Creando sala…";
  NET.createRoom("", (code) => { $("#f-code").textContent = code; $("#f-status").textContent = "Pasale este código a tu amigo. Esperando…"; }, (err) => { $("#f-code-box").hidden = true; $("#f-msg").textContent = err; });
});
$("#f-input").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
$("#f-join").addEventListener("submit", (e) => {
  e.preventDefault(); AU.unlock();
  const code = $("#f-input").value.trim().toUpperCase();
  if (code.length !== 4) { $("#f-msg").textContent = "El código tiene 4 caracteres."; return; }
  goFullscreen(); $("#f-msg").style.color = "var(--muted)"; $("#f-msg").textContent = "Entrando a la sala " + code + "…"; $("#f-code-box").hidden = true;
  NET.joinRoom(code, 1, (err) => { $("#f-msg").style.color = "var(--red)"; $("#f-msg").textContent = err; });
});
function goFullscreen() {
  if (!isTouch()) return;
  try {
    const el = document.documentElement, rq = el.requestFullscreen || el.webkitRequestFullscreen;
    if (rq && !document.fullscreenElement) {
      const p = rq.call(el, { navigationUI: "hide" });
      if (p && p.then) p.then(() => { try { screen.orientation.lock("landscape").catch(() => {}); } catch (e) {} }).catch(() => {});
    }
  } catch (e) {}
}
function exitFullscreen() { try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) {} }
$("#s-find").addEventListener("click", () => { AU.unlock(); goFullscreen(); NET.search(); });
$("#s-cancel").addEventListener("click", () => { NET.cancel(); setSearch("Búsqueda cancelada", "Tocá Buscar rival cuando quieras.", false); });
$("#b-start").addEventListener("click", () => { AU.unlock(); goFullscreen(); GAME.start({ mode: "bot", diff: botDiff, agent: agentId, oppNick: "BOT " + botDiff.toUpperCase(), oppAgent: "rafaga" }); });

/* =========================================================
   RED: conexión directa (WebRTC) con plan B por el servidor
   ========================================================= */
const NET = (() => {
  let search = null, net = null, icePromise = null, lastMatch = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function getIce() {
    if (!icePromise) icePromise = fetch("/api/ice", { cache: "no-store" }).then((r) => r.json()).then((j) => j.iceServers || []).catch(() => { icePromise = null; return [{ urls: "stun:stun.l.google.com:19302" }]; });
    return icePromise;
  }
  function gathered(pc, ms) {
    return new Promise((res) => {
      if (pc.iceGatheringState === "complete") return res();
      const t = setTimeout(res, ms);
      pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } });
    });
  }
  const sig = (n, body) => api("/api/match", Object.assign({ pid: PID, room: n.room }, body));
  function closePc(n) { try { n.dc && n.dc.close(); } catch (e) {} try { n.pc && n.pc.close(); } catch (e) {} n.dc = null; n.pc = null; }
  function toRelay(n) { if (n.via === "relay") return; n.via = "relay"; closePc(n); n.out({ t: "ping" }); clearTimeout(n.relayT); relayLoop(n); badge(); }
  function wireDc(n, dc) {
    n.dc = dc;
    dc.onopen = () => { if (net !== n) return; if (n.role === "guest" && !n.via) { n.via = "rtc"; clearTimeout(n.pickT); hello(n); } };
    dc.onmessage = (e) => { if (net !== n) return; let m; try { m = JSON.parse(e.data); } catch (err) { return; } recv(m, "rtc"); };
    dc.onclose = () => { if (net === n && n.via === "rtc" && !n.left && !n.closed) toRelay(n); };
  }
  async function rtcGuest(n) {
    const pc = new RTCPeerConnection({ iceServers: await getIce() }); if (net !== n) { pc.close(); return; }
    n.pc = pc; wireDc(n, pc.createDataChannel("gc", { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc, 2500); if (net !== n || n.via) return;
    await sig(n, { action: "signal", kind: "offer", sdp: pc.localDescription.sdp });
    for (let i = 0; i < 40 && net === n && !n.via; i++) {
      const j = await sig(n, { action: "wait", kind: "answer" }).catch(() => ({}));
      if (j.sdp === "RELAY") throw new Error("relay");
      if (j.sdp) { if (n.pc === pc) await pc.setRemoteDescription({ type: "answer", sdp: j.sdp }); return; }
      await sleep(350);
    }
  }
  async function rtcHost(n) {
    const ice = getIce();
    for (let i = 0; i < 50 && net === n && !n.via; i++) {
      const j = await sig(n, { action: "wait", kind: "offer" }).catch(() => ({}));
      if (j.sdp) {
        const pc = new RTCPeerConnection({ iceServers: await ice }); if (net !== n || n.via) { pc.close(); return; }
        n.pc = pc; pc.ondatachannel = (e) => { if (net === n) wireDc(n, e.channel); };
        await pc.setRemoteDescription({ type: "offer", sdp: j.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc, 2500); if (net !== n || n.via) return;
        await sig(n, { action: "signal", kind: "answer", sdp: pc.localDescription.sdp });
        return;
      }
      await sleep(350);
    }
  }
  async function relayLoop(n) {
    if (net !== n || n.closed) return;
    const msgs = n.outbox.splice(0, 60);
    try {
      const j = await sig(n, { action: "relay", role: n.role === "host" ? "h" : "g", msgs });
      if (net === n) (j.msgs || []).forEach((m) => recv(m, "relay"));
    } catch (e) { if (net === n) n.outbox.unshift(...msgs.filter((m) => m.t !== "s")); }
    if (net === n && !n.closed) n.relayT = setTimeout(() => relayLoop(n), n.via === "relay" ? 60 : n.via === "rtc" ? 2500 : 700);
  }
  function hello(n) { n.out({ t: "hello", nick: nick(), agent: agentId }); }
  function recv(m, src) {
    const n = net; if (!m || typeof m !== "object" || !n) return;
    if (src === "relay" && n.via === "rtc" && n.started) toRelay(n);
    n.lastRecv = now();
    if (m.t === "hello") {
      if (!n.via) { n.via = src; if (src === "relay") closePc(n); }
      n.opp.nick = String(m.nick || "RIVAL").replace(/[<>]/g, "").toUpperCase().slice(0, 14);
      n.opp.agent = AGENTS[m.agent] ? m.agent : "rafaga";
      if (n.role === "host" && !n.started) { n.started = true; n.out({ t: "start", nick: nick(), agent: agentId }); launch(n); }
      return;
    }
    if (m.t === "start") {
      if (n.role === "guest" && !n.started) {
        n.opp.nick = String(m.nick || n.opp.nick || "RIVAL").replace(/[<>]/g, "").toUpperCase().slice(0, 14);
        n.opp.agent = AGENTS[m.agent] ? m.agent : "rafaga";
        n.started = true; launch(n);
      }
      return;
    }
    if (m.t === "bye") { left(); return; }
    if (m.t === "ping") return;
    if (n.started) GAME.onNet(m);
  }
  function launch(n) {
    clearTimeout(n.failT); badge();
    GAME.start({ mode: "online", role: n.role, agent: agentId, oppNick: n.opp.nick, oppAgent: n.opp.agent });
  }
  function left() {
    const n = net; if (!n || n.left) return; n.left = true;
    if (n.started) GAME.opponentLeft();
    else { close(true); setSearch("Se cortó la conexión", "Buscando otro rival…", true); restart(); }
  }
  function badge() {
    const b = $("#net-badge"); if (!b) return;
    if (!net || !net.via) { b.hidden = true; return; }
    b.hidden = false; b.textContent = net.via === "rtc" ? "Conexión directa" : "Conexión por servidor";
  }
  function connectTo(j, my) {
    const role = j.role, room = role === "guest" ? j.opp.peer : my.sid;
    clearTimeout(my.timer); search = null;
    lastMatch = { room, role, oppNick: (j.opp && j.opp.nick) || "RIVAL" };
    const n = { role, room, opp: { nick: (j.opp && j.opp.nick) || "RIVAL", agent: "rafaga" }, via: null, outbox: [], lastRecv: now(), started: false, left: false, closed: false };
    n.out = (m) => {
      if (n.closed) return;
      if (n.via === "rtc" && n.dc && n.dc.readyState === "open") { try { n.dc.send(JSON.stringify(m)); return; } catch (e) {} }
      if (!n.via) return;
      if (m.t === "s") { const i = n.outbox.findIndex((x) => x.t === "s"); if (i >= 0) { n.outbox[i] = m; return; } }
      n.outbox.push(m); if (n.outbox.length > 150) n.outbox.splice(0, n.outbox.length - 150);
    };
    net = n;
    setSearch("¡Rival encontrado!", "Conectando con " + n.opp.nick + "…", true); AU.beep(1200);
    relayLoop(n);
    const direct = !window.GC_FORCE_RELAY && typeof RTCPeerConnection === "function";
    if (role === "guest") {
      const pick = () => { if (net === n && !n.via) { n.via = "relay"; closePc(n); hello(n); setSearch("¡Rival encontrado!", "Conectando por el servidor…", true); } };
      if (direct) { rtcGuest(n).catch(pick); n.pickT = setTimeout(pick, 11000); } else pick();
    } else {
      const noDirect = () => { if (net === n && !n.via) sig(n, { action: "signal", kind: "answer", sdp: "RELAY" }).catch(() => {}); };
      if (direct) rtcHost(n).catch(noDirect); else noDirect();
    }
    n.failT = setTimeout(() => { if (net === n && !n.started) { close(true); setSearch("No se pudo conectar con tu rival", "Buscando otro…", true); restart(); } }, 26000);
  }
  function close(quiet) {
    const n = net; if (!n) return;
    net = null; n.closed = true;
    clearTimeout(n.relayT); clearTimeout(n.pickT); clearTimeout(n.failT);
    if (!quiet) {
      try { if (n.dc && n.dc.readyState === "open") n.dc.send(JSON.stringify({ t: "bye" })); } catch (e) {}
      api("/api/match", { action: "relay", pid: PID, room: n.room, role: n.role === "host" ? "h" : "g", msgs: [{ t: "bye" }] }).catch(() => {});
    }
    setTimeout(() => closePc(n), 300); badge();
  }
  function searchStart() {
    if (!requirePlayer()) return;
    stopSearch(); close(true);
    const my = { sid: newId().replace(/[^a-zA-Z0-9-]/g, "").slice(0, 36), timer: 0 };
    search = my;
    setSearch("Buscando rival…", "Conectando con el servidor", true);
    getIce();
    async function poll() {
      if (search !== my) return;
      try {
        const j = await api("/api/match", { action: "poll", pid: PID, peer: my.sid, nick: nick() });
        if (search !== my) return;
        if (j.status === "matched") { connectTo(j, my); return; }
        const k = Math.max(0, (j.searching || 1) - 1);
        $("#s-sub").textContent = k ? k + " jugador" + (k > 1 ? "es" : "") + " más buscando ahora" : "Sos el único buscando. Pasale el link a un amigo o practicá mientras.";
      } catch (e) {
        if (/Falta conectar/.test(e.message)) { setSearch("El modo online no está activo", "Avisale al organizador. Mientras, podés practicar contra el bot.", false); stopSearch(); return; }
        $("#s-sub").textContent = "Sin conexión con el servidor, reintentando…";
      }
      my.timer = setTimeout(poll, 1500);
    }
    poll();
  }
  function restart(delay) { const wasPrivate = !!(lastMatch && lastMatch.private); stopSearch(); setTimeout(() => { if (!$("#select").hidden && !net && selMode === "online" && !wasPrivate) searchStart(); }, delay || 900); }
  const newSid = () => newId().replace(/[^a-zA-Z0-9-]/g, "").slice(0, 36);
  async function createRoom(code, onCode, onErr) {
    if (!requirePlayer()) return;
    stopSearch(); close(true);
    const my = { sid: newSid(), timer: 0, private: true }; search = my;
    try {
      const j = await api("/api/match", { action: "code_create", pid: PID, peer: my.sid, nick: nick(), code: code || "" });
      if (search !== my) return; my.code = j.code; onCode && onCode(j.code);
    } catch (e) { if (search === my) search = null; onErr && onErr(/Falta conectar/.test(e.message) ? "El modo online no está activo." : e.message); return; }
    getIce();
    async function poll() {
      if (search !== my) return;
      try {
        const j = await api("/api/match", { action: "poll", pid: PID, peer: my.sid, nick: nick(), private: 1 });
        if (search !== my) return;
        if (j.status === "matched") { connectTo(j, my); lastMatch.private = true; return; }
      } catch (e) {}
      my.timer = setTimeout(poll, 1300);
    }
    poll();
  }
  async function joinRoom(code, tries, onErr) {
    if (!requirePlayer()) return;
    stopSearch(); close(true);
    const my = { sid: newSid(), timer: 0, private: true }; search = my;
    getIce();
    for (let i = 0; i < tries; i++) {
      if (search !== my) return;
      try {
        const j = await api("/api/match", { action: "code_join", pid: PID, peer: my.sid, nick: nick(), code });
        if (search !== my) return;
        connectTo(j, my); lastMatch.private = true; return;
      } catch (e) {
        if (i === tries - 1 || e.status !== 404) { if (search === my) search = null; onErr && onErr(/Falta conectar/.test(e.message) ? "El modo online no está activo." : e.message); return; }
        await sleep(1200);
      }
    }
  }
  function stopSearch() { const old = search; search = null; if (old) { clearTimeout(old.timer); api("/api/match", { action: "leave", pid: PID }).catch(() => {}); } }
  window.addEventListener("pagehide", () => {
    if (!net) return;
    try { if (net.dc && net.dc.readyState === "open") net.dc.send(JSON.stringify({ t: "bye" })); } catch (e) {}
    try { navigator.sendBeacon("/api/match", new Blob([JSON.stringify({ action: "relay", pid: PID, room: net.room, role: net.role === "host" ? "h" : "g", msgs: [{ t: "bye" }] })], { type: "application/json" })); } catch (e) {}
  });
  return {
    search: searchStart,
    createRoom, joinRoom,
    rematch(onErr) {
      const lm = lastMatch; if (!lm) return;
      const code = ("RM" + lm.room).toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 48);
      if (lm.role === "host") createRoom(code, null, onErr); else joinRoom(code, 25, onErr);
    },
    lastOpp: () => (lastMatch ? lastMatch.oppNick : ""),
    searching: () => !!search || !!(net && !net.started),
    cancel() { stopSearch(); close(); },
    close,
    send(m) { if (net) net.out(m); },
    lastRecv: () => (net ? net.lastRecv : now()),
    active: () => !!(net && net.started),
    via: () => (net ? net.via : null),
  };
})();

/* =========================================================
   MOTOR DEL DUELO
   ========================================================= */
const GAME = (() => {
  const W = 1120, H = 700, R = 16, RUN = 200, WALK = 105;
  const WIN = 7, ROUND_MS = 35000, BUY_MS = 7000, BUY_LONG = 10000, POST_MS = 2400, HALF_MS = 2600, MAX_CR = 9000, BUYZ = 135;
  // Mapa "Distrito": mitad izquierda + copia rotada 180° (simétrico para los dos lados)
  // Mapa "Distrito" compacto: mitad izquierda + copia rotada 180° (justo para los dos lados)
  const LEFT = [[150, 0, 30, 170], [150, 530, 30, 170], [250, 120, 130, 30], [250, 120, 30, 100], [330, 300, 50, 50], [230, 430, 30, 140],
    [340, 540, 120, 30], [415, 70, 30, 110], [450, 250, 44, 44], [490, 0, 140, 44], [395, 410, 44, 44]];
  const WALLS = [...LEFT, ...LEFT.map(([x, y, w, h]) => [W - x - w, H - y - h, w, h]), [535, 305, 50, 90]];
  const SPAWN = { L: { x: 70, y: 350, a: 0 }, R: { x: 1050, y: 350, a: Math.PI } };
  const WAYPOINTS = [[560, 120], [560, 590], [560, 230], [560, 470], [390, 210], [730, 490], [300, 390], [820, 310], [480, 350], [640, 350], [210, 80], [910, 620], [910, 80], [210, 620]];
  const BOTS = { hierro: { react: 620, err: .16, speed: .85, label: "Hierro" }, oro: { react: 360, err: .085, speed: .95, label: "Oro" }, radiante: { react: 200, err: .04, speed: 1.03, label: "Radiante" } };

  let cv = $("#cv"), ctx = cv.getContext("2d"), fog = document.createElement("canvas"), fctx = fog.getContext("2d");
  let dpr = 1, cw = 0, ch = 0, zoom = 1;
  let M = null, S = null, raf = 0, last = 0, input = null, timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const online = () => M && M.mode === "online";
  const isHost = () => !online() || M.role === "host";
  const send = (m) => { if (online()) NET.send(m); };

  /* ---------- geometría ---------- */
  function rayRect(ox, oy, dx, dy, x, y, w, h) {
    let t0 = 0, t1 = Infinity;
    if (Math.abs(dx) < 1e-9) { if (ox < x || ox > x + w) return Infinity; } else { let a = (x - ox) / dx, b = (x + w - ox) / dx; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return Infinity; }
    if (Math.abs(dy) < 1e-9) { if (oy < y || oy > y + h) return Infinity; } else { let a = (y - oy) / dy, b = (y + h - oy) / dy; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return Infinity; }
    return t0;
  }
  function rayCircle(ox, oy, dx, dy, cx, cy, r) {
    const fx = ox - cx, fy = oy - cy, b = fx * dx + fy * dy, c = fx * fx + fy * fy - r * r, disc = b * b - c;
    if (disc < 0) return Infinity; const t = -b - Math.sqrt(disc); return t >= 0 ? t : (c <= 0 ? 0 : Infinity);
  }
  function solids() { return S ? WALLS.concat(S.barriers.map((b) => [b.x, b.y, b.w, b.h])) : WALLS; }
  function blockDist(ox, oy, dx, dy) {
    let t = Infinity;
    for (const r of solids()) t = Math.min(t, rayRect(ox, oy, dx, dy, r[0], r[1], r[2], r[3]));
    if (dx > 0) t = Math.min(t, (W - ox) / dx); if (dx < 0) t = Math.min(t, -ox / dx);
    if (dy > 0) t = Math.min(t, (H - oy) / dy); if (dy < 0) t = Math.min(t, -oy / dy);
    return t;
  }
  function inSmoke(x, y) { return S.smokes.some((s) => Math.hypot(x - s.x, y - s.y) < s.r); }
  function canSee(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    if (blockDist(a.x, a.y, dx / d, dy / d) < d - R) return false;
    for (const s of S.smokes) { const t = rayCircle(a.x, a.y, dx / d, dy / d, s.x, s.y, s.r * .92); if (t < d) return false; }
    return true;
  }
  function collide(f) {
    f.x = clamp(f.x, R, W - R); f.y = clamp(f.y, R, H - R);
    for (const [x, y, w, h] of solids()) {
      const cx = clamp(f.x, x, x + w), cy = clamp(f.y, y, y + h);
      let dx = f.x - cx, dy = f.y - cy, d = Math.hypot(dx, dy);
      if (d < R) {
        if (d < 1e-6) { dx = f.x - (x + w / 2); dy = f.y - (y + h / 2); d = Math.hypot(dx, dy) || 1; f.x = x + w / 2 + dx / d * (Math.max(w, h) / 2 + R); f.y = y + h / 2 + dy / d * (Math.max(w, h) / 2 + R); }
        else { f.x = cx + dx / d * R; f.y = cy + dy / d * R; }
      }
    }
  }
  function free(x, y) { if (x < R || y < R || x > W - R || y > H - R) return false; for (const [rx, ry, rw, rh] of solids()) { const cx = clamp(x, rx, rx + rw), cy = clamp(y, ry, ry + rh); if (Math.hypot(x - cx, y - cy) < R + 2) return false; } return true; }
  const turn = (a, target, max) => { const d = ((target - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + clamp(d, -max, max); };

  /* ---------- luchadores ---------- */
  function mkFighter(side, agent) {
    const s = SPAWN[side];
    return { x: s.x, y: s.y + (Math.random() - .5) * 50, a: s.a, vx: 0, vy: 0, hp: 100, sh: 0, w: "classic", ammo: WEAPONS.classic.mag, reloadUntil: 0, reloading: false,
      nextShot: 0, spray: 0, lastShot: -1e9, flash: -1e9, hitAt: -1e9, dashUntil: 0, dashVx: 0, dashVy: 0, alive: true, agent, charges: AGENTS[agent].ab.charges, stepAt: 0, side };
  }
  function econNew() { return { credits: 800, streak: 0, keepW: "classic", keepSh: 0, boughtW: null, boughtSh: 0 }; }

  /* ---------- partida ---------- */
  function start(opts) {
    stopLoop();
    const role = opts.role || "host";
    M = { mode: opts.mode, role, diff: opts.diff || "oro", agent: opts.agent, oppNick: opts.oppNick || "RIVAL", oppAgent: opts.oppAgent || "rafaga",
      side: (opts.mode === "bot" || role === "host") ? "L" : "R", score: { me: 0, opp: 0 }, history: [], roundNo: 0, half: false, ot: false, over: false,
      econ: econNew(), botEcon: econNew(), stats: { kills: 0, deaths: 0, shots: 0, hits: 0, dmg: 0 }, startedAt: Date.now(), result: null, pending: null };
    $("#game").hidden = false; document.body.style.overflow = "hidden"; document.documentElement.classList.add("game-open");
    M.bg = !!opts.bg;
    $("#end").hidden = true; $("#confirm").hidden = true; $("#buy").hidden = true; $("#banner").hidden = true;
    $("#sb-me-name").textContent = nick() || "VOS"; $("#sb-opp-name").textContent = M.oppNick;
    const ag = AGENTS[M.agent]; $("#act-ab").style.setProperty("--ac", ag.color); $("#ab-ico").innerHTML = AGENT_SVG[ag.ab.id]; $("#ab-ico").style.color = ag.color; $("#ab-name").textContent = ag.ab.name;
    renderPips();
    resize(); setupInput(); checkRotate();
    try { navigator.wakeLock && navigator.wakeLock.request("screen").catch(() => {}); } catch (e) {}
    startRound();
    if (opts.mode === "online") { setTimeout(() => alertMsg("¡Rival encontrado: " + M.oppNick + "!", 1800), 300); buzz([40, 60, 40]); }
    last = now(); raf = requestAnimationFrame(loop);
    presence();
  }
  function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }
  function startRound() {
    M.roundNo++;
    const oppSide = M.side === "L" ? "R" : "L";
    const p = mkFighter(M.side, M.agent), o = mkFighter(oppSide, M.oppAgent);
    p.w = M.econ.keepW; p.ammo = WEAPONS[p.w].mag; p.sh = M.econ.keepSh;
    M.econ.boughtW = null; M.econ.boughtSh = 0;
    if (!online()) { botBuy(o); }
    const t = now(), long = M.roundNo === 1 || M.justHalf || M.justOT;
    S = { p, o, smokes: [], barriers: [], tracers: [], sparks: [], pops: [], rings: [], parts: [], shells: [],
      phase: "buy", phaseEnd: t + (long ? BUY_LONG : BUY_MS), roundEnd: 0, reveal: 0, lastSeen: null, cam: { x: p.x + 160 * (M.side === "L" ? 1 : -1), y: p.y, shake: 0 },
      rt: { x: o.x, y: o.y, a: o.a, hp: 100, sh: 0, w: "classic", t: t, px: o.x, py: o.y }, ai: { seenAt: 0, target: null, wp: null, stuckT: t, lx: o.x, ly: o.y, burst: 0, strafeUntil: 0, dir: 1, aimErr: 0, wanderUntil: 0 },
      hitmark: -1e9, alertUntil: 0, deadAt: 0, fogSeg: null };
    M.justHalf = false; M.justOT = false;
    const sub = M.ot ? "Ronda decisiva" : M.score.me === WIN - 1 || M.score.opp === WIN - 1 ? "Punto de partido" : "Primero a " + WIN;
    banner("Ronda " + M.roundNo, "Fase de compra", sub, "", 1500);
    openBuy(true);
    hud(true);
  }
  function goLive() {
    S.phase = "live"; S.roundEnd = now() + ROUND_MS; closeBuy();
    AU.beep(990); setTimeout(() => AU.beep(1320), 120);
    alertMsg("¡A jugar!", 900);
  }
  function hostEndRound(winner, cause) {
    if (!S || S.phase !== "live") return;
    if (online()) send({ t: "round", w: winner === "me" ? "h" : winner === "opp" ? "g" : "", c: cause, hs: M.score.me + (winner === "me" ? 1 : 0), gs: M.score.opp + (winner === "opp" ? 1 : 0) });
    applyRoundEnd(winner, cause);
  }
  function applyRoundEnd(winner, cause) {
    if (!S || (S.phase !== "live")) return;
    S.phase = "post"; S.phaseEnd = now() + POST_MS;
    if (winner === "me") M.score.me++; else if (winner === "opp") M.score.opp++;
    M.history.push(winner === "me" ? "w" : winner === "opp" ? "l" : "t");
    // economía propia
    const e = M.econ;
    if (winner === "me") { e.credits += 3000 + (cause === "kill" ? 200 : 0); e.streak = 0; }
    else { e.credits += Math.min(1900 + 500 * e.streak, 2900); e.streak++; }
    e.credits = Math.min(MAX_CR, e.credits);
    if (S.p.alive) { e.keepW = S.p.w; e.keepSh = S.p.sh; } else { e.keepW = "classic"; e.keepSh = 0; }
    if (!online()) {
      const b = M.botEcon;
      if (winner === "opp") { b.credits += 3200; b.streak = 0; } else { b.credits += Math.min(1900 + 500 * b.streak, 2900); b.streak++; }
      b.credits = Math.min(MAX_CR, b.credits);
      if (S.o.alive) { b.keepW = S.o.w; b.keepSh = S.o.sh; } else { b.keepW = "classic"; b.keepSh = 0; }
    }
    if (cause === "kill") {
      if (winner === "me") { killfeed(nick() || "VOS", M.oppNick, S.p.w, true); if (S.o.alive) killFighter(S.o); }
      else if (winner === "opp") { killfeed(M.oppNick, nick() || "VOS", S.o.w || "classic", false); if (S.p.alive) killFighter(S.p); }
    }
    if (M.score.me >= WIN || M.score.opp >= WIN) M.over = true;
    else if (!M.half && M.score.me + M.score.opp === WIN - 1) M.pending = "half";
    else if (!M.ot && M.score.me === WIN - 1 && M.score.opp === WIN - 1) M.pending = "ot";
    closeBuy();
    if (winner === "me") { banner("Ronda ganada", cause === "time" ? "Por tiempo" : "Eliminaste a " + M.oppNick, M.score.me + " – " + M.score.opp, "win"); AU.win(); }
    else if (winner === "opp") { banner("Ronda perdida", cause === "time" ? "Por tiempo" : M.oppNick + " te eliminó", M.score.me + " – " + M.score.opp, "lose"); AU.lose(); }
    else banner("Empate", "Nadie suma la ronda", M.score.me + " – " + M.score.opp, "");
    renderPips(); hud(true);
  }
  function afterPost() {
    if (M.over) return finishMatch();
    if (M.pending === "half") {
      M.pending = null; M.half = true; M.justHalf = true; M.side = M.side === "L" ? "R" : "L";
      M.econ = econNew(); M.botEcon = econNew();
      S.phase = "half"; S.phaseEnd = now() + HALF_MS;
      banner("Cambio de lado", "Medio tiempo", "Créditos reiniciados · 800 ¤", ""); AU.beep(660);
      return;
    }
    if (M.pending === "ot") {
      M.pending = null; M.ot = true; M.justOT = true;
      [M.econ, M.botEcon].forEach((e) => { e.credits = 5000; e.keepW = "classic"; e.keepSh = 0; e.streak = 0; });
      S.phase = "half"; S.phaseEnd = now() + HALF_MS;
      banner("Ronda decisiva", "6 – 6", "Todos con 5000 ¤", ""); AU.beep(440);
      return;
    }
    startRound();
  }

  /* ---------- fin de partida ---------- */
  function finishMatch(forfeit) {
    if (!M || M.result) return;
    const won = forfeit ? true : M.score.me > M.score.opp;
    M.result = { won, forfeit: !!forfeit };
    S.phase = "end";
    if (online()) setTimeout(() => NET.close(), 1200);
    const st = M.stats, acc = st.shots ? Math.round(100 * st.hits / st.shots) : 0;
    const end = $("#end"); end.hidden = false; end.className = "end " + (won ? "win" : "lose");
    $("#end-kicker").textContent = forfeit ? "Tu rival abandonó" : online() ? "Duelo online" : "Práctica vs bot " + BOTS[M.diff].label;
    $("#end-title").textContent = won ? "Victoria" : "Derrota";
    $("#end-me").textContent = M.score.me; $("#end-opp").textContent = M.score.opp;
    $("#end-vs").textContent = (nick() || "VOS") + " vs " + M.oppNick;
    $("#end-stats").innerHTML = [["Eliminaciones", st.kills], ["Muertes", st.deaths], ["Precisión", acc + "%"], ["Daño", st.dmg]].map((r) => "<div><dt>" + r[0] + "</dt><dd>" + r[1] + "</dd></div>").join("");
    won ? AU.win() : AU.lose();
    $("#end-pts").textContent = "Guardando en el ranking…";
    $("#end-rematch").hidden = true; $("#end-rematch-btn").hidden = !online() || !!forfeit;
    $("#end-again").textContent = online() ? "Nuevo rival" : "Jugar otra vez";
    submit(won, !!forfeit);
  }
  async function submit(won, forfeit, quiet) {
    const body = { pid: PID, nick: nick(), mode: M.mode, won, forfeit, rw: M.score.me, rl: M.score.opp, kills: M.stats.kills, diff: M.diff, opp: M.oppNick, agent: M.agent };
    const h = store.get("gc_hist2", []); h.unshift({ mode: M.mode, won, forfeit, rw: M.score.me, rl: M.score.opp, opp: M.oppNick, diff: M.mode === "bot" ? M.diff : "", pts: 0, t: Date.now() }); store.set("gc_hist2", h.slice(0, 30));
    try {
      await syncPlayer();
      const j = await api("/api/score", body);
      if (!quiet) $("#end-pts").textContent = "+" + fmt(j.pts) + " pts · Puesto #" + j.rank + " de " + j.players + " · Total " + fmt(j.total);
    } catch (e) {
      const q = store.get("gc_pending2", []); q.push(body); store.set("gc_pending2", q.slice(-20));
      if (!quiet) $("#end-pts").textContent = "Sin conexión: tu resultado se guarda en cuanto vuelva internet.";
    }
  }
  async function flushPending() {
    const q = store.get("gc_pending2", []); if (!q.length) return;
    const keep = []; for (const b of q) { try { await api("/api/score", b); } catch (e) { keep.push(b); } }
    store.set("gc_pending2", keep);
  }
  function opponentLeft() {
    if (!M || M.result) return;
    if (M.over) { finishMatch(); return; } // la partida ya estaba definida: no es abandono
    banner("Tu rival se desconectó", "Ganás por abandono", "", "win");
    if (S) S.phase = "end";
    later(() => finishMatch(true), 1500);
  }
  function leave() {
    if (M && !M.result && online()) { // salir de un online cuenta como derrota
      M.result = { won: false, forfeit: false }; NET.close(); submit(false, false, true);
    }
    close();
  }
  function close() {
    stopLoop(); teardownInput();
    $("#game").hidden = true; document.body.style.overflow = ""; document.documentElement.classList.remove("game-open"); exitFullscreen();
    M = null; S = null; presence();
  }
  function stopLoop() { cancelAnimationFrame(raf); raf = 0; timers.forEach(clearTimeout); timers = []; }

  /* ---------- compra ---------- */
  function botBuy(o) {
    const b = M.botEcon; o.w = b.keepW; o.sh = b.keepSh; o.ammo = WEAPONS[o.w].mag;
    const want = (id) => { const c = WEAPONS[id].cost; if (b.credits >= c && WEAPONS[o.w].cost < c) { b.credits -= c; o.w = id; o.ammo = WEAPONS[id].mag; } };
    if (b.credits >= 3300) want("vandal"); else if (b.credits >= 1600 && M.diff !== "hierro") want("spectre"); else if (b.credits >= 800) want("sheriff");
    if (b.credits >= 1000 && o.sh < 50) { b.credits -= 1000; o.sh = 50; } else if (b.credits >= 400 && o.sh < 25) { b.credits -= 400; o.sh = 25; }
  }
  function buy(id) {
    if (!S || S.phase !== "buy") return;
    const e = M.econ, p = S.p;
    if (WEAPONS[id]) {
      const wd = WEAPONS[id]; if (p.w === id) return;
      const refund = e.boughtW ? WEAPONS[e.boughtW].cost : 0;
      if (e.credits + refund < wd.cost) { AU.deny(); flashCard(id); return; }
      e.credits += refund - wd.cost; p.w = id; p.ammo = wd.mag; e.boughtW = wd.cost > 0 ? id : null;
    } else {
      const sd = SHIELDS[id]; if (p.sh >= sd.val) return;
      const refund = e.boughtSh ? (e.boughtSh === 50 ? 1000 : 400) : 0;
      if (e.credits + refund < sd.cost) { AU.deny(); flashCard(id); return; }
      e.credits += refund - sd.cost; p.sh = sd.val; e.boughtSh = sd.val;
    }
    AU.buy(); renderBuy(); hud(true);
    send({ t: "s", ...stateMsg() });
  }
  function flashCard(id) { const c = $('[data-buy="' + id + '"]'); if (c) c.animate([{ transform: "translateX(-5px)" }, { transform: "translateX(5px)" }, { transform: "none" }], { duration: 250 }); }
  function openBuy(auto) { if (!S || S.phase !== "buy") return; if (auto && store.get("gc_buy_closed", false) && M.roundNo > 1) return; $("#buy").hidden = false; renderBuy(); }
  function closeBuy() { $("#buy").hidden = true; }
  function renderBuy() {
    const g = $("#buy-grid"); g.innerHTML = ""; const e = M.econ, p = S.p;
    $("#buy-cr").textContent = fmt(e.credits);
    BUY_LIST.forEach((id, i) => {
      const d = WEAPONS[id] || SHIELDS[id], isW = !!WEAPONS[id];
      const owned = isW ? p.w === id : p.sh >= d.val;
      const refund = isW ? (e.boughtW ? WEAPONS[e.boughtW].cost : 0) : (e.boughtSh ? (e.boughtSh === 50 ? 1000 : 400) : 0);
      const can = owned || e.credits + refund >= d.cost;
      const b = document.createElement("button"); b.className = "wcard" + (owned ? " owned" : "") + (can ? "" : " cant"); b.dataset.buy = id;
      b.innerHTML = '<span class="wk">' + (i + 1) + '</span><span class="wc">' + d.cls + '</span><span class="wn">' + d.name.replace("Escudo ", "") + "</span>" + (isW ? "<canvas width=\"160\" height=\"26\"></canvas>" : "") + '<span class="ws">' + (isW ? d.dmg + " daño · " + d.note : "+" + d.val + " de escudo") + '</span><span class="wp">' + (owned ? "Equipado" : d.cost ? fmt(d.cost) + " ¤" : "Gratis") + "</span>";
      b.addEventListener("click", () => buy(id));
      g.appendChild(b);
      if (isW) { const c = b.querySelector("canvas"), x = c.getContext("2d"); x.translate(52, 13); x.scale(1.9, 1.9); drawGun(x, id, owned ? "#3fe0c5" : "#ece8e1"); }
    });
  }
  $("#act-buy").addEventListener("click", () => { if (!S) return; if (S.phase !== "buy") { alertMsg("Solo en la fase de compra", 900); return; } $("#buy").hidden ? openBuy() : closeBuy(); });
  $("#buy-close").addEventListener("click", () => { closeBuy(); store.set("gc_buy_closed", true); });

  /* ---------- disparos y daño ---------- */
  function startReload(f, t) { const wd = WEAPONS[f.w]; if (f.reloading || f.ammo >= wd.mag) return; f.reloading = true; f.reloadUntil = t + wd.reload; if (f === S.p) AU.reload(); }
  function tryShoot(f, target, t, isMe) {
    if (S.phase !== "live" || !f.alive || f.reloading || t < f.nextShot) return;
    const wd = WEAPONS[f.w];
    if (f.ammo <= 0) { startReload(f, t); return; }
    if (t - f.lastShot > 320) f.spray = 0;
    const sp = Math.hypot(f.vx, f.vy), mv = clamp((sp - 40) / (RUN - 40), 0, 1);
    let spread = wd.spread + wd.move * mv + Math.min(.12, f.spray * wd.spray);
    const a = f.a + (Math.random() - .5) * 2 * spread, dx = Math.cos(a), dy = Math.sin(a);
    const ox = f.x + dx * (R + 6), oy = f.y + dy * (R + 6);
    const tw = blockDist(ox, oy, dx, dy), tc = target.alive ? rayCircle(ox, oy, dx, dy, target.x, target.y, R) : Infinity;
    const hit = tc < tw && tc < 1800, end = Math.min(tw, tc, 1800);
    S.tracers.push({ x1: ox, y1: oy, x2: ox + dx * end, y2: oy + dy * end, t, me: isMe, w: f.w });
    f.ammo--; f.spray++; f.lastShot = t; f.nextShot = t + wd.fire; f.flash = t;
    const dist = Math.hypot(f.x - S.p.x, f.y - S.p.y);
    AU.shot(f.w, isMe ? 1 : clamp(1 - dist / 1100, .25, .9));
    if (isMe) { S.cam.shake = Math.min(10, S.cam.shake + (f.w === "operator" ? 9 : f.w === "sheriff" ? 5 : 2.4)); M.stats.shots++; }
    else if (!canSee(S.p, f)) S.rings.push({ x: f.x, y: f.y, t, r: 46, c: "255,70,85" });
    if (!hit) S.sparks.push({ x: ox + dx * end, y: oy + dy * end, t });
    if (online() && isMe) {
      send({ t: "shot", x1: Math.round(ox), y1: Math.round(oy), x2: Math.round(ox + dx * end), y2: Math.round(oy + dy * end), hit: hit ? 1 : 0, d: hit ? wd.dmg : 0, w: f.w });
      if (hit) { S.hitmark = t; M.stats.hits++; M.stats.dmg += wd.dmg; S.pops.push({ x: target.x, y: target.y - R - 6, txt: String(wd.dmg), t, good: true }); AU.hit(); target.hitAt = t; }
    } else if (hit) {
      if (isMe) { S.hitmark = t; M.stats.hits++; M.stats.dmg += Math.min(wd.dmg, target.hp + target.sh); AU.hit(); }
      damage(target, wd.dmg, isMe, t);
    }
    if (f.ammo <= 0) startReload(f, t);
  }
  function damage(target, dmg, byMe, t) {
    const abs = Math.min(target.sh, dmg); target.sh -= abs; target.hp = Math.max(0, target.hp - (dmg - abs));
    target.hitAt = t;
    S.pops.push({ x: target.x, y: target.y - R - 6, txt: String(dmg), t, good: byMe });
    if (target === S.p) { AU.hurt(); S.cam.shake = Math.min(14, S.cam.shake + 6); buzz(35); }
    if (target.hp <= 0 && target.alive) {
      killFighter(target);
      if (target === S.p) { M.stats.deaths++; if (isHost()) hostEndRound("opp", "kill"); else send({ t: "dead" }); }
      else { M.stats.kills++; AU.kill(); buzz(70); if (isHost()) hostEndRound("me", "kill"); }
    }
  }
  function killFighter(f) {
    if (!f.alive) return; f.alive = false; f.hp = 0;
    const t = now(), col = f === S.p ? "63,224,197" : "255,70,85";
    for (let i = 0; i < 26; i++) { const a = Math.random() * Math.PI * 2, s = 80 + Math.random() * 260; S.parts.push({ x: f.x, y: f.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: Math.random() * Math.PI, vr: (Math.random() - .5) * 12, s: 4 + Math.random() * 7, t, life: 700 + Math.random() * 600, c: col }); }
    S.rings.push({ x: f.x, y: f.y, t, r: 70, c: col });
    if (f === S.p) { S.deadAt = t; M.stats.deaths += online() ? 0 : 0; }
  }

  /* ---------- habilidades ---------- */
  function useAbility() {
    const p = S && S.p; if (!p || S.phase !== "live" || !p.alive) return;
    if (p.charges <= 0) { AU.deny(); alertMsg("Sin cargas esta ronda", 900); return; }
    const id = AGENTS[p.agent].ab.id, t = now();
    if (id === "dash") {
      let mx = input.mx, my = input.my; if (Math.hypot(mx, my) < .1) { mx = Math.cos(p.a); my = Math.sin(p.a); }
      const m = Math.hypot(mx, my) || 1; p.dashVx = mx / m * 950; p.dashVy = my / m * 950; p.dashUntil = t + 170;
      for (let i = 0; i < 10; i++) S.parts.push({ x: p.x, y: p.y, vx: -p.dashVx * (.1 + Math.random() * .2), vy: -p.dashVy * (.1 + Math.random() * .2), r: 0, vr: 0, s: 3 + Math.random() * 3, t, life: 350, c: "236,232,225" });
    } else if (id === "smoke") {
      const tgt = aimPoint(300); addSmoke(tgt.x, tgt.y, t); send({ t: "ab", k: "smoke", x: Math.round(tgt.x), y: Math.round(tgt.y) });
    } else if (id === "wall") {
      const c = Math.cos(p.a), s = Math.sin(p.a), cx = p.x + c * 56, cy = p.y + s * 56;
      const b = Math.abs(c) > Math.abs(s) ? { x: cx - 9, y: cy - 60, w: 18, h: 120 } : { x: cx - 60, y: cy - 9, w: 120, h: 18 };
      addBarrier(b, t); send({ t: "ab", k: "wall", x: Math.round(b.x), y: Math.round(b.y), w: b.w, h: b.h });
    } else if (id === "radar") {
      S.reveal = t + 3000; S.rings.push({ x: p.x, y: p.y, t, r: 650, c: "242,193,78", slow: true }); send({ t: "ab", k: "radar" });
    }
    p.charges--; AU.ability(id); hud(true);
  }
  function aimPoint(maxD) {
    const p = S.p; let tx, ty;
    if (input.mouse) { tx = input.mouse.x; ty = input.mouse.y; } else { tx = p.x + Math.cos(p.a) * 220; ty = p.y + Math.sin(p.a) * 220; }
    let dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
    if (d > maxD) { dx = dx / d * maxD; dy = dy / d * maxD; d = maxD; }
    const block = blockDist(p.x, p.y, dx / d, dy / d); if (block < d) { dx = dx / d * Math.max(20, block - 10); dy = dy / d * Math.max(20, block - 10); }
    return { x: clamp(p.x + dx, 30, W - 30), y: clamp(p.y + dy, 30, H - 30) };
  }
  function addSmoke(x, y, t) { S.smokes.push({ x, y, r: 0, R: 64, born: t, until: t + 8000 }); }
  function addBarrier(b, t) { S.barriers.push({ ...b, born: t, until: t + 10000 }); [S.p, S.o].forEach(collide); }

  /* ---------- red: mensajes del rival ---------- */
  function stateMsg() { const p = S.p; return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, a: Math.round(p.a * 1000) / 1000, hp: p.hp, sh: p.sh, w: p.w, r: p.reloading ? 1 : 0, al: p.alive ? 1 : 0, n: M.roundNo }; }
  function onNet(m) {
    if (!M || !S || M.result) return;
    const t = now();
    if (m.t === "s") {
      if (m.n && m.n !== M.roundNo) return; // estado de otra ronda
      const rt = S.rt; rt.px = rt.x; rt.py = rt.y; rt.pt = rt.t;
      rt.x = +m.x; rt.y = +m.y; rt.a = +m.a; rt.t = t; rt.hp = clamp(+m.hp, 0, 100); rt.sh = clamp(+m.sh || 0, 0, 50);
      if (WEAPONS[m.w]) S.o.w = m.w; S.o.reloading = !!m.r;
      if (!m.al && S.o.alive && S.phase === "live") { /* el host confirma la muerte con el mensaje de ronda */ }
    } else if (m.t === "shot") {
      const o = S.o; o.flash = t; o.lastShot = t; if (WEAPONS[m.w]) o.w = m.w;
      S.tracers.push({ x1: +m.x1, y1: +m.y1, x2: +m.x2, y2: +m.y2, t, me: false, w: o.w });
      const dist = Math.hypot(o.x - S.p.x, o.y - S.p.y);
      AU.shot(o.w, clamp(1 - dist / 1100, .25, .9));
      if (!canSee(S.p, o)) S.rings.push({ x: o.x, y: o.y, t, r: 46, c: "255,70,85" });
      if (m.hit && S.phase === "live" && S.p.alive) damage(S.p, clamp(+m.d || 0, 0, 150), false, t);
      else if (!m.hit) S.sparks.push({ x: +m.x2, y: +m.y2, t });
    } else if (m.t === "dead") {
      if (isHost() && S.phase === "live") { S.o.hp = 0; M.stats.kills++; AU.kill(); hostEndRound("me", "kill"); }
    } else if (m.t === "round") {
      if (!isHost()) {
        const winner = m.w === "g" ? "me" : m.w === "h" ? "opp" : null;
        if (S.phase === "buy") goLive();
        if (winner === "me" && m.c === "kill" && S.o.alive) { M.stats.kills++; AU.kill(); }
        applyRoundEnd(winner, m.c);
        if (typeof m.gs === "number" && typeof m.hs === "number") { M.score.me = m.gs; M.score.opp = m.hs; M.over = M.score.me >= WIN || M.score.opp >= WIN; renderPips(); hud(true); }
      }
    } else if (m.t === "ab") {
      if (m.k === "smoke") addSmoke(clamp(+m.x, 0, W), clamp(+m.y, 0, H), t);
      else if (m.k === "wall") addBarrier({ x: +m.x, y: +m.y, w: clamp(+m.w, 10, 160), h: clamp(+m.h, 10, 160) }, t);
      else if (m.k === "radar") { alertMsg("¡Te detectaron!", 1500); S.rings.push({ x: S.o.x, y: S.o.y, t, r: 650, c: "242,193,78", slow: true }); }
      AU.ability(m.k === "radar" ? "radar" : m.k);
    }
  }

  /* ---------- bot ---------- */
  function botThink(t, dt) {
    const b = S.o, p = S.p, ai = S.ai, cfg = BOTS[M.diff];
    if (!b.alive) return;
    const sees = p.alive && canSee(b, p);
    let mx = 0, my = 0;
    if (sees) {
      if (!ai.seenAt) { ai.seenAt = t; ai.aimErr = (Math.random() - .5) * 2 * cfg.err; }
      ai.target = { x: p.x, y: p.y };
      const want = Math.atan2(p.y - b.y, p.x - b.x) + ai.aimErr;
      b.a = turn(b.a, want, dt * (6 + cfg.speed * 6));
      if (t - ai.seenAt > cfg.react) {
        const sniper = b.w === "operator" || b.w === "sheriff";
        if (t < ai.strafeUntil && !sniper) { mx = Math.cos(b.a + Math.PI / 2) * ai.dir; my = Math.sin(b.a + Math.PI / 2) * ai.dir; }
        else {
          tryShoot(b, p, t, false);
          if (b.lastShot === t) { ai.burst++; if (Math.random() < .35) ai.aimErr = (Math.random() - .5) * 2 * cfg.err * (1 + Math.min(1.5, b.spray * .15)); }
          if (ai.burst >= 3 + Math.floor(Math.random() * 4)) { ai.burst = 0; ai.strafeUntil = t + 200 + Math.random() * 260; ai.dir = Math.random() < .5 ? -1 : 1; }
        }
      } else { mx = Math.cos(b.a + Math.PI / 2) * .5 * ai.dir; my = Math.sin(b.a + Math.PI / 2) * .5 * ai.dir; }
    } else {
      ai.seenAt = 0; ai.burst = 0;
      if (b.ammo < WEAPONS[b.w].mag * .4) startReload(b, t);
      const heard = p.alive && Math.hypot(p.vx, p.vy) > 150 && Math.hypot(p.x - b.x, p.y - b.y) < 400;
      if (heard) ai.target = { x: p.x, y: p.y };
      if (!ai.wp || Math.hypot(ai.wp[0] - b.x, ai.wp[1] - b.y) < 40) ai.wp = ai.target && Math.random() < .7 ? [ai.target.x, ai.target.y] : WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)];
      if (t - ai.stuckT > 600) { if (Math.hypot(b.x - ai.lx, b.y - ai.ly) < 8) { ai.wp = WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)]; ai.target = null; } ai.lx = b.x; ai.ly = b.y; ai.stuckT = t; }
      const ga = Math.atan2(ai.wp[1] - b.y, ai.wp[0] - b.x);
      for (const off of [0, .5, -.5, 1, -1, 1.6, -1.6, 2.3, -2.3]) {
        const a = ga + off * ai.dir;
        if (free(b.x + Math.cos(a) * 34, b.y + Math.sin(a) * 34)) { mx = Math.cos(a); my = Math.sin(a); b.a = turn(b.a, a, dt * 7); break; }
      }
    }
    move(b, mx, my, RUN * cfg.speed * WEAPONS[b.w].speed, dt, t);
    if (b.reloading && t >= b.reloadUntil) { b.ammo = WEAPONS[b.w].mag; b.reloading = false; }
  }

  /* ---------- movimiento ---------- */
  function move(f, mx, my, speed, dt, t) {
    if (t < f.dashUntil) { f.vx = f.dashVx; f.vy = f.dashVy; }
    else { const m = Math.hypot(mx, my); if (m > 1) { mx /= m; my /= m; } const k = 1 - Math.exp(-dt * 16); f.vx += (mx * speed - f.vx) * k; f.vy += (my * speed - f.vy) * k; }
    f.x += f.vx * dt; f.y += f.vy * dt;
    if (S.phase === "buy") { if (f.side === "L") f.x = Math.min(f.x, BUYZ); else f.x = Math.max(f.x, W - BUYZ); }
    collide(f);
  }
  function playerThink(t, dt) {
    const p = S.p; if (!p.alive) { p.vx *= .8; p.vy *= .8; return; }
    let mx = input.mx, my = input.my, walk = input.walk;
    const k = input.keys;
    if (!input.move) {
      mx = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
      my = (k.has("s") || k.has("arrowdown") ? 1 : 0) - (k.has("w") || k.has("arrowup") ? 1 : 0);
      walk = k.has("shift"); input.mx = mx; input.my = my;
    }
    const wd = WEAPONS[p.w];
    move(p, mx, my, (walk ? WALK : RUN) * wd.speed, dt, t);
    let fire = false;
    if (input.aim) { const dx = input.aim.x - input.aim.ox, dy = input.aim.y - input.aim.oy; if (Math.hypot(dx, dy) > 16) { p.a = assist(p, Math.atan2(dy, dx), .3); fire = true; } }
    else if (input.tapFire) { input.tapFire = false; p.a = assist(p, p.a, .7); if (S.phase === "live") { p.nextShot = Math.min(p.nextShot, t); tryShoot(p, S.o, t, true); } }
    else if (input.mouse) { p.a = Math.atan2(input.mouse.y - p.y, input.mouse.x - p.x); fire = input.firing; }
    if (fire && S.phase === "live") tryShoot(p, S.o, t, true);
    if (p.reloading && t >= p.reloadUntil) { p.ammo = wd.mag; p.reloading = false; }
    // pasos propios (sonido) y ajuste de ruido
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 150 && t - p.stepAt > 300) { p.stepAt = t; AU.step(.5); }
  }
  // asistencia de puntería (solo táctil): si el rival visible está cerca de donde apuntás, la mira se corre hacia él
  function assist(p, a, cone) {
    const o = S.o; if (!o.alive || !canSee(p, o)) return a;
    const d = Math.hypot(o.x - p.x, o.y - p.y); if (d > 760) return a;
    const ta = Math.atan2(o.y - p.y, o.x - p.x), diff = ((ta - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return Math.abs(diff) < cone ? a + diff * .82 : a;
  }
  function remoteThink(t, dt) {
    const o = S.o, rt = S.rt, k = 1 - Math.exp(-dt * 18);
    const px = o.x, py = o.y;
    o.x += (rt.x - o.x) * k; o.y += (rt.y - o.y) * k; o.a = turn(o.a, rt.a, dt * 24);
    o.vx = (o.x - px) / Math.max(dt, .001); o.vy = (o.y - py) / Math.max(dt, .001);
    o.hp = rt.hp; o.sh = rt.sh;
  }

  /* ---------- bucle ---------- */
  function loop(t) {
    if (!M || !S) return;
    const dt = Math.min(.034, (t - last) / 1000); last = t;
    if (S.phase === "buy" && t >= S.phaseEnd) goLive();
    else if (S.phase === "post" && t >= S.phaseEnd) afterPost();
    else if (S.phase === "half" && t >= S.phaseEnd) startRound();
    if (!S) return;
    if (S.phase === "buy" || S.phase === "live" || S.phase === "post") {
      playerThink(t, dt);
      if (online()) remoteThink(t, dt); else if (S.phase === "live") botThink(t, dt);
      if (S.phase === "live" && isHost() && t > S.roundEnd) {
        const a = S.p.hp + S.p.sh, b = (online() ? S.rt.hp + S.rt.sh : S.o.hp + S.o.sh);
        hostEndRound(a > b ? "me" : b > a ? "opp" : null, "time");
      }
    }
    // pasos del rival (se ven a través de la niebla)
    const o = S.o;
    if (o.alive && Math.hypot(o.vx, o.vy) > 150 && t - o.stepAt > 320) {
      o.stepAt = t; const d = Math.hypot(o.x - S.p.x, o.y - S.p.y);
      if (d < 430 && (S.phase === "live")) { if (!canSee(S.p, o)) S.rings.push({ x: o.x, y: o.y, t, r: 34, c: "255,70,85", step: true }); AU.step(clamp(1 - d / 430, .15, 1)); }
    }
    // efectos con tiempo
    S.smokes = S.smokes.filter((s) => t < s.until); S.smokes.forEach((s) => (s.r = s.R * clamp((t - s.born) / 450, 0, 1) * (t > s.until - 600 ? clamp((s.until - t) / 600, 0, 1) * .4 + .6 : 1)));
    const nb = S.barriers.length; S.barriers = S.barriers.filter((b) => t < b.until); if (S.barriers.length !== nb) S.fogSeg = null;
    if (online() && t - (S.sentAt || 0) > (NET.via() === "relay" ? 60 : 33)) { S.sentAt = t; send({ t: "s", ...stateMsg() }); }
    if (online() && !M.result && t - NET.lastRecv() > 10000) opponentLeft();
    if (!online()) { const b = $("#net-badge"), on = M.bg && NET.searching(); if (b.hidden === on) { b.hidden = !on; b.textContent = "Buscando rival…"; } }
    camera(dt, t); draw(t); hud(false);
    raf = requestAnimationFrame(loop);
  }
  function camera(dt, t) {
    const p = S.p, la = Math.min(110, Math.max(cw, ch) / zoom * .08);
    const tx = p.x + Math.cos(p.a) * la, ty = p.y + Math.sin(p.a) * la;
    const k = 1 - Math.exp(-dt * 6); S.cam.x += (tx - S.cam.x) * k; S.cam.y += (ty - S.cam.y) * k;
    const vw = cw / zoom, vh = ch / zoom;
    S.cam.x = vw >= W ? W / 2 : clamp(S.cam.x, vw / 2 - 40, W - vw / 2 + 40);
    S.cam.y = vh >= H ? H / 2 : clamp(S.cam.y, vh / 2 - 40, H - vh / 2 + 40);
    S.cam.shake *= Math.exp(-dt * 9);
  }

  /* ---------- dibujo ---------- */
  function resize() {
    const r = cv.getBoundingClientRect(); cw = Math.max(1, r.width); ch = Math.max(1, r.height);
    dpr = Math.min(2, window.devicePixelRatio || 1); if (cw * ch * dpr * dpr > 2.4e6) dpr = Math.sqrt(2.4e6 / (cw * ch));
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); fog.width = cv.width; fog.height = cv.height;
    zoom = clamp(Math.min(cw / 900, ch / 560), .42, 1.5);
    checkRotate();
  }
  function worldTx(c) {
    const sx = (Math.random() - .5) * S.cam.shake, sy = (Math.random() - .5) * S.cam.shake;
    c.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (cw / 2 - S.cam.x * zoom + sx), dpr * (ch / 2 - S.cam.y * zoom + sy));
  }
  function toWorld(cx, cy) { const r = cv.getBoundingClientRect(); return { x: (cx - r.left - cw / 2) / zoom + S.cam.x, y: (cy - r.top - ch / 2) / zoom + S.cam.y }; }
  function drawGun(c, w, col) { c.fillStyle = col; for (const [x, y, ww, hh] of GUN_SHAPE[w] || GUN_SHAPE.classic) c.fillRect(x, y, ww, hh); }
  function drawFloor() {
    ctx.fillStyle = "#151c25"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,.035)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x <= W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, H); } for (let y = 0; y <= H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); } ctx.stroke();
    // spawns: el tuyo en verde agua, el del rival en rojo
    ctx.fillStyle = "rgba(63,224,197,.07)"; ctx.fillRect(M.side === "L" ? 0 : W - 150, 0, 150, H);
    ctx.fillStyle = "rgba(255,70,85,.06)"; ctx.fillRect(M.side === "L" ? W - 150 : 0, 0, 150, H);
    // zonas A / B y mid (referencias para hablar del mapa)
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const [lx, ly, label] of [[560, 120, "A"], [560, 585, "B"]]) {
      ctx.save(); ctx.strokeStyle = "rgba(242,193,78,.2)"; ctx.setLineDash([8, 7]); ctx.lineWidth = 2; ctx.strokeRect(lx - 80, ly - 62, 160, 124); ctx.restore();
      ctx.fillStyle = "rgba(242,193,78,.07)"; ctx.font = "900 90px 'Big Shoulders Display', Impact, sans-serif"; ctx.fillText(label, lx, ly + 4);
    }
    ctx.strokeStyle = "rgba(236,232,225,.06)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(560, 350, 105, 0, Math.PI * 2); ctx.stroke();
  }
  function drawWalls(t) {
    ctx.fillStyle = "rgba(0,0,0,.35)"; for (const [x, y, w, h] of WALLS) ctx.fillRect(x + 6, y + 8, w, h);
    for (const [x, y, w, h] of WALLS) {
      ctx.fillStyle = "#2b3745"; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#3e4d5e"; ctx.fillRect(x, y, w, Math.min(5, h));
      ctx.strokeStyle = "rgba(255,70,85,.28)"; ctx.lineWidth = 1.2; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    }
    for (const b of S.barriers) {
      const life = clamp((b.until - t) / 10000, 0, 1), grow = clamp((t - b.born) / 220, 0, 1);
      ctx.save(); ctx.globalAlpha = .55 + .45 * grow;
      ctx.fillStyle = "rgba(63,224,197,.22)"; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = "rgba(63,224,197," + (.5 + .5 * Math.sin(t / 120)) + ")"; ctx.lineWidth = 2; ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = "rgba(63,224,197,.8)"; if (b.w > b.h) ctx.fillRect(b.x, b.y + b.h - 3, b.w * life, 3); else ctx.fillRect(b.x + b.w - 3, b.y, 3, b.h * life);
      ctx.restore();
    }
  }
  function drawFighter(f, col, t, label) {
    if (!f.alive) return;
    ctx.save(); ctx.translate(f.x, f.y);
    ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.beginPath(); ctx.arc(3, 5, R, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(f.a);
    ctx.save(); ctx.translate(R - 6, 0); drawGun(ctx, f.w, "#d7dde4"); ctx.restore();
    if (t - f.flash < 55) { ctx.fillStyle = "#ffe08a"; const L = GUN_SHAPE[f.w] ? GUN_SHAPE[f.w][1] : [13, 0, 5, 0]; const mx = R - 6 + L[0] + L[2]; ctx.beginPath(); ctx.moveTo(mx, -6); ctx.lineTo(mx + 16, 0); ctx.lineTo(mx, 6); ctx.fill(); }
    const hurt = t - f.hitAt < 110;
    ctx.fillStyle = hurt ? "#ffffff" : "#0e131a"; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = hurt ? "#ffffff" : col; ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(R - 7, 0); ctx.lineTo(-3, -7); ctx.lineTo(-3, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
    // vida + escudo
    const bw = 44, x0 = f.x - bw / 2, y0 = f.y - R - 14;
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(x0 - 1, y0 - 1, bw + 2, 6);
    ctx.fillStyle = col; ctx.fillRect(x0, y0, bw * f.hp / 100, 4);
    if (f.sh > 0) { ctx.fillStyle = "#9fd4ff"; ctx.fillRect(x0, y0 - 4, bw * f.sh / 50, 2.5); }
    if (label) { ctx.fillStyle = "rgba(236,232,225,.85)"; ctx.font = "700 12px 'JetBrains Mono', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(label, f.x, y0 - 6); }
    if (f.reloading) { ctx.strokeStyle = "rgba(236,232,225,.7)"; ctx.lineWidth = 2; ctx.beginPath(); const pr = 1 - clamp((f.reloadUntil - t) / WEAPONS[f.w].reload, 0, 1); ctx.arc(f.x, f.y, R + 6, -Math.PI / 2, -Math.PI / 2 + pr * Math.PI * 2); ctx.stroke(); }
  }
  // polígono de visibilidad (niebla de guerra)
  function staticSegs() {
    if (S.fogSeg) return S.fogSeg;
    const segs = [];
    const rect = (x, y, w, h) => { segs.push([x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]); };
    rect(0, 0, W, H); for (const r of solids()) rect(r[0], r[1], r[2], r[3]);
    S.fogSeg = segs; return segs;
  }
  function visPoly(px, py) {
    const segs = staticSegs().slice();
    for (const s of S.smokes) { if (s.r < 8) continue; const n = 12; for (let i = 0; i < n; i++) { const a1 = i / n * Math.PI * 2, a2 = (i + 1) / n * Math.PI * 2, rr = s.r * .9; segs.push([s.x + Math.cos(a1) * rr, s.y + Math.sin(a1) * rr, s.x + Math.cos(a2) * rr, s.y + Math.sin(a2) * rr]); } }
    const angles = [];
    for (const sg of segs) { for (const [x, y] of [[sg[0], sg[1]], [sg[2], sg[3]]]) { const a = Math.atan2(y - py, x - px); angles.push(a - .0004, a, a + .0004); } }
    const pts = [];
    for (const a of angles) {
      const dx = Math.cos(a), dy = Math.sin(a); let best = 4000;
      for (const sg of segs) {
        const sx = sg[2] - sg[0], sy = sg[3] - sg[1], den = dx * sy - dy * sx; if (Math.abs(den) < 1e-9) continue;
        const ux = sg[0] - px, uy = sg[1] - py, tt = (ux * sy - uy * sx) / den, u = (ux * dy - uy * dx) / den;
        if (tt > 0 && u >= 0 && u <= 1 && tt < best) best = tt;
      }
      pts.push([a, px + dx * best, py + dy * best]);
    }
    pts.sort((p, q) => p[0] - q[0]);
    return pts;
  }
  function drawFog() {
    const p = S.p;
    fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, fog.width, fog.height);
    fctx.fillStyle = p.alive ? "rgba(5,7,10,.74)" : "rgba(5,7,10,.5)"; fctx.fillRect(0, 0, fog.width, fog.height);
    if (!p.alive) return ctx.drawImage(fog, 0, 0);
    const sx = (Math.random() - .5) * S.cam.shake * 0, sy = 0;
    fctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (cw / 2 - S.cam.x * zoom + sx), dpr * (ch / 2 - S.cam.y * zoom + sy));
    fctx.globalCompositeOperation = "destination-out";
    const poly = visPoly(p.x, p.y);
    fctx.beginPath(); poly.forEach((q, i) => (i ? fctx.lineTo(q[1], q[2]) : fctx.moveTo(q[1], q[2]))); fctx.closePath(); fctx.fill();
    fctx.beginPath(); fctx.arc(p.x, p.y, 34, 0, Math.PI * 2); fctx.fill();
    fctx.globalCompositeOperation = "source-over";
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(fog, 0, 0);
  }
  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#0a0e13"; ctx.fillRect(0, 0, cv.width, cv.height);
    worldTx(ctx); drawFloor(); drawWalls(t);
    // casquillos y partículas de muerte (debajo)
    S.parts = S.parts.filter((q) => t - q.t < q.life);
    for (const q of S.parts) { const k = (t - q.t) / 1000; const x = q.x + q.vx * k * (1 - k * .6), y = q.y + q.vy * k * (1 - k * .6); ctx.save(); ctx.translate(x, y); ctx.rotate(q.r + q.vr * k); ctx.globalAlpha = 1 - (t - q.t) / q.life; ctx.fillStyle = "rgb(" + q.c + ")"; ctx.beginPath(); ctx.moveTo(0, -q.s); ctx.lineTo(q.s, q.s * .7); ctx.lineTo(-q.s, q.s * .5); ctx.closePath(); ctx.fill(); ctx.restore(); }
    // trazadoras
    S.tracers = S.tracers.filter((tr) => t - tr.t < 130);
    for (const tr of S.tracers) { const a = 1 - (t - tr.t) / 130; ctx.strokeStyle = tr.me ? "rgba(63,224,197," + a + ")" : "rgba(255,120,130," + a + ")"; ctx.lineWidth = tr.w === "operator" ? 3.5 : 1.8; ctx.beginPath(); ctx.moveTo(tr.x1, tr.y1); ctx.lineTo(tr.x2, tr.y2); ctx.stroke(); }
    S.sparks = S.sparks.filter((s) => t - s.t < 220);
    for (const s of S.sparks) { const k = (t - s.t) / 220; ctx.fillStyle = "rgba(255,211,107," + (1 - k) + ")"; ctx.beginPath(); ctx.arc(s.x, s.y, 2 + k * 6, 0, Math.PI * 2); ctx.fill(); }
    // rival: solo si lo ves
    const o = S.o, seen = o.alive && S.p.alive ? canSee(S.p, o) : o.alive;
    if (seen) { S.lastSeen = { x: o.x, y: o.y, t }; drawFighter(o, "#ff4655", t, M.oppNick); }
    drawFighter(S.p, "#3fe0c5", t, "");
    drawFog();
    worldTx(ctx);
    // humos (visibles para todos)
    for (const s of S.smokes) {
      const g = ctx.createRadialGradient(s.x, s.y, s.r * .2, s.x, s.y, s.r * 1.08);
      g.addColorStop(0, "rgba(167,139,250,.92)"); g.addColorStop(.75, "rgba(120,100,190,.88)"); g.addColorStop(1, "rgba(120,100,190,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 1.08, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.06)"; for (let i = 0; i < 4; i++) { const a = t / 1400 + i * 1.6; ctx.beginPath(); ctx.arc(s.x + Math.cos(a) * s.r * .4, s.y + Math.sin(a) * s.r * .35, s.r * .38, 0, Math.PI * 2); ctx.fill(); }
    }
    // información del rival fuera de la vista
    if (o.alive && !seen) {
      if (t < S.reveal) { ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(Math.PI / 4); ctx.strokeStyle = "rgba(242,193,78,.95)"; ctx.lineWidth = 3; ctx.strokeRect(-14, -14, 28, 28); ctx.restore(); ctx.fillStyle = "rgba(242,193,78,.95)"; ctx.font = "700 12px 'JetBrains Mono', monospace"; ctx.textAlign = "center"; ctx.fillText("DETECTADO", o.x, o.y - 26); }
      else if (S.lastSeen && t - S.lastSeen.t < 1600) { ctx.globalAlpha = .45 * (1 - (t - S.lastSeen.t) / 1600); ctx.strokeStyle = "#ff4655"; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(S.lastSeen.x, S.lastSeen.y, R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
    }
    S.rings = S.rings.filter((r) => t - r.t < (r.slow ? 900 : 520));
    for (const r of S.rings) { const life = r.slow ? 900 : 520, k = (t - r.t) / life; ctx.strokeStyle = "rgba(" + r.c + "," + (1 - k) * (r.step ? .75 : .9) + ")"; ctx.lineWidth = r.step ? 2 : 3; ctx.beginPath(); ctx.arc(r.x, r.y, 6 + r.r * k, 0, Math.PI * 2); ctx.stroke(); }
    S.pops = S.pops.filter((q) => t - q.t < 750);
    ctx.font = "900 22px 'Big Shoulders Display', Impact, sans-serif"; ctx.textAlign = "center";
    for (const q of S.pops) { ctx.fillStyle = q.good ? "rgba(242,193,78," + (1 - (t - q.t) / 750) + ")" : "rgba(255,70,85," + (1 - (t - q.t) / 750) + ")"; ctx.fillText(q.txt, q.x, q.y - (t - q.t) / 22); }
    // pantalla: sticks, mira, viñeta
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (S.p.alive && S.p.hp <= 30) { const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * .35, cw / 2, ch / 2, Math.max(cw, ch) * .7); g.addColorStop(0, "rgba(255,70,85,0)"); g.addColorStop(1, "rgba(255,70,85," + (.18 + .08 * Math.sin(t / 180)) + ")"); ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch); }
    if (input) {
      for (const [s, col] of [["move", "rgba(236,232,225,.55)"], ["aim", "rgba(255,70,85,.85)"]]) {
        const k = input[s]; if (!k) continue; const r = cv.getBoundingClientRect();
        const ox = k.ox - r.left, oy = k.oy - r.top; let dx = k.x - k.ox, dy = k.y - k.oy; const d = Math.hypot(dx, dy), max = 52; if (d > max) { dx = dx / d * max; dy = dy / d * max; }
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ox, oy, max, 0, Math.PI * 2); ctx.stroke();
        if (s === "move") { ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.arc(ox, oy, max * .55, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ox + dx, oy + dy, 20, 0, Math.PI * 2); ctx.fill();
      }
      if (input.mouseScreen && S.p.alive) {
        const { x, y } = input.mouseScreen, wd = WEAPONS[S.p.w], sp = Math.hypot(S.p.vx, S.p.vy), mv = clamp((sp - 40) / (RUN - 40), 0, 1);
        const gap = 4 + (wd.spread + wd.move * mv + Math.min(.12, S.p.spray * wd.spray)) * 260, hm = t - S.hitmark < 140;
        ctx.strokeStyle = hm ? "#ffffff" : "#3fe0c5"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - gap - 7, y); ctx.lineTo(x - gap, y); ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + 7, y); ctx.moveTo(x, y - gap - 7); ctx.lineTo(x, y - gap); ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + 7); ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(x - 1, y - 1, 2, 2);
        if (hm) { ctx.beginPath(); ctx.moveTo(x - 10, y - 10); ctx.lineTo(x - 5, y - 5); ctx.moveTo(x + 10, y - 10); ctx.lineTo(x + 5, y - 5); ctx.moveTo(x - 10, y + 10); ctx.lineTo(x - 5, y + 5); ctx.moveTo(x + 10, y + 10); ctx.lineTo(x + 5, y + 5); ctx.stroke(); }
      } else if (t - S.hitmark < 140) {
        const x = cw / 2, y = ch / 2; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 12, y - 12); ctx.lineTo(x - 6, y - 6); ctx.moveTo(x + 12, y - 12); ctx.lineTo(x + 6, y - 6); ctx.moveTo(x - 12, y + 12); ctx.lineTo(x - 6, y + 6); ctx.moveTo(x + 12, y + 12); ctx.lineTo(x + 6, y + 6); ctx.stroke();
      }
    }
    if (!S.p.alive && S.phase === "live") { ctx.fillStyle = "rgba(236,232,225,.85)"; ctx.font = "900 28px 'Big Shoulders Display', Impact, sans-serif"; ctx.textAlign = "center"; ctx.fillText("ELIMINADO", cw / 2, ch * .62); }
    if (S.phase === "buy" && isTouch() && input && !input.move && !input.aim && $("#buy").hidden) {
      ctx.save(); ctx.globalAlpha = .55 + .2 * Math.sin(t / 300); ctx.strokeStyle = "rgba(236,232,225,.5)"; ctx.lineWidth = 2; ctx.setLineDash([5, 6]);
      ctx.beginPath(); ctx.arc(cw * .2, ch * .62, 46, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(cw * .8, ch * .62, 46, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "rgba(236,232,225,.8)"; ctx.font = "700 12px 'JetBrains Mono', monospace"; ctx.textAlign = "center"; ctx.fillText("MOVERTE", cw * .2, ch * .62 + 66); ctx.fillText("APUNTAR · TOCAR = TIRO", cw * .8, ch * .62 + 66); ctx.restore();
    }
    if (S.phase === "buy") { const s = Math.ceil((S.phaseEnd - t) / 1000); if ($("#buy").hidden) { ctx.fillStyle = "rgba(242,193,78,.95)"; ctx.font = "900 26px 'Big Shoulders Display', Impact, sans-serif"; ctx.textAlign = "center"; ctx.fillText("COMPRA · " + s + " S", cw / 2, ch * .78); } }
  }

  /* ---------- HUD ---------- */
  let hudKey = "";
  function hud(force) {
    if (!S) return;
    const t = now(), p = S.p, wd = WEAPONS[p.w];
    let secs = 0, phase = "";
    if (S.phase === "buy") { secs = Math.max(0, Math.ceil((S.phaseEnd - t) / 1000)); phase = "Compra"; }
    else if (S.phase === "live") { secs = Math.max(0, Math.ceil((S.roundEnd - t) / 1000)); phase = "Ronda " + M.roundNo; }
    else if (S.phase === "post" || S.phase === "half") { secs = 0; phase = S.phase === "half" ? "Medio tiempo" : "Fin de ronda"; }
    const key = [p.hp, p.sh, p.ammo, p.reloading, p.w, p.charges, M.econ.credits, secs, phase, M.score.me, M.score.opp, S.phase].join("|");
    if (!force && key === hudKey) return; hudKey = key;
    $("#hud-hp").textContent = p.hp; $("#hud-hp").parentElement.classList.toggle("low", p.hp <= 30 && p.alive);
    $("#hud-sh").textContent = p.sh; $("#hud-sh").parentElement.style.opacity = p.sh ? 1 : .45;
    $("#hud-cr").textContent = fmt(M.econ.credits);
    $("#hud-wname").textContent = wd.name; $("#hud-ammo").textContent = p.reloading ? "—" : p.ammo; $("#hud-ammo").parentElement.classList.toggle("low", !p.reloading && p.ammo <= Math.ceil(wd.mag * .2));
    $("#ab-ch").textContent = p.charges + (p.charges === 1 ? " carga" : " cargas"); $("#act-ab").classList.toggle("empty", p.charges <= 0);
    $("#act-buy").hidden = S.phase !== "buy";
    $("#sb-me").textContent = M.score.me; $("#sb-opp").textContent = M.score.opp;
    $("#sb-time").textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0"); $("#sb-phase").textContent = phase;
    const mid = $(".sb-mid"); mid.classList.toggle("low", S.phase === "live" && secs <= 10);
    if (S.phase === "buy") { $("#buy-time").textContent = secs; if (!$("#buy").hidden) $("#buy-cr").textContent = fmt(M.econ.credits); }
  }
  function renderPips() { const box = $("#pips"); box.innerHTML = ""; (M ? M.history : []).forEach((h) => { const i = document.createElement("i"); if (h !== "t") i.className = h; box.appendChild(i); }); }
  let bannerT = 0;
  function banner(title, kicker, sub, cls, ms) {
    const b = $("#banner"); clearTimeout(bannerT);
    $("#bn-title").textContent = title; $("#bn-kicker").textContent = kicker || ""; $("#bn-sub").textContent = sub || "";
    b.className = "banner " + (cls || ""); b.hidden = true; void b.offsetWidth; b.hidden = false;
    bannerT = setTimeout(() => (b.hidden = true), ms || 2400);
  }
  let alertT = 0;
  function alertMsg(txt, ms) { const a = $("#alert"); a.textContent = txt; a.hidden = true; void a.offsetWidth; a.hidden = false; clearTimeout(alertT); alertT = setTimeout(() => (a.hidden = true), ms || 1200); }
  function killfeed(killer, victim, w, mine) {
    const box = $("#killfeed"), d = document.createElement("div"); if (mine) d.className = "mine";
    const k = document.createElement("span"); k.textContent = killer; const wsp = document.createElement("span"); wsp.className = "kw"; wsp.textContent = WEAPONS[w] ? WEAPONS[w].name : ""; const v = document.createElement("span"); v.textContent = victim;
    d.append(k, wsp, v); box.prepend(d); while (box.children.length > 4) box.lastChild.remove(); setTimeout(() => d.remove(), 6000);
  }
  function checkRotate() { const r = $("#rotate"); if ($("#game").hidden) return; r.hidden = !(isTouch() && innerHeight > innerWidth && !store.get("gc_rot_ok", false)); }
  $("#rotate-ok").addEventListener("click", () => { store.set("gc_rot_ok", true); $("#rotate").hidden = true; });

  /* ---------- controles ---------- */
  function setupInput() {
    teardownInput();
    input = { keys: new Set(), mouse: null, mouseScreen: null, firing: false, move: null, aim: null, mx: 0, my: 0, walk: false };
    const BUYKEYS = { "1": "classic", "2": "sheriff", "3": "spectre", "4": "vandal", "5": "operator", "6": "light", "7": "heavy" };
    input.kd = (e) => {
      if (e.target.closest && e.target.closest("input")) return;
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "shift", "r", "e", "q", "b"].includes(k)) e.preventDefault();
      if (input.keys.has(k)) return; input.keys.add(k);
      if (k === "e" || k === "q") useAbility();
      else if (k === "r" && S && S.p.alive) startReload(S.p, now());
      else if (k === "b") $("#act-buy").click();
      else if (BUYKEYS[k] && S && S.phase === "buy") buy(BUYKEYS[k]);
      else if (k === "escape" && !$("#buy").hidden) closeBuy();
    };
    input.ku = (e) => input.keys.delete(e.key.toLowerCase());
    input.pd = (e) => {
      if (e.target !== cv) return;
      AU.unlock();
      if (e.pointerType === "mouse") { if (S) input.mouse = toWorld(e.clientX, e.clientY); input.firing = e.button === 0; if (e.button === 2) useAbility(); return; }
      e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      const side = e.clientX < innerWidth / 2 ? "move" : "aim";
      if (input[side]) return;
      input[side] = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, t0: now() };
      if (!$("#buy").hidden) closeBuy();
    };
    input.pm = (e) => {
      if (e.pointerType === "mouse") { const r = cv.getBoundingClientRect(); input.mouseScreen = { x: e.clientX - r.left, y: e.clientY - r.top }; if (S) input.mouse = toWorld(e.clientX, e.clientY); return; }
      for (const s of ["move", "aim"]) if (input[s] && input[s].id === e.pointerId) { input[s].x = e.clientX; input[s].y = e.clientY; }
      if (input.move) { const dx = input.move.x - input.move.ox, dy = input.move.y - input.move.oy, d = Math.hypot(dx, dy), max = 52; if (d > 8) { input.mx = dx / Math.max(d, 1); input.my = dy / Math.max(d, 1); input.walk = d < max * .55; } else { input.mx = 0; input.my = 0; } }
    };
    input.pu = (e) => {
      if (e.pointerType === "mouse") { input.firing = false; return; }
      for (const s of ["move", "aim"]) if (input[s] && input[s].id === e.pointerId) {
        const k = input[s];
        if (s === "aim" && now() - k.t0 < 240 && Math.hypot(k.x - k.ox, k.y - k.oy) < 16) input.tapFire = true; // toque rápido = un tiro
        input[s] = null; if (s === "move") { input.mx = 0; input.my = 0; }
      }
    };
    document.addEventListener("keydown", input.kd); document.addEventListener("keyup", input.ku);
    cv.addEventListener("pointerdown", input.pd); window.addEventListener("pointermove", input.pm);
    window.addEventListener("pointerup", input.pu); window.addEventListener("pointercancel", input.pu);
    cv.oncontextmenu = (e) => e.preventDefault();
    window.addEventListener("resize", resize); window.addEventListener("orientationchange", resize);
  }
  function teardownInput() {
    if (!input) return;
    document.removeEventListener("keydown", input.kd); document.removeEventListener("keyup", input.ku);
    cv.removeEventListener("pointerdown", input.pd); window.removeEventListener("pointermove", input.pm);
    window.removeEventListener("pointerup", input.pu); window.removeEventListener("pointercancel", input.pu);
    window.removeEventListener("resize", resize); window.removeEventListener("orientationchange", resize);
    input = null;
  }
  // el mouse sigue apuntando aunque la cámara se mueva
  setInterval(() => { if (input && input.mouseScreen && S) { const r = cv.getBoundingClientRect(); input.mouse = toWorld(input.mouseScreen.x + r.left, input.mouseScreen.y + r.top); } }, 30);
  $("#act-ab").addEventListener("pointerdown", (e) => { e.preventDefault(); useAbility(); });
  $("#act-reload").addEventListener("pointerdown", (e) => { e.preventDefault(); if (S && S.p.alive) startReload(S.p, now()); });
  $("#g-exit").addEventListener("click", () => {
    if (!M) return close();
    if (M.result) return close();
    $("#confirm-txt").textContent = online() ? "Si salís ahora contás como derrota y tu rival gana por abandono." : "La práctica no se guarda si salís antes de terminar.";
    $("#confirm").hidden = false;
  });
  $("#confirm-no").addEventListener("click", () => ($("#confirm").hidden = true));
  $("#confirm-yes").addEventListener("click", () => { $("#confirm").hidden = true; leave(); show("home"); });
  $("#end-home").addEventListener("click", () => { close(); show("home"); });
  $("#end-rematch-btn").addEventListener("click", () => {
    $("#end-rematch-btn").hidden = true; const er = $("#end-rematch"); er.hidden = false;
    er.textContent = "Esperando que " + (NET.lastOpp() || "tu rival") + " acepte la revancha…";
    NET.rematch((err) => { er.textContent = "No hubo revancha: " + err; });
  });
  $("#end-again").addEventListener("click", () => {
    const mode = M ? M.mode : "online", diff = M ? M.diff : botDiff;
    close();
    if (mode === "bot") { goFullscreen(); start({ mode: "bot", diff, agent: agentId, oppNick: "BOT " + diff.toUpperCase(), oppAgent: "rafaga", bg: NET.searching() }); }
    else { openSelect("online"); goFullscreen(); NET.search(); }
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && input) { input.keys.clear(); input.firing = false; } });

  setTimeout(flushPending, 2500);
  if (window.GC_DEBUG) window.__gc = { state: () => ({ M, S }) };
  return { start, onNet, opponentLeft, drawGun, active: () => !!M && !$("#game").hidden };
})();

/* =========================================================
   ARRANQUE
   ========================================================= */
renderMe();
if (!PLAYER) openGate(); else syncPlayer();
show("home");
presence();
})();
