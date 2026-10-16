// game.js
// Estado y reglas. Depende de globals de maze.js: MAZE, TUNNEL_ROW,
// PACMAN_START. La configuracion de los fantasmas vive aqui (GHOST_SPECS).

const DIRS = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};
const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' };

const PACMAN_SPEED = 0.125; // 1/8 celda/frame -> alinea cada 8 frames
const GHOST_SPEED = 0.1;    // 1/10 celda/frame
const PELLET_SCORE = 50;           // puntos por power pellet
const FRIGHT_FRAMES = 360;         // 6 s de modo asustado a 60 fps
const GHOST_FRIGHT_SPEED = 0.075;  // velocidad en modo asustado
const GHOST_EYES_SPEED = 0.2;      // velocidad de ojos
const GHOST_EAT_SCORE = 200;       // base de la cadena 200/400/800/1600
const PEN_REENTRY_WAIT = 60;       // 1 s en la pen antes de volver a salir

// Configuracion de los 4 fantasmas: posicion de inicio, personalidad y retardo
// de salida de la pen (en frames a 60 fps). Todo lo de los fantasmas vive aqui.
//   chaser   -> objetivo en la celda de Pacman (persigue sin pausa)
//   ambusher -> objetivo 2 celdas delante de Pacman
//   erratic  -> ese punto reflejado desde la posicion del rojo
//   shy      -> persigue si esta lejos; si esta cerca, se retira a su esquina
// La puerta de la pen (tile 3) es de un solo sentido: los fantasmas salen con
// moveGhostInPen() y una vez fuera solo vuelve a entrar quien este en el actor
// 'ghost-returning' (g.returning), activo cuando el fantasma ha sido comido en
// el modo asustado.
const GHOST_SPECS = [
  { name: 'blinky', personality: 'chaser',   x: 13, y: 14, exitDelay: 0   },
  { name: 'pinky',  personality: 'ambusher', x: 14, y: 14, exitDelay: 90  },
  { name: 'inky',   personality: 'erratic',  x: 13, y: 13, exitDelay: 180 },
  { name: 'clyde',  personality: 'shy',      x: 14, y: 13, exitDelay: 270 },
];

const AMBUSH_AHEAD = 2;               // celdas delante de Pacman que apunta el emboscador
const SHY_DISTANCE = 8;               // por debajo de esto el timido se aleja
const CLYDE_CORNER = { x: 2, y: 29 }; // esquina de retirada del timido

// Pen: limites del rebote vertical y fila en la que el fantasma ya esta fuera.
const PEN_MIN_Y = 13;
const PEN_MAX_Y = 14;
const PEN_EXIT_Y = 11;

// Celda objetivo de los ojos al volver a casa: la puerta de la pen.
const PEN_DOOR_TARGET = { x: 13, y: PEN_EXIT_Y };

// Orden fijo de direcciones: desempata de forma determinista.
const DIR_ORDER = [ 'up', 'left', 'down', 'right' ];

// Crea una partida nueva. Copia MAZE (pristino) a game.grid para poder comer
// dots sin destruir el original, y reiniciar.
function createGame() {
  const grid = MAZE.map( ( row ) => row.slice() );
  // La celda de inicio de Pacman arranca sin dot.
  grid[ PACMAN_START.y ][ PACMAN_START.x ] = 0;

  let dots = 0;
  // Dots (2) y power pellets (4): el nivel solo se gana sin ninguno de los dos.
  for ( const row of grid ) for ( const v of row ) if ( v === 2 || v === 4 ) dots++;

  return {
    state: 'start',
    score: 0,
    lives: 3,
    dotsRemaining: dots,
    grid,
    frightTimer: 0, // frames restantes de modo asustado (0 = normal)
    ghostCombo: 0,  // fantasmas comidos desde el ultimo pellet (0..3)
    pacman: {
      x: PACMAN_START.x,
      y: PACMAN_START.y,
      dir: 'left',
      nextDir: null,
      speed: PACMAN_SPEED,
    },
    ghosts: GHOST_SPECS.map( ( spec ) => ( {
      name: spec.name,
      personality: spec.personality,
      x: spec.x,
      y: spec.y,
      dir: spec.y >= PEN_MAX_Y ? 'up' : 'down',
      speed: GHOST_SPEED,
      exitDelay: spec.exitDelay,
      exitTimer: spec.exitDelay,
      inPen: true,
      returning: false, // true solo cuando un fantasma vuelve a casa
    } ) ),
  };
}

function aligned( v ) {
  return Math.abs( v - Math.round( v ) ) < 1e-3;
}

// Una celda es muro para el actor dado?
//   pacman          -> bloqueado por pared (1) y puerta (3)
//   ghost           -> bloqueado por pared (1) y puerta (3): la puerta es de
//                      un solo sentido, un fantasma ya fuera no reentra (SPEC 02)
//   ghost-returning -> bloqueado solo por pared (1); es el unico actor que
//                      cruza la puerta. Se activa al comer un fantasma con el
//                      modo asustado activo.
function isWall( grid, x, y, actor ) {
  if ( y < 0 || y >= grid.length ) return true;
  if ( x < 0 || x >= grid[ 0 ].length ) return true;
  const v = grid[ y ][ x ];
  if ( v === 1 ) return true;
  if ( v === 3 && actor !== 'ghost-returning' ) return true; // puerta de un solo sentido
  return false;
}

// Puede el actor avanzar desde (x,y) en la direccion dir?
function canMove( grid, x, y, dir, actor ) {
  const d = DIRS[ dir ];
  if ( !d ) return false;
  const tx = x + d.x;
  const ty = y + d.y;
  // Tunel: salir por un borde en la fila del tunel siempre es valido.
  if ( ty === TUNNEL_ROW && ( tx < 0 || tx >= grid[ 0 ].length ) ) return true;
  return !isWall( grid, tx, ty, actor );
}

function wrapTunnel( a, width ) {
  if ( Math.round( a.y ) === TUNNEL_ROW ) {
    if ( a.x < 0 ) a.x += width;
    else if ( a.x >= width ) a.x -= width;
  }
}

// Actor de un fantasma para las reglas de paso: 'ghost-returning' mientras
// vuelve a casa como ojos, 'ghost' en cualquier otro caso.
function ghostActor( g ) {
  return g.returning ? 'ghost-returning' : 'ghost';
}

// Velocidad efectiva de un fantasma sin mutar g.speed: los ojos vuelven rapido,
// la pen no cambia con el modo y el resto baja de velocidad con el miedo.
function ghostSpeed( game, g ) {
  if ( g.returning ) return GHOST_EYES_SPEED;
  if ( g.inPen ) return GHOST_SPEED;
  if ( game.frightTimer > 0 ) return GHOST_FRIGHT_SPEED;
  return GHOST_SPEED;
}

function movePacman( game ) {
  const p = game.pacman;
  const grid = game.grid;
  const width = grid[ 0 ].length;

  if ( aligned( p.x ) && aligned( p.y ) ) {
    p.x = Math.round( p.x );
    p.y = Math.round( p.y );

    // Aplicar giro pendiente si es posible.
    if ( p.nextDir && canMove( grid, p.x, p.y, p.nextDir, 'pacman' ) ) {
      p.dir = p.nextDir;
      p.nextDir = null;
    }
    // Comer dot.
    if ( grid[ p.y ][ p.x ] === 2 ) {
      grid[ p.y ][ p.x ] = 0;
      game.score += 10;
      game.dotsRemaining--;
    }
    // Comer power pellet: activa el modo asustado y revierte la marcha de los
    // fantasmas que estan fuera de la pen (los ojos y los de dentro no).
    else if ( grid[ p.y ][ p.x ] === 4 ) {
      grid[ p.y ][ p.x ] = 0;
      game.score += PELLET_SCORE;
      game.dotsRemaining--;
      game.frightTimer = FRIGHT_FRAMES;
      game.ghostCombo = 0;
      for ( const g of game.ghosts )
        if ( !g.inPen && !g.returning ) g.dir = OPPOSITE[ g.dir ];
    }
    // Si no puede seguir, se detiene en la celda.
    if ( !canMove( grid, p.x, p.y, p.dir, 'pacman' ) ) return;
  }

  const d = DIRS[ p.dir ];
  p.x += d.x * p.speed;
  p.y += d.y * p.speed;
  wrapTunnel( p, width );
}

// Celda objetivo de la personalidad del fantasma. El objetivo no necesita ser
// transitable: solo se usa para medir distancias al elegir direccion.
function targetFor( game, g ) {
  const p = game.pacman;
  const px = Math.round( p.x );
  const py = Math.round( p.y );

  if ( g.personality === 'chaser' ) {
    return { x: px, y: py };
  }

  // Punto al que apunta el emboscador: 2 celdas delante de Pacman.
  const pd = DIRS[ p.dir ] || { x: 0, y: 0 };
  const ahead = { x: px + pd.x * AMBUSH_AHEAD, y: py + pd.y * AMBUSH_AHEAD };

  if ( g.personality === 'ambusher' ) {
    return ahead;
  }

  if ( g.personality === 'erratic' ) {
    // Clasico: el punto de delante de Pacman, reflejado desde el rojo.
    const blinky = game.ghosts.find( ( o ) => o.name === 'blinky' );
    const bx = blinky ? Math.round( blinky.x ) : px;
    const by = blinky ? Math.round( blinky.y ) : py;
    return { x: ahead.x * 2 - bx, y: ahead.y * 2 - by };
  }

  // 'shy': persigue de lejos y se retira a su esquina cuando esta cerca.
  const dist = Math.abs( Math.round( g.x ) - px ) + Math.abs( Math.round( g.y ) - py );
  return dist < SHY_DISTANCE ? { x: CLYDE_CORNER.x, y: CLYDE_CORNER.y } : { x: px, y: py };
}

// BFS del fantasma hasta la puerta de la pen. Solo se usa para los ojos
// (returning): Manhattan greedy con 180 permitido puede orbitar un bloque
// sin acercarse nunca (Riesgos del SPEC 03), y el unico destino fijo del
// juego es la puerta. Devuelve la primera direccion del camino, o null.
function bfsToPenDoor( grid, sx, sy ) {
  const W = grid[ 0 ].length;
  const H = grid.length;
  const start = sy * W + sx;
  const goal = PEN_DOOR_TARGET.y * W + PEN_DOOR_TARGET.x;
  if ( start === goal ) return null;
  const prev = new Map( [ [ start, -1 ] ] );
  const startDir = new Map();
  const queue = [ start ];
  let head = 0;
  while ( head < queue.length ) {
    const cur = queue[ head++ ];
    if ( cur === goal ) break;
    const x = cur % W;
    const y = ( cur - x ) / W;
    for ( const dir of DIR_ORDER ) {
      const d = DIRS[ dir ];
      const nx = x + d.x;
      const ny = y + d.y;
      if ( isWall( grid, nx, ny, 'ghost-returning' ) ) continue;
      const k = ny * W + nx;
      if ( prev.has( k ) ) continue;
      prev.set( k, cur );
      startDir.set( k, cur === start ? dir : startDir.get( cur ) );
      queue.push( k );
    }
  }
  if ( !prev.has( goal ) ) return null; // inalcanzable: no deberia pasar
  // Reconstruir hasta el primer paso desde el inicio.
  let cur = goal;
  while ( prev.get( cur ) !== start && prev.get( cur ) !== -1 ) cur = prev.get( cur );
  return startDir.get( cur ) || null;
}

function decideGhost( game, g ) {
  const grid = game.grid;

  // Rama 1 (maxima prioridad): los ojos vuelven a la puerta de la pen. BFS
  // garantiza que lleguen; es el unico caso en que se permite girar 180.
  if ( g.returning ) {
    const dir = bfsToPenDoor( grid, g.x, g.y );
    if ( dir ) g.dir = dir;
    return;
  }

  // Rama 2: modo asustado -> direccion al azar entre las validas (sin 180).
  if ( game.frightTimer > 0 ) {
    const options = DIR_ORDER.filter(
      ( dir ) => dir !== OPPOSITE[ g.dir ] && canMove( grid, g.x, g.y, dir, ghostActor( g ) )
    );
    if ( !options.length ) {
      g.dir = OPPOSITE[ g.dir ]; // callejon sin salida
      return;
    }
    g.dir = options[ Math.floor( Math.random() * options.length ) ];
    return;
  }

  // Rama 3: personalidad normal, distancia Manhattan con desempate fijo.
  const target = targetFor( game, g );

  const options = DIR_ORDER.filter(
    ( dir ) => dir !== OPPOSITE[ g.dir ] && canMove( grid, g.x, g.y, dir, ghostActor( g ) )
  );
  // Sin salida (callejon): permitir el giro de 180.
  if ( !options.length ) {
    g.dir = OPPOSITE[ g.dir ];
    return;
  }

  let best = options[ 0 ];
  let bestDist = Infinity;
  for ( const dir of options ) {
    const d = DIRS[ dir ];
    const nx = g.x + d.x;
    const ny = g.y + d.y;
    const dist = Math.abs( nx - target.x ) + Math.abs( ny - target.y );
    if ( dist < bestDist ) {
      bestDist = dist;
      best = dir;
    }
  }
  g.dir = best;
}

// Dentro de la pen: espera su turno rebotando arriba/abajo y luego sube por su
// columna hasta cruzar la puerta.
function moveGhostInPen( game, g ) {
  if ( g.exitTimer > 0 ) g.exitTimer--;

  if ( aligned( g.y ) ) {
    g.y = Math.round( g.y );
    if ( g.exitTimer > 0 ) {
      if ( g.y <= PEN_MIN_Y ) g.dir = 'down';
      else if ( g.y >= PEN_MAX_Y ) g.dir = 'up';
      else if ( g.dir !== 'up' && g.dir !== 'down' ) g.dir = 'up';
    } else {
      g.dir = 'up'; // turno de salir: sube hacia la puerta
    }
  }

  g.y += DIRS[ g.dir ].y * ghostSpeed( game, g );

  if ( g.y <= PEN_EXIT_Y ) {
    g.y = PEN_EXIT_Y;
    g.inPen = false;
    decideGhost( game, g );
  }
}

// Un fantasma acaba de quedar alineado en una celda: reentrada de ojos,
// decision de direccion y comprobacion de que puede avanzar. Devuelve false
// si queda bloqueado (no debe moverse hasta que algo cambie).
function arriveAtCell( game, g ) {
  g.x = Math.round( g.x );
  g.y = Math.round( g.y );
  // Reentrada de los ojos: alineados en la puerta de la pen, se reincorporan
  // y esperan PEN_REENTRY_WAIT antes de volver a salir (SPEC 01).
  if ( g.returning && g.y === PEN_EXIT_Y && ( g.x === 13 || g.x === 14 ) ) {
    g.inPen = true;
    g.returning = false;
    g.exitTimer = PEN_REENTRY_WAIT;
    g.dir = 'up';
    return false;
  }
  decideGhost( game, g );
  return canMove( game.grid, g.x, g.y, g.dir, ghostActor( g ) );
}

function moveGhost( game, g ) {
  const width = game.grid[ 0 ].length;

  if ( g.inPen ) {
    moveGhostInPen( game, g );
    return;
  }

  if ( aligned( g.x ) && aligned( g.y ) && !arriveAtCell( game, g ) ) return;

  // Avance en sub-pasos hasta el siguiente centro de celda. Con velocidades
  // que no dividen 1 (0.075 asustado, 0.2 ojos) el fantasma puede quedar a
  // media celda tras un cambio de velocidad y nunca re-alinear con pasos
  // enteros; pararse exactamente en cada centro garantiza decidir en cada
  // cruce. Con 0.1 la trayectoria frame a frame queda identica a antes.
  let budget = ghostSpeed( game, g );
  while ( budget > 1e-9 ) {
    const d = DIRS[ g.dir ];
    const horizontal = d.x !== 0;
    const cur = horizontal ? g.x : g.y;
    const nextCenter =
      d.x + d.y > 0 ? Math.floor( cur + 1e-9 ) + 1 : Math.ceil( cur - 1e-9 ) - 1;
    const step = Math.min( budget, Math.abs( nextCenter - cur ) );
    if ( horizontal ) g.x += d.x * step;
    else g.y += d.y * step;
    budget -= step;
    wrapTunnel( g, width );
    if ( aligned( g.x ) && aligned( g.y ) && !arriveAtCell( game, g ) ) return;
  }
}

function resetPositions( game ) {
  const p = game.pacman;
  p.x = PACMAN_START.x;
  p.y = PACMAN_START.y;
  p.dir = 'left';
  p.nextDir = null;
  // Perder una vida termina el modo asustado y la cadena de comidos.
  game.frightTimer = 0;
  game.ghostCombo = 0;
  game.ghosts.forEach( ( g, i ) => {
    const spec = GHOST_SPECS[ i ];
    g.x = spec.x;
    g.y = spec.y;
    g.dir = spec.y >= PEN_MAX_Y ? 'up' : 'down';
    g.exitTimer = spec.exitDelay; // la escalera de salida se reinicia cada vida
    g.inPen = true;
    g.returning = false;
  } );
}

function collides( a, b ) {
  return Math.abs( a.x - b.x ) < 0.5 && Math.abs( a.y - b.y ) < 0.5;
}

function update( game ) {
  if ( game.frightTimer > 0 ) game.frightTimer--;

  movePacman( game );
  game.ghosts.forEach( ( g ) => moveGhost( game, g ) );

  for ( const g of game.ghosts ) {
    // Ojos (returning) e internos de la pen (inPen): ninguno colisiona. La
    // pen es intocable como en el original; los ojos son inofensivos.
    if ( g.returning || g.inPen ) continue;
    if ( !collides( game.pacman, g ) ) continue;
    if ( game.frightTimer > 0 ) {
      // Modo asustado: el fantasma se come. La cadena crece 200/400/800/1600.
      game.score += GHOST_EAT_SCORE * 2 ** game.ghostCombo;
      game.ghostCombo = Math.min( game.ghostCombo + 1, 3 );
      g.returning = true;
      continue;
    }
    game.lives--; // sin modo asustado: como hasta ahora
    if ( game.lives <= 0 ) {
      game.state = 'lost';
      return;
    }
    resetPositions( game );
    break;
  }

  if ( game.dotsRemaining <= 0 ) game.state = 'won';
}

window.createGame = createGame;
window.update = update;
window.DIRS = DIRS;
