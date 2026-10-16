# SPEC 02 — La puerta de la pen es de un solo sentido

> **Status:** Approved
> **Depends on:** SPEC 01
> **Date:** 2026-10-16
> **Objective:** Que la puerta de la pen sea de un solo sentido para los fantasmas: salen con la rutina escalonada del SPEC 01 y, una vez fuera, no vuelven a entrar.

---

## Por qué existe este spec

El SPEC 01 dejó la salida de la pen funcionando: los 4 fantasmas salen escalonados (frames 31 / 111 / 201 / 301, medido en simulación) y ninguno se queda encerrado dentro.

El fallo aparece después. `isWall()` en `src/js/game.js` bloquea la puerta (tile `3`) solo para `pacman`, así que un fantasma ya fuera puede volver a cruzar la puerta cuando PacMan está por debajo. Dentro del pen, `decideGhost()` (Manhattan + prohibido girar 180°) entra en un ciclo cerrado de 4 celdas que no termina nunca:

```
fantasma fuera de la pen, bucle medido:
(15,14) → (15,15) → (14,15) → (14,14) → (15,14) → …
```

Medido en 60 000 frames de simulación contra el `game.js` anterior a este spec:

| Fantasma | Frames con `inPen = false` dentro de la pen | Racha máxima encerrado |
| --- | --- | --- |
| blinky | 39 986 | 11 120 frames (~3 min) |
| pinky | 38 893 | 11 320 frames |
| inky | 36 831 | 11 390 frames |
| clyde | 32 895 | 11 360 frames |

Eso es lo que se ve en pantalla como "el fantasma se queda atrapado en la jaula". Con la puerta tratada como muro para los fantasmas, la misma simulación da 0 frames de fantasmas fuera dentro de la pen y 0 bucles.

---

## Scope

**In:**

- Tile `3` (puerta) bloquea a los fantasmas en `isWall()`, igual que ya bloquea a `pacman`.
- Nuevo campo `returning: false` en cada fantasma; la puerta solo deja pasar al actor `'ghost-returning'`.
- La rutina de salida del SPEC 01 (`moveGhostInPen`) no cambia: sigue moviendo en `y` sin consultar `canMove`.
- La escalera 0 / 90 / 180 / 270 frames se mantiene tal cual, con reinicio por vida.

**Out of scope (para specs futuros):**

- Comportamiento de `returning`: nadie pone el campo a `true` todavía.
- Modo asustado, power pellets y comer fantasmas.
- Reaparición individual de un fantasma tras ser comido.
- Watchdog anti-bucle genérico (no hace falta: sin reentrada no hay bucles).
- Cambios de ritmo de la escalera de salida.

---

## Data model

Un campo nuevo por fantasma en `src/js/game.js`:

```js
{
  name: 'blinky',
  personality: 'chaser',
  x: 13, y: 14,
  dir: 'up',
  speed: GHOST_SPEED,
  exitDelay: 0,
  exitTimer: 0,
  inPen: true,
  returning: false, // true solo cuando un fantasma vuelve a casa (spec de modo asustado)
}
```

Regla de la puerta en `isWall()`. `actor` es el único parámetro que decide:

```js
if ( v === 1 ) return true;
if ( v === 3 && actor !== 'ghost-returning' ) return true; // puerta de un solo sentido
return false;
```

Convenciones:

- Actores posibles: `'pacman'`, `'ghost'` (no cruza la puerta) y `'ghost-returning'` (sí la cruza).
- Un helper `ghostActor( g )` traduce el fantasma a su actor: `'ghost-returning'` si `g.returning`, si no `'ghost'`.
- `moveGhostInPen()` no usa `canMove()`: la salida del pen no depende de esta regla.

---

## Implementation plan

1. **Campo `returning`.** En `createGame()`, añadir `returning: false` a cada fantasma construido desde `GHOST_SPECS`. `resetPositions()` lo deja en `false`.
   *Prueba manual:* la partida arranca igual que antes y los 4 fantasmas salen escalonados.
2. **Puerta de un solo sentido.** En `isWall()` de `src/js/game.js`, el tile `3` bloquea a todos los actores salvo `'ghost-returning'`.
   *Prueba manual:* jugar una partida completa y comprobar que ningún fantasma que ya salió vuelve a pasearse dentro de la jaula.
3. **Actor del fantasma.** Añadir `ghostActor( g )` y usarlo en `decideGhost()` y `moveGhost()` al llamar a `canMove()`.
   *Prueba manual:* el juego sigue igual (nadie tiene `returning = true` todavía), pero el camino de vuelta a casa queda disponible para el spec de modo asustado.
4. **Comentarios.** Documentar en `isWall()` y en el bloque de comentario de `GHOST_SPECS` que la puerta es de un solo sentido y qué actor la cruza.
   *Prueba manual:* releer el diff; no debe quedar ninguna referencia a que los fantasmas cruzan la puerta libremente.

---

## Acceptance criteria

- [ ] El juego arranca sin errores en la consola del navegador.
- [ ] Los 4 fantasmas salen de la pen escalonados: rojo primero, naranja último, con ~1,5 s entre salidas (sin cambios respecto al SPEC 01).
- [ ] En una partida completa, ningún fantasma con `inPen = false` aparece dentro de la pen ni da vueltas en la jaula.
- [ ] En cada vida en la que el jugador sobrevive ~5 s desde el reinicio, los 4 fantasmas terminan saliendo de la pen.
- [ ] PacMan sigue sin poder cruzar la puerta.
- [ ] La puerta solo deja pasar al actor `'ghost-returning'`; ningún fantasma del juego tiene `returning = true` todavía.
- [ ] El rebote en espera y la subida por la columna al salir se comportan igual que en el SPEC 01.
- [ ] `render.js` y `maze.js` no cambian, y `window.game` sigue sin exponerse.

---

## Decisions

- **Sí:** la puerta (tile `3`) es muro para los fantasmas. Es la causa raíz medida del bucle; una condición en `isWall()` lo elimina.
- **Sí:** se resuelve con el parámetro `actor` que ya existe, usando el valor `'ghost-returning'`, en vez de añadir un parámetro booleano a `canMove()`. Mantiene la firma actual.
- **Sí:** campo `returning: false` sin comportamiento. Deja la puerta preparada para el spec de modo asustado sin inventar una mecánica que hoy no se puede probar jugando.
- **No:** máquina de estados `mode: 'inPen' | 'out' | 'returning'`. Refactor del modelo del SPEC 01 sin beneficio hoy.
- **No:** watchdog anti-bucle. Con la puerta bloqueada la simulación no muestra ningún bucle (racha máxima fuera: 10 celdas, lo normal para cruzar un pasillo).
- **Sí:** mantener la escalera 0 / 90 / 180 / 270 con reinicio por vida. Decisión vigente del SPEC 01: cada vida arranca igual y predecible.
- **No:** acortar los retardos de salida para que el último fantasma salga antes. No arregla nada; el problema era la reentrada, no el temporizador.
- **No:** exponer `window.game` para verificar `returning`. Coherente con el SPEC 01: verificación visual.

---

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Un fantasma en estado `returning` se queda encerrado si nadie lo devuelve a `false` | Hoy ningún código pone el campo a `true`. El spec de modo asustado debe definir cuándo vuelve a `false`. |
| La salida de la pen se rompe si alguien cambia `moveGhostInPen()` para usar `canMove()` | Criterio de aceptación explícito: en cada vida salen los 4. |
| Un fantasma sale justo encima de la puerta y elige bajar | Con el tile `3` como muro, `'down'` deja de ser opción. Verificado en simulación: 0 bucles con la puerta bloqueada. |
| El `returning` queda como código muerto difícil de justificar | Se documenta en `isWall()` como punto de extensión del spec de modo asustado. |

---

## What is **not** in this spec

- Modo asustado, power pellets y comer fantasmas.
- Reaparición individual tras ser comido y activación real de `returning`.
- Watchdog anti-bucle genérico.
- Cambios de velocidad, personalidad o ritmo de salida.
- HUD, sonido o cambios de dibujo.

Cada uno de esos, si llega, va en su propio spec.
