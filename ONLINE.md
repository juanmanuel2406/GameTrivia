# Multijugador para el torneo

## Alcance

Varios duelos 1v1 independientes pueden jugarse al mismo tiempo desde el local o desde casa. Cada jugador usa su propia conexión a internet. Se prioriza WebRTC directo o TURN; el respaldo HTTP permite continuar cuando el canal directo se corta. El resultado del juego sigue calculándose con el modelo original entre los clientes: este cambio no convierte el juego en un servidor autoritativo antitrampas.

## Preparar el alojamiento

1. Publicar la rama en un entorno de prueba de Vercel con las variables de Upstash conectadas. `vercel.json` conserva la región `gru1` de la carpeta entregada. La base debe estar también cerca de los jugadores; configurar la región de funciones no mueve una base existente.
2. Configurar **un proveedor TURN propio**: `CF_TURN_KEY_ID` y `CF_TURN_KEY_API_TOKEN`, o `METERED_APP` y `METERED_API_KEY`. No poner secretos en archivos del navegador. `/api/ice` devuelve `turnConfigured: true` cuando obtiene credenciales válidas. No depende de servidores TURN públicos compartidos. Sin TURN sigue disponible STUN y el respaldo HTTP, con mayor demora potencial.
3. Verificar `/api/ping` y el panel administrativo. Comprobar desde Wi-Fi del evento, datos móviles y una vivienda externa. El tiempo de base de datos no es la latencia completa de juego: el indicador del juego mide ida y vuelta entre jugadores.
4. Dimensionar las cuotas de Vercel y Redis. A baja latencia, el respaldo HTTP genera aproximadamente hasta 15 intercambios por segundo por jugador (y menos con redes lentas). 100 jugadores usando exclusivamente ese respaldo pueden acercarse a 1500 solicitudes por segundo. WebRTC reduce notablemente esa carga. La prueba local de concurrencia no certifica capacidad ni latencia del alojamiento contratado.
5. Al publicar esta versión, todos deben recargar el sitio. Las colas `gc:v3:*` aíslan el protocolo nuevo del anterior. Evitar una actualización durante partidas en curso.
6. Definir una clave privada en `ADMIN_KEY` para el panel del organizador. Se eliminó la clave predeterminada incluida en la carpeta original; sin configuración el panel queda deshabilitado. Los jugadores no necesitan esa clave.

## Comportamiento de red

- Búsquedas y reservas privadas atómicas; resultado de emparejamiento retenido 120 segundos para reintentos. Código privado de seis caracteres. Las cancelaciones llevan el identificador de la búsqueda y dejan una marca temporal que impide revivir una petición antigua.
- Una petición de respaldo por jugador a la vez. Cada lote lleva secuencia y confirmación de recepción; el mismo lote se vuelve a enviar tras una respuesta perdida. Los eventos recibidos permanecen hasta confirmarse, sin volver a aplicarse. La posición se guarda aparte y se sustituye por la más nueva.
- Colas de eventos acotadas; nunca se eliminan disparos o rondas para hacer espacio silenciosamente. Los eventos vencen tras 120 segundos y la posición tras 3 segundos. Una sesión fuera de orden o expirada termina sin asignar puntos arbitrarios.
- Cambio al respaldo si WebRTC cierra o deja de recibir tráfico durante unos 3 segundos. Reintentos progresivos con una pequeña variación para no sincronizar a todos los celulares. Límite de 6,5 s por petición del navegador y 4,5 s para Redis.
- Actividad de cada jugador verificada en servidor. Hasta 20 segundos de tolerancia; una salida explícita avisa inmediatamente. Si el servidor no puede confirmar abandono, la partida queda sin resultado. Si el rival sigue activo, se espera y se recupera la partida en vez de otorgar una victoria falsa.
- Los scripts se ejecutan con `EVALSHA`; solo se carga el texto cuando Redis indica que no lo tiene. Fallos de red no disparan reintentos de escrituras genéricas. Referencia: [scripts Lua de Redis](https://redis.io/docs/latest/develop/programmability/eval-intro/).
- Credenciales TURN temporales y renovación de la configuración entre partidas. Referencia: [credenciales de Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/generate-credentials/).

## Verificación reproducible

`npm test` ejecuta los scripts Lua reales sobre fakeredis/lupa detrás de un adaptador REST local. Cubre 100 búsquedas concurrentes, un solo rival por sala privada frente a 30 intentos, cancelaciones atrasadas, pérdida de respuestas, reintentos, confirmaciones, posición más reciente, aislamiento de salas, plazos de abandono, colas llenas y entradas inválidas.

`npm run test:browser` abre dos navegadores contra las funciones locales. Inyecta pérdida de una respuesta después de procesarla, demora variable de 100–180 ms y un corte de 4 segundos. Comprueba inicio, recepción de estados, recuperación y salida voluntaria. También prueba conexión WebRTC real entre navegadores locales y caída del canal hacia el respaldo HTTP. Revisa San Isidro en una pantalla móvil y detecta errores JavaScript.

En el código recibido se reprodujeron dos defectos: repetir una respuesta perdida de emparejamiento devolvía `waiting` tras haber asignado rival; repetir una lectura de retransmisión después de perder su respuesta devolvía una cola vacía. Las pruebas nuevas conservan tanto el rival como los eventos.

Pendiente en el despliegue: medir Wi-Fi/datos reales, TURN del proveedor elegido, cuotas y jugadores geográficamente separados. No se establece una promesa de ping ni de capacidad a partir de una simulación local.
