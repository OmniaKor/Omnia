/**
 * audio.js — every sound Omnia makes, plus haptics.
 *
 * Synthesised with OscillatorNode rather than loaded from files. Two reasons:
 * the repository stays text-only, and a workout in a basement with no signal
 * still gets its cues — there is nothing to download.
 *
 * Three rules this module keeps:
 *
 *   1. **Nothing here may ever throw into the timer.** A missing AudioContext,
 *      a blocked autoplay policy, a browser without `vibrate` — all of it
 *      degrades to silence. A workout with no sound is fine; a workout that
 *      stops because a beep failed is not.
 *   2. **The context is created on a user gesture, never before.** iOS Safari
 *      refuses to start audio otherwise, and a context created at page load
 *      arrives permanently suspended.
 *   3. **Muting is instant and remembered.** Someone doing this at 6am in a
 *      shared room needs one tap, not a settings page.
 */

import { getPrefs, setPrefs } from './store.js';

/** Master ceiling. Cues are mixed well below 1 so nothing clips together. */
const MASTER_GAIN = 0.9;

class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ready = false;
  }

  /* ── Lifecycle ────────────────────────────────────────────────────── */

  /**
   * Create or resume the context. Must be called from a user gesture —
   * the Start button, the Ready gate, a settings toggle.
   *
   * Safe to call repeatedly; after the first success it only resumes.
   */
  unlock() {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return false;

        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
        this.master.connect(this.ctx.destination);
        this.ready = true;
      }

      // Browsers suspend the context when a tab is backgrounded, and iOS
      // suspends it on any interruption — a call, a notification.
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  /* ── Preferences ──────────────────────────────────────────────────── */

  get muted() {
    return getPrefs().soundMuted === true;
  }

  setMuted(muted) {
    setPrefs({ soundMuted: Boolean(muted) });
    if (!this.master || !this.ctx) return;
    try {
      // Ramped, not stepped: a gain jump on a running oscillator is an audible
      // click, which is a worse sound than the one being silenced.
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(
        muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.02,
      );
    } catch { /* context died; the pref is still saved */ }
  }

  toggleMuted() {
    const next = !this.muted;
    this.setMuted(next);
    return next;
  }

  /* ── Internals ────────────────────────────────────────────────────── */

  /**
   * One synthesised note with a percussive envelope.
   *
   * @param {object} spec
   * @param {number} spec.freq      hertz
   * @param {number} spec.duration  seconds
   * @param {number} [spec.gain]    peak, before the master
   * @param {OscillatorType} [spec.type]
   * @param {number} [spec.delay]   seconds from now
   * @param {number} [spec.glide]   optional target frequency to slide toward
   */
  _note({ freq, duration, gain = 0.2, type = 'sine', delay = 0, glide = null }) {
    if (!this.ready || this.muted) return;

    try {
      const now = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (glide !== null) osc.frequency.exponentialRampToValueAtTime(glide, now + duration);

      // Attack is 8ms rather than 0 — an instant onset reads as a click.
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(gain, now + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(env);
      env.connect(this.master);

      osc.start(now);
      osc.stop(now + duration + 0.02);
      // Let the node be collected once it has finished; without this a long
      // routine accumulates hundreds of dead oscillators.
      osc.onended = () => { try { env.disconnect(); } catch { /* gone */ } };
    } catch { /* silence beats an exception */ }
  }

  /* ── Cues ─────────────────────────────────────────────────────────── */

  /**
   * The last three seconds of an interval, one per second.
   *
   * Pitch rises across the three so the ear knows *which* tick it just heard
   * without counting — 3 and 1 are different notes, not the same beep repeated.
   * Deliberately shorter and quieter than the tone that follows them, so the
   * countdown reads as approach and the interval end reads as arrival.
   *
   * @param {number} secondsLeft 3, 2 or 1
   */
  tick(secondsLeft) {
    const pitch = { 3: 660, 2: 740, 1: 830 }[secondsLeft];
    if (!pitch) return;

    this._note({ freq: pitch, duration: 0.09, gain: 0.13, type: 'triangle' });
    this.vibrate(12);
  }

  /**
   * An interval ended and the next exercise is up.
   *
   * A rising two-note figure (A4 → E5, a fifth). It resolves upward, which
   * reads as "go" rather than "stop" — important in continuous mode, where
   * this is the only marker between one exercise and the next and the user
   * needs to move, not wait.
   *
   * Louder and longer than a tick so it is never mistaken for one.
   */
  advance() {
    this._note({ freq: 440.00, duration: 0.13, gain: 0.20, type: 'sine' });
    this._note({ freq: 659.25, duration: 0.30, gain: 0.18, type: 'sine', delay: 0.10 });
    this.vibrate([28, 45, 28]);
  }

  /**
   * The interval hit zero and the run is waiting on "Ready?".
   *
   * Continuous mode has no gate, so this fires only when it is off — and it
   * must not sound like `advance()`, because the required action is the
   * opposite: stop, and tap. So it falls (E5 → A4) instead of rising, and the
   * buzz is one long pulse rather than a double tap.
   *
   * This is the cue most likely to be heard rather than seen — the user has
   * just finished thirty seconds of work and is probably not looking at the
   * screen.
   */
  gate() {
    this._note({ freq: 659.25, duration: 0.14, gain: 0.18, type: 'sine' });
    this._note({ freq: 440.00, duration: 0.34, gain: 0.17, type: 'sine', delay: 0.11 });
    this.vibrate(90);
  }

  /**
   * A fifteen-second break has started.
   *
   * Soft, low and slow — the one cue in the app that is not asking for
   * anything. A triangle wave gliding down from D4 to A3, quiet enough to
   * register as "rest" rather than as an instruction.
   */
  breakStart() {
    this._note({
      freq: 293.66, glide: 220.00, duration: 0.55, gain: 0.15, type: 'triangle',
    });
    this.vibrate(40);
  }

  /**
   * The break is over and the exercise timer is resuming.
   *
   * Mirrors breakStart by gliding back up over the same interval, so the pair
   * bracket the rest as one gesture. It resumes mid-exercise rather than
   * starting a new one, so it is gentler than `advance()` — this is a return
   * to work already in progress, not a fresh start.
   */
  breakEnd() {
    this._note({
      freq: 220.00, glide: 329.63, duration: 0.45, gain: 0.17, type: 'triangle',
    });
    this.vibrate([25, 40, 25]);
  }

  /**
   * The routine is finished.
   *
   * The only cue in the app that is properly *musical* — a four-note A-major
   * pentatonic arpeggio, A4 · C#5 · E5 · A5, each note ringing longer than the
   * last. Everything else is a signal; this one is a small reward, and it is
   * the sound a user hears once a day for months. It has to still be pleasant
   * on the sixtieth listen, which is why it resolves cleanly to the octave
   * rather than ending on a bright unresolved interval.
   */
  finish() {
    const notes = [
      { freq: 440.00, delay: 0.00, duration: 0.34 },  // A4
      { freq: 554.37, delay: 0.11, duration: 0.40 },  // C#5
      { freq: 659.25, delay: 0.22, duration: 0.50 },  // E5
      { freq: 880.00, delay: 0.34, duration: 0.95 },  // A5 — resolves
    ];
    for (const note of notes) {
      this._note({ ...note, gain: 0.17, type: 'sine' });
    }
    this.vibrate([45, 60, 45, 60, 110]);
  }

  /* ── Haptics ──────────────────────────────────────────────────────── */

  /**
   * Buzz, where supported. Android honours this; iOS Safari has no Vibration
   * API at all and silently does nothing, which is the correct outcome.
   *
   * Never fires when muted — someone who silenced the app in a quiet room did
   * not ask for a buzzing phone on the floor beside them.
   */
  vibrate(pattern) {
    if (this.muted) return;
    try {
      navigator.vibrate?.(pattern);
    } catch { /* unsupported, or blocked by a permissions policy */ }
  }
}

export const audio = new Audio();
