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
   RANGOS
   ========================================================= */
// Rangos del evento: emblemas propios (no son los de Riot), un dibujo por rango que se va complejizando
const RANKS = [
  { name: "Hierro", min: 0, c: ["#b9bec4", "#5d646c", "#2c3136"] },
  { name: "Bronce", min: 200, c: ["#f0b27a", "#a5672f", "#4d2c12"] },
  { name: "Plata", min: 450, c: ["#f4f7fa", "#a9b4bf", "#4a5560"] },
  { name: "Oro", min: 750, c: ["#ffe58a", "#e0a82e", "#6b4708"] },
  { name: "Platino", min: 1100, c: ["#a8f3ff", "#2fb3c6", "#0d4a55"] },
  { name: "Diamante", min: 1500, c: ["#f6d2ff", "#b46ee8", "#4a1d6e"] },
  { name: "Ascendente", min: 2000, c: ["#b7ffd3", "#2fc77a", "#0b4a2a"] },
  { name: "Inmortal", min: 2600, c: ["#ffb3bf", "#e2445c", "#5c0f1d"] },
  { name: "Radiante", min: Infinity, c: ["#fffbe0", "#ffd75e", "#a8741a"] },
];
const RANK_CAP = 3500; // para repartir los 3 niveles de Inmortal
// Radiante = el puesto #1 del ranking del evento (como en Valorant: solo los mejores)
function rankOf(total, pos) {
  total = Math.max(0, +total || 0);
  if (pos === 1 && total > 0) return { i: 8, name: "Radiante", sub: 0, label: "Radiante", prog: 1, next: null, c: RANKS[8].c };
  let i = 0; while (i < 7 && total >= RANKS[i + 1].min) i++;
  const lo = RANKS[i].min, hi = i < 7 ? RANKS[i + 1].min : RANK_CAP;
  const f = Math.min(.9999, (total - lo) / (hi - lo)), sub = Math.min(3, 1 + Math.floor(f * 3));
  const subLo = lo + (hi - lo) * (sub - 1) / 3, subHi = lo + (hi - lo) * sub / 3;
  return { i, name: RANKS[i].name, sub, label: RANKS[i].name + " " + sub, prog: Math.min(1, (total - subLo) / (subHi - subLo)), next: i === 7 && sub === 3 ? null : Math.ceil(subHi), c: RANKS[i].c };
}
function rankSVG(i, sub, cls) {
  const [hi, mid, lo] = RANKS[i].c, g = "rg" + i + "-" + (rankSVG.n = (rankSVG.n || 0) + 1); // id único: si se repite y el primero está oculto, el degradado no se ve
  const defs = '<defs><linearGradient id="' + g + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + hi + '"/><stop offset=".55" stop-color="' + mid + '"/><stop offset="1" stop-color="' + lo + '"/></linearGradient></defs>';
  const F = 'fill="url(#' + g + ')" stroke="' + lo + '" stroke-width="1.2" stroke-linejoin="round"';
  const A = 'fill="' + mid + '" stroke="' + lo + '" stroke-width="1" stroke-linejoin="round"';
  const hl = 'fill="#fff" opacity=".28"';
  let body = "";
  switch (i) {
    case 0: body = '<path ' + F + ' d="M32 14l14 18-14 18-14-18z"/><path ' + hl + ' d="M32 14l14 18H32z"/>'; break;
    case 1: body = '<path ' + F + ' d="M32 10l15 8v17L32 50 17 35V18z"/><path ' + hl + ' d="M32 10l15 8-15 9z"/><path fill="none" stroke="' + lo + '" stroke-width="1.4" d="M24 26l8 6 8-6"/>'; break;
    case 2: body = '<path ' + A + ' d="M17 22L7 28l10 10zM47 22l10 6-10 10z"/><path ' + F + ' d="M32 9l15 8v18L32 50 17 35V17z"/><path ' + hl + ' d="M32 9l15 8-15 9z"/><path fill="none" stroke="' + lo + '" stroke-width="1.4" d="M23 25l9 6 9-6M23 32l9 6 9-6"/>'; break;
    case 3: body = '<path ' + A + ' d="M17 20L5 26l12 13zM47 20l12 6-12 13zM24 13l-2-7 6 4zM40 13l2-7-6 4zM32 9l-3-6h6z"/><path ' + F + ' d="M32 9l15 8v18L32 51 17 35V17z"/><path ' + hl + ' d="M32 9l15 8-15 9z"/><circle cx="32" cy="30" r="5" fill="' + hi + '" stroke="' + lo + '" stroke-width="1.2"/>'; break;
    case 4: body = '<path ' + A + ' d="M16 22L4 30l12 10zM48 22l12 8-12 10z"/><path ' + F + ' d="M32 7l17 10v20L32 53 15 37V17z"/><path ' + hl + ' d="M32 7l17 10-17 10z"/><path fill="none" stroke="' + lo + '" stroke-width="1.2" d="M32 27v26M15 17l17 10 17-10"/><path fill="' + hi + '" d="M32 19l6 8-6 8-6-8z"/>'; break;
    case 5: body = '<path ' + A + ' d="M20 18L6 16l8 14zM44 18l14-2-8 14zM18 38L7 46l14-2zM46 38l11 8-14-2z"/><path ' + F + ' d="M32 4l16 24-16 28-16-28z"/><path ' + hl + ' d="M32 4l16 24H32z"/><path fill="none" stroke="' + lo + '" stroke-width="1.2" d="M16 28h32M24 28l8 28 8-28M32 4l-8 24M32 4l8 24"/>'; break;
    case 6: body = '<path ' + A + ' d="M22 30C14 22 8 12 6 4c8 4 15 9 20 16zM42 30c8-8 14-18 16-26-8 4-15 9-20 16zM20 40C12 38 6 32 3 24c7 3 13 6 19 10zM44 40c8-2 14-8 17-16-7 3-13 6-19 10z"/><path ' + F + ' d="M32 8l14 18-14 28-14-28z"/><path ' + hl + ' d="M32 8l14 18H32z"/><path fill="' + hi + '" d="M32 18l5 9-5 12-5-12z"/>'; break;
    case 7: body = '<path ' + A + ' d="M23 22L12 2l16 14zM41 22L52 2 36 16zM20 32C10 30 3 22 1 12c9 5 16 8 22 13zM44 32c10-2 17-10 19-20-9 5-16 8-22 13zM20 42C11 44 5 40 2 33c7 1 13 1 19 3zM44 42c9 2 15-2 18-9-7 1-13 1-19 3z"/><path ' + F + ' d="M32 6l15 16-4 20-11 12-11-12-4-20z"/><path ' + hl + ' d="M32 6l15 16H32z"/><path fill="' + hi + '" stroke="' + lo + '" stroke-width="1" d="M32 20l7 10-7 14-7-14z"/>'; break;
    case 8: {
      let rays = ""; for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, l = k % 2 ? 22 : 30, x = 32 + Math.cos(a) * l, y = 32 + Math.sin(a) * l, bx = 32 + Math.cos(a + .2) * 10, by = 32 + Math.sin(a + .2) * 10, cx2 = 32 + Math.cos(a - .2) * 10, cy2 = 32 + Math.sin(a - .2) * 10; rays += "M" + bx.toFixed(1) + " " + by.toFixed(1) + "L" + x.toFixed(1) + " " + y.toFixed(1) + "L" + cx2.toFixed(1) + " " + cy2.toFixed(1) + "z"; }
      body = '<circle class="rk-glow" cx="32" cy="32" r="26" fill="' + mid + '" opacity=".22"/><path ' + A + ' d="' + rays + '"/><path ' + F + ' d="M32 12l12 20-12 20-12-20z"/><path ' + hl + ' d="M32 12l12 20H32z"/><circle cx="32" cy="32" r="4.5" fill="#fff"/>';
    }
  }
  let pips = "";
  if (i < 8) for (let k = 0; k < 3; k++) { const x = 32 + (k - 1) * 9; pips += '<path d="M' + x + ' 57l3 3-3 3-3-3z" fill="' + (k < sub ? hi : "rgba(255,255,255,.14)") + '"/>'; }
  return '<svg class="' + (cls || "rk") + '" viewBox="0 0 64 64" aria-hidden="true">' + defs + body + pips + "</svg>";
}
function rankHTML(total, pos, opts) { // emblema + nombre + barra hasta el próximo nivel
  const k = rankOf(total, pos), o = opts || {};
  return '<div class="rank r' + k.i + '" style="--rc:' + k.c[1] + ';--rh:' + k.c[0] + '">' + rankSVG(k.i, k.sub) +
    '<div class="rk-txt"><span class="label">Rango</span><b>' + k.label + '</b>' +
    (o.bar === false ? "" : '<span class="rk-bar"><i style="transform:scaleX(' + k.prog.toFixed(3) + ')"></i></span><small>' + (k.i === 8 ? "Puesto #1 del evento" : k.next ? fmt(k.next - Math.max(0, Math.round(+total || 0))) + " pts para el próximo nivel" : "Nivel máximo · alcanzá el #1 para Radiante") + "</small>") + "</div></div>";
}

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
  const rk = $("#me-rankbox"), rkey = n ? (meStats ? meStats.total : 0) + "|" + (meStats ? meStats.rank : "") : "";
  if (rk.dataset.k !== rkey) { rk.dataset.k = rkey; rk.innerHTML = n ? rankHTML(meStats ? meStats.total : 0, meStats && meStats.rank) : ""; }
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
    const k = rankOf(r.total, i + 1), em = document.createElement("span"); em.className = "rk-mini"; em.title = k.label; em.innerHTML = rankSVG(k.i, k.sub); li.children[1].prepend(em);
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
    try { const j = await api("/api/player?pid=" + encodeURIComponent(PID)); meStats = j; XH.fromServer(j.xh); renderMe(); } catch (e) {}
  }
}

async function openProfile() {
  if (!requirePlayer()) return;
  show("profile");
  $("#pf-nick").textContent = PLAYER.nick; $("#pf-ig").textContent = PLAYER.ig ? "@" + PLAYER.ig : "";
  const paint = (s, hist, src) => {
    const rows = [["Puntos", fmt(s.total)], ["Puesto", s.rank ? "#" + s.rank : "—"], ["Victorias", fmt(s.wins) + " / " + fmt(s.matches)], ["Rondas", fmt(s.roundsWon)]];
    $("#pf-rank").innerHTML = rankHTML(s.total, s.rank);
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
// emblemas propios de cada agente; cada parte tiene clase para animarse al elegirlo o al usar la habilidad
const AGENT_SVG = {
  dash: '<svg viewBox="0 0 56 56" aria-hidden="true"><g class="st" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".55"><path d="M5 21h13M3 29h11M7 37h10"/></g><path class="mn" fill="currentColor" d="M21 46l8-15h-8l13-21h13l-9 13h9L24 47z"/></svg>',
  smoke: '<svg viewBox="0 0 56 56" aria-hidden="true" fill="currentColor"><circle class="pf" cx="19" cy="33" r="11" opacity=".5"/><circle class="pf" cx="32" cy="24" r="14" opacity=".8"/><circle class="pf" cx="37" cy="37" r="10"/></svg>',
  wall: '<svg viewBox="0 0 56 56" aria-hidden="true" fill="currentColor"><rect class="br" x="9" y="14" width="9" height="32"/><rect class="br" x="23.5" y="8" width="9" height="38"/><rect class="br" x="38" y="14" width="9" height="32"/><rect x="5" y="47" width="46" height="3" opacity=".45"/></svg>',
  radar: '<svg viewBox="0 0 56 56" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3"><circle class="rn" cx="28" cy="28" r="23" opacity=".45"/><circle class="rn" cx="28" cy="28" r="14" opacity=".75"/><path class="sw" d="M28 28L44 12" stroke-linecap="round"/><circle cx="28" cy="28" r="5" fill="currentColor" stroke="none"/></svg>',
};
const WEAPONS = {
  classic: { name: "Classic", cls: "Pistola", cost: 0, dmg: 26, fire: 165, mag: 12, reload: 1750, spread: .018, move: .05, spray: .006, speed: 1, note: "Gratis" },
  ghost: { name: "Ghost", cls: "Pistola", cost: 500, dmg: 30, fire: 150, mag: 15, reload: 1500, spread: .012, move: .06, spray: .007, speed: 1, note: "Silenciada y precisa" },
  sheriff: { name: "Sheriff", cls: "Pistola", cost: 800, dmg: 55, fire: 420, mag: 6, reload: 2250, spread: .008, move: .11, spray: .02, speed: 1, note: "2 tiros sin escudo" },
  stinger: { name: "Stinger", cls: "Subfusil", cost: 1100, dmg: 24, fire: 72, mag: 20, reload: 2250, spread: .03, move: .045, spray: .012, speed: 1, note: "Ráfaga brutal de cerca" },
  spectre: { name: "Spectre", cls: "Subfusil", cost: 1600, dmg: 26, fire: 82, mag: 30, reload: 2250, spread: .026, move: .04, spray: .009, speed: 1, note: "Precisa en movimiento" },
  phantom: { name: "Phantom", cls: "Rifle", cost: 2900, dmg: 34, fire: 90, mag: 30, reload: 2500, spread: .008, move: .09, spray: .011, speed: .95, note: "Más cadencia, silenciado" },
  vandal: { name: "Vandal", cls: "Rifle", cost: 2900, dmg: 40, fire: 105, mag: 25, reload: 2500, spread: .01, move: .1, spray: .014, speed: .95, note: "Daño fijo, todo terreno" },
  marshal: { name: "Marshal", cls: "Francotirador", cost: 950, dmg: 101, fire: 1000, mag: 5, reload: 2500, spread: .003, move: .26, spray: 0, speed: .9, note: "Sin escudo, cae de un tiro" },
  operator: { name: "Operator", cls: "Francotirador", cost: 4700, dmg: 150, fire: 1400, mag: 5, reload: 3700, spread: .002, move: .3, spray: 0, speed: .78, note: "Un tiro, quieto" },
};
const SHIELDS = { light: { name: "Escudo liviano", short: "Liviano", cls: "Escudo", cost: 400, val: 25 }, heavy: { name: "Escudo pesado", short: "Pesado", cls: "Escudo", cost: 1000, val: 50 } };
// tienda por columnas, como el arsenal de Valorant
const BUY_COLS = [
  [["Pistolas", ["classic", "ghost", "sheriff"]]],
  [["Subfusiles", ["stinger", "spectre"]], ["Escudos", ["light", "heavy"]]],
  [["Rifles", ["phantom", "vandal"]]],
  [["Francotiradores", ["marshal", "operator"]]],
];
const BUY_KEYS = { "1": "classic", "2": "ghost", "3": "sheriff", "4": "stinger", "5": "spectre", "6": "phantom", "7": "vandal", "8": "marshal", "9": "operator", z: "light", x: "heavy" };
const KEY_OF = Object.fromEntries(Object.entries(BUY_KEYS).map(([k, v]) => [v, k.toUpperCase()]));
// siluetas laterales propias (cañón a la derecha) para la tienda, el HUD y el killfeed
const GUN_ART = {
  classic: ["0 0 50 40", "M3 7h41l3 2v7H39v2h-8c-1 4-4 6-8 6h-2l-1-6h-3l-4 19H4l4-19H3zM22 18h7c-.6 2.4-2.6 4-5 4h-1.5z", "M7 9.5v4M9.5 9.5v4M12 9.5v4M27 9h9v2.5h-9z"],
  ghost: ["0 0 74 40", "M3 7h40l2 2v7H38v2h-8c-1 4-4 6-8 6h-2l-1-6h-3l-4 19H4l4-19H3zM21 18h7c-.6 2.4-2.6 4-5 4h-1.5zM45 8.5h25a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5H45z", "M7 9.5v4M9.5 9.5v4M50 9v6M58 9v6M66 9v6"],
  sheriff: ["0 0 66 40", "M9 6l4-2 3 3h15V6h33v6H37v4h-3v2h-4c-1 4-3 6-7 6h-2l-1-6h-2l-6 19H5l5-17c-1.5-1.5-2.5-3.5-2-6zM21 18h6c-.6 2.2-2.4 3.6-4.6 3.6H21z", "M19 8h12v8H19zM62 4v2"],
  stinger: ["0 0 80 40", "M2 9h14V7h42v4h18v4H58v5H47l2 14h-7l-3-14h-6l-3 12h-7l3-12h-4.5L16 18v-1H8v4H2zM5 12v2h11v-2z", "M20 10h20v3H20zM44 9h10v2H44z"],
  spectre: ["0 0 92 40", "M2 10h16V8h48v3h24a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H66v3H49v15h-7V21h-6l-3 12h-7l3-12h-4l-4-3h-3v4H2zM5.5 13v2.5H18V13z", "M22 10.5h20v3H22zM71 11v6M78 11v6M85 11v6M46 9h12v2H46z"],
  phantom: ["0 0 114 40", "M1 11l20-2V7h4V5h30v2h36v3h20a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H91v3H62l-1 3h-1l3 12h-8l-4-14h-6l-3 11h-7l3-11h-4l-4-3H21v5L4 25H1zM25 10.5v2h3v-2z", "M30 9h22v3H30zM96 12v4M103 12v4M68 12h20v2H68zM56 5.5h4V7h-4z"],
  vandal: ["0 0 114 40", "M1 12l21-3V7h5V5h26v2h22v3h16v-1h6V7h2v2h14v3H93v3H75v4H61l4 2 3 13h-7l-4-13h-1l-1-2h-5l-3 11h-7l3-11h-4l-4-3H22v5L3 27H1z", "M28 9h20v3H28zM77 10.5h14v3H77zM55 5.5h5V7h-5zM14 13l6-.8v4L14 17z"],
  marshal: ["0 0 124 40", "M1 13l24-4V8h12V4h28v4h-8v1h60v3H57v3H40v3H33l-4 13h-7l3-13h-3l-2-2H11v3l-8 4H1zM17 15v3h-3v-3zM62 7V4h3v3z", "M40 5h22v2.5H40zM44 9.5h10v3H44zM84 9v3"],
  operator: ["0 0 136 40", "M1 12l24-3V8h10V4h4V1h36v3h-4v4h46v2h15a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-15v1H82l-12 18h-3l9-18H62v6H52v-6H37v4h-3l-4 12h-8l3-12h-3l-3-3h-8v4l-9 5H1zM14 15v3h-3v-3z", "M42 2h30v4H42zM46 10h12v3H46zM120 11v5M126 11v5M82 15h8"],
  light: ["0 0 40 40", "M20 4l13 5v9c0 8.5-5.6 14.6-13 18-7.4-3.4-13-9.5-13-18V9z", "M13 16l7 5 7-5"],
  heavy: ["0 0 40 40", "M20 2l16 6v10c0 10-6.6 17.4-16 20.5C10.6 35.4 4 28 4 18V8z", "M11 12l9 5.5 9-5.5M11 20l9 5.5 9-5.5"],
};
const gunSVG = (id, cls) => { const a = GUN_ART[id] || GUN_ART.classic; return '<svg class="' + (cls || "gun") + '" viewBox="' + a[0] + '" aria-hidden="true"><path d="' + a[1] + '" fill="currentColor" fill-rule="evenodd"/><path d="' + a[2] + '" fill="none" stroke="var(--gun-k,#16202b)" stroke-width="1.3" opacity=".55"/></svg>'; };
const GUN_SHAPE = { // vista de arriba en el mapa: rectángulos en coordenadas locales (x hacia adelante)
  classic: [[0, -3, 13, 6], [13, -2, 5, 4]], ghost: [[0, -3, 13, 6], [13, -2, 11, 4]], sheriff: [[0, -3.5, 14, 7], [14, -2.5, 9, 5]],
  stinger: [[-3, -3.5, 18, 7], [15, -2, 7, 4], [3, 3, 4, 6]], spectre: [[-4, -3.5, 20, 7], [16, -2, 8, 4], [4, 3, 4, 7]],
  phantom: [[-8, -3.5, 28, 7], [20, -2.5, 12, 5], [6, 3, 4, 8], [-8, -4.5, 6, 9]], vandal: [[-8, -3.5, 28, 7], [20, -2, 10, 4], [6, 3, 4, 8], [-8, -4.5, 6, 9]],
  marshal: [[-9, -3, 30, 6], [21, -1.5, 14, 3], [4, -6, 10, 3], [-9, -4, 6, 8]],
  operator: [[-10, -3.5, 34, 7], [24, -2, 14, 4], [4, -7, 12, 4], [-10, -5, 7, 10]],
};

/* =========================================================
   SELECCIÓN DE AGENTE + EMPAREJAMIENTO
   ========================================================= */
let selMode = "online", agentId = store.get("gc_agent", "rafaga"), botDiff = store.get("gc_diff", "oro");
if (!AGENTS[agentId]) agentId = "rafaga";
function renderAgents() {
  const box = $("#agents");
  if (!box.children.length) Object.entries(AGENTS).forEach(([id, a]) => {
    const b = document.createElement("button"); b.className = "agent"; b.dataset.agent = id; b.style.setProperty("--ac", a.color);
    b.innerHTML = '<span class="ag-art" style="color:' + a.color + '">' + AGENT_SVG[a.ab.id] + '</span><span class="ag-role">' + a.role + '</span><span class="ag-name">' + a.name + '</span><span class="ag-ab"><b>' + a.ab.name + " · " + a.ab.charges + (a.ab.charges > 1 ? " cargas" : " carga") + "</b>" + a.ab.desc + "</span>";
    b.addEventListener("click", () => { if (agentId === id) return; agentId = id; store.set("gc_agent", id); AU.ui(); renderAgents(); });
    box.appendChild(b);
  });
  $$("#agents .agent").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.agent === agentId)));
}
$$(".d-rk").forEach((e) => { const [i, sub] = e.dataset.rk.split(",").map(Number); e.innerHTML = rankSVG(i, sub); });
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
    // espera a que estén los candidatos; si ya apareció uno de retransmisión (TURN) no hace falta esperar todo
    return new Promise((res) => {
      if (pc.iceGatheringState === "complete") return res();
      let done = false, relayT = 0;
      const fin = () => { if (!done) { done = true; clearTimeout(t); clearTimeout(relayT); res(); } };
      const t = setTimeout(fin, ms);
      pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") fin(); });
      pc.addEventListener("icecandidate", (e) => { if (e.candidate && / typ relay /.test(e.candidate.candidate) && !relayT) relayT = setTimeout(fin, 400); });
    });
  }
  const sig = (n, body) => api("/api/match", Object.assign({ pid: PID, room: n.room }, body));
  function closePc(n) { try { n.dc && n.dc.close(); } catch (e) {} try { n.st && n.st.close(); } catch (e) {} try { n.pc && n.pc.close(); } catch (e) {} n.dc = null; n.st = null; n.pc = null; }
  function toRelay(n) { if (n.via === "relay") return; n.via = "relay"; closePc(n); n.out({ t: "ping" }); clearTimeout(n.relayT); relayLoop(n); badge(); }
  // dos canales: "st" rápido y sin reenvíos para la posición (si se pierde uno, vale el siguiente) y "gc" garantizado para disparos y rondas
  function wireSt(n, ch) {
    n.st = ch;
    ch.onmessage = (e) => { if (net !== n) return; let m; try { m = JSON.parse(e.data); } catch (err) { return; } recv(m, "rtc"); };
  }
  async function pairType(n) {
    try {
      const stats = await n.pc.getStats(); let pair = null; const loc = {};
      stats.forEach((r) => { if (r.type === "candidate-pair" && (r.nominated || r.selected) && r.state === "succeeded") pair = r; if (r.type === "local-candidate") loc[r.id] = r; });
      if (pair && loc[pair.localCandidateId]) n.turn = loc[pair.localCandidateId].candidateType === "relay";
      badge();
    } catch (e) {}
  }
  function wireDc(n, dc) {
    n.dc = dc;
    dc.onopen = () => { if (net !== n) return; setTimeout(() => net === n && n.pc && pairType(n), 600); if (n.role === "guest" && !n.via) { n.via = "rtc"; clearTimeout(n.pickT); hello(n); } };
    dc.onmessage = (e) => { if (net !== n) return; let m; try { m = JSON.parse(e.data); } catch (err) { return; } recv(m, "rtc"); };
    dc.onclose = () => { if (net === n && n.via === "rtc" && !n.left && !n.closed) toRelay(n); };
  }
  async function rtcGuest(n) {
    const pc = new RTCPeerConnection({ iceServers: await getIce(), iceCandidatePoolSize: 2 }); if (net !== n) { pc.close(); return; }
    n.pc = pc; wireDc(n, pc.createDataChannel("gc", { ordered: true })); wireSt(n, pc.createDataChannel("st", { ordered: false, maxRetransmits: 0 }));
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc, 4000); if (net !== n || n.via) return;
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
        const pc = new RTCPeerConnection({ iceServers: await ice, iceCandidatePoolSize: 2 }); if (net !== n || n.via) { pc.close(); return; }
        n.pc = pc; pc.ondatachannel = (e) => { if (net !== n) return; if (e.channel.label === "st") wireSt(n, e.channel); else wireDc(n, e.channel); };
        await pc.setRemoteDescription({ type: "offer", sdp: j.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc, 4000); if (net !== n || n.via) return;
        await sig(n, { action: "signal", kind: "answer", sdp: pc.localDescription.sdp });
        return;
      }
      await sleep(350);
    }
  }
  // plan B: hasta 3 pedidos en vuelo a la vez, uno nuevo cada ~55 ms (antes esperaba la respuesta de cada uno)
  async function relayOnce(n) {
    const msgs = n.outbox.splice(0, 60);
    n.inflight = (n.inflight || 0) + 1;
    try {
      const j = await sig(n, { action: "relay", role: n.role === "host" ? "h" : "g", msgs });
      if (net === n) (j.msgs || []).forEach((m) => recv(m, "relay"));
    } catch (e) { if (net === n) n.outbox.unshift(...msgs.filter((m) => m.t !== "s")); }
    n.inflight--;
  }
  function relayLoop(n) {
    if (net !== n || n.closed) return;
    const fast = n.via === "relay";
    if ((n.inflight || 0) < (fast ? 3 : 1)) relayOnce(n);
    n.relayT = setTimeout(() => relayLoop(n), fast ? 55 : n.via === "rtc" ? 2500 : 600);
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
    if (m.t === "pi") { n.out({ t: "po", i: m.i }); return; }
    if (m.t === "po") { const rtt = now() - (+m.i || 0); if (rtt >= 0 && rtt < 5000) { n.rtt = n.rtt ? n.rtt * .7 + rtt * .3 : rtt; badge(); } return; }
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
    const ms = net.rtt ? Math.round(net.rtt) : 0;
    b.hidden = false; b.className = "net-badge " + (!ms ? "" : ms < 90 ? "good" : ms < 180 ? "ok" : "bad");
    b.innerHTML = "<i></i>" + (net.via === "rtc" ? (net.turn ? "Directa · TURN" : "Directa") : "Servidor") + (ms ? " · " + ms + " ms" : "");
  }
  setInterval(() => { if (net && net.started && net.via) net.out({ t: "pi", i: Math.round(now()) }); }, 1500);
  function connectTo(j, my) {
    const role = j.role, room = role === "guest" ? j.opp.peer : my.sid;
    clearTimeout(my.timer); search = null;
    lastMatch = { room, role, oppNick: (j.opp && j.opp.nick) || "RIVAL" };
    const n = { role, room, opp: { nick: (j.opp && j.opp.nick) || "RIVAL", agent: "rafaga" }, via: null, outbox: [], lastRecv: now(), started: false, left: false, closed: false };
    n.out = (m) => {
      if (n.closed) return;
      if (n.via === "rtc" && n.dc && n.dc.readyState === "open") {
        try {
          const fast = m.t === "s" || m.t === "pi" || m.t === "po";
          if (fast && n.st && n.st.readyState === "open") { if (n.st.bufferedAmount < 16000) n.st.send(JSON.stringify(m)); return; }
          if (m.t === "s" && n.dc.bufferedAmount > 32000) return; // red saturada: se descarta la posición vieja
          n.dc.send(JSON.stringify(m)); return;
        } catch (e) {}
      }
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
    room: () => (lastMatch ? lastMatch.room : ""),
    async claim() { // victoria por abandono: el servidor decide un solo ganador
      if (!lastMatch) return true;
      try { const j = await api("/api/match", { action: "claim", pid: PID, room: lastMatch.room }); return !!j.winner; } catch (e) { return true; }
    },
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
   MIRA PERSONALIZABLE
   Se dibuja en una capa propia a la resolución real de la pantalla,
   con líneas alineadas a píxel (nítidas, sin borroneo) y en el mismo
   instante en que se mueve el mouse.
   ========================================================= */
const XH = (() => {
  // c color · o contorno (ot grosor, oo opacidad) · d punto (ds, do) · il líneas internas (iL largo, iT grosor, iG separación, iO opacidad)
  // ol líneas externas (oL, oT, oG, oO) · dyn se abre al moverte/disparar · as asistencia táctil 0-3 · lk bloquear mouse · sn sensibilidad
  const KEYS = ["c", "o", "ot", "oo", "d", "ds", "do", "il", "iL", "iT", "iG", "iO", "ol", "oL", "oT", "oG", "oO", "dyn", "as", "lk", "sn"];
  const LIM = { o: [0, 1], ot: [1, 3], oo: [0, 1], d: [0, 1], ds: [1, 6], do: [0, 1], il: [0, 1], iL: [0, 20], iT: [1, 6], iG: [0, 20], iO: [0, 1], ol: [0, 1], oL: [0, 20], oT: [1, 6], oG: [0, 30], oO: [0, 1], dyn: [0, 1], as: [0, 3], lk: [0, 1], sn: [.2, 3] };
  const PRESETS = {
    fina: { c: "#3fe0c5", o: 1, ot: 1, oo: .5, d: 0, ds: 2, do: 1, il: 1, iL: 4, iT: 1, iG: 2, iO: 1, ol: 0, oL: 2, oT: 1, oG: 10, oO: .5, dyn: 1 },
    clasica: { c: "#ffffff", o: 1, ot: 1, oo: .5, d: 0, ds: 2, do: 1, il: 1, iL: 6, iT: 2, iG: 3, iO: .9, ol: 1, oL: 2, oT: 2, oG: 10, oO: .5, dyn: 1 },
    punto: { c: "#f2c14e", o: 1, ot: 1, oo: .6, d: 1, ds: 3, do: 1, il: 0, iL: 4, iT: 1, iG: 2, iO: 1, ol: 0, oL: 2, oT: 1, oG: 10, oO: .5, dyn: 0 },
    pro: { c: "#00ff7f", o: 0, ot: 1, oo: .5, d: 1, ds: 1, do: 1, il: 1, iL: 3, iT: 1, iG: 2, iO: 1, ol: 0, oL: 2, oT: 1, oG: 10, oO: .5, dyn: 0 },
    grande: { c: "#ff4655", o: 1, ot: 1, oo: .6, d: 0, ds: 2, do: 1, il: 1, iL: 10, iT: 2, iG: 5, iO: 1, ol: 0, oL: 2, oT: 1, oG: 10, oO: .5, dyn: 1 },
  };
  const BASE = { ...PRESETS.fina, as: 2, lk: 0, sn: 1 };
  const okColor = (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
  function sane(o) {
    const r = { ...BASE };
    for (const k of KEYS) {
      if (o[k] == null) continue;
      if (k === "c") { r.c = okColor(String(o.c)) || r.c; continue; }
      const n = +o[k]; if (!isFinite(n)) continue; const [lo, hi] = LIM[k]; r[k] = clamp(n, lo, hi);
    }
    return r;
  }
  let cfg = sane(store.get("gc_xh", {}) || {});
  const code = (k) => "GC1-" + KEYS.map((x) => (x === "c" ? k.c.slice(1) : String(+(+k[x]).toFixed(2)))).join("-");
  function parse(s) {
    const p = String(s || "").trim().split("-"); if (p[0] !== "GC1" || p.length !== KEYS.length + 1) return null;
    const o = {}; KEYS.forEach((k, i) => (o[k] = k === "c" ? "#" + p[i + 1] : +p[i + 1])); return sane(o);
  }
  let syncT = 0;
  function set(next, quiet) {
    cfg = sane({ ...cfg, ...next }); store.set("gc_xh", cfg);
    clearTimeout(syncT); if (PLAYER && !quiet) syncT = setTimeout(() => api("/api/player", { action: "prefs", pid: PID, xh: code(cfg) }).catch(() => {}), 1200);
    if (!$("#xh-modal").hidden) paintForm();
  }
  // trae la mira guardada en el servidor (por si entrás desde otro celular)
  function fromServer(xh) { if (!xh || store.get("gc_xh", null)) return; const k = parse(xh); if (k) { cfg = k; store.set("gc_xh", cfg); } }

  /* ---------- dibujo (coordenadas en píxeles reales; s = píxeles por punto CSS) ---------- */
  function draw(c, x, y, s, spread, alpha, hit) {
    const k = cfg; x = Math.round(x); y = Math.round(y);
    const T = (v) => Math.max(1, Math.round(v * s)), L = (v) => Math.round(v * s);
    const rects = [];
    const bars = (on, len, th, gap, op, grow) => {
      if (!on || len <= 0 || op <= 0) return;
      const l = L(len), t = T(th), g = L(gap + (k.dyn ? grow : 0)), h = Math.floor((t - 1) / 2);
      rects.push([x + 1 + g, y - h, l, t, op], [x - g - l, y - h, l, t, op], [x - h, y - g - l, t, l, op], [x - h, y + 1 + g, t, l, op]);
    };
    bars(k.il, k.iL, k.iT, k.iG, k.iO, spread);
    bars(k.ol, k.oL, k.oT, k.oG, k.oO, spread * 1.5);
    if (k.d && k.do > 0) { const d = T(k.ds), h = Math.floor((d - 1) / 2); rects.push([x - h, y - h, d, d, k.do]); }
    if (k.o && k.oo > 0) {
      const o = T(k.ot); c.fillStyle = "#000";
      for (const r of rects) { c.globalAlpha = alpha * k.oo * r[4]; c.fillRect(r[0] - o, r[1] - o, r[2] + 2 * o, r[3] + 2 * o); }
    }
    c.fillStyle = hit ? "#ffffff" : k.c;
    for (const r of rects) { c.globalAlpha = alpha * r[4]; c.fillRect(r[0], r[1], r[2], r[3]); }
    if (hit) { // marca de impacto
      c.globalAlpha = alpha; c.strokeStyle = "#fff"; c.lineWidth = T(1.5); c.beginPath();
      const a = L(7), b = L(12);
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.moveTo(x + .5 + sx * a, y + .5 + sy * a); c.lineTo(x + .5 + sx * b, y + .5 + sy * b); }
      c.stroke();
    }
    c.globalAlpha = 1;
    const reach = Math.max(L(k.oG + k.oL + 4), L(k.iG + k.iL + 4), L(16)) + L(spread * 1.5) + 4;
    return [x - reach, y - reach, reach * 2, reach * 2];
  }
  // asistencia de puntería en celular (0 = apagada)
  const assist = () => [[0, 0], [.18, .45], [.3, .7], [.45, .9]][Math.round(cfg.as)];

  /* ---------- editor ---------- */
  const SWATCHES = ["#3fe0c5", "#ffffff", "#00ff7f", "#f2c14e", "#ffff00", "#ff4655", "#00e5ff", "#ff5cf0"];
  const pv = $("#xh-prev"), pctx = pv.getContext("2d");
  function paintPreview() {
    const r = pv.getBoundingClientRect(), s = Math.min(3, window.devicePixelRatio || 1);
    if (!r.width) return;
    pv.width = Math.round(r.width * s); pv.height = Math.round(r.height * s);
    const c = pctx, w = pv.width, h = pv.height;
    c.fillStyle = "#151c25"; c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(255,255,255,.05)"; c.lineWidth = 1; c.beginPath(); for (let i = 0; i < w; i += 40 * s) { c.moveTo(i + .5, 0); c.lineTo(i + .5, h); } c.stroke();
    c.fillStyle = "#2b3745"; c.fillRect(w * .62, 0, w * .38, h * .45); c.fillStyle = "#c9cfd6"; c.fillRect(0, h * .78, w * .12, h * .22);
    c.fillStyle = "#ff4655"; c.beginPath(); c.arc(w * .76, h * .7, 12 * s, 0, Math.PI * 2); c.fill();
    draw(c, w * .25, h / 2, s, 0, 1, false);
    draw(c, w * .5, h / 2, s, 6, 1, false);
    draw(c, w * .76, h * .7, s, 0, 1, true);
    c.fillStyle = "rgba(236,232,225,.55)"; c.font = 10 * s + "px 'JetBrains Mono', monospace"; c.textAlign = "center";
    c.fillText("QUIETO", w * .25, h - 8 * s); c.fillText("CORRIENDO", w * .5, h - 8 * s); c.fillText("IMPACTO", w * .76, h * .7 - 22 * s);
  }
  function paintForm() {
    $$("#xh-modal [data-k]").forEach((el) => {
      const k = el.dataset.k, v = cfg[k];
      if (el.type === "checkbox") el.checked = !!v;
      else if (el.type === "range") { el.value = v; const o = el.parentElement.querySelector("output"); if (o) o.textContent = k.endsWith("O") || k === "oo" || k === "do" ? Math.round(v * 100) + "%" : k === "sn" ? (+v).toFixed(2) : v; }
      else if (el.tagName === "SELECT") el.value = String(v);
      else if (el.type === "color") el.value = cfg.c;
    });
    $$("#xh-sw button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === cfg.c)));
    $$("#xh-presets button").forEach((b) => { const p = PRESETS[b.dataset.p]; b.setAttribute("aria-pressed", String(Object.keys(p).every((k) => String(p[k]) === String(cfg[k])))); });
    $$("#xh-modal .xh-sec").forEach((sec) => { const t = sec.querySelector(".sw-t input"); if (t) sec.classList.toggle("off", !t.checked); });
    $("#xh-code").value = code(cfg);
    paintPreview();
  }
  function build() {
    $("#xh-sw").innerHTML = SWATCHES.map((c) => '<button type="button" data-c="' + c + '" style="--sw:' + c + '" aria-label="Color ' + c + '"></button>').join("") + '<label class="xh-pick" title="Otro color"><input type="color" data-k="c" aria-label="Elegir otro color"><span>+</span></label>';
    $$("#xh-sw button").forEach((b) => b.addEventListener("click", () => set({ c: b.dataset.c })));
    $$("#xh-presets button").forEach((b) => b.addEventListener("click", () => set(PRESETS[b.dataset.p])));
    $$("#xh-modal [data-k]").forEach((el) => {
      const ev = el.type === "range" || el.type === "color" ? "input" : "change";
      el.addEventListener(ev, () => set({ [el.dataset.k]: el.type === "checkbox" ? (el.checked ? 1 : 0) : el.type === "color" ? el.value : +el.value }));
    });
    $("#xh-copy").addEventListener("click", async () => { const el = $("#xh-code"); el.select(); try { await navigator.clipboard.writeText(el.value); } catch (e) { document.execCommand && document.execCommand("copy"); } $("#xh-msg").textContent = "Código copiado. Pasáselo a quien quieras."; });
    $("#xh-apply").addEventListener("click", () => { const k = parse($("#xh-paste").value); $("#xh-msg").textContent = k ? "¡Mira aplicada!" : "Ese código no es válido. Tiene que empezar con GC1-"; if (k) { set(k); $("#xh-paste").value = ""; } });
    $("#xh-reset").addEventListener("click", () => set(BASE));
    $("#xh-close").addEventListener("click", close);
    $("#xh-modal").addEventListener("click", (e) => { if (e.target.id === "xh-modal") close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#xh-modal").hidden) { e.stopPropagation(); close(); } }, true);
    window.addEventListener("resize", () => { if (!$("#xh-modal").hidden) paintPreview(); });
  }
  function open() { $("#xh-msg").textContent = ""; $("#xh-modal").hidden = false; try { document.exitPointerLock && document.pointerLockElement && document.exitPointerLock(); } catch (e) {} paintForm(); AU.ui(); }
  function close() { $("#xh-modal").hidden = true; }
  build();
  $$("[data-xh-open]").forEach((b) => b.addEventListener("click", open));
  return { get: () => cfg, draw, assist, open, fromServer, code };
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

  let cv = $("#cv"), ctx = cv.getContext("2d", { alpha: false }), fog = document.createElement("canvas"), fctx = fog.getContext("2d");
  const bgc = document.createElement("canvas"), bctx = bgc.getContext("2d"); let bgKey = "";
  // capa de la mira: resolución real de pantalla y "desynchronized" (se muestra sin esperar al resto del cuadro)
  const xcv = $("#xh"); let xctx; try { xctx = xcv.getContext("2d", { desynchronized: true }); } catch (e) {} if (!xctx) xctx = xcv.getContext("2d");
  let xdpr = 1, xbox = null;
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
      econ: econNew(), botEcon: econNew(), stats: { kills: 0, deaths: 0, shots: 0, hits: 0, dmg: 0 }, startedAt: Date.now(), result: null, pending: null,
      mid: (opts.mode === "online" ? "o-" + (NET.room() || newId()) : "b-" + newId()).replace(/[^a-zA-Z0-9-_:]/g, "").slice(0, 70), lastStateAt: now() };
    $("#game").hidden = false; document.body.style.overflow = "hidden"; document.documentElement.classList.add("game-open");
    M.bg = !!opts.bg;
    $("#end").hidden = true; $("#confirm").hidden = true; $("#buy").hidden = true; $("#buy").classList.remove("out"); $("#banner").hidden = true;
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
    M.econ.boughtW = null; M.econ.boughtSh = 0; M.lastCredits = null; M.lastStateAt = now();
    if (!online()) { botBuy(o); }
    const t = now(), long = M.roundNo === 1 || M.justHalf || M.justOT;
    const autoBuy = long;
    S = { p, o, smokes: [], barriers: [], tracers: [], sparks: [], pops: [], rings: [], parts: [], shells: [],
      phase: "buy", phaseEnd: t + (long ? BUY_LONG : BUY_MS), roundEnd: 0, reveal: 0, lastSeen: null, cam: { x: p.x + 160 * (M.side === "L" ? 1 : -1), y: p.y, shake: 0 },
      rt: { x: o.x, y: o.y, vx: 0, vy: 0, a: o.a, hp: 100, sh: 0, w: "classic", t: t, q: 0 }, ai: { seenAt: 0, target: null, wp: null, stuckT: t, lx: o.x, ly: o.y, burst: 0, strafeUntil: 0, dir: 1, aimErr: 0, wanderUntil: 0 },
      hitmark: -1e9, alertUntil: 0, deadAt: 0, fogSeg: null, autoBuy };
    M.justHalf = false; M.justOT = false;
    const sub = M.ot ? "Ronda decisiva" : M.score.me === WIN - 1 || M.score.opp === WIN - 1 ? "Punto de partido" : "Primero a " + WIN;
    banner("Ronda " + M.roundNo, "Fase de compra", sub, "", 1500);
    openBuy(true);
    if (!S.autoBuy && M.econ.credits >= 400) later(() => { if (S && S.phase === "buy" && $("#buy").hidden) alertMsg("Tenés " + fmt(M.econ.credits) + " ¤ · tocá Comprar", 1600); }, 1600);
    hud(true);
  }
  function countdown(n) {
    const c = $("#count"); c.textContent = n > 0 ? n : "¡Ya!"; c.className = "count" + (n > 0 ? "" : " go"); c.hidden = false; void c.offsetWidth; c.classList.add("pop");
    clearTimeout(countdown.t); countdown.t = setTimeout(() => (c.hidden = true), 620);
    AU.beep(n > 0 ? 660 : 1320); if (n <= 0) buzz(30);
  }
  function creditGain(n) {
    if (!n || n <= 0) return; const g = $("#cr-gain"), r = $("#hud-cr").getBoundingClientRect(), gr = $("#game").getBoundingClientRect();
    g.textContent = "+" + fmt(n) + " ¤"; g.style.left = (r.left - gr.left) + "px"; g.style.top = (r.bottom - gr.top + 4) + "px";
    g.hidden = true; void g.offsetWidth; g.hidden = false; clearTimeout(creditGain.t); creditGain.t = setTimeout(() => (g.hidden = true), 1700);
  }
  function goLive() {
    S.phase = "live"; S.roundEnd = now() + ROUND_MS; closeBuy(); countdown(0);

  }
  function hostEndRound(winner, cause) {
    if (!S || S.phase !== "live") return;
    if (online()) send({ t: "round", w: winner === "me" ? "h" : winner === "opp" ? "g" : "", c: cause, hs: M.score.me + (winner === "me" ? 1 : 0), gs: M.score.opp + (winner === "opp" ? 1 : 0) });
    applyRoundEnd(winner, cause);
  }
  function applyRoundEnd(winner, cause) {
    if (!S || (S.phase !== "live")) return;
    S.phase = "post"; S.phaseEnd = now() + POST_MS; M.lastCredits = M.econ.credits;
    if (winner === "me") M.score.me++; else if (winner === "opp") M.score.opp++;
    M.history.push(winner === "me" ? "w" : winner === "opp" ? "l" : "t");
    // economía propia
    const e = M.econ;
    if (winner === "me") { e.credits += 3000 + (cause === "kill" ? 200 : 0); e.streak = 0; }
    else { e.credits += Math.min(1900 + 500 * e.streak, 2900); e.streak++; }
    e.credits = Math.min(MAX_CR, e.credits);
    creditGain(e.credits - (M.lastCredits != null ? M.lastCredits : e.credits));
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
    $("#end-pts").textContent = "Guardando en el ranking…"; $("#end-rank").hidden = true;
    $("#end-rematch").hidden = true; $("#end-rematch-btn").hidden = !online() || !!forfeit;
    $("#end-again").textContent = online() ? "Nuevo rival" : "Jugar otra vez";
    submit(won, !!forfeit);
  }
  async function submit(won, forfeit, quiet) {
    const body = { pid: PID, nick: nick(), mode: M.mode, won, forfeit, rw: M.score.me, rl: M.score.opp, kills: M.stats.kills, diff: M.diff, opp: M.oppNick, agent: M.agent, mid: M.mid };
    const h = store.get("gc_hist2", []); h.unshift({ mode: M.mode, won, forfeit, rw: M.score.me, rl: M.score.opp, opp: M.oppNick, diff: M.mode === "bot" ? M.diff : "", pts: 0, t: Date.now() }); store.set("gc_hist2", h.slice(0, 30));
    try {
      await syncPlayer();
      const j = await api("/api/score", body);
      if (!quiet) { $("#end-pts").textContent = "+" + fmt(j.pts) + " pts · Puesto #" + j.rank + " de " + j.players + " · Total " + fmt(j.total); endRank(j.total - j.pts, meStats && meStats.rank, j.total, j.rank); }
      meStats = Object.assign(meStats || {}, { total: j.total, rank: j.rank });
    } catch (e) {
      const q = store.get("gc_pending2", []); q.push(body); store.set("gc_pending2", q.slice(-20));
      if (!quiet) $("#end-pts").textContent = "Sin conexión: tu resultado se guarda en cuanto vuelva internet.";
    }
  }
  // rango al final: si subiste, el emblema nuevo aparece con un destello (momento especial, poco frecuente)
  function endRank(oldT, oldPos, newT, newPos) {
    const a = rankOf(oldT, oldPos), b = rankOf(newT, newPos), box = $("#end-rank"), up = b.i * 4 + b.sub > a.i * 4 + a.sub;
    box.className = "end-rank" + (up ? " up" : ""); box.style.setProperty("--rc", b.c[1]); box.style.setProperty("--rh", b.c[0]);
    if (up) {
      box.innerHTML = '<div class="er-old">' + rankSVG(a.i, a.sub) + '</div><svg class="er-arr" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg><div class="er-new">' + rankSVG(b.i, b.sub) + '</div><div class="er-txt"><span class="label">' + (b.i > a.i ? "¡Subiste de rango!" : "¡Subiste de nivel!") + "</span><b>" + b.label + "</b></div>";
      later(() => { AU.win(); buzz([30, 50, 60]); }, 450);
    } else {
      const same = a.i === b.i && a.sub === b.sub;
      box.innerHTML = rankHTML(newT, newPos);
      const bar = box.querySelector(".rk-bar i");
      if (bar) { const to = bar.style.transform; bar.style.transition = "none"; bar.style.transform = "scaleX(" + (same ? a.prog : 0).toFixed(3) + ")"; void bar.offsetWidth; bar.style.transition = ""; requestAnimationFrame(() => (bar.style.transform = to)); }
    }
    box.hidden = false;
  }
  async function flushPending() {
    const q = store.get("gc_pending2", []); if (!q.length) return;
    const keep = []; for (const b of q) { try { await api("/api/score", b); } catch (e) { keep.push(b); } }
    store.set("gc_pending2", keep);
  }
  async function opponentLeft() {
    if (!M || M.result || M.leaving) return;
    if (M.over) { finishMatch(); return; } // la partida ya estaba definida: no es abandono
    M.leaving = true; if (S) S.phase = "end";
    banner("Tu rival se desconectó", "Verificando…", "", "");
    const mine = M, win = await NET.claim();
    if (M !== mine || M.result) return;
    if (win) { banner("Tu rival se desconectó", "Ganás por abandono", "", "win"); later(() => finishMatch(true), 1300); }
    else { M.result = { won: false }; submit(false, false, true); noResultLeft("Se cortó tu conexión y tu rival se quedó con la partida."); }
  }
  // sin resultado: se cortaron los dos (o volviste tarde); no se guarda nada
  function noResult(title, sub) {
    if (!M || M.result) return;
    M.result = { won: false, none: true }; if (S) S.phase = "end";
    if (online()) setTimeout(() => NET.close(), 600);
    const end = $("#end"); end.hidden = false; end.className = "end lose";
    $("#end-kicker").textContent = "Duelo online"; $("#end-title").textContent = "Sin resultado";
    $("#end-me").textContent = M.score.me; $("#end-opp").textContent = M.score.opp; $("#end-vs").textContent = sub;
    $("#end-stats").innerHTML = ""; $("#end-pts").textContent = title;
    $("#end-rematch").hidden = true; $("#end-rematch-btn").hidden = true; $("#end-again").textContent = "Nuevo rival";
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
  const TIER = { classic: 0, ghost: 1, sheriff: 2, stinger: 3, spectre: 4, marshal: 4, phantom: 6, vandal: 6, operator: 9 };
  function botBuy(o) {
    const b = M.botEcon; o.w = b.keepW; o.sh = b.keepSh; o.ammo = WEAPONS[o.w].mag;
    const want = (id) => { const c = WEAPONS[id].cost; if (b.credits >= c && TIER[o.w] < TIER[id]) { b.credits -= c; o.w = id; o.ammo = WEAPONS[id].mag; } };
    const rifle = Math.random() < .5 ? "vandal" : "phantom", smg = Math.random() < .6 ? "spectre" : "stinger";
    if (b.credits >= 3300) want(rifle); else if (b.credits >= 1600 && M.diff !== "hierro") want(smg); else if (b.credits >= 1100 && M.diff !== "hierro") want("stinger"); else if (b.credits >= 800) want(Math.random() < .5 ? "sheriff" : "ghost"); else if (b.credits >= 500) want("ghost");
    if (b.credits >= 1000 && o.sh < 50) { b.credits -= 1000; o.sh = 50; } else if (b.credits >= 400 && o.sh < 25) { b.credits -= 400; o.sh = 25; }
  }
  const refundW = () => (M.econ.boughtW ? WEAPONS[M.econ.boughtW].cost : 0);
  const refundS = () => (M.econ.boughtSh ? (M.econ.boughtSh === 50 ? 1000 : 400) : 0);
  function buy(id) {
    if (!S || S.phase !== "buy") return;
    const e = M.econ, p = S.p;
    if (WEAPONS[id]) {
      const wd = WEAPONS[id]; if (p.w === id) return;
      const refund = refundW();
      if (e.credits + refund < wd.cost) { AU.deny(); denyCard(id); return; }
      e.credits += refund - wd.cost; p.w = id; p.ammo = wd.mag; e.boughtW = wd.cost > 0 ? id : null;
      if (id === "vandal" || id === "phantom") store.set("gc_rifle", id); // la compra rápida recuerda tu rifle
    } else {
      const sd = SHIELDS[id]; if (p.sh >= sd.val) return;
      const refund = refundS();
      if (e.credits + refund < sd.cost) { AU.deny(); denyCard(id); return; }
      e.credits += refund - sd.cost; p.sh = sd.val; e.boughtSh = sd.val;
    }
    AU.buy(); updateBuy(id); hud(true);
    send({ t: "s", ...stateMsg() });
  }
  // sin plata: la tarjeta tiembla y el precio se pone rojo (mismo lenguaje que el botón de habilidad)
  function denyCard(id) {
    const c = $('#buy [data-buy="' + id + '"]'); if (!c) return;
    c.animate([{ transform: "translateX(0)" }, { transform: "translateX(-5px)" }, { transform: "translateX(4px)" }, { transform: "translateX(-2px)" }, { transform: "translateX(0)" }], { duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    c.classList.remove("nope"); void c.offsetWidth; c.classList.add("nope");
  }
  const buyOpen = () => !$("#buy").hidden && !$("#buy").classList.contains("out");
  // la tienda se abre sola solo cuando se reinician los créditos (ronda 1, medio tiempo, ronda decisiva); el resto, con el botón
  function openBuy(auto) {
    if (!S || S.phase !== "buy") return; if (auto && !S.autoBuy) return;
    const b = $("#buy"); clearTimeout(closeBuy.t); b.classList.remove("out");
    try { if (document.pointerLockElement === cv) document.exitPointerLock(); } catch (e) {}
    if (b.hidden) { b.hidden = false; renderBuy(); } else updateBuy();
  }
  // compra rápida: la mejor arma que alcance (sin francotiradores) y el mejor escudo con lo que sobra
  function quickPlan() {
    const e = M.econ, p = S.p, rifle = store.get("gc_rifle", "vandal") === "phantom" ? "phantom" : "vandal";
    const refW = refundW(), refS = refundS(), rankNow = TIER[p.w];
    let w = p.w, spentW = 0;
    for (const cand of [rifle, "spectre", "stinger", "sheriff", "ghost"]) {
      if (TIER[cand] <= rankNow) break;                           // lo que tenés ya es igual o mejor
      const net = WEAPONS[cand].cost - refW;
      if (net <= e.credits) { w = cand; spentW = net; break; }
    }
    const left = e.credits - spentW;
    let sh = p.sh, spentS = 0;
    if (p.sh < 50 && 1000 - refS <= left) { sh = 50; spentS = 1000 - refS; }
    else if (p.sh < 25 && 400 - refS <= left) { sh = 25; spentS = 400 - refS; }
    return { w, sh, cost: Math.max(0, spentW + spentS) };
  }
  function quickBuy() {
    if (!S || S.phase !== "buy") return;
    const q = quickPlan(), p = S.p;
    if (q.w !== p.w) buy(q.w);
    if (q.sh > p.sh) buy(q.sh === 50 ? "heavy" : "light");
    if (q.w === p.w && q.sh <= p.sh) AU.ui();
    later(closeBuy, 320);
  }
  // cerrar = salir por donde entró (misma dirección, más rápido)
  function closeBuy() {
    const b = $("#buy"); if (b.hidden || b.classList.contains("out")) return;
    b.classList.add("out"); clearTimeout(closeBuy.t);
    closeBuy.t = setTimeout(() => { b.hidden = true; b.classList.remove("out"); }, 150);
  }
  // número que corre hasta el valor nuevo (los créditos bajan a la vista cuando comprás)
  function tweenNum(el, to) {
    const from = el.dataset.v == null ? to : +el.dataset.v; el.dataset.v = to; cancelAnimationFrame(el._r);
    if (from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), d = 260;
    const step = () => { const k = Math.min(1, (performance.now() - t0) / d), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(Math.round(from + (to - from) * e)); if (k < 1) el._r = requestAnimationFrame(step); };
    step();
  }
  const STAT_ROWS = [["Daño", (w) => w.dmg / 150, (w) => w.dmg], ["Cadencia", (w) => Math.min(1, 1000 / w.fire / 14), (w) => (1000 / w.fire).toFixed(1) + "/s"], ["Precisión", (w) => clamp(1 - w.spread / .034, .05, 1), (w) => Math.round(clamp(1 - w.spread / .034, .05, 1) * 100)], ["Movilidad", (w) => clamp(w.speed - w.move, .1, 1), (w) => Math.round(w.speed * 100) + "%"]];
  function showInfo(id) {
    const box = $("#buy-info"); if (!box || box.dataset.id === id) return; box.dataset.id = id;
    const w = WEAPONS[id], sd = SHIELDS[id];
    $("#bi-cls").textContent = w ? w.cls : "Escudo"; $("#bi-name").textContent = w ? w.name : sd.short;
    $("#bi-note").textContent = w ? w.note + " · cargador " + w.mag : "+" + sd.val + " de escudo. Absorbe daño antes que la vida.";
    $("#bi-art").innerHTML = gunSVG(id, "gun big");
    $$("#bi-stats > div").forEach((row, i) => {
      const r = STAT_ROWS[i]; row.hidden = !w; if (!w) return;
      row.querySelector("i").style.transform = "scaleX(" + r[1](w).toFixed(3) + ")"; row.querySelector("b").textContent = r[2](w);
    });
  }
  function renderBuy() {
    const g = $("#buy-grid"); g.innerHTML = ""; let n = 0, gi = 0;
    BUY_COLS.forEach((col, ci) => {
      const c = document.createElement("div"); c.className = "bcol"; c.style.setProperty("--i", ci);
      col.forEach(([label, ids]) => {
        const grp = document.createElement("div"); grp.className = "bgrp"; grp.style.setProperty("--i", gi++);
        const h = document.createElement("p"); h.className = "bgl"; h.textContent = label; grp.appendChild(h);
        ids.forEach((id) => {
          const d = WEAPONS[id] || SHIELDS[id], b = document.createElement("button");
          b.className = "wcard" + (SHIELDS[id] ? " shield" : ""); b.dataset.buy = id; b.style.setProperty("--n", n++);
          b.setAttribute("aria-label", (d.short || d.name) + ", " + (d.cost ? d.cost + " créditos" : "gratis"));
          b.innerHTML = '<span class="wp"></span><kbd class="wk">' + KEY_OF[id] + "</kbd>" + gunSVG(id) + '<span class="wn">' + (d.short || d.name) + '</span><span class="wtag">Equipado</span><i class="sweep"></i>';
          b.addEventListener("click", () => buy(id));
          b.addEventListener("pointerenter", () => showInfo(id)); b.addEventListener("focus", () => showInfo(id));
          grp.appendChild(b);
        });
        c.appendChild(grp);
      });
      if (ci === 2) { // compra rápida debajo de los rifles
        const q = document.createElement("button"); q.className = "wcard quick"; q.id = "buy-quick"; q.style.setProperty("--n", n++);
        q.innerHTML = '<span class="qk">⚡ Compra rápida</span><kbd class="wk">Q</kbd><span class="qn"></span><span class="wp"></span><i class="sweep"></i>';
        q.addEventListener("click", quickBuy); const grp = document.createElement("div"); grp.className = "bgrp"; grp.style.setProperty("--i", gi++); grp.innerHTML = '<p class="bgl">Recomendado</p>'; grp.appendChild(q); c.appendChild(grp);
      }
      if (ci === 3) { // ficha del arma (en compu)
        const f = document.createElement("div"); f.className = "binfo"; f.id = "buy-info";
        f.innerHTML = '<span class="bi-cls" id="bi-cls"></span><b class="bi-name" id="bi-name"></b><div class="bi-art" id="bi-art"></div><div class="bi-stats" id="bi-stats">' + STAT_ROWS.map((r) => '<div><span>' + r[0] + '</span><em><i></i></em><b></b></div>').join("") + '</div><p class="bi-note" id="bi-note"></p>';
        c.appendChild(f);
      }
      g.appendChild(c);
    });
    $("#buy-cr").dataset.v = M.econ.credits;
    updateBuy(); showInfo(S.p.w);
  }
  // actualiza estados sin rearmar (las transiciones de color hacen el resto)
  function updateBuy(bought) {
    if (!S || $("#buy").hidden) return;
    const e = M.econ, p = S.p;
    tweenNum($("#buy-cr"), e.credits);
    $$("#buy .wcard[data-buy]").forEach((b) => {
      const id = b.dataset.buy, d = WEAPONS[id] || SHIELDS[id], isW = !!WEAPONS[id];
      const owned = isW ? p.w === id : p.sh >= d.val, can = owned || e.credits + (isW ? refundW() : refundS()) >= d.cost;
      b.classList.toggle("owned", owned); b.classList.toggle("cant", !can);
      const wp = b.querySelector(".wp"); wp.textContent = d.cost ? fmt(d.cost) : "Gratis"; wp.classList.toggle("cr", !!d.cost);
    });
    const q = quickPlan(), qb = $("#buy-quick");
    if (qb) {
      qb.querySelector(".qn").textContent = (q.w !== p.w ? WEAPONS[q.w].name : "") + (q.w !== p.w && q.sh > p.sh ? " + " : "") + (q.sh > p.sh ? "escudo " + (q.sh === 50 ? "pesado" : "liviano") : "") || "Ya tenés lo mejor que alcanza";
      qb.querySelector(".wp").textContent = q.cost ? fmt(q.cost) : "—"; qb.querySelector(".wp").classList.toggle("cr", !!q.cost); qb.classList.toggle("cant", !q.cost);
    }
    if (bought) { // barrido de luz sobre lo que compraste
      const c = $('#buy [data-buy="' + bought + '"] .sweep');
      if (c && !matchMedia("(prefers-reduced-motion: reduce)").matches) c.animate([{ transform: "translateX(-110%)", opacity: 1 }, { transform: "translateX(110%)", opacity: 0 }], { duration: 280, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
      showInfo(bought);
    }
  }
  $("#act-buy").addEventListener("click", () => { if (!S) return; if (S.phase !== "buy") { alertMsg("Solo en la fase de compra", 900); return; } buyOpen() ? closeBuy() : openBuy(); });
  $("#buy-close").addEventListener("click", () => closeBuy());
  $("#buy").addEventListener("click", (e) => { if (e.target.id === "buy") closeBuy(); }); // tocar el fondo de la tienda también la cierra

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
    if (target === S.p) {
      AU.hurt(); S.cam.shake = Math.min(14, S.cam.shake + 6); buzz(35);
      const hpEl = $("#hud-hp").parentElement; hpEl.classList.remove("hit"); void hpEl.offsetWidth; hpEl.classList.add("hit");
      S.hurt = { t, a: Math.atan2(S.o.y - S.p.y, S.o.x - S.p.x) }; // indicador de dirección del daño
    }
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
    if (p.charges <= 0) { AU.deny(); alertMsg("Sin cargas esta ronda", 900); const b = $("#act-ab"); b.classList.remove("deny"); void b.offsetWidth; b.classList.add("deny"); return; }
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
    const ab = $("#act-ab"); ab.classList.remove("fire"); void ab.offsetWidth; ab.classList.add("fire");
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
  let seqOut = 0;
  function stateMsg() { const p = S.p; return { sc: isHost() ? [M.score.me, M.score.opp] : undefined, q: ++seqOut, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, vx: Math.round(p.vx), vy: Math.round(p.vy), a: Math.round(p.a * 1000) / 1000, hp: p.hp, sh: p.sh, w: p.w, r: p.reloading ? 1 : 0, al: p.alive ? 1 : 0, n: M.roundNo }; }
  function onNet(m) {
    if (!M || !S || M.result) return;
    const t = now();
    if (m.t === "s") {
      M.lastStateAt = t;
      if (window.GC_DEBUG) S.dbgS = (S.dbgS || 0) + 1;
      // autocorrección: si se perdió el aviso de fin de ronda, el marcador del host lo repone
      if (!isHost() && Array.isArray(m.sc) && S.phase === "live") {
        const hs = +m.sc[0] || 0, gs = +m.sc[1] || 0;
        if (hs + gs > M.score.me + M.score.opp) { const w = gs > M.score.me ? "me" : "opp"; applyRoundEnd(w, (w === "me" ? S.rt.hp : S.p.hp) <= 0 ? "kill" : "time"); M.score.me = gs; M.score.opp = hs; M.over = gs >= WIN || hs >= WIN; renderPips(); hud(true); }
      }
      if (m.n && m.n !== M.roundNo) return; // estado de otra ronda
      const rt = S.rt;
      if (m.q && rt.q && m.q <= rt.q && rt.q - m.q < 1000) return; // llegó desordenado: ya tenemos uno más nuevo
      rt.q = m.q || 0;
      rt.x = +m.x; rt.y = +m.y; rt.vx = clamp(+m.vx || 0, -1000, 1000); rt.vy = clamp(+m.vy || 0, -1000, 1000); rt.a = +m.a; rt.t = t; rt.hp = clamp(+m.hp, 0, 100); rt.sh = clamp(+m.sh || 0, 0, 50);
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
    if (input.aim) { const dx = input.aim.x - input.aim.ox, dy = input.aim.y - input.aim.oy; if (Math.hypot(dx, dy) > 16) { p.a = assist(p, Math.atan2(dy, dx), XH.assist()[0]); fire = true; } }
    else if (input.tapFire) { input.tapFire = false; p.a = assist(p, p.a, XH.assist()[1]); if (S.phase === "live") { p.nextShot = Math.min(p.nextShot, t); tryShoot(p, S.o, t, true); } }
    else if (input.mouseScreen) { input.mouse = { x: (input.mouseScreen.x - cw / 2) / zoom + S.cam.x, y: (input.mouseScreen.y - ch / 2) / zoom + S.cam.y }; p.a = Math.atan2(input.mouse.y - p.y, input.mouse.x - p.x); fire = input.firing; }
    if (fire && S.phase === "live") tryShoot(p, S.o, t, true);
    if (p.reloading && t >= p.reloadUntil) { p.ammo = wd.mag; p.reloading = false; }
    // pasos propios (sonido) y ajuste de ruido
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 150 && t - p.stepAt > 300) { p.stepAt = t; AU.step(.5); }
  }
  // asistencia de puntería (solo táctil): si el rival visible está cerca de donde apuntás, la mira se corre hacia él
  function assist(p, a, cone) {
    const o = S.o; if (!cone || !o.alive || !canSee(p, o)) return a;
    const d = Math.hypot(o.x - p.x, o.y - p.y); if (d > 760) return a;
    const ta = Math.atan2(o.y - p.y, o.x - p.x), diff = ((ta - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return Math.abs(diff) < cone ? a + diff * .82 : a;
  }
  // el rival se dibuja donde *debería* estar ahora: última posición + velocidad × tiempo transcurrido (hasta 150 ms)
  function remoteThink(t, dt) {
    const o = S.o, rt = S.rt, k = 1 - Math.exp(-dt * 26);
    const px = o.x, py = o.y, age = clamp((t - rt.t) / 1000, 0, .15);
    let tx = rt.x + (rt.vx || 0) * age, ty = rt.y + (rt.vy || 0) * age;
    const f = { x: tx, y: ty }; collide(f); tx = f.x; ty = f.y;
    if (Math.hypot(tx - o.x, ty - o.y) > 160) { o.x = tx; o.y = ty; } // salto grande (ej. inicio de ronda): ir directo
    else { o.x += (tx - o.x) * k; o.y += (ty - o.y) * k; }
    o.a = turn(o.a, rt.a, dt * 30);
    o.vx = (o.x - px) / Math.max(dt, .001); o.vy = (o.y - py) / Math.max(dt, .001);
    o.hp = rt.hp; o.sh = rt.sh;
  }

  /* ---------- bucle ---------- */
  function loop(t) {
    if (!M || !S) return;
    const dt = Math.min(.034, (t - last) / 1000); last = t;
    if (S.phase === "buy") { const left = Math.ceil((S.phaseEnd - t) / 1000); if (left <= 3 && left >= 1 && left !== S.lastCount) { S.lastCount = left; countdown(left); } }
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
    if (online() && t - (S.sentAt || 0) > (NET.via() === "relay" ? 50 : 30)) { S.sentAt = t; send({ t: "s", ...stateMsg() }); }
    // si no llega movimiento del rival en 8 s (celular bloqueado, sin señal), se resuelve; los "ping" solos no alcanzan
    if (online() && !M.result && !M.leaving && (S.phase === "buy" || S.phase === "live") && (t - M.lastStateAt > 8000 || t - NET.lastRecv() > 10000)) opponentLeft();
    if (!online()) { const b = $("#net-badge"), on = M.bg && NET.searching(); if (b.hidden === on) { b.hidden = !on; b.textContent = "Buscando rival…"; } }
    camera(dt, t); draw(t); drawOverlay(); hud(false);
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
    // en celulares se dibuja a menos resolución: mucho más fluido y casi no se nota
    const touch = isTouch(), cap = touch ? 1.5 : 2, budget = touch ? 1.3e6 : 2.4e6;
    dpr = Math.min(cap, window.devicePixelRatio || 1); if (cw * ch * dpr * dpr > budget) dpr = Math.sqrt(budget / (cw * ch));
    xdpr = Math.min(3, window.devicePixelRatio || 1); xcv.width = Math.round(cw * xdpr); xcv.height = Math.round(ch * xdpr); xbox = null;
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); fog.width = Math.ceil(cv.width / 2); fog.height = Math.ceil(cv.height / 2);
    bgKey = "";
    zoom = ch > cw ? clamp(Math.min(cw / 520, ch / 760), .5, 1.2) : clamp(Math.min(cw / 900, ch / 560), .42, 1.5); // vertical: más cerca, la cámara sigue al jugador
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
  // piso y paredes no cambian: se dibujan una vez en una capa y después solo se copia
  function staticLayer() {
    const sc = clamp(zoom * dpr, .5, 2), key = sc.toFixed(3) + M.side;
    if (key !== bgKey) {
      bgKey = key; bgc.width = Math.ceil(W * sc); bgc.height = Math.ceil(H * sc);
      const keep = ctx; ctx = bctx; ctx.setTransform(sc, 0, 0, sc, 0, 0);
      drawFloor();
      ctx.fillStyle = "rgba(0,0,0,.35)"; for (const [x, y, w, h] of WALLS) ctx.fillRect(x + 6, y + 8, w, h);
      for (const [x, y, w, h] of WALLS) {
        ctx.fillStyle = "#2b3745"; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = "#3e4d5e"; ctx.fillRect(x, y, w, Math.min(5, h));
        ctx.strokeStyle = "rgba(255,70,85,.28)"; ctx.lineWidth = 1.2; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
      }
      ctx = keep;
    }
    ctx.drawImage(bgc, 0, 0, W, H);
  }
  function drawWalls(t) {
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
    const angles = [], seen = new Set();
    for (const sg of segs) { for (const [x, y] of [[sg[0], sg[1]], [sg[2], sg[3]]]) { const k = (x | 0) + "," + (y | 0); if (seen.has(k)) continue; seen.add(k); const a = Math.atan2(y - py, x - px); angles.push(a - .0004, a + .0004); } }
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
    if (!p.alive) { ctx.setTransform(1, 0, 0, 1, 0, 0); return ctx.drawImage(fog, 0, 0, cv.width, cv.height); }
    const sx = (Math.random() - .5) * S.cam.shake * 0, sy = 0;
    const hd = dpr / 2; // la niebla va a media resolución (borde suave y la mitad de trabajo)
    fctx.setTransform(hd * zoom, 0, 0, hd * zoom, hd * (cw / 2 - S.cam.x * zoom + sx), hd * (ch / 2 - S.cam.y * zoom + sy));
    fctx.globalCompositeOperation = "destination-out";
    const poly = visPoly(p.x, p.y);
    fctx.beginPath(); poly.forEach((q, i) => (i ? fctx.lineTo(q[1], q[2]) : fctx.moveTo(q[1], q[2]))); fctx.closePath(); fctx.fill();
    fctx.beginPath(); fctx.arc(p.x, p.y, 34, 0, Math.PI * 2); fctx.fill();
    fctx.globalCompositeOperation = "source-over";
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(fog, 0, 0, cv.width, cv.height);
  }
  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#0a0e13"; ctx.fillRect(0, 0, cv.width, cv.height);
    worldTx(ctx); staticLayer(); drawWalls(t);
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
    if (S.hurt && t - S.hurt.t < 700 && S.p.alive) {
      const k = 1 - (t - S.hurt.t) / 700, r = Math.min(cw, ch) * .36, a = S.hurt.a;
      ctx.strokeStyle = "rgba(255,70,85," + (.85 * k) + ")"; ctx.lineWidth = 7; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(cw / 2, ch / 2, r, a - .32, a + .32); ctx.stroke(); ctx.lineCap = "butt";
    }
    if (S.p.alive && S.p.hp <= 30) { const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * .35, cw / 2, ch / 2, Math.max(cw, ch) * .7); g.addColorStop(0, "rgba(255,70,85,0)"); g.addColorStop(1, "rgba(255,70,85," + (.18 + .08 * Math.sin(t / 180)) + ")"); ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch); }
    if (input) {
      for (const [s, col] of [["move", "rgba(236,232,225,.55)"], ["aim", "rgba(255,70,85,.85)"]]) {
        const k = input[s]; if (!k) continue; const r = cv.getBoundingClientRect();
        const ox = k.ox - r.left, oy = k.oy - r.top; let dx = k.x - k.ox, dy = k.y - k.oy; const d = Math.hypot(dx, dy), max = 52; if (d > max) { dx = dx / d * max; dy = dy / d * max; }
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ox, oy, max, 0, Math.PI * 2); ctx.stroke();
        if (s === "move") { ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.arc(ox, oy, max * .55, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ox + dx, oy + dy, 20, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (!S.p.alive && S.phase === "live") { ctx.fillStyle = "rgba(236,232,225,.85)"; ctx.font = "900 28px 'Big Shoulders Display', Impact, sans-serif"; ctx.textAlign = "center"; ctx.fillText("ELIMINADO", cw / 2, ch * .62); }
    if (S.phase === "buy" && isTouch() && input && !input.move && !input.aim && $("#buy").hidden) {
      ctx.save(); ctx.globalAlpha = .55 + .2 * Math.sin(t / 300); ctx.strokeStyle = "rgba(236,232,225,.5)"; ctx.lineWidth = 2; ctx.setLineDash([5, 6]);
      ctx.beginPath(); ctx.arc(cw * .2, ch * .55, 46, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(cw * .66, ch * .55, 46, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "rgba(236,232,225,.8)"; ctx.font = "700 12px 'JetBrains Mono', monospace"; ctx.textAlign = "center"; ctx.fillText("MOVERTE", cw * .2, ch * .55 + 66); ctx.fillText("APUNTAR · TOCAR = TIRO", cw * .66, ch * .55 + 66); ctx.restore();
    }
    if (S.phase === "buy") { const s = Math.ceil((S.phaseEnd - t) / 1000); if ($("#buy").hidden && s > 3) { ctx.fillStyle = "rgba(242,193,78,.95)"; ctx.font = "900 26px 'Big Shoulders Display', Impact, sans-serif"; ctx.textAlign = "center"; ctx.fillText("COMPRA · " + s + " S", cw / 2, ch * .78); } }
  }

  /* ---------- mira (capa propia) ---------- */
  // apertura real de las balas en pantalla: distancia hasta la mira × ángulo de dispersión actual
  function spreadAngle(f) { const wd = WEAPONS[f.w], sp = Math.hypot(f.vx, f.vy), mv = clamp((sp - 40) / (RUN - 40), 0, 1); return wd.spread + wd.move * mv + (now() - f.lastShot > 320 ? 0 : Math.min(.12, f.spray * wd.spray)); }
  function drawOverlay() {
    if (xbox) { xctx.clearRect(xbox[0] - 2, xbox[1] - 2, xbox[2] + 4, xbox[3] + 4); xbox = null; }
    if (!S || !input || !S.p.alive || S.phase === "end" || !$("#xh-modal").hidden) return;
    const p = S.p, t = now(), hit = t - S.hitmark < 140;
    let x, y, alpha = 1;
    if (input.mouseScreen && !input.move && !input.aim) { if (buyOpen() && document.pointerLockElement !== cv) return; x = input.mouseScreen.x; y = input.mouseScreen.y; }
    else if (isTouch()) { // en celular: la mira va adonde apunta tu arma (hasta la primera pared)
      const dx = Math.cos(p.a), dy = Math.sin(p.a), d = Math.min(230, Math.max(60, blockDist(p.x, p.y, dx, dy) - 4));
      x = (p.x + dx * d - S.cam.x) * zoom + cw / 2; y = (p.y + dy * d - S.cam.y) * zoom + ch / 2; alpha = input.aim ? 1 : .55;
    } else return;
    const ps = { x: (p.x - S.cam.x) * zoom + cw / 2, y: (p.y - S.cam.y) * zoom + ch / 2 };
    const spread = Math.min(70, Math.hypot(x - ps.x, y - ps.y) * Math.tan(spreadAngle(p)));
    xbox = XH.draw(xctx, x * xdpr, y * xdpr, xdpr, spread, alpha, hit);
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
    if (p.reloading) $("#act-reload").style.setProperty("--p", (1 - clamp((p.reloadUntil - t) / wd.reload, 0, 1)).toFixed(3)); else $("#act-reload").style.setProperty("--p", 0);
    const key = [p.hp, p.sh, p.ammo, p.reloading, p.w, p.charges, M.econ.credits, secs, phase, M.score.me, M.score.opp, S.phase].join("|");
    if (!force && key === hudKey) return; hudKey = key;
    $("#hud-hp").textContent = p.hp; $("#hud-hp").parentElement.classList.toggle("low", p.hp <= 30 && p.alive);
    $("#hud-sh").textContent = p.sh; $("#hud-sh").parentElement.style.opacity = p.sh ? 1 : .45;
    $("#hud-cr").textContent = fmt(M.econ.credits);
    if ($("#hud-wname").textContent !== wd.name) { $("#hud-wart").innerHTML = gunSVG(p.w); }
    $("#hud-wname").textContent = wd.name; $("#hud-ammo").textContent = p.reloading ? "—" : p.ammo; $("#hud-ammo").parentElement.classList.toggle("low", !p.reloading && p.ammo <= Math.ceil(wd.mag * .2));
    const maxC = AGENTS[p.agent].ab.charges, ab = $("#act-ab");
    $("#ab-pips").innerHTML = Array.from({ length: maxC }, (_, i) => "<i" + (i < p.charges ? "" : ' class="off"') + "></i>").join("");
    ab.classList.toggle("empty", p.charges <= 0); ab.classList.toggle("ready", p.charges > 0 && S.phase === "live" && p.alive);
    const rl = $("#act-reload"); rl.classList.toggle("on", p.reloading); rl.classList.toggle("need", !p.reloading && p.ammo === 0);
    $("#act-buy").hidden = S.phase !== "buy";
    $("#sb-me").textContent = M.score.me; $("#sb-opp").textContent = M.score.opp;
    $("#sb-time").textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0"); $("#sb-phase").textContent = phase;
    const mid = $(".sb-mid"); mid.classList.toggle("low", S.phase === "live" && secs <= 10);
    if (S.phase === "buy") { $("#buy-time").textContent = secs; if (!$("#buy").hidden) tweenNum($("#buy-cr"), M.econ.credits); }
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
    const k = document.createElement("span"); k.textContent = killer; const wsp = document.createElement("span"); wsp.className = "kw"; wsp.innerHTML = gunSVG(WEAPONS[w] ? w : "classic"); wsp.title = WEAPONS[w] ? WEAPONS[w].name : ""; const v = document.createElement("span"); v.textContent = victim;
    d.append(k, wsp, v); box.prepend(d); while (box.children.length > 4) box.lastChild.remove(); setTimeout(() => d.remove(), 6000);
  }
  function checkRotate() { const r = $("#rotate"); if ($("#game").hidden) return; r.hidden = !(isTouch() && innerHeight > innerWidth && !store.get("gc_rot_ok", false)); }
  $("#rotate-ok").addEventListener("click", () => { store.set("gc_rot_ok", true); $("#rotate").hidden = true; });

  /* ---------- controles ---------- */
  function setupInput() {
    teardownInput();
    input = { keys: new Set(), mouse: null, mouseScreen: null, firing: false, move: null, aim: null, mx: 0, my: 0, walk: false };
    input.kd = (e) => {
      if (e.target.closest && e.target.closest("input")) return;
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "shift", "r", "e", "q", "b", "z", "x"].includes(k)) e.preventDefault();
      if (input.keys.has(k)) return; input.keys.add(k);
      if (k === "q" && S && S.phase === "buy") quickBuy();
      else if (k === "e" || k === "q") useAbility();
      else if (k === "r" && S && S.p.alive) startReload(S.p, now());
      else if (k === "b") $("#act-buy").click();
      else if (BUY_KEYS[k] && S && S.phase === "buy") buy(BUY_KEYS[k]);
      else if (k === "escape" && buyOpen()) closeBuy();
    };
    input.ku = (e) => input.keys.delete(e.key.toLowerCase());
    input.pd = (e) => {
      if (e.target !== cv) return;
      AU.unlock();
      if (e.pointerType === "mouse") {
        if (XH.get().lk && document.pointerLockElement !== cv && cv.requestPointerLock) lockMouse();
        if (!input.mouseScreen) { const r = cv.getBoundingClientRect(); input.mouseScreen = { x: e.clientX - r.left, y: e.clientY - r.top }; }
        input.firing = e.button === 0; if (e.button === 2) useAbility(); return;
      }
      e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      const side = e.clientX < innerWidth / 2 ? "move" : "aim";
      if (input[side]) return;
      input[side] = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, t0: now() };
      if (!$("#buy").hidden) closeBuy();
    };
    input.pm = (e) => {
      if (e.pointerType === "mouse") { mouseAt(e); return; }
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
    // el mouse se lee con "pointerrawupdate" (llega antes que pointermove) y la mira se redibuja en el acto
    input.raw = (e) => { if (e.pointerType === "mouse") mouseAt(e); };
    if ("onpointerrawupdate" in window) window.addEventListener("pointerrawupdate", input.raw);
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
    window.removeEventListener("pointerrawupdate", input.raw);
    try { if (document.pointerLockElement === cv) document.exitPointerLock(); } catch (e) {}
    xctx.clearRect(0, 0, xcv.width, xcv.height); xbox = null;
    window.removeEventListener("pointerup", input.pu); window.removeEventListener("pointercancel", input.pu);
    window.removeEventListener("resize", resize); window.removeEventListener("orientationchange", resize);
    input = null;
  }
  // posición del mouse en pantalla: libre (1:1 con el sistema) o bloqueado (movimiento crudo × sensibilidad)
  function mouseAt(e) {
    if (!input) return;
    if (document.pointerLockElement === cv) {
      const m = input.mouseScreen || { x: cw / 2, y: ch / 2 }, sn = XH.get().sn;
      input.mouseScreen = { x: clamp(m.x + (e.movementX || 0) * sn, 0, cw), y: clamp(m.y + (e.movementY || 0) * sn, 0, ch) };
    } else { const r = cv.getBoundingClientRect(); input.mouseScreen = { x: e.clientX - r.left, y: e.clientY - r.top }; }
    if (S) drawOverlay();
  }
  function lockMouse() {
    try {
      const p = cv.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { const q = cv.requestPointerLock(); q && q.catch && q.catch(() => {}); } catch (e) {} });
    } catch (e) { try { cv.requestPointerLock(); } catch (er) {} }
  }
  function tapFx(el) { el.classList.remove("tap"); void el.offsetWidth; el.classList.add("tap"); setTimeout(() => el.classList.remove("tap"), 360); buzz(12); }
  $("#act-ab").addEventListener("pointerdown", (e) => { e.preventDefault(); tapFx(e.currentTarget); useAbility(); });
  $("#act-reload").addEventListener("pointerdown", (e) => { e.preventDefault(); tapFx(e.currentTarget); if (S && S.p.alive) startReload(S.p, now()); });
  $("#act-buy").addEventListener("pointerdown", (e) => tapFx(e.currentTarget));
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
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (M && online() && !M.result) M.hiddenAt = now(); return; }
    if (input) { input.keys.clear(); input.firing = false; }
    if (M && online() && !M.result && M.hiddenAt) {
      const away = now() - M.hiddenAt; M.hiddenAt = 0;
      if (M.lastStateAt) M.lastStateAt = Math.max(M.lastStateAt, now() - 2000); // no culpar al rival por nuestra pausa
      if (away > 6000) { // saliste de la partida mucho tiempo: cuenta como que te fuiste
        M.result = { won: false }; submit(false, false, true);
        noResultLeft("Saliste de la partida más de 6 segundos.");
      }
    }
  });
  function noResultLeft(why) {
    if (S) S.phase = "end"; setTimeout(() => NET.close(), 400);
    const end = $("#end"); end.hidden = false; end.className = "end lose";
    $("#end-kicker").textContent = "Derrota por desconexión"; $("#end-title").textContent = "Derrota";
    $("#end-me").textContent = M.score.me; $("#end-opp").textContent = M.score.opp; $("#end-vs").textContent = why;
    $("#end-stats").innerHTML = ""; $("#end-pts").textContent = "Mantené el juego abierto hasta terminar.";
    $("#end-rematch").hidden = true; $("#end-rematch-btn").hidden = true; $("#end-again").textContent = "Nuevo rival";
  }

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
