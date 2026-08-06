/**
 * calendar.js — a month grid, one pastel square per day.
 *
 *   green   at least one routine finished in full
 *   yellow  quit, and nothing finished that day
 *   red     no ab workout at all
 *
 * Green beats yellow: quit once and then finish anything, and the day is green.
 *
 * Days before the user's first ever session are blank rather than red — a wall
 * of red for the weeks before someone installed the app is a punishment for
 * nothing, and it buries the streak they do have.
 */

import { dayStatus, firstActiveDate, localDate, sessionsOn } from './store.js';
import { esc, prettyDate } from './ui.js';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Month currently on screen; survives re-renders within a session. */
let cursor = new Date();
let selected = null;

export function renderCalendar(view, { routines }) {
  const names = new Map(routines.map((r) => [r.id, r.name]));
  const today = localDate();

  const draw = () => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const monthLabel = cursor.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });

    // Monday-first: getDay() is Sunday-first, so Sunday's 0 becomes 6.
    const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const atCurrentMonth =
      year === new Date().getFullYear() && month === new Date().getMonth();

    view.innerHTML = `
      <div class="section-head">
        <h2 class="type-display">Calendar</h2>
        <p class="type-label">${streakLabel()}</p>
      </div>

      <div class="cal-layout">
        <div>
          <div class="cal__head">
            <span class="cal__month">${esc(monthLabel)}</span>
            <span class="cal__nav">
              <button type="button" id="prev" aria-label="Previous month">‹</button>
              <button type="button" id="next" aria-label="Next month"
                      ${atCurrentMonth ? 'disabled' : ''}>›</button>
            </span>
          </div>

          <div class="cal__grid" role="grid">
            ${DOW.map((d) => `<div class="cal__dow">${d}</div>`).join('')}
            ${Array.from({ length: firstDay }, () =>
              '<div class="cal__day cal__day--pad"></div>').join('')}
            ${Array.from({ length: daysInMonth }, (_, i) =>
              dayCell(year, month, i + 1, today)).join('')}
          </div>

          <div class="cal__legend">
            <span><i class="cal__swatch" style="background:var(--pastel-green)"></i> finished</span>
            <span><i class="cal__swatch" style="background:var(--pastel-yellow)"></i> quit</span>
            <span><i class="cal__swatch" style="background:var(--pastel-red)"></i> missed</span>
          </div>
        </div>

        <aside class="cal-aside">
          <div class="panel cal__detail" id="detail"></div>
        </aside>
      </div>
    `;

    view.querySelector('#prev').addEventListener('click', () => {
      cursor = new Date(year, month - 1, 1);
      draw();
    });
    view.querySelector('#next').addEventListener('click', () => {
      cursor = new Date(year, month + 1, 1);
      draw();
    });

    view.querySelectorAll('[data-date]').forEach((cell) => {
      cell.addEventListener('click', () => {
        selected = cell.dataset.date;
        view.querySelectorAll('[data-date]')
          .forEach((c) => c.classList.toggle('is-selected', c === cell));
        showDetail(view.querySelector('#detail'), selected, names);
      });
    });

    showDetail(view.querySelector('#detail'), selected ?? today, names);
  };

  draw();
}

function dayCell(year, month, day, today) {
  const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const start = firstActiveDate();

  const isFuture = key > today;
  const isBeforeStart = start !== null && key < start;
  const isBlank = isFuture || isBeforeStart || start === null;

  const status = isBlank ? null : dayStatus(key);
  const classes = [
    'cal__day',
    status ? `cal__day--${status}` : '',
    key === today ? 'cal__day--today' : '',
    isFuture ? 'cal__day--future' : '',
    key === selected ? 'is-selected' : '',
  ].filter(Boolean).join(' ');

  const label = status
    ? `${prettyDate(key)} — ${{ green: 'finished', yellow: 'quit', red: 'missed' }[status]}`
    : prettyDate(key);

  return `<button class="${classes}" type="button" data-date="${key}"
                  aria-label="${esc(label)}" ${isFuture ? 'disabled' : ''}>${day}</button>`;
}

function showDetail(node, dateKey, names) {
  const sessions = sessionsOn(dateKey);

  if (sessions.length === 0) {
    node.innerHTML = `
      <p class="type-label">${esc(prettyDate(dateKey, { year: 'numeric' }))}</p>
      <p class="type-quiet" style="margin:0.5rem 0 0">Nothing logged.</p>
    `;
    return;
  }

  node.innerHTML = `
    <p class="type-label">${esc(prettyDate(dateKey, { year: 'numeric' }))}</p>
    <ul style="list-style:none;margin:0.75rem 0 0;padding:0;display:grid;gap:0.5rem">
      ${sessions.map((s) => `
        <li style="display:flex;justify-content:space-between;gap:0.75rem;font-size:0.85rem">
          <span>${esc(names.get(s.routineId) ?? s.routineId)}</span>
          <span class="type-quiet">
            ${s.status === 'completed' ? '✓ finished' : `– quit at ${s.exercisesDone}`}
          </span>
        </li>
      `).join('')}
    </ul>
  `;
}

/** Consecutive days ending today (or yesterday) with a finished routine. */
function streakLabel() {
  let streak = 0;
  const day = new Date();

  // Today not being green yet shouldn't read as a broken streak at 9am, so
  // start counting from yesterday when today is still empty.
  if (dayStatus(localDate(day)) !== 'green') day.setDate(day.getDate() - 1);

  while (dayStatus(localDate(day)) === 'green') {
    streak += 1;
    day.setDate(day.getDate() - 1);
  }

  return streak === 0 ? 'No streak yet' : `${streak} day streak`;
}
