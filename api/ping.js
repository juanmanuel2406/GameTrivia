import { pipeline, send, ready } from "./_db.js";

// Diagnóstico: en qué región corre el servidor y cuánto tarda en hablar con la base de datos.
export default async function handler(req, res) {
  const region = process.env.VERCEL_REGION || "local";
  if (!ready()) return send(res, 200, { ok: true, region, db: null });
  const t = Date.now();
  try { await pipeline([["PING"]]); } catch (e) { return send(res, 200, { ok: true, region, db: null }); }
  const t2 = Date.now(); await pipeline([["PING"]]);
  send(res, 200, { ok: true, region, dbMs: Math.round((Date.now() - t2 + (t2 - t)) / 2) });
}
