from pathlib import Path

from PIL import Image, ImageDraw


BACKGROUND = (207, 239, 217)
FOREGROUND = (99, 194, 133)
MASTER_SIZE = 1024
APPLE_TOUCH_SIZE = 180
PREVIEW_SIZE = 512
FAVICON_SIZES = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
ANTIALIAS_SCALE = 4

# Use the actual in-app logo geometry so the app icon matches the product mark.
ICON_SCALE = 33
STROKE_UNITS = 2
VIEWBOX_CENTER = 12

TOP_LAYER = [(12, 2), (2, 7), (12, 12), (22, 7), (12, 2)]
MIDDLE_LAYER = [(2, 12), (12, 17), (22, 12)]
BOTTOM_LAYER = [(2, 17), (12, 22), (22, 17)]


def scale_point(point: tuple[float, float], scale: int, offset: int) -> tuple[int, int]:
    x, y = point
    return (round(offset + x * scale), round(offset + y * scale))


def draw_round_path(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[int, int]],
    width: int,
    color: tuple[int, int, int],
) -> None:
    radius = width // 2

    for start, end in zip(points, points[1:]):
        draw.line([start, end], fill=color, width=width)

    for point in points:
        x, y = point
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)


def build_master_icon() -> Image.Image:
    size = MASTER_SIZE * ANTIALIAS_SCALE
    scale = ICON_SCALE * ANTIALIAS_SCALE
    offset = round((MASTER_SIZE / 2 - VIEWBOX_CENTER * ICON_SCALE) * ANTIALIAS_SCALE)
    stroke_width = round(STROKE_UNITS * ICON_SCALE * ANTIALIAS_SCALE)

    img = Image.new("RGB", (size, size), BACKGROUND)
    draw = ImageDraw.Draw(img)

    for path in (TOP_LAYER, MIDDLE_LAYER, BOTTOM_LAYER):
        draw_round_path(
            draw,
            [scale_point(point, scale, offset) for point in path],
            width=stroke_width,
            color=FOREGROUND,
        )

    return img.resize((MASTER_SIZE, MASTER_SIZE), Image.Resampling.LANCZOS)


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    master_icon = build_master_icon()

    app_icon_path = repo_root / "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
    apple_touch_path = repo_root / "src/app/apple-icon.png"
    favicon_path = repo_root / "src/app/favicon.ico"
    preview_path = repo_root / "tmp/logo-preview-light-green-bg.png"

    master_icon.save(app_icon_path)
    master_icon.resize((APPLE_TOUCH_SIZE, APPLE_TOUCH_SIZE), Image.Resampling.LANCZOS).save(apple_touch_path)
    master_icon.save(favicon_path, sizes=FAVICON_SIZES)
    master_icon.resize((PREVIEW_SIZE, PREVIEW_SIZE), Image.Resampling.LANCZOS).save(preview_path)


if __name__ == "__main__":
    main()
