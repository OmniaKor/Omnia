/**
 * timer.js — the interval engine.
 *
 * Drives one countdown at a time and reports state upward; it knows nothing
 * about exercises, routines or the DOM. Everything the product spec pins down
 * about timing lives here:
 *
 *   · intervals are 30s or 45s, fixed before the routine starts
 *   · the last 5 seconds are urgent
 *   · continuous on  → intervals run back to back
 *   · continuous off → stop at zero and wait for "Ready?"
 *   · break is 15s, and afterwards the interval RESUMES rather than restarting
 */

export const BREAK_SECONDS = 15;
export const URGENT_SECONDS = 5;

/** @typedef {'idle'|'running'|'awaiting-ready'|'break'|'finished'} Phase */

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
    const total = this.phase === 'break' ? BREAK_SECONDS * 1000 : this.intervalMs;
    return total === 0 ? 0 : 1 - this.remaining / total;
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
    };
  }

  /* ── Internals ──────────────────────────────────────────────────────── */

  _loop() {
    this._last = performance.now();

    const step = (now) => {
      // Elapsed real time, not a fixed decrement: setInterval drifts, and over
      // a fifteen-interval routine the drift is visible against a wall clock.
      const delta = now - this._last;
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

    const isLast = this.index >= this.count - 1;
    if (isLast) {
      this.phase = 'finished';
      this.onTick(this.snapshot());
      this.onFinish();
      return;
    }

    if (this.continuous) {
      this._advance();
    } else {
      // Hold at zero until the user taps "Ready?".
      this.phase = 'awaiting-ready';
      this.onTick(this.snapshot());
    }
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
