// Conexión a Upstash Redis por REST (sin dependencias).
// Vercel la configura sola al conectar "Upstash for Redis" desde Storage.
const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const GAMES = ["duel", "trivia", "agent", "aim", "react"];
// Puntaje máximo posible por juego: lo que supere esto se rechaza.
export const MAX = { duel: 15400, trivia: 19000, agent: 8000, aim: 14000, react: 1200 };

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
