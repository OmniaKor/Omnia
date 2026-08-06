# Omnia

Ten minutes of core work, every day.

Pick a routine, follow the timer, keep the calendar green. Built for high
schoolers, and built to open on a phone in a bedroom before school.

**Justin Li & Owen Zhang — Track c/o 2026**

---

## Run it

```bash
python serve.py
```

Serves the app and opens a browser. No build step, no `pip install` — it is
standard library only.

| | |
|---|---|
| `python serve.py` | the app, at <http://localhost:8000> |
| `python serve.py --tests` | opens both test pages |
| `python serve.py --lan` | also reachable from your phone on the same Wi-Fi |
| `python serve.py --port 3000` | if 8000 is taken |

`serve.py` is a development convenience, not a backend — Omnia has no server
code. Any static server works just as well:
`python -m http.server 8000 --directory app`.

Don't open `app/index.html` directly from the file system; browsers block ES
modules and `fetch()` on `file://`, so the catalog never loads.

## Deploy it

Push to `main`. The workflow in `.github/workflows/pages.yml` uploads `app/` to
GitHub Pages — a push is a deploy, and there is no build step.

One-time setup: **Settings → Pages → Source → GitHub Actions**.

## What's in here

```
app/           the app — this is what GitHub Pages serves
tools/         build_catalog.py, which regenerates the exercise data
tests/         browser tests for the timer and calendar rules
ROADMAP.md     phases, done and planned
CLAUDE.md      the details worth knowing before changing anything
```

## Test it

```bash
python serve.py --tests
```

Opens both test pages. No runner, no dependencies — each prints PASS/FAIL lines
and a summary. They cover the timer's interval rules and the calendar's colour
rules; both are product decisions, so they are pinned rather than eyeballed.

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

Tailwind 4 and daisyUI 5, loaded from a CDN — no `npm install`, no bundler. The
Pages workflow uploads `app/` verbatim; it compiles nothing. Python is a
build-time tool only; GitHub Pages runs no server code. Supabase arrives in
Phase 9 and is reached from the browser, so Pages stays sufficient.

See [ROADMAP.md](ROADMAP.md) for what's next.
