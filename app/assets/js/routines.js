/**
 * routines.js — the Routines section: the list, and one routine's preview.
 *
 * The preview is where the two pre-run choices are made: 30s or 45s, and
 * whether intervals run continuously. Both are locked once the routine starts,
 * which is why they live here and not in the player.
 */

import { estimateMinutes } from './catalog.js';
import { completionDates, getPrefs, setPrefs } from './store.js';
import { esc, exerciseImage, prettyDate } from './ui.js';

/* ── List ─────────────────────────────────────────────────────────────── */

export function renderList(view, { routines }) {
  view.innerHTML = `
    <div class="section-head">
      <h2 class="type-display">Routines</h2>
      <p class="type-label">${routines.length} sets</p>
    </div>
    <div class="routine-grid">
      ${routines.map(card).join('')}
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
        <span>${esc(routine.focus)}</span>
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
      <p class="type-label">${esc(routine.focus)} · ${low}–${high} min</p>
    </div>

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

          <p class="type-quiet" id="estimate" style="margin:0.75rem 0 1rem"></p>

          <button class="btn-omnia" type="button" id="start">Start routine</button>
        </div>
      </aside>
    </div>
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

  view.querySelector('#start').addEventListener('click', () => {
    location.hash = `#/play/${routine.id}`;
  });

  sync();
  renderHistory(view.querySelector('#history'), routine.id);
}

function row(exercise, index) {
  return `
    <li class="ex-row">
      <span class="ex-row__num">${String(index + 1).padStart(2, '0')}</span>
      ${exerciseImage(exercise, {
        className: 'ex-row__thumb',
        sizeClass: 'ex-row__thumb',
      })}
      <span>
        <span class="ex-row__name">${esc(exercise.name)}</span><br>
        <span class="ex-row__sub">${esc(exercise.level)}</span>
      </span>
    </li>
  `;
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
