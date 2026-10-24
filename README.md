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
- **Jugar con un amigo:** sala con código de 6 caracteres.
- **Revancha** al terminar, con el mismo rival.
- **En vivo:** el inicio muestra cuántos están conectados, buscando rival y jugando (`/api/presence`).

Conexión:
Empareja a dos personas que estén buscando rival al mismo tiempo, desde cualquier red:
1. **Conexión directa** entre los dos dispositivos (WebRTC). La señalización pasa por `/api/match` y Upstash.
2. **TURN** (`/api/ice`) para redes que bloquean la conexión directa. Opcional: `CF_TURN_KEY_ID` + `CF_TURN_KEY_API_TOKEN` (Cloudflare) o `METERED_APP` + `METERED_API_KEY`.
3. **Plan B por el servidor:** si no hay conexión directa, o si se corta en medio de la partida, el juego sigue retransmitido por `/api/match`.

## Registro, ranking y panel
- Primera visita: cartel para seguir a **@gamingcitycomputacion**, **@gamingcitybelgrano** y **@gamingcitysanisidro**. Después el jugador se registra con apodo, Instagram y un PIN.
- **Puntos (una sola fórmula, todo suma al mismo total):** victoria 100 (50 si el rival abandona) + 10 por ronda ganada; derrota, 10 por ronda ganada. Contra el bot se multiplica por rango: Radiante ×1, Oro ×0,5, Hierro ×0,25.
- **Panel del organizador:** `/admin.html`, con clave `ADMIN_KEY` configurada en el servidor. Sin esa variable el panel permanece deshabilitado. Tiene podio, jugadores con su Instagram, últimas partidas, CSV y reinicio.

## Servidor cerca de Argentina
`vercel.json` fija las funciones en **San Pablo (gru1)**, la región de Vercel más cercana. Para que la base de datos también esté cerca, la base de Upstash tiene que estar en **sa-east-1 (São Paulo)**. El panel `/admin.html` muestra dónde corre el servidor y cuánto tarda la base de datos: si muestra más de ~30 ms, conviene crear la base en São Paulo y reconectarla.

## Online sin duplicados ni partidas trabadas
- El emparejamiento público y privado es atómico en Redis. Reintentar una respuesta perdida devuelve el mismo rival. Cancelar una búsqueda no cancela la siguiente.
- Cada resultado lleva un id de partida: aunque el celular reintente el envío, se cuenta una sola vez.
- Hay 20 s de tolerancia ante cortes. El servidor comprueba la última actividad antes de conceder abandono; si no se puede verificar, no se inventa una victoria. Salir voluntariamente avisa al rival sin esperar ese plazo.
- El respaldo HTTP confirma recepción, conserva eventos pendientes y evita duplicados. Solo conserva la posición más reciente. Las peticiones tienen límite de tiempo y espera progresiva ante errores.
- Se usa una petición de respaldo a la vez por jugador. Redis ejecuta scripts precargados por su hash para reducir tráfico. Los duelos WebRTC solo consultan el respaldo cada 2 s.
- Si se pierde el aviso de fin de ronda, el marcador del host lo repone solo.

## Deploy
Vercel con **Upstash for Redis** conectado desde Storage. Cada push a `main` publica la página.

La rama de mejoras no modifica `main`. Antes del torneo, configurar TURN propio y verificar región, cuotas y latencia desde las redes reales. Ver [operación y pruebas del online](ONLINE.md). Se mantienen duelos **1v1 simultáneos en salas independientes**, no una sala compartida con todos los participantes.

## Pruebas locales

Requiere Node 22 o superior y Python 3.12 o superior. No agrega dependencias de ejecución al sitio.

```sh
python -m pip install --target .test-deps -r tests/requirements.txt
npm test
```

Pruebas con dos navegadores (Playwright como herramienta de desarrollo):

```sh
npm install --no-save playwright
npx playwright install chromium
npm run test:browser
```

`BROWSER_CHANNEL` permite elegir otro navegador instalado (por ejemplo `msedge`). Los resultados visuales se guardan en `test-output/`, excluido de Git.

Juego de fans. Valorant es una marca de Riot Games.
