// NORTH STAR HOP — pure game rules.
//
// The 121 holes live on an axial hex grid. The central radius-4 hexagon is
// joined by six 10-hole triangles, so adjacency and chained hops are exact
// in all six directions. This module has no browser, clock, or random APIs.

export const DIRECTIONS = Object.freeze([
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
]);

const keyOf = (q, r) => `${q},${r}`;
const fromKey = (key) => key.split(',').map(Number);

function rotate60([q, r]) {
  return [-r, q + r];
}

const center = [];
for (let q = -4; q <= 4; q++) {
  for (let r = -4; r <= 4; r++) {
    if (Math.abs(q + r) <= 4) center.push([q, r]);
  }
}

const northTriangle = [];
for (let r = -8; r <= -5; r++) {
  for (let q = -r - 4; q <= 4; q++) northTriangle.push([q, r]);
}

const armCoords = [];
let rotated = northTriangle;
for (let arm = 0; arm < 6; arm++) {
  armCoords.push(rotated.map(([q, r]) => [q, r]));
  rotated = rotated.map(rotate60);
}

const allCoords = [...center, ...armCoords.flat()];
const coordByKey = new Map(allCoords.map(([q, r]) => [keyOf(q, r), Object.freeze({ q, r })]));

export const BOARD_CELLS = Object.freeze(
  [...coordByKey.values()]
    .sort((a, b) => a.r - b.r || a.q - b.q)
    .map((cell) => Object.freeze({ ...cell, key: keyOf(cell.q, cell.r) })),
);

export const ARM_CELLS = Object.freeze(
  armCoords.map((coords) => Object.freeze(coords.map(([q, r]) => keyOf(q, r)).sort())),
);

// Arm 0 is north; numbering proceeds clockwise. Player 0 always begins at
// the southern point so their destination is visually obvious at the top.
const START_ARMS = Object.freeze({
  2: Object.freeze([3, 0]),
  3: Object.freeze([3, 5, 1]),
  4: Object.freeze([3, 4, 0, 1]),
});

export const PLAYER_COLORS = Object.freeze(['aurora', 'ember', 'moon', 'violet']);

function normalizeSeed(seed) {
  const n = Number(seed);
  return Number.isFinite(n) ? (n >>> 0) || 0x6d2b79f5 : 0x6d2b79f5;
}

function nextRng(value) {
  let x = value >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

function assertPlayerCount(numPlayers) {
  if (![2, 3, 4].includes(numPlayers)) {
    throw new Error('North Star Hop supports 2, 3, or 4 players.');
  }
}

/** Build a fresh, JSON-safe state. Seat 0 always opens. */
export function createInitialState(options = {}) {
  const numPlayers = Number(options.numPlayers ?? 2);
  assertPlayerCount(numPlayers);
  const cells = {};
  const homes = START_ARMS[numPlayers];
  homes.forEach((arm, player) => {
    for (const key of ARM_CELLS[arm]) cells[key] = player;
  });
  return {
    game: 'north-star-hop',
    rulesVersion: 1,
    numPlayers,
    turn: 0,
    moveNumber: 0,
    rng: normalizeSeed(options.seed),
    cells,
    winner: null,
    lastMove: null,
  };
}

export function playerArm(state, player) {
  assertPlayerCount(state.numPlayers);
  if (!Number.isInteger(player) || player < 0 || player >= state.numPlayers) {
    throw new Error('Invalid player.');
  }
  return START_ARMS[state.numPlayers][player];
}

export function targetCells(state, player) {
  return ARM_CELLS[(playerArm(state, player) + 3) % 6];
}

export function piecesFor(state, player) {
  return Object.keys(state.cells).filter((key) => state.cells[key] === player).sort();
}

function isEmpty(state, key) {
  return coordByKey.has(key) && state.cells[key] === undefined;
}

function movesFrom(state, source) {
  const [q, r] = fromKey(source);
  const moves = [];

  for (const [dq, dr] of DIRECTIONS) {
    const to = keyOf(q + dq, r + dr);
    if (isEmpty(state, to)) moves.push({ type: 'step', from: source, to, path: [source, to] });
  }

  // The moving marble is removed from its source while exploring. Every
  // prior landing is likewise empty; only its current position is occupied.
  const fixedOccupied = new Set(Object.keys(state.cells));
  fixedOccupied.delete(source);
  const visited = new Set([source]);
  const found = new Map();

  function explore(current, path) {
    const [cq, cr] = fromKey(current);
    for (const [dq, dr] of DIRECTIONS) {
      const middle = keyOf(cq + dq, cr + dr);
      const landing = keyOf(cq + 2 * dq, cr + 2 * dr);
      if (!coordByKey.has(landing) || !fixedOccupied.has(middle)) continue;
      if (fixedOccupied.has(landing) || visited.has(landing)) continue;
      visited.add(landing);
      const nextPath = [...path, landing];
      found.set(landing, { type: 'hop', from: source, to: landing, path: nextPath });
      explore(landing, nextPath);
    }
  }

  explore(source, [source]);
  moves.push(...found.values());
  return moves;
}

/** Every legal step and every endpoint in the full chained-hop closure. */
export function legalMoves(state) {
  if (getStatus(state).over) return [];
  return piecesFor(state, state.turn)
    .flatMap((source) => movesFrom(state, source))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type));
}

function sameMove(candidate, requested) {
  if (!requested || candidate.from !== requested.from || candidate.to !== requested.to) return false;
  if (requested.type && candidate.type !== requested.type) return false;
  if (requested.path) return JSON.stringify(candidate.path) === JSON.stringify(requested.path);
  return true;
}

function hasWon(state, player) {
  return targetCells(state, player).every((key) => state.cells[key] === player);
}

/** Apply one engine-issued move and return a completely new state. */
export function applyMove(state, move) {
  const chosen = legalMoves(state).find((candidate) => sameMove(candidate, move));
  if (!chosen) throw new Error('Illegal move.');
  const player = state.turn;
  const cells = { ...state.cells };
  delete cells[chosen.from];
  cells[chosen.to] = player;
  const next = {
    ...state,
    cells,
    moveNumber: state.moveNumber + 1,
    rng: nextRng(state.rng),
    lastMove: { ...chosen, player },
  };
  if (hasWon(next, player)) {
    next.winner = player;
  } else {
    next.turn = (player + 1) % state.numPlayers;
  }
  return next;
}

export function getStatus(state) {
  const over = Number.isInteger(state.winner);
  return {
    status: over ? 'won' : 'active',
    over,
    winner: over ? state.winner : null,
    turn: state.turn,
    moveNumber: state.moveNumber,
  };
}

function cubeDistance(a, b) {
  const aq = a.q;
  const ar = a.r;
  const bq = b.q;
  const br = b.r;
  return (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs((aq + ar) - (bq + br))) / 2;
}

/** Bot-facing positional score: larger means closer to the destination. */
export function progressScore(state, player) {
  const goals = targetCells(state, player).map((key) => coordByKey.get(key));
  const pieces = piecesFor(state, player).map((key) => coordByKey.get(key));
  let score = 0;
  for (const piece of pieces) {
    let nearest = Infinity;
    for (const goal of goals) nearest = Math.min(nearest, cubeDistance(piece, goal));
    score -= nearest;
    if (goals.some((goal) => goal.q === piece.q && goal.r === piece.r)) score += 4;
  }
  if (state.winner === player) score += 10000;
  return score;
}

export function isBoardCell(key) {
  return coordByKey.has(key);
}
