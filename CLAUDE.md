# CLAUDE.md — Omnia

Context for future sessions. Read this before changing anything.

---

## What Omnia is

A **10-minute daily core workout app for high schoolers.** Pick an ab routine, follow
a timer through it, keep the calendar green. Built by Justin Li and Owen Zhang,
Track c/o 2026.

Two features, and only two. Both live in sidebars:

1. **Routines** — browse → preview → run the timer → mark complete
2. **Calendar** — a pastel red/yellow/green square per day

---

## The constraint that decides most arguments

**GitHub Pages is static hosting. Python does not run at request time.**

If a change needs a server to answer a request, it cannot ship on Pages. So:

- **Ships to the browser:** HTML, CSS, JS, Tailwind, DaisyUI
- **Runs at build time only:** `tools/build_catalog.py`. Its output is committed;
  nobody needs Python to deploy.
- **Later, optional:** Flask (Phase 11, self-host only), Supabase (Phase 12, called
  from the browser — so Pages stays sufficient)

**Do not add a runtime Python dependency to `app/`.** It will 404 on Pages.

## Buildless on purpose

Tailwind 4 and DaisyUI 5 load from jsDelivr. There is **no `npm install`, no build
step, no CI.** `git push` deploys.

This is a deliberate trade. The Tailwind browser build compiles CSS at page load,
which is slower than a compiled stylesheet and is not what Tailwind recommends for
production. It is still the right call here: two high schoolers maintain this, and a
toolchain that breaks is a toolchain that stops the project. If load time ever
becomes the real complaint, compile Tailwind in a GitHub Action and commit the CSS —
but do not do it just because it is more correct.

---

## Layout

```
Omnia/
├── CLAUDE.md, ROADMAP.md, README.md
├── requirements.txt              # build-time only (Pillow)
├── .github/workflows/pages.yml   # uploads app/ to Pages; compiles nothing
├── art/
│   └── streak-source.png         # rank artwork source. NOT served — see below
├── tools/
│   ├── build_catalog.py          # regenerates the exercise catalog
│   └── slice_streak_icons.py     # regenerates the rank icons
├── serve.py                      # dev server. NOT a backend — see below
├── tests/                        # open in a browser over http; not published
│   ├── timer.test.html           # the interval rules
│   ├── store.test.html           # the calendar colour rules
│   ├── streak.test.html          # the consistency ladder
│   ├── audio.test.html           # the audio contract, plus buttons for ears
│   └── builder.test.html         # drives the real builder against a fixture
└── app/                          # ← what GitHub Pages serves
    ├── .nojekyll                 # belt and braces; see Gotchas
    ├── index.html                # the whole app — one page, hash-routed
    ├── manifest.webmanifest
    ├── sw.js                     # service worker (offline)
    └── assets/
        ├── css/omnia.css         # theme + everything Tailwind can't express
        ├── data/
        │   ├── exercises.json    # GENERATED — do not hand-edit
        │   └── routines.json     # hand-written; routine → exercise ids
        ├── img/                  # hero + placeholder art (SVG)
        │   └── streak/           # s a b c d f .webp — GENERATED
        └── js/
            ├── store.js          # localStorage; the only thing that persists
            ├── streak.js         # sessions → a rank. Pure: no DOM, no clock.
            ├── rank.js           # the masthead consistency badge
            ├── catalog.js        # loads + indexes the JSON, resolves routines
            ├── routines.js       # list + preview
            ├── builder.js        # build/edit your own routine
            ├── player.js         # the timer screen
            ├── timer.js          # the interval engine
            ├── audio.js          # every sound, plus haptics
            ├── calendar.js       # month grid
            ├── ui.js             # shared helpers
            └── app.js            # boot + hash router
```

---

## Exercise data — where it comes from

Source: [`yuhonas/free-exercise-db`](https://github.com/yuhonas/free-exercise-db),
Unlicense (public domain). This is the same catalog
[Body-Shop](https://github.com/justins-li/Body-Shop) uses — Omnia takes it from the
same upstream at the same commit rather than depending on Body-Shop directly.

**Pinned commit:** `b0eed061e1c832b3ed815fbaa4b45b3cdc14df49`

- Data: `https://raw.githubusercontent.com/yuhonas/free-exercise-db/<commit>/dist/exercises.json`
- Images: `https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@<commit>/exercises/<id>/<n>.jpg`

The pin matters. Unpinned, jsDelivr follows the default branch and an upstream rename
silently breaks images in production. Change the commit in **one** place —
`PINNED_COMMIT` in `tools/build_catalog.py` — then re-run it.

873 exercises upstream; 93 are `primary: ["abs"]`; 45 of those are `body only` /
`none`. Omnia curates that down further — see below.

### Curation rules

1. `primary` includes `abs`, **or** it is a floor movement that earns its place in a
   core routine (Mountain Climbers is tagged `quads`, Superman `back`, Flutter Kicks
   `glutes` — all three belong).
2. `equipment` is `body only` or `none`.
3. **Reject anything needing furniture**, even when tagged "body only": the database
   marks decline-bench, exercise-ball, flat-bench and pull-up-bar movements that way.
   A bedroom floor is the only assumed equipment. Filtered by id in
   `EXCLUDED_IDS` — the tags cannot express this, so the list is explicit.

### Placeholders

Some movements are worth having and simply are not in the database — Hollow Body
Hold, Bird Dog, V-Up, Windshield Wipers, Plank Shoulder Taps. Per the product call,
these ship anyway with `"placeholder": true` and render drawn `[placeholder]` art
instead of a photo. They are defined in `PLACEHOLDER_EXERCISES` in the build script.

Replacing them with real images is Phase 7.

---

## Rules the UI must keep

These came from the product owner directly. Changing one is a product decision.

**Timer**
- Intervals are **30s or 45s**, chosen *before* the routine starts, never mid-run
- The **last 5 seconds are red**
- **Continuous ON** → a **3s transition** between exercises, then the next one
  starts on its own. It used to mean no gap at all; that put people on the floor
  in the wrong position, with the clock already counting a movement they had not
  got into yet. Three seconds is enough to move and not enough to rest.
- **Continuous OFF** → stop at 0, wait for a **"Ready?"** button
- **Both gaps show the exercise that is coming**, not the one just finished —
  big figure, and the small "Next" chip is hidden while they do. Two previews on
  screen at once is the confusing case: the picture would be the next movement
  and the chip the one after it, both captioned as what comes next.
- The figure **does not reload at the handover**. It is already showing the
  right exercise, so `paint()` leaves it alone — see `shownFigureIndex`.
- **Break is unavailable during the 3s transition.** There is no running
  interval to stash and resume, which is all a break does.
- **Break** is **15s**, uses the *same* interface, and afterwards the exercise timer
  **resumes where it left off** — it does not restart the interval
- **Quit** always confirms first. Only on confirm does it stop and return to preview.
- **No sound yet.** Phase 6. Do not add it early.

**Completion**
- Recorded **once per routine**, never per exercise

**Consistency rank** (the masthead badge)
- Six ranks, drawn as planets: **S A B C D F**. The letters are *in the
  artwork*; the app never prints one as text.
- Climbing is earned by streak, falling is measured by absence. A finish
  **today or yesterday** keeps the streak alive — today being unfinished must
  not demote anyone at 9am.
- Only `completed` counts, folded by `localDate` — **the same fold the calendar
  does.** A second streak counter that can disagree with the squares is a bug
  generator; `calendar.js` reads `streak.js` for exactly this reason.
- Day gaps use `Math.round`, never truncation. A local day is 23 or 25 hours
  across a DST change, and truncating fuses two days into one every spring.
- **No history yet shows a desaturated B.** The first finished routine snaps it
  to full colour; without that, the first workout moves nothing in the masthead.
- Sad, never punishing. Nothing burns down, no calendar square is ever
  repainted, and it never nags off-screen.
- It can be hidden, and hiding leaves the streak numbers intact. The way back
  is on the calendar screen.

**Duration estimate**
- Always shown as a range, **floored at 5 min, capped at 15 min**. Two reasons, both
  real: routines have different exercise counts, and the user picks 30s or 45s.

**Calendar colours** — pastel, and green wins ties
- 🟥 red — no ab workout that day
- 🟨 yellow — quit, and nothing finished in full that day
- 🟩 green — at least one routine finished in full. **Quit-then-finish is green.**

**Sound** (Phase 6)
- Every cue is **synthesised**, never a file. Keeps the repo text-only and works
  offline. Do not add an mp3.
- Nothing in `audio.js` may throw into the timer — every path degrades to silence
- The context is created on a **user gesture** only. iOS Safari will not start
  audio anywhere else, and a hashchange is outside the gesture window.
- Cues are gated on the second *changing* — `paint()` runs every frame
- Phase cues are **exclusive**: one transition, one sound
- Haptics are suppressed when muted

**Custom routines** (Phase 7)
- Stored unresolved: `exercises` is a list of ids, `customExercises` holds the
  user's own movements **scoped to that routine**
- `catalog.js` resolves routine-local exercises *before* the shared catalog
- Deleting a routine leaves its sessions alone — a deleted routine must not
  repaint the calendar and erase days the user actually trained
- The builder filters by toggling `hidden`, never by re-rendering. Re-rendering
  rebuilds every `<img>`, which flickers on each keystroke.

**Chrome**
- Header: `Omnia` wordmark + hero image, with the tagline and version above it
- Footer: `created by: Justin Li and Owen Zhang Track c/o 2026.`
- **Minimal text in the margins.** Explanations stay short. This was asked for
  explicitly — resist the urge to add helpful paragraphs.

---

## Versioning — bump it every time

The masthead carries a version next to `Daily core · 10 minutes`, at the same
size, on both phone and desktop. It reads `v7.07` today.

**It lives in exactly one place: `id="version"` in `app/index.html`.** Do not
add a second copy anywhere — a version printed in two places is a version that
disagrees with itself.

```
v<phase>.<change>      →   v7.07
   │        └── two digits, zero-padded, +1 per change
   └── the last phase finished (ROADMAP.md), NOT the one in progress
```

**Every prompt that changes something shippable increments the minor by one.**
7.07 → 7.08 → 7.09 → 7.10. Do this in the same edit as the change itself, not
as a follow-up — a bump that gets forgotten makes the number worse than useless,
because it now lies.

- **Reset the minor to `01` when a phase lands**, and raise the major with it.
  Finishing Phase 8 means the next version is `v8.01`, not `v8.08`.
- It rolls straight past `.99` into three digits if it has to. The count is
  the point; the padding is only there so early numbers sort and read evenly.
- **Not semver.** Nothing here communicates compatibility — it is a "how much
  has happened" counter that the two of us can point at.
- **Do not bump for changes nobody can see**: a prompt that only edits
  `ROADMAP.md`, `CLAUDE.md`, or a comment ships no behaviour, so it ships no
  version. The number tracks the app, not the conversation.
- **Do not tie it to `CACHE` in `sw.js`.** That constant exists to drop stale
  precached assets, and bumping it every prompt would throw away every cached
  exercise photograph along with it. Same-origin requests are network-first, so
  a deploy shows the new version immediately without touching the cache.

---

## Design language

Ported from Body-Shop, which itself follows
[Dmitry Glukhovsky's site](https://www.cssdesignawards.com/sites/dmitry-glukhovsky/49616/):
a light serif wordmark, warm cream ground, brick accent, generous space, hairline
rules, small uppercase labels with wide tracking.

| Token | Light | Dark |
|---|---|---|
| `--color-base-100` | `#f4ece0` | `#141922` |
| `--color-base-200` | `#faf4eb` | `#0d1014` |
| `--color-base-300` | `#e4d9c9` | `#242b36` |
| `--color-base-content` | `#2a1c0e` | `#ede6db` |
| `--color-primary` | `#a34a38` | `#a34a38` |
| `--color-secondary` | `#7d6d5b` | `#7e8ca0` |
| `--color-accent` | `#8f3a29` | `#d97a63` |

Type: **Noto Serif 300** for the wordmark and display, **IBM Plex Sans** for body,
**IBM Plex Mono** for the timer and labels. Tabular figures on the clock — otherwise
the digits jitter every tick.

Calendar pastels are their own tokens (`--pastel-*`) and are intentionally *not* the
DaisyUI semantic colours; they must stay soft against cream.

---

## Data model (localStorage)

One key: `omnia.v1`.

```jsonc
{
  "version": 1,
  "prefs": {
    "intervalSeconds": 30, "continuous": false, "theme": "auto",
    "soundMuted": false, "musicEnabled": true
  },
  "customRoutines": [
    {
      "id": "custom-l8k2p",
      "name": "Morning core",
      "custom": true,
      "exercises": ["Crunches", "Plank", "own-m3x1"],   // catalog ids + own ids
      "customExercises": [                              // scoped to THIS routine
        { "id": "own-m3x1", "name": "Dead Hang Tuck", "placeholder": true,
          "images": [], "instructions": ["Knees to chest, slow."] }
      ],
      "createdAt": "2026-08-06T09:12:00.000Z",
      "updatedAt": "2026-08-06T09:20:00.000Z"
    }
  ],
  "sessions": [
    {
      "id": "s_1a2b3c",
      "routineId": "routine-1",
      "status": "completed",        // "completed" | "quit"
      "intervalSeconds": 30,
      "continuous": false,
      "localDate": "2026-08-05",    // the USER'S day
      "startedAt": "2026-08-05T22:41:00.000Z",
      "finishedAt": "2026-08-05T22:51:12.000Z",
      "exercisesDone": 12
    }
  ]
}
```

**`localDate` is stored, not derived.** A workout finished at 11pm belongs to that
day even after UTC rolls over. Deriving it from `finishedAt` paints the wrong
calendar square for anyone west of London — this is a bug waiting to be reintroduced,
so don't.

`sessions` is append-only. The calendar folds it per day; it never rewrites history.

Phase 12 syncs this shape to Supabase with the same field names, so the migration is a
copy rather than a translation.

---

## Common tasks

**Run locally** — use `serve.py`, not `python -m http.server`.
```bash
python serve.py                        # → http://localhost:8000
```
Both serve files, but `serve.py` sends `Cache-Control: no-store`. Plain
`http.server` sends `Last-Modified` and no cache headers, so the browser applies
*heuristic* freshness — often tens of minutes — and serves your old JS back to
you after an edit. The service worker is network-first and does not save you:
the stale copy comes from the HTTP cache before the worker ever sees it. This
looks exactly like a bug in the code you just wrote.

**Regenerate the exercise catalog** (only after editing the curation lists or the pin):
```bash
pip install -r requirements.txt
python tools/build_catalog.py          # writes app/assets/data/exercises.json
```

**Regenerate the rank icons** (only after redrawing `art/streak-source.png`):
```bash
pip install -r requirements.txt
python tools/slice_streak_icons.py           # writes app/assets/img/streak/
python tools/slice_streak_icons.py --check   # verify the committed output
```
The script keys the paper out to transparency by flood-filling inwards from the
tile border, so each wash keeps its soft painted edge and dissolves into the
cream. It is a *ramp*, not a threshold — thresholding gives every planet a hard
cut where the paint fades out.

**Add a routine** — edit `app/assets/data/routines.json`. Exercise ids must exist in
`exercises.json`; the build script prints every valid id with `--list`.

**Run the tests** — serve the *repository root* (not `app/`) and open the pages.
They are plain HTML with no runner and no dependencies; each prints PASS/FAIL and a
summary line.
```bash
python -m http.server 8000
# → http://localhost:8000/tests/timer.test.html
# → http://localhost:8000/tests/store.test.html
```
The timer tests replace real time with a fake clock and pump the animation-frame
queue by hand, so every assertion is exact. Both suites cover product rules rather
than implementation details — if a rule in "Rules the UI must keep" changes, the
test changes with it, deliberately.

**Deploy** — push to `main`. The workflow uploads `app/` to Pages. Nothing else
happens; it does not build, bundle, or run Python.

**There is no `app.py` and should not be one.** `serve.py` is a stdlib static
server for development only. Omnia has no backend — adding a Flask entry point at
the root would imply otherwise. Phase 11's optional API gets its own entry point
when it exists.

---

## Gotchas

- **`.nojekyll`**: the Actions deploy uploads `app/` as an artifact and never runs
  Jekyll, so it is not strictly load-bearing today. It stays because it costs
  nothing and is the one thing that breaks silently if Pages is ever switched back
  to branch-based publishing.
- **Hash routing is required.** Pages has no rewrite rules — `#/calendar` survives a
  refresh, `/calendar` returns 404.
- **Paths must be relative** (`assets/...`, never `/assets/...`). The site is served
  from `/Omnia/`, not the domain root, so absolute paths break.
- **iOS Safari:** `100vh` includes the toolbar and clips the timer. Use `100dvh`.
- **Wake lock** is Chrome/Edge/Safari 16.4+; it must fail soft, never throw.
- **Don't hand-edit `exercises.json`** — the build script overwrites it.
