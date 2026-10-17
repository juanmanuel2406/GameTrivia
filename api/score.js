import { pipeline, toObj, send, fail, GAMES, MAX } from "./_db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "Usá POST" });
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const pid = String(b.pid || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
    const nick = String(b.nick || "").replace(/[<>]/g, "").trim().toUpperCase().slice(0, 14);
    const game = String(b.game || "");
    const score = Math.round(Number(b.score));
    const detail = String(b.detail || "").replace(/[<>]/g, "").slice(0, 80);
    if (pid.length < 8 || !nick || !GAMES.includes(game) || !Number.isFinite(score) || score < 0 || score > MAX[game]) {
      return send(res, 400, { ok: false, error: "Datos inválidos" });
    }
    const key = "gc:p:" + pid;
    const [raw] = await pipeline([["HGETALL", key]]);
    const p = toObj(raw);
    const prev = p["best_" + game] != null ? Number(p["best_" + game]) : -1;
    const improved = score > prev;
    if (improved) p["best_" + game] = String(score);
    const total = GAMES.reduce((s, g) => s + (p["best_" + g] ? Number(p["best_" + g]) : 0), 0);
    const now = Date.now();
    const fields = ["nick", p.nick || nick, "last", String(now), "total", String(total)];
    if (!p.created) fields.push("created", String(now));
    if (improved) fields.push("best_" + game, String(score), "detail_" + game, detail);
    const r = await pipeline([
      ["HSET", key, ...fields],
      ["HINCRBY", key, "plays", "1"],
      ["ZADD", "gc:total", String(total), pid],
      ["LPUSH", "gc:log", JSON.stringify({ pid, nick, game, score, detail, t: now })],
      ["LPUSH", "gc:h:" + pid, JSON.stringify({ game, score, detail, t: now })],
      ["LTRIM", "gc:h:" + pid, "0", "49"],
      ["LTRIM", "gc:log", "0", "999"],
      ["ZREVRANK", "gc:total", pid],
      ["ZCARD", "gc:total"],
    ]);
    send(res, 200, { ok: true, total, improved, best: improved ? score : prev, rank: Number(r[7]) + 1, players: Number(r[8]) });
  } catch (e) {
    fail(res, e);
  }
}
