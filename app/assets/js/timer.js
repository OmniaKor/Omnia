/**
 * timer.js — the interval engine.
 *
 * Drives one countdown at a time and reports state upward; it knows nothing
 * about exercises, routines or the DOM. Everything the product spec pins down
 * about timing lives here:
 *
 *   · intervals are 30s or 45s, fixed before the routine starts
 *   · the last 5 seconds are urgent
 *   · continuous on  → a 3s transition, then the next interval
 *   · continuous off → stop at zero and wait for "Ready?"
 *   · break is 15s, and afterwards the interval RESUMES rather than restarting
 */

export const BREAK_SECONDS = 15;
export const URGENT_SECONDS = 5;

/**
 * The gap continuous mode takes between two exercises.
 *
 * Continuous used to mean *no* gap at all. In practice that put the user on
 * the floor in the wrong position: the clock was already counting the next
 * movement while they were still getting up from the last one. Three seconds
 * is enough to move and not enough to rest — the run still feels unbroken,
 * which is the point of the setting.
 */
export const TRANSITION_SECONDS = 3;

/** @typedef {'idle'|'running'|'transition'|'awaiting-ready'|'break'|'finished'} Phase */

export class IntervalTimer {
  /**
   * @param {object} options
   * @param {number} options.intervalSeconds  30 or 45
   * @param {number} options.count            how many intervals in the routine
   * @param {boolean} options.continuous
   * @param {(s: object) => void} options.onTick    every animation frame
   * @param {(i: number) => void} options.onAdvance fired with the new index
   * @param {() => void} options.onFinish
   */
  constructor({ intervalSeconds, count, continuous, onTick, onAdvance, onFinish }) {
    this.intervalMs = intervalSeconds * 1000;
    this.count = count;
    this.continuous = continuous;

    this.onTick = onTick || (() => {});
    this.onAdvance = onAdvance || (() => {});
    this.onFinish = onFinish || (() => {});

    this.index = 0;
    /** @type {Phase} */
    this.phase = 'idle';
    this.remaining = this.intervalMs;

    /** Where the exercise countdown was when a break interrupted it. */
    this.stashed = null;

    this._raf = null;
    this._last = 0;
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  start() {
    if (this.phase === 'running' || this.phase === 'break') return;
    this.phase = 'running';
    this._loop();
  }

  /**
   * A 15-second break, shown in the same interface.
   *
   * The exercise countdown is stashed, not reset — the spec is explicit that
   * the exercise timer resumes where it left off, so a break taken at 0:08
   * returns to 0:08.
   */
  takeBreak() {
    if (this.phase !== 'running' && this.phase !== 'awaiting-ready') return;
    this.stashed = { remaining: this.remaining, phase: this.phase };
    this.remaining = BREAK_SECONDS * 1000;
    this.phase = 'break';
    this._stopLoop();
    this._loop();
  }

  /** The "Ready?" button, and also the end of a break. */
  resume() {
    if (this.phase === 'awaiting-ready') {
      this._advance();
      return;
    }
    if (this.phase === 'break') {
      this._endBreak();
    }
  }

  destroy() {
    this._stopLoop();
    this.phase = 'finished';
  }

  /* ── Derived state ──────────────────────────────────────────────────── */

  get secondsLeft() {
    return Math.max(0, Math.ceil(this.remaining / 1000));
  }

  /** 0 → just started, 1 → done. Drives the ring. */
  get fraction() {
    const total = this._phaseTotalMs();
    return total === 0 ? 0 : 1 - this.remaining / total;
  }

  /** How long the current phase runs for, so the ring depletes over it. */
  _phaseTotalMs() {
    if (this.phase === 'break') return BREAK_SECONDS * 1000;
    if (this.phase === 'transition') return TRANSITION_SECONDS * 1000;
    return this.intervalMs;
  }

  /** Last five seconds of an exercise interval — never during a break. */
  get isUrgent() {
    return this.phase === 'running' && this.secondsLeft <= URGENT_SECONDS;
  }

  snapshot() {
    return {
      index: this.index,
      count: this.count,
      phase: this.phase,
      secondsLeft: this.secondsLeft,
      fraction: this.fraction,
      isUrgent: this.isUrgent,
      onBreak: this.phase === 'break',

      // Both phases where the clock is counting toward an exercise the user is
      // not doing yet — which is exactly when the screen should be showing them
      // that exercise rather than the one they just finished.
      isPreview: this.phase === 'transition' || this.phase === 'awaiting-ready',
    };
  }

  /* ── Internals ──────────────────────────────────────────────────────── */

  _loop() {
    this._last = performance.now();

    const step = (now) => {
      // Elapsed real time, not a fixed decrement: setInterval drifts, and over
      // a fifteen-interval routine the drift is visible against a wall clock.
      //
      // Clamped at zero because the two clocks involved are not guaranteed to
      // agree. `_last` is set from performance.now() when the loop starts,
      // while `now` is the frame timestamp — and a frame already queued when
      // the loop began carries an *earlier* timestamp. That makes the delta
      // negative and the countdown runs backwards, which shows up as a 30s
      // interval opening on 0:31.
      const delta = Math.max(0, now - this._last);
      this._last = now;
      this.remaining -= delta;

      if (this.remaining <= 0) {
        this.remaining = 0;
        this._atZero();
        return;
      }

      this.onTick(this.snapshot());
      this._raf = requestAnimationFrame(step);
    };

    this._raf = requestAnimationFrame(step);
  }

  _stopLoop() {
    if (this._raf !== null) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _atZero() {
    this._stopLoop();

    if (this.phase === 'break') {
      this._endBreak();
      return;
    }

    // The transition has run its three seconds; the next exercise starts now.
    if (this.phase === 'transition') {
      this._advance();
      return;
    }

    const isLast = this.index >= this.count - 1;
    if (isLast) {
      this.phase = 'finished';
      this.onTick(this.snapshot());
      this.onFinish();
      return;
    }

    if (this.continuous) {
      this._beginTransition();
    } else {
      // Hold at zero until the user taps "Ready?".
      this.phase = 'awaiting-ready';
      this.onTick(this.snapshot());
    }
  }

  /**
   * The three seconds between one exercise and the next in continuous mode.
   *
   * Only ever entered when there IS a next exercise — the last interval goes
   * straight to finished, because counting the user into a movement that does
   * not exist would be a lie.
   */
  _beginTransition() {
    this.phase = 'transition';
    this.remaining = TRANSITION_SECONDS * 1000;
    this.onTick(this.snapshot());
    this._loop();
  }

  _advance() {
    this.index += 1;
    this.remaining = this.intervalMs;
    this.phase = 'running';
    this.onAdvance(this.index);
    this.onTick(this.snapshot());
    this._loop();
  }

  _endBreak() {
    this._stopLoop();
    const stash = this.stashed;
    this.stashed = null;

    if (!stash) {
      this.phase = 'running';
      this.remaining = this.intervalMs;
    } else {
      this.remaining = stash.remaining;
      this.phase = stash.phase;
    }

    this.onTick(this.snapshot());

    // A break taken while already waiting on "Ready?" returns to waiting —
    // it should not launch the next exercise behind the user's back.
    if (this.phase === 'running') this._loop();
  }
}
