/**
 * routines.js — the Routines section: the list, and one routine's preview.
 *
 * The preview is where the two pre-run choices are made: 30s or 45s, and
 * whether intervals run continuously. Both are locked once the routine starts,
 * which is why they live here and not in the player.
 */

import { estimateMinutes } from './catalog.js';
import { completionDates, getPrefs, setPrefs } from './store.js';
import { esc, exerciseFigure, exerciseImage, prettyDate } from './ui.js';
import { audio } from './audio.js';

/* ── List ─────────────────────────────────────────────────────────────── */

export function renderList(view, { routines }) {
  view.innerHTML = `
    <div class="section-head">
      <h2 class="type-display">Routines</h2>
      <p class="type-label">${routines.length} sets</p>
    </div>
    <div class="routine-grid">
      ${routines.map(card).join('')}
      <a class="routine-card routine-card--new" href="#/build">
        <span class="routine-card__top">
          <span class="routine-card__name">Build your own</span>
          <span class="type-label">+</span>
        </span>
        <span class="routine-card__meta">Pick exercises, or add your own</span>
      </a>
      <a class="routine-card routine-card--new" href="#/import">
        <span class="routine-card__top">
          <span class="routine-card__name">Import routine from YouTube video</span>
          <span class="type-label">↓</span>
        </span>
        <span class="routine-card__meta">Paste a link and let it read the workout</span>
      </a>
    </div>
  `;

  view.querySelectorAll('[data-routine]').forEach((el) => {
    el.addEventListener('click', () => {
      location.hash = `#/routines/${el.dataset.routine}`;
    });
  });
}

function card(routine) {
  const done = completionDates(routine.id).length;
  const { low, high } = routine.duration;

  return `
    <button class="routine-card" type="button" data-routine="${esc(routine.id)}">
      <span class="routine-card__top">
        <span class="routine-card__name">${esc(routine.name)}</span>
        <span class="type-label">${low}–${high} min</span>
      </span>
      <span class="routine-card__meta">
        <span>${routine.custom ? 'Yours' : esc(routine.focus)}</span>
        <span aria-hidden="true">·</span>
        <span>${routine.exercises.length} exercises</span>
        ${done ? `<span class="routine-card__dot" aria-hidden="true"></span>
                  <span>done ${done}×</span>` : ''}
      </span>
    </button>
  `;
}

/* ── Preview ──────────────────────────────────────────────────────────── */

export function renderPreview(view, routine) {
  const prefs = getPrefs();
  const { low, high } = routine.duration;

  view.innerHTML = `
    <a class="back-link" href="#/routines">← All routines</a>

    <div class="section-head">
      <h2 class="type-display">${esc(routine.name)}</h2>
      <p class="type-label">
        ${routine.custom ? 'Yours' : esc(routine.focus)} · ${low}–${high} min
        ${routine.custom ? `· <a href="#/build/${esc(routine.id)}" class="edit-link">edit</a>` : ''}
      </p>
    </div>

    <p class="hint">Tap any exercise to see how it's done.</p>

    <div class="preview-layout">
      <div>
        <ol class="ex-list">
          ${routine.exercises.map(row).join('')}
        </ol>
        <p class="type-quiet" style="margin-top:1rem" id="history"></p>
      </div>

      <aside class="preview-aside">
        <div class="panel">
          ${idleClock()}

          <div class="opt-row">
            <span class="type-label">Interval</span>
            <span class="seg" role="group" aria-label="Seconds per exercise">
              <button type="button" data-interval="30"
                      aria-pressed="${prefs.intervalSeconds === 30}">30s</button>
              <button type="button" data-interval="45"
                      aria-pressed="${prefs.intervalSeconds === 45}">45s</button>
            </span>
          </div>

          <div class="opt-row">
            <label class="type-label" for="continuous">Continuous</label>
            <input type="checkbox" id="continuous" class="toggle"
                   ${prefs.continuous ? 'checked' : ''}>
          </div>

          <div class="opt-row">
            <label class="type-label" for="music">Music</label>
            <input type="checkbox" id="music" class="toggle"
                   ${prefs.musicEnabled !== false ? 'checked' : ''}>
          </div>

          <div class="opt-row">
            <label class="type-label" for="sound">Sound</label>
            <input type="checkbox" id="sound" class="toggle"
                   ${prefs.soundMuted ? '' : 'checked'}>
          </div>

          <p class="type-quiet" id="estimate" style="margin:0.75rem 0 1rem"></p>

          <button class="btn-omnia" type="button" id="start" data-quiet>Start routine</button>
        </div>
      </aside>
    </div>

    <dialog class="sheet sheet--describe" id="describe" aria-label="Exercise description">
      <div class="sheet__inner describe">
        <div id="describe-body"></div>
        <button class="btn-omnia btn-ghost" type="button" id="describe-close"
                style="margin-top:1.25rem">Exit description</button>
      </div>
    </dialog>
  `;

  /* ── Wiring ── */

  const clockText = view.querySelector('#preview-clock');
  const estimate = view.querySelector('#estimate');

  const sync = () => {
    const { intervalSeconds, continuous } = getPrefs();
    clockText.textContent = `0:${intervalSeconds}`;
    estimate.textContent =
      `${routine.exercises.length} exercises · ` +
      `about ${estimateMinutes(routine.exercises.length, intervalSeconds)} min · ` +
      (continuous ? 'no gaps between exercises' : 'pauses for “Ready?” between exercises');
  };

  view.querySelectorAll('[data-interval]').forEach((button) => {
    button.addEventListener('click', () => {
      setPrefs({ intervalSeconds: Number(button.dataset.interval) });
      view.querySelectorAll('[data-interval]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === button));
      });
      sync();
    });
  });

  view.querySelector('#continuous').addEventListener('change', (event) => {
    setPrefs({ continuous: event.target.checked });
    sync();
  });

  view.querySelector('#music').addEventListener('change', (event) => {
    // A toggle is a gesture, so this doubles as a chance to unlock audio.
    audio.unlock();
    audio.setMusic(event.target.checked);
    // Nothing is playing outside the player, so stop whatever setMusic started.
    audio.stopAmbient();
  });

  view.querySelector('#sound').addEventListener('change', (event) => {
    audio.unlock();
    audio.setMuted(!event.target.checked);
    // Confirm the change in the medium being changed — silence is otherwise
    // indistinguishable from a broken toggle.
    if (event.target.checked) audio.tick(2);
  });

  view.querySelector('#start').addEventListener('click', () => {
    // The one reliable moment to start audio: a real tap, before any
    // navigation. iOS Safari will not create a context anywhere else.
    audio.unlock();
    location.hash = `#/play/${routine.id}`;
  });

  sync();
  wireDescriptions(view, routine);
  renderHistory(view.querySelector('#history'), routine.id);
}

function row(exercise, index) {
  return `
    <li class="ex-row ex-row--tap" data-describe="${index}" role="button" tabindex="0"
        aria-label="How to do ${esc(exercise.name)}">
      <span class="ex-row__num">${String(index + 1).padStart(2, '0')}</span>
      ${exerciseImage(exercise, {
        className: 'ex-row__thumb',
        sizeClass: 'ex-row__thumb',
      })}
      <span>
        <span class="ex-row__name">${esc(exercise.name)}</span><br>
        <span class="ex-row__sub">${esc(exercise.level)}</span>
      </span>
      <span class="ex-row__more" aria-hidden="true">?</span>
    </li>
  `;
}

/**
 * The description sheet: the movement animating, its name, and how to do it.
 *
 * Built on `<dialog>` so the browser handles the focus trap, the backdrop and
 * Escape. Two ways out on purpose — tapping outside is what most people try
 * first, and an explicit button is what the rest look for.
 */
function wireDescriptions(view, routine) {
  const dialog = view.querySelector('#describe');
  const body = view.querySelector('#describe-body');

  const open = (index) => {
    const exercise = routine.exercises[index];
    if (!exercise) return;

    const steps = exercise.instructions?.length
      ? `<ol class="describe__steps">
           ${exercise.instructions.map((s) => `<li>${esc(s)}</li>`).join('')}
         </ol>`
      : '<p class="type-quiet">No description for this one yet.</p>';

    body.innerHTML = `
      ${exerciseFigure(exercise, {
        className: 'describe__figure', sizeClass: 'describe__figure', eager: true,
      })}
      <h3 class="describe__name">${esc(exercise.name)}</h3>
      <p class="type-label">${esc(exercise.level)}</p>
      ${steps}
    `;

    audio.sheetOpen();
    dialog.showModal();
  };

  const close = () => {
    if (!dialog.open) return;
    audio.sheetClose();
    dialog.close();
    // Free the animating frames; leaving them decoded costs memory on a phone
    // for a sheet the user has finished with.
    body.innerHTML = '';
  };

  view.querySelectorAll('[data-describe]').forEach((el) => {
    el.addEventListener('click', () => open(Number(el.dataset.describe)));
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open(Number(el.dataset.describe));
    });
  });

  view.querySelector('#describe-close').addEventListener('click', close);

  // Tapping the backdrop. The dialog element fills the whole viewport, so a
  // click landing on the dialog itself rather than its panel is a click
  // outside the visible sheet.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  // Escape fires `cancel`; route it through the same path so the sound and the
  // cleanup are not skipped.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
}

/** The small line the spec asks for: other dates this routine was completed. */
function renderHistory(node, routineId) {
  const dates = completionDates(routineId);
  if (dates.length === 0) {
    node.textContent = 'Not completed yet.';
    return;
  }
  const shown = dates.slice(0, 8).map((d) => prettyDate(d)).join(' · ');
  const more = dates.length > 8 ? ` +${dates.length - 8} more` : '';
  node.textContent = `Completed on ${shown}${more}`;
}

/** A still stopwatch beside the routine — the same face the player animates. */
function idleClock() {
  return `
    <div class="clock" style="margin-bottom:0.5rem">
      <svg class="clock__svg" viewBox="0 0 100 100" aria-hidden="true">
        <circle class="clock__track" cx="50" cy="50" r="44" stroke-width="3"></circle>
        <circle class="clock__arc" cx="50" cy="50" r="44" stroke-width="3"
                stroke-dasharray="276.46" stroke-dashoffset="276.46"></circle>
      </svg>
      <div class="clock__face">
        <div class="clock__time" id="preview-clock">0:30</div>
        <div class="clock__state">per exercise</div>
      </div>
    </div>
  `;
}
