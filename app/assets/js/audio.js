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
