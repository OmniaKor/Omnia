/**
 * player.js — the screen a user actually spends ten minutes on.
 *
 * One exercise beside one clock. Everything the spec pins down about how the
 * run behaves lives in timer.js; this module is what that engine looks like.
 *
 * Completion is recorded once, for the routine — never per exercise.
 */

import { IntervalTimer, BREAK_SECONDS } from './timer.js';
import { addSession, getPrefs, setPrefs } from './store.js';
import { announce, clockText, esc, exerciseImage } from './ui.js';
import { audio } from './audio.js';

/** Circumference of the r=44 ring in the 100×100 viewBox. */
const RING = 2 * Math.PI * 44;

let active = null;

/**
 * The last whole second a cue fired on.
 *
 * paint() runs every animation frame — sixty times a second — so cues have to
 * be gated on the second *changing*, not on its value. Without this the last
 * three seconds would fire roughly 180 beeps.
 */
let lastCueSecond = null;

/** The phase the last paint saw, so transitions can be detected. */
let lastCuePhase = null;

export function renderPlayer(view, routine) {
  teardown();

  lastCueSecond = null;
  lastCuePhase = null;
  // Belt and braces. The real unlock happens on the Start button, inside the
  // gesture; by the time the hashchange lands this is only a resume.
  audio.unlock();

  const { intervalSeconds, continuous } = getPrefs();
  const exercises = routine.exercises;

  document.body.classList.add('is-playing');

  view.innerHTML = shell(routine, exercises, intervalSeconds, continuous);

  const els = {
    clock: view.querySelector('.clock'),
    time: view.querySelector('#clock-time'),
    state: view.querySelector('#clock-state'),
    arc: view.querySelector('#clock-arc'),
    figure: view.querySelector('#figure'),
    name: view.querySelector('#ex-name'),
    next: view.querySelector('#ex-next'),
    progress: view.querySelector('#progress'),
    bar: view.querySelector('#bar'),
    gate: view.querySelector('#gate'),
    breakBtn: view.querySelector('#break'),
    quitBtn: view.querySelector('#quit'),
    continuous: view.querySelector('#continuous-live'),
    quitDialog: view.querySelector('#quit-dialog'),
    mute: view.querySelector('#mute'),
    muteGlyph: view.querySelector('#mute-glyph'),
  };

  const startedAt = new Date().toISOString();

  const timer = new IntervalTimer({
    intervalSeconds,
    continuous,
    count: exercises.length,
    onTick: (s) => paint(els, s, exercises),
    onAdvance: (index) => {
      showExercise(els, exercises, index);
      audio.advance();
      announce(exercises[index].name);
    },
    onFinish: () => finish(view, routine, timer, startedAt),
  });

  active = { timer, view };

  showExercise(els, exercises, 0);
  paint(els, timer.snapshot(), exercises);
  timer.start();
  requestWakeLock();
  audio.startAmbient();

  /* ── Controls ── */

  els.gate.querySelector('button').addEventListener('click', () => timer.resume());

  els.breakBtn.addEventListener('click', () => {
    if (timer.phase === 'break') {
      timer.resume();                       // tapping again ends the break early
    } else {
      timer.takeBreak();
      announce(`${BREAK_SECONDS} second break`);
    }
  });

  // Live, because the spec puts this box next to the clock. Flipping it mid-run
  // only changes what happens at the *next* zero, so it is safe to expose here.
  els.continuous.addEventListener('change', (event) => {
    timer.continuous = event.target.checked;
    setPrefs({ continuous: event.target.checked });
  });

  // One tap to silence everything, for the 6am-in-a-shared-room case. Kept in
  // the top bar rather than a settings screen precisely because the moment
  // someone needs it, they need it immediately.
  const paintMute = () => {
    const muted = audio.muted;
    els.mute.setAttribute('aria-pressed', String(muted));
    els.mute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute all sound');
    els.muteGlyph.textContent = muted ? '✕' : '♪';
    els.mute.classList.toggle('is-off', muted);
  };

  els.mute.addEventListener('click', () => {
    audio.unlock();               // first tap may also be the unlocking gesture
    const muted = audio.toggleMuted();
    if (muted) audio.stopAmbient();
    else audio.startAmbient();
    paintMute();
  });

  paintMute();

  // Quitting always asks first. Only a confirmed quit ends the routine.
  els.quitBtn.addEventListener('click', () => els.quitDialog.showModal());

  els.quitDialog.querySelector('#quit-cancel')
    .addEventListener('click', () => els.quitDialog.close());

  els.quitDialog.querySelector('#quit-confirm').addEventListener('click', () => {
    els.quitDialog.close();
    audio.quit();
    addSession({
      routineId: routine.id,
      status: 'quit',
      intervalSeconds,
      continuous: timer.continuous,
      exercisesDone: timer.index,
      startedAt,
    });
    teardown();
    location.hash = `#/routines/${routine.id}`;   // back to the preview
  });
}

/* ── Painting ─────────────────────────────────────────────────────────── */

function paint(els, snapshot, exercises) {
  els.time.textContent = clockText(snapshot.secondsLeft);

  cueSecond(snapshot);
  cuePhase(lastCuePhase, snapshot.phase);
  lastCuePhase = snapshot.phase;

  // Deplete the ring as time runs out.
  els.arc.style.strokeDashoffset = String(RING * snapshot.fraction);

  els.clock.classList.toggle('is-urgent', snapshot.isUrgent);
  els.clock.classList.toggle('is-break', snapshot.onBreak);

  if (snapshot.onBreak) {
    els.state.textContent = 'Break';
    els.breakBtn.textContent = 'End break';
  } else {
    els.state.textContent = snapshot.phase === 'awaiting-ready' ? 'Paused' : 'Go';
    els.breakBtn.textContent = 'Break';
  }

  // The "Ready?" gate only ever appears when continuous is off.
  els.gate.hidden = snapshot.phase !== 'awaiting-ready';

  els.progress.textContent =
    `${String(snapshot.index + 1).padStart(2, '0')} / ` +
    `${String(exercises.length).padStart(2, '0')}`;

  const done = snapshot.index + (snapshot.phase === 'finished' ? 1 : snapshot.fraction);
  els.bar.style.width = `${(done / exercises.length) * 100}%`;
}

/**
 * Fire the per-second cues, once each.
 *
 * The countdown ticks match the red digits exactly — they are the same signal
 * in a second channel, for the moment when the phone is face-down on the floor
 * or the user is mid-plank looking at the ceiling.
 */
function cueSecond(snapshot) {
  const second = snapshot.secondsLeft;
  if (second === lastCueSecond) return;
  lastCueSecond = second;

  if (snapshot.phase === 'running' && second <= 3 && second >= 1) {
    audio.tick(second);
  }
}

/**
 * Fire the cues that belong to a change of phase rather than a tick.
 *
 * Phase transitions are the moments the user needs to *hear*, because each one
 * asks for a different action: keep going, stop and tap, rest, resume.
 */
function cuePhase(previous, next) {
  if (previous === next) return;

  // Exclusive, in priority order — a transition gets exactly one cue.
  //
  // Leaving a break matters more than whatever the run returns *to*: breaking
  // from the "Ready?" gate comes back to that same gate, and firing both
  // breakEnd and gate would stack two cues on one transition.
  if (previous === 'break') {
    audio.breakEnd();
    return;
  }

  if (next === 'break') {
    audio.breakStart();
    return;
  }

  // Continuous mode never reaches this phase — there is no gate to announce.
  if (next === 'awaiting-ready') audio.gate();
}

function showExercise(els, exercises, index) {
  const exercise = exercises[index];
  const next = exercises[index + 1];

  els.figure.innerHTML = exerciseImage(exercise, {
    className: 'player__img',
    sizeClass: 'player__ph',
    alt: exercise.name,
  });
  els.name.textContent = exercise.name;
  els.next.textContent = next ? `Next — ${next.name}` : 'Last one';
}

/* ── Finish ───────────────────────────────────────────────────────────── */

function finish(view, routine, timer, startedAt) {
  releaseWakeLock();
  audio.finish();
  announce('Routine finished');

  view.innerHTML = `
    <div class="player">
      <div class="done">
        <div class="done__mark" aria-hidden="true">✓</div>
        <h2 class="type-display" style="font-size:clamp(1.75rem,7vw,2.5rem)">
          ${esc(routine.name)}
        </h2>
        <p class="type-quiet">${routine.exercises.length} exercises · done</p>
        <div style="width:min(100%,20rem);display:grid;gap:0.6rem;margin-top:1.25rem">
          <button class="btn-omnia" type="button" id="mark">Mark complete</button>
          <button class="btn-omnia btn-ghost" type="button" id="skip">Not this time</button>
        </div>
      </div>
    </div>
  `;

  const record = (status) => {
    addSession({
      routineId: routine.id,
      status,
      intervalSeconds: timer.intervalMs / 1000,
      continuous: timer.continuous,
      exercisesDone: routine.exercises.length,
      startedAt,
    });
    teardown();
    location.hash = '#/calendar';
  };

  // The completion check the spec asks for: once, after the routine.
  view.querySelector('#mark').addEventListener('click', () => record('completed'));

  // Reaching the end without claiming it counts as an unfinished attempt —
  // yellow, not green. Green has to mean something.
  view.querySelector('#skip').addEventListener('click', () => record('quit'));
}

/* ── Markup ───────────────────────────────────────────────────────────── */

function shell(routine, exercises, intervalSeconds, continuous) {
  return `
    <div class="player">
      <div class="player__top">
        <span class="player__progress" id="progress">01 / ${exercises.length}</span>
        <span class="player__top-right">
          <span class="player__progress">${esc(routine.name)} · ${intervalSeconds}s</span>
          <button class="icon-btn" type="button" id="mute" aria-pressed="false"
                  aria-label="Mute all sound"><span id="mute-glyph">♪</span></button>
        </span>
      </div>
      <div class="player__bar"><span id="bar" style="width:0%"></span></div>

      <div class="player__body">
        <div class="player__figure">
          <div id="figure"></div>
          <h2 class="player__name" id="ex-name"></h2>
          <p class="player__next" id="ex-next"></p>
        </div>

        <div>
          <div class="clock">
            <svg class="clock__svg" viewBox="0 0 100 100" aria-hidden="true">
              <circle class="clock__track" cx="50" cy="50" r="44" stroke-width="3"></circle>
              <circle class="clock__arc" id="clock-arc" cx="50" cy="50" r="44"
                      stroke-width="3" stroke-dasharray="${RING.toFixed(2)}"
                      stroke-dashoffset="0"></circle>
            </svg>
            <div class="clock__face">
              <div class="clock__time" id="clock-time">0:${intervalSeconds}</div>
              <div class="clock__state" id="clock-state">Go</div>
            </div>

            <div class="ready-gate" id="gate" hidden>
              <button type="button">Ready?</button>
            </div>
          </div>

          <label class="opt-row" style="justify-content:center;gap:0.6rem;border:0">
            <input type="checkbox" id="continuous-live" class="toggle toggle-sm"
                   ${continuous ? 'checked' : ''}>
            <span class="type-label">Continuous</span>
          </label>
        </div>
      </div>

      <div class="player__controls">
        <button class="btn-omnia btn-ghost" type="button" id="break">Break</button>
        <button class="btn-omnia btn-ghost" type="button" id="quit">Quit</button>
      </div>
    </div>

    <dialog class="sheet" id="quit-dialog">
      <div class="sheet__inner">
        <h3 class="type-display" style="font-size:1.4rem">Quit this routine?</h3>
        <p class="type-quiet" style="margin:0.5rem 0 0">
          Today will be marked yellow unless you finish a routine later.
        </p>
        <div class="sheet__actions">
          <button class="btn-omnia btn-ghost" type="button" id="quit-cancel">Keep going</button>
          <button class="btn-omnia" type="button" id="quit-confirm">Quit</button>
        </div>
      </div>
    </dialog>
  `;
}

/* ── Wake lock ────────────────────────────────────────────────────────── */

/* A phone that sleeps mid-plank is a phone the user has to touch with their
   hands on the floor. Best-effort only — unsupported everywhere it matters
   less, and it must never throw into the run. */

let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    /* denied, low battery, or not visible — the routine runs regardless */
  }
}

function releaseWakeLock() {
  try {
    wakeLock?.release();
  } catch { /* already gone */ }
  wakeLock = null;
}

// Re-acquire after the user switches away and back; the lock is dropped on hide.
// Browsers also suspend the audio context on hide, so the cues need waking too —
// without this, coming back from a notification leaves the rest of the routine
// silent with no sign why.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !active) return;
  if (!wakeLock) requestWakeLock();
  audio.unlock();
});

/* ── Teardown ─────────────────────────────────────────────────────────── */

/** Stop the clock and put the chrome back. Safe to call when nothing is running. */
export function teardown() {
  if (active) {
    active.timer.destroy();
    active = null;
  }
  releaseWakeLock();
  // The music belongs to the workout, not the app. Leaving the player — by
  // quitting, finishing, or the browser Back button — stops it.
  audio.stopAmbient();
  document.body.classList.remove('is-playing');
}
