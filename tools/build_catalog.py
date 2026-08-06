"""Generate Omnia's exercise catalog from free-exercise-db.

Omnia is hosted on GitHub Pages, which serves files and runs nothing, so this
script is a *build-time* tool: it writes ``docs/assets/data/exercises.json``,
that file is committed, and the site reads it as a static asset. Nobody needs
Python to deploy Omnia — only to change what is in the catalog.

Usage
-----
    python tools/build_catalog.py            # write the catalog
    python tools/build_catalog.py --list     # print every id a routine may use
    python tools/build_catalog.py --check    # verify routines.json against it

Source
------
``yuhonas/free-exercise-db``, Unlicense (public domain). The same catalog
Body-Shop uses; Omnia reads the upstream directly at the same pinned commit
rather than depending on a sibling repository.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

# --------------------------------------------------------------------------
# Upstream
# --------------------------------------------------------------------------

#: Pinned, and it must stay pinned. Unpinned, jsDelivr follows the default
#: branch, so an upstream rename silently breaks every image in production
#: with no commit on our side to blame. Bump this one constant and re-run.
PINNED_COMMIT = "b0eed061e1c832b3ed815fbaa4b45b3cdc14df49"

SOURCE_URL = (
    f"https://raw.githubusercontent.com/yuhonas/free-exercise-db/"
    f"{PINNED_COMMIT}/dist/exercises.json"
)
IMAGE_BASE = (
    f"https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@{PINNED_COMMIT}/exercises"
)

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "docs" / "assets" / "data" / "exercises.json"
ROUTINES_PATH = ROOT / "docs" / "assets" / "data" / "routines.json"

# --------------------------------------------------------------------------
# Curation
# --------------------------------------------------------------------------

#: Equipment values that mean "a floor, and nothing else". Upstream leaves the
#: field ``null`` for 77 records rather than writing "none", so ``None`` is a
#: real value here, not an oversight.
ALLOWED_EQUIPMENT = {"body only", "none", None}

#: Upstream's muscle slug for the abdominals. Omnia says "abs" everywhere else,
#: so the value is renamed on the way out and this constant is the only place
#: the upstream spelling appears.
UPSTREAM_ABS = "abdominals"

#: Upstream slug → Omnia slug. Anything unlisted passes through unchanged.
MUSCLE_RENAMES = {UPSTREAM_ABS: "abs"}

#: Movements whose ``primary`` is not ``abs`` but which earn a place in a core
#: routine anyway. The database tags by prime mover, so Mountain Climbers lands
#: under quads and Superman under back — correct by its own logic, wrong for us.
EXTRA_IDS = {
    "Mountain_Climbers",       # tagged quads
    "Superman",                # tagged back  — the posterior half of core work
    "Flutter_Kicks",           # tagged glutes
    "Butt_Lift_Bridge",        # tagged glutes
    "Single_Leg_Glute_Bridge",  # tagged glutes
    "Pelvic_Tilt_Into_Bridge",  # tagged back
}

#: Tagged "body only" upstream, but every one of these needs furniture — a
#: decline bench, an exercise ball, a flat bench, a pull-up bar. Omnia assumes a
#: bedroom floor and nothing more. The equipment tag cannot express this
#: distinction, so the exclusion has to be an explicit list.
EXCLUDED_IDS = {
    "Crunch_-_Legs_On_Exercise_Ball",
    "Decline_Crunch",
    "Decline_Oblique_Crunch",
    "Decline_Reverse_Crunch",
    "Flat_Bench_Leg_Pull-In",
    "Flat_Bench_Lying_Leg_Raise",
    "Seated_Flat_Bench_Leg_Pull-In",
    "Gorilla_Chin_Crunch",
    "Hanging_Leg_Raise",
    "Hanging_Pike",
    "Seated_Leg_Tucks",
    "Wind_Sprints",       # a sprint, not a core hold — wrong for a 10-min floor set
    "Stomach_Vacuum",     # a breathing drill; reads as "nothing happening" on a timer
}

#: Worth doing, absent from the database. They ship with drawn placeholder art
#: rather than being dropped — a 10-minute no-equipment core routine that cannot
#: include a hollow hold or a bird dog is a worse routine. Phase 7 replaces the
#: art with real images.
PLACEHOLDER_EXERCISES = [
    {
        "id": "placeholder-hollow-body-hold",
        "name": "Hollow Body Hold",
        "level": "intermediate",
        "primary": ["abs"],
        "instructions": [
            "Lie on your back with your arms overhead and your legs straight.",
            "Press your lower back flat into the floor.",
            "Lift your shoulders and legs a few inches, making a shallow banana shape.",
            "Hold, and keep breathing. Lower your legs if your back arches.",
        ],
    },
    {
        "id": "placeholder-bird-dog",
        "name": "Bird Dog",
        "level": "beginner",
        "primary": ["abs", "lower back"],
        "instructions": [
            "Start on all fours, hands under shoulders and knees under hips.",
            "Reach one arm forward and the opposite leg back until both are level.",
            "Keep your hips square — do not let them tip.",
            "Return under control and alternate sides.",
        ],
    },
    {
        "id": "placeholder-v-up",
        "name": "V-Up",
        "level": "intermediate",
        "primary": ["abs"],
        "instructions": [
            "Lie flat with your arms overhead and your legs straight.",
            "Lift your arms and legs at the same time, reaching for your toes.",
            "Your body should form a V, balanced on your hips.",
            "Lower under control, and repeat.",
        ],
    },
    {
        "id": "placeholder-windshield-wipers",
        "name": "Windshield Wipers",
        "level": "intermediate",
        "primary": ["abs"],
        "instructions": [
            "Lie on your back with your arms out wide and your legs up over your hips.",
            "Keeping your shoulders down, lower both legs to one side.",
            "Stop before your legs touch the floor, then sweep to the other side.",
            "Move slowly — the control is the point.",
        ],
    },
    {
        "id": "placeholder-plank-shoulder-taps",
        "name": "Plank Shoulder Taps",
        "level": "intermediate",
        "primary": ["abs"],
        "instructions": [
            "Start in a high plank with your hands under your shoulders.",
            "Set your feet wide for a steadier base.",
            "Tap one hand to the opposite shoulder without letting your hips rock.",
            "Alternate hands, staying square the whole time.",
        ],
    },
]


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------


def fetch_source() -> list[dict]:
    """Download the pinned upstream catalog."""
    print(f"  fetching {SOURCE_URL}")
    try:
        with urllib.request.urlopen(SOURCE_URL, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        sys.exit(
            f"error: could not reach free-exercise-db ({exc}).\n"
            f"       docs/assets/data/exercises.json is committed, so the site "
            f"still works — this only blocks regenerating it."
        )


def keep(record: dict) -> bool:
    """Whether a record belongs in Omnia's no-equipment core catalog."""
    if record["id"] in EXCLUDED_IDS:
        return False
    if record.get("equipment") not in ALLOWED_EQUIPMENT:
        return False
    primary = record.get("primaryMuscles") or []
    return UPSTREAM_ABS in primary or record["id"] in EXTRA_IDS


def transform(record: dict) -> dict:
    """Upstream record → the shape the browser reads.

    Trimmed deliberately: the site ships one JSON file over a phone connection,
    and the fields dropped here are ones no screen renders.
    """
    return {
        "id": record["id"],
        "name": record["name"],
        "level": record.get("level") or "beginner",
        "primary": [
            MUSCLE_RENAMES.get(m, m) for m in (record.get("primaryMuscles") or [])
        ],
        "images": [f"{IMAGE_BASE}/{path}" for path in (record.get("images") or [])],
        "instructions": record.get("instructions", []),
        "placeholder": False,
    }


def build() -> dict:
    source = fetch_source()
    print(f"  {len(source)} exercises upstream")

    kept = sorted(
        (transform(r) for r in source if keep(r)),
        key=lambda e: e["name"],
    )
    print(f"  {len(kept)} kept after curation")

    placeholders = [
        {**entry, "images": [], "placeholder": True} for entry in PLACEHOLDER_EXERCISES
    ]
    print(f"  {len(placeholders)} placeholders added")

    return {
        "source": "https://github.com/yuhonas/free-exercise-db",
        "sourceCommit": PINNED_COMMIT,
        "license": "Unlicense (public domain)",
        "imageBase": IMAGE_BASE,
        "generatedBy": "tools/build_catalog.py",
        "exercises": kept + sorted(placeholders, key=lambda e: e["name"]),
    }


def check_routines(catalog: dict) -> int:
    """Verify every id referenced by routines.json exists. Returns exit code."""
    if not ROUTINES_PATH.exists():
        print(f"  {ROUTINES_PATH.name} not found — nothing to check")
        return 0

    known = {e["id"] for e in catalog["exercises"]}
    routines = json.loads(ROUTINES_PATH.read_text(encoding="utf-8"))["routines"]

    missing = [
        (routine["id"], ex_id)
        for routine in routines
        for ex_id in routine["exercises"]
        if ex_id not in known
    ]
    if missing:
        for routine_id, ex_id in missing:
            print(f"  MISSING  {routine_id} → {ex_id}")
        return 1

    total = sum(len(r["exercises"]) for r in routines)
    print(f"  OK — {len(routines)} routines, {total} slots, all ids resolve")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="print every usable id")
    parser.add_argument("--check", action="store_true", help="validate routines.json")
    args = parser.parse_args()

    print("Omnia — building exercise catalog")
    catalog = build()

    if args.list:
        print(f"\n{'id':<40} {'level':<13} name")
        print("-" * 84)
        for exercise in catalog["exercises"]:
            marker = "  [placeholder]" if exercise["placeholder"] else ""
            print(
                f"{exercise['id']:<40} {exercise['level']:<13} "
                f"{exercise['name']}{marker}"
            )
        return 0

    if args.check:
        return check_routines(catalog)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"  wrote {OUT_PATH.relative_to(ROOT)} ({size_kb:.0f} KB)")
    return check_routines(catalog)


if __name__ == "__main__":
    raise SystemExit(main())
