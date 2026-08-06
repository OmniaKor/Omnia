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
| Flask | Optional local preview + optional self-host later | Phase 8 |
| Supabase | In the browser via `@supabase/supabase-js` | Phase 9 |

This is why the server phases sit at the end, which is also the order asked for:
functionality first, server last. It is not a compromise — Supabase is reached from
the browser directly, so **Omnia never needs Flask in production.** Phase 8 exists
only for people who would rather self-host than use Supabase.

Until Phase 9, all user data lives in `localStorage`. That means it is per-device
and survives refreshes but not a new phone. Phase 9 is what fixes that.

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
| 6 | Sound & haptics | ⬜ Next |
| 7 | Real routine names & builder | ⬜ Planned |
| 8 | Flask API (optional self-host) | ⬜ Planned |
| 9 | Supabase — accounts & sync | ⬜ Planned |
| 10 | Social & streaks | ⬜ Someday |

---

## Phase 0 — Foundation & deploy ✅

Get a real, mobile-correct page onto GitHub Pages before any feature exists, so
every later phase deploys by reflex instead of by project.

- [x] `docs/` as the Pages publishing root (Settings → Pages → `main` / `/docs`)
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
      writes `docs/assets/data/exercises.json`
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
- [x] **Continuous on** → intervals run back-to-back, no gap
- [x] **Continuous off** → timer pauses at 0 and waits on a **"Ready?"** button
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
- [x] Safe-area insets for notches and home indicators
- [x] No accidental zoom, text-select, or pull-to-refresh during a workout
- [x] `manifest.webmanifest` — installs to the home screen
- [x] Service worker: **offline-capable**, exercise images cached after first view
- [x] `prefers-reduced-motion` respected

---

## Phase 6 — Sound & haptics ⬜ NEXT

Deferred out of Phase 3 on purpose: sound needs a user gesture to unlock on iOS, and
that is its own problem, not the timer's.

- [ ] Countdown beeps on the last 3 seconds
- [ ] Distinct tone at interval end / routine end
- [ ] Unlock `AudioContext` on the first tap of "Start" — iOS Safari requirement
- [ ] Mute toggle, remembered between sessions
- [ ] `navigator.vibrate()` on Android; silent no-op on iOS
- [ ] Generate tones with `OscillatorNode` — no audio files, keeps the repo tiny
- [ ] Respect the ringer/silent switch where the browser exposes it

## Phase 7 — Real routine names & builder ⬜

- [ ] Replace `Routine #1…#6` with real names and a one-line description each
- [ ] Difficulty tag per routine
- [ ] **Build your own**: pick exercises, order them, name it, save it
- [ ] Edit / duplicate / delete custom routines
- [ ] Share a routine as a URL — encode it in the hash, no server needed
- [ ] Replace the remaining `[placeholder]` cards with real images

## Phase 8 — Flask API (optional self-host) ⬜

Only for self-hosting. **Pages users skip straight to Phase 9.**

- [ ] Flask app factory + blueprints, mirroring Body-Shop's layout
- [ ] SQLite locally, Postgres in production; Alembic migrations
- [ ] `GET /api/routines`, `GET /api/exercises`, `POST /api/completions`,
      `GET /api/calendar`
- [ ] Same JSON shapes the static app already reads, so the frontend swaps its
      data source and nothing else changes
- [ ] CORS for the Pages origin
- [ ] Deployable to Render, like Body-Shop

**SQL schema sketch** (shared with Phase 9):

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

## Phase 9 — Supabase: accounts & sync ⬜

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

## Phase 10 — Social & streaks ⬜

- [ ] Streak counter, longest streak
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
