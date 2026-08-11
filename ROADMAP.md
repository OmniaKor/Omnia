# Omnia — Roadmap

**Omnia** is a 10-minute daily core workout app for high schoolers.
Pick a routine, follow the timer, keep the calendar green.

---

## The one constraint that shapes every phase

**GitHub Pages serves static files only. It cannot run Python or Flask.**

A request to `justins-li.github.io/Omnia` is answered by a file on disk — there is no
process to run. So the shipping app is HTML + CSS + JavaScript, and the stack splits
in two:

| Piece | When it runs | Where |
|---|---|---|
| HTML / CSS / JS / Tailwind / DaisyUI | In the browser | GitHub Pages |
| Python (`tools/build_catalog.py`) | **Build time**, on a laptop | Never shipped |
| Flask | Optional local preview + optional self-host later | Phase 11 |
| Supabase | In the browser via `@supabase/supabase-js` | Phase 12 |

This is why the server phases sit at the end, which is also the order asked for:
functionality first, server last. It is not a compromise — Supabase is reached from
the browser directly, so **Omnia never needs Flask in production.** Phase 11 exists
only for people who would rather self-host than use Supabase.

Phase 8 looked like the exception and turned out not to be. Importing a routine
from a video seemed to need a model, and a model needs a key, and a key in a
static site is public. It needed neither: creators already write the routine
into the description, and text that regular can just be parsed. **The table
above still has no runtime row, which is the point.**

Until Phase 12, all user data lives in `localStorage`. That means it is per-device
and survives refreshes but not a new phone. Phase 12 is what fixes that.

---

## Phase status

| Phase | Name | Status |
|---|---|---|
| 0 | Foundation & deploy | ✅ Done |
| 1 | Exercise catalog | ✅ Done |
| 2 | Routines — browse & preview | ✅ Done |
| 3 | The player | ✅ Done |
| 4 | Calendar | ✅ Done |
| 5 | Mobile polish & PWA | ✅ Done |
| 6 | Sound & haptics | ✅ Done |
| 7 | Routine builder | ✅ Done (naming still open) |
| 8 | Import from a video + timed breaks | 🟡 Import done |
| 9 | Sound & music, second pass | ⬜ Planned |
| 10 | The marshmallow — streak incentive | ⬜ Planned |
| 11 | Flask API (optional self-host) | ⬜ Planned |
| 12 | Supabase — accounts & sync | ⬜ Planned |
| 13 | Social & streaks | ⬜ Someday |

---

## Phase 0 — Foundation & deploy ✅

Get a real, mobile-correct page onto GitHub Pages before any feature exists, so
every later phase deploys by reflex instead of by project.

- [x] `app/` published to Pages by `.github/workflows/pages.yml`. Branch-based
      Pages can only serve the repo root or a folder literally named `docs`, so
      a workflow is what buys the honest folder name. It uploads `app/`
      verbatim — there is still no build step.
      (Settings → Pages → Source → GitHub Actions)
- [x] `.nojekyll` so Jekyll never touches the assets
- [x] Tailwind 4 + DaisyUI 5 loaded from jsDelivr — **buildless**, so a `git push`
      deploys. No Node, no CI, nothing for a teammate to install.
- [x] Warm-cream light theme + dark theme, ported from Body-Shop's palette
- [x] Header: `Omnia` wordmark + hero image slot
- [x] Footer: *created by: Justin Li and Owen Zhang Track c/o 2026.*
- [x] Two sidebars — Routines and Calendar — that become a bottom tab bar on phones
- [x] Hash router (`#/routines`, `#/calendar`) — Pages has no rewrite rules, so a
      path router would 404 on refresh

## Phase 1 — Exercise catalog ✅

- [x] `tools/build_catalog.py` pulls `free-exercise-db` at a **pinned commit** and
      writes `app/assets/data/exercises.json`
- [x] Curated to floor-based, **no-equipment** core work — bench / ball / pull-up-bar
      movements filtered out even when tagged "body only"
- [x] Images from jsDelivr, pinned to the same commit
- [x] Movements worth having that the database lacks ship as `placeholder: true` and
      render a drawn `[placeholder]` card instead of a photo
- [x] Generated JSON is **committed**, so Pages works without anyone running Python

## Phase 2 — Routines: browse & preview ✅

- [x] Sidebar lists routines (`Routine #1` … `Routine #6` — renamed in Phase 7)
- [x] Duration shown as a **range, floored at 5 min and capped at 15 min**, because
      routines differ in length *and* the user picks 30s or 45s before starting
- [x] Preview page: every exercise, in order, with image and instructions
- [x] 30s / 45s interval choice, made **before** the routine starts
- [x] "Continuous" checkbox, also set before starting
- [x] Small-text line: *other dates you completed this routine*

## Phase 3 — The player ✅

The screen a user actually spends ten minutes on.

- [x] One exercise at a time, beside a large stopwatch
- [x] Interval counts **down** from 30s or 45s
- [x] **Final 5 seconds turn red** — number, ring, and all
- [x] **Continuous on** → a 3s transition, then the next interval starts itself.
      Originally no gap at all; changed because landing mid-movement with the
      clock already running is not "continuous", it is late.
- [x] **Continuous off** → timer pauses at 0 and waits on a **"Ready?"** button
- [x] Both gaps preview the **upcoming** exercise, and only that one
- [x] **Break** → 15s break in the same interface, then the exercise timer resumes
      exactly where it left off
- [x] **Quit** → confirmation dialog first; only on confirm does the routine stop and
      the user return to the preview
- [x] Completion is recorded **once per routine**, not per exercise
- [x] Wake lock so phones don't sleep mid-plank
- [x] No sound — deliberately deferred to Phase 6

## Phase 4 — Calendar ✅

- [x] Month grid, one pastel dot per day
- [x] 🟥 **red** — no ab workout that day
- [x] 🟨 **yellow** — quit during a workout, no full routine finished that day
- [x] 🟩 **green** — at least one routine finished in full that day. Green **wins**:
      quit once then finish anything, and the day is green.
- [x] Tapping a day shows which routines were completed
- [x] Pastel palette, and the three states differ in **shape and label** as well as
      hue so red/green colourblind users can still read it

## Phase 5 — Mobile polish & PWA ✅

Mobile is the primary target, not an adaptation.

- [x] Phone-first layout; sidebars collapse to a bottom tab bar
- [x] All controls ≥ 44px touch targets
- [x] `100dvh` so iOS Safari's toolbar can't clip the timer
- [x] **The player is exactly one screen and never scrolls.** Someone in a plank
      cannot scroll to find the clock. The figure shrinks to absorb the
      difference; verified with no overflow from 320×568 up to iPad
- [x] Safe-area insets for notches and home indicators
- [x] No accidental zoom, text-select, or pull-to-refresh during a workout
- [x] `manifest.webmanifest` — installs to the home screen
- [x] Service worker: **offline-capable**, exercise images cached after first view
- [x] `prefers-reduced-motion` respected

---

## Phase 6 — Sound & haptics ✅

Every sound is synthesised with `OscillatorNode` — no audio files, so the repository
stays text-only and cues work offline because there is nothing to fetch.

- [x] Countdown ticks on the last 3 seconds, rising in pitch so 3 and 1 differ
- [x] Rising tone when the next exercise starts
- [x] Falling tone when the run holds for **"Ready?"** — the inverse of advance,
      because the action it asks for is the opposite
- [x] Break start and break end, a matched pair bracketing the rest
- [x] Routine complete — a pentatonic arpeggio resolving to the octave
- [x] Quit — quiet, and pointedly not a failure sound
- [x] **Ambient music**: a slow A-minor pad with sparse shimmer, synthesised
- [x] `AudioContext` unlocked on the Start tap — iOS Safari requirement
- [x] Mute in the player top bar; Sound and Music toggles on the preview
- [x] `navigator.vibrate()` on Android, suppressed when muted; no-op on iOS
- [x] Context resumed on `visibilitychange`, or returning from a notification
      leaves the rest of the routine silent

**Still open**: respecting the iOS ringer switch. Safari does not expose it, so
there is currently no way to detect it from a web app.

## Phase 7 — Routine builder ✅ (naming still open)

- [x] **Build your own**: search by name, or browse the list and pick
- [x] Filter by level; search matches name, level and muscle
- [x] Reorder with arrows — dragging a list item on a touch screen fights the
      page scroll, and this is edited on a phone more often than not
- [x] **Add your own exercise**, name and optional cue; no photo needed — it
      renders the same drawn placeholder the catalog's own gaps use
- [x] Edit and delete custom routines; deleting leaves completed days on the
      calendar, because those were days the user actually trained
- [x] Live duration estimate, clamped to the same 5–15 min promise
- [x] Sticky save bar on phones — the catalog is 43 rows deep
- [x] The list stops at 8 rows behind **"View N more"**, so "+ Add your own
      exercise" is on the first screen instead of 2,500px below it

**Still open:**

- [ ] Replace `Routine #1…#6` with real names and a one-line description each
- [ ] Duplicate a routine as a starting point
- [ ] Share a routine as a URL — encode it in the hash, no server needed
- [ ] Photos for user-added exercises
- [ ] Replace the remaining `[placeholder]` cards with real images

## Phase 8 — Import a routine from a video + timed breaks 🟡 (import shipped)

Paste a YouTube link, let a model read the workout out of it, and get back a
custom routine — exercises in order, with the breaks the video actually takes.

### Three designs, and why the third one shipped

**Draft one** assumed a server-side `web_fetch` could pull the video's text,
sidestepping CORS. Checked, and it does not work: a watch page fetched that way
returns the title and nothing else, because the description and chapters live
in a `ytInitialData` JSON blob inside a `<script>` tag that every HTML-to-text
pass discards.

**Draft two** used the YouTube Data API for the description and a model to read
it, both called from the browser with the user's own keys. It worked. It also
required a high schooler to hold an Anthropic API key, which is a wall no
amount of engineering gets over.

**What shipped** reads the description as text and needs nothing at all. The
creator has already written the routine out:

```
Workout // 30s work, no rest
00:09 - Full Extension Crunches
00:39 - Eagle Crunches
```

The exercises are the lines; the intervals are the gaps between the timestamps.
That list is regular enough to parse directly, so it is parsed directly — no
key, no account, no network, no cost, works offline, and it cannot invent an
exercise that was never in the text.

The cost is honest and worth stating: **the description has to be pasted.** A
browser cannot read a YouTube page, and captions are shut by *policy* rather
than by CORS — `captions.download` needs OAuth from the video's owner, so
nothing will ever fetch a stranger's transcript. Videos that keep the routine
on screen and never write it down cannot be imported at all.

### Import ✅

- [x] Paste the description → exercises in order, with the interval each ran for
- [x] **No API key, no network, no account.** Pure parsing in
      `app/assets/js/importer.js`
- [x] Reads `00:09 - Name`, `0:30 Name`, en/em dashes, pipes, colons, brackets,
      and hour-long timestamps; sorts by time so a stray line cannot produce a
      negative interval
- [x] A stated header (`30s work, no rest`, `45s on / 15s off`) **beats the
      gaps**, because a gap is work plus whatever rest followed it
- [x] Rest lines are recognised and kept out of the exercise list
- [x] Timestamped lines that are not exercises — intro, outro, subscribe,
      socials — are dropped
- [x] Catalog matching scores on how much of the *catalog* name is present, so
      "Slow Flutter Kicks" finds Flutter Kicks. At least one matched word must
      be distinctive, so "Low Plank Hold" stays a Plank instead of drifting to
      "Hollow Body Hold"
- [x] Anything with no honest match becomes a `customExercises` entry, exactly
      as the builder's "add your own" does. **No new routine shape**
- [x] Land in the builder, not the player — the parser gets things wrong and the
      edit screen that fixes them already exists
- [x] Detected timings shown in review and kept on `routine.source.detected`;
      offers to set the 30s/45s interval to match what the video used
- [x] Any YouTube link in the pasted text is kept, so the routine points home
- [x] Reached from **Routines → "Import routine from YouTube video"**
- [x] **You name it.** The first prose line was tried as a title and it is almost
      never one — it is "Workout", or the channel's tagline. Review asks instead
- [x] `tests/importer.test.html` — 49 assertions over the worked example, line
      shapes, header forms, gap arithmetic, rests, and the near-miss matches
- [x] Every failure is a sentence: nothing pasted, a link on its own, or text
      with no timestamped exercises in it
- [x] Nothing about import can break the app for someone who never opens it

### Timed breaks mid-routine ⬜

**Not built yet.** Import detects rests and records their length, but the player
still runs one interval for the whole routine, so they are shown and stored
rather than played. This is the half that makes them real.

Phase 3's break is a button the user presses when they need air. This is a
different thing: a break the routine *plans*, sitting between two exercises.

- [ ] Reserved ids `break-15` / `break-30` / `break-45` in a routine's
      `exercises` list. `catalog.js` resolves them ahead of the catalog into a
      synthetic record, which keeps `exercises` a flat list of strings and keeps
      the Phase 12 Supabase migration a copy rather than a translation.
- [ ] Builder: insert a break between any two exercises, reorder it with the same
      arrows, delete it
- [ ] Player runs it in the same interface as everything else. It counts down,
      the last 5 seconds are red, and it obeys Continuous — a scheduled break is
      an interval, not an interruption.
- [ ] **The Break button keeps its old meaning.** Pressing it during a scheduled
      break is still "end this early", and afterwards the run resumes where it
      left off. Two kinds of break, one interface, no new controls.
- [ ] Duration estimate counts a break's real seconds instead of an interval, and
      is still clamped to the 5–15 min promise
- [ ] `exercisesDone` counts exercises. A break is not a rep, and the calendar
      must not think otherwise.

## Phase 9 — Sound & music, second pass ⬜

Phase 6 proved the audio engine works. This is the pass that makes it feel like a
product instead of a set of beeps: the interface gets a voice, and the workout
gets music that moves with it.

### The mp3 question, decided up front

"Exercise music" is the one item here that could quietly cost the project its
best property. A real track is a file: it makes the repo binary, it has to be
cached by the service worker for offline to keep working, and — the part that
actually ends the argument — **two high schoolers cannot ship someone else's
music.** Licensing is not a detail to sort out later; it is the whole decision.

So: **still synthesised, still no mp3.** The rule from Phase 6 holds. What
changes is ambition — the Phase 6 pad was one slow A-minor drone, and this phase
turns the same `OscillatorNode` machinery into something with a pulse. If a real
soundtrack is ever genuinely wanted, it is a deliberate reversal of a rule that
is currently load-bearing, and it belongs in **Not doing** until someone has an
answer for the licence.

### Interface sound

- [ ] Cues for the interface, not just the timer: tab change, routine selected,
      toggle flipped, save, delete. Quiet, short, and clearly a family with the
      Phase 6 cues rather than a second sound palette bolted on.
- [ ] One shared envelope and scale so every sound in the app is related. Two
      unrelated palettes is what makes an app sound cheap.
- [ ] Distinct cue for a scheduled break starting (Phase 8) versus a tapped one —
      same interface, but the user should be able to hear which happened
- [ ] Nothing new may be loud. The app is used at 6am in a bedroom.

### Exercise music

- [ ] Music that tracks the run instead of looping under it: a steadier pulse
      during an exercise, something calmer during a break, and a resolve on the
      last interval so the end is audible before it arrives
- [ ] Tempo follows the interval — 30s and 45s should not feel like the same
      workout
- [ ] Two or three moods the user picks on the preview screen, alongside the
      existing Sound and Music toggles. Not a settings page.
- [ ] Music ducks under cues. A countdown tick that gets buried is a bug.

### Rules this pass must not break

These are from Phase 6 and are the reason the audio has never broken a workout:

- [ ] Every sound synthesised. **No audio files.**
- [ ] Nothing in `audio.js` throws into the timer — every path degrades to silence
- [ ] `AudioContext` created on a user gesture only, never on a hashchange
- [ ] Cues gated on the second *changing*, because `paint()` runs every frame
- [ ] Phase cues stay exclusive: one transition, one sound
- [ ] Haptics suppressed when muted
- [ ] Music is a toggle, and off means silent — not quieter

## Phase 10 — Streak incentive 🟡 (the rank badge landed in v7.09)

A mascot that is happy while the streak is alive. Miss too long and it gets sad.
Come back and it cheers up.

**What shipped, and how it differs from the sketch below.** The marshmallow
became six watercolour planets ranked **S A B C D F**, and it lives in the
masthead circle on every screen with a header rather than on the calendar.
Climbing is earned by streak length; falling is measured by absence. The three
limits in "Say the quiet part first" carried over unchanged — they are the
reason the feature is shaped this way, not decoration on top of it.

Design: `docs/superpowers/specs/2026-08-07-consistency-rank-badge-design.md`

### Say the quiet part first

This is a guilt mechanic, and the app it is modelled on is famous for exactly
that. The users are high schoolers, and the behaviour being pressured is
exercise — which is a place where "you have disappointed the little guy" can stop
being funny. It is still worth building, because the calendar is already the
motivation and this gives it a face. But three limits are part of the feature,
not softeners bolted on afterwards:

- **Sad, never punishing.** It looks disappointed. It does not shame, guilt-trip,
  scold, or beg.
- **A missed day never erases history.** Nothing burns down, nothing resets to
  zero visually. The calendar keeps every green square it earned, because those
  were days the user actually trained.
- **It never nags off-screen.** No push notifications, no badge counts. It is
  there when the app is opened, and silent otherwise.

If it ever reads as mean, the feature is wrong and the fix is the mascot, not the
user.

### Streak

- [x] Streak computed from `sessions`, folded by `localDate` — **the same fold
      the calendar already does.** One source of truth; a second streak counter
      that can disagree with the squares is a bug generator. `calendar.js` had
      grown its own walk and now reads `streak.js` instead.
- [x] `localDate`, never `finishedAt`. An 11pm workout keeps the streak for that
      day even after UTC rolls over — this is the same trap documented in the
      data model, and it is easy to walk back into here.
- [x] Only `completed` counts. A quit day is yellow on the calendar and is not a
      streak day.
- [x] Current streak and longest streak, both derived at read time. Nothing new
      persisted — `sessions` already holds everything.

### The mascot

- [x] Painted, not drawn: six watercolour planets sliced from one sheet by
      `tools/slice_streak_icons.py`. Not SVG — the artwork exists and is a
      wash. 20 KB of WebP against 284 KB of PNG paid for the exception.
- [x] Six ranks rather than three moods, earned by streak length on the way up
      and measured by absence on the way down. Sad still takes more than one
      missed day: one skipped Tuesday is a C, not a crisis.
- [ ] A small reaction on finishing a routine, seen once on the completion
      screen. Still open — a separate surface and a separate decision.
- [x] Lives in the masthead circle, on every screen with a header. It does
      **not** appear during the player — the header already hides itself, so
      nothing gets between the user and the clock.
- [x] `prefers-reduced-motion` respected: the rank still changes, motion does not
- [x] It can be turned off, and turning it off leaves the streak numbers intact.
      Hiding is in the badge's own reveal; the way back is on the calendar.
- [x] The paper is keyed out to transparency and the rim feathered to a disc,
      so each planet sits concentric with hero.svg's rings and dissolves into
      the cream instead of being stamped onto it.

**Note for Phase 13:** streak *calculation* lands here, not there. What stays in
Social & streaks is the social half — friends, teams, sharing.

## Phase 11 — Flask API (optional self-host) ⬜

Only for self-hosting. **Pages users skip straight to Phase 12.**

- [ ] Flask app factory + blueprints, mirroring Body-Shop's layout
- [ ] SQLite locally, Postgres in production; Alembic migrations
- [ ] `GET /api/routines`, `GET /api/exercises`, `POST /api/completions`,
      `GET /api/calendar`
- [ ] Same JSON shapes the static app already reads, so the frontend swaps its
      data source and nothing else changes
- [ ] CORS for the Pages origin
- [ ] Deployable to Render, like Body-Shop

**SQL schema sketch** (shared with Phase 12):

```sql
create table completions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  routine_id  text not null,
  status      text not null check (status in ('completed', 'quit')),
  interval_s  int  not null check (interval_s in (30, 45)),
  continuous  boolean not null default false,
  started_at  timestamptz not null,
  finished_at timestamptz not null,
  local_date  date not null   -- the user's own day, not UTC. Drives the calendar.
);
create index on completions (user_id, local_date);
```

`local_date` is stored, not derived. A workout finished at 11pm belongs to that day
even when UTC has already rolled over — deriving it server-side would paint the wrong
calendar square for anyone west of London.

## Phase 12 — Supabase: accounts & sync ⬜

The real goal. Reached from the browser, so **GitHub Pages is still enough** — no
Flask, no server to pay for.

- [ ] `@supabase/supabase-js` from CDN, matching the buildless setup
- [ ] Email + password auth, plus Google sign-in
- [ ] Tables per the schema above
- [ ] **Row Level Security** on every table — a high schooler's workout log is
      private, and RLS is what actually enforces that. `anon` key is public by
      design; RLS is the only thing between users' data.
- [ ] Migrate existing `localStorage` history into the account on first sign-in,
      so nobody loses their streak by making an account
- [ ] **Offline-first**: keep writing to `localStorage`, sync when online. A workout
      in a basement gym with no signal must still count.
- [ ] Conflict rule: last-write-wins per `(user_id, routine_id, finished_at)`
- [ ] Anonymous use stays supported — an account is optional, never a gate

## Phase 13 — Social & streaks ⬜

Streak *calculation* ships in Phase 10 with the marshmallow. What is left here is
the social half.

- [ ] Personal bests, total minutes
- [ ] Add friends; see their streak, never their data
- [ ] Team view for the track team
- [ ] Shareable streak card as an image

---

## Not doing

Recorded so they don't get re-litigated:

- **Server-side rendering** — kills GitHub Pages hosting
- **Native iOS/Android apps** — the PWA installs to the home screen already
- **Video demos** — 85MB of stills already cover it; video is a bandwidth problem
- **Accounts as a requirement** — a gate on day one loses the user
- **Rep counting via camera** — interesting, not a 10-minute-workout problem
