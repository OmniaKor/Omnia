/**
 * importer.js — turn a YouTube link into a routine.
 *
 * What this can and cannot see, stated plainly because the whole design falls
 * out of it:
 *
 * Nothing here watches the video. A static page cannot. Two walls make sure of
 * it — a browser cannot read a YouTube page directly (no CORS headers, and the
 * markup it would get is an empty shell whose text is rendered by script), and
 * captions are closed by policy rather than by CORS: `captions.download` needs
 * OAuth from the video's *owner*, so no key of ours will ever fetch someone
 * else's transcript.
 *
 * What is reachable from a static page is the Data API's `videos.list`, which
 * is CORS-enabled and returns the title and description with a plain key. For
 * a good share of workout videos that description *is* the routine, because
 * creators write timestamped chapters into it. So that is what gets read, and
 * when it comes back with nothing useful the user is told exactly that and
 * offered the box to paste the text in themselves.
 *
 * The model then reads that text. It is not guessing at a video it cannot see,
 * and it is told to say so rather than invent a routine — see `found` in the
 * schema, which exists specifically to make "this text has no workout in it" a
 * first-class answer instead of a hallucinated one.
 */

import { esc } from './ui.js';
import { getKeys, setKeys, clearKeys, maskKey } from './keys.js';
import { saveCustomRoutine } from './store.js';

const MODEL = 'claude-opus-5';

/** Anything longer than this is not a description, it is a novel. */
const MAX_TEXT = 40_000;

let state = null;

/* ── URL parsing ──────────────────────────────────────────────────────── */

/**
 * Pull the eleven-character video id out of whatever the user pasted.
 *
 * People paste the share link, the mobile link, the one with a playlist and a
 * timestamp glued on, and sometimes just the id. All of them should work; a
 * link that "looks fine" being rejected on a technicality is the most annoying
 * possible first impression.
 */
export function parseVideoId(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  // A bare id, pasted on its own.
  if (/^[\w-]{11}$/.test(raw)) return raw;

  let url;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const path = url.pathname.replace(/\/+$/, '');

  if (host === 'youtu.be') return valid(path.slice(1));

  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    if (path === '/watch') return valid(url.searchParams.get('v'));
    // /shorts/ID, /embed/ID, /live/ID, /v/ID all put the id first after the verb.
    const m = path.match(/^\/(shorts|embed|live|v)\/([\w-]+)/);
    if (m) return valid(m[2]);
  }

  return null;
}

function valid(id) {
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/* ── The two network calls ────────────────────────────────────────────── */

/**
 * Title + description, via the one YouTube endpoint a static page can reach.
 */
export async function fetchVideoText(videoId, key) {
  const url = 'https://www.googleapis.com/youtube/v3/videos'
    + `?part=snippet,contentDetails&id=${encodeURIComponent(videoId)}`
    + `&key=${encodeURIComponent(key)}`;

  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('Could not reach YouTube. Check your connection.');
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const reason = body?.error?.message || `HTTP ${res.status}`;
    if (res.status === 403) {
      throw new Error(`YouTube refused the key — check it is a Data API v3 key and that the API is enabled. (${reason})`);
    }
    if (res.status === 400) {
      throw new Error(`YouTube rejected the request — the key looks malformed. (${reason})`);
    }
    throw new Error(`YouTube said: ${reason}`);
  }

  const item = body?.items?.[0];
  if (!item) {
    throw new Error('No such video — it may be private, deleted, or region-locked.');
  }

  return {
    title: item.snippet?.title || '',
    description: item.snippet?.description || '',
    duration: prettyDuration(item.contentDetails?.duration || ''),
  };
}

/** `PT12M30S` → `12:30`. Display only; nothing depends on it. */
function prettyDuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return '';
  const [h, min, s] = [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)];
  const mm = h ? String(min).padStart(2, '0') : String(min);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/**
 * The schema the model must answer in.
 *
 * `catalogId` is an enum of the real ids plus the empty string, so a movement
 * that is not in the catalog cannot come back as a plausible-looking id that
 * resolves to nothing. Structured outputs enforce it, which is cheaper and
 * more reliable than validating prose afterwards.
 */
function buildSchema(catalog) {
  return {
    type: 'object',
    properties: {
      found: { type: 'boolean' },
      name: { type: 'string' },
      notes: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['exercise', 'rest'] },
            name: { type: 'string' },
            seconds: { type: 'integer' },
            catalogId: { type: 'string', enum: ['', ...catalog.exercises.map((e) => e.id)] },
            cue: { type: 'string' },
          },
          required: ['kind', 'name', 'seconds', 'catalogId', 'cue'],
          additionalProperties: false,
        },
      },
    },
    required: ['found', 'name', 'notes', 'items'],
    additionalProperties: false,
  };
}

function buildPrompt(text, catalog) {
  const list = catalog.exercises.map((e) => `${e.id} = ${e.name}`).join('\n');

  return `Below is the text belonging to a YouTube workout video — its title and description, or a transcript someone pasted. Work out the routine it describes.

Read only what the text actually says. You cannot see the video. If the text does not describe a sequence of exercises — it is a vlog, a music video, a description with no exercise list — set "found" to false, leave "items" empty, and say why in "notes". Do not invent a routine to be helpful; a wrong routine is worse than none, because someone will try to do it.

For each item in order:
- "kind" is "exercise" for a movement, "rest" for a break or recovery period.
- "seconds" is how long it runs. Work it out from consecutive timestamps where the text has them, or from a stated interval like "45 seconds on, 15 off". If the text genuinely does not say, use 0 — do not guess.
- "catalogId" must be an id from the list below when the movement is clearly the same one, allowing for wording ("bicycle crunches" is Air_Bike). Use "" when there is no honest match; the movement is kept either way, just as the user's own.
- "name" is the movement as a person would say it, whether or not it matched.
- "cue" is one short line on how to do it, from the text. "" if the text does not say.

"name" at the top level is a short title for the routine — four words at most, no channel names, no "Day 3".

Catalog:
${list}

Text:
"""
${text.slice(0, MAX_TEXT)}
"""`;
}

/**
 * Ask the model, from the browser, with the user's own key.
 *
 * The direct-browser-access header is what makes this legal from a page with
 * no server. It is named the way it is on purpose: the key is in the user's
 * localStorage, so this only holds up because the key is *theirs*. It would be
 * indefensible with a key of ours shipped in the bundle.
 */
export async function analyse(text, catalog, key) {
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        output_config: { format: { type: 'json_schema', schema: buildSchema(catalog) } },
        messages: [{ role: 'user', content: buildPrompt(text, catalog) }],
      }),
    });
  } catch {
    throw new Error('Could not reach the model. Check your connection.');
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const reason = body?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error('That Anthropic key was rejected. Check it and try again.');
    if (res.status === 429) throw new Error('Rate limited by the API. Wait a moment and try again.');
    if (res.status === 400) throw new Error(`The request was rejected: ${reason}`);
    throw new Error(`The model API said: ${reason}`);
  }

  // Check why it stopped before reading content. A refusal returns HTTP 200
  // with an empty content array, so anything that indexes straight into
  // content[0] breaks here rather than reporting something useful.
  if (body?.stop_reason === 'refusal') {
    throw new Error('The model declined to answer for this video.');
  }
  if (body?.stop_reason === 'max_tokens') {
    throw new Error('The video description was too long to work through. Try pasting a shorter section.');
  }

  // Thinking is on by default on this model, so the first block is not
  // necessarily the text one.
  const block = (body?.content || []).find((b) => b.type === 'text');
  if (!block?.text) throw new Error('The model returned nothing to read.');

  let parsed;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    throw new Error('The model returned something unreadable.');
  }

  return normalise(parsed, catalog);
}

/**
 * Trust the schema for shape, not for sense.
 *
 * Structured outputs guarantee the fields exist and that `catalogId` is a real
 * id; they cannot guarantee the seconds are sane or that a "rest" is not
 * fifteen minutes long. Everything that reaches the review screen has been
 * through here.
 */
function normalise(parsed, catalog) {
  const items = (Array.isArray(parsed.items) ? parsed.items : [])
    .map((item) => {
      const catalogId = catalog.byId.has(item.catalogId) ? item.catalogId : '';
      const seconds = Number.isFinite(item.seconds)
        ? Math.max(0, Math.min(3600, Math.round(item.seconds)))
        : 0;
      return {
        kind: item.kind === 'rest' ? 'rest' : 'exercise',
        name: String(item.name || '').trim().slice(0, 60)
          || (catalogId ? catalog.byId.get(catalogId).name : 'Unnamed'),
        seconds,
        catalogId,
        cue: String(item.cue || '').trim().slice(0, 160),
      };
    })
    // A zero-second nameless row is noise the user would only have to delete.
    .filter((item) => item.name && item.name !== 'Unnamed');

  return {
    found: Boolean(parsed.found) && items.some((i) => i.kind === 'exercise'),
    name: String(parsed.name || '').trim().slice(0, 40) || 'Imported routine',
    notes: String(parsed.notes || '').trim().slice(0, 400),
    items,
  };
}

/* ── Turning the answer into a routine ────────────────────────────────── */

/**
 * The app's routine model has no per-exercise duration — intervals are 30s or
 * 45s, picked before the run — so the detected seconds cannot be played back
 * yet. They are kept on the record under `source` rather than dropped, so the
 * timed-break half of this phase has them waiting, and the review screen shows
 * them so nobody thinks they were understood and then ignored.
 */
export function toRoutine(result, videoId) {
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
      instructions: item.cue ? [item.cue] : [],
    });
    exercises.push(id);
  }

  return {
    id: null,
    name: result.name,
    focus: 'Imported',
    level: 'custom',
    exercises,
    customExercises,
    source: {
      kind: 'youtube',
      videoId,
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : '',
      importedAt: new Date().toISOString(),
      detected: result.items,
    },
  };
}

/** The interval the video actually used, snapped to the two the app offers. */
export function suggestedInterval(items) {
  const secs = items
    .filter((i) => i.kind === 'exercise' && i.seconds > 0)
    .map((i) => i.seconds)
    .sort((a, b) => a - b);

  if (secs.length === 0) return null;
  const median = secs[Math.floor(secs.length / 2)];
  return Math.abs(median - 45) < Math.abs(median - 30) ? 45 : 30;
}

/* ── Screen ───────────────────────────────────────────────────────────── */

export function renderImport(view, catalog) {
  state = { step: 'form', error: '', result: null, videoId: null, busy: false };
  paint(view, catalog);
}

function paint(view, catalog) {
  const keys = getKeys();

  view.innerHTML = `
    <a class="back-link" href="#/routines">← All routines</a>

    <div class="section-head">
      <h2 class="type-display">Import from a video</h2>
      <p class="type-label">Reads the description, not the video</p>
    </div>

    ${state.step === 'review' ? review(state.result) : form(keys)}
  `;

  if (state.step === 'review') wireReview(view, catalog);
  else wireForm(view, catalog);
}

function form(keys) {
  const hasAnthropic = Boolean(keys.anthropic);
  const hasYoutube = Boolean(keys.youtube);

  return `
    <div class="import">
      <label class="type-label import__label" for="yt-url">YouTube link</label>
      <input class="field" id="yt-url" type="url" inputmode="url"
             autocomplete="off" spellcheck="false"
             placeholder="https://www.youtube.com/watch?v=…">

      <p class="hint">
        Only the title and description can be read from a link — captions are
        locked to the video's owner. If a video's description doesn't list the
        exercises, paste the text in below instead.
      </p>

      <details class="import__fold" ${hasAnthropic ? '' : 'open'}>
        <summary>Keys ${hasAnthropic ? '· saved' : '· needed'}</summary>

        <p class="hint">
          Both keys are yours and stay on this device, in this browser. Nothing
          is sent anywhere except to Anthropic and YouTube. Anyone who can run
          script on this page can read them — that is the cost of doing this
          without a server. Clear them when you're done on a shared machine.
        </p>

        <label class="type-label import__label" for="k-anthropic">
          Anthropic key ${hasAnthropic ? `· ${esc(maskKey(keys.anthropic))}` : '· required'}
        </label>
        <input class="field" id="k-anthropic" type="password" autocomplete="off"
               spellcheck="false" placeholder="sk-ant-…">

        <label class="type-label import__label" for="k-youtube">
          YouTube Data API key ${hasYoutube ? `· ${esc(maskKey(keys.youtube))}` : '· optional'}
        </label>
        <input class="field" id="k-youtube" type="password" autocomplete="off"
               spellcheck="false" placeholder="AIza…">
        <p class="hint">Without this, use the paste box — the link can't be read.</p>

        <div class="import__row">
          <button class="btn-omnia btn-ghost" type="button" id="k-save">Save keys</button>
          <button class="btn-omnia btn-ghost" type="button" id="k-clear">Clear</button>
        </div>
      </details>

      <details class="import__fold">
        <summary>Paste the text instead</summary>
        <p class="hint">
          The description, or the transcript from YouTube's “Show transcript”.
          Works with no YouTube key.
        </p>
        <textarea class="field import__text" id="yt-text" rows="6"
                  placeholder="0:00 Warm up&#10;0:30 Crunches&#10;1:00 Plank…"></textarea>
      </details>

      <button class="btn-omnia import__go" type="button" id="go"
              ${state.busy ? 'disabled' : ''}>
        ${state.busy ? 'Working…' : 'Read the video'}
      </button>

      <p class="import__status" id="status" role="status">${esc(state.error)}</p>
    </div>
  `;
}

function review(result) {
  if (!result.found) {
    return `
      <div class="import">
        <p class="import__miss">No routine in that text.</p>
        <p class="hint">${esc(result.notes || 'The description does not list any exercises.')}</p>
        <p class="hint">
          Plenty of videos keep the routine on screen rather than in the
          description. Open the video, use “Show transcript”, and paste it into
          the box.
        </p>
        <button class="btn-omnia" type="button" id="again">Try another</button>
      </div>
    `;
  }

  const exercises = result.items.filter((i) => i.kind === 'exercise');
  const rests = result.items.filter((i) => i.kind === 'rest');
  const interval = suggestedInterval(result.items);
  const matched = exercises.filter((i) => i.catalogId).length;

  return `
    <div class="import">
      <p class="import__found">
        ${exercises.length} exercises${rests.length ? `, ${rests.length} rests` : ''}
        · ${matched} matched the catalog
      </p>

      <ol class="import__list">
        ${result.items.map(reviewRow).join('')}
      </ol>

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
      <span class="import__name">Rest</span>
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
  const el = (id) => view.querySelector(`#${id}`);
  const status = el('status');

  el('k-save').addEventListener('click', () => {
    const patch = {};
    const a = el('k-anthropic').value.trim();
    const y = el('k-youtube').value.trim();
    if (a) patch.anthropic = a;
    if (y) patch.youtube = y;
    setKeys(patch);
    el('k-anthropic').value = '';
    el('k-youtube').value = '';
    state.error = 'Keys saved.';
    paint(view, catalog);
  });

  el('k-clear').addEventListener('click', () => {
    clearKeys();
    state.error = 'Keys cleared.';
    paint(view, catalog);
  });

  el('go').addEventListener('click', () => run(view, catalog));

  el('yt-url').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') run(view, catalog);
  });

  if (status && state.error) status.textContent = state.error;
}

async function run(view, catalog) {
  const keys = getKeys();
  const urlField = view.querySelector('#yt-url');
  const pasted = view.querySelector('#yt-text').value.trim();
  const status = view.querySelector('#status');

  const say = (message) => { if (status) status.textContent = message; };

  if (!keys.anthropic) {
    say('Add your Anthropic key first — open Keys above.');
    return;
  }

  const typed = urlField.value.trim();
  const videoId = parseVideoId(typed);

  if (!videoId && !pasted) {
    // Someone who pasted something and got it wrong needs to know it was
    // rejected, not be told to paste — which is what they just did.
    say(typed
      ? "That doesn't look like a YouTube link."
      : 'Paste a YouTube link, or paste the text yourself.');
    return;
  }

  state.busy = true;
  state.error = '';
  view.querySelector('#go').disabled = true;
  view.querySelector('#go').textContent = 'Working…';

  try {
    let text = pasted;
    let title = '';

    if (!text) {
      if (!keys.youtube) {
        throw new Error('A YouTube Data API key is needed to read a link. Add one, or paste the text instead.');
      }
      say('Reading the video…');
      const video = await fetchVideoText(videoId, keys.youtube);
      title = video.title;
      text = `Title: ${video.title}\nLength: ${video.duration}\n\n${video.description}`;

      if (video.description.trim().length < 40) {
        throw new Error('That video has almost no description to read. Use “Show transcript” on YouTube and paste it into the box.');
      }
    }

    say('Working out the routine…');
    const result = await analyse(text, catalog, keys.anthropic);

    if (result.name === 'Imported routine' && title) {
      result.name = title.slice(0, 40);
    }

    state.result = result;
    state.videoId = videoId;
    state.step = 'review';
    state.busy = false;
    paint(view, catalog);
  } catch (error) {
    state.busy = false;
    state.error = error.message || 'Something went wrong.';
    paint(view, catalog);
  }
}

function wireReview(view, catalog) {
  const again = view.querySelector('#again');
  again?.addEventListener('click', () => {
    state = { step: 'form', error: '', result: null, videoId: null, busy: false };
    paint(view, catalog);
  });

  const save = view.querySelector('#save');
  save?.addEventListener('click', async () => {
    const useInterval = view.querySelector('#use-interval')?.checked;
    if (useInterval) {
      const seconds = suggestedInterval(state.result.items);
      // Imported late so a routine that is never saved does not touch prefs.
      const { setPrefs } = await import('./store.js');
      if (seconds) setPrefs({ intervalSeconds: seconds });
    }

    const record = saveCustomRoutine(toRoutine(state.result, state.videoId));
    // The model gets things wrong, and the screen that fixes them exists.
    location.hash = `#/build/${record.id}`;
  });
}
