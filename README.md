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

## Premios
Cada partida termina con un ticket que tiene apodo, puntaje y un código de 6 caracteres. En el **Modo presentador → Verificar ticket** cargás esos datos y te dice si el ticket es real.

## Logo
Se carga desde `https://www.gamingcity.com.ar/empresa/logo400x400.jpg`. Si no carga, se muestra un logotipo de respaldo.

Juego de fans. Valorant es una marca de Riot Games.
