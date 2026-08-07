# Consistency rank badge — design

**Date:** 2026-08-07
**Status:** approved, ready to plan
**Version this ships as:** `v7.08`

A ranked planet icon in the centre of the masthead circle. It rises to **S** while
the user trains daily and falls to **F** while they stay away.

---

## What this is, and what it replaces

`ROADMAP.md` Phase 10 ("The marshmallow: streak incentive") already specified a
streak mascot. This supersedes the mascot's *form and location* while keeping its
rules:

| Phase 10 said | This ships |
|---|---|
| A drawn SVG marshmallow | Six supplied watercolour planets, sliced from one PNG |
| Three states (happy / uncertain / sad) | Six ranks (S A B C D F) |
| Lives on the calendar screen | Lives in the masthead circle, on every screen with a header |

Everything else in Phase 10 is unchanged and binding:

- **Sad, never punishing.** It looks disappointed. It does not shame or beg.
- **A missed day never erases history.** `sessions` stays append-only; no calendar
  square is ever repainted or reset by this feature.
- **It never nags off-screen.** No notifications, no badge counts.
- Streak is **derived at read time**. Nothing new is persisted except one boolean
  preference.
- Only `completed` counts. A quit day is yellow on the calendar and is not a
  streak day.
- It can be turned off, and turning it off leaves the streak numbers intact.
- `prefers-reduced-motion` respected: the rank still changes, the motion does not.

The streak *calculation* lands here. Phase 13 keeps only the social half.

---

## The six icons

The source is one 1365×768 PNG of a 3×2 grid, six watercolour planets on paper.
Numbering runs left to right across the top row, then the bottom row.

| Icon | Art | Rank |
|---|---|---|
| 5 | Yellow, eyes closed, joyful — lettered **S** | **S** — best |
| 1 | Green/teal, content smile — lettered **A** | **A** |
| 2 | Dark blue, scowling — lettered **B** | **B** |
| 4 | Purple, wide-eyed and worried — lettered **C** | **C** |
| 3 | Pale, cracked, rainbow burst | **D** |
| 6 | Teal, half-lidded and exhausted | **F** — worst |

The letters are *in the artwork*. The app never prints a rank letter as text; the
picture carries it.

---

## Architecture

Three units, each testable on its own.

```
art/streak-source.png              source PNG — NOT under app/, never published
        │
        │  tools/slice_streak_icons.py   (build time, output committed)
        ▼
app/assets/img/streak/{s,a,b,c,d,f}.webp
        │
        │  app/assets/js/streak.js       (pure: sessions → rank)
        ▼
app/index.html  +  app/assets/js/app.js  (mount, refresh, tap-to-reveal)
```

### 1. `tools/slice_streak_icons.py` — build time only

Follows `build_catalog.py`: run by hand, output committed, no runtime Python.

- Reads `art/streak-source.png`.
- Splits on an even 3×2 grid — 455×384 per tile. Gutters were measured at
  x≈456 and x≈915, y≈383, so an even split is correct; trim **4 px** per edge to
  drop the seam.
- Crops each tile to its centred square, resizes to **400×400**, and applies an
  antialiased circular alpha mask (mask rendered at 4× and downsampled).
- Writes WebP at quality 82 to `app/assets/img/streak/`, named by rank.

**Circle mask, not the square tile.** The tiles have paper-white backgrounds; a
white square on the cream ground reads as a patch of missing page. A disc also
matches what `hero.svg` already draws — concentric rings — so the icon becomes the
planet inside them.

**WebP, not PNG.** Measured on the real artwork: 20 KB per icon versus 284 KB as
PNG, for the same 400 px. All six total 121 KB. WebP with alpha is Safari 14+.

`requirements.txt` gains Pillow. It is a build-time dependency, exactly like
`requests` — nothing in `app/` imports it.

**The source PNG moves out of `app/`.** It currently sits at
`app/assets/img/Gemini_Generated_Image_b31j3gb31j3gb31j.png`, where the Pages
workflow would upload 2.2 MB that no page requests.

### 2. `app/assets/js/streak.js` — the rule

Pure functions. No DOM, no `Date.now()` — today is an argument, so every test is
exact without a fake clock.

```js
export function streakState(sessions, today)
// → { rank: 'S'|'A'|'B'|'C'|'D'|'F',
//     unranked: boolean,   // no completed session has ever happened
//     streak: number,      // current run, in days
//     best: number,        // longest run ever
//     daysSince: number|null }
```

Computation:

1. `completed` — the unique, ascending set of `localDate` values from sessions
   with `status === 'completed'`. **The same fold the calendar does.** One source
   of truth; a second streak counter that can disagree with the squares is a bug
   generator.
2. Empty set → `{ rank: 'B', unranked: true, streak: 0, best: 0, daysSince: null }`.
3. `daysSince` = whole days from the newest completed date to `today`, clamped at
   0 so a device clock moved backwards cannot produce a negative.
4. `streak` = the length of the consecutive run ending at that newest date.
5. `best` = the longest consecutive run anywhere in the set.

Rank:

```
no completed sessions ever          →  B   (unranked — see rendering)
daysSince <= 1 and streak >= 7      →  S
daysSince <= 1 and streak >= 3      →  A
daysSince <= 1                      →  B
daysSince <= 3                      →  C
daysSince <= 7                      →  D
otherwise                           →  F
```

**A finish today or yesterday keeps the streak alive.** Today being unfinished
does not demote anyone until the day is actually over — the same courtesy the
calendar extends by not painting today red in advance.

**Date arithmetic uses local midnights.** Parse `YYYY-MM-DD` with
`new Date(y, m - 1, d)`, never `new Date('2026-08-07')` — the string form parses
as UTC and reintroduces exactly the timezone bug that `localDate` exists to
prevent.

**Day differences round, they do not truncate.** Local days are 23 or 25 hours
long across a DST boundary, so `(b - a) / 86400000` truncated gives 0 for a real
one-day gap in spring and would silently fuse two days into one streak day.
`Math.round` on that quotient is correct for every gap this feature cares about.

### 3. Rendering — `index.html`, `omnia.css`, `app.js`

**Markup.** The `<img>` in `figure.hero` gains a shrink-wrapping wrapper, because
`.hero` carries its own `0.9rem` vertical padding and percentage offsets must
resolve against the image box, not the padded figure.

```html
<figure class="hero">
  <div class="hero__frame">
    <img src="assets/img/hero.svg" alt="" width="1200" height="420" decoding="async">
    <button class="rank" id="rank" type="button" aria-expanded="false">
      <img class="rank__art" src="assets/img/streak/b.webp" alt="" width="400" height="400">
    </button>
  </div>
  <p class="rank__detail" id="rank-detail" hidden></p>
</figure>
```

**Position.** `hero.svg`'s circle is centred at `(900, 210)` of a 1200×420
viewBox — **75% across, 50% down**.

`.hero img` is `width: 100%; max-height: 28vh; object-fit: cover`. The image is
2.857:1, wider than any box this layout produces, so `cover` can only ever crop it
*vertically*, and it crops symmetrically. Horizontal fractions are therefore never
distorted and the vertical centre is fixed by symmetry. So `left: 75%; top: 50%;
transform: translate(-50%, -50%)` pins the icon to the circle at every width, with
no per-breakpoint math and no JS measurement.

**Size.** `width: clamp(96px, 20%, 200px)` with `aspect-ratio: 1`. The percentage
resolves against the image box: ~190 px on desktop, and the 96 px floor catches
phones, where strict proportional sizing would give 77 px.

77 px was tested against the real art and is below where these read. 96 px on a
phone is slightly wider than the inner ring, so the icon sits between the inner
and middle rings — the artwork is itself ringed, so it absorbs this. **Mobile
legibility beats strict ring alignment**; "it must work on mobile" is a stated
requirement and ring geometry is not.

The masthead's `core` wordmark occupies x 80–360 of the viewBox, so the icon at
x 900 never collides with it.

**Unranked.** With no completed session ever, the B icon renders desaturated —
`filter: saturate(0.25) opacity(0.75)` on `.rank.is-unranked .rank__art`. The
first finished routine snaps it to full colour. Without this, no-history and a
one-day streak are both B and the first workout moves nothing; the desaturated
state makes the first finish visible without inventing a seventh icon.

**Refresh.** `app.js` calls the mount/refresh function from `route()`, so
returning from the player after finishing a routine repaints the rank immediately.
The rank is recomputed from `sessions` on every route — it is cheap and it cannot
go stale.

**Tap to reveal.** The button toggles `#rank-detail` and its own `aria-expanded`:

- ranked → `5 day streak · best 12`
- unranked → `No streak yet`
- plus a **Hide** control, which sets `prefs.streakIcon = false`

Default is icon only. The masthead stays free of permanent text, per the
minimal-margins rule.

**Turning it back on.** When `prefs.streakIcon` is false the button is not
rendered, and the calendar view gains one small `type-quiet` link under the month
grid: *Show consistency rank*. The calendar is the screen that is already about
consistency, so this is the one place the control does not read as clutter. This
re-entry point is the only part of the off-switch that adds surface elsewhere; if
we want less, the off-switch is the piece to drop.

**Accessibility.** The button carries the whole state as its `aria-label`
(`Consistency rank S. 5 day streak, best 12.`) and the inner `<img>` is `alt=""`,
so a screen reader gets one labelled control rather than two overlapping
descriptions. The app-wide delegated click handler in `app.js` gives the button
its tap sound with no extra wiring.

**Motion.** A cross-fade when the rank changes, and nothing else. Gated behind
`@media (prefers-reduced-motion: no-preference)` so the rank still changes for
everyone while the motion does not.

---

## Data model

One added preference. No new persisted state.

```jsonc
"prefs": {
  "streakIcon": true      // false hides the badge; streak numbers are unaffected
}
```

`store.js`'s `EMPTY.prefs` gains the default, which the existing `read()` merge
already backfills for users with saved state.

---

## Testing

`tests/streak.test.html`, in the existing style — plain HTML, no runner, no
dependencies, prints PASS/FAIL and a summary line. Because `streakState` takes
`today` as an argument, no fake clock is needed.

Cases:

- No sessions → `unranked`, rank B, streak 0.
- Only `quit` sessions → still unranked. Quit is not a streak day.
- Finished today, streak 1 → B, ranked, not desaturated.
- Finished yesterday, nothing today → still alive, rank by streak length.
- Streak boundaries: 2→B, 3→A, 6→A, 7→S.
- Absence boundaries: `daysSince` 2→C, 3→C, 4→D, 7→D, 8→F.
- Two sessions the same day count as one streak day.
- A quit and a completion on the same day → that day counts (green wins ties,
  matching `dayStatus`).
- `best` exceeds `streak` after a break, and survives it.
- A session dated in the future clamps `daysSince` to 0 rather than going negative.
- A streak spanning a month boundary and a DST change is still contiguous.

---

## Files touched

| File | Change |
|---|---|
| `art/streak-source.png` | new — source PNG moved out of `app/` |
| `tools/slice_streak_icons.py` | new — build-time slicer |
| `requirements.txt` | add Pillow |
| `app/assets/img/streak/{s,a,b,c,d,f}.webp` | new — generated, committed |
| `app/assets/js/streak.js` | new — pure rank computation |
| `app/assets/js/app.js` | mount + refresh on route; hide/show |
| `app/assets/js/calendar.js` | "Show consistency rank" link when hidden |
| `app/assets/js/store.js` | `streakIcon` preference default |
| `app/index.html` | markup, and version `v7.07` → `v7.08` |
| `app/assets/css/omnia.css` | positioning, sizing, unranked filter, cross-fade |
| `app/sw.js` | six WebP added to `PRECACHE` |
| `tests/streak.test.html` | new |
| `CLAUDE.md` | streak rules under "Rules the UI must keep" |
| `ROADMAP.md` | Phase 10 updated to what actually landed |

`CACHE` in `sw.js` is **not** bumped. Same-origin requests are network-first and
the runtime `put` caches the icons on first fetch, so existing installs pick them
up without discarding every cached exercise photograph.

---

## Out of scope

- Any reaction on the completion screen. Phase 10 mentions one; it is a separate
  surface and a separate decision.
- Sound tied to a rank change. Phase 9 owns the second sound pass.
- Sharing, friends, or leaderboards. Phase 13.
- Tracing the icons to SVG. The WebP files are the shipping artwork.
