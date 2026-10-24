import { pipeline, send, fail, RANK } from "./_db.js";

// Ranking público: apodo, puntos y victorias (top 10).
export default async function handler(req, res) {
  try {
    // solo aparecen quienes jugaron al menos una partida (sin filas vacías ni repetidas)
    const [z, count] = await pipeline([["ZREVRANGE", RANK, "0", "39", "WITHSCORES"], ["ZCARD", RANK]]);
    const ids = [], totals = [];
    for (let i = 0; i < z.length; i += 2) { ids.push(z[i]); totals.push(Number(z[i + 1])); }
    const info = ids.length ? await pipeline(ids.map((id) => ["HMGET", "gc:p:" + id, "nick", "wins", "matches", "ig"])) : [];
    const seen = new Set(), top = [];
    ids.forEach((id, i) => {
      const [nick, wins, matches, ig] = info[i] || [];
      if (!Number(matches || 0)) return;
      const k = ig || id; if (seen.has(k)) return; seen.add(k);
      top.push({ nick: nick || "?", total: totals[i], wins: Number(wins || 0), matches: Number(matches || 0), tag: id.slice(-4) });
    });
    send(res, 200, { ok: true, players: Number(count), top: top.slice(0, 10) });
  } catch (e) {
    fail(res, e);
  }
}
