/**
 * builder.js — build and edit your own routine.
 *
 * Two ways in, because two different users arrive here: someone who knows the
 * movement they want and types it, and someone who wants to see what is
 * available and scroll. Search and the browsable list are the same list, one
 * filtered.
 *
 * A performance note that shapes the whole module: the catalog rows are built
 * **once** and filtered by toggling `hidden`, never re-rendered. Re-rendering
 * on each keystroke would rebuild ~43 `<img>` elements, and a fresh `<img>`
 * flickers while the browser re-resolves it even when it is cached. Hiding
 * rows keeps typing at frame rate and the thumbnails perfectly stable.
 */

import { estimateRange, MAX_MINUTES, MIN_MINUTES } from './catalog.js';
import { deleteCustomRoutine, getCustomRoutine, saveCustomRoutine } from './store.js';
import { audio } from './audio.js';
import { announce, esc, exerciseImage } from './ui.js';

/**
 * How many catalog rows to show before "View N more".
 *
 * The catalog is 43 movements and every one is a thumbnail row, so left whole
 * it buries "+ Add your own exercise" under a screen and a half of scrolling —
 * which is exactly where someone lands once they have decided nothing in the
 * list is the movement they meant. Eight is about a phone screen.
 */
const PAGE = 8;

/** Working copy. Never written to storage until Save. */
let draft = null;

export function renderBuilder(view, catalog, routineId) {
  draft = loadDraft(routineId);

  view.innerHTML = shell(draft, catalog);

  const els = {
    name: view.querySelector('#routine-name'),
    search: view.querySelector('#search'),
    clear: view.querySelector('#search-clear'),
    rows: view.querySelector('#catalog-rows'),
    more: view.querySelector('#show-more'),
    empty: view.querySelector('#catalog-empty'),
    picked: view.querySelector('#picked'),
    summary: view.querySelector('#summary'),
    save: view.querySelector('#save'),
    saveBar: view.querySelector('#save-bar'),
    barCount: view.querySelector('#bar-count'),
    count: view.querySelector('#result-count'),
  };

  /* Row lookup by id, so add/remove can flip a row's state in O(1) instead of
     scanning the DOM. */
  const rowsById = new Map(
    [...els.rows.querySelectorAll('[data-add]')].map((row) => [row.dataset.add, row]),
  );

  /* ── Filtering ── */

  let level = 'all';

  /* Set by "View N more" and never unset. Once someone has asked to see the
     whole list, collapsing it again behind their back — on the next keystroke,
     say — reads as the page losing their place. */
  let expanded = false;

  const applyFilter = () => {
    const query = els.search.value.trim().toLowerCase();
    let matched = 0;

    for (const exercise of catalog.exercises) {
      const row = rowsById.get(exercise.id);
      if (!row) continue;

      const matches =
        (query === '' || exercise.search.includes(query)) &&
        (level === 'all' || exercise.level === level);

      if (matches) matched += 1;
      // Count first, then cap. A row past the fold is still a match; it is
      // hidden for room, not because it failed the filter.
      row.hidden = !matches || (!expanded && matched > PAGE);
    }

    const shown = expanded ? matched : Math.min(matched, PAGE);
    const rest = matched - shown;

    els.empty.hidden = matched > 0;
    els.more.hidden = rest === 0;
    els.more.textContent = `View ${rest} more`;
    els.count.textContent = rest === 0
      ? `${matched} shown`
      : `${shown} of ${matched} shown`;
    els.clear.hidden = els.search.value === '';

    return matched;
  };

  // No debounce: filtering is a single pass over a few dozen records and a
  // boolean attribute flip. Deferring it would only add latency to the one
  // interaction that must feel instant.
  els.search.addEventListener('input', applyFilter);

  els.more.addEventListener('click', () => {
    expanded = true;
    // Same as filtering: rows are revealed by flipping `hidden`, so the
    // thumbnails already on screen are never rebuilt and never flicker.
    announce(`Showing all ${applyFilter()} exercises`);
  });

  els.clear.addEventListener('click', () => {
    els.search.value = '';
    applyFilter();
    els.search.focus();
  });

  view.querySelectorAll('[data-level]').forEach((chip) => {
    chip.addEventListener('click', () => {
      level = chip.dataset.level;
      view.querySelectorAll('[data-level]').forEach((c) => {
        c.setAttribute('aria-pressed', String(c === chip));
      });
      applyFilter();
    });
  });

  /* ── Picking ── */

  const refresh = () => {
    renderPicked(els.picked, draft, catalog.byId, () => refresh());
    paintSummary(els, draft);
    for (const [id, row] of rowsById) {
      row.classList.toggle('is-picked', draft.exercises.includes(id));
    }
  };

  // One listener on the container rather than 43 on the rows. Fewer handlers
  // to attach on render, and nothing to detach when rows are filtered away.
  els.rows.addEventListener('click', (event) => {
    const row = event.target.closest('[data-add]');
    if (!row) return;
    toggle(row.dataset.add);
    refresh();
  });

  els.rows.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('[data-add]');
    if (!row) return;
    event.preventDefault();          // Space would otherwise scroll the page
    toggle(row.dataset.add);
    refresh();
  });

  /* ── Name ── */

  els.name.addEventListener('input', () => {
    draft.name = els.name.value;
    paintSummary(els, draft);
  });

  /* ── Custom exercise ── */

  const dialog = view.querySelector('#own-dialog');
  view.querySelector('#add-own').addEventListener('click', () => {
    dialog.querySelector('#own-name').value = '';
    dialog.querySelector('#own-cue').value = '';
    dialog.showModal();
  });

  dialog.querySelector('#own-cancel').addEventListener('click', () => dialog.close());

  dialog.querySelector('#own-save').addEventListener('click', () => {
    const name = dialog.querySelector('#own-name').value.trim();
    if (!name) {
      dialog.querySelector('#own-name').focus();
      return;
    }

    const cue = dialog.querySelector('#own-cue').value.trim();
    const exercise = {
      id: `own-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      name,
      level: 'custom',
      primary: ['abs'],
      images: [],
      instructions: cue ? [cue] : [],
      // No photograph, and that is fine — it renders the same drawn card the
      // catalog's own missing movements use, so it never looks broken.
      placeholder: true,
    };

    draft.customExercises.push(exercise);
    draft.exercises.push(exercise.id);
    dialog.close();
    refresh();
    announce(`${name} added`);
  });

  /* ── Save / delete ── */

  const doSave = () => {
    if (!canSave(draft)) return;

    draft.name = (draft.name || '').trim() || 'My routine';
    // Custom exercises the user added and then removed would otherwise be
    // stored forever, and would reappear in any future edit of this routine.
    draft.customExercises = draft.customExercises.filter((e) =>
      draft.exercises.includes(e.id));

    const saved = saveCustomRoutine(draft);
    audio.unlock();
    audio.advance();
    draft = null;
    location.hash = `#/routines/${saved.id}`;
  };

  // One handler, two buttons — the aside on desktop, the sticky bar on phones.
  els.save.addEventListener('click', doSave);
  els.saveBar.addEventListener('click', doSave);

  const deleteBtn = view.querySelector('#delete');
  if (deleteBtn) {
    const confirmDialog = view.querySelector('#delete-dialog');
    deleteBtn.addEventListener('click', () => confirmDialog.showModal());
    confirmDialog.querySelector('#delete-cancel')
      .addEventListener('click', () => confirmDialog.close());
    confirmDialog.querySelector('#delete-confirm').addEventListener('click', () => {
      confirmDialog.close();
      deleteCustomRoutine(draft.id);
      draft = null;
      location.hash = '#/routines';
    });
  }

  applyFilter();
  refresh();
}

/* ── Draft ────────────────────────────────────────────────────────────── */

function loadDraft(routineId) {
  const existing = routineId ? getCustomRoutine(routineId) : null;
  if (existing) {
    return {
      ...existing,
      exercises: [...existing.exercises],
      customExercises: (existing.customExercises || []).map((e) => ({ ...e })),
    };
  }
  return { id: null, name: '', focus: 'Custom', level: 'custom', exercises: [], customExercises: [] };
}

function toggle(id) {
  const at = draft.exercises.indexOf(id);
  if (at === -1) draft.exercises.push(id);
  else draft.exercises.splice(at, 1);
}

function move(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= draft.exercises.length) return;
  const [item] = draft.exercises.splice(index, 1);
  draft.exercises.splice(target, 0, item);
}

/** A routine needs a name and at least one movement. */
function canSave(state) {
  return state.exercises.length > 0;
}

/* ── Rendering ────────────────────────────────────────────────────────── */

function paintSummary(els, state) {
  const count = state.exercises.length;

  if (count === 0) {
    els.summary.textContent = 'Add an exercise to begin.';
    els.barCount.textContent = 'Nothing picked';
  } else {
    const { low, high } = estimateRange(count);
    // Say so when the range hit its floor or ceiling, rather than showing
    // "5–5 min" for a two-exercise routine as though that were a measurement.
    const clamped = low === MIN_MINUTES || high === MAX_MINUTES ? ' (capped)' : '';
    const label = `${count} exercise${count === 1 ? '' : 's'} · ${low}–${high} min${clamped}`;
    els.summary.textContent = label;
    els.barCount.textContent = label;
  }

  const disabled = !canSave(state);
  els.save.disabled = disabled;
  els.saveBar.disabled = disabled;
}

/**
 * The chosen exercises, in order.
 *
 * Reordering is buttons rather than drag-and-drop. Dragging a list item on a
 * touch screen fights the page scroll, and this list is most often edited on a
 * phone; two unambiguous arrows always work.
 */
function renderPicked(node, state, byId, refresh) {
  if (state.exercises.length === 0) {
    node.innerHTML = '<p class="type-quiet">Nothing picked yet.</p>';
    return;
  }

  const local = new Map(state.customExercises.map((e) => [e.id, e]));

  // No thumbnails here, deliberately. This list re-renders on every add,
  // remove and reorder; images would be torn down and rebuilt each time, and
  // the flicker on a phone is far worse than the loss of the picture, which is
  // already visible in the list this row was picked from.
  node.innerHTML = `
    <ol class="picked-list">
      ${state.exercises.map((id, index) => {
        const name = (local.get(id) ?? byId.get(id))?.name ?? id;
        return `
          <li class="picked-row">
            <span class="picked-row__num">${String(index + 1).padStart(2, '0')}</span>
            <span class="picked-row__name">${esc(name)}</span>
            <span class="picked-row__actions">
              <button type="button" class="mini" data-move="${index}" data-delta="-1"
                      aria-label="Move ${esc(name)} up" ${index === 0 ? 'disabled' : ''}>↑</button>
              <button type="button" class="mini" data-move="${index}" data-delta="1"
                      aria-label="Move ${esc(name)} down"
                      ${index === state.exercises.length - 1 ? 'disabled' : ''}>↓</button>
              <button type="button" class="mini mini--remove" data-remove="${index}"
                      aria-label="Remove ${esc(name)}">✕</button>
            </span>
          </li>`;
      }).join('')}
    </ol>
  `;

  node.querySelectorAll('[data-move]').forEach((button) => {
    button.addEventListener('click', () => {
      move(Number(button.dataset.move), Number(button.dataset.delta));
      refresh();
    });
  });

  node.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      state.exercises.splice(Number(button.dataset.remove), 1);
      refresh();
    });
  });
}

function shell(state, catalog) {
  const editing = Boolean(state.id);

  return `
    <a class="back-link" href="#/routines">← All routines</a>

    <div class="section-head">
      <h2 class="type-display">${editing ? 'Edit routine' : 'Build a routine'}</h2>
      <p class="type-label" id="summary"></p>
    </div>

    <input class="field field--name" id="routine-name" type="text"
           placeholder="Name it" maxlength="40" value="${esc(state.name)}"
           aria-label="Routine name">

    <div class="build-layout">
      <section>
        <div class="build-tools">
          <div class="search">
            <input class="field" id="search" type="search" placeholder="Search exercises"
                   autocomplete="off" aria-label="Search exercises">
            <button class="search__clear" id="search-clear" type="button" hidden
                    aria-label="Clear search">✕</button>
          </div>

          <div class="chips" role="group" aria-label="Filter by level">
            ${['all', 'beginner', 'intermediate', 'expert'].map((value) => `
              <button type="button" class="chip" data-level="${value}"
                      aria-pressed="${value === 'all'}">${value}</button>
            `).join('')}
          </div>
        </div>

        <p class="type-quiet build-count" id="result-count">
          ${catalog.exercises.length} shown
        </p>

        <ul class="ex-list" id="catalog-rows">
          ${catalog.exercises.map((exercise) => `
            <li class="ex-row ex-row--pick" data-add="${esc(exercise.id)}" role="button"
                tabindex="0" aria-label="Add ${esc(exercise.name)}">
              ${exerciseImage(exercise, {
                className: 'ex-row__thumb', sizeClass: 'ex-row__thumb',
              })}
              <span>
                <span class="ex-row__name">${esc(exercise.name)}</span><br>
                <span class="ex-row__sub">${esc(exercise.level)}</span>
              </span>
              <span class="ex-row__pick" aria-hidden="true"></span>
            </li>
          `).join('')}
        </ul>

        <button class="btn-omnia btn-ghost build-more" type="button" id="show-more"
                hidden></button>

        <p class="type-quiet" id="catalog-empty" hidden>
          No exercise matches. Add your own instead.
        </p>

        <button class="btn-omnia btn-ghost" type="button" id="add-own"
                style="margin-top:1rem">+ Add your own exercise</button>
      </section>

      <aside class="build-aside">
        <div class="panel">
          <p class="type-label" style="margin-bottom:0.75rem">Your routine</p>
          <div id="picked"></div>
          <button class="btn-omnia" type="button" id="save" style="margin-top:1rem"
                  disabled>${editing ? 'Save changes' : 'Save routine'}</button>
          ${editing ? `
            <button class="btn-omnia btn-ghost" type="button" id="delete"
                    style="margin-top:0.5rem">Delete routine</button>` : ''}
        </div>
      </aside>
    </div>

    <!--
      Phones only. The catalog runs to 43 rows, so the Save button in the aside
      sits below a long scroll — on a phone that is far enough away to feel
      like the routine cannot be saved at all. This keeps the count and the
      action in reach the whole time.
    -->
    <div class="build-bar" id="build-bar">
      <span class="build-bar__count" id="bar-count">Nothing picked</span>
      <button class="btn-omnia build-bar__save" type="button" id="save-bar" disabled>
        ${editing ? 'Save' : 'Save routine'}
      </button>
    </div>

    <dialog class="sheet" id="own-dialog">
      <div class="sheet__inner" style="text-align:left">
        <h3 class="type-display" style="font-size:1.3rem">Add your own</h3>
        <p class="type-quiet" style="margin:0.35rem 0 1rem">
          No photo — it shows a placeholder card.
        </p>
        <input class="field" id="own-name" type="text" maxlength="40"
               placeholder="Exercise name" aria-label="Exercise name">
        <input class="field" id="own-cue" type="text" maxlength="120"
               placeholder="One-line cue (optional)" aria-label="Cue"
               style="margin-top:0.5rem">
        <div class="sheet__actions">
          <button class="btn-omnia btn-ghost" type="button" id="own-cancel">Cancel</button>
          <button class="btn-omnia" type="button" id="own-save">Add</button>
        </div>
      </div>
    </dialog>

    <dialog class="sheet" id="delete-dialog">
      <div class="sheet__inner">
        <h3 class="type-display" style="font-size:1.3rem">Delete this routine?</h3>
        <p class="type-quiet" style="margin:0.5rem 0 0">
          Days you already completed stay on the calendar.
        </p>
        <div class="sheet__actions">
          <button class="btn-omnia btn-ghost" type="button" id="delete-cancel">Keep</button>
          <button class="btn-omnia" type="button" id="delete-confirm">Delete</button>
        </div>
      </div>
    </dialog>
  `;
}
