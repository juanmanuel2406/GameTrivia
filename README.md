# Gaming City · Duelo 1v1

Duelo 1v1 online estilo Valorant para el evento de Gaming City. Es un sitio estático (`index.html`, `style.css`, `app.js`) con funciones en `/api` para Vercel. No tiene build ni dependencias.

## El juego
- **4 agentes**, con una habilidad cada uno: Ráfaga (dash), Niebla (humo), Bastión (muro) y Pulso (radar).
- **Fase de compra** en cada ronda, con créditos al estilo Valorant: Classic, Sheriff, Spectre, Vandal, Operator, escudo liviano y escudo pesado. Si sobrevivís, conservás arma y escudo.
- **Primero a 7 rondas.** A las 6 rondas se cambia de lado y se reinician los créditos. Con 6–6 se juega una ronda decisiva con 5000 créditos.
- **Niebla de guerra:** solo ves al rival si hay línea de visión (paredes, muros y humos la cortan). Si el rival corre, se ven sus pasos.
- Controles para celular (dos pulgares) y para compu (WASD + mouse).
- **Práctica contra bot** en Hierro, Oro o Radiante.

## Online
Empareja a dos personas que estén buscando rival al mismo tiempo, desde cualquier red:
1. **Conexión directa** entre los dos dispositivos (WebRTC). La señalización pasa por `/api/match` y Upstash.
2. **TURN** (`/api/ice`) para redes que bloquean la conexión directa. Opcional: `CF_TURN_KEY_ID` + `CF_TURN_KEY_API_TOKEN` (Cloudflare) o `METERED_APP` + `METERED_API_KEY`.
3. **Plan B por el servidor:** si no hay conexión directa, o si se corta en medio de la partida, el juego sigue retransmitido por `/api/match`.

## Registro, ranking y panel
- Primera visita: cartel para seguir a **@gamingcitycomputacion** y **@gamingcitybelgrano**. Después el jugador se registra con apodo, Instagram y un PIN.
- **Puntos:** una victoria online da 100 + 10 por ronda ganada; una derrota online da 10 por ronda ganada. Contra el bot cuenta solo la mejor partida (Hierro 20, Oro 40, Radiante 70 al ganar, + 2 por ronda).
- **Panel del organizador:** `/admin.html`, con clave `ADMIN_KEY` (por defecto `gamingcity2026`). Tiene podio, jugadores con su Instagram, últimas partidas, CSV y reinicio.

## Deploy
Vercel con **Upstash for Redis** conectado desde Storage. Cada push a `main` publica la página.

Juego de fans. Valorant es una marca de Riot Games.
