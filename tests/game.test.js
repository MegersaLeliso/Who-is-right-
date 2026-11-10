'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/game.js');

/** Deterministic rng that makes the next dice come up as the given faces. */
function riggedDice(...faces) {
  let i = 0;
  return () => {
    if (i >= faces.length) throw new Error('riggedDice ran out of faces');
    const face = faces[i++];
    return (face - 1) / 6 + 0.01;
  };
}

test('randomInt stays within [1, max] using the crypto source', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i += 1) {
    const n = G.randomInt(6);
    assert.ok(Number.isInteger(n) && n >= 1 && n <= 6, `out of range: ${n}`);
    seen.add(n);
  }
  assert.equal(seen.size, 6, 'every face should appear in 5000 rolls');
});

test('randomInt honours an injected rng and rejects bad input', () => {
  assert.equal(G.randomInt(6, () => 0), 1);
  assert.equal(G.randomInt(6, () => 0.999999), 6);
  assert.throws(() => G.randomInt(0), RangeError);
  assert.throws(() => G.randomInt(2.5), RangeError);
});

test('crypto-backed dice pass a chi-square fairness test', () => {
  const counts = new Array(6).fill(0);
  for (const d of G.rollDice(60000)) counts[d - 1] += 1;
  const result = G.fairnessTest(counts);
  // 99.9% critical value for df=5 is 20.52 — keeps the test from being flaky.
  assert.ok(result.statistic < 20.52, `chi-square too high: ${result.statistic}`);
});

test('createMatch clamps settings and fills in names', () => {
  const m = G.createMatch({ names: ['  Sara  ', '', 'C', 'D', 'E'], diceCount: 9, target: -3 });
  assert.equal(m.players.length, 4, 'caps players at 4');
  assert.deepEqual(
    m.players.map((p) => p.name),
    ['Sara', 'Chala', 'C', 'D']
  );
  assert.equal(m.diceCount, 3);
  assert.equal(m.target, 0);
  assert.deepEqual(m.scores, [0, 0, 0, 0]);

  const solo = G.createMatch({ names: ['Only me'] });
  assert.equal(solo.players.length, 2, 'always at least 2 players');
});

test('playRound awards the point to the highest total', () => {
  const m0 = G.createMatch({ names: ['A', 'B'], target: 2 });
  const m1 = G.playRound(m0, { rng: riggedDice(5, 2), now: 1 });

  assert.deepEqual(m1.scores, [1, 0]);
  assert.equal(m1.rounds.length, 1);
  assert.equal(m1.rounds[0].winner, 0);
  assert.equal(m1.champion, null);
  assert.deepEqual(m0.scores, [0, 0], 'previous state is not mutated');
  assert.equal(m0.rounds.length, 0);
});

test('multiple dice are summed', () => {
  const m = G.createMatch({ names: ['A', 'B'], diceCount: 3 });
  const next = G.playRound(m, { rng: riggedDice(1, 1, 6, 3, 3, 2) });
  assert.deepEqual(next.rounds[0].rolls.map((r) => r.total), [8, 8]);
  assert.deepEqual(next.rounds[0].tiedIds, [0, 1]);
});

test('ties trigger a roll-off between only the tied players', () => {
  let m = G.createMatch({ names: ['A', 'B', 'C'], target: 1 });
  m = G.playRound(m, { rng: riggedDice(6, 2, 6) });

  assert.deepEqual(m.contenders, [0, 2]);
  assert.deepEqual(m.scores, [0, 0, 0], 'nobody scores on a tie');

  m = G.playRound(m, { rng: riggedDice(3, 4) });
  const rollOff = m.rounds[1];
  assert.equal(rollOff.rollOff, true);
  assert.deepEqual(rollOff.rolls.map((r) => r.playerId), [0, 2], 'player B sits out');
  assert.equal(rollOff.winner, 2);
  assert.equal(m.contenders, null);
  assert.equal(m.champion, 2, 'single-roll match is decided by the roll-off');
});

test('the match ends when someone reaches the target', () => {
  let m = G.createMatch({ names: ['A', 'B'], target: 2 });
  m = G.playRound(m, { rng: riggedDice(6, 1) });
  m = G.playRound(m, { rng: riggedDice(1, 6) });
  m = G.playRound(m, { rng: riggedDice(4, 3) });
  assert.equal(m.champion, 0);
  assert.deepEqual(m.scores, [2, 1]);
  assert.throws(() => G.playRound(m), /already over/);
});

test('free play (target 0) never crowns a champion', () => {
  let m = G.createMatch({ names: ['A', 'B'], target: 0 });
  for (let i = 0; i < 25; i += 1) m = G.playRound(m, { rng: riggedDice(6, 1) });
  assert.equal(m.champion, null);
  assert.equal(m.scores[0], 25);
});

test('renamePlayer and setTopic sanitise input without touching scores', () => {
  let m = G.createMatch({ names: ['A', 'B'] });
  m = G.playRound(m, { rng: riggedDice(6, 1) });
  const renamed = G.renamePlayer(m, 1, '   Bethlehem    Tadesse   ');
  assert.equal(renamed.players[1].name, 'Bethlehem Tadesse');
  assert.equal(G.renamePlayer(m, 0, '   ').players[0].name, 'Abebe', 'blank falls back to default');
  assert.deepEqual(renamed.scores, m.scores);
  assert.equal(G.setTopic(m, '  Who does   the dishes? ').topic, 'Who does the dishes?');
});

test('computeStats tracks wins, streaks, averages and faces', () => {
  let m = G.createMatch({ names: ['A', 'B'], target: 0 });
  m = G.playRound(m, { rng: riggedDice(6, 1) }); // A
  m = G.playRound(m, { rng: riggedDice(5, 2) }); // A
  m = G.playRound(m, { rng: riggedDice(3, 3) }); // tie → roll-off
  m = G.playRound(m, { rng: riggedDice(2, 4) }); // B wins roll-off

  const stats = G.computeStats(m);
  const [a, b] = stats.players;

  assert.equal(stats.totalRolls, 4);
  assert.equal(stats.decidedRounds, 3);
  assert.equal(stats.ties, 1);
  assert.equal(a.wins, 2);
  assert.equal(a.bestStreak, 2);
  assert.equal(a.streak, 0);
  assert.equal(b.streak, 1);
  assert.equal(a.best, 6);
  assert.equal(a.average, (6 + 5 + 3 + 2) / 4);
  assert.ok(Math.abs(a.winRate - 2 / 3) < 1e-9);
  assert.deepEqual(stats.faceCounts, [1, 2, 2, 1, 1, 1]);
});

test('fairnessTest flags loaded dice once there is enough data', () => {
  assert.equal(G.fairnessTest([5, 5, 5, 5, 5, 5]).verdict, 'fair');
  assert.equal(G.fairnessTest([1, 1, 1, 1, 1, 1]).verdict, null, 'too few rolls to judge');
  assert.equal(G.fairnessTest([30, 0, 0, 0, 0, 30]).verdict, 'suspicious');
});

test('isValidMatch accepts real matches and rejects corrupted ones', () => {
  let m = G.createMatch({ names: ['A', 'B'], diceCount: 2 });
  m = G.playRound(m);
  assert.ok(G.isValidMatch(m));
  assert.ok(G.isValidMatch(JSON.parse(JSON.stringify(m))), 'survives a JSON round-trip');

  assert.equal(G.isValidMatch(null), false);
  assert.equal(G.isValidMatch({}), false);
  assert.equal(G.isValidMatch({ ...m, version: 2 }), false);
  assert.equal(G.isValidMatch({ ...m, scores: [0] }), false);
  assert.equal(G.isValidMatch({ ...m, diceCount: 7 }), false);
  const badRound = { ...m.rounds[0], rolls: [{ playerId: 0, dice: [9, 1], total: 10 }] };
  assert.equal(G.isValidMatch({ ...m, rounds: [badRound] }), false);
});
