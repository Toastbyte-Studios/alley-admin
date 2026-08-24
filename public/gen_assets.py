"""
Generate Alley Admin's PNG assets from the badge logo geometry.

The mark is defined once here in the same 64-unit coordinate space used by
Logo.astro and favicon.svg, so the raster assets can't drift from the SVG.

App icons are full-bleed: no rounded corners are baked in, because iOS and
Android apply their own mask. The mark is inset to sit inside the maskable
safe zone so nothing clips when Android rounds it aggressively.

Usage:
    python gen_assets.py [--font-dir DIR] [--out-dir DIR]

The font directory should contain Archivo-400.ttf, Archivo-700.ttf, and
Archivo-800.ttf.  It can also be supplied via the FONT_DIR environment
variable.  The output directory defaults to the directory of this script and
can be overridden with --out-dir or the OUT_DIR environment variable.
"""

import argparse
import os
import sys

import cairosvg
from PIL import Image, ImageDraw, ImageFont

TEAL = "#0e7c77"
CREAM = "#f7f3ea"
RED = "#c8443c"
PAPER = "#fbf7f0"
INK = "#1b1815"
MUTED = "#6b6357"

BALL = (32, 10, 6.5)
PINS = [
    (32, 23.5),
    (24, 34.5),
    (40, 34.5),
    (16, 45.5),
    (32, 45.5),
    (48, 45.5),
    (8, 56.5),
    (56, 56.5),
]
PIN_R = 4.2


def _resolve_font_dir(cli_value: str | None) -> str:
    font_dir = cli_value or os.environ.get("FONT_DIR", "")
    if not font_dir:
        sys.exit(
            "error: font directory not specified.\n"
            "Pass --font-dir DIR or set the FONT_DIR environment variable.\n"
            "The directory must contain Archivo-400.ttf, Archivo-700.ttf, "
            "and Archivo-800.ttf."
        )
    return font_dir


def _font(font_dir: str, weight: str) -> str:
    path = os.path.join(font_dir, f"Archivo-{weight}.ttf")
    if not os.path.isfile(path):
        sys.exit(f"error: font file not found: {path}")
    return path


def mark_svg(scale=0.78, bg=None, pin=CREAM, ball=RED, rx=None):
    """Badge mark as an SVG string in a 64x64 box."""
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">']
    if bg:
        corner = f' rx="{rx}"' if rx else ""
        parts.append(f'<rect width="64" height="64"{corner} fill="{bg}"/>')
    parts.append(
        f'<g transform="translate(32,32) scale({scale}) translate(-32,-32)">'
    )
    parts.append(
        f'<circle cx="{BALL[0]}" cy="{BALL[1]}" r="{BALL[2]}" fill="{ball}"/>'
    )
    for cx, cy in PINS:
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="{PIN_R}" fill="{pin}"/>')
    parts.append("</g></svg>")
    return "".join(parts)


def render(svg, size):
    import io

    png = cairosvg.svg2png(
        bytestring=svg.encode(), output_width=size, output_height=size
    )
    return Image.open(io.BytesIO(png)).convert("RGBA")


def app_icon(size, path):
    """Full-bleed square icon; platforms supply their own corner mask."""
    img = render(mark_svg(scale=0.72, bg=TEAL), size)
    img.convert("RGB").save(path, "PNG", optimize=True)
    print(f"{path}  {size}x{size}")


def og_image(path, font_dir):
    """1200x630 social card matching the site's light theme."""
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), PAPER)
    draw = ImageDraw.Draw(img)

    # Foul-line stripe: teal to strike red, same as the CTA card's top edge
    for x in range(W):
        t = x / W
        r = int(0x0E + (0xC8 - 0x0E) * t)
        g = int(0x7C + (0x44 - 0x7C) * t)
        b = int(0x77 + (0x3C - 0x77) * t)
        draw.line([(x, 0), (x, 7)], fill=(r, g, b))

    # Mark, rounded here since this one isn't masked by a platform
    badge = render(mark_svg(scale=0.78, bg=TEAL, rx=14), 208)
    img.paste(badge, (96, 212), badge)

    title = ImageFont.truetype(_font(font_dir, "800"), 96)
    tag = ImageFont.truetype(_font(font_dir, "700"), 27)
    body = ImageFont.truetype(_font(font_dir, "400"), 30)

    x = 352
    draw.text((x, 182), "Alley Admin", font=title, fill=INK)
    draw.text(
        (x, 302),
        "LEAGUE MANAGEMENT REIMAGINED",
        font=tag,
        fill=RED,
    )
    draw.text(
        (x, 364),
        "Rosters, digital scorekeeping, USBC-compliant\nhandicaps, standings and brackets \u2014 in one app.",
        font=body,
        fill=MUTED,
        spacing=12,
    )

    img.save(path, "PNG", optimize=True)
    print(f"{path}  {W}x{H}")


def main():
    parser = argparse.ArgumentParser(
        description="Generate Alley Admin PNG assets from the badge logo geometry."
    )
    parser.add_argument(
        "--font-dir",
        default=None,
        help="Directory containing Archivo-{400,700,800}.ttf (overrides FONT_DIR env var).",
    )
    parser.add_argument(
        "--out-dir",
        default=None,
        help="Output directory for generated PNG files (overrides OUT_DIR env var; "
        "defaults to the directory of this script).",
    )
    args = parser.parse_args()

    font_dir = _resolve_font_dir(args.font_dir)
    out = args.out_dir or os.environ.get("OUT_DIR") or os.path.dirname(os.path.abspath(__file__))

    app_icon(192, os.path.join(out, "icon-192.png"))
    app_icon(512, os.path.join(out, "icon-512.png"))
    app_icon(180, os.path.join(out, "apple-touch-icon.png"))
    og_image(os.path.join(out, "og-image.png"), font_dir)


if __name__ == "__main__":
    main()
