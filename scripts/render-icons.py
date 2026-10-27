#!/usr/bin/env python3
"""Rasterize the extension icon. The mark is an original speech bubble with 译, not the WhatsApp logo."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "icons"
BG = (109, 40, 217, 255)  # #6d28d9
WHITE = (255, 255, 255, 255)
FONT = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"
SIZES = (16, 32, 48, 128)


def bubble(draw: ImageDraw.ImageDraw, size: int) -> None:
    left = round(size * 0.16)
    top = round(size * 0.14)
    right = round(size * 0.84)
    bottom = round(size * 0.68)
    radius = max(2, round(size * 0.16))
    draw.rounded_rectangle((left, top, right, bottom), radius=radius, fill=WHITE)
    tail = [
        (round(size * 0.28), round(size * 0.62)),
        (round(size * 0.24), round(size * 0.88)),
        (round(size * 0.50), round(size * 0.66)),
    ]
    draw.polygon(tail, fill=WHITE)


def render(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), BG)
    draw = ImageDraw.Draw(image)
    bubble(draw, size)
    font = ImageFont.truetype(FONT, max(8, round(size * 0.40)))
    text = "译"
    box = draw.textbbox((0, 0), text, font=font)
    width = box[2] - box[0]
    height = box[3] - box[1]
    x = (size - width) / 2 - box[0]
    y = size * 0.38 - height / 2 - box[1]
    draw.text((x, y), text, font=font, fill=BG)
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT / f"icon{size}.png"
        render(size).save(path, "PNG")
        print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
