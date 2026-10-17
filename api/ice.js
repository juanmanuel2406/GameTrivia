import { createHmac } from "node:crypto";

// Servidores para conectar dos celulares (WebRTC).
// STUN: descubre la dirección pública. TURN: retransmite cuando la red bloquea la conexión directa.
// Opcional en Vercel: CF_TURN_KEY_ID + CF_TURN_KEY_API_TOKEN (Cloudflare) o METERED_APP + METERED_API_KEY (Metered).
export default async function handler(req, res) {
  const servers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];

  const cfId = process.env.CF_TURN_KEY_ID, cfTok = process.env.CF_TURN_KEY_API_TOKEN;
  if (cfId && cfTok) {
    for (const path of ["generate-ice-servers", "generate"]) {
      try {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${cfId}/credentials/${path}`, {
          method: "POST", headers: { Authorization: "Bearer " + cfTok, "Content-Type": "application/json" }, body: JSON.stringify({ ttl: 86400 }),
        });
        if (!r.ok) continue;
        const j = await r.json();
        const ice = Array.isArray(j.iceServers) ? j.iceServers : [j.iceServers];
        ice.filter((s) => s && s.username).forEach((s) => servers.push(s));
        break;
      } catch {}
    }
  }

  const mApp = process.env.METERED_APP, mKey = process.env.METERED_API_KEY;
  if (mApp && mKey) {
    try {
      const r = await fetch(`https://${mApp}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(mKey)}`);
      if (r.ok) (await r.json()).filter((s) => s && s.username).slice(0, 2).forEach((s) => servers.push(s));
    } catch {}
  }

  // Open Relay (gratis, sin cuenta): credencial temporal firmada con su secreto público.
  const username = Math.floor(Date.now() / 1000 + 86400) + ":gamingcity";
  const credential = createHmac("sha1", "openrelayprojectsecret").update(username).digest("base64");
  servers.push({
    urls: [
      "turn:staticauth.openrelay.metered.ca:80",
      "turn:staticauth.openrelay.metered.ca:443?transport=tcp",
      "turns:staticauth.openrelay.metered.ca:443?transport=tcp",
    ],
    username, credential,
  });

  res.setHeader("Cache-Control", "public, max-age=900");
  res.status(200).json({ ok: true, iceServers: servers });
}
