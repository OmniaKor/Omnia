# Consistency Rank Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a ranked planet icon in the centre of the masthead circle that rises to **S** while the user trains daily and falls to **F** while they stay away.

**Architecture:** A build-time Python script slices one source PNG into six circle-masked WebP files. A pure JS module turns the existing `sessions` list into a rank — no new persisted state, folded exactly as the calendar folds it. A small DOM module mounts the badge over `hero.svg` at the fixed 75%/50% point where the SVG draws its rings.

**Tech Stack:** Vanilla ES modules, Pillow (build time only), plain-HTML test pages. No build step, no npm, no framework — see `CLAUDE.md`.

**Spec:** `docs/superpowers/specs/2026-08-07-consistency-rank-badge-design.md`

## Amendments made during execution

The tasks below are left as written. These three things changed while building,
and the spec has been updated to match:

1. **The artwork is not circle-masked.** A circle clips the watercolour fade,
   which is the best thing about it. `slice_streak_icons.py` now keys the paper
   to transparency — a paperness ramp plus a flood fill inwards from the tile
   border — so each wash keeps its painted edge. Icons are ~440×371 with a
   varying height, not 400×400 squares. Task 1's code block is superseded by
   the file on disk.
2. **The badge is sized off the banner's height, not its width**, and is
   considerably larger: `height: clamp(104px, 86%, 232px)` with an explicit
   `aspect-ratio: 440 / 371`. The aspect ratio is load-bearing — see the spec.
   Ships as **`v7.09`**, not `v7.08`; the resize was a second visible change.
3. **Verification uses `serve.py`, never `python -m http.server`.** Only the
   former sends `Cache-Control: no-store`. With plain `http.server` the browser
   applies heuristic freshness and serves back the JS you just edited, which
   presents as the feature simply not working.

## Global Constraints

- **GitHub Pages is static hosting.** Nothing under `app/` may need Python at request time. Pillow is build-time only, like `requests`.
- **Paths must be relative** (`assets/...`, never `/assets/...`). The site is served from `/Omnia/`.
- **Version lives in exactly one place:** `id="version"` in `app/index.html`. This work ships as `v7.07` → **`v7.08`**. Bump it in the same edit as the change, not afterwards.
- **Do not bump `CACHE` in `app/sw.js`.** Same-origin requests are network-first and the runtime `put` covers existing installs; bumping it would discard every cached exercise photograph.
- **Only `completed` sessions count.** A quit day is yellow on the calendar and is not a streak day.
- **`localDate` is stored, never derived from `finishedAt`.** Parse `YYYY-MM-DD` with `new Date(y, m - 1, d)`, never `new Date('2026-08-07')` — the string form parses as UTC.
- **Day differences round, never truncate.** `Math.round((b - a) / 86400000)`. A local day is 23 or 25 hours across a DST boundary.
- **Minimal text in the margins.** The masthead carries no permanent text from this feature. The rank letters are drawn into the artwork; the app never prints one as text.
- **Sad, never punishing.** No shaming copy, no notifications, no calendar history erased.
- **`prefers-reduced-motion`:** the rank still changes, the motion does not.
- **One streak counter.** `calendar.js` already has its own `streakLabel()` walk; Task 3 removes it. Two counters that can disagree with the squares is a bug generator.

## File Structure

| File | Responsibility |
|---|---|
| `art/streak-source.png` | The 1365×768 source sheet. Outside `app/` so Pages never uploads it. |
| `tools/slice_streak_icons.py` | Build time. Sheet → six circle-masked WebP. Output committed. |
| `app/assets/img/streak/{s,a,b,c,d,f}.webp` | Generated artwork, one per rank. |
| `app/assets/js/streak.js` | **Pure.** `sessions` → `{ rank, unranked, streak, best, daysSince }`. No DOM, no clock. |
| `app/assets/js/rank.js` | **DOM.** Mounts the badge, refreshes it, owns tap-to-reveal and hide/show. |
| `app/assets/js/app.js` | Calls `refreshRank()` from `route()`. |
| `app/assets/js/calendar.js` | Uses `streak.js` instead of its own walk; hosts the "Show" link. |
| `tests/streak.test.html` | Pins the ladder. |

`rank.js` is separate from `app.js` so `calendar.js` can import `refreshRank` without a cycle (`app.js` already imports `calendar.js`). The spec said "mounted from app.js"; this is the same thing with the cycle designed out.

---

### Task 1: Slice the six icons

**Files:**
- Create: `art/streak-source.png` (moved, `git mv` from `app/assets/img/`)
- Create: `tools/slice_streak_icons.py`
- Create: `app/assets/img/streak/{s,a,b,c,d,f}.webp` (generated)
- Modify: `requirements.txt`

**Interfaces:**
- Consumes: nothing.
- Produces: six files at `app/assets/img/streak/<rank>.webp`, 400×400 RGBA, where `<rank>` is the lowercase rank letter — `s`, `a`, `b`, `c`, `d`, `f`.

- [ ] **Step 1: Move the source out of `app/`**

It is currently untracked at `app/assets/img/Gemini_Generated_Image_b31j3gb31j3gb31j.png`, where the Pages workflow would upload 2.2 MB no page requests.

```bash
mkdir -p art
mv app/assets/img/Gemini_Generated_Image_b31j3gb31j3gb31j.png art/streak-source.png
```

- [ ] **Step 2: Add the build-time dependency**

Append to `requirements.txt`, replacing the "currently empty of hard requirements" wording since it is no longer true:

```
# tools/slice_streak_icons.py slices the consistency-rank artwork. Build time
# only — the six WebP files it writes are committed, and the browser only ever
# sees those.
Pillow>=10.0
```

- [ ] **Step 3: Write the slicer**

Create `tools/slice_streak_icons.py`:

```python
"""Slice the six consistency-rank planets out of one source sheet.

Build-time only, exactly like build_catalog.py: run it by hand, commit the
output, and nobody needs Python to deploy Omnia. The source sheet deliberately
lives outside ``app/`` — it is 2.2 MB that no page ever requests, and
everything under ``app/`` is uploaded to Pages.

Usage
-----
    pip install -r requirements.txt
    python tools/slice_streak_icons.py            # write the icons
    python tools/slice_streak_icons.py --check    # verify the committed output
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "art" / "streak-source.png"
OUT_DIR = ROOT / "app" / "assets" / "img" / "streak"

#: The sheet is three planets across and two down. Measured gutters sit at
#: x=456, x=915 and y=383 on the 1365x768 sheet, which is an even split to
#: within two pixels — so the tiles are cut evenly and the seam is trimmed
#: rather than detected. Detection would be one more thing to break when the
#: artwork is redrawn.
COLUMNS, ROWS = 3, 2
SEAM = 4

#: Tile number (1-6, left to right along the top row, then the bottom) → rank.
#: This ordering is the product owner's call, not a guess: 5 is the best planet
#: and 6 the worst. S, A, B and C are drawn into the artwork itself; D and F
#: are the two unlettered planets — the cracked one and the exhausted one.
RANK_BY_TILE = {5: "S", 1: "A", 2: "B", 4: "C", 3: "D", 6: "F"}

SIZE = 400
QUALITY = 82


def tile(sheet: Image.Image, number: int) -> Image.Image:
    """One cell of the grid, with the seam trimmed off every edge."""
    width, height = sheet.size
    tile_w, tile_h = width // COLUMNS, height // ROWS
    row, col = divmod(number - 1, COLUMNS)
    return sheet.crop((
        col * tile_w + SEAM,
        row * tile_h + SEAM,
        (col + 1) * tile_w - SEAM,
        (row + 1) * tile_h - SEAM,
    ))


def disc(img: Image.Image, size: int) -> Image.Image:
    """Centre square, resized, masked to a circle with an antialiased edge.

    A circle rather than the square tile: the tiles are watercolour on white
    paper, and a white square on Omnia's cream ground reads as a hole cut in
    the page. hero.svg already draws concentric rings at this spot, so a disc
    lands as the planet inside them.
    """
    width, height = img.size
    side = min(width, height)
    left, top = (width - side) // 2, (height - side) // 2
    square = img.crop((left, top, left + side, top + side)).resize(
        (size, size), Image.LANCZOS
    )

    # Drawn at 4x and downsampled: PIL's ellipse has no antialiasing of its
    # own, and a hard-edged mask shows every stair-step against the cream.
    scale = 4
    mask = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(mask).ellipse(
        (0, 0, size * scale - 1, size * scale - 1), fill=255
    )
    square.putalpha(mask.resize((size, size), Image.LANCZOS))
    return square


def build() -> None:
    if not SOURCE.exists():
        sys.exit(f"missing source sheet: {SOURCE}")

    sheet = Image.open(SOURCE).convert("RGBA")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for number, rank in RANK_BY_TILE.items():
        path = OUT_DIR / f"{rank.lower()}.webp"
        disc(tile(sheet, number), SIZE).save(
            path, "WEBP", quality=QUALITY, method=6
        )
        print(f"  {rank}  tile {number}  →  {path.relative_to(ROOT)}"
              f"  ({path.stat().st_size / 1024:.0f} KB)")

    print(f"wrote {len(RANK_BY_TILE)} icons to {OUT_DIR.relative_to(ROOT)}")


def check() -> None:
    """Verify the committed output without needing the source sheet."""
    problems = []
    for rank in RANK_BY_TILE.values():
        path = OUT_DIR / f"{rank.lower()}.webp"
        if not path.exists():
            problems.append(f"missing {path.relative_to(ROOT)}")
            continue
        with Image.open(path) as img:
            if img.size != (SIZE, SIZE):
                problems.append(
                    f"{path.relative_to(ROOT)} is {img.size}, expected "
                    f"({SIZE}, {SIZE})"
                )

    if problems:
        for problem in problems:
            print(problem, file=sys.stderr)
        sys.exit(1)
    print(f"all {len(RANK_BY_TILE)} icons present at {SIZE}x{SIZE}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true",
        help="verify the committed icons instead of rewriting them",
    )
    args = parser.parse_args()
    check() if args.check else build()


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run it**

```bash
pip install -r requirements.txt
python tools/slice_streak_icons.py
```

Expected: six lines naming ranks S, A, B, C, D, F, each roughly 15–25 KB, then `wrote 6 icons to app/assets/img/streak`.

- [ ] **Step 5: Verify the output**

```bash
python tools/slice_streak_icons.py --check
ls -la app/assets/img/streak/
```

Expected: `all 6 icons present at 400x400`, and no file over 40 KB. If any file exceeds that, the source sheet changed — do not raise `QUALITY`; re-measure first.

Then look at them. Open `app/assets/img/streak/s.webp` and `f.webp` and confirm each planet's face is inside the disc and not clipped by the circular mask. `s` is the yellow eyes-closed planet; `f` is the teal half-lidded one.

- [ ] **Step 6: Commit**

```bash
git add art/streak-source.png tools/slice_streak_icons.py requirements.txt app/assets/img/streak/
git commit -m "Slice the six consistency-rank planets from the source sheet"
```

---

### Task 2: The rank rule

**Files:**
- Create: `app/assets/js/streak.js`
- Test: `tests/streak.test.html`

**Interfaces:**
- Consumes: session records shaped as `{ status, localDate }` — the shape `store.js` already appends.
- Produces:
  - `streakState(sessions, today) → { rank, unranked, streak, best, daysSince }`
    - `rank`: `'S'|'A'|'B'|'C'|'D'|'F'`
    - `unranked`: `true` only when no completed session has ever happened
    - `streak`: current live run in days, **0 when the streak is broken**
    - `best`: longest run ever, in days
    - `daysSince`: whole days since the last completed day, `null` when unranked
  - `RANKS` — `['S', 'A', 'B', 'C', 'D', 'F']`, best first

- [ ] **Step 1: Write the failing test**

Create `tests/streak.test.html`. It follows `tests/store.test.html` exactly — plain HTML, no runner, PASS/FAIL and a summary line. Because `streakState` takes `today` as an argument there is no clock to fake and no `localStorage` to seed.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Omnia — streak tests</title>
<style>
  body { font: 14px ui-monospace, monospace; padding: 1.5rem; line-height: 1.7; }
  .pass::before { content: "PASS  "; color: #1f6a42; }
  .fail::before { content: "FAIL  "; color: #8f2010; }
  .fail { color: #8f2010; }
  h1 { font: 600 16px ui-monospace, monospace; }
  #summary { margin-top: 1rem; font-weight: 600; }
</style>
</head>
<body>
<h1>streak — the consistency ladder</h1>
<div id="out"></div>
<div id="summary">running…</div>

<script type="module">
/*
  The ladder is a product decision, not an implementation detail, so it is
  pinned here. `today` is an argument to streakState, so every boundary is
  exact without a fake clock and without touching localStorage.
*/

const results = [];
const ok = (name, condition, detail = '') => results.push({ name, condition, detail });

const { streakState, RANKS } = await import('../app/assets/js/streak.js');

/** Completed sessions on the given days. */
const done = (...days) => days.map((d) => ({ status: 'completed', localDate: d }));
/** Quit sessions on the given days. */
const quit = (...days) => days.map((d) => ({ status: 'quit', localDate: d }));

/* ── Nothing yet ────────────────────────────────────────────────────── */

{
  const s = streakState([], '2026-08-07');
  ok('no sessions → unranked B', s.rank === 'B' && s.unranked === true, JSON.stringify(s));
  ok('no sessions → streak 0, best 0', s.streak === 0 && s.best === 0, JSON.stringify(s));
  ok('no sessions → daysSince null', s.daysSince === null, JSON.stringify(s));
}

{
  const s = streakState(quit('2026-08-06', '2026-08-07'), '2026-08-07');
  ok('quit only → still unranked; quitting is not a streak day',
     s.unranked === true && s.streak === 0, JSON.stringify(s));
}

/* ── Climbing ───────────────────────────────────────────────────────── */

{
  const s = streakState(done('2026-08-07'), '2026-08-07');
  ok('finished today, streak 1 → ranked B',
     s.rank === 'B' && s.unranked === false && s.streak === 1, JSON.stringify(s));
}

{
  const s = streakState(done('2026-08-06', '2026-08-07'), '2026-08-07');
  ok('streak 2 → B', s.rank === 'B' && s.streak === 2, JSON.stringify(s));
}

{
  const s = streakState(done('2026-08-05', '2026-08-06', '2026-08-07'), '2026-08-07');
  ok('streak 3 → A', s.rank === 'A' && s.streak === 3, JSON.stringify(s));
}

{
  const days = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'];
  const s = streakState(done(...days), '2026-08-07');
  ok('streak 6 → still A', s.rank === 'A' && s.streak === 6, JSON.stringify(s));
}

{
  const days = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04',
                '2026-08-05', '2026-08-06', '2026-08-07'];
  const s = streakState(done(...days), '2026-08-07');
  ok('streak 7 → S', s.rank === 'S' && s.streak === 7, JSON.stringify(s));
}

/* ── Today not done yet is not a broken streak ──────────────────────── */

{
  const s = streakState(done('2026-08-04', '2026-08-05', '2026-08-06'), '2026-08-07');
  ok('finished yesterday, nothing today → streak alive at A',
     s.rank === 'A' && s.streak === 3 && s.daysSince === 1, JSON.stringify(s));
}

/* ── Falling ────────────────────────────────────────────────────────── */

{
  const s = streakState(done('2026-08-05'), '2026-08-07');
  ok('2 days since → C', s.rank === 'C' && s.daysSince === 2, JSON.stringify(s));
  ok('broken streak reports streak 0', s.streak === 0, JSON.stringify(s));
}

{
  const s = streakState(done('2026-08-04'), '2026-08-07');
  ok('3 days since → C', s.rank === 'C' && s.daysSince === 3, JSON.stringify(s));
}

{
  const s = streakState(done('2026-08-03'), '2026-08-07');
  ok('4 days since → D', s.rank === 'D' && s.daysSince === 4, JSON.stringify(s));
}

{
  const s = streakState(done('2026-07-31'), '2026-08-07');
  ok('7 days since → D', s.rank === 'D' && s.daysSince === 7, JSON.stringify(s));
}

{
  const s = streakState(done('2026-07-30'), '2026-08-07');
  ok('8 days since → F', s.rank === 'F' && s.daysSince === 8, JSON.stringify(s));
}

/* ── Folding ────────────────────────────────────────────────────────── */

{
  const sessions = [...done('2026-08-07'), ...done('2026-08-07')];
  const s = streakState(sessions, '2026-08-07');
  ok('two finishes the same day count as one streak day',
     s.streak === 1, JSON.stringify(s));
}

{
  // The calendar's green-beats-yellow rule, seen from the streak side.
  const sessions = [...quit('2026-08-07'), ...done('2026-08-07')];
  const s = streakState(sessions, '2026-08-07');
  ok('quit then finished the same day still counts',
     s.streak === 1 && s.unranked === false, JSON.stringify(s));
}

{
  const sessions = done('2026-08-01', '2026-08-02', '2026-08-03', '2026-08-07');
  const s = streakState(sessions, '2026-08-07');
  ok('best survives a break', s.best === 3 && s.streak === 1, JSON.stringify(s));
}

{
  const s = streakState(done('2026-08-07', '2026-08-01', '2026-08-06'), '2026-08-07');
  ok('unsorted input is folded correctly',
     s.streak === 2 && s.rank === 'B', JSON.stringify(s));
}

/* ── Awkward clocks ─────────────────────────────────────────────────── */

{
  // A device clock moved backwards must not rank someone above S.
  const s = streakState(done('2026-08-09'), '2026-08-07');
  ok('a future-dated session clamps daysSince to 0',
     s.daysSince === 0 && s.rank === 'B', JSON.stringify(s));
}

{
  // 8 March 2026 is a DST change in US zones: that local day is 23 hours long,
  // so a truncated day difference would fuse 7 and 9 March into one streak day.
  const s = streakState(done('2026-03-07', '2026-03-08', '2026-03-09'), '2026-03-09');
  ok('a streak across a DST change stays contiguous',
     s.streak === 3 && s.rank === 'A', JSON.stringify(s));
}

{
  const s = streakState(done('2026-07-31', '2026-08-01', '2026-08-02'), '2026-08-02');
  ok('a streak across a month boundary stays contiguous',
     s.streak === 3 && s.rank === 'A', JSON.stringify(s));
}

/* ── Shape ──────────────────────────────────────────────────────────── */

ok('RANKS is best-first',
   JSON.stringify(RANKS) === JSON.stringify(['S', 'A', 'B', 'C', 'D', 'F']),
   JSON.stringify(RANKS));

/* ── Report ─────────────────────────────────────────────────────────── */

document.getElementById('out').innerHTML = results
  .map((r) => `<div class="${r.condition ? 'pass' : 'fail'}">${r.name}${
    r.condition ? '' : ` — got ${r.detail}`}</div>`)
  .join('');

const failed = results.filter((r) => !r.condition).length;
document.getElementById('summary').textContent =
  failed === 0
    ? `ALL PASS — ${results.length} assertions`
    : `${failed} FAILED of ${results.length}`;
</script>
</body>
</html>
```

- [ ] **Step 2: Run it and verify it fails**

Serve the **repository root**, not `app/` — the test imports `../app/assets/js/streak.js`.

```bash
python serve.py --tests --no-browser
```

Open `http://localhost:8000/tests/streak.test.html`.

**Use `serve.py`, not `python -m http.server`.** Only `serve.py` sends
`Cache-Control: no-store`; plain `http.server` lets the browser apply heuristic
freshness and hand you back the JS you just edited.

Expected: the page stays on `running…` and the browser console shows a 404 for `streak.js`. That is the failure — the module does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `app/assets/js/streak.js`:

```js
/**
 * streak.js — how consistent the user has been, as a rank.
 *
 * Pure functions over the session list. Nothing new is persisted: `sessions`
 * already holds everything, and a second stored counter is a counter that can
 * drift out of agreement with the calendar squares.
 *
 * `today` is always an argument rather than read from the clock, so the tests
 * pin every boundary exactly without faking time.
 */

/** Best first. The letters themselves are drawn into the artwork. */
export const RANKS = ['S', 'A', 'B', 'C', 'D', 'F'];

/** `YYYY-MM-DD` → a Date at *local* midnight. */
function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Whole days from `a` to `b`, both `YYYY-MM-DD`.
 *
 * Rounded, not truncated. A local day is 23 or 25 hours long across a DST
 * boundary, and truncating turns a real one-day gap into zero every spring —
 * which would silently fuse two days into one streak day.
 */
function daysBetween(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / 86400000);
}

/**
 * The rank for a given streak and absence.
 *
 * A finish today *or* yesterday keeps the streak alive: today being unfinished
 * must not demote anyone at 9am, which is the same courtesy the calendar
 * extends by not painting today red in advance.
 */
function rankFor(streak, daysSince) {
  if (daysSince <= 1) {
    if (streak >= 7) return 'S';
    if (streak >= 3) return 'A';
    return 'B';
  }
  if (daysSince <= 3) return 'C';
  if (daysSince <= 7) return 'D';
  return 'F';
}

/**
 * @param {Array<{status: string, localDate: string}>} sessions
 * @param {string} today  `YYYY-MM-DD`
 * @returns {{rank: string, unranked: boolean, streak: number,
 *            best: number, daysSince: number|null}}
 */
export function streakState(sessions, today) {
  // The same fold the calendar does: unique local days holding a finish. A day
  // where the user quit and then finished counts, exactly as it goes green.
  const days = [...new Set(
    sessions.filter((s) => s.status === 'completed').map((s) => s.localDate),
  )].sort();

  if (days.length === 0) {
    return { rank: 'B', unranked: true, streak: 0, best: 0, daysSince: null };
  }

  const last = days[days.length - 1];
  // Clamped: a session dated in the future — a device clock moved backwards —
  // must not produce a negative gap and rank somebody above S.
  const daysSince = Math.max(0, daysBetween(last, today));

  let run = 1;
  let best = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = daysBetween(days[i - 1], days[i]) === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }

  // `run` ends on the newest day, so it *is* the current streak — but only
  // while that day is still recent enough to count.
  const streak = daysSince <= 1 ? run : 0;

  return { rank: rankFor(streak, daysSince), unranked: false, streak, best, daysSince };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Reload `http://localhost:8000/tests/streak.test.html`.

Expected: `ALL PASS — 24 assertions`.

- [ ] **Step 5: Commit**

```bash
git add app/assets/js/streak.js tests/streak.test.html
git commit -m "Derive a consistency rank from the session history"
```

---

### Task 3: Retire the duplicate streak walk

`calendar.js` already counts a streak in `streakLabel()`. It agrees with the new module today — `dayStatus(...) === 'green'` means the same thing as "a completed session that day" — but two walks that can disagree with the squares is exactly the bug the spec forbids.

**Files:**
- Modify: `app/assets/js/calendar.js:15` (imports), `:156-171` (`streakLabel`)

**Interfaces:**
- Consumes: `streakState(sessions, today)` from Task 2; `allSessions()` from `store.js`.
- Produces: nothing new. The rendered copy is unchanged.

- [ ] **Step 1: Add a parity assertion to the test**

The point of this task is that behaviour does not change, so pin the calendar's own wording rule in `tests/streak.test.html`. Add before the `── Report ──` block:

```js
/* ── Calendar parity ────────────────────────────────────────────────── */

/* calendar.js prints "No streak yet" when the streak is 0 and "N day streak"
   otherwise. Both branches must be reachable from streakState alone — that is
   what lets calendar.js drop its own walk. */
{
  const none = streakState([], '2026-08-07');
  const some = streakState(done('2026-08-06', '2026-08-07'), '2026-08-07');
  ok('calendar copy is derivable: 0 → "No streak yet"',
     none.streak === 0, JSON.stringify(none));
  ok('calendar copy is derivable: 2 → "2 day streak"',
     some.streak === 2, JSON.stringify(some));
}
```

- [ ] **Step 2: Run the test and verify it passes**

Reload `http://localhost:8000/tests/streak.test.html`.
Expected: `ALL PASS — 26 assertions`.

- [ ] **Step 3: Rewrite `streakLabel` over the shared module**

In `app/assets/js/calendar.js`, change the import on line 15 from:

```js
import { dayStatus, firstActiveDate, localDate, sessionsOn } from './store.js';
```

to:

```js
import { allSessions, dayStatus, firstActiveDate, localDate, sessionsOn } from './store.js';
import { streakState } from './streak.js';
```

Then replace the whole `streakLabel` function at the bottom of the file:

```js
/** Consecutive days ending today (or yesterday) with a finished routine. */
function streakLabel() {
  const { streak } = streakState(allSessions(), localDate());
  return streak === 0 ? 'No streak yet' : `${streak} day streak`;
}
```

The old body walked backwards day by day calling `dayStatus`. `streak.js` owns that walk now, and the masthead badge reads the same numbers.

- [ ] **Step 4: Verify the calendar still reads the same**

```bash
python serve.py --no-browser
```

Open `http://localhost:8000/#/calendar`. With no history the heading under "Calendar" reads `No streak yet`. Then seed a two-day streak in the console, using yesterday and today so the dates stay valid whenever this is run:

```js
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
localStorage.setItem('omnia.v1', JSON.stringify({ version: 1, sessions: [
  { id: 'x', routineId: 'routine-1', status: 'completed', localDate: day(-1), exercisesDone: 12 },
  { id: 'y', routineId: 'routine-1', status: 'completed', localDate: day(0),  exercisesDone: 12 },
]}));
location.reload();
```

Expected: `2 day streak`, and two green squares. Then `localStorage.removeItem('omnia.v1')` and reload.

- [ ] **Step 5: Commit**

```bash
git add app/assets/js/calendar.js tests/streak.test.html
git commit -m "Fold the calendar's streak count into the shared module"
```

---

### Task 4: The badge in the masthead

**Files:**
- Create: `app/assets/js/rank.js`
- Modify: `app/index.html:76-78` (hero markup) and `:66` (version)
- Modify: `app/assets/css/omnia.css:225-241` (hero rules) and append badge rules
- Modify: `app/assets/js/app.js` (import and refresh)
- Modify: `app/assets/js/store.js:13-21` (`streakIcon` default)

**Interfaces:**
- Consumes: `streakState` from Task 2, the icons from Task 1.
- Produces:
  - `mountRank()` — wires the badge once, at boot. Safe to call when the elements are absent.
  - `refreshRank()` — recomputes and repaints. Called from `route()` and after a preference change.
  - `rankText(state) → string` — the reveal line, e.g. `5 day streak · best 12`.

- [ ] **Step 1: Add the preference default**

In `app/assets/js/store.js`, add to `EMPTY.prefs` (after `musicEnabled: true`):

```js
    // The masthead consistency badge. Somebody will find it annoying and
    // should not have to leave over it; hiding it leaves the numbers intact.
    streakIcon: true,
```

The existing `read()` merge (`prefs: { ...EMPTY.prefs, ...(parsed.prefs || {}) }`) backfills this for anyone with saved state, so no migration is needed.

- [ ] **Step 2: Add the markup and bump the version**

In `app/index.html`, replace the `figure.hero` block (lines 76–78):

```html
    <figure class="hero">
      <!-- The frame shrink-wraps the artwork so the badge's percentage offsets
           resolve against the image box, not the figure's own padding. -->
      <div class="hero__frame">
        <img src="assets/img/hero.svg" alt="" width="1200" height="420" decoding="async">
        <button class="rank" id="rank" type="button" aria-expanded="false" hidden>
          <img class="rank__art" id="rank-art" src="assets/img/streak/b.webp"
               alt="" width="400" height="400" decoding="async">
        </button>
      </div>
      <p class="rank__detail" id="rank-detail" hidden></p>
    </figure>
```

The button starts `hidden` and `rank.js` reveals it, so a browser with JS broken shows the masthead exactly as it is today rather than a stuck B.

In the same edit, bump line 66:

```html
        <span class="site-head__version" id="version">· v7.08</span>
```

- [ ] **Step 3: Scope the existing hero CSS, then add the badge rules**

**This is load-bearing.** `.hero img` currently matches *any* `<img>` inside `.hero`, which now includes the badge — it would inherit `width: 100%`, the `cover` crop, and in dark mode a `saturate(0.9)` filter that fights the unranked state.

In `app/assets/css/omnia.css`, replace lines 231–241:

```css
/* `.hero__frame > img` and not `.hero img`: the rank badge is also an <img>
   inside .hero, and must inherit neither the cover crop nor the dark-mode
   knock-back below — the latter would fight the unranked filter. */
.hero__frame > img {
  width: 100%;
  max-height: 28vh;
  object-fit: cover;
  border-radius: var(--radius-box);
}

/* The artwork carries its own cream ground, which lands as a slab of light on
   a near-black page. Knocking it back keeps it part of the page rather than a
   window cut into it. */
[data-theme="omnia-dark"] .hero__frame > img { filter: brightness(0.8) saturate(0.9); }

.hero__frame { position: relative; display: block; }

/*
  hero.svg centres its rings at (900, 210) of a 1200x420 viewBox — 75% across,
  50% down. The image is 2.857:1, wider than any box this layout produces, so
  object-fit: cover can only ever crop it vertically, and symmetrically. Both
  fractions therefore survive at every width, and the badge needs no
  measurement and no per-breakpoint math.
*/
.rank {
  position: absolute;
  left: 75%;
  top: 50%;
  transform: translate(-50%, -50%);
  /* ~190px on desktop. The 96px floor is for phones, where the proportional
     size would be 77px — below where this artwork reads. Mobile legibility
     beats strict ring alignment; at 96px the disc sits between the inner and
     middle rings, which the ringed artwork absorbs. */
  width: clamp(96px, 20%, 200px);
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  background: none;
  border-radius: 50%;
  cursor: pointer;
  line-height: 0;
}
.rank__art { width: 100%; height: 100%; display: block; }

.rank:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}

/* No finished routine yet: the same B planet, drained. The first completed
   routine snaps it to full colour — without this, no-history and a one-day
   streak are both B and the first workout moves nothing in the masthead. */
.rank.is-unranked .rank__art { filter: saturate(0.2) opacity(0.7); }

.rank__detail {
  margin: 0.6rem 0 0;
  text-align: center;
  color: var(--color-secondary);
  font-size: 0.82rem;
}
.rank__hide {
  background: none; border: 0; padding: 0 0 0 0.15rem;
  color: inherit; font: inherit; text-decoration: underline; cursor: pointer;
}

/* The rank changes at most once a day, so the only motion is the new planet
   arriving. Suppressed entirely under reduced motion — the rank still
   changes, it just does not move. */
@media (prefers-reduced-motion: no-preference) {
  .rank__art.is-new { animation: rank-in 260ms ease-out; }
}
@keyframes rank-in {
  from { opacity: 0; transform: scale(0.94); }
  to   { opacity: 1; transform: none; }
}
```

- [ ] **Step 4: Write the badge module**

Create `app/assets/js/rank.js`:

```js
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
```

- [ ] **Step 5: Boot it and refresh on every route**

In `app/assets/js/app.js`, add to the imports:

```js
import { mountRank, refreshRank } from './rank.js';
```

In `route()`, after the `markActive(...)` call, add:

```js
  // Recomputed per navigation: finishing a routine returns here through the
  // router, so this is where a new rank becomes visible.
  refreshRank();
```

In `boot()`, after `applyTheme();`, add:

```js
  mountRank();
```

- [ ] **Step 6: Verify in a browser at both sizes**

```bash
python serve.py --no-browser
```

Open `http://localhost:8000/#/routines`.

- With no history: a **desaturated B** planet sits centred in the hero circle.
- Seed the two-day streak from Task 3 Step 4 and reload: a **full-colour B**.
- Extend the seed to seven consecutive days: an **S**.
- Resize to 390 px wide: the planet is still centred on the circle and still legible.
- Resize to 1280 px: still centred, roughly 190 px across.
- Toggle dark mode with the ◐ button: the hero artwork dims, the **planet does not** — this is the check that Step 3's selector scoping worked.
- Navigate to `#/calendar`: the badge is still there and shows the same rank.
- Start a routine: the whole masthead disappears, badge included.

- [ ] **Step 7: Commit**

```bash
git add app/index.html app/assets/css/omnia.css app/assets/js/rank.js app/assets/js/app.js app/assets/js/store.js
git commit -m "Show the consistency rank in the masthead circle"
```

---

### Task 5: Tap to reveal, and a way back

Task 4 already renders the reveal line and the Hide control. This task makes hiding reversible — without it, Hide is a one-way door.

**Files:**
- Modify: `app/assets/js/calendar.js` (the "Show" link and its handler)

**Interfaces:**
- Consumes: `refreshRank` from Task 4; `getPrefs`/`setPrefs` from `store.js`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Import what the link needs**

In `app/assets/js/calendar.js`, extend the imports added in Task 3:

```js
import { allSessions, dayStatus, firstActiveDate, getPrefs, localDate,
         sessionsOn, setPrefs } from './store.js';
import { streakState } from './streak.js';
import { refreshRank } from './rank.js';
```

- [ ] **Step 2: Render the link when the badge is hidden**

Inside `draw()`, in the `view.innerHTML` template, replace the streak label line (currently `<p class="type-label">${streakLabel()}</p>`) with:

```js
        <p class="type-label">${streakLabel()}</p>
        ${getPrefs().streakIcon === false
          ? `<p class="type-quiet" style="margin:0.35rem 0 0">
               <button class="rank__hide" type="button" id="rank-show">Show consistency rank</button>
             </p>`
          : ''}
```

The calendar is the screen that is already about consistency, so this is the one place the control does not read as clutter.

- [ ] **Step 3: Wire it**

`draw()` rebuilds `view.innerHTML` every time, so the handler must be reattached on each draw. Add it immediately after the existing `#next` handler block (`calendar.js:85-88`), before the `[data-date]` loop:

```js
    // Optional chaining because the link is only in the markup while the
    // badge is hidden.
    view.querySelector('#rank-show')?.addEventListener('click', () => {
      setPrefs({ streakIcon: true });
      refreshRank();
      draw();          // redraw to drop the link now the badge is back
    });
```

- [ ] **Step 4: Verify the round trip**

Reload `http://localhost:8000/#/routines`.

1. Tap the planet → the line appears: `2 day streak · best 2 · Hide`.
2. Tap the planet again → the line collapses.
3. Tap it once more, then tap **Hide** → the planet disappears.
4. Go to `#/calendar` → `Show consistency rank` is under the streak label.
5. Tap it → the link vanishes; go back to `#/routines` and the planet is there.
6. Reload the page → the planet is still there. The preference persisted.
7. Tab to the planet with the keyboard → a brick focus ring; Enter opens the line.

- [ ] **Step 5: Commit**

```bash
git add app/assets/js/calendar.js
git commit -m "Let the calendar bring the rank badge back"
```

---

### Task 6: Offline, and the documentation

**Files:**
- Modify: `app/sw.js:19-21` (`PRECACHE`)
- Modify: `CLAUDE.md`
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: the file names from Task 1.
- Produces: nothing.

- [ ] **Step 1: Precache the icons**

In `app/sw.js`, add to the `PRECACHE` list next to the other images:

```js
  './assets/img/hero.svg',
  './assets/img/icon.svg',
  './assets/img/streak/s.webp',
  './assets/img/streak/a.webp',
  './assets/img/streak/b.webp',
  './assets/img/streak/c.webp',
  './assets/img/streak/d.webp',
  './assets/img/streak/f.webp',
```

and add `'./assets/js/rank.js',` and `'./assets/js/streak.js',` to the script entries, keeping them alphabetical.

**Do not touch `CACHE`.** Same-origin requests are network-first and the runtime `put` caches these on first fetch, so existing installs pick them up without discarding every cached exercise photograph.

- [ ] **Step 2: Document the rules**

In `CLAUDE.md`, add to "Rules the UI must keep", after the **Completion** block:

```markdown
**Consistency rank** (the masthead badge)
- Six ranks, drawn as planets: **S A B C D F**. The letters are *in the
  artwork*; the app never prints one as text.
- Climbing is earned by streak, falling is measured by absence. A finish
  **today or yesterday** keeps the streak alive — today being unfinished must
  not demote anyone at 9am.
- Only `completed` counts, folded by `localDate` — **the same fold the
  calendar does.** A second streak counter that can disagree with the squares
  is a bug generator; `calendar.js` reads `streak.js` for this reason.
- Day gaps are computed with `Math.round`, never truncation. A local day is
  23 or 25 hours across a DST change.
- **No history yet shows a desaturated B.** The first finished routine snaps
  it to full colour; without that, the first workout moves nothing.
- Sad, never punishing. Nothing burns down, no calendar square is ever
  repainted, and it never nags off-screen.
- It can be hidden, and hiding leaves the streak numbers intact. The way back
  is on the calendar screen.
```

Then update the **Layout** tree. Add these lines in their alphabetical places:

```
├── art/
│   └── streak-source.png         # rank artwork source; NOT served
├── tools/
│   ├── build_catalog.py          # regenerates the exercise catalog
│   └── slice_streak_icons.py     # regenerates the rank icons
├── tests/
│   └── streak.test.html          # the consistency ladder
└── app/assets/
    ├── img/streak/               # s a b c d f .webp — GENERATED
    └── js/
        ├── streak.js             # sessions → a rank. Pure; no DOM, no clock.
        └── rank.js               # the masthead badge
```

Add to **Common tasks**:

```markdown
**Regenerate the rank icons** (only after redrawing `art/streak-source.png`):
```bash
pip install -r requirements.txt
python tools/slice_streak_icons.py           # writes app/assets/img/streak/
python tools/slice_streak_icons.py --check   # verify the committed output
```
```

- [ ] **Step 3: Update the roadmap**

In `ROADMAP.md`, change the Phase 10 heading to:

```markdown
## Phase 10 — Streak incentive 🟡 (the rank badge landed in v7.08)
```

Insert this directly under that heading, above "Say the quiet part first":

```markdown
**What shipped, and how it differs from the plan below.** The mascot became six
watercolour planets ranked **S A B C D F**, and it lives in the masthead circle
on every screen with a header rather than on the calendar. Climbing is earned by
streak length; falling is measured by absence. The three limits in "Say the quiet
part first" carried over unchanged — they are the reason the feature is shaped
this way, not decoration on top of it.

Design: `docs/superpowers/specs/2026-08-07-consistency-rank-badge-design.md`
```

In the **Streak** checklist, tick all four boxes — `[x]` — since `streak.js`
delivers each one. In **The marshmallow** checklist, tick the reduced-motion box,
the can-be-turned-off box, and the warm-palette box, and rewrite the four that
changed:

```markdown
- [x] Drawn as watercolour planets, sliced to WebP by
      `tools/slice_streak_icons.py`. Not SVG — the artwork is painted, and
      20 KB of WebP beats 284 KB of PNG for the same 400px.
- [x] Six ranks rather than three moods, driven by streak length on the way up
      and days absent on the way down. Sad still takes more than one missed
      day: one skipped Tuesday is a C, not a crisis.
- [x] Lives in the masthead circle. It does **not** appear during the player —
      the header already hides itself for the timer.
- [ ] A small reaction on finishing a routine, seen once on the completion
      screen. Still open; it is a separate surface and a separate decision.
```

- [ ] **Step 4: Verify offline**

```bash
python serve.py --no-browser
```

Load `http://localhost:8000/#/routines`, then in DevTools → Application → Service Workers, tick **Offline** and reload.

Expected: the app loads and the planet renders from cache.

- [ ] **Step 5: Run every test suite once more**

```bash
python serve.py --tests --no-browser
```

Open each and confirm the summary line:

- `http://localhost:8000/tests/streak.test.html` → `ALL PASS — 26 assertions`
- `http://localhost:8000/tests/store.test.html` → `ALL PASS`
- `http://localhost:8000/tests/timer.test.html` → `ALL PASS`
- `http://localhost:8000/tests/audio.test.html` → `ALL PASS`
- `http://localhost:8000/tests/builder.test.html` → `ALL PASS`

- [ ] **Step 6: Commit**

```bash
git add app/sw.js CLAUDE.md ROADMAP.md
git commit -m "Precache the rank icons and write down the rules"
```

---

## Verification checklist

Before calling this done, confirm each of these by running it — not by reading the code:

- [ ] `python tools/slice_streak_icons.py --check` prints `all 6 icons present at 400x400`
- [ ] All five test pages print `ALL PASS`
- [ ] No history → desaturated B; one finish → full-colour B; seven consecutive days → S
- [ ] Two days idle → C; eight days idle → F
- [ ] Badge is centred on the hero circle at 390 px and at 1280 px
- [ ] Dark mode dims the hero artwork but not the planet
- [ ] Badge is absent during a workout
- [ ] Hide → gone; calendar's "Show consistency rank" → back; survives a reload
- [ ] Version reads `v7.08`, and appears nowhere but `app/index.html`
- [ ] `git grep -n "2.2 MB\|Gemini_Generated"` returns nothing under `app/`
- [ ] `CACHE` in `sw.js` is unchanged
