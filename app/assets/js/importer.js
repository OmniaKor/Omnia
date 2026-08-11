/**
 * importer.js — turn a YouTube description into a routine.
 *
 * No API, no key, no network. Workout creators already write the routine out
 * in the description as a timestamped list, and that list is regular enough to
 * read directly:
 *
 *     Workout // 30s work, no rest
 *     00:09 - Full Extension Crunches
 *     00:39 - Eagle Crunches
 *     01:09 - Scissor Kicks
 *
 * The exercises are the lines; the intervals are the gaps between the
 * timestamps. That is the whole trick, and it is why this ended up as a
 * hundred lines of parsing rather than a model call — it runs offline, costs
 * nothing, and cannot invent an exercise that was never in the text.
 *
 * The one thing it cannot do is fetch. A browser cannot read a YouTube page
 * (no CORS headers, and the markup is an empty shell whose text is rendered by
 * script), and captions are shut by policy — `captions.download` needs OAuth
 * from the video's owner. So the description is pasted, and the screen says
 * so rather than pretending a link would work.
 */

import { esc } from './ui.js';
import { saveCustomRoutine, setPrefs } from './store.js';

/** Nothing sensible is longer than this; the rest is comments and links. */
const MAX_TEXT = 20_000;

/**
 * `00:09 - Name`, and the dozen other ways people write the same line.
 *
 * Hours are optional, the separator is optional, and the bracket forms show up
 * in descriptions copied out of other sites. Being generous here is the
 * difference between working on most videos and working on the author's own.
 */
const LINE = /^\s*[[(]?\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[\])]?\s*(?:[-–—•·|:>»]+\s*)?(.*)$/;

/** Lines that are timestamped but are not part of the workout. */
const NOT_EXERCISE = /^(intro|outro|start|end|subscribe|thanks|thank you|follow|instagram|tiktok|twitter|discord|patreon|merch|shop|sponsor|ad\b|disclaimer|music|credits|my socials|socials|links?)\b/i;

/** A pause rather than a movement. */
const IS_REST = /^(rest|break|recovery|water|pause|breathe)\b/i;

/**
 * Words too common to identify a movement on their own.
 *
 * Without this, "Low Plank Hold" matches "Hollow Body Hold" on the strength of
 * the word "hold", which is not a match, it is a coincidence.
 */
const GENERIC = new Set([
  'hold', 'the', 'on', 'of', 'to', 'into', 'with', 'and', 'a', 'in', 'floor',
  'up', 'down', 'low', 'high', 'slow', 'fast', 'single', 'double', 'alternate',
  'alternating', 'seated', 'standing', 'lying', 'side', 'cross', 'reverse',
  'bent', 'full', 'half', 'left', 'right', 'each', 'per', 'sec', 'secs',
  'second', 'seconds', 'x', 'r', 'l',
]);

let state = null;

/* ── Parsing ──────────────────────────────────────────────────────────── */

/** `01:09` → 69. Hours optional. */
function toSeconds(h, m, s) {
  return (Number(h || 0) * 3600) + (Number(m) * 60) + Number(s);
}

/**
 * Pull the work/rest interval out of a header like `30s work, no rest`.
 *
 * When a description states this, it beats the gaps between timestamps —
 * a 45-on-15-off video has 60-second gaps, and reading those as the exercise
 * length would put every interval a quarter too long.
 */
export function parseHeader(text) {
  const head = text.slice(0, 400);
  const work = /(\d{1,3})\s*(?:s\b|sec|secs|seconds?)\s*(?:of\s+)?(?:work|on\b|work\b)/i.exec(head)
    || /work\s*[:\-]?\s*(\d{1,3})\s*(?:s\b|sec|secs|seconds?)/i.exec(head);

  let rest = null;
  if (/\bno\s+rest\b/i.test(head)) {
    rest = 0;
  } else {
    // Labelled form first, deliberately. `work: 30s rest: 10s` also contains
    // the string "30s rest", so testing "N seconds rest" first would read the
    // work interval as the rest one.
    const m = /rest\s*[:\-]?\s*(\d{1,3})\s*(?:s\b|sec|secs|seconds?)/i.exec(head)
      || /(\d{1,3})\s*(?:s\b|sec|secs|seconds?)\s*(?:of\s+)?(?:rest|off\b)/i.exec(head);
    if (m) rest = Number(m[1]);
  }

  // `45/15` — only trusted alongside a nearby "work" or "rest" word, because a
  // bare pair of numbers is far more often a date or a set count.
  if (!work && /\b(work|rest|on|off)\b/i.test(head)) {
    const pair = /\b(\d{1,3})\s*\/\s*(\d{1,3})\b/.exec(head);
    if (pair) {
      return { work: Number(pair[1]), rest: Number(pair[2]) };
    }
  }

  return { work: work ? Number(work[1]) : null, rest };
}

/** Tidy a name pulled off the end of a timestamp line. */
function cleanName(raw) {
  return String(raw || '')
    .replace(/\s*[([]\s*\d+\s*(?:s|sec|secs|seconds?|reps?)\s*[)\]]\s*$/i, '')
    .replace(/[\s.,;:–—-]+$/, '')
    .replace(/^[\s.,;:–—-]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * Read a description into an ordered list of exercises and rests.
 *
 * Exported for the tests, which is most of why the parsing is separate from
 * the screen — every awkward description shape is a unit test rather than
 * something to be retried by hand in a browser.
 */
export function parseDescription(text, catalog) {
  const source = String(text ?? '').slice(0, MAX_TEXT);
  const header = parseHeader(source);

  const rows = [];
  for (const line of source.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (!m) continue;

    const name = cleanName(m[4]);
    if (!name || NOT_EXERCISE.test(name)) continue;

    rows.push({ at: toSeconds(m[1], m[2], m[3]), name });
  }

  // Descriptions are written top to bottom, but a stray timestamp in a comment
  // can land out of order and would otherwise produce a negative interval.
  rows.sort((a, b) => a.at - b.at);

  const items = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const next = rows[i + 1];
    const gap = next ? next.at - row.at : 0;

    items.push({
      kind: IS_REST.test(row.name) ? 'rest' : 'exercise',
      name: row.name,
      at: row.at,
      seconds: gap > 0 ? gap : 0,
      catalogId: '',
      cue: '',
    });
  }

  applyDurations(items, header);
  for (const item of items) {
    if (item.kind === 'exercise') item.catalogId = matchExercise(item.name, catalog);
  }

  return {
    found: items.some((i) => i.kind === 'exercise'),
    header,
    items,
    notes: notesFor(items, header),
  };
}

/**
 * Decide how long each item ran.
 *
 * A stated header wins: it describes the work itself, whereas the gap between
 * two timestamps is work *plus* whatever rest followed it. Gaps are the
 * fallback, and the last row has no gap at all, so it inherits the median.
 */
function applyDurations(items, header) {
  const exercises = items.filter((i) => i.kind === 'exercise');
  if (exercises.length === 0) return;

  if (header.work) {
    for (const item of items) {
      if (item.kind === 'exercise') item.seconds = header.work;
      else if (header.rest) item.seconds = header.rest;
    }
    return;
  }

  const gaps = items.map((i) => i.seconds).filter((s) => s > 0).sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;

  const last = items[items.length - 1];
  if (last && last.seconds === 0) last.seconds = median;
}

/**
 * Naming is the user's, deliberately.
 *
 * The first prose line of a description was tried as a title and it is almost
 * never one — it is "Workout", or the channel's tagline, or a header that only
 * makes sense next to the video. A guess that lands in the name field looks
 * decided, so it survives to the routine list; an empty field asks.
 */
const FALLBACK_NAME = 'Imported routine';

function notesFor(items, header) {
  const bits = [];
  if (header.work) bits.push(`${header.work}s work stated in the description`);
  if (header.rest === 0) bits.push('no rest');
  else if (header.rest) bits.push(`${header.rest}s rest`);
  if (!header.work && items.length) bits.push('intervals read from the gaps between timestamps');
  return bits.join(' · ');
}

/* ── Matching against the catalog ─────────────────────────────────────── */

function tokenise(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    // Crude singular: "kicks" → "kick", "crunches" → "crunche" → close enough
    // for set membership, because both sides go through the same mangling.
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

/**
 * Find the catalog entry a written name refers to, or `''`.
 *
 * Scored on how much of the *catalog* name is present, so "Slow Flutter Kicks"
 * still finds "Flutter Kicks" — the extra adjective in the description does not
 * count against it. At least one matched word has to be distinctive, which is
 * what stops "Low Plank Hold" from landing on "Hollow Body Hold".
 */
export function matchExercise(name, catalog) {
  const words = new Set(tokenise(name));
  if (words.size === 0) return '';

  let best = null;

  for (const exercise of catalog.exercises) {
    const target = tokenise(exercise.name);
    if (target.length === 0) continue;

    const hit = target.filter((t) => words.has(t));
    if (hit.length === 0) continue;
    if (!hit.some((t) => !GENERIC.has(t))) continue;

    const coverage = hit.length / target.length;
    if (coverage < 0.5) continue;

    // More of the catalog name covered wins; on a tie the more specific entry
    // does, so "Oblique Crunches" beats plain "Crunches" for an oblique crunch.
    const score = [coverage, hit.length, -target.length];
    if (!best || bigger(score, best.score)) best = { id: exercise.id, score };
  }

  return best ? best.id : '';
}

function bigger(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/* ── Turning the answer into a routine ────────────────────────────────── */

/**
 * The player runs one interval for the whole routine, so the per-exercise
 * seconds cannot be played back yet. They are kept on the record rather than
 * dropped, so the timed-break half of this phase has them waiting and the
 * review screen can show that they were understood.
 */
export function toRoutine(result, url, name) {
  const exercises = [];
  const customExercises = [];
  let n = 0;

  for (const item of result.items) {
    if (item.kind !== 'exercise') continue;

    if (item.catalogId) {
      exercises.push(item.catalogId);
      continue;
    }

    const id = `own-${Date.now().toString(36)}${(n += 1).toString(36)}`;
    customExercises.push({
      id,
      name: item.name,
      placeholder: true,
      images: [],
      instructions: [],
    });
    exercises.push(id);
  }

  return {
    id: null,
    // Blank is only reachable by saving the field untouched; the routine still
    // has to be called something in storage.
    name: String(name ?? '').trim().slice(0, 40) || FALLBACK_NAME,
    focus: 'Imported',
    level: 'custom',
    exercises,
    customExercises,
    source: {
      kind: 'youtube',
      url: url || '',
      importedAt: new Date().toISOString(),
      header: result.header,
      detected: result.items.map(({ kind, name, seconds, at }) => ({ kind, name, seconds, at })),
    },
  };
}

/** The interval the video used, snapped to the two the app offers. */
export function suggestedInterval(items) {
  const secs = items
    .filter((i) => i.kind === 'exercise' && i.seconds > 0)
    .map((i) => i.seconds)
    .sort((a, b) => a - b);

  if (secs.length === 0) return null;
  const median = secs[Math.floor(secs.length / 2)];
  return Math.abs(median - 45) < Math.abs(median - 30) ? 45 : 30;
}

/** Any YouTube link in the pasted text, kept so the routine points home. */
export function findUrl(text) {
  const m = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?[^\s]*|youtu\.be\/[\w-]{11})/i
    .exec(String(text ?? ''));
  return m ? m[0] : '';
}

/* ── Screen ───────────────────────────────────────────────────────────── */

export function renderImport(view, catalog) {
  state = { step: 'form', error: '', result: null, url: '', text: '', name: '' };
  paint(view, catalog);
}

function paint(view, catalog) {
  view.innerHTML = `
    <a class="back-link" href="#/routines">← All routines</a>

    <div class="section-head">
      <h2 class="type-display">Import from a video</h2>
      <p class="type-label">Reads the description you paste</p>
    </div>

    ${state.step === 'review' ? review(state.result) : form()}
  `;

  if (state.step === 'review') wireReview(view, catalog);
  else wireForm(view, catalog);
}

function form() {
  return `
    <div class="import">
      <p class="hint">
        Open the video, expand the description, copy the timestamped list, and
        paste it here. Nothing can read the video itself — YouTube gives a page
        out to a browser with none of the text in it, and captions are locked to
        whoever owns the video.
      </p>

      <textarea class="field import__text" id="yt-text" rows="10"
                spellcheck="false"
                placeholder="Workout // 30s work, no rest&#10;00:09 - Full Extension Crunches&#10;00:39 - Eagle Crunches&#10;01:09 - Scissor Kicks">${esc(state.text)}</textarea>

      <button class="btn-omnia import__go" type="button" id="go">Read the description</button>

      <p class="import__status" id="status" role="status">${esc(state.error)}</p>
    </div>
  `;
}

function review(result) {
  if (!result.found) {
    return `
      <div class="import">
        <p class="import__miss">No timestamped exercises in that text.</p>
        <p class="hint">
          The lines need a time and a name — <code>00:39 - Eagle Crunches</code>.
          A link on its own has nothing to read; some videos keep the routine on
          screen and never write it down, and those cannot be imported.
        </p>
        <button class="btn-omnia" type="button" id="again">Try again</button>
      </div>
    `;
  }

  const exercises = result.items.filter((i) => i.kind === 'exercise');
  const rests = result.items.filter((i) => i.kind === 'rest');
  const matched = exercises.filter((i) => i.catalogId).length;
  const interval = suggestedInterval(result.items);

  return `
    <div class="import">
      <p class="import__found">
        ${exercises.length} exercises${rests.length ? `, ${rests.length} rests` : ''}
        · ${matched} matched the catalog
      </p>

      <input class="field field--name" id="import-name" type="text" maxlength="40"
             placeholder="Name it" value="${esc(state.name)}"
             aria-label="Routine name">

      <ol class="import__list">${result.items.map(reviewRow).join('')}</ol>

      ${result.notes ? `<p class="hint">${esc(result.notes)}</p>` : ''}

      <p class="hint">
        Timings are shown as the video ran them. Omnia runs one interval for the
        whole routine, so they are saved with it but not played back yet — you
        pick 30s or 45s before you start, as usual.
      </p>

      ${interval ? `
        <label class="opt-row">
          <input type="checkbox" id="use-interval" class="toggle toggle-sm" checked>
          <span>Set my interval to ${interval}s to match</span>
        </label>` : ''}

      <div class="import__row">
        <button class="btn-omnia" type="button" id="save">Save and edit</button>
        <button class="btn-omnia btn-ghost" type="button" id="again">Start over</button>
      </div>
    </div>
  `;
}

function reviewRow(item) {
  const time = item.seconds > 0 ? `${item.seconds}s` : '—';
  if (item.kind === 'rest') {
    return `<li class="import__item import__item--rest">
      <span class="import__name">${esc(item.name)}</span>
      <span class="import__time">${time}</span>
    </li>`;
  }
  return `<li class="import__item">
    <span class="import__name">
      ${esc(item.name)}
      ${item.catalogId ? '' : '<span class="import__own">yours</span>'}
    </span>
    <span class="import__time">${time}</span>
  </li>`;
}

/* ── Wiring ───────────────────────────────────────────────────────────── */

function wireForm(view, catalog) {
  const go = view.querySelector('#go');
  const box = view.querySelector('#yt-text');

  go.addEventListener('click', () => {
    const text = box.value.trim();

    if (!text) {
      view.querySelector('#status').textContent = 'Paste the description first.';
      return;
    }

    const result = parseDescription(text, catalog);

    if (!result.found && findUrl(text) && text.length < 200) {
      // The most common mistake, and worth naming rather than answering with
      // the generic "nothing found".
      state.text = text;
      state.error = 'That is just the link — paste the description text as well.';
      paint(view, catalog);
      return;
    }

    state.text = text;
    state.url = findUrl(text);
    state.result = result;
    state.step = 'review';
    paint(view, catalog);
  });
}

function wireReview(view, catalog) {
  // Held on the state, not read only at save time, so "Start over" and a
  // second read do not throw away a name already typed.
  const nameField = view.querySelector('#import-name');
  nameField?.addEventListener('input', () => { state.name = nameField.value; });

  view.querySelector('#again')?.addEventListener('click', () => {
    state.step = 'form';
    state.error = '';
    state.result = null;
    paint(view, catalog);
  });

  view.querySelector('#save')?.addEventListener('click', () => {
    if (view.querySelector('#use-interval')?.checked) {
      const seconds = suggestedInterval(state.result.items);
      if (seconds) setPrefs({ intervalSeconds: seconds });
    }

    const record = saveCustomRoutine(toRoutine(state.result, state.url, state.name));
    // The parser gets things wrong, and the screen that fixes them exists.
    location.hash = `#/build/${record.id}`;
  });
}
