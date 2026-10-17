import { pipeline, send, fail } from "./_db.js";

// Ranking público: solo apodo y puntaje total (top 10).
export default async function handler(req, res) {
  try {
    const [z, count] = await pipeline([["ZREVRANGE", "gc:total", "0", "9", "WITHSCORES"], ["ZCARD", "gc:total"]]);
    const ids = [], totals = [];
    for (let i = 0; i < z.length; i += 2) { ids.push(z[i]); totals.push(Number(z[i + 1])); }
    const nicks = ids.length ? await pipeline(ids.map((id) => ["HGET", "gc:p:" + id, "nick"])) : [];
    send(res, 200, { ok: true, players: Number(count), top: ids.map((id, i) => ({ nick: nicks[i] || "?", total: totals[i], tag: id.slice(-4) })) });
  } catch (e) {
    fail(res, e);
  }
}
