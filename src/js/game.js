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

// Configuracion de los 4 fantasmas: posicion de inicio, personalidad y retardo
// de salida de la pen (en frames a 60 fps). Todo lo de los fantasmas vive aqui.
//   chaser   -> objetivo en la celda de Pacman (persigue sin pausa)
//   ambusher -> objetivo 2 celdas delante de Pacman
//   erratic  -> ese punto reflejado desde la posicion del rojo
//   shy      -> persigue si esta lejos; si esta cerca, se retira a su esquina
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

// Orden fijo de direcciones: desempata de forma determinista.
const DIR_ORDER = [ 'up', 'left', 'down', 'right' ];

// Crea una partida nueva. Copia MAZE (pristino) a game.grid para poder comer
// dots sin destruir el original, y reiniciar.
function createGame() {
  const grid = MAZE.map( ( row ) => row.slice() );
  // La celda de inicio de Pacman arranca sin dot.
  grid[ PACMAN_START.y ][ PACMAN_START.x ] = 0;

  let dots = 0;
  for ( const row of grid ) for ( const v of row ) if ( v === 2 ) dots++;

  return {
    state: 'start',
    score: 0,
    lives: 3,
    dotsRemaining: dots,
    grid,
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
    } ) ),
  };
}

function aligned( v ) {
  return Math.abs( v - Math.round( v ) ) < 1e-3;
}

// Una celda es muro para el actor dado?
//   pacman: bloqueado por pared (1) y puerta (3)
//   ghost:  bloqueado solo por pared (1)
function isWall( grid, x, y, actor ) {
  if ( y < 0 || y >= grid.length ) return true;
  if ( x < 0 || x >= grid[ 0 ].length ) return true;
  const v = grid[ y ][ x ];
  if ( v === 1 ) return true;
  if ( v === 3 && actor === 'pacman' ) return true;
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

function decideGhost( game, g ) {
  const grid = game.grid;
  const target = targetFor( game, g );

  const options = DIR_ORDER.filter(
    ( dir ) => dir !== OPPOSITE[ g.dir ] && canMove( grid, g.x, g.y, dir, 'ghost' )
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

  g.y += DIRS[ g.dir ].y * g.speed;

  if ( g.y <= PEN_EXIT_Y ) {
    g.y = PEN_EXIT_Y;
    g.inPen = false;
    decideGhost( game, g );
  }
}

function moveGhost( game, g ) {
  const grid = game.grid;
  const width = grid[ 0 ].length;

  if ( g.inPen ) {
    moveGhostInPen( game, g );
    return;
  }

  if ( aligned( g.x ) && aligned( g.y ) ) {
    g.x = Math.round( g.x );
    g.y = Math.round( g.y );
    decideGhost( game, g );
    if ( !canMove( grid, g.x, g.y, g.dir, 'ghost' ) ) return;
  }

  const d = DIRS[ g.dir ];
  g.x += d.x * g.speed;
  g.y += d.y * g.speed;
  wrapTunnel( g, width );
}

function resetPositions( game ) {
  const p = game.pacman;
  p.x = PACMAN_START.x;
  p.y = PACMAN_START.y;
  p.dir = 'left';
  p.nextDir = null;
  game.ghosts.forEach( ( g, i ) => {
    const spec = GHOST_SPECS[ i ];
    g.x = spec.x;
    g.y = spec.y;
    g.dir = spec.y >= PEN_MAX_Y ? 'up' : 'down';
    g.exitTimer = spec.exitDelay; // la escalera de salida se reinicia cada vida
    g.inPen = true;
  } );
}

function collides( a, b ) {
  return Math.abs( a.x - b.x ) < 0.5 && Math.abs( a.y - b.y ) < 0.5;
}

function update( game ) {
  movePacman( game );
  game.ghosts.forEach( ( g ) => moveGhost( game, g ) );

  for ( const g of game.ghosts ) {
    if ( collides( game.pacman, g ) ) {
      game.lives--;
      if ( game.lives <= 0 ) {
        game.state = 'lost';
        return;
      }
      resetPositions( game );
      break;
    }
  }

  if ( game.dotsRemaining <= 0 ) game.state = 'won';
}

window.createGame = createGame;
window.update = update;
window.DIRS = DIRS;
