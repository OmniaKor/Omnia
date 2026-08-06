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

/** Circumference of the r=44 ring in the 100×100 viewBox. */
const RING = 2 * Math.PI * 44;

let active = null;

export function renderPlayer(view, routine) {
  teardown();

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
  };

  const startedAt = new Date().toISOString();

  const timer = new IntervalTimer({
    intervalSeconds,
    continuous,
    count: exercises.length,
    onTick: (s) => paint(els, s, exercises),
    onAdvance: (index) => {
      showExercise(els, exercises, index);
      announce(exercises[index].name);
    },
    onFinish: () => finish(view, routine, timer, startedAt),
  });

  active = { timer, view };

  showExercise(els, exercises, 0);
  paint(els, timer.snapshot(), exercises);
  timer.start();
  requestWakeLock();

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

  // Quitting always asks first. Only a confirmed quit ends the routine.
  els.quitBtn.addEventListener('click', () => els.quitDialog.showModal());

  els.quitDialog.querySelector('#quit-cancel')
    .addEventListener('click', () => els.quitDialog.close());

  els.quitDialog.querySelector('#quit-confirm').addEventListener('click', () => {
    els.quitDialog.close();
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
        <span class="player__progress">${esc(routine.name)} · ${intervalSeconds}s</span>
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
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && active && !wakeLock) requestWakeLock();
});

/* ── Teardown ─────────────────────────────────────────────────────────── */

/** Stop the clock and put the chrome back. Safe to call when nothing is running. */
export function teardown() {
  if (active) {
    active.timer.destroy();
    active = null;
  }
  releaseWakeLock();
  document.body.classList.remove('is-playing');
}
