import { pipeline, send, fail } from "./_db.js";

// Emparejamiento para el Duelo 1v1 online.
// Cada jugador que busca rival llama a "poll" cada ~1,5 s con su id de conexión (peer).
// El primero queda esperando (host); el siguiente lo encuentra y se conecta a él (guest).
const clean = (v, n = 60) => String(v || "").replace(/[^a-zA-Z0-9-_]/g, "").slice(0, n);

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "Usá POST" });
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const pid = clean(b.pid, 40), peer = clean(b.peer), nick = String(b.nick || "").replace(/[<>]/g, "").toUpperCase().slice(0, 14);
    if (pid.length < 8) return send(res, 400, { ok: false, error: "Datos inválidos" });
    const now = Date.now();

    // Señalización WebRTC: guarda la oferta / respuesta de cada sala por 90 s
    const room = clean(b.room), kind = b.kind === "offer" || b.kind === "answer" ? b.kind : "";
    if (b.action === "signal") {
      const sdp = String(b.sdp || "");
      if (!room || !kind || !sdp || sdp.length > 20000) return send(res, 400, { ok: false, error: "Datos inválidos" });
      await pipeline([["SET", "gc:sig:" + room + ":" + kind, sdp, "EX", "90"]]);
      return send(res, 200, { ok: true });
    }
    if (b.action === "wait") {
      if (!room || !kind) return send(res, 400, { ok: false, error: "Datos inválidos" });
      const [sdp] = await pipeline([["GET", "gc:sig:" + room + ":" + kind]]);
      return send(res, 200, { ok: true, sdp: sdp || null });
    }
    // Retransmisión por el servidor: plan B cuando la conexión directa no es posible
    if (b.action === "relay") {
      const role = b.role === "h" ? "h" : b.role === "g" ? "g" : "";
      if (!room || !role) return send(res, 400, { ok: false, error: "Datos inválidos" });
      const msgs = (Array.isArray(b.msgs) ? b.msgs : []).slice(0, 60).map((m) => JSON.stringify(m)).filter((m) => m.length < 600);
      const mine = "gc:rl:" + room + ":" + role, theirs = "gc:rl:" + room + ":" + (role === "h" ? "g" : "h");
      const cmds = [];
      if (msgs.length) cmds.push(["RPUSH", mine, ...msgs], ["EXPIRE", mine, "120"]);
      cmds.push(["LPOP", theirs, "200"]);
      const r = await pipeline(cmds);
      const got = r[r.length - 1];
      return send(res, 200, { ok: true, msgs: (Array.isArray(got) ? got : got ? [got] : []).map((m) => { try { return JSON.parse(m); } catch { return null; } }).filter(Boolean) });
    }

    if (b.action === "leave") {
      await pipeline([["DEL", "gc:mq:alive:" + pid], ["ZREM", "gc:mq:online", pid]]);
      return send(res, 200, { ok: true });
    }
    if (b.action !== "poll" || !peer) return send(res, 400, { ok: false, error: "Datos inválidos" });

    const me = JSON.stringify({ pid, peer, nick, t: now });
    const [, mm] = await pipeline([
      ["SET", "gc:mq:alive:" + pid, peer, "EX", "6"],
      ["GET", "gc:mq:mm:" + peer],
      ["ZADD", "gc:mq:online", String(now), pid],
      ["ZREMRANGEBYSCORE", "gc:mq:online", "0", String(now - 8000)],
    ]);
    if (mm) {
      await pipeline([["DEL", "gc:mq:mm:" + peer], ["DEL", "gc:mq:alive:" + pid], ["ZREM", "gc:mq:online", pid]]);
      return send(res, 200, { ok: true, status: "matched", ...JSON.parse(mm) });
    }
    // Buscar a alguien esperando
    for (let i = 0; i < 6; i++) {
      const [raw] = await pipeline([["LPOP", "gc:mq:queue"]]);
      if (!raw) break;
      let e; try { e = JSON.parse(raw); } catch { continue; }
      if (e.pid === pid) continue;
      const [alive, taken] = await pipeline([["GET", "gc:mq:alive:" + e.pid], ["GET", "gc:mq:mm:" + e.peer]]);
      if (alive !== e.peer || taken) continue;
      // Reservar: SET NX para que dos personas no tomen al mismo host
      const [ok] = await pipeline([["SET", "gc:mq:mm:" + e.peer, JSON.stringify({ role: "host", opp: { pid, peer, nick } }), "NX", "EX", "30"]]);
      if (ok !== "OK") continue;
      await pipeline([["DEL", "gc:mq:alive:" + pid], ["ZREM", "gc:mq:online", pid], ["ZREM", "gc:mq:online", e.pid]]);
      return send(res, 200, { ok: true, status: "matched", role: "guest", opp: { pid: e.pid, peer: e.peer, nick: e.nick } });
    }
    // Nadie esperando: anotarme (una vez cada pocos segundos)
    const [fresh] = await pipeline([["SET", "gc:mq:inq:" + pid, "1", "NX", "EX", "4"]]);
    const cmds = [["ZCARD", "gc:mq:online"]];
    if (fresh === "OK") cmds.unshift(["RPUSH", "gc:mq:queue", me], ["LTRIM", "gc:mq:queue", "-200", "-1"]);
    const r = await pipeline(cmds);
    send(res, 200, { ok: true, status: "waiting", searching: Number(r[r.length - 1]) });
  } catch (e) {
    fail(res, e);
  }
}
