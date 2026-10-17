import { pipeline, send, fail, RANK } from "./_db.js";

// Ranking público: apodo, puntos y victorias (top 10).
export default async function handler(req, res) {
  try {
    const [z, count] = await pipeline([["ZREVRANGE", RANK, "0", "9", "WITHSCORES"], ["ZCARD", RANK]]);
    const ids = [], totals = [];
    for (let i = 0; i < z.length; i += 2) { ids.push(z[i]); totals.push(Number(z[i + 1])); }
    const info = ids.length ? await pipeline(ids.map((id) => ["HMGET", "gc:p:" + id, "nick", "wins", "matches"])) : [];
    send(res, 200, {
      ok: true, players: Number(count),
      top: ids.map((id, i) => ({ nick: (info[i] && info[i][0]) || "?", total: totals[i], wins: Number((info[i] && info[i][1]) || 0), matches: Number((info[i] && info[i][2]) || 0), tag: id.slice(-4) })),
    });
  } catch (e) {
    fail(res, e);
  }
}
