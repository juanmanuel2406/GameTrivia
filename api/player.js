import { createHash } from "node:crypto";
import { pipeline, toObj, send, fail, RANK, stats } from "./_db.js";

const cleanPid = (v) => String(v || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
const cleanIg = (v) => String(v || "").trim().toLowerCase().replace(/^@+/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "");
const cleanNick = (v) => String(v || "").replace(/[<>]/g, "").trim().toUpperCase().slice(0, 14);
const hashPin = (ig, pin) => createHash("sha256").update("gc26|" + ig + "|" + pin).digest("hex");

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const pid = cleanPid(req.query && req.query.pid);
      if (pid.length < 8) return send(res, 400, { ok: false, error: "Falta el jugador" });
      const [raw, hist, rank, count] = await pipeline([
        ["HGETALL", "gc:p:" + pid], ["LRANGE", "gc:h:" + pid, "0", "29"], ["ZREVRANK", RANK, pid], ["ZCARD", RANK],
      ]);
      const p = toObj(raw);
      if (!p.nick) return send(res, 404, { ok: false, error: "No encontramos tu registro" });
      return send(res, 200, {
        ok: true, nick: p.nick, ig: p.ig || "", ...stats(p),
        rank: rank == null ? null : Number(rank) + 1, players: Number(count),
        history: hist.map((h) => { try { return JSON.parse(h); } catch { return null; } }).filter((h) => h && h.mode),
      });
    }
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "Método no permitido" });
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const ig = cleanIg(b.ig), pin = String(b.pin || "");
    if (!/^[a-z0-9._]{1,30}$/.test(ig)) return send(res, 400, { ok: false, error: "Usuario de Instagram inválido" });
    if (!/^\d{4}$/.test(pin)) return send(res, 400, { ok: false, error: "El PIN tiene que ser de 4 números" });

    if (b.action === "register") {
      const pid = cleanPid(b.pid), nick = cleanNick(b.nick);
      if (pid.length < 8 || !nick) return send(res, 400, { ok: false, error: "Falta el apodo" });
      const [existing] = await pipeline([["GET", "gc:ig:" + ig]]);
      if (existing && existing !== pid) return send(res, 409, { ok: false, error: "Ese Instagram ya está registrado. Entrá con tu PIN.", code: "taken" });
      const now = String(Date.now());
      await pipeline([
        ["SET", "gc:ig:" + ig, pid],
        ["HSET", "gc:p:" + pid, "nick", nick, "ig", ig, "pinh", hashPin(ig, pin), "follows", "1", "registered", now],
        ["HSETNX", "gc:p:" + pid, "created", now],
        ["HSETNX", "gc:p:" + pid, "total", "0"],
        ["ZADD", RANK, "NX", "0", pid],
      ]);
      return send(res, 200, { ok: true, pid, nick, ig });
    }
    if (b.action === "login") {
      const [pid] = await pipeline([["GET", "gc:ig:" + ig]]);
      if (!pid) return send(res, 404, { ok: false, error: "No hay ninguna cuenta con ese Instagram" });
      const [pinh, nick] = await pipeline([["HGET", "gc:p:" + pid, "pinh"], ["HGET", "gc:p:" + pid, "nick"]]);
      if (pinh !== hashPin(ig, pin)) return send(res, 401, { ok: false, error: "PIN incorrecto" });
      return send(res, 200, { ok: true, pid, nick, ig });
    }
    send(res, 400, { ok: false, error: "Acción inválida" });
  } catch (e) {
    fail(res, e);
  }
}
