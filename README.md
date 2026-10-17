# Gaming City Arcade

Minijuegos de Valorant para el evento de Gaming City. Es una sola página estática (`index.html`), sin build ni dependencias.

## Juegos
- **Duelo 1v1**: shooter 2D contra un bot (Hierro, Oro o Radiante). Gana el primero en llegar a 5 rounds.
- **Trivia**: 12 preguntas al azar de un banco de 45.
- **Adiviná el agente**: 3 pistas por ronda.
- **Puntería**: 30 segundos de blancos.
- **Defuse**: test de reflejos.
- **Modo presentador**: preguntas para proyectar y verificador de tickets para entregar premios.

## Deploy en Vercel
1. En vercel.com: **Add New → Project** e importar este repo.
2. Framework Preset: **Other**. No hace falta build command ni output directory.
3. Deploy. El link queda en `https://<nombre>.vercel.app`.

Cada push a `main` vuelve a publicar la página.

## Ranking online (obligatorio para anotar jugadores)
El ranking guarda los puntajes en una base Upstash Redis gratis, conectada desde Vercel:
1. En Vercel abrí el proyecto → **Storage** → **Create Database** → **Upstash for Redis** (plan Free) → conectalo a este proyecto.
2. En **Settings → Environment Variables** agregá `ADMIN_KEY` con la clave que quieras para el panel. Si no la ponés, la clave es `gamingcity2026`.
3. **Deployments** → los tres puntitos del último deploy → **Redeploy**.

- **Panel del organizador:** `/admin.html`. Podio, todos los jugadores con su mejor puntaje por juego, últimas partidas, CSV y reinicio.
- **Puntaje total** = suma del mejor puntaje de cada juego. Repetir un juego solo suma si mejora su marca.
- Cada celular tiene su propio ID: dos jugadores con el mismo apodo aparecen por separado (con `#xxxx`).
- Si falla la conexión, el puntaje queda guardado en el celular y se reenvía solo.

## Premios
Cada partida termina con un ticket que tiene apodo, puntaje y un código de 6 caracteres. En el **Modo presentador → Verificar ticket** cargás esos datos y te dice si el ticket es real.

## Logo
Se carga desde `https://www.gamingcity.com.ar/empresa/logo400x400.jpg`. Si no carga, se muestra un logotipo de respaldo.

Juego de fans. Valorant es una marca de Riot Games.
