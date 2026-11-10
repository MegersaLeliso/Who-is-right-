/**
 * Who's Right? — core game engine.
 *
 * Pure, DOM-free functions. Every state transition returns a *new* match
 * object (nothing is mutated), which keeps the UI layer simple and makes the
 * rules easy to unit-test in Node.
 *
 * Loaded as a classic <script> in the browser (exposes `window.WhoIsRight`)
 * and via `require()` in Node, so the app works straight from the file system
 * with no build step.
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.WhoIsRight = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const FACES = 6;
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 4;
  const MIN_DICE = 1;
  const MAX_DICE = 3;
  const MAX_NAME_LENGTH = 20;
  const MAX_TOPIC_LENGTH = 80;
  const DEFAULT_NAMES = Object.freeze(['Abebe', 'Chala', 'Player 3', 'Player 4']);
  const UINT32_RANGE = 0x100000000;
  // Critical value of the chi-square distribution for 5 degrees of freedom at
  // a 5% significance level — used to sanity-check that the dice look fair.
  const CHI_SQUARE_CRITICAL_DF5 = 11.0705;

  /* ------------------------------------------------------------------ */
  /* Randomness                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Uniform random integer in [1, max].
   *
   * Uses the Web Crypto CSPRNG with rejection sampling, so there is no
   * modulo bias: values from the top of the 32-bit range that would favour
   * low numbers are thrown away and redrawn.
   *
   * @param {number} max
   * @param {() => number} [rng] optional deterministic source in [0, 1) — used by tests
   */
  function randomInt(max, rng) {
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError('max must be a positive integer');
    }
    if (typeof rng === 'function') {
      return Math.min(max, Math.floor(rng() * max) + 1);
    }
    const cryptoApi = root.crypto;
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
      const limit = UINT32_RANGE - (UINT32_RANGE % max);
      const buffer = new Uint32Array(1);
      do {
        cryptoApi.getRandomValues(buffer);
      } while (buffer[0] >= limit);
      return (buffer[0] % max) + 1;
    }
    return Math.floor(Math.random() * max) + 1;
  }

  /** Roll `count` six-sided dice. */
  function rollDice(count, rng) {
    const dice = [];
    for (let i = 0; i < count; i += 1) dice.push(randomInt(FACES, rng));
    return dice;
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  const sum = (values) => values.reduce((total, v) => total + v, 0);

  function clampInt(value, min, max, fallback) {
    const n = typeof value === 'number' ? Math.trunc(value) : Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function sanitizeName(name, fallback) {
    const clean = String(name == null ? '' : name)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_NAME_LENGTH);
    return clean || fallback;
  }

  function sanitizeTopic(topic) {
    return String(topic == null ? '' : topic)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TOPIC_LENGTH);
  }

  /* ------------------------------------------------------------------ */
  /* Match lifecycle                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Create a fresh match.
   *
   * @param {object}   [options]
   * @param {string[]} [options.names]      2–4 player names
   * @param {number}   [options.diceCount]  dice per player (1–3)
   * @param {number}   [options.target]     points needed to win; 0 = free play (never ends)
   * @param {string}   [options.topic]      what the argument is about
   */
  function createMatch(options) {
    const opts = options || {};
    const names = Array.isArray(opts.names) ? opts.names.slice(0, MAX_PLAYERS) : DEFAULT_NAMES.slice(0, 2);
    while (names.length < MIN_PLAYERS) names.push('');

    const players = names.map((name, id) => ({ id, name: sanitizeName(name, DEFAULT_NAMES[id]) }));

    return {
      version: 1,
      players,
      diceCount: clampInt(opts.diceCount, MIN_DICE, MAX_DICE, 1),
      target: clampInt(opts.target, 0, 99, 2),
      topic: sanitizeTopic(opts.topic),
      scores: players.map(() => 0),
      rounds: [],
      contenders: null, // player ids in an ongoing roll-off, otherwise null
      champion: null, // id of the match winner once decided
    };
  }

  /**
   * Play one round and return the next match state.
   *
   * Everyone in the match rolls, highest total takes the point. When the top
   * total is shared, only the tied players roll again (a roll-off) and the
   * roll-off winner takes the point.
   *
   * @param {object} match
   * @param {object} [options]
   * @param {() => number} [options.rng]  deterministic randomness for tests
   * @param {number}       [options.now]  timestamp override for tests
   */
  function playRound(match, options) {
    const opts = options || {};
    if (match.champion !== null) {
      throw new Error('The match is already over — start a new one.');
    }

    const rollingIds = match.contenders || match.players.map((p) => p.id);
    const rolls = rollingIds.map((playerId) => {
      const dice = rollDice(match.diceCount, opts.rng);
      return { playerId, dice, total: sum(dice) };
    });

    const best = Math.max(...rolls.map((r) => r.total));
    const leaders = rolls.filter((r) => r.total === best).map((r) => r.playerId);

    const round = {
      number: match.rounds.length + 1,
      rolls,
      rollOff: match.contenders !== null,
      winner: null,
      tiedIds: null,
      at: typeof opts.now === 'number' ? opts.now : Date.now(),
    };

    const scores = match.scores.slice();
    let contenders = null;
    let champion = null;

    if (leaders.length === 1) {
      const winner = leaders[0];
      round.winner = winner;
      scores[winner] += 1;
      if (match.target > 0 && scores[winner] >= match.target) champion = winner;
    } else {
      round.tiedIds = leaders;
      contenders = leaders;
    }

    return Object.assign({}, match, {
      scores,
      rounds: match.rounds.concat([round]),
      contenders,
      champion,
    });
  }

  /** Rename a player without resetting the match. */
  function renamePlayer(match, playerId, name) {
    const players = match.players.map((p) =>
      p.id === playerId ? { id: p.id, name: sanitizeName(name, DEFAULT_NAMES[p.id]) } : p
    );
    return Object.assign({}, match, { players });
  }

  function setTopic(match, topic) {
    return Object.assign({}, match, { topic: sanitizeTopic(topic) });
  }

  /**
   * Validate a match loaded from storage. Anything malformed (old versions,
   * hand-edited localStorage, …) is rejected so the UI never renders garbage.
   */
  function isValidMatch(m) {
    if (!m || typeof m !== 'object' || m.version !== 1) return false;
    const { players, scores, rounds } = m;
    if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) return false;
    if (!players.every((p, i) => p && p.id === i && typeof p.name === 'string')) return false;
    if (!Array.isArray(scores) || scores.length !== players.length) return false;
    if (!scores.every((s) => Number.isInteger(s) && s >= 0)) return false;
    if (!Array.isArray(rounds)) return false;
    if (!Number.isInteger(m.diceCount) || m.diceCount < MIN_DICE || m.diceCount > MAX_DICE) return false;
    if (!Number.isInteger(m.target) || m.target < 0) return false;
    if (m.contenders !== null && !Array.isArray(m.contenders)) return false;
    if (m.champion !== null && !(Number.isInteger(m.champion) && m.champion < players.length)) return false;
    return rounds.every(
      (r) =>
        r &&
        Array.isArray(r.rolls) &&
        r.rolls.every(
          (roll) =>
            roll &&
            Number.isInteger(roll.playerId) &&
            roll.playerId < players.length &&
            Array.isArray(roll.dice) &&
            roll.dice.length === m.diceCount &&
            roll.dice.every((d) => Number.isInteger(d) && d >= 1 && d <= FACES)
        )
    );
  }

  /* ------------------------------------------------------------------ */
  /* Statistics                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Pearson's chi-square goodness-of-fit test against a fair die.
   * With fewer than 30 dice the test is not meaningful, so `verdict` is null.
   */
  function fairnessTest(faceCounts) {
    const n = sum(faceCounts);
    if (n === 0) return { n, statistic: 0, critical: CHI_SQUARE_CRITICAL_DF5, verdict: null };
    const expected = n / faceCounts.length;
    const statistic = faceCounts.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    let verdict = null;
    if (n >= 30) verdict = statistic <= CHI_SQUARE_CRITICAL_DF5 ? 'fair' : 'suspicious';
    return { n, statistic, critical: CHI_SQUARE_CRITICAL_DF5, verdict };
  }

  /** Per-player and whole-match statistics. */
  function computeStats(match) {
    const players = match.players.map((p) => ({
      id: p.id,
      name: p.name,
      wins: match.scores[p.id],
      rolls: 0,
      pipTotal: 0,
      best: 0,
      streak: 0,
      bestStreak: 0,
      average: 0,
      winRate: 0,
    }));
    const faceCounts = new Array(FACES).fill(0);
    let decided = 0;

    for (const round of match.rounds) {
      for (const roll of round.rolls) {
        const s = players[roll.playerId];
        s.rolls += 1;
        s.pipTotal += roll.total;
        s.best = Math.max(s.best, roll.total);
        for (const d of roll.dice) faceCounts[d - 1] += 1;
      }
      if (round.winner !== null) {
        decided += 1;
        for (const s of players) {
          if (s.id === round.winner) {
            s.streak += 1;
            s.bestStreak = Math.max(s.bestStreak, s.streak);
          } else {
            s.streak = 0;
          }
        }
      }
    }

    for (const s of players) {
      s.average = s.rolls ? s.pipTotal / s.rolls : 0;
      s.winRate = decided ? s.wins / decided : 0;
    }

    return {
      players,
      decidedRounds: decided,
      totalRolls: match.rounds.length,
      ties: match.rounds.filter((r) => r.tiedIds !== null).length,
      faceCounts,
      fairness: fairnessTest(faceCounts),
    };
  }

  return Object.freeze({
    FACES,
    MIN_PLAYERS,
    MAX_PLAYERS,
    MIN_DICE,
    MAX_DICE,
    DEFAULT_NAMES,
    randomInt,
    rollDice,
    clampInt,
    sanitizeName,
    createMatch,
    playRound,
    renamePlayer,
    setTopic,
    isValidMatch,
    computeStats,
    fairnessTest,
  });
});
