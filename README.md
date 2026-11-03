# Gaming City · Duelo 1v1

Duelo 1v1 online estilo Valorant para el evento de Gaming City. Es un sitio estático (`index.html`, `style.css`, `app.js`) con funciones en `/api` para Vercel. No tiene build ni dependencias.

## El juego
- **4 agentes**, con una habilidad cada uno: Ráfaga (dash), Niebla (humo), Bastión (muro) y Pulso (radar).
- **Arsenal por columnas** (como la tienda de Valorant) con siluetas propias: Classic, Ghost, Sheriff, Stinger, Spectre, Phantom, Vandal, Marshal, Operator, escudo liviano y pesado, ficha de cada arma y compra rápida (Q). Atajos 1–9, Z, X. Si sobrevivís, conservás arma y escudo.
- **Rangos** por puntos: Hierro → Inmortal (3 niveles cada uno) y Radiante para el #1 del evento. Emblemas propios (no son los de Riot), con animación al subir.
- **Mira personalizable**: color, líneas internas/externas, punto, contorno, mira dinámica (muestra la dispersión real de tus balas), presets y código para compartir (GC1-…). Se guarda en la cuenta. Se dibuja en una capa propia a la resolución real de la pantalla, alineada a píxel, y se actualiza con `pointerrawupdate`; opción de mouse bloqueado (Pointer Lock con movimiento crudo) y sensibilidad. En celular la mira va donde apunta el arma y la ayuda de puntería es regulable.
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

## Servidor cerca de Argentina
`vercel.json` fija las funciones en **San Pablo (gru1)**, la región de Vercel más cercana. Para que la base de datos también esté cerca, la base de Upstash tiene que estar en **sa-east-1 (São Paulo)**. El panel `/admin.html` muestra dónde corre el servidor y cuánto tarda la base de datos: si muestra más de ~30 ms, conviene crear la base en São Paulo y reconectarla.

## Online sin duplicados ni partidas trabadas
- El emparejamiento es una sola operación atómica en Redis (script Lua): nadie puede quedar con dos rivales.
- Cada resultado lleva un id de partida: aunque el celular reintente el envío, se cuenta una sola vez.
- Si se corta un jugador (celular bloqueado, sin señal), el otro gana a los 8 s. Si se cortan los dos, el servidor decide un único ganador.
- Si se pierde el aviso de fin de ronda, el marcador del host lo repone solo.

## Deploy
Vercel con **Upstash for Redis** conectado desde Storage. Cada push a `main` publica la página.

Juego de fans. Valorant es una marca de Riot Games.
