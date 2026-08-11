/**
 * app.js — boot and routing.
 *
 * Hash routing, not path routing. GitHub Pages has no rewrite rules, so
 * `/calendar` returns a 404 on refresh while `#/calendar` survives it.
 *
 * Routes
 *   #/routines            the list
 *   #/routines/:id        one routine's preview
 *   #/play/:id            the timer
 *   #/calendar            the month grid
 *   #/build[/:id]         the routine builder
 *   #/import              build a routine from a YouTube link
 */

import { loadCatalog, getRoutine, allRoutines } from './catalog.js';
import { renderList, renderPreview } from './routines.js';
import { renderPlayer, teardown } from './player.js';
import { renderCalendar } from './calendar.js';
import { renderBuilder } from './builder.js';
import { renderImport } from './importer.js';
import { mountRank, refreshRank } from './rank.js';
import { getPrefs, setPrefs } from './store.js';
import { audio } from './audio.js';
import { esc } from './ui.js';

const view = document.getElementById('view');
let catalog = null;

/* ── Routing ──────────────────────────────────────────────────────────── */

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { section: parts[0] || 'routines', id: parts[1] || null };
}

function route() {
  const { section, id } = parseHash();

  // Any navigation away from the player stops the clock and restores the
  // chrome — including the browser Back button, which is the common case.
  if (section !== 'play') teardown();

  markActive(section === 'calendar' ? 'calendar' : 'routines');

  // Recomputed per navigation: finishing a routine returns here through the
  // router, so this is where a new rank becomes visible.
  refreshRank();

  try {
    // Recomputed per navigation: custom routines are created, edited and
    // deleted while the app is running, so a snapshot taken at boot goes stale.
    const routines = allRoutines(catalog);

    if (section === 'calendar') {
      renderCalendar(view, { routines });
    } else if (section === 'build') {
      renderBuilder(view, catalog, id);
    } else if (section === 'import') {
      renderImport(view, catalog);
    } else if (section === 'play' && id) {
      const routine = getRoutine(routines, id);
      routine ? renderPlayer(view, routine) : notFound();
    } else if (section === 'routines' && id) {
      const routine = getRoutine(routines, id);
      routine ? renderPreview(view, routine) : notFound();
    } else {
      renderList(view, { routines });
    }
  } catch (error) {
    fail(error);
  }

  // Scroll to the top on every navigation; the player especially must not
  // open halfway down the previous screen.
  window.scrollTo(0, 0);
}

function markActive(section) {
  document.querySelectorAll('[data-section]').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.section === section);
  });
}

function notFound() {
  view.innerHTML = `
    <div class="section-head"><h2 class="type-display">Not found</h2></div>
    <a class="back-link" href="#/routines">← All routines</a>
  `;
}

function fail(error) {
  console.error(error);
  view.innerHTML = `
    <div class="section-head"><h2 class="type-display">Something broke</h2></div>
    <p class="type-quiet">${esc(error.message ?? String(error))}</p>
  `;
}

/* ── Click sound ──────────────────────────────────────────────────────── */

/*
  One delegated listener gives every button and link in the app a tap sound,
  rather than wiring a cue at forty call sites and forgetting the next one.

  Controls that already have a sound of their own — Start, Save, quit confirm —
  opt out with `data-quiet`, so a tap and a cue never stack on one press.

  This also doubles as the app-wide audio unlock: whatever the user touches
  first is a genuine gesture, which is the only moment iOS Safari will let a
  context start.
*/
document.addEventListener('click', (event) => {
  const control = event.target.closest('button, a[href], [role="button"]');
  if (!control || control.disabled) return;

  audio.unlock();
  if (!control.closest('[data-quiet]') && !control.hasAttribute('data-quiet')) {
    audio.ui();
  }
}, true);   // capture, so a handler calling stopPropagation cannot silence it

/* ── Theme ────────────────────────────────────────────────────────────── */

function applyTheme() {
  const { theme } = getPrefs();
  const dark = theme === 'dark' ||
    (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'omnia-dark' : 'omnia';
}

document.getElementById('theme-toggle').addEventListener('click', () => {
  const isDark = document.documentElement.dataset.theme === 'omnia-dark';
  setPrefs({ theme: isDark ? 'light' : 'dark' });
  applyTheme();
});

// Follow the system only while the user hasn't picked a side.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (getPrefs().theme === 'auto') applyTheme();
});

/* ── Boot ─────────────────────────────────────────────────────────────── */

async function boot() {
  applyTheme();
  mountRank();

  try {
    catalog = await loadCatalog();
  } catch (error) {
    fail(error);
    return;
  }

  if (!location.hash) location.hash = '#/routines';
  window.addEventListener('hashchange', route);
  route();

  registerServiceWorker();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // file:// has no service worker scope, and registering there only logs noise.
  if (location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* offline support is a bonus; the app works without it */
  });
}

boot();
