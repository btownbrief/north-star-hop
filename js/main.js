// NORTH STAR HOP — UI and online room wiring only. Every legal-move and win
// decision comes from engine.js; bot.js owns computer decisions.

import {
  BOARD_CELLS, PLAYER_COLORS, applyMove, createInitialState, getStatus, legalMoves,
} from './engine.js';
import { BOTS, chooseMove } from './bot.js';
import { OnlineMatch, clearSession, getName, savedSession } from './rooms.js';
import {
  lbEnabled, fetchTop, submitScore, renamePlayer, monthLabel,
  getName as lbGetName, playerId as lbPlayerId,
} from './leaderboard.js';

const $ = (id) => document.getElementById(id);
const GAME = 'north-star-hop';
const COLOR_VALUES = ['#5ff3c3', '#ff8066', '#ffe8a3', '#c7a5ff'];
const COLOR_NAMES = ['AURORA', 'EMBER', 'MOON', 'VIOLET'];

const menuEl = $('menu');
const gameEl = $('game');
const boardEl = $('board');
const onlinePanel = $('onlinePanel');
const opName = $('opName');
const opCode = $('opCode');
const opCodeWrap = $('opCodeWrap');
const opSeatsWrap = $('opSeatsWrap');
const opError = $('opError');
const lobbyEl = $('lobby');
const lobbyCode = $('lobbyCode');
const lobbyNames = $('lobbyNames');
const rejoinBtn = $('rejoinBtn');

let state = createInitialState({ numPlayers: 2, seed: 1 });
let mode = 'pass'; // pass | polaris | navigator | online
let localPlayers = 2;
let selected = null;
let busy = false;
let botTimer = 0;
let panelIntent = 'host';
let selectedSeats = 2;
let online = null; // { match, myPlayer }
let pollErrors = 0;
let lbRecorded = false; // one leaderboard submission per finished bot game

const holes = new Map();
const projected = BOARD_CELLS.map(({ q, r }) => ({ x: q + r / 2, y: r * Math.sqrt(3) / 2 }));
const minX = Math.min(...projected.map((p) => p.x));
const maxX = Math.max(...projected.map((p) => p.x));
const minY = Math.min(...projected.map((p) => p.y));
const maxY = Math.max(...projected.map((p) => p.y));

BOARD_CELLS.forEach((cell, index) => {
  const point = projected[index];
  const hole = document.createElement('button');
  hole.className = 'hole';
  hole.dataset.key = cell.key;
  hole.style.left = `${3 + 94 * (point.x - minX) / (maxX - minX)}%`;
  hole.style.top = `${2 + 96 * (point.y - minY) / (maxY - minY)}%`;
  hole.setAttribute('role', 'gridcell');
  hole.addEventListener('click', () => onHoleTap(cell.key));
  boardEl.appendChild(hole);
  holes.set(cell.key, hole);
});

function freshSeed() {
  const words = new Uint32Array(1);
  crypto.getRandomValues(words);
  return words[0] || 1;
}

function playerName(player) {
  if (mode === 'online' && online) {
    if (player === online.myPlayer) return 'You';
    const seat = online.match.seats.find((entry) => entry.seat === player);
    return seat?.name || `Stargazer ${player + 1}`;
  }
  if ((mode === 'polaris' || mode === 'navigator') && player === 1) return BOTS[mode].name;
  if ((mode === 'polaris' || mode === 'navigator') && player === 0) return 'You';
  return `Stargazer ${player + 1}`;
}

function startLocal(chosenMode, numPlayers = 2) {
  leaveOnline(false);
  mode = chosenMode;
  localPlayers = numPlayers;
  state = createInitialState({ numPlayers, seed: freshSeed() });
  selected = null;
  busy = false;
  lbRecorded = false;
  resetLbPanel();
  menuEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  $('result').classList.add('hidden');
  render();
}

function canMove() {
  if (busy || getStatus(state).over) return false;
  if (mode === 'pass') return true;
  if (mode === 'online') return online && online.match.status === 'playing' && state.turn === online.myPlayer;
  return state.turn === 0;
}

function movesForSelection() {
  return selected ? legalMoves(state).filter((move) => move.from === selected) : [];
}

function onHoleTap(key) {
  if (!canMove()) return;
  const owner = state.cells[key];
  if (owner === state.turn) {
    const pieceMoves = legalMoves(state).filter((move) => move.from === key);
    selected = pieceMoves.length ? key : null;
    render();
    return;
  }
  const move = movesForSelection().find((candidate) => candidate.to === key);
  if (move) playMove(move);
}

async function playMove(move) {
  if (busy) return;
  busy = true;
  selected = null;
  state = applyMove(state, move);
  render();

  if (online) {
    try {
      await online.match.push(state, { over: getStatus(state).over });
    } catch (err) {
      if (err?.code === 'version_conflict') state = online.match.state;
      else showTransient(`The sky went cloudy — ${friendly(err)}`);
    }
  }
  busy = false;
  render();
  scheduleBotIfNeeded();
}

function scheduleBotIfNeeded() {
  clearTimeout(botTimer);
  if (!['polaris', 'navigator'].includes(mode) || state.turn !== 1 || getStatus(state).over) return;
  busy = true;
  render();
  botTimer = setTimeout(() => {
    const move = chooseMove(state, mode);
    busy = false;
    if (move) playMove(move);
  }, mode === 'navigator' ? 560 : 390);
}

function render() {
  const moves = legalMoves(state);
  if (selected && !moves.some((move) => move.from === selected)) selected = null;
  const destinations = new Set(movesForSelection().map((move) => move.to));
  const playable = new Set(moves.map((move) => move.from));
  const last = state.lastMove;

  for (const [key, hole] of holes) {
    const owner = state.cells[key];
    hole.className = 'hole';
    hole.style.removeProperty('--piece-color');
    hole.textContent = '';
    if (owner !== undefined) {
      hole.classList.add('piece', PLAYER_COLORS[owner]);
      hole.style.setProperty('--piece-color', COLOR_VALUES[owner]);
      hole.setAttribute('aria-label', `${playerName(owner)} marble`);
      if (canMove() && owner === state.turn && playable.has(key)) hole.classList.add('selectable');
    } else {
      hole.setAttribute('aria-label', destinations.has(key) ? 'Reachable hole' : 'Empty hole');
    }
    if (key === selected) hole.classList.add('selected');
    if (destinations.has(key)) hole.classList.add('reachable');
    if (last?.from === key) hole.classList.add('last-from');
    if (last?.to === key) hole.classList.add('last-to');
  }

  $('moveCount').textContent = `${state.moveNumber} ${state.moveNumber === 1 ? 'MOVE' : 'MOVES'}`;
  renderLegend();
  renderTurn();
  renderResult();
}

function renderLegend() {
  const legend = $('legend');
  legend.innerHTML = '';
  for (let player = 0; player < state.numPlayers; player++) {
    const item = document.createElement('span');
    item.className = `legend-player${state.turn === player ? ' active' : ''}`;
    item.style.setProperty('--player-color', COLOR_VALUES[player]);
    const dot = document.createElement('i');
    const name = document.createElement('span');
    name.textContent = playerName(player);
    item.append(dot, name);
    legend.appendChild(item);
  }
}

function renderTurn() {
  const status = getStatus(state);
  $('turnCard').style.setProperty('--player-color', COLOR_VALUES[state.turn]);
  if (status.over) {
    $('turnKicker').textContent = 'JOURNEY COMPLETE';
    $('turnText').textContent = `${playerName(status.winner)} found the far point`;
    $('boardHint').textContent = 'Every marble made it across the sky.';
    return;
  }
  if (busy && ['polaris', 'navigator'].includes(mode)) {
    $('turnKicker').textContent = `${playerName(state.turn)} IS CHARTING`;
    $('turnText').textContent = 'Reading the constellations…';
    $('boardHint').textContent = 'A route is taking shape.';
  } else if (mode === 'online' && state.turn !== online?.myPlayer) {
    const seat = online?.match.seats.find((entry) => entry.seat === state.turn);
    $('turnKicker').textContent = seat?.left ? 'CREW MEMBER LEFT' : 'WAITING UNDER THE SKY';
    $('turnText').textContent = `${playerName(state.turn)} is choosing`;
    $('boardHint').textContent = 'Their move will appear here.';
  } else {
    $('turnKicker').textContent = mode === 'pass' ? `${playerName(state.turn).toUpperCase()}'S TURN` : 'YOUR TURN';
    $('turnText').textContent = selected ? `${movesForSelection().length} routes glow` : 'Choose a marble';
    $('boardHint').textContent = selected ? 'Tap or drop it on a glowing landing spot' : 'Tap or drag one of your glowing marbles';
  }
}

function renderResult() {
  const status = getStatus(state);
  const disconnected = mode === 'online' && online?.match.status === 'over' && !status.over;
  $('result').classList.toggle('hidden', !status.over && !disconnected);
  if (!status.over && !disconnected) return;
  if (disconnected) {
    $('resultTitle').textContent = 'CREW DISBANDED';
    $('resultCopy').textContent = 'A stargazer left the night sky.';
    $('rematchBtn').classList.add('hidden');
  } else {
    $('resultTitle').textContent = `${playerName(status.winner).toUpperCase()} WINS`;
    $('resultCopy').textContent = 'All 10 marbles reached the opposite point.';
    $('rematchBtn').classList.remove('hidden');
  }
  // Guiding-star games only: record exactly once per finished game, then the
  // panel just stays as rendered while renderResult repaints. Losses show
  // the standings read-only (score 0). Never in pass-and-play or online.
  if (status.over && (mode === 'polaris' || mode === 'navigator') && !lbRecorded) {
    lbRecorded = true;
    updateLeaderboard(status.winner === 0 ? botWinScore(status) : 0);
  }
}

function rematch() {
  const numPlayers = state.numPlayers;
  const fresh = createInitialState({ numPlayers, seed: freshSeed() });
  lbRecorded = false;
  resetLbPanel();
  if (!online) {
    state = fresh;
    selected = null;
    $('result').classList.add('hidden');
    render();
    scheduleBotIfNeeded();
    return;
  }
  online.match.push(fresh).then(() => {
    state = fresh;
    selected = null;
    $('result').classList.add('hidden');
    render();
  }).catch((err) => {
    if (err?.code === 'version_conflict') state = online.match.state;
    render();
  });
}

function showTransient(message) {
  $('boardHint').textContent = message;
  setTimeout(() => renderTurn(), 2200);
}

function backToMenu() {
  if (online && $('backBtn').dataset.armed !== '1') {
    $('backBtn').dataset.armed = '1';
    $('backBtn').textContent = 'LEAVE CREW?';
    setTimeout(() => {
      $('backBtn').dataset.armed = '';
      $('backBtn').textContent = '← NIGHT SKY';
    }, 2500);
    return;
  }
  leaveOnline(true);
  clearTimeout(botTimer);
  busy = false;
  selected = null;
  $('result').classList.add('hidden');
  gameEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
  refreshRejoin();
}

function leaveOnline(notify) {
  if (!online) return;
  const match = online.match;
  online = null;
  if (notify) match.leave();
  else match.stop();
  $('backBtn').dataset.armed = '';
  $('backBtn').textContent = '← NIGHT SKY';
}

/* ------------------------------------------------------------- leaderboard */
// Monthly board for guiding-star (vs-bot) wins only. Score rewards finishing
// in fewer of YOUR moves: base = 200 − your moves (clamped 1..999), +1000 for
// Navigator wins so any Navigator win outranks any Polaris win.

const lbBox = $('lb');
const lbList = $('lbList');
const lbStatusEl = $('lbStatus');
const lbForm = $('lbForm');
const lbNameInput = $('lbNameInput');
const lbThisBtn = $('lbThisBtn');
const lbLastBtn = $('lbLastBtn');
const lbRenameBtn = $('lbRenameBtn');
let lbMonthOffset = 0;

if (lbEnabled()) {
  lbThisBtn.textContent = `🏆 ${monthLabel(0)}`;
  lbLastBtn.textContent = monthLabel(-1);
}

function resetLbPanel() {
  lbBox.classList.add('hidden');
  lbForm.classList.add('hidden');
  lbForm.dataset.pendingScore = '';
}

// Player 0 opens and made the winning (last) move, so in a 2-player bot game
// the human played ceil(moveNumber / 2) of the moves.
function botWinScore(status) {
  const yourMoves = Math.ceil(status.moveNumber / 2);
  const base = Math.max(1, Math.min(999, 200 - yourMoves));
  return mode === 'navigator' ? 1000 + base : base;
}

// s >= 1000 means a Navigator win (base = s - 1000); otherwise Polaris.
function lbScoreLabel(s) {
  const navigator = s >= 1000;
  const hops = 200 - (navigator ? s - 1000 : s);
  return navigator ? `🧭 ${hops} hops` : `⭐ ${hops} hops`;
}

// score > 0 submits a fresh win; score 0 just shows the standings read-only
async function updateLeaderboard(score) {
  if (!lbEnabled()) return;
  lbBox.classList.remove('hidden');
  if (score > 0 && !lbGetName()) {
    // first win with no saved name: hold the score until they pick one
    lbForm.classList.remove('hidden');
    lbRenameBtn.classList.add('hidden');
    lbStatusEl.textContent = 'Pick a name to join the monthly leaderboard!';
    lbList.innerHTML = '';
    lbForm.dataset.pendingScore = String(score);
    return;
  }
  if (score > 0) {
    try { await submitScore(score); } catch { /* offline — still show the board */ }
  }
  renderLbBoard();
}

async function renderLbBoard() {
  lbForm.classList.add('hidden');
  lbRenameBtn.classList.remove('hidden');
  lbStatusEl.textContent = 'Loading…';
  try {
    const rows = await fetchTop(lbMonthOffset);
    const me = lbPlayerId();
    lbList.innerHTML = '';
    rows.slice(0, 10).forEach((row, i) => {
      const li = document.createElement('li');
      if (row.player_id === me) li.className = 'me';
      const medal = ['🥇', '🥈', '🥉'][i];
      li.innerHTML = '<span class="rank"></span><span class="nm"></span><span class="sc"></span>';
      li.querySelector('.rank').textContent = medal || `${i + 1}.`;
      li.querySelector('.nm').textContent = row.name;
      li.querySelector('.sc').textContent = lbScoreLabel(row.score);
      lbList.appendChild(li);
    });
    const myRank = rows.findIndex((row) => row.player_id === me);
    lbStatusEl.textContent = rows.length === 0
      ? 'No scores yet this month — be the first!'
      : myRank >= 0 ? `You're #${myRank + 1} of ${rows.length} this month` : '';
  } catch {
    lbStatusEl.textContent = 'Leaderboard unavailable (offline?)';
  }
}

$('lbSaveBtn').addEventListener('click', async () => {
  const name = lbNameInput.value.trim();
  if (!name) { lbNameInput.focus(); return; }
  const pending = Number(lbForm.dataset.pendingScore || 0);
  lbForm.dataset.pendingScore = '';
  try {
    await renamePlayer(name); // saves locally + renames any existing rows
    if (pending > 0) await submitScore(pending);
  } catch { /* offline — the name is still saved locally */ }
  renderLbBoard();
});
lbNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') $('lbSaveBtn').click();
});
lbRenameBtn.addEventListener('click', () => {
  lbNameInput.value = lbGetName();
  lbForm.classList.remove('hidden');
  lbRenameBtn.classList.add('hidden');
  lbNameInput.focus();
});
lbThisBtn.addEventListener('click', () => {
  lbMonthOffset = 0;
  lbThisBtn.classList.add('sel');
  lbLastBtn.classList.remove('sel');
  renderLbBoard();
});
lbLastBtn.addEventListener('click', () => {
  lbMonthOffset = -1;
  lbLastBtn.classList.add('sel');
  lbThisBtn.classList.remove('sel');
  renderLbBoard();
});

/* ------------------------------------------------------------- drag */

// Marbles move by tap-tap or by drag. Listeners live on window so a
// pointerup outside the board can never strand a drag mid-flight.
const ghost = document.createElement('div');
ghost.className = 'drag-ghost hidden';
document.body.appendChild(ghost);

let drag = null; // { from, pointerId, startX, startY, lifted, overKey }

boardEl.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || drag || !canMove()) return;
  const key = event.target.closest('.hole')?.dataset.key;
  if (!key || state.cells[key] !== state.turn) return;
  if (!legalMoves(state).some((move) => move.from === key)) return;
  drag = { from: key, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lifted: false, overKey: null };
});

function holeKeyAt(x, y) {
  return document.elementFromPoint(x, y)?.closest('.hole')?.dataset.key ?? null;
}

function liftMarble() {
  drag.lifted = true;
  selected = drag.from;
  render();
  const rect = holes.get(drag.from).getBoundingClientRect();
  ghost.style.width = `${rect.width + 3}px`;
  ghost.style.setProperty('--piece-color', COLOR_VALUES[state.turn]);
  ghost.classList.remove('hidden');
}

window.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.lifted) {
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7) return;
    liftMarble();
  }
  ghost.style.left = `${event.clientX}px`;
  ghost.style.top = `${event.clientY}px`;
  const overKey = holeKeyAt(event.clientX, event.clientY);
  if (overKey !== drag.overKey) {
    holes.get(drag.overKey)?.classList.remove('drag-over');
    drag.overKey = overKey;
    const target = holes.get(overKey);
    if (target?.classList.contains('reachable')) target.classList.add('drag-over');
  }
  holes.get(drag.from)?.classList.add('drag-source');
});

function endDrag(event, dropped) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { from, lifted, overKey } = drag;
  drag = null;
  ghost.classList.add('hidden');
  holes.get(from)?.classList.remove('drag-source');
  holes.get(overKey)?.classList.remove('drag-over');
  if (!lifted) return; // a plain tap — the click handler owns it
  const to = dropped ? holeKeyAt(event.clientX, event.clientY) : null;
  const move = to && canMove() && state.cells[from] === state.turn
    ? legalMoves(state).find((candidate) => candidate.from === from && candidate.to === to)
    : null;
  if (move) playMove(move);
  else render();
}

window.addEventListener('pointerup', (event) => endDrag(event, true));
window.addEventListener('pointercancel', (event) => endDrag(event, false));

document.querySelectorAll('[data-pass]').forEach((button) => button.addEventListener('click', () => startLocal('pass', +button.dataset.pass)));
document.querySelectorAll('[data-bot]').forEach((button) => button.addEventListener('click', () => startLocal(button.dataset.bot, 2)));
$('backBtn').addEventListener('click', backToMenu);
$('resultBack').addEventListener('click', backToMenu);
$('rematchBtn').addEventListener('click', rematch);
$('rulesBtn').addEventListener('click', () => $('rulesPanel').classList.remove('hidden'));
$('rulesClose').addEventListener('click', () => $('rulesPanel').classList.add('hidden'));
$('rulesGotIt').addEventListener('click', () => $('rulesPanel').classList.add('hidden'));

/* ------------------------------------------------------------- online */

$('hostBtn').addEventListener('click', () => openPanel('host'));
$('joinBtn').addEventListener('click', () => openPanel('join'));
$('opCancel').addEventListener('click', closePanel);
$('opGo').addEventListener('click', onlineGo);
$('lobbyCancel').addEventListener('click', cancelLobby);
rejoinBtn.addEventListener('click', rejoinCrew);

document.querySelectorAll('.seat-btn').forEach((button) => {
  button.addEventListener('click', () => {
    selectedSeats = +button.dataset.seats;
    document.querySelectorAll('.seat-btn').forEach((choice) => {
      const chosen = choice === button;
      choice.classList.toggle('selected', chosen);
      choice.setAttribute('aria-pressed', String(chosen));
    });
  });
});

opCode.addEventListener('input', () => {
  opCode.value = opCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
[opName, opCode].forEach((input) => input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') onlineGo();
}));

function openPanel(intent) {
  panelIntent = intent;
  $('opTitle').textContent = intent === 'host' ? 'START A CREW' : 'JOIN A CREW';
  $('opGo').textContent = intent === 'host' ? 'GET A CODE' : 'JOIN THE SKY';
  opSeatsWrap.classList.toggle('hidden', intent !== 'host');
  opCodeWrap.classList.toggle('hidden', intent === 'host');
  opError.classList.add('hidden');
  opName.value = opName.value || getName();
  onlinePanel.classList.remove('hidden');
  (intent === 'join' && opName.value ? opCode : opName).focus();
}

function closePanel() {
  onlinePanel.classList.add('hidden');
}

const FRIENDLY_ERRORS = {
  not_found: 'No crew has that code — check the four characters.',
  room_full: 'That patch of sky is already full.',
  room_started: 'That crew has already begun hopping.',
  not_ready: "Online play isn't switched on yet — check back soon!",
  offline: "Can't reach the stars — are you online?",
};

function friendly(err) {
  if (err?.code === 'wrong_game') return `That code belongs to ${String(err.detail || 'another game').replace(/-/g, ' ')}.`;
  return FRIENDLY_ERRORS[err?.code] || 'The signal drifted. Please try again.';
}

async function onlineGo() {
  if ($('opGo').disabled) return;
  const name = opName.value.trim();
  if (!name) {
    opError.textContent = 'Every stargazer needs a name.';
    opError.classList.remove('hidden');
    opName.focus();
    return;
  }
  $('opGo').disabled = true;
  opError.classList.add('hidden');
  try {
    let match;
    if (panelIntent === 'host') {
      match = await OnlineMatch.create({
        game: GAME,
        name,
        seats: selectedSeats,
        state: createInitialState({ numPlayers: selectedSeats, seed: freshSeed() }),
      });
    } else {
      const code = opCode.value.trim();
      if (code.length !== 4) {
        opError.textContent = 'The crew code is 4 characters.';
        opError.classList.remove('hidden');
        opCode.focus();
        return;
      }
      match = await OnlineMatch.join({ game: GAME, code, name });
    }
    closePanel();
    if (match.status === 'waiting') openLobby(match);
    else enterOnlineGame(match);
  } catch (err) {
    opError.textContent = friendly(err);
    opError.classList.remove('hidden');
  } finally {
    $('opGo').disabled = false;
  }
}

function renderLobby(match) {
  lobbyCode.textContent = match.code;
  lobbyNames.innerHTML = '';
  const total = match.state?.numPlayers || selectedSeats;
  for (let seat = 0; seat < total; seat++) {
    const joined = match.seats.find((entry) => entry.seat === seat);
    const item = document.createElement('li');
    item.textContent = joined ? `${joined.name} · ${COLOR_NAMES[seat]}` : `Waiting for ${COLOR_NAMES[seat]}…`;
    lobbyNames.appendChild(item);
  }
}

function openLobby(match) {
  if (lobbyEl._match && lobbyEl._match !== match) lobbyEl._match.stop();
  $('lobbyHint').textContent = 'The rest of the crew can join with this code or your invite link.';
  lobbyEl._match = match;
  renderLobby(match);
  lobbyEl.classList.remove('hidden');
  match.start({
    onStatus: (status) => {
      if (status === 'playing') {
        lobbyEl.classList.add('hidden');
        enterOnlineGame(match);
      } else if (status === 'over') {
        $('lobbyHint').textContent = 'Someone left before launch. Make a fresh crew.';
      }
    },
    onPresence: () => renderLobby(match),
    onError: () => {},
  });
}

function cancelLobby() {
  const match = lobbyEl._match;
  if (match) match.leave();
  lobbyEl._match = null;
  lobbyEl.classList.add('hidden');
  refreshRejoin();
}

async function rejoinCrew() {
  rejoinBtn.disabled = true;
  try {
    const match = await OnlineMatch.resume({ game: GAME });
    if (match.status === 'waiting') openLobby(match);
    else enterOnlineGame(match);
  } catch (err) {
    if (['not_found', 'not_seated', 'room_started'].includes(err?.code)) {
      clearSession(GAME);
      refreshRejoin();
    }
  } finally {
    rejoinBtn.disabled = false;
  }
}

function refreshRejoin() {
  const saved = savedSession(GAME);
  rejoinBtn.classList.toggle('hidden', !saved);
  if (saved) rejoinBtn.textContent = `↩ REJOIN YOUR CREW (${saved.code})`;
}

function enterOnlineGame(match) {
  clearTimeout(botTimer);
  mode = 'online';
  online = { match, myPlayer: match.seat };
  pollErrors = 0;
  busy = false;
  selected = null;
  state = match.state;
  resetLbPanel(); // the result dialog is shared — never show the panel online
  menuEl.classList.add('hidden');
  onlinePanel.classList.add('hidden');
  lobbyEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  $('result').classList.add('hidden');
  render();
  match.start({
    onState: (remoteState) => {
      state = remoteState;
      selected = null;
      busy = false;
      pollErrors = 0;
      render();
    },
    onStatus: () => render(),
    onPresence: () => renderLegend(),
    onError: (err) => {
      pollErrors++;
      if (pollErrors >= 2) showTransient(friendly(err));
    },
  });
}

$('inviteBtn').addEventListener('click', async () => {
  const match = lobbyEl._match;
  if (!match) return;
  const url = `${location.origin}${location.pathname}?join=${match.code}`;
  const text = `Hop the northern sky with me in North Star Hop! ✦ ${url}`;
  try {
    if (navigator.share && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
      await navigator.share({ text });
    } else {
      await navigator.clipboard.writeText(url);
      $('inviteBtn').textContent = '✓ LINK COPIED';
      setTimeout(() => { $('inviteBtn').textContent = '📲 SEND AN INVITE'; }, 1800);
    }
  } catch { /* Closing a share sheet is harmless. */ }
});

refreshRejoin();

(() => {
  const code = new URLSearchParams(location.search).get('join');
  if (!code || !/^[A-Za-z0-9]{4}$/.test(code)) return;
  history.replaceState(null, '', location.pathname);
  openPanel('join');
  opCode.value = code.toUpperCase();
  if (opName.value) opCode.focus();
})();

