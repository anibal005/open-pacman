# SPEC 03 — Power Pellets y modo asustado (comer fantasmas)

> **Status:** Approved
> **Depends on:** SPEC 01, SPEC 02
> **Date:** 2026-10-16
> **Objective:** Que el laberinto tenga 4 power pellets que, al comerlos, conviertan a los fantasmas en presas durante 6 segundos: Pac-Man gana la capacidad de comérselos y los fantasmas comidos vuelven como ojos a la pen para reaparecer.

---

## Por qué existe este spec

Hoy chocar con un fantasma siempre quita una vida: el jugador solo tiene huida, nunca contrajuego. No existe ninguna jugada arriesgada con recompensa, y el objetivo de la partida se reduce a no cruzarse con nada.

El SPEC 01 listó "power pellets y modo asustado" entre lo que quedaba fuera, y el SPEC 02 dejó preparados los dos ganchos exactos que este spec necesita: el campo `returning` de cada fantasma y el actor `'ghost-returning'`, el único que puede cruzar la puerta de la pen. Ese spec documentó ambos como "punto de extensión del spec de modo asustado". Este spec los activa y cierra la mecánica clásica: comer el pellet, perseguir o huir durante el modo asustado, y devolver a los fantasmas comidos a su pen.

---

## Scope

**In:**

- Tile `'o'` → `4` (power pellet) en `parseTile`, con 4 celdas nuevas en `MAZE_STR`: (1,3), (26,3), (1,23), (26,23).
- Power pellets dibujados grandes y parpadeantes; cuentan como comida para ganar (mismo contador que los dots).
- Comer un power pellet: +50 puntos, activa el modo asustado global durante 360 frames (6 s) y revierte la marcha de los fantasmas que están fuera de la pen.
- Fantasmas asustados: color azul, velocidad 0.075 y dirección aleatoria en cada cruce (sin girar 180°); parpadeo azul/blanco en los últimos 2 s.
- Comer fantasmas: 200 / 400 / 800 / 1600 puntos por cadena, que se reinicia al comer otro power pellet.
- Fantasma comido → `returning = true`: vuelve como ojos hasta la puerta de la pen, reentra y vuelve a salir (activación real de los hooks del SPEC 02).
- Los ojos no quitan vida ni pueden ser comidos; al perder una vida termina el modo asustado y se resetea la cadena.
- Actualización de los comentarios del código que hoy afirman que `returning` nunca se activa.

**Out of scope (para specs futuros):**

- Fruta, ciclos de scatter/chase, sonido, HUD de tiempo o de cadena con puntos flotantes.
- Duración del modo asustado decreciente por nivel.
- BFS/A* para los ojos (solo como fallback si la simulación encuentra bucles: ver Risks).
- Velocidad propia por fantasma y reaparición con un retardo distinto al de la pen.
- Cambios en `main.js` o `index.html`, y exposición de `window.game`.

---

## Data model

Nuevo tile en `src/js/maze.js`:

```js
// '#' pared(1) · '.' dot(2) · ' ' vacio transitable(0) · '-' puerta pen(3)
// · 'o' power pellet(4)
function parseTile( ch ) {
  if ( ch === '#' ) return 1;
  if ( ch === '.' ) return 2;
  if ( ch === '-' ) return 3;
  if ( ch === 'o' ) return 4;
  return 0;
}
```

Los 4 power pellets van donde el original los pone, uno por cuadrante (posiciones verificadas contra réplicas fieles del laberinto; simétricas respecto al eje central):

```js
//   (1,3)  y (26,3)   -> esquinas superiores
//   (1,23) y (26,23)  -> esquinas inferiores (misma fila que el inicio de PacMan)
```

Constantes nuevas en `src/js/game.js`, junto a `PAC_SPEED` / `GHOST_SPEED`:

```js
const PELLET_SCORE = 50;           // puntos por power pellet
const FRIGHT_FRAMES = 360;         // 6 s de modo asustado a 60 fps
const GHOST_FRIGHT_SPEED = 0.075;  // 3/4 de la velocidad normal
const GHOST_EYES_SPEED = 0.2;      // ojos: el doble de la normal
const GHOST_EAT_SCORE = 200;       // base de la cadena 200/400/800/1600
const PEN_REENTRY_WAIT = 60;       // 1 s en la pen antes de volver a salir
const PEN_DOOR_TARGET = { x: 13, y: PEN_EXIT_Y }; // objetivo de los ojos
```

Estado nuevo en `createGame()`:

```js
{
  // ...existentes: state, score, lives, dotsRemaining, grid, pacman, ghosts
  frightTimer: 0, // frames restantes de modo asustado (0 = normal)
  ghostCombo: 0,  // fantasmas comidos desde el ultimo pellet (0..3)
}
```

Cada fantasma no gana campos: reutiliza `returning` (SPEC 02) e `inPen`. La velocidad efectiva se calcula con un helper en vez de mutar `g.speed`, para no tener estados que restaurar:

```js
function ghostSpeed( game, g ) {
  if ( g.returning ) return GHOST_EYES_SPEED;
  if ( g.inPen ) return GHOST_SPEED;             // la pen no cambia con el modo
  if ( game.frightTimer > 0 ) return GHOST_FRIGHT_SPEED;
  return GHOST_SPEED;
}
```

Reglas de colisión en `update()` (reemplazan el bloque actual):

```js
for ( const g of game.ghosts ) {
  if ( g.returning ) continue;                    // ojos: inofensivos
  if ( !collides( game.pacman, g ) ) continue;
  if ( game.frightTimer > 0 ) {                   // PacMan se lo come
    game.score += GHOST_EAT_SCORE * 2 ** game.ghostCombo;
    game.ghostCombo = Math.min( game.ghostCombo + 1, 3 ); // tope 1600
    g.returning = true;
    continue;
  }
  game.lives--; // sin modo asustado: como hasta ahora
  // ...resto igual: lost / resetPositions / break
}
```

`decideGhost()` pasa a tener 3 ramas, en este orden de prioridad:

1. **`g.returning`** → objetivo `PEN_DOOR_TARGET` y, en el filtro de opciones, **se permite girar 180°** (es el único caso en que se permite). Al alinearse en `(13|14, 11)` con `returning`, `moveGhost` lo reinserta: `inPen = true`, `returning = false`, `exitTimer = PEN_REENTRY_WAIT`, `dir = 'up'`; la salida la retoma la rutina `moveGhostInPen` del SPEC 01.
2. **`frightTimer > 0`** → dirección al azar entre las válidas (`Math.random`), manteniendo la prohibición de girar 180°.
3. **Normal** → `targetFor()` y distancia Manhattan con desempate fijo, como hoy.

Comer un power pellet, dentro de `movePacman()` (junto al bloque actual de comer dot):

```js
else if ( tile === 4 ) {
  grid[ p.y ][ p.x ] = 0;
  game.score += PELLET_SCORE;
  game.dotsRemaining--;
  game.frightTimer = FRIGHT_FRAMES;
  game.ghostCombo = 0;
  // inversion clasica: solo fantasmas fuera de la pen y no ojos
  for ( const g of game.ghosts )
    if ( !g.inPen && !g.returning ) g.dir = OPPOSITE[ g.dir ];
}
```

Convenciones:

- `dotsRemaining` cuenta tiles `2` y `4`: el nivel solo se gana sin ningún dot ni power pellet (como en el original).
- `frightTimer` se decrementa 1 por frame al inicio de `update()`; comer otro pellet lo vuelve a poner a `FRIGHT_FRAMES` y la cadena a 0.
- `resetPositions()` pone `frightTimer = 0` y `ghostCombo = 0`: perder una vida termina el modo.

---

## Implementation plan

1. **Tile y laberinto.** En `maze.js`, `'o'` → `4` en `parseTile`, cambiar las 4 esquinas de `.` a `o` y actualizar el comentario de cabecera.
   *Prueba manual:* la partida arranca sin errores y PacMan sigue pudiendo pasar por las 4 esquinas.
2. **Dibujar los power pellets.** En `render.js`, `drawPowerPellets( ctx, grid, frame )`: radio ~7 px (los dots tienen 2.5) y parpadeo basado en `frame`.
   *Prueba manual:* se ven 4 pellets grandes parpadeando en las esquinas; los dots normales no cambian.
3. **Comer el pellet.** En `game.js`: `dotsRemaining` cuenta tiles `2` y `4`; el bloque de `movePacman` come el tile `4` con `PELLET_SCORE`, activa `frightTimer`, reinicia `ghostCombo` e invierte la marcha; `update` decrementa `frightTimer`.
   *Prueba manual:* comer un pellet suma 50 y los fantasmas visibles cambian de sentido.
4. **Modo asustado.** Helper `ghostSpeed()` aplicado en `moveGhost` / `moveGhostInPen`; rama aleatoria en `decideGhost`; en `render.js`, fantasmas azules con parpadeo azul/blanco en los últimos 120 frames.
   *Prueba manual:* los fantasmas se quedan ~6 s azules, lentos y moviéndose al azar; luego recuperan color, velocidad y personalidad.
5. **Comer fantasmas.** El bloque de colisión de `update()` con la regla nueva: ignorar `returning`, comer con miedo (cadena 200/400/800/1600), vida sin miedo.
   *Prueba manual:* con un solo pellet, encadenar 1, 2, 3 y 4 fantasmas suma 200, 400, 800 y 1600.
6. **Ojos a casa.** Rama `returning` en `decideGhost` (objetivo `PEN_DOOR_TARGET`, 180° permitido), reentrada alineada en `(13|14, 11)` en `moveGhost` y velocidad de ojos.
   *Prueba manual:* el fantasma comido vuelve en ojos hasta la puerta, reentra, espera ~1 s y vuelve a salir.
7. **Resets y comentarios.** `resetPositions` limpia `frightTimer` y `ghostCombo`; actualizar los comentarios de `isWall`, del bloque `GHOST_SPECS` y de `maze.js` que hoy dicen que `returning` nunca se activa.
   *Prueba manual:* al perder una vida termina el modo asustado; releer el diff: no debe quedar ninguna referencia a que el modo asustado "no existe todavía".
8. **Verificación por simulación.** Harness temporal (no commiteado) como en el SPEC 02: 60 000 frames con power pellets en juego. Ningún fantasma pasa de 600 frames seguidos con `returning = true`.
   *Prueba manual:* los umbrales se cumplen; si algún ojo se atasca, aplicar el fallback BFS de Risks antes de dar el spec por bueno.

---

## Acceptance criteria

- [ ] El juego arranca sin errores en la consola del navegador.
- [ ] Hay exactamente 4 power pellets grandes parpadeando en (1,3), (26,3), (1,23) y (26,23); el resto del laberinto se dibuja igual que antes.
- [ ] Comer un power pellet suma 50 puntos y la celda queda vacía.
- [ ] Al comérselo, los fantasmas fuera de la pen invierten su dirección, se pintan azules y se mueven más lento durante ~6 s, con parpadeo azul/blanco en los últimos 2 s.
- [ ] Mientras dura el modo asustado, los fantasmas eligen dirección al azar en cada cruce y nunca giran 180°.
- [ ] Chocar con un fantasma asustado lo come y suma 200, 400, 800 y 1600 según el orden de la cadena; comer otro pellet reinicia el temporizador y la cadena.
- [ ] El fantasma comido se ve como ojos, vuelve hasta la puerta de la pen, reentra y vuelve a salir ~1 s después; en la simulación ningún fantasma pasa de 600 frames con `returning = true`.
- [ ] Los ojos atraviesan a PacMan sin quitarle vida y jamás se pintan azules ni pueden ser comidos.
- [ ] Cuando el temporizador llega a 0, los fantasmas recuperan color, velocidad y personalidad normales; chocar entonces quita una vida.
- [ ] PacMan solo puede ganar cuando no queda ningún dot ni power pellet en el laberinto.
- [ ] Al perder una vida termina el modo asustado, la cadena se pone a 0 y los 4 fantasmas vuelven a la pen con la escalera de salida del SPEC 01.
- [ ] Solo el actor `'ghost-returning'` cruza la puerta (SPEC 02), y ahora sí hay fantasmas usando ese actor durante la partida.
- [ ] `main.js` e `index.html` no cambian, y `window.game` sigue sin exponerse.

---

## Decisions

- **Sí:** tile nuevo `'o'` = `4` en vez de reutilizar el `2`: `isWall` lo trata como transitable sin tocar nada y el contador distingue la comida con una sola comparación por tipo.
- **Sí:** las 4 posiciones clásicas (1,3), (26,3), (1,23), (26,23), verificadas contra réplicas fieles del laberinto original; son simétricas respecto al eje central.
- **Sí:** ojos que vuelven a la pen con `returning` y `'ghost-returning'`. Reutiliza los hooks del SPEC 02 tal como ese spec los dejó documentados, en vez de un teleport que los dejaría como código muerto.
- **Sí:** dirección aleatoria para los fantasmas asustados (`Math.random`). Es el comportamiento clásico; la reproducibilidad estricta no hace falta porque el único criterio medido por simulación (ojos sin atascarse) no depende del azar.
- **Sí:** temporizador global `frightTimer` en frames, coherente con `exitTimer`: los 4 se asustan y se recuperan a la vez, como en el original.
- **Sí:** cadena 200 / 400 / 800 / 1600 con tope 1600 y reinicio al comer otro pellet.
- **Sí:** inversión de marcha al activarse el modo, solo para fantasmas fuera de la pen y no para los ojos.
- **Sí:** helper `ghostSpeed( game, g )` en vez de mutar `g.speed`: no hay estados que olvidar restaurar.
- **Sí:** los power pellets cuentan en `dotsRemaining`: el original exige comer todos los elementos del laberinto.
- **Sí:** parpadeo de los pellets, parpadeo azul/blanco de los últimos 2 s y ojos sin cuerpo: son las 3 señales visuales de que el modo existe.
- **No:** BFS para los ojos. Manhattan greedy con 180° permitido sigue la filosofía del SPEC 01; si la simulación del paso 8 encuentra bucles, el fallback es BFS solo para `returning` (ver Risks).
- **No:** reaparición por teleport ni aparición directa dentro de la pen.
- **No:** conservar la personalidad durante el modo asustado: la aleatoriedad es lo que hace reconocible el estado.
- **No:** HUD de tiempo o de cadena, sonido, fruta, scatter/chase y duración por nivel.
- **No:** exponer `window.game`: verificación visual y por simulación, como en los specs anteriores.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Los ojos orbitan un bloque y nunca llegan (Manhattan greedy no tiene memoria) | Mientras `returning` se permite girar 180°, y la simulación de 60 000 frames mide que ningún fantasma pasa de 600 frames con `returning = true`; si aparece algún bucle, fallback BFS solo para ojos antes de aprobar |
| `dotsRemaining` mal contado: el nivel se gana antes de tiempo o nunca termina | `createGame` suma tiles `2` y `4`; criterio de aceptación explícito: ganar exige comer los 4 pellets |
| Un fantasma que sale de la pen justo cuando se come el pellet queda invertido a media celda | La inversión solo cambia `dir`; el movimiento continúa hasta la siguiente celda alineada y `decideGhost` no permite un segundo 180° inmediato |
| Un ojo pierde su objetivo si, mientras vuelve, se come otro pellet | La rama `returning` de `decideGhost` tiene prioridad sobre la rama asustada: los ojos siempre apuntan a `PEN_DOOR_TARGET` y nunca se vuelven azules |
| Las cadenas altas se notan poco sin puntos flotantes en pantalla | Añadir HUD o texto flotante queda fuera de scope; el marcador acumulado da la señal mínima |

---

## What is **not** in this spec

- Fruta, ciclos de scatter/chase y sonido.
- Duración del modo asustado por nivel y velocidad propia por fantasma.
- BFS/A* (salvo el fallback condicionado de Risks).
- HUD de tiempo, cadena o puntos flotantes.
- Cambios en `main.js` o `index.html` y exposición de `window.game`.

Cada uno de esos, si llega, va en su propio spec.
