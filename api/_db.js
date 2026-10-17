// Conexión a Upstash Redis por REST (sin dependencias).
// Vercel la configura sola al conectar "Upstash for Redis" desde Storage.
const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const RANK = "gc:rank"; // ranking del Duelo 1v1

export const ready = () => Boolean(URL && TOKEN);

export async function pipeline(cmds) {
  if (!ready()) throw Object.assign(new Error("no_db"), { status: 503 });
  const r = await fetch(URL.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw Object.assign(new Error("db_http_" + r.status), { status: 502 });
  const out = await r.json();
  return out.map((x) => {
    if (x.error) throw Object.assign(new Error(x.error), { status: 502 });
    return x.result;
  });
}

export const toObj = (arr) => {
  const o = {};
  for (let i = 0; arr && i < arr.length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
};

export function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

export function fail(res, e) {
  send(res, e.status || 500, { ok: false, error: e.message === "no_db" ? "Falta conectar la base de datos (Upstash Redis) en Vercel." : "Error del servidor" });
}

export const num = (v) => Number(v || 0);
export function stats(p) {
  return {
    total: num(p.total), ptsOnline: num(p.pts_online), ptsBot: num(p.pts_bot) + num(p.best_bot),
    wins: num(p.wins), losses: num(p.losses), roundsWon: num(p.rounds_won), roundsLost: num(p.rounds_lost),
    kills: num(p.kills), matches: num(p.matches), onlineMatches: num(p.online_matches),
  };
}
