# Omnia

Ten minutes of core work, every day.

Pick a routine, follow the timer, keep the calendar green. Built for high
schoolers, and built to open on a phone in a bedroom before school.

**Justin Li & Owen Zhang — Track c/o 2026**

---

## Run it

There is no build step.

```bash
python -m http.server 8000 --directory docs
```

Then open <http://localhost:8000>.

## Deploy it

Push to `main`. In the repository's **Settings → Pages**, set the source to
`main` and the folder to `/docs`. That is the entire pipeline — GitHub Pages
serves `docs/` as static files, so a push is a deploy.

## What's in here

```
docs/          the app — this is what GitHub Pages serves
tools/         build_catalog.py, which regenerates the exercise data
tests/         browser tests for the timer and calendar rules
ROADMAP.md     phases, done and planned
CLAUDE.md      the details worth knowing before changing anything
```

## Test it

Serve the repository root and open the two pages — no runner, no dependencies.

```bash
python -m http.server 8000
# http://localhost:8000/tests/timer.test.html
# http://localhost:8000/tests/store.test.html
```

## Exercise data

Movements and photographs come from
[`yuhonas/free-exercise-db`](https://github.com/yuhonas/free-exercise-db)
(Unlicense, public domain), pinned to one commit and curated down to
floor-based, no-equipment core work. Images are served from jsDelivr at that
same commit.

To change what's in the catalog, edit the curation lists in
`tools/build_catalog.py` and re-run it:

```bash
python tools/build_catalog.py           # regenerate
python tools/build_catalog.py --list    # every id a routine may reference
python tools/build_catalog.py --check   # validate routines.json
```

The generated file is committed, so nobody needs Python to deploy.

## Stack

Tailwind 4 and daisyUI 5, loaded from a CDN — no `npm install`, no bundler.
Python is a build-time tool only; GitHub Pages runs no server code. Supabase
arrives in Phase 9 and is reached from the browser, so Pages stays sufficient.

See [ROADMAP.md](ROADMAP.md) for what's next.
