import { pipeline, toObj, send, fail, ready, RANK, stats } from "./_db.js";

export default async function handler(req, res) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return send(res, 503, { ok: false, error: "Configurá ADMIN_KEY en el servidor para habilitar el panel." });
  const key = req.headers["x-admin-key"];
  if (key !== adminKey) return send(res, 401, { ok: false, error: "Clave incorrecta" });
  if (!ready()) return send(res, 503, { ok: false, error: "Falta conectar la base de datos (Upstash Redis) en Vercel." });
  try {
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      if (b.action === "reset" && b.confirm === "BORRAR") {
        const [a1, a2] = await pipeline([["ZRANGE", RANK, "0", "-1"], ["ZRANGE", "gc:total", "0", "-1"]]);
        const ids = [...new Set([...(a1 || []), ...(a2 || [])])];
        const igs = ids.length ? await pipeline(ids.map((id) => ["HGET", "gc:p:" + id, "ig"])) : [];
        await pipeline([...ids.map((id) => ["DEL", "gc:p:" + id]), ...ids.map((id) => ["DEL", "gc:h:" + id]), ...igs.filter(Boolean).map((ig) => ["DEL", "gc:ig:" + ig]), ["DEL", RANK], ["DEL", "gc:total"], ["DEL", "gc:log"]]);
        return send(res, 200, { ok: true, deleted: ids.length });
      }
      if (b.action === "remove" && b.pid) {
        const pid = String(b.pid).replace(/[^a-zA-Z0-9-]/g, "");
        const [ig] = await pipeline([["HGET", "gc:p:" + pid, "ig"]]);
        await pipeline([["DEL", "gc:p:" + pid], ["DEL", "gc:h:" + pid], ["ZREM", RANK, pid], ["ZREM", "gc:total", pid], ...(ig ? [["DEL", "gc:ig:" + ig]] : [])]);
        return send(res, 200, { ok: true });
      }
      return send(res, 400, { ok: false, error: "Acción inválida" });
    }
    const [z, log] = await pipeline([["ZREVRANGE", RANK, "0", "999", "WITHSCORES"], ["LRANGE", "gc:log", "0", "29"]]);
    const ids = [];
    for (let i = 0; i < z.length; i += 2) ids.push(z[i]);
    const rows = ids.length ? await pipeline(ids.map((id) => ["HGETALL", "gc:p:" + id])) : [];
    const players = rows.map((r, i) => {
      const p = toObj(r);
      return { pid: ids[i], tag: ids[i].slice(-4), nick: p.nick || "?", ig: p.ig || "", created: Number(p.created || 0), last: Number(p.last || 0), ...stats(p) };
    });
    send(res, 200, { ok: true, players, recent: log.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((l) => l && l.mode) });
  } catch (e) {
    fail(res, e);
  }
}
