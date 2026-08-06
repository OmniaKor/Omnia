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

    /** Live ambient nodes, or null when nothing is playing. */
    this.ambient = null;
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

  /**
   * The user confirmed a quit.
   *
   * Two low notes falling to a close. Quiet, brief, and pointedly not a
   * failure sound — no buzzer, no minor-key sting. Quitting a workout is a
   * normal thing a fifteen-year-old does on a bad day, and the app has no
   * business editorialising about it. The calendar already records what
   * happened; the sound only needs to say "stopped".
   */
  quit() {
    this._note({ freq: 293.66, duration: 0.18, gain: 0.13, type: 'sine' });
    this._note({ freq: 220.00, duration: 0.42, gain: 0.12, type: 'sine', delay: 0.13 });
    this.vibrate(55);
  }

  /**
   * A tap on anything — a button, a link, a routine card.
   *
   * This is the most-heard sound in the app by an order of magnitude, so it is
   * built to disappear: 45 milliseconds, low gain, and high enough in the
   * register to sit clear of every other cue. A UI click that is *noticeable*
   * becomes irritating within a minute of use.
   */
  ui() {
    this._note({ freq: 1180, duration: 0.045, gain: 0.055, type: 'sine' });
  }

  /** A sheet or dialog opening. Slightly softer and lower than a tap. */
  sheetOpen() {
    this._note({ freq: 520, duration: 0.10, gain: 0.075, type: 'sine' });
  }

  /** A sheet or dialog closing — the same gesture, inverted. */
  sheetClose() {
    this._note({ freq: 390, duration: 0.10, gain: 0.065, type: 'sine' });
  }

  /* ── Ambient music ────────────────────────────────────────────────── */

  get musicEnabled() {
    return getPrefs().musicEnabled !== false;
  }

  setMusic(enabled) {
    setPrefs({ musicEnabled: Boolean(enabled) });
    if (enabled) this.startAmbient();
    else this.stopAmbient();
  }

  /**
   * Start the ambient bed: a slow A-minor pad with an occasional shimmer.
   *
   * Synthesised rather than streamed, like everything else here — an mp3 loop
   * long enough not to feel repetitive would be several megabytes, would need
   * a licence, and would not play offline until it had been fetched once.
   *
   * Three things stop it becoming a drone:
   *
   *   · each voice is detuned a few cents against the others, so they beat
   *     slowly against each other instead of sitting still
   *   · a lowpass filter sweeps on a very slow LFO, which is what makes it
   *     read as breathing rather than humming
   *   · sparse pentatonic shimmer notes at irregular intervals
   *
   * Mixed far below the cues. If someone notices the music while counting
   * down from three, it is too loud.
   */
  startAmbient() {
    if (!this.ready || this.ambient || !this.musicEnabled) return;

    try {
      const ctx = this.ctx;
      const now = ctx.currentTime;

      const bus = ctx.createGain();
      bus.gain.setValueAtTime(0.0001, now);
      // A four-second fade-in. Music that arrives abruptly at the start of a
      // workout is startling; this just appears.
      bus.gain.exponentialRampToValueAtTime(0.075, now + 4);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      filter.Q.value = 0.6;

      // The slow sweep. 0.025 Hz is one cycle every forty seconds — below the
      // rate at which a listener tracks it as a repeating pattern.
      const lfo = ctx.createOscillator();
      const lfoDepth = ctx.createGain();
      lfo.frequency.value = 0.025;
      lfoDepth.gain.value = 320;
      lfo.connect(lfoDepth);
      lfoDepth.connect(filter.frequency);
      lfo.start(now);

      // A minor, voiced low and open: A2 · E3 · A3 · C4.
      const voices = [
        { freq: 110.00, detune: -4, gain: 0.55 },
        { freq: 164.81, detune: +3, gain: 0.34 },
        { freq: 220.00, detune: -2, gain: 0.28 },
        { freq: 261.63, detune: +5, gain: 0.20 },
      ].map(({ freq, detune, gain }) => {
        const osc = ctx.createOscillator();
        const level = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        level.gain.value = gain;
        osc.connect(level);
        level.connect(filter);
        osc.start(now);
        return osc;
      });

      filter.connect(bus);
      bus.connect(this.master);

      this.ambient = { bus, filter, lfo, voices, shimmer: null };
      this._scheduleShimmer();
    } catch {
      this.ambient = null;
    }
  }

  /**
   * One quiet bell note, then schedule the next at an irregular interval.
   *
   * Irregular on purpose: evenly spaced notes become a metronome, and a
   * metronome competing with a countdown is the opposite of what this is for.
   */
  _scheduleShimmer() {
    if (!this.ambient) return;

    const delay = 7000 + Math.random() * 11000;
    this.ambient.shimmer = setTimeout(() => {
      if (!this.ambient) return;
      // A minor pentatonic, two octaves up — sits above the pad without
      // crossing into the register the cues occupy.
      const scale = [440.00, 523.25, 587.33, 659.25, 783.99];
      const freq = scale[Math.floor(Math.random() * scale.length)];
      this._note({ freq, duration: 2.6, gain: 0.035, type: 'sine' });
      this._scheduleShimmer();
    }, delay);
  }

  /** Fade out and tear down. Safe when nothing is playing. */
  stopAmbient() {
    const ambient = this.ambient;
    if (!ambient) return;
    this.ambient = null;

    try {
      clearTimeout(ambient.shimmer);

      const now = this.ctx.currentTime;
      ambient.bus.gain.cancelScheduledValues(now);
      ambient.bus.gain.setValueAtTime(Math.max(ambient.bus.gain.value, 0.0001), now);
      ambient.bus.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

      // Stop the sources only after the fade, or the fade is inaudible.
      const stopAt = now + 1.3;
      ambient.lfo.stop(stopAt);
      for (const osc of ambient.voices) osc.stop(stopAt);
      ambient.lfo.onended = () => {
        try { ambient.bus.disconnect(); ambient.filter.disconnect(); } catch { /* gone */ }
      };
    } catch { /* context already torn down */ }
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
