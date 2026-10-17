# Gaming City · Duelo 1v1

Duelo 1v1 online estilo Valorant para el evento de Gaming City. Es un sitio estático (`index.html`, `style.css`, `app.js`) con funciones en `/api` para Vercel. No tiene build ni dependencias.

## El juego
- **4 agentes**, con una habilidad cada uno: Ráfaga (dash), Niebla (humo), Bastión (muro) y Pulso (radar).
- **Fase de compra** en cada ronda, con créditos al estilo Valorant: Classic, Sheriff, Spectre, Vandal, Operator, escudo liviano y escudo pesado. Si sobrevivís, conservás arma y escudo.
- **Primero a 7 rondas.** A las 6 rondas se cambia de lado y se reinician los créditos. Con 6–6 se juega una ronda decisiva con 5000 créditos.
- **Niebla de guerra:** solo ves al rival si hay línea de visión (paredes, muros y humos la cortan). Si el rival corre, se ven sus pasos.
- Controles para celular (dos pulgares, toque rápido = tiro, asistencia de puntería, vibración) y para compu (WASD + mouse). Se puede instalar como app (pantalla completa y horizontal).
- Mapa compacto y rondas rápidas: compra de 7 s y rondas de 35 s.
- **Práctica contra bot** en Hierro, Oro o Radiante.

## Online
- **Jugar online:** busca rival al instante. Mientras esperás podés **practicar contra el bot sin dejar de buscar**; si aparece un rival, arranca el duelo.
- **Jugar con un amigo:** sala con código de 4 letras.
- **Revancha** al terminar, con el mismo rival.
- **En vivo:** el inicio muestra cuántos están conectados, buscando rival y jugando (`/api/presence`).

Conexión:
Empareja a dos personas que estén buscando rival al mismo tiempo, desde cualquier red:
1. **Conexión directa** entre los dos dispositivos (WebRTC). La señalización pasa por `/api/match` y Upstash.
2. **TURN** (`/api/ice`) para redes que bloquean la conexión directa. Opcional: `CF_TURN_KEY_ID` + `CF_TURN_KEY_API_TOKEN` (Cloudflare) o `METERED_APP` + `METERED_API_KEY`.
3. **Plan B por el servidor:** si no hay conexión directa, o si se corta en medio de la partida, el juego sigue retransmitido por `/api/match`.

## Registro, ranking y panel
- Primera visita: cartel para seguir a **@gamingcitycomputacion** y **@gamingcitybelgrano**. Después el jugador se registra con apodo, Instagram y un PIN.
- **Puntos (una sola fórmula, todo suma al mismo total):** victoria 100 (50 si el rival abandona) + 10 por ronda ganada; derrota, 10 por ronda ganada. Contra el bot se multiplica por rango: Radiante ×1, Oro ×0,5, Hierro ×0,25.
- **Panel del organizador:** `/admin.html`, con clave `ADMIN_KEY` (por defecto `gamingcity2026`). Tiene podio, jugadores con su Instagram, últimas partidas, CSV y reinicio.

## Deploy
Vercel con **Upstash for Redis** conectado desde Storage. Cada push a `main` publica la página.

Juego de fans. Valorant es una marca de Riot Games.
