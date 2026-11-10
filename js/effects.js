/**
 * Who's Right? — sound and visual effects.
 *
 * Sounds are synthesised on the fly with the Web Audio API (no audio files to
 * download), and confetti is a tiny canvas particle system. Both respect the
 * user's preferences: sound can be muted and confetti is skipped entirely when
 * `prefers-reduced-motion` is set.
 */
(function (root) {
  'use strict';

  const prefersReducedMotion = () =>
    typeof root.matchMedia === 'function' && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------ */
  /* Sound                                                               */
  /* ------------------------------------------------------------------ */

  const sound = (function () {
    let ctx = null;
    let enabled = true;

    // Browsers only allow audio after a user gesture, so the context is
    // created lazily on the first roll rather than on page load.
    function context() {
      if (!enabled) return null;
      const AudioCtx = root.AudioContext || root.webkitAudioContext;
      if (!AudioCtx) return null;
      if (!ctx) ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    /** A short burst of band-passed noise — sounds like a die hitting a table. */
    function clack(ac, when, volume) {
      const length = Math.floor(ac.sampleRate * 0.035);
      const buffer = ac.createBuffer(1, length, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
      }
      const src = ac.createBufferSource();
      src.buffer = buffer;
      const filter = ac.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1600 + Math.random() * 2200;
      filter.Q.value = 1.4;
      const gain = ac.createGain();
      gain.gain.value = volume;
      src.connect(filter).connect(gain).connect(ac.destination);
      src.start(when);
    }

    function tone(ac, freq, when, duration, volume) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(volume, when + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      osc.connect(gain).connect(ac.destination);
      osc.start(when);
      osc.stop(when + duration + 0.05);
    }

    function melody(notes, step, duration, volume) {
      const ac = context();
      if (!ac) return;
      const start = ac.currentTime + 0.02;
      notes.forEach((freq, i) => tone(ac, freq, start + i * step, duration, volume));
    }

    return {
      get enabled() {
        return enabled;
      },
      setEnabled(value) {
        enabled = Boolean(value);
        if (!enabled && ctx) ctx.suspend();
      },
      /** Rattle of dice that slows down as they settle. */
      rattle(seconds) {
        const ac = context();
        if (!ac) return;
        const start = ac.currentTime + 0.01;
        let t = 0;
        while (t < seconds) {
          clack(ac, start + t, 0.12 + Math.random() * 0.18);
          t += 0.035 + Math.random() * 0.06 * (1 + 2 * (t / seconds));
        }
      },
      point() {
        melody([523.25, 659.25, 783.99], 0.09, 0.25, 0.16);
      },
      tie() {
        melody([440, 415.3], 0.14, 0.3, 0.14);
      },
      fanfare() {
        melody([523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5], 0.11, 0.4, 0.17);
      },
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Confetti                                                            */
  /* ------------------------------------------------------------------ */

  function confetti(canvas, options) {
    const opts = options || {};
    if (!canvas || prefersReducedMotion()) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const colors = opts.colors && opts.colors.length ? opts.colors : ['#4ECCA3', '#FF7A7A', '#FFC857', '#A79BFF'];
    const duration = opts.duration || 3200;
    const count = opts.count || 180;
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    const width = root.innerWidth;
    const height = root.innerHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.hidden = false;

    const particles = Array.from({ length: count }, (_, i) => {
      const fromLeft = i % 2 === 0;
      return {
        x: fromLeft ? -10 : width + 10,
        y: height * (0.55 + Math.random() * 0.3),
        vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 10),
        vy: -(10 + Math.random() * 12),
        size: 6 + Math.random() * 7,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.35,
        wobble: Math.random() * Math.PI * 2,
        color: colors[i % colors.length],
        round: Math.random() < 0.3,
      };
    });

    let startTime = null;
    let last = null;

    function frame(now) {
      if (startTime === null) startTime = last = now;
      const elapsed = now - startTime;
      const dt = Math.min(2.5, (now - last) / 16.67); // normalise to ~60fps
      last = now;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const fade = Math.max(0, 1 - Math.max(0, elapsed - duration * 0.6) / (duration * 0.4));

      for (const p of particles) {
        p.vy += 0.38 * dt;
        p.vx *= Math.pow(0.985, dt);
        p.vy *= Math.pow(0.99, dt);
        p.wobble += 0.12 * dt;
        p.x += (p.vx + Math.sin(p.wobble) * 0.8) * dt;
        p.y += p.vy * dt;
        p.rotation += p.spin * dt;

        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * Math.abs(Math.cos(p.wobble)) + 1);
        }
        ctx.restore();
      }

      if (elapsed < duration) {
        root.requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, width, height);
        canvas.hidden = true;
      }
    }

    root.requestAnimationFrame(frame);
  }

  root.WhoIsRightFX = Object.freeze({ sound, confetti, prefersReducedMotion });
})(window);
