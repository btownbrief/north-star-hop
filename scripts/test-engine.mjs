// North Star Hop engine + bot tests. No framework required.
//   node scripts/test-engine.mjs

import {
  ARM_CELLS, BOARD_CELLS, DIRECTIONS, applyMove, createInitialState, getStatus,
  isBoardCell, legalMoves, piecesFor, targetCells,
} from '../js/engine.js';
import { chooseMove } from '../js/bot.js';

let passed = 0;
function test(condition, label, quiet = false) {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  if (!quiet) console.log(`  ok — ${label}`);
}

function bareState(numPlayers = 2, cells = {}, turn = 0) {
  return {
    game: 'north-star-hop', rulesVersion: 1, numPlayers, turn,
    moveNumber: 0, rng: 123, cells, winner: null, lastMove: null,
  };
}

console.log('\nBOARD + SETUP');
test(BOARD_CELLS.length === 121 && new Set(BOARD_CELLS.map((c) => c.key)).size === 121,
  'classic star has 121 unique holes');
test(ARM_CELLS.length === 6 && ARM_CELLS.every((arm) => arm.length === 10),
  'all six points contain 10 holes');
for (const numPlayers of [2, 3, 4]) {
  const state = createInitialState({ numPlayers, seed: 99 });
  test(Object.keys(state.cells).length === numPlayers * 10,
    `${numPlayers}-player setup places 10 marbles per seat`);
  test([...Array(numPlayers).keys()].every((p) => piecesFor(state, p).length === 10),
    `${numPlayers}-player setup preserves each color count`);
  test(state.turn === 0 && state.numPlayers === numPlayers,
    `${numPlayers}-player game opens in host seat 0`);
}

console.log('\nMOVEMENT');
const stepState = bareState(2, { '0,0': 0 });
const steps = legalMoves(stepState);
test(steps.length === 6 && steps.every((move) => move.type === 'step'),
  'a lone central marble can step in all six directions');

const chainState = bareState(2, { '0,0': 0, '1,0': 1, '3,0': 1 });
const chain = legalMoves(chainState).find((move) => move.to === '4,0');
test(chain?.type === 'hop' && chain.path.join('|') === '0,0|2,0|4,0',
  'full chain-hop closure finds a two-hop destination');
test(legalMoves(bareState(3, { '0,0': 0, '1,0': 2 })).some((move) => move.to === '2,0'),
  'a marble may hop over any color');

const before = JSON.stringify(chainState);
const after = applyMove(chainState, chain);
test(JSON.stringify(chainState) === before && after !== chainState && after.cells !== chainState.cells,
  'applyMove is immutable');
test(after.cells['0,0'] === undefined && after.cells['4,0'] === 0 && after.turn === 1,
  'a chain moves one marble and advances the turn once');
let illegalRejected = false;
try { applyMove(chainState, { from: '0,0', to: '4,1' }); } catch { illegalRejected = true; }
test(illegalRejected, 'an invented destination is rejected');

console.log('\nTURN ROTATION');
for (const numPlayers of [2, 3, 4]) {
  let state = createInitialState({ numPlayers, seed: 7 });
  let good = true;
  for (let expected = 1; expected <= numPlayers; expected++) {
    state = applyMove(state, legalMoves(state)[0]);
    good &&= state.turn === expected % numPlayers;
  }
  test(good, `${numPlayers}-player turns rotate through every seat`);
}

console.log('\nWIN + SERIALIZATION');
const winBase = createInitialState({ numPlayers: 2, seed: 808 });
const goals = targetCells(winBase, 0);
let winState;
let winningMove;
for (const missing of goals) {
  const [mq, mr] = missing.split(',').map(Number);
  for (const [dq, dr] of DIRECTIONS) {
    const source = `${mq + dq},${mr + dr}`;
    if (!isBoardCell(source) || goals.includes(source)) continue;
    const cells = Object.fromEntries(goals.filter((key) => key !== missing).map((key) => [key, 0]));
    cells[source] = 0;
    const candidate = bareState(2, cells);
    const move = legalMoves(candidate).find((item) => item.to === missing);
    if (move) { winState = candidate; winningMove = move; break; }
  }
  if (winningMove) break;
}
test(Boolean(winningMove), 'constructed final approach has a legal move');
const won = applyMove(winState, winningMove);
test(getStatus(won).over && getStatus(won).winner === 0,
  'filling the opposite 10-hole point wins immediately');
test(legalMoves(won).length === 0, 'no moves are offered after the first finisher');

const serialStart = createInitialState({ numPlayers: 4, seed: 0x12345678 });
const serialA = applyMove(serialStart, legalMoves(serialStart)[3]);
const serialB = JSON.parse(JSON.stringify(serialA));
test(JSON.stringify(serialA) === JSON.stringify(serialB) && legalMoves(serialA).length === legalMoves(serialB).length,
  'state survives JSON stringify, parse, and resume');
const deterministicStartA = createInitialState({ numPlayers: 3, seed: 42 });
const deterministicStartB = createInitialState({ numPlayers: 3, seed: 42 });
const deterministicA = applyMove(deterministicStartA, legalMoves(deterministicStartA)[0]);
const deterministicB = applyMove(deterministicStartB, legalMoves(deterministicStartB)[0]);
test(JSON.stringify(deterministicA) === JSON.stringify(deterministicB) && deterministicA.rng !== 42,
  'seeded state evolution is deterministic');

console.log('\nBOTS');
for (const level of ['polaris', 'navigator']) {
  const botState = createInitialState({ numPlayers: 2, seed: 2026 });
  const start = performance.now();
  const move = chooseMove(botState, level);
  const elapsed = performance.now() - start;
  test(legalMoves(botState).some((item) => JSON.stringify(item) === JSON.stringify(move)),
    `${level} returns an engine-legal move`);
  test(elapsed < 300, `${level} chooses in ${elapsed.toFixed(1)}ms (under 300ms)`);
}

console.log('\nRANDOM LEGAL SOAK');
let random = 0xc0ffee;
function pick(items) {
  random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
  return items[random % items.length];
}
let soakMoves = 0;
for (let game = 0; game < 200; game++) {
  const numPlayers = 2 + (game % 3);
  let state = createInitialState({ numPlayers, seed: game + 1 });
  for (let moveNo = 0; moveNo < 30 && !getStatus(state).over; moveNo++) {
    const moves = legalMoves(state);
    test(moves.length > 0, `soak game ${game + 1} move ${moveNo + 1} has a legal continuation`, true);
    const previousCounts = [...Array(numPlayers).keys()].map((p) => piecesFor(state, p).length);
    state = applyMove(state, pick(moves));
    const valid = Object.keys(state.cells).every(isBoardCell)
      && previousCounts.every((count, p) => piecesFor(state, p).length === count)
      && state.turn >= 0 && state.turn < numPlayers;
    test(valid, `soak game ${game + 1} move ${moveNo + 1} preserves board invariants`, true);
    soakMoves++;
  }
}
console.log(`  ${soakMoves} random legal moves across 200 games`);

console.log(`\nALL ENGINE TESTS PASSED (${passed} checks)`);
