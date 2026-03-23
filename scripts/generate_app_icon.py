from PIL import Image, ImageDraw


def main() -> None:
    size = 1024
    margin = 140
    scale = (size - 2 * margin) / 24
    line_width = int(scale * 2.2)
    corner_radius = 180

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    rect = [margin, margin, size - margin, size - margin]
    draw.rounded_rectangle(rect, radius=corner_radius, fill=(255, 255, 255, 255))
    draw.rounded_rectangle(
        [rect[0] - 2, rect[1] - 2, rect[2] + 2, rect[3] + 2],
        radius=corner_radius + 2,
        outline=(230, 230, 230, 120),
        width=5,
    )

    def transform(x: float, y: float) -> tuple[float, float]:
        return (margin + x * scale, margin + y * scale)

    paths = [
        [(12, 2), (2, 7), (12, 12), (22, 7), (12, 2)],
        [(2, 12), (12, 17), (22, 12)],
        [(2, 17), (12, 22), (22, 17)],
    ]

    color = (37, 164, 255, 255)
    for path in paths:
        transformed = [transform(x, y) for x, y in path]
        draw.line(transformed, fill=color, width=line_width, joint="curve")

    output_path = "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
    img.save(output_path)


if __name__ == "__main__":
    main()
