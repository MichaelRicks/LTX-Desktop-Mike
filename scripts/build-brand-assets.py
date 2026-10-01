"""Generate every RiX brand asset from the artwork in brand/source/.

The source art is flat RGB (no alpha), so this script keys the backgrounds out
and derives the light/dark variants rather than shipping the raw renders:

  brand/source/rix-appicon-thick.webp  -> resources/icon.{png,ico,icns}
                                          resources/icons/*.png   (linux)
  brand/source/rix-lockup-on-cream.webp -> public/brand/rix-{mark,wordmark,lockup}*.png
  brand/source/rix-mark-gold-on-black.webp -> public/brand/rix-mark-gold*.png

Run from the repo root:

    backend/.venv/Scripts/python scripts/build-brand-assets.py      # Windows
    backend/.venv/bin/python scripts/build-brand-assets.py          # macOS/Linux

Only needs Pillow, which backend/pyproject.toml already depends on.
"""

from __future__ import annotations

import struct
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "brand" / "source"
RESOURCES = ROOT / "resources"
PUBLIC_BRAND = ROOT / "public" / "brand"

# The cream the lockup was rendered on, and the ink/accent it was drawn in.
CREAM = (254, 248, 243)
GOLD = (198, 146, 60)

# Below this max-channel distance from the background a pixel is fully
# transparent; above it, fully opaque. The band in between is the artwork's
# own antialiasing, which we turn into partial alpha.
KEY_SOFT = 0.06
KEY_HARD = 0.26


def _chan_distance(px: tuple[int, int, int], bg: tuple[int, int, int]) -> float:
    return max(abs(px[i] - bg[i]) for i in range(3)) / 255.0


def key_background(img: Image.Image, bg: tuple[int, int, int]) -> Image.Image:
    """Replace a known flat background with alpha, keeping edge antialiasing."""
    rgb = img.convert("RGB")
    out = Image.new("RGBA", rgb.size)
    src, dst = rgb.load(), out.load()
    width, height = rgb.size
    span = KEY_HARD - KEY_SOFT
    for y in range(height):
        for x in range(width):
            px = src[x, y]
            d = _chan_distance(px, bg)
            if d <= KEY_SOFT:
                dst[x, y] = (0, 0, 0, 0)
            elif d >= KEY_HARD:
                dst[x, y] = (*px, 255)
            else:
                dst[x, y] = (*px, int(round(255 * (d - KEY_SOFT) / span)))
    return out


def ink_to_white(img: Image.Image) -> Image.Image:
    """Recolour the neutral ink to white, leaving the gold accent alone.

    Saturation separates the two: the ink and its antialiased edges are grey,
    the accent is not. Alpha already carries edge coverage, so the edge pixels
    can take the solid ink colour.
    """
    out = img.copy()
    px = out.load()
    width, height = out.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if max(r, g, b) - min(r, g, b) < 46:
                px[x, y] = (255, 255, 255, a)
    return out


def trim(img: Image.Image) -> Image.Image:
    box = img.getchannel("A").getbbox()
    return img.crop(box) if box else img


def fit_height(img: Image.Image, height: int) -> Image.Image:
    width = max(1, round(img.width * height / img.height))
    return img.resize((width, height), Image.LANCZOS)


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print(f"  {path.relative_to(ROOT).as_posix():<46} {img.width}x{img.height}")


# ---------------------------------------------------------------- app icon


def build_icon_master() -> Image.Image:
    """The rounded-square app icon with its corners knocked out to alpha.

    The square bleeds to all four edges of the source, so the only white is in
    the four corner cut-outs: flood fill inward from each corner to find them
    instead of keying every white pixel (the mark itself is white).
    """
    img = Image.open(SRC / "rix-appicon-thick.webp").convert("RGB")
    width, height = img.size

    # 255 = candidate background, 0 = artwork.
    light = img.convert("L").point(lambda v: 255 if v > 190 else 0)
    outside = Image.new("L", (width, height), 0)
    marker = light.copy()
    for corner in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        if marker.getpixel(corner) == 255:
            ImageDraw.floodfill(marker, corner, 128, thresh=0)
    mp, op = marker.load(), outside.load()
    for y in range(height):
        for x in range(width):
            if mp[x, y] == 128:
                op[x, y] = 255

    alpha = Image.eval(outside, lambda v: 255 - v)
    icon = img.convert("RGBA")
    icon.putalpha(alpha)
    # Supersample down from 1408 -> 1024 so the corner alpha lands antialiased.
    return icon.resize((1024, 1024), Image.LANCZOS)


def write_icns(master: Image.Image, path: Path) -> None:
    """Write a PNG-backed .icns.

    Pillow can only save ICNS where macOS' iconutil exists, and the builds run
    on Windows, so emit the container directly. Every modern OS type below
    accepts an embedded PNG payload.
    """
    types = {
        b"ic07": 128,
        b"ic08": 256,
        b"ic09": 512,
        b"ic10": 1024,
        b"ic11": 32,
        b"ic12": 64,
        b"ic13": 256,
        b"ic14": 512,
    }
    chunks = []
    for ostype, size in types.items():
        buf = BytesIO()
        master.resize((size, size), Image.LANCZOS).save(buf, format="PNG", optimize=True)
        data = buf.getvalue()
        chunks.append(ostype + struct.pack(">I", len(data) + 8) + data)
    body = b"".join(chunks)
    path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)
    print(f"  {path.relative_to(ROOT).as_posix():<46} {len(types)} sizes")


# At 16px a LANCZOS downsample of the mark turns to grey mush — the sprocket
# holes, the counter and the box all blur into each other at a size that only
# has ~12px of drawing area. This is the same mark redrawn straight onto the
# pixel grid: the box is dropped, and the R and the film strip are squared up
# so every edge lands on a whole pixel. '#' is ink, '.' is the plate.
PIXEL_ICON_16 = (
    "................",
    "................",
    "..############..",
    "..#.##########..",
    "..####.....###..",
    "..#.##.....####.",
    "..####.....###..",
    "..#.########....",
    "..##########....",
    "..####.###......",
    "..####..###.....",
    "..####...###....",
    "..####....###...",
    "..####.....###..",
    "................",
    "................",
)


def render_pixel_icon(grid: tuple[str, ...], plate: tuple[int, int, int], radius: int = 3) -> Image.Image:
    """Rasterise a hand-authored grid, aliased, one cell per pixel."""
    size = len(grid)
    silhouette = Image.new("L", (size, size), 0)
    ImageDraw.Draw(silhouette).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = out.load()
    for y in range(size):
        for x in range(size):
            if silhouette.getpixel((x, y)):
                px[x, y] = (255, 255, 255, 255) if grid[y][x] == "#" else (*plate, 255)
    return out


# As drawn, the R fills only ~48% of the square, which reads as a speck once
# the icon is down at taskbar sizes. Rescale it inside the same silhouette, and
# go tighter again for the small entries — the usual per-size optical sizing.
ICON_SCALE = 0.70
ICON_SCALE_SMALL = 0.78
SMALL_ICON_MAX = 48


def tighten(master: Image.Image, scale: float) -> Image.Image:
    """Rescale the mark inside the icon's rounded square, leaving it centred."""
    size = master.width
    px = master.load()
    ink = Image.new("L", master.size, 0)
    ip = ink.load()
    for y in range(size):
        for x in range(size):
            r, g, b, a = px[x, y]
            if a > 200 and min(r, g, b) > 170:
                ip[x, y] = 255
    box = ink.getbbox()
    if box is None:
        return master

    # The crop is the mark plus the flat black around it, so it drops onto the
    # black square seamlessly — the interior cut-outs come along with it.
    crop = master.crop(box).convert("RGB")
    target = size * scale
    ratio = min(target / crop.width, target / crop.height)
    crop = crop.resize(
        (max(1, round(crop.width * ratio)), max(1, round(crop.height * ratio))),
        Image.LANCZOS,
    )

    plate = Image.new("RGB", master.size, plate_colour(master))
    plate.paste(crop, ((size - crop.width) // 2, (size - crop.height) // 2))
    out = plate.convert("RGBA")
    out.putalpha(master.getchannel("A"))
    return out


def plate_colour(master: Image.Image) -> tuple[int, int, int]:
    """The icon's background black, sampled just inside the top edge."""
    return master.convert("RGB").getpixel((master.width // 2, 6))


def build_app_icons() -> None:
    print("app icon:")
    master = tighten(build_icon_master(), ICON_SCALE)
    small = tighten(build_icon_master(), ICON_SCALE_SMALL)

    pixel_16 = render_pixel_icon(PIXEL_ICON_16, plate_colour(master))

    def at(size: int) -> Image.Image:
        if size == 16:
            return pixel_16
        source = small if size <= SMALL_ICON_MAX else master
        return source.resize((size, size), Image.LANCZOS)

    save(master, RESOURCES / "icon.png")

    # Resize per size rather than letting Pillow do it inside the .ico, so each
    # entry gets a proper LANCZOS downsample off the right master.
    ico_sizes = (16, 24, 32, 48, 64, 128, 256)
    frames = [at(s) for s in ico_sizes]
    frames[-1].save(
        RESOURCES / "icon.ico",
        format="ICO",
        sizes=[(s, s) for s in ico_sizes],
        append_images=frames[:-1],
    )
    print(f"  {(RESOURCES / 'icon.ico').relative_to(ROOT).as_posix():<46} {list(ico_sizes)}")

    write_icns(master, RESOURCES / "icon.icns")

    for size in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        save(at(size), RESOURCES / "icons" / f"{size}x{size}.png")


# ------------------------------------------------------------------ lockups

# Row bands in rix-lockup-on-cream.webp: the mark, the RIX wordmark, and the
# rule-flanked tagline. Measured off the source's ink profile.
BAND_MARK = (150, 665)
BAND_WORDMARK = (685, 905)
BAND_FULL = (150, 985)


def build_lockups() -> None:
    print("lockups:")
    keyed = key_background(Image.open(SRC / "rix-lockup-on-cream.webp"), CREAM)
    light = keyed
    dark = ink_to_white(keyed)

    pieces = {
        "rix-mark": (dark, BAND_MARK, 512),
        "rix-wordmark": (dark, BAND_WORDMARK, 256),
        "rix-lockup": (dark, BAND_FULL, 1024),
        "rix-lockup-light": (light, BAND_FULL, 1024),
    }
    for name, (source, (top, bottom), height) in pieces.items():
        art = trim(source.crop((0, top, source.width, bottom)))
        save(fit_height(art, height), PUBLIC_BRAND / f"{name}@2x.png")
        save(fit_height(art, height // 2), PUBLIC_BRAND / f"{name}.png")

    # The standalone mark with its gradient and gold, keyed off black. Every
    # near-black pixel goes transparent, including the sprocket holes and the
    # counter of the R, which are meant to read as holes.
    gold_src = Image.open(SRC / "rix-mark-gold-on-black.webp").convert("RGB")
    gold = key_background(gold_src, (0, 0, 0))
    gold = trim(gold)
    save(fit_height(gold, 512), PUBLIC_BRAND / "rix-mark-gold@2x.png")
    save(fit_height(gold, 256), PUBLIC_BRAND / "rix-mark-gold.png")


if __name__ == "__main__":
    build_app_icons()
    build_lockups()
    print(f"\nGold accent: #{GOLD[0]:02X}{GOLD[1]:02X}{GOLD[2]:02X}")
