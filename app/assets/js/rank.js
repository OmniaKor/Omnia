/**
 * rank.js — the consistency badge in the masthead circle.
 *
 * Separate from app.js so calendar.js can import refreshRank without a cycle
 * (app.js already imports calendar.js). All the arithmetic lives in
 * streak.js; this file only paints it.
 */

import { allSessions, getPrefs, setPrefs, localDate } from './store.js';
import { streakState } from './streak.js';
import { esc } from './ui.js';

const button = document.getElementById('rank');
const art = document.getElementById('rank-art');
const detail = document.getElementById('rank-detail');

/* Which planet is on screen. The src is only reassigned when the rank
   actually changes, so a route that leaves the rank alone does not restart
   the animation or refetch the image — the same reason player.js tracks
   shownFigureIndex. */
let shownRank = null;

/** The reveal line. `best` is worth showing even when the streak is broken. */
export function rankText(state) {
  if (state.unranked) return 'No streak yet';
  if (state.streak === 0) return `No current streak · best ${state.best}`;
  return `${state.streak} day streak · best ${state.best}`;
}

function ariaLabel(state) {
  return state.unranked
    ? 'Consistency rank. No streak yet.'
    : `Consistency rank ${state.rank}. ${rankText(state)}.`;
}

/** Recompute from history and repaint. Cheap enough to run on every route. */
export function refreshRank() {
  if (!button || !art || !detail) return;

  if (getPrefs().streakIcon === false) {
    button.hidden = true;
    detail.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    shownRank = null;
    return;
  }

  const state = streakState(allSessions(), localDate());
  button.hidden = false;

  if (state.rank !== shownRank) {
    art.src = `assets/img/streak/${state.rank.toLowerCase()}.webp`;
    shownRank = state.rank;
    art.classList.remove('is-new');
    void art.offsetWidth;          // reflow, so the animation restarts
    art.classList.add('is-new');
  }

  button.classList.toggle('is-unranked', state.unranked);
  button.setAttribute('aria-label', ariaLabel(state));
  detail.innerHTML =
    `${esc(rankText(state))} · <button class="rank__hide" type="button">Hide</button>`;
}

/** Wire the badge once, at boot. */
export function mountRank() {
  if (!button || !detail) return;

  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!open));
    detail.hidden = open;
  });

  detail.addEventListener('click', (event) => {
    if (!event.target.closest('.rank__hide')) return;
    setPrefs({ streakIcon: false });
    refreshRank();
  });

  refreshRank();
}
