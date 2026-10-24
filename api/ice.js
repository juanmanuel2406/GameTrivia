// Dedicated TURN credentials remain on the server; HTTP relay is the fallback.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Usá GET" });
  const servers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
  const cfId = process.env.CF_TURN_KEY_ID, cfTok = process.env.CF_TURN_KEY_API_TOKEN;
  const mApp = process.env.METERED_APP, mKey = process.env.METERED_API_KEY;
  const add = (ice) => (Array.isArray(ice) ? ice : [ice]).filter(s => s && s.urls && s.username && s.credential).forEach(s => servers.push(s));
  await Promise.allSettled([
    (async () => {
      if (!cfId || !cfTok) return;
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cfId)}/credentials/generate-ice-servers`, {
        method: "POST", headers: { Authorization: "Bearer " + cfTok, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 3600 }), signal: AbortSignal.timeout(3500),
      });
      if (r.ok) add((await r.json()).iceServers);
    })(),
    (async () => {
      if (!mApp || !mKey || !/^[a-zA-Z0-9-]+$/.test(mApp)) return;
      const r = await fetch(`https://${mApp}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(mKey)}`, { signal: AbortSignal.timeout(3500) });
      if (r.ok) add(await r.json());
    })(),
  ]);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.status(200).json({ ok: true, iceServers: servers, turnConfigured: servers.length > 1 });
}
