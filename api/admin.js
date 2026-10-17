import { pipeline, toObj, send, fail, ready, GAMES } from "./_db.js";

const ADMIN_KEY = process.env.ADMIN_KEY || "gamingcity2026";

export default async function handler(req, res) {
  const key = req.headers["x-admin-key"] || (req.query && req.query.key);
  if (key !== ADMIN_KEY) return send(res, 401, { ok: false, error: "Clave incorrecta" });
  if (!ready()) return send(res, 503, { ok: false, error: "Falta conectar la base de datos (Upstash Redis) en Vercel." });
  try {
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      if (b.action === "reset" && b.confirm === "BORRAR") {
        const [ids] = await pipeline([["ZRANGE", "gc:total", "0", "-1"]]);
        const igs = ids.length ? await pipeline(ids.map((id) => ["HGET", "gc:p:" + id, "ig"])) : [];
        await pipeline([...ids.map((id) => ["DEL", "gc:p:" + id]), ...ids.map((id) => ["DEL", "gc:h:" + id]), ...igs.filter(Boolean).map((ig) => ["DEL", "gc:ig:" + ig]), ["DEL", "gc:total"], ["DEL", "gc:log"]]);
        return send(res, 200, { ok: true, deleted: ids.length });
      }
      if (b.action === "remove" && b.pid) {
        const pid = String(b.pid).replace(/[^a-zA-Z0-9-]/g, "");
        const [ig] = await pipeline([["HGET", "gc:p:" + pid, "ig"]]);
        await pipeline([["DEL", "gc:p:" + pid], ["DEL", "gc:h:" + pid], ["ZREM", "gc:total", pid], ...(ig ? [["DEL", "gc:ig:" + ig]] : [])]);
        return send(res, 200, { ok: true });
      }
      return send(res, 400, { ok: false, error: "Acción inválida" });
    }
    const [z, log] = await pipeline([["ZREVRANGE", "gc:total", "0", "999", "WITHSCORES"], ["LRANGE", "gc:log", "0", "29"]]);
    const ids = [];
    for (let i = 0; i < z.length; i += 2) ids.push(z[i]);
    const rows = ids.length ? await pipeline(ids.map((id) => ["HGETALL", "gc:p:" + id])) : [];
    const players = rows.map((r, i) => {
      const p = toObj(r);
      const best = {}, detail = {};
      GAMES.forEach((g) => { if (p["best_" + g] != null) { best[g] = Number(p["best_" + g]); detail[g] = p["detail_" + g] || ""; } });
      return { pid: ids[i], tag: ids[i].slice(-4), nick: p.nick || "?", ig: p.ig || "", total: Number(p.total || 0), plays: Number(p.plays || 0), created: Number(p.created || 0), last: Number(p.last || 0), best, detail };
    });
    send(res, 200, { ok: true, players, recent: log.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) });
  } catch (e) {
    fail(res, e);
  }
}
