/**
 * Who's Right? — UI controller.
 *
 * Owns the DOM: renders the current match (produced by the pure engine in
 * game.js), runs the roll animation, persists state to localStorage and wires
 * up keyboard shortcuts, dialogs and sharing.
 */
(function () {
  'use strict';

  const G = window.WhoIsRight;
  const FX = window.WhoIsRightFX;

  const STORAGE_KEY = 'whos-right:v1';
  const MODES = [
    { target: 1, label: 'Single roll' },
    { target: 2, label: 'Best of 3' },
    { target: 3, label: 'Best of 5' },
    { target: 4, label: 'Best of 7' },
    { target: 0, label: 'Free play' },
  ];

  // Rotation that brings each face to the front (see .face-N in styles.css).
  const FACE_ROTATION = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
  // Pip positions on a 3×3 grid, numbered 1–9 left-to-right, top-to-bottom.
  const PIP_CELLS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

  const DEFAULT_SETTINGS = {
    playerCount: 2,
    diceCount: 1,
    target: 2,
    names: G.DEFAULT_NAMES.slice(),
    topic: '',
    sound: true,
    theme: null, // null = follow the operating system
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const rollDuration = () => (reducedMotion.matches ? 250 : 1150);

  /* ------------------------------------------------------------------ */
  /* DOM helpers                                                         */
  /* ------------------------------------------------------------------ */

  const $ = (selector, scope) => (scope || document).querySelector(selector);

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key === 'style') el.style.cssText = value;
        else el.setAttribute(key, value === true ? '' : value);
      }
    }
    for (const child of [].concat(children || [])) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  const els = {
    topic: $('#topic-input'),
    headline: $('#headline'),
    subline: $('#subline'),
    scoreboard: $('#scoreboard'),
    arena: $('#arena'),
    rollBtn: $('#roll-btn'),
    rollLabel: $('#roll-btn .roll-btn-label'),
    newBtn: $('#new-btn'),
    soundBtn: $('#sound-btn'),
    themeBtn: $('#theme-btn'),
    settingsBtn: $('#settings-btn'),
    settingsDialog: $('#settings-dialog'),
    settingsForm: $('#settings-form'),
    modeOptions: $('#mode-options'),
    championDialog: $('#champion-dialog'),
    championTitle: $('#champion-title'),
    championTopic: $('#champion-topic'),
    championScore: $('#champion-score'),
    shareBtn: $('#share-btn'),
    rematchBtn: $('#rematch-btn'),
    historyList: $('#history-list'),
    historyEmpty: $('#history-empty'),
    historyCount: $('#history-count'),
    statsContent: $('#stats-content'),
    tabs: Array.from(document.querySelectorAll('[role="tab"]')),
    confetti: $('#confetti'),
    toast: $('#toast'),
  };

  /* ------------------------------------------------------------------ */
  /* State & persistence                                                 */
  /* ------------------------------------------------------------------ */

  function loadSaved() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function sanitizeSettings(raw) {
    const s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    const names = Array.isArray(s.names) ? s.names : [];
    return {
      playerCount: G.clampInt(s.playerCount, G.MIN_PLAYERS, G.MAX_PLAYERS, 2),
      diceCount: G.clampInt(s.diceCount, G.MIN_DICE, G.MAX_DICE, 1),
      target: MODES.some((m) => m.target === s.target) ? s.target : DEFAULT_SETTINGS.target,
      names: G.DEFAULT_NAMES.map((fallback, i) => G.sanitizeName(names[i], fallback)),
      topic: typeof s.topic === 'string' ? s.topic.slice(0, 80) : '',
      sound: s.sound !== false,
      theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : null,
    };
  }

  const saved = loadSaved();
  let settings = sanitizeSettings(saved.settings);
  let match = G.isValidMatch(saved.match) ? saved.match : matchFromSettings();
  let rolling = false;
  let rollTimer = null;
  const dieRotation = new WeakMap();

  function matchFromSettings() {
    return G.createMatch({
      names: settings.names.slice(0, settings.playerCount),
      diceCount: settings.diceCount,
      target: settings.target,
      topic: settings.topic,
    });
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, match }));
    } catch (e) {
      /* storage full or blocked (private mode) — the app still works */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Small view helpers                                                  */
  /* ------------------------------------------------------------------ */

  const nameOf = (id) => match.players[id].name;
  const modeLabel = (target) => (MODES.find((m) => m.target === target) || MODES[1]).label;

  function listNames(ids) {
    const names = ids.map(nameOf);
    if (names.length <= 2) return names.join(' and ');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }

  function scoreLine() {
    return match.scores.join('–');
  }

  function cardFor(id) {
    return els.arena.querySelector(`.player[data-id="${id}"]`);
  }

  /* ------------------------------------------------------------------ */
  /* Dice                                                                */
  /* ------------------------------------------------------------------ */

  function createDie() {
    const cube = h('div', { class: 'cube' });
    for (let face = 1; face <= 6; face += 1) {
      cube.append(h('div', { class: `face face-${face}` }, PIP_CELLS[face].map((c) => h('span', { class: `pip c${c}` }))));
    }
    return h('div', { class: 'die', role: 'img', 'aria-label': 'Die, not rolled yet' }, h('div', { class: 'die-tilt' }, cube));
  }

  function orientDie(die, value, animate) {
    const cube = die.querySelector('.cube');
    const [tx, ty] = FACE_ROTATION[value];
    const prev = dieRotation.get(die) || { x: 0, y: 0 };
    let x = tx;
    let y = ty;

    if (animate) {
      // Always spin forwards by at least one full turn on each axis, then
      // settle on the target face. Whole turns are invisible in the end
      // state, so only the target face rotation matters.
      x = Math.ceil(prev.x / 360) * 360 + 360 * (1 + Math.floor(Math.random() * 2)) + tx;
      y = Math.ceil(prev.y / 360) * 360 + 360 * (1 + Math.floor(Math.random() * 2)) + ty;
      cube.style.transitionDuration = `${rollDuration()}ms`;
    } else {
      cube.style.transitionDuration = '0ms';
    }
    cube.style.transform = `rotateX(${x}deg) rotateY(${y}deg)`;
    dieRotation.set(die, { x, y });
    die.setAttribute('aria-label', `Die showing ${value}`);
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function buildArena() {
    els.arena.replaceChildren();
    els.arena.dataset.players = String(match.players.length);
    els.arena.dataset.dice = String(match.diceCount);

    for (const player of match.players) {
      const input = h('input', {
        class: 'player-name',
        type: 'text',
        maxlength: '20',
        spellcheck: 'false',
        autocomplete: 'off',
        'aria-label': `Player ${player.id + 1} name`,
        'data-id': player.id,
      });
      input.value = player.name;

      const dice = [];
      for (let i = 0; i < match.diceCount; i += 1) dice.push(createDie());

      const card = h('article', { class: 'player', 'data-id': player.id, style: `--c: var(--p${player.id})` }, [
        h('span', { class: 'crown', 'aria-hidden': 'true', text: '👑' }),
        input,
        h('div', { class: 'dice-row' }, dice),
        h('div', { class: 'player-total' }, [
          h('span', { class: 'total-num', text: '–' }),
          h('span', { class: 'total-label', text: match.diceCount > 1 ? 'total' : 'rolled' }),
        ]),
      ]);
      els.arena.append(card);
    }
  }

  /** Show every player's most recent dice without animating (used on load). */
  function restoreDice() {
    const last = match.rounds[match.rounds.length - 1];
    for (const player of match.players) {
      const card = cardFor(player.id);
      const dice = card.querySelectorAll('.die');
      let latest = null;
      for (let i = match.rounds.length - 1; i >= 0 && !latest; i -= 1) {
        latest = match.rounds[i].rolls.find((r) => r.playerId === player.id) || null;
      }
      if (latest) {
        latest.dice.forEach((value, i) => orientDie(dice[i], value, false));
        card.querySelector('.total-num').textContent = String(latest.total);
      } else {
        dice.forEach((die, i) => orientDie(die, ((player.id + i) % 6) + 1, false));
      }
    }
    if (last) applyRoundClasses(last);
  }

  function applyRoundClasses(round) {
    for (const player of match.players) {
      const card = cardFor(player.id);
      const rolled = round.rolls.some((r) => r.playerId === player.id);
      card.classList.toggle('is-out', !rolled);
      card.classList.toggle('is-winner', round.winner === player.id);
      card.classList.toggle('is-loser', rolled && round.winner !== null && round.winner !== player.id);
      card.classList.toggle('is-tied', Boolean(round.tiedIds && round.tiedIds.includes(player.id)));
      card.classList.toggle('is-champion', match.champion === player.id);
    }
  }

  function clearRoundClasses() {
    for (const card of els.arena.querySelectorAll('.player')) {
      card.classList.remove('is-out', 'is-winner', 'is-loser', 'is-tied', 'is-champion', 'is-rolling');
    }
  }

  function renderStatus() {
    const last = match.rounds[match.rounds.length - 1];
    let headline = "Who's right?";
    let subline = match.topic ? 'Roll the dice to settle it.' : 'Name the argument and the players, then roll to settle it.';

    if (last) {
      const winningRoll = last.rolls.find((r) => r.playerId === last.winner);
      if (match.champion !== null) {
        headline = `${nameOf(match.champion)} is right!`;
        subline =
          match.target === 1
            ? `Rolled ${winningRoll.total}. Case closed.`
            : `Wins the match ${scoreLine()}. Case closed.`;
      } else if (last.winner === null) {
        const tiedTotal = last.rolls.find((r) => r.playerId === last.tiedIds[0]).total;
        headline = last.tiedIds.length === last.rolls.length && last.rolls.length === 2 ? "It's a tie!" : 'Tie at the top!';
        subline = `${listNames(last.tiedIds)} ${last.tiedIds.length === 2 ? 'both' : 'all'} rolled ${tiedTotal}. Roll-off!`;
      } else if (match.target === 0) {
        headline = `${nameOf(last.winner)} takes it!`;
        subline = `Rolled ${winningRoll.total}. Score ${scoreLine()}.`;
      } else {
        const needed = match.target - match.scores[last.winner];
        headline = `${nameOf(last.winner)} scores!`;
        subline = `Rolled ${winningRoll.total}. ${needed === 1 ? 'One more point wins it.' : `${needed} more points to win.`}`;
      }
    }

    els.headline.textContent = headline;
    els.subline.textContent = subline;

    let label = 'Roll the dice';
    if (match.champion !== null) label = 'Rematch';
    else if (match.contenders) label = 'Roll-off!';
    els.rollLabel.textContent = label;
    els.rollBtn.classList.toggle('is-rolloff', Boolean(match.contenders));
  }

  function renderScoreboard() {
    const leader = Math.max(...match.scores);
    const items = match.players.map((p) => {
      const score = match.scores[p.id];
      const isLeader = score > 0 && score === leader;
      let marker;
      if (match.target > 0) {
        const slots = [];
        for (let i = 0; i < match.target; i += 1) {
          slots.push(h('span', { class: `slot${i < score ? ' is-filled' : ''}` }));
        }
        marker = h('span', { class: 'slots', 'aria-hidden': 'true' }, slots);
      } else {
        marker = h('span', { class: 'score-num', 'aria-hidden': 'true', text: String(score) });
      }
      const label = match.target > 0 ? `${p.name}: ${score} of ${match.target} points` : `${p.name}: ${score} points`;
      return h('li', { class: `score${isLeader ? ' is-leader' : ''}`, style: `--c: var(--p${p.id})`, 'aria-label': label }, [
        h('span', { class: 'score-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'score-name', 'aria-hidden': 'true', text: p.name }),
        marker,
      ]);
    });

    const target = match.target > 1 ? ` · first to ${match.target}` : '';
    els.scoreboard.replaceChildren(
      h('span', { class: 'mode-pill', text: `${modeLabel(match.target)}${target}` }),
      h('ul', { class: 'scores', 'aria-label': 'Score' }, items)
    );
  }

  function renderHistory() {
    const rounds = match.rounds;
    els.historyCount.textContent = String(rounds.length);
    els.historyEmpty.hidden = rounds.length > 0;

    const items = rounds
      .slice()
      .reverse()
      .map((round) => {
        const rolls = round.rolls.map((r) =>
          h('span', { class: `h-roll${round.winner === r.playerId ? ' is-win' : ''}`, style: `--c: var(--p${r.playerId})` }, [
            h('span', { class: 'h-name', text: nameOf(r.playerId) }),
            h('b', { text: String(r.total) }),
            match.diceCount > 1 ? h('small', { text: `(${r.dice.join('+')})` }) : null,
          ])
        );
        const result =
          round.winner !== null
            ? h('span', { class: 'h-result', style: `--c: var(--p${round.winner})`, text: `${nameOf(round.winner)} +1` })
            : h('span', { class: 'h-result is-tie', text: 'Tie' });

        return h('li', { class: 'h-item' }, [
          h('div', { class: 'h-meta' }, [
            h('span', { class: 'h-num', text: `#${round.number}` }),
            round.rollOff ? h('span', { class: 'h-tag', text: 'Roll-off' }) : null,
            result,
          ]),
          h('div', { class: 'h-rolls' }, rolls),
        ]);
      });
    els.historyList.replaceChildren(...items);
  }

  function renderStats() {
    const stats = G.computeStats(match);
    if (stats.totalRolls === 0) {
      els.statsContent.replaceChildren(h('p', { class: 'empty', text: 'Stats appear after the first roll.' }));
      return;
    }

    const pct = (n) => `${Math.round(n * 100)}%`;
    const rows = stats.players.map((p) =>
      h('tr', { style: `--c: var(--p${p.id})` }, [
        h('th', { scope: 'row' }, [h('span', { class: 'score-dot', 'aria-hidden': 'true' }), p.name]),
        h('td', { text: String(p.wins) }),
        h('td', { text: pct(p.winRate) }),
        h('td', { text: p.average.toFixed(1) }),
        h('td', { text: String(p.best) }),
        h('td', { text: String(p.bestStreak) }),
      ])
    );

    const table = h('table', { class: 'stats-table' }, [
      h('thead', null, h('tr', null, ['Player', 'Wins', 'Win %', 'Avg', 'Best', 'Streak'].map((t, i) => h('th', { scope: 'col', text: t, class: i ? 'num' : null })))),
      h('tbody', null, rows),
    ]);

    const summary = h('div', { class: 'stat-tiles' }, [
      tile('Rolls', stats.totalRolls),
      tile('Points', stats.decidedRounds),
      tile('Ties', stats.ties),
    ]);

    const maxCount = Math.max(1, ...stats.faceCounts);
    const bars = stats.faceCounts.map((count, i) =>
      h('div', { class: 'bar' }, [
        h('span', { class: 'bar-count', text: String(count) }),
        h('span', { class: 'bar-fill', style: `height: ${(count / maxCount) * 100}%` }),
        h('span', { class: 'bar-face', text: String(i + 1) }),
      ])
    );

    const f = stats.fairness;
    let verdict;
    if (f.verdict === null) {
      verdict = `Roll ${30 - f.n} more ${30 - f.n === 1 ? 'die' : 'dice'} for a meaningful fairness test.`;
    } else if (f.verdict === 'fair') {
      verdict = `χ² = ${f.statistic.toFixed(2)} (critical ${f.critical}) — consistent with fair dice.`;
    } else {
      verdict = `χ² = ${f.statistic.toFixed(2)} (critical ${f.critical}) — unusually lopsided. Lucky streak?`;
    }

    els.statsContent.replaceChildren(
      summary,
      h('div', { class: 'table-wrap' }, table),
      h('h3', { class: 'stats-heading', text: `Face distribution · ${f.n} dice` }),
      h('div', { class: 'bars', role: 'img', 'aria-label': stats.faceCounts.map((c, i) => `${i + 1}: ${c}`).join(', ') }, bars),
      h('p', { class: `fairness${f.verdict ? ` is-${f.verdict}` : ''}`, text: verdict })
    );

    function tile(label, value) {
      return h('div', { class: 'tile' }, [h('span', { class: 'tile-value', text: String(value) }), h('span', { class: 'tile-label', text: label })]);
    }
  }

  function renderPanels() {
    renderScoreboard();
    renderHistory();
    renderStats();
  }

  function renderAll() {
    els.topic.value = match.topic;
    buildArena();
    restoreDice();
    renderStatus();
    renderPanels();
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  function roll() {
    if (rolling) return;
    if (match.champion !== null) {
      startNewMatch();
      return;
    }

    match = G.playRound(match);
    persist();
    const round = match.rounds[match.rounds.length - 1];
    const duration = rollDuration();

    rolling = true;
    els.rollBtn.disabled = true;
    els.rollBtn.setAttribute('aria-busy', 'true');
    clearRoundClasses();
    els.headline.textContent = 'Rolling…';
    els.subline.textContent = round.rollOff ? `Roll-off: ${listNames(round.rolls.map((r) => r.playerId))}` : ' ';

    for (const player of match.players) {
      const card = cardFor(player.id);
      const r = round.rolls.find((x) => x.playerId === player.id);
      if (!r) {
        card.classList.add('is-out');
        continue;
      }
      card.classList.add('is-rolling');
      card.querySelector('.total-num').textContent = '…';
      const dice = card.querySelectorAll('.die');
      r.dice.forEach((value, i) => orientDie(dice[i], value, true));
    }

    FX.sound.rattle(duration / 1000);

    rollTimer = window.setTimeout(() => {
      rolling = false;
      els.rollBtn.disabled = false;
      els.rollBtn.removeAttribute('aria-busy');
      for (const r of round.rolls) {
        const card = cardFor(r.playerId);
        card.classList.remove('is-rolling');
        card.querySelector('.total-num').textContent = String(r.total);
      }
      applyRoundClasses(round);
      renderStatus();
      renderPanels();

      if (match.champion !== null) {
        FX.sound.fanfare();
        celebrate();
      } else if (round.winner === null) {
        FX.sound.tie();
      } else {
        FX.sound.point();
      }
      if (document.activeElement === document.body) els.rollBtn.focus();
    }, duration);
  }

  function celebrate() {
    const styles = getComputedStyle(document.documentElement);
    const championColor = styles.getPropertyValue(`--p${match.champion}`).trim();
    const palette = [0, 1, 2, 3].map((i) => styles.getPropertyValue(`--p${i}`).trim());
    FX.confetti(els.confetti, { colors: [championColor, championColor, ...palette] });

    els.championTopic.textContent = match.topic ? `“${match.topic}”` : '';
    els.championTopic.hidden = !match.topic;
    els.championTitle.textContent = `${nameOf(match.champion)} is right!`;
    els.championTitle.style.setProperty('--c', `var(--p${match.champion})`);
    els.championScore.textContent =
      match.target === 1
        ? 'Decided in a single roll.'
        : `Final score: ${match.players.map((p) => `${p.name}\u00a0${match.scores[p.id]}`).join(' · ')}`;

    window.setTimeout(() => {
      if (match.champion !== null && !els.championDialog.open) els.championDialog.showModal();
    }, FX.prefersReducedMotion() ? 0 : 700);
  }

  function startNewMatch(options) {
    const opts = options || {};
    const previous = match;
    const hadProgress = previous.rounds.length > 0 && previous.champion === null;

    window.clearTimeout(rollTimer);
    rolling = false;
    els.rollBtn.disabled = false;
    els.rollBtn.removeAttribute('aria-busy');
    if (els.championDialog.open) els.championDialog.close();

    match = matchFromSettings();
    persist();
    renderAll();

    if (hadProgress && !opts.silent) {
      toast('New match started.', {
        action: 'Undo',
        onAction: () => {
          match = previous;
          persist();
          renderAll();
        },
      });
    }
  }

  async function shareResult() {
    if (match.champion === null) return;
    const scores = match.players.map((p) => `${p.name} ${match.scores[p.id]}`).join(' – ');
    const text = [
      '🎲 Who\'s Right?',
      match.topic ? `“${match.topic}”` : null,
      `${nameOf(match.champion)} is right! ${match.target === 1 ? '' : `(${scores})`}`.trim(),
    ]
      .filter(Boolean)
      .join('\n');
    const url = /^https?:/.test(location.href) ? location.href.split('#')[0] : undefined;

    if (navigator.share) {
      try {
        await navigator.share({ title: "Who's Right?", text, url });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
      toast('Result copied to clipboard.');
    } catch (e) {
      toast('Could not share — copy the result manually.');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Preferences                                                         */
  /* ------------------------------------------------------------------ */

  const systemPrefersLight = window.matchMedia('(prefers-color-scheme: light)');

  function effectiveTheme() {
    return settings.theme || (systemPrefersLight.matches ? 'light' : 'dark');
  }

  function applyTheme() {
    if (settings.theme) document.documentElement.dataset.theme = settings.theme;
    else delete document.documentElement.dataset.theme;
    const theme = effectiveTheme();
    els.themeBtn.dataset.theme = theme;
    $('meta[name="theme-color"]').setAttribute('content', theme === 'light' ? '#eef1f4' : '#232931');
  }

  function toggleTheme() {
    settings.theme = effectiveTheme() === 'light' ? 'dark' : 'light';
    applyTheme();
    persist();
  }

  function applySound() {
    FX.sound.setEnabled(settings.sound);
    els.soundBtn.setAttribute('aria-pressed', String(settings.sound));
  }

  function toggleSound() {
    settings.sound = !settings.sound;
    applySound();
    persist();
    toast(settings.sound ? 'Sound on' : 'Sound off');
  }

  /* ------------------------------------------------------------------ */
  /* Settings dialog                                                     */
  /* ------------------------------------------------------------------ */

  function buildModeOptions() {
    els.modeOptions.replaceChildren(
      ...MODES.map((m) =>
        h('label', null, [h('input', { type: 'radio', name: 'target', value: String(m.target) }), h('span', { text: m.label })])
      )
    );
  }

  function openSettings() {
    const form = els.settingsForm;
    form.elements.playerCount.value = String(match.players.length);
    form.elements.diceCount.value = String(match.diceCount);
    form.elements.target.value = String(match.target);
    els.settingsDialog.showModal();
  }

  function onSettingsClosed() {
    if (els.settingsDialog.returnValue !== 'apply') return;
    const form = els.settingsForm;
    settings.playerCount = G.clampInt(form.elements.playerCount.value, G.MIN_PLAYERS, G.MAX_PLAYERS, 2);
    settings.diceCount = G.clampInt(form.elements.diceCount.value, G.MIN_DICE, G.MAX_DICE, 1);
    settings.target = G.clampInt(form.elements.target.value, 0, 99, 2);
    startNewMatch();
  }

  /* ------------------------------------------------------------------ */
  /* Toast                                                               */
  /* ------------------------------------------------------------------ */

  let toastTimer = null;

  function toast(message, options) {
    const opts = options || {};
    window.clearTimeout(toastTimer);
    const children = [h('span', { text: message })];
    if (opts.action) {
      const btn = h('button', { type: 'button', class: 'toast-action', text: opts.action });
      btn.addEventListener('click', () => {
        hideToast();
        opts.onAction();
      });
      children.push(btn);
    }
    els.toast.replaceChildren(...children);
    els.toast.classList.add('is-visible');
    toastTimer = window.setTimeout(hideToast, opts.action ? 6000 : 2200);
  }

  function hideToast() {
    els.toast.classList.remove('is-visible');
  }

  /* ------------------------------------------------------------------ */
  /* Tabs                                                                */
  /* ------------------------------------------------------------------ */

  function selectTab(tab, focus) {
    for (const t of els.tabs) {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
    }
    if (focus) tab.focus();
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  els.rollBtn.addEventListener('click', roll);
  els.newBtn.addEventListener('click', () => startNewMatch());
  els.rematchBtn.addEventListener('click', () => startNewMatch({ silent: true }));
  els.shareBtn.addEventListener('click', shareResult);
  els.soundBtn.addEventListener('click', toggleSound);
  els.themeBtn.addEventListener('click', toggleTheme);
  els.settingsBtn.addEventListener('click', openSettings);
  els.settingsDialog.addEventListener('close', onSettingsClosed);

  // Click on the dimmed backdrop closes dialogs.
  for (const dialog of [els.settingsDialog, els.championDialog]) {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close('cancel');
    });
  }

  els.topic.addEventListener('input', () => {
    match = G.setTopic(match, els.topic.value);
    settings.topic = match.topic;
    persist();
    if (match.rounds.length === 0) renderStatus();
  });

  els.arena.addEventListener('input', (e) => {
    if (!e.target.classList.contains('player-name')) return;
    const id = Number(e.target.dataset.id);
    match = G.renamePlayer(match, id, e.target.value);
    settings.names[id] = match.players[id].name;
    persist();
    if (!rolling) renderStatus();
    renderPanels();
  });

  els.arena.addEventListener('focusout', (e) => {
    if (e.target.classList.contains('player-name')) {
      e.target.value = match.players[Number(e.target.dataset.id)].name;
    }
  });

  els.arena.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('player-name') && e.key === 'Enter') e.target.blur();
  });

  els.topic.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.topic.blur();
  });

  els.tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = els.tabs[(i + (e.key === 'ArrowRight' ? 1 : els.tabs.length - 1)) % els.tabs.length];
      selectTab(next, true);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, button, a, [role="tab"]')) return;
    if (document.querySelector('dialog[open]')) return;

    switch (e.key) {
      case ' ':
      case 'Enter':
        e.preventDefault();
        roll();
        break;
      case 'n':
      case 'N':
        startNewMatch();
        break;
      case 'm':
      case 'M':
        toggleSound();
        break;
      case 't':
      case 'T':
        toggleTheme();
        break;
      default:
    }
  });

  systemPrefersLight.addEventListener('change', applyTheme);

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  buildModeOptions();
  applyTheme();
  applySound();
  renderAll();
  persist();
})();
