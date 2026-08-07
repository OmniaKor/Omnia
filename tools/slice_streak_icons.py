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

from PIL import Image

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

#: Paper-keying ramp, measured off this sheet: bare paper reads about
#: (245, 246, 240) and the washes start well below that. Both ends are
#: anchored so real paper reaches a full 255 and disappears completely —
#: a ramp that merely gets close leaves a haze the crop cannot trim.
PAPER_LO, PAPER_HI = 190, 235
#: How much colour a pixel may carry and still be paper. The sheet is very
#: slightly warm, so this is not zero.
NEUTRAL_LO, NEUTRAL_HI = 10, 46
#: How paper-ish a pixel must be for the flood fill to cross it. Lower than
#: full paper so the fill can travel through the soft edge of a wash.
REACH = 70

#: Longest edge of the written icon. Downscale only — the tiles are about
#: 447px wide and upscaling a watercolour buys nothing but bytes.
LONG_EDGE = 440
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


def paperness(pixel: tuple[int, int, int]) -> int:
    """How much a pixel looks like blank paper, 0 (paint) to 255 (bare sheet).

    Paper is bright *and* near-neutral. Both conditions are needed: the pale
    planets and the white stars are bright too, and testing brightness alone
    would dissolve them.
    """
    r, g, b = pixel
    low, high = min(r, g, b), max(r, g, b)
    bright = (low - PAPER_LO) / (PAPER_HI - PAPER_LO)
    neutral = 1.0 - (high - low - NEUTRAL_LO) / (NEUTRAL_HI - NEUTRAL_LO)
    return max(0, min(255, round(255 * min(bright, neutral))))


def cutout(img: Image.Image) -> Image.Image:
    """Key the paper background to transparency and crop to what is left.

    The painted edge of each planet is a watercolour fade, not an outline, and
    it is the nicest thing about the artwork — so the alpha is a *ramp* over
    paperness rather than a threshold. Where the wash thins out, the pixels go
    correspondingly transparent and the edge dissolves into the cream ground
    exactly as it does into the paper.

    Only paper reachable from the border is removed, found by flood fill. The
    white stars and the pale planets are bright and neutral too; they survive
    because they are enclosed by paint, so the fill never arrives.
    """
    rgb = img.convert("RGB")
    width, height = rgb.size
    px = rgb.load()

    paper = bytearray(width * height)
    for y in range(height):
        row = y * width
        for x in range(width):
            paper[row + x] = paperness(px[x, y])

    # Flood fill inwards from every edge pixel, crossing anything paper-ish.
    # A generous threshold here only widens the *search*; how transparent each
    # pixel ends up is still decided by its own paperness below.
    outside = bytearray(width * height)
    stack = [(x, 0) for x in range(width)]
    stack += [(x, height - 1) for x in range(width)]
    stack += [(0, y) for y in range(height)]
    stack += [(width - 1, y) for y in range(height)]

    while stack:
        x, y = stack.pop()
        i = y * width + x
        if outside[i] or paper[i] < REACH:
            continue
        outside[i] = 1
        if x > 0:
            stack.append((x - 1, y))
        if x < width - 1:
            stack.append((x + 1, y))
        if y > 0:
            stack.append((x, y - 1))
        if y < height - 1:
            stack.append((x, y + 1))

    alpha = Image.new("L", (width, height))
    alpha.putdata([255 - paper[i] if outside[i] else 255
                   for i in range(width * height)])

    out = rgb.convert("RGBA")
    out.putalpha(alpha)

    # Crop to the paint. The tiles carry uneven margins of blank sheet, and
    # keeping them would make one planet float higher in the banner than the
    # next for no reason anybody could see.
    box = out.getbbox()
    if box:
        out = out.crop(box)

    # Fit inside a box rather than forcing a square: these are irregular
    # washes, and squashing them to a common aspect ratio would be visible.
    out.thumbnail((LONG_EDGE, LONG_EDGE), Image.LANCZOS)
    return out


def build() -> None:
    if not SOURCE.exists():
        sys.exit(f"missing source sheet: {SOURCE}")

    sheet = Image.open(SOURCE).convert("RGBA")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for number, rank in RANK_BY_TILE.items():
        path = OUT_DIR / f"{rank.lower()}.webp"
        icon = cutout(tile(sheet, number))
        icon.save(path, "WEBP", quality=QUALITY, method=6)
        print(f"  {rank}  tile {number}  →  {path.relative_to(ROOT)}"
              f"  {icon.size[0]}x{icon.size[1]}"
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
            if max(img.size) > LONG_EDGE:
                problems.append(
                    f"{path.relative_to(ROOT)} is {img.size}; its long edge "
                    f"must not exceed {LONG_EDGE}"
                )
            if img.getbbox() != (0, 0, *img.size):
                problems.append(
                    f"{path.relative_to(ROOT)} has transparent margins; it "
                    f"was not cropped to the paint"
                )
            if img.mode != "RGBA":
                problems.append(
                    f"{path.relative_to(ROOT)} is {img.mode}, not RGBA — the "
                    f"paper was not keyed out"
                )

    if problems:
        for problem in problems:
            print(problem, file=sys.stderr)
        sys.exit(1)
    print(f"all {len(RANK_BY_TILE)} icons present, long edge {LONG_EDGE}, RGBA")


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
