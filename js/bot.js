// NORTH STAR HOP bots. Decisions use only engine exports and stay deterministic
// for a given state, which keeps bot games easy to reproduce.

import { applyMove, getStatus, legalMoves, progressScore } from './engine.js';

export const BOTS = Object.freeze({
  polaris: Object.freeze({
    name: 'POLARIS',
    blurb: 'heads north by the brightest route',
  }),
  navigator: Object.freeze({
    name: 'THE NAVIGATOR',
    blurb: 'charts the reply before making a move',
  }),
});

function tieBreak(move, state) {
  let hash = state.rng >>> 0;
  for (const ch of `${move.from}>${move.to}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

function immediateValue(state, move, player) {
  const next = applyMove(state, move);
  const hopBonus = move.type === 'hop' ? (move.path.length - 1) * 0.08 : 0;
  return progressScore(next, player) + hopBonus;
}

export function chooseMove(state, level = 'polaris') {
  const moves = legalMoves(state);
  if (!moves.length) return null;
  const player = state.turn;
  let bestMove = moves[0];
  let bestScore = -Infinity;

  for (const move of moves) {
    const next = applyMove(state, move);
    let score = immediateValue(state, move, player);

    if (level === 'navigator' && !getStatus(next).over) {
      // Look through the next player's strongest reply. This is deliberately
      // shallow: the Navigator feels canny without pausing the phone.
      const opponent = next.turn;
      let replyStrength = -Infinity;
      for (const reply of legalMoves(next)) {
        replyStrength = Math.max(replyStrength, progressScore(applyMove(next, reply), opponent));
      }
      if (replyStrength > -Infinity) score -= replyStrength * 0.22;
    }

    const keyedScore = score * 1e7 + (tieBreak(move, state) % 1000000) / 1000000;
    if (keyedScore > bestScore) {
      bestScore = keyedScore;
      bestMove = move;
    }
  }
  return bestMove;
}

