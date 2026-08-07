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
