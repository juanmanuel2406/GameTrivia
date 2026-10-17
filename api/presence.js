import { pipeline, send, fail } from "./_db.js";

// Quién está en la página ahora: conectados, buscando rival y jugando.
// Cada celular avisa cada ~15 s; se cuenta a los que avisaron en los últimos 40 s.
const STATES = ["lobby", "searching", "playing"];
export default async function handler(req, res) {
  try {
    const t = Date.now();
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const pid = String(b.pid || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
      const state = STATES.includes(b.state) ? b.state : "lobby";
      if (pid.length >= 8) await pipeline([["ZADD", "gc:on", String(t), pid], ["HSET", "gc:onst", pid, state]]);
    }
    const [, ids] = await pipeline([["ZREMRANGEBYSCORE", "gc:on", "0", String(t - 40000)], ["ZRANGEBYSCORE", "gc:on", String(t - 40000), "+inf"]]);
    const st = ids.length ? (await pipeline([["HMGET", "gc:onst", ...ids]]))[0] : [];
    const c = { online: ids.length, searching: 0, playing: 0 };
    st.forEach((s) => { if (s === "searching") c.searching++; else if (s === "playing") c.playing++; });
    send(res, 200, { ok: true, ...c });
  } catch (e) {
    fail(res, e);
  }
}
