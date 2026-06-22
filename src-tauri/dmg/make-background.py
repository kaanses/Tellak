#!/usr/bin/env python3
"""
Generates the Tellak DMG installer background.

Output: src-tauri/dmg/background.png at 2x (1400x960). Tauri displays it in a
700x480 volume window, so the 2x source stays crisp on Retina. Re-run after
changing copy/layout:  python3 src-tauri/dmg/make-background.py
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

S = 2                      # retina scale
W, H = 700 * S, 480 * S    # 1400 x 960

CREAM       = (245, 237, 214)
AMBER       = (212, 146, 10)
BASE        = (21, 11, 0)      # #150b00
GLOW        = (45, 21, 0)      # #2d1500

GEORGIA_IT = "/System/Library/Fonts/Supplemental/Georgia Italic.ttf"
SF         = "/System/Library/Fonts/SFNS.ttf"


def font(path, size):
    return ImageFont.truetype(path, size * S)


def rgba(c, a):
    return (c[0], c[1], c[2], int(a * 255))


def text_center(draw, cx, y, s, fnt, fill, tracking=0):
    """Draw horizontally-centered text, optional letter-spacing (1x px)."""
    if tracking == 0:
        w = draw.textlength(s, font=fnt)
        draw.text((cx - w / 2, y * S), s, font=fnt, fill=fill)
        return
    tr = tracking * S
    widths = [draw.textlength(ch, font=fnt) for ch in s]
    total = sum(widths) + tr * (len(s) - 1)
    x = cx - total / 2
    for ch, w in zip(s, widths):
        draw.text((x, y * S), ch, font=fnt, fill=fill)
        x += w + tr


# ── Base + radial glow ────────────────────────────────────────────────────────
img = Image.new("RGB", (W, H), BASE)

glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([W * 0.5 - 520 * S, -260 * S, W * 0.5 + 520 * S, 360 * S],
           fill=rgba(GLOW, 0.9))
glow = glow.filter(ImageFilter.GaussianBlur(150 * S))
img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")

draw = ImageDraw.Draw(img, "RGBA")

# ── Copy ──────────────────────────────────────────────────────────────────────
cx = W / 2
text_center(draw, cx, 44, "SON BİR ADIM", font(SF, 12), rgba(AMBER, 0.9), tracking=5)
text_center(draw, cx, 64, "Tellak'ı yüklemek için", font(GEORGIA_IT, 30), rgba(CREAM, 0.92))
text_center(draw, cx, 112, "uygulamayı Uygulamalar klasörüne sürükleyin",
            font(SF, 14), rgba(CREAM, 0.42))

# ── Arrow (amber, glowing) between the two icon slots ─────────────────────────
# Icon centers sit at y=250 (1x). Arrow runs through that line in the gap.
ay = 250 * S
# Shaft span (1x points). Tail = x0, head base = x1; ARROW_X0/ARROW_X1 env
# vars override each end for live tuning. Final values live in the defaults.
_x0 = int(os.environ.get("ARROW_X0", "270"))  # tail — centered in the icon gap
_x1 = int(os.environ.get("ARROW_X1", "396"))  # head base (tip at +34 -> 430)
x0, x1 = _x0 * S, _x1 * S
shaft_h = 11 * S
head_w, head_hh = 34 * S, 27 * S  # arrowhead width / half-height

arrow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ad = ImageDraw.Draw(arrow)
ad.rounded_rectangle([x0, ay - shaft_h / 2, x1, ay + shaft_h / 2],
                     radius=shaft_h / 2, fill=rgba(AMBER, 1.0))
ad.polygon([(x1 - 2 * S, ay - head_hh), (x1 + head_w, ay), (x1 - 2 * S, ay + head_hh)],
           fill=rgba(AMBER, 1.0))

# Soft glow behind the arrow
arrow_glow = arrow.filter(ImageFilter.GaussianBlur(10 * S))
img = Image.alpha_composite(img.convert("RGBA"), arrow_glow)
img = Image.alpha_composite(img, arrow).convert("RGB")

out = os.path.join(os.path.dirname(__file__), "background.png")
# Save at 144 DPI so macOS maps the 1400x960 px image to a 700x480 PT background
# (pixels * 72 / dpi). Without this, Finder treats it as 72 DPI -> 1400 pt wide
# -> the image overflows the 700 pt window and anchors off-center to the right.
img.save(out, "PNG", dpi=(144, 144))
print("wrote", out, img.size, "@144dpi -> 700x480pt")
