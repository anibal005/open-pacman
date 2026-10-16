# SPEC 01 — Cuatro fantasmas con personalidad propia

> **Status:** Approved
> **Depends on:** Ninguna (primer spec del repo)
> **Date:** 2026-10-15
> **Objective:** Que los 4 fantasmas del juego tengan una personalidad distinta (perseguidor agresivo, emboscador, errático y tímido) y salgan de la pen de forma escalonada.

---

## Por qué existe este spec

Hoy el juego tiene 2 fantasmas y solo dos comportamientos: uno persigue por distancia Manhattan (`hunter`) y el otro elige al azar (`random`). El objetivo de la partida se vuelve plano: con un único perseguidor el jugador aprende una sola amenaza.

Este spec lleva el laberinto a sus 4 fantasmas y reemplaza el par `hunter`/`random` por 4 personalidades que se comportan distinto de forma visible.

---

## Scope

**In:**

- 4 fantasmas en `game.ghosts`, con 4 posiciones de inicio dentro de la pen.
- 4 personalidades: `chaser` (rojo, persigue directo), `ambusher` (rosa, apunta delante de PacMan), `erratic` (cian, proyecta desde el rojo), `shy` (naranja, se aleja si está cerca).
- Salida escalonada de la pen por temporizador, con rebote mientras esperan su turno.
- Reinicio de la escalera de salida cada vez que PacMan pierde una vida.
- Color propio por fantasma en `render.js` (rojo, rosa, cian, naranja).
- Eliminación de `GHOST_STARTS` de `maze.js`: la configuración de los fantasmas pasa a `game.js`.

**Out of scope (para specs futuros):**

- Power pellets y modo asustado (comer fantasmas).
- Ciclos alternantes de scatter/chase.
- Velocidad distinta por fantasma.
- Reaparición individual de un fantasma tras ser comido.
- Búsqueda de camino real (BFS/A*).

---

## Data model

Toda la configuración de los fantasmas vive en `src/js/game.js`:

```js
// Personalidad: cómo se elige el objetivo en cada cruce.
//   chaser   -> celda de PacMan
//   ambusher -> 2 celdas delante de PacMan
//   erratic  -> (2 celdas delante de PacMan) reflejado desde blinky
//   shy      -> celda de PacMan si está lejos; su esquina si está cerca
const GHOST_SPECS = [
  { name: 'blinky', personality: 'chaser',   x: 13, y: 14, exitDelay: 0   },
  { name: 'pinky',  personality: 'ambusher', x: 14, y: 14, exitDelay: 90  },
  { name: 'inky',   personality: 'erratic',  x: 13, y: 13, exitDelay: 180 },
  { name: 'clyde',  personality: 'shy',      x: 14, y: 13, exitDelay: 270 },
];

const CLYDE_CORNER = { x: 2, y: 29 }; // esquina de retirada del tímido
const SHY_DISTANCE = 8;               // celdas: por debajo de esto, se aleja
```

Cada fantasma en `game.ghosts` queda así:

```js
{
  name: 'blinky',        // 'blinky' | 'pinky' | 'inky' | 'clyde'
  personality: 'chaser', // 'chaser' | 'ambusher' | 'erratic' | 'shy'
  x: 13, y: 14,          // celdas, origen arriba-izquierda
  dir: 'up',
  speed: GHOST_SPEED,    // 0.1 celda/frame para los 4
  exitDelay: 0,          // frames que debe esperar antes de salir
  exitTimer: 0,          // cuenta atrás; se reinicia cada vida
  inPen: true,           // true mientras sigue dentro de la pen
}
```

Convenciones:

- `name` es la clave de identidad y de color; `personality` es la clave de comportamiento.
- `exitDelay` va en frames a 60 fps: 0 / 90 / 180 / 270 = 0 s / 1,5 s / 3 s / 4,5 s.
- Celdas del interior de la pen utilizables: `x` en 11..16, `y` en 13..15. Las 4 posiciones de inicio están en las columnas 13 y 14, justo debajo de las dos celdas de puerta.

`src/js/maze.js` deja de exportar `GHOST_STARTS` y conserva `MAZE`, `TUNNEL_ROW` y `PACMAN_START`.

---

## Implementation plan

1. **Modelo de datos.** En `game.js`, añadir `GHOST_SPECS` y construir `game.ghosts` a partir de él (con `name`, `personality`, `exitDelay`, `exitTimer`, `inPen`). Borrar `GHOST_STARTS` de `maze.js`.
   *Prueba manual:* la partida arranca y se ven 4 fantasmas, todavía sin comportamiento nuevo.
2. **Salida de la pen.** Implementar la rutina de espera y salida: mientras `exitTimer > 0`, el fantasma rebota entre `y = 13` y `y = 14` en su columna; al llegar a 0, sube por su columna hasta cruzar la puerta, y entonces `inPen = false`.
   *Prueba manual:* los 4 salen escalonados, rojo primero y naranja último, sin quedarse atascados.
3. **Personalidades.** Añadir `targetFor(game, ghost)` con las 4 ramas y reescribir `decideGhost` para elegir, en cada cruce, la dirección válida que minimiza la distancia Manhattan al objetivo (con orden fijo de direcciones como desempate).
   *Prueba manual:* el rojo llega hasta PacMan quieto; el rosa apunta delante; el cian cambia de rumbo cuando el rojo se mueve; el naranja se aleja cuando está cerca.
4. **Reinicio por vida.** Actualizar `resetPositions` para devolver a los 4 a sus posiciones de inicio, con `inPen = true` y `exitTimer = exitDelay`.
   *Prueba manual:* al perder una vida se repite el orden de salida.
5. **Color por fantasma.** En `render.js`, mapear color por `name` (`blinky` rojo, `pinky` rosa, `inky` cian, `clyde` naranja) en lugar de por índice.
   *Prueba manual:* cada fantasma se dibuja con su color.

---

## Acceptance criteria

- [ ] La partida arranca sin errores en la consola del navegador.
- [ ] Se dibujan 4 fantasmas dentro de la pen al arrancar, con 4 colores distintos.
- [ ] El rojo sale de la pen primero y el naranja último, con un intervalo visible (~1,5 s) entre salidas.
- [ ] Si PacMan se queda quieto en su celda inicial, el rojo llega a su celda y le quita una vida.
- [ ] El rosa no se dirige a la celda de PacMan, sino al punto que está 2 celdas delante de su dirección.
- [ ] El comportamiento del cian cambia cuando el rojo cambia de posición (su objetivo depende del rojo).
- [ ] El naranja se aleja de PacMan cuando está a menos de 8 celdas y lo persigue cuando está más lejos.
- [ ] Al perder una vida, los 4 fantasmas vuelven a la pen y se repite el orden de salida.
- [ ] En cada vida los 4 fantasmas terminan saliendo de la pen (ninguno se queda atascado).
- [ ] `GHOST_STARTS` ya no existe en `maze.js` y el juego sigue funcionando.

---

## Decisions

- **Sí:** 4 personalidades clásicas (perseguidor, emboscador, errático, tímido). El usuario pidió explícitamente uno agresivo y diferencias claras entre los 4.
- **Sí:** el agresivo es `blinky` y persigue siempre la celda de PacMan. La agresividad viene de perseguir sin pausa, no de ir más rápido.
- **No:** ciclos alternantes de scatter/chase. Rol fijo: menos estado global que sincronizar y comportamiento más fácil de leer.
- **Sí:** misma velocidad (`GHOST_SPEED` 0.1) para los 4. La diferencia está en la decisión, no en la velocidad.
- **Sí:** salida escalonada con retardos 0/90/180/270 frames. Evita que los 4 embosquen a PacMan al arrancar.
- **Sí:** se usa `exitTimer` con cuenta atrás en frames, en vez de una marca de tiempo global. Encaja con el bucle actual y se reinicia trivialmente.
- **Sí:** la escalera se reinicia al perder una vida. Cada vida arranca igual y es predecible.
- **Sí:** decisión de dirección por distancia Manhattan en cada cruce, igual que el `hunter` actual. Poco código y determinista.
- **No:** BFS/A*. Añade coste por frame y código sin cambiar de forma perceptible el resultado.
- **Sí:** desempate con orden fijo de direcciones. Sin esto el comportamiento podría oscilar entre dos direcciones de igual distancia.
- **No:** power pellets y modo asustado. Amplían el alcance a otro sistema (tiles nuevos, estados, reaparecer); va en su propio spec.
- **No:** exponer `window.game`. El usuario pidió verificación visual.
- **Sí:** configuración centralizada en `game.js` y se elimina `GHOST_STARTS` de `maze.js`. Una sola fuente de verdad para los fantasmas.
- **No:** nombre visible en el HUD. No aporta al objetivo.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Sin scatter y con 4 perseguidores la partida puede resultar imposible | Ajustar `exitDelay` y `SHY_DISTANCE`; si sigue duro, el scatter pasa a ser spec propio |
| Un fantasma se queda atascado en la pen y nunca sale | La salida es determinista (subir por la columna propia) y hay un criterio de aceptación por vida |
| Dos fantasmas ocupando la misma celda de inicio o chocando en la pen | Las 4 posiciones son distintas y cada uno rebota en su propia columna |
| El cian produce un objetivo fuera del laberinto | El objetivo se calcula y se usa solo para medir distancia; la celda objetivo no necesita ser transitable |

---

## What is **not** in this spec

- Power pellets, modo asustado y comer fantasmas.
- Ciclos de scatter/chase y contadores globales de modo.
- Velocidad propia por fantasma.
- Reaparición individual tras ser comido.
- Pathfinding real (BFS/A*).
- HUD con nombres o leyenda de fantasmas.
- Exposición de `window.game` para depuración.

Cada uno de esos, si llega, va en su propio spec.
