import { pipeline, toObj, send, fail, RANK, num } from "./_db.js";

// Resultado de un Duelo 1v1. Los puntos se calculan acá, no en el celular.
// Online: victoria 100 (50 si el rival abandona) + 10 por ronda ganada. Derrota: 10 por ronda ganada.
// Bot: solo cuenta la mejor partida contra el bot (Hierro 20, Oro 40, Radiante 70 al ganar, + 2 por ronda).
const BOT = { hierro: 20, oro: 40, radiante: 70 };
const WIN = 7;
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const txt = (v, n) => String(v || "").replace(/[<>]/g, "").trim().slice(0, n);

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "Usá POST" });
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const pid = String(b.pid || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
    const nick = txt(b.nick, 14).toUpperCase();
    const mode = b.mode === "online" ? "online" : "bot";
    const won = !!b.won, forfeit = !!b.forfeit;
    const rw = int(b.rw, 0, WIN), rl = int(b.rl, 0, WIN), kills = int(b.kills, 0, 40);
    const diff = BOT[b.diff] ? b.diff : "oro";
    if (pid.length < 8 || !nick) return send(res, 400, { ok: false, error: "Datos inválidos" });
    if (won && !forfeit && rw < WIN) return send(res, 400, { ok: false, error: "Resultado inválido" });
    if (!won && rw >= WIN) return send(res, 400, { ok: false, error: "Resultado inválido" });

    const pts = mode === "online" ? (won ? (forfeit ? 50 : 100) : 0) + 10 * rw : (won ? BOT[diff] : 0) + 2 * rw;
    const key = "gc:p:" + pid;
    const [raw] = await pipeline([["HGETALL", key]]);
    const p = toObj(raw);
    const ptsOnline = num(p.pts_online) + (mode === "online" ? pts : 0);
    const bestBot = Math.max(num(p.best_bot), mode === "bot" ? pts : 0);
    const total = ptsOnline + bestBot;
    const now = Date.now();
    const entry = JSON.stringify({ mode, won, forfeit, rw, rl, kills, pts, diff: mode === "bot" ? diff : "", opp: txt(b.opp, 14).toUpperCase(), agent: txt(b.agent, 12), t: now });
    const fields = ["nick", p.nick || nick, "last", String(now), "total", String(total), "pts_online", String(ptsOnline), "best_bot", String(bestBot)];
    if (!p.created) fields.push("created", String(now));
    const r = await pipeline([
      ["HSET", key, ...fields],
      ["HINCRBY", key, "matches", "1"],
      ["HINCRBY", key, won ? "wins" : "losses", "1"],
      ["HINCRBY", key, "rounds_won", String(rw)],
      ["HINCRBY", key, "rounds_lost", String(rl)],
      ["HINCRBY", key, "kills", String(kills)],
      ["HINCRBY", key, "online_matches", mode === "online" ? "1" : "0"],
      ["ZADD", RANK, String(total), pid],
      ["LPUSH", "gc:log", JSON.stringify({ pid, nick: p.nick || nick, ...JSON.parse(entry) })],
      ["LTRIM", "gc:log", "0", "999"],
      ["LPUSH", "gc:h:" + pid, entry],
      ["LTRIM", "gc:h:" + pid, "0", "49"],
      ["ZREVRANK", RANK, pid],
      ["ZCARD", RANK],
    ]);
    send(res, 200, { ok: true, pts, total, rank: Number(r[12]) + 1, players: Number(r[13]) });
  } catch (e) {
    fail(res, e);
  }
}
