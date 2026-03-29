from PIL import Image, ImageDraw


BACKGROUND = (99, 194, 133)
FOREGROUND = (255, 255, 255)
SIZE = 1024
MARK_SCALE = 1.12
VERTICAL_SHIFT = -36
TOP_LAYER = [(512, 168), (244, 278), (512, 388), (780, 278)]
MID_LAYER = [(244, 404), (244, 468), (512, 578), (780, 468), (780, 404), (512, 514)]
LOW_LAYER = [(244, 562), (244, 626), (512, 736), (780, 626), (780, 562), (512, 672)]


def transform_point(point: tuple[float, float]) -> tuple[float, float]:
    x, y = point
    centered_x = 512 + (x - 512) * MARK_SCALE
    centered_y = 512 + (y - 420) * MARK_SCALE + VERTICAL_SHIFT
    return (centered_x, centered_y)


def main() -> None:
    img = Image.new("RGB", (SIZE, SIZE), BACKGROUND)
    draw = ImageDraw.Draw(img)

    for shape in (TOP_LAYER, MID_LAYER, LOW_LAYER):
        draw.polygon([transform_point(point) for point in shape], fill=FOREGROUND)

    output_path = "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
    img.save(output_path)


if __name__ == "__main__":
    main()
