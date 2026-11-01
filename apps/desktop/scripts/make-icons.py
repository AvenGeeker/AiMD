"""Generate the aiMarkdown app and tray icons.

The app icon is a deterministic vector-like composition rendered with Pillow at 2x and
downsampled for crisp macOS/Taskbar edges: a blue squircle, layered paper, an M mark and an AI
sparkle. Tray images stay monochrome on macOS so the system can invert them automatically.
"""

from __future__ import annotations

import base64
import math
import pathlib
import re

from PIL import Image, ImageDraw, ImageFilter

OUT = pathlib.Path(__file__).resolve().parent.parent / 'resources'
OUT.mkdir(exist_ok=True)

S = 1024
SS = 2
C = S * SS

BLUE_TOP = (103, 126, 247)
BLUE_BOTTOM = (55, 71, 190)
BLUE_MARK = (63, 83, 218)
PAPER = (248, 250, 255)
PAPER_EDGE = (218, 225, 246)
PAPER_LINE = (220, 227, 246)


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    img = Image.new('RGB', (1, size))
    px = img.load()
    for y in range(size):
        t = y / max(1, size - 1)
        px[0, y] = tuple(lerp(top[i], bottom[i], t) for i in range(3))
    return img.resize((size, size))


def rounded_mask(size: int, inset: int, radius: int) -> Image.Image:
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (inset, inset, size - inset, size - inset), radius=radius, fill=255
    )
    return mask


def with_alpha(color: tuple[int, int, int], alpha: int) -> tuple[int, int, int, int]:
    return (*color, alpha)


def draw_round_line(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[int, int]],
    width: int,
    fill: tuple[int, int, int, int],
) -> None:
    """Draw a rounded polyline with clearly rounded caps."""
    draw.line(points, fill=fill, width=width, joint='curve')
    radius = width // 2
    for x, y in (points[0], points[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def star_points(cx: float, cy: float, outer: float, inner: float) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for index in range(8):
        angle = -math.pi / 2 + index * math.pi / 4
        radius = outer if index % 2 == 0 else inner
        points.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
    return points


def app_icon() -> Image.Image:
    canvas = Image.new('RGBA', (C, C), (0, 0, 0, 0))

    inset = 62 * SS
    radius = 230 * SS
    squircle = rounded_mask(C, inset, radius)

    # Soft grounding shadow, visible inside the transparent icon canvas.
    shadow = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    shadow.putalpha(squircle.filter(ImageFilter.GaussianBlur(30 * SS)))
    shadow = shadow.point(lambda a: int(a * 0.34))
    canvas.alpha_composite(shadow, (0, 14 * SS))

    body = gradient(C, BLUE_TOP, BLUE_BOTTOM).convert('RGBA')
    body.putalpha(squircle)
    canvas.alpha_composite(body)

    # Airy light from the upper-left, clipped to the squircle.
    glow = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((-260 * SS, -310 * SS, 1020 * SS, 820 * SS), fill=(255, 255, 255, 74))
    glow = glow.filter(ImageFilter.GaussianBlur(120 * SS))
    glow.putalpha(Image.composite(glow.getchannel('A'), Image.new('L', (C, C), 0), squircle))
    canvas.alpha_composite(glow)

    # Hairline inner border keeps the squircle crisp on similar blue backgrounds.
    edge = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle(
        (inset, inset, C - inset, C - inset),
        radius=radius,
        outline=(255, 255, 255, 48),
        width=3 * SS,
    )
    canvas.alpha_composite(edge)

    # Rear sheet, peeking out to suggest a stack of notes.
    rear = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    ImageDraw.Draw(rear).rounded_rectangle(
        (380 * SS, 280 * SS, 884 * SS, 936 * SS),
        radius=58 * SS,
        fill=(255, 255, 255, 30),
        outline=(255, 255, 255, 46),
        width=2 * SS,
    )
    canvas.alpha_composite(rear)

    # Page shadow and paper.
    page_box = (300 * SS, 220 * SS, 820 * SS, 870 * SS)
    page_mask = Image.new('L', (C, C), 0)
    ImageDraw.Draw(page_mask).rounded_rectangle(page_box, radius=72 * SS, fill=255)
    page_shadow = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    page_shadow.putalpha(page_mask.filter(ImageFilter.GaussianBlur(18 * SS)))
    page_shadow = page_shadow.point(lambda a: int(a * 0.24))
    canvas.alpha_composite(page_shadow, (0, 18 * SS))

    page = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    pd = ImageDraw.Draw(page)
    pd.rounded_rectangle(page_box, radius=72 * SS, fill=(*PAPER, 255))
    # Width-only fill near the page top gives the paper a subtle polish.
    pd.rounded_rectangle(
        (300 * SS, 220 * SS, 820 * SS, 470 * SS),
        radius=72 * SS,
        fill=(255, 255, 255, 255),
    )
    pd.rounded_rectangle(
        page_box,
        radius=72 * SS,
        outline=(*PAPER_EDGE, 255),
        width=2 * SS,
    )
    canvas.alpha_composite(page)

    # Two quiet content lines.
    draw = ImageDraw.Draw(canvas)
    draw_round_line(draw, [(430 * SS, 365 * SS), (690 * SS, 365 * SS)], 24 * SS, (*PAPER_LINE, 255))
    draw_round_line(draw, [(430 * SS, 420 * SS), (742 * SS, 420 * SS)], 20 * SS, (231, 235, 248, 255))

    # A confident M mark: an abstract page/M hybrid drawn as rounded strokes.
    m_points = [
        (470 * SS, 720 * SS),
        (470 * SS, 480 * SS),
        (590 * SS, 610 * SS),
        (710 * SS, 480 * SS),
        (710 * SS, 720 * SS),
    ]
    # Slight lift under the mark.
    draw_round_line(
        draw,
        [(x + 5 * SS, y + 8 * SS) for x, y in m_points],
        62 * SS,
        (55, 73, 180, 32),
    )
    draw_round_line(draw, m_points, 58 * SS, (*BLUE_MARK, 255))

    # AI sparkle, placed in the blue field rather than on the page.
    draw.polygon(star_points(858 * SS, 236 * SS, 74 * SS, 16 * SS), fill=(255, 255, 255, 255))
    draw.polygon(star_points(916 * SS, 370 * SS, 32 * SS, 7 * SS), fill=(255, 255, 255, 168))

    return canvas.resize((S, S), Image.Resampling.LANCZOS)


def monochrome_tray(size: int) -> Image.Image:
    """Alpha-only menu-bar template: a compact M mark, readable at 16–22 pt."""
    scale = 4
    dim = size * scale
    img = Image.new('RGBA', (dim, dim), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    width = max(3, round(dim * 0.135))
    pad = round(dim * 0.13)
    points = [
        (pad + width // 2, dim - pad),
        (pad + width // 2, pad + round(dim * 0.18)),
        (dim // 2, round(dim * 0.56)),
        (dim - pad - width // 2, pad + round(dim * 0.18)),
        (dim - pad - width // 2, dim - pad),
    ]
    draw_round_line(draw, points, width, (0, 0, 0, 255))
    return img.resize((size, size), Image.Resampling.LANCZOS)


def colored_tray(size: int) -> Image.Image:
    scale = 4
    dim = size * scale
    img = Image.new('RGBA', (dim, dim), (0, 0, 0, 0))
    mask = rounded_mask(dim, 0, round(dim * 0.24))
    body = gradient(dim, BLUE_TOP, BLUE_BOTTOM).convert('RGBA')
    body.putalpha(mask)
    img.alpha_composite(body)
    mark = monochrome_tray(dim)
    # Recolor the alpha-only mark to white.
    white = Image.new('RGBA', (dim, dim), (255, 255, 255, 255))
    white.putalpha(mark.getchannel('A'))
    img.alpha_composite(white)
    return img.resize((size, size), Image.Resampling.LANCZOS)


app_icon().save(OUT / 'icon.png')
monochrome_tray(22).save(OUT / 'trayTemplate.png')
monochrome_tray(44).save(OUT / 'trayTemplate@2x.png')
colored_tray(32).save(OUT / 'tray.png')

tray_bytes = (OUT / 'trayTemplate.png').read_bytes()
b64 = base64.b64encode(tray_bytes).decode()
(OUT / 'tray-data-url.txt').write_text(f'data:image/png;base64,{b64}')

print('icons written:', sorted(p.name for p in OUT.iterdir()))
print('app icon:', Image.open(OUT / 'icon.png').size)
print('tray data-url bytes:', len(b64))

# Keep the embedded menu-bar image in sync with the generated template asset.
tray_source = pathlib.Path(__file__).resolve().parent.parent / 'src/main/tray.ts'
source = tray_source.read_text()
source = re.sub(
    r"const TRAY_DATA_URL = '[^']*';",
    f"const TRAY_DATA_URL = 'data:image/png;base64,{b64}';",
    source,
    count=1,
)
tray_source.write_text(source)
