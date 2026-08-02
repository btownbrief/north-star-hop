// Drives the real vendored rooms client against the local shim as simulated
// phones, including complete 2- and 3-phone North Star Hop games.
//   node scripts/test-rooms.mjs

import { createRooms } from './rooms-shim.mjs';
import { applyMove, createInitialState, getStatus } from '../js/engine.js';
import { chooseMove } from '../js/bot.js';

const GAME = 'north-star-hop';
const stores = new Map();
let current = 'A';
globalThis.localStorage = {
  getItem: (key) => stores.get(current)?.get(key) ?? null,
  setItem: (key, value) => stores.get(current).set(key, String(value)),
  removeItem: (key) => stores.get(current).delete(key),
};
function device(id) {
  if (!stores.has(id)) stores.set(id, new Map());
  current = id;
}
for (const id of ['A', 'B', 'C', 'D']) device(id);
device('A');

let passed = 0;
function test(condition, label) {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ok — ${label}`);
}
async function expectCode(promise, code, label) {
  try { await promise; test(false, `${label} (no error)`); }
  catch (err) { test(err?.code === code, `${label} (got ${err?.code})`); }
}

const shim = createRooms();
let backendReady = true;
globalThis.BTOWN_ROOMS_URL = 'http://rooms.test';
globalThis.fetch = async (url, options = {}) => {
  if (!backendReady) return new Response('{}', { status: 404 });
  const match = String(url).match(/\/rest\/v1\/rpc\/(\w+)$/);
  if ((options.method || 'GET') !== 'POST' || !match || !shim.rpcs[match[1]]) {
    return new Response('{}', { status: 404 });
  }
  try {
    const result = shim.rpcs[match[1]](JSON.parse(options.body || '{}')) ?? {};
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ message: err.message }), { status: err.rpc ? 400 : 500 });
  }
};

const { OnlineMatch, RoomsError, savedSession } = await import('../js/rooms.js');

async function sync(phones) {
  for (const phone of phones) {
    device(phone.id);
    await phone.match._fetch();
  }
  const truth = JSON.stringify(phones[0].match.state);
  return phones.every((phone) => JSON.stringify(phone.match.state) === truth);
}

async function playCompleteGame(phones, cap) {
  let moves = 0;
  let identical = await sync(phones);
  while (!getStatus(phones[0].match.state).over && moves < cap) {
    const truth = phones[0].match.state;
    const phone = phones.find((candidate) => candidate.match.seat === truth.turn);
    if (!phone) throw new Error(`No phone for player ${truth.turn}`);
    device(phone.id);
    await phone.match._fetch();
    const move = chooseMove(phone.match.state, moves % 2 ? 'polaris' : 'navigator');
    const next = applyMove(phone.match.state, move);
    await phone.match.push(next, { over: getStatus(next).over });
    moves++;
    identical = await sync(phones);
    if (!identical) break;
  }
  return { moves, identical, finished: getStatus(phones[0].match.state).over };
}

console.log('\nGENERIC ROOM CHECKS');
device('A');
const host = await OnlineMatch.create({
  game: GAME, name: 'Aurora', seats: 2,
  state: createInitialState({ numPlayers: 2, seed: 101 }),
});
test(/^[A-Z2-9]{4}$/.test(host.code) && host.seat === 0 && host.status === 'waiting',
  'host creates a room in engine seat 0');
test(savedSession(GAME)?.roomId === host.roomId, 'host session is saved');

device('B');
await expectCode(OnlineMatch.join({ game: GAME, code: 'ZZZZ', name: 'Lost' }), 'not_found', 'unknown code is rejected');
await expectCode(OnlineMatch.join({ game: 'four-in-a-rowboat', code: host.code, name: 'Lost' }), 'wrong_game', 'code for another game is rejected');
const guest = await OnlineMatch.join({ game: GAME, code: ` ${host.code.toLowerCase()} `, name: 'Ember' });
test(guest.seat === 1 && guest.status === 'playing', 'final seat joins and starts the room');
device('A');
await host._fetch();
test(host.status === 'playing' && host.opponents()[0].name === 'Ember', 'host sees the joined name');

const first = chooseMove(host.state, 'polaris');
await host.push(applyMove(host.state, first));
test(host.version === 1, 'host pushes an engine move at version 1');
device('B');
await guest._fetch();
test(JSON.stringify(guest.state) === JSON.stringify(host.state), 'guest receives the complete state');
const reply = chooseMove(guest.state, 'polaris');
await guest.push(applyMove(guest.state, reply));
test(guest.version === 2, 'guest pushes the reply at version 2');

device('A');
const stale = applyMove(createInitialState({ numPlayers: 2, seed: 101 }), first);
await expectCode(host.push(stale), 'version_conflict', 'stale version is rejected');
test(host.version === guest.version, 'conflict refetches server truth');
test(new RoomsError('offline').code === 'offline', 'room errors expose stable codes');

console.log('\nTWO-PHONE COMPLETE GAME');
const two = await playCompleteGame([{ id: 'A', match: host }, { id: 'B', match: guest }], 300);
test(two.identical, 'two phones remain JSON-identical after every move');
test(two.finished, `two-phone game reaches a winner in ${two.moves} moves`);
test(host.status === 'over', 'engine finish marks the room over');

device('B');
const oldVersion = guest.version;
await guest.push(createInitialState({ numPlayers: 2, seed: 202 }));
test(guest.status === 'playing' && guest.version === oldVersion + 1, 'either phone can launch a rematch');
device('A');
const resumed = await OnlineMatch.resume({ game: GAME });
test(resumed.roomId === host.roomId && resumed.seat === 0, 'resume restores the same seat');
await resumed.leave();
test(savedSession(GAME) === null, 'leaving clears that device session');

device('A');
const fullHost = await OnlineMatch.create({ game: GAME, name: 'A', seats: 2, state: createInitialState({ numPlayers: 2, seed: 303 }) });
device('B');
await OnlineMatch.join({ game: GAME, code: fullHost.code, name: 'B' });
device('C');
await expectCode(OnlineMatch.join({ game: GAME, code: fullHost.code, name: 'C' }), 'room_started', 'extra phone cannot enter a started room');

console.log('\nTHREE-PHONE COMPLETE GAME');
device('A');
const host3 = await OnlineMatch.create({ game: GAME, name: 'North', seats: 3, state: createInitialState({ numPlayers: 3, seed: 404 }) });
device('B');
const guest3b = await OnlineMatch.join({ game: GAME, code: host3.code, name: 'East' });
test(guest3b.seat === 1 && guest3b.status === 'waiting', 'three-seat room waits after phone two');
device('C');
const guest3c = await OnlineMatch.join({ game: GAME, code: host3.code, name: 'West' });
test(guest3c.seat === 2 && guest3c.status === 'playing', 'phone three fills and starts the room');
const three = await playCompleteGame([
  { id: 'A', match: host3 }, { id: 'B', match: guest3b }, { id: 'C', match: guest3c },
], 350);
test(three.identical, 'all three phones remain JSON-identical after every move');
test(three.finished, `three-phone game reaches a winner in ${three.moves} moves`);
test(host3.state.numPlayers === 3 && host3.state.turn >= 0 && host3.state.turn < 3,
  'three-phone state preserves seat-to-player mapping');
device('D');
await expectCode(OnlineMatch.join({ game: GAME, code: host3.code, name: 'Late' }), 'room_started', 'fourth phone cannot join the started three-seat game');

backendReady = false;
const absent = await import('../js/rooms.js?backend-absent');
device('D');
await expectCode(absent.OnlineMatch.create({ game: GAME, name: 'A', state: {} }), 'not_ready', 'missing backend becomes not_ready');

console.log(`\nALL ROOMS TESTS PASSED (${passed} checks)`);
