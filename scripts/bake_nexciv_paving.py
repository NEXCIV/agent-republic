"""Author the 300 m city's stone-paving palette using the original parcel plan."""

import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_world import DISTRICTS, circle, rectangle

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "apps/web/public/nexciv-walk/civic-paving.png"
SPAN = 352.0
SIZE = 2048

# These are albedo colours, before the renderer's dawn/dusk lighting.
BLUE = "7894A8"
SLATE = "506D84"
INK = "3A526B"
GOLD = "C3A16B"
SAND = "D0B88D"
LIMESTONE = "B8B6AA"
BRICK = "B28B70"


def rgb(hex_color):
    return np.array(list(bytes.fromhex(hex_color)), dtype=np.float32) / 255


def main():
    axis = ((np.arange(SIZE, dtype=np.float32) + 0.5) / SIZE - 0.5) * SPAN
    x, y = axis[None, :], axis[:, None]
    surface = np.broadcast_to(rgb(BLUE), (SIZE, SIZE, 3)).copy()

    def field(points, outside, border, inside, edge=1.35, rim=0.62):
        """Three concentric stone courses inside a convex, counter-clockwise parcel."""
        distance = np.full((SIZE, SIZE), np.inf, dtype=np.float32)
        for (ax, ay), (bx, by) in zip(points, (*points[1:], points[0]), strict=True):
            dx, dy = bx - ax, by - ay
            np.minimum(
                distance,
                (dx * (y - ay) - dy * (x - ax)) / np.hypot(dx, dy),
                out=distance,
            )
        for offset, colour in ((0, outside), (edge, border), (edge + rim, inside)):
            mask = np.clip((distance - offset) / 0.17 + 0.5, 0, 1)[..., None]
            surface[:] += (rgb(colour) - surface) * mask

    def panel(bounds, outside, border, inside, edge=1.35, rim=0.62, clip=1.6):
        cx, cy, width, depth = bounds
        field(rectangle(cx, cy, width, depth, clip), outside, border, inside, edge, rim)

    # Perimeter blocks. A broad pale kerb course gives the retail blocks a common street edge.
    for side in (-1, 1):
        for center in (-94, -32, 32, 94):
            panel(
                (side * 139, center, 20, 51),
                LIMESTONE,
                INK,
                GOLD if center in (-94, 32) else SLATE,
                edge=1.1,
            )
        for center in (-94, -32, 32, 94):
            panel(
                (center, side * 139, 51, 20),
                LIMESTONE,
                INK,
                SLATE if center in (-94, 32) else GOLD,
                edge=1.1,
            )

    # Six courtyard colour families, aligned to the existing lots and fountain walks.
    finishes = {
        "Governance": (SLATE, GOLD, SAND),
        "Research": (LIMESTONE, INK, BLUE),
        "Residential": (SLATE, LIMESTONE, BRICK),
        "Community": (BLUE, INK, "A8A9AF"),
        "Construction": (SLATE, INK, GOLD),
    }
    for name, ((cx, cy), (width, depth)) in DISTRICTS.items():
        panel((cx, cy, width, depth), *finishes[name], edge=2.2, rim=0.75, clip=2.2)

    # Council approach: long blue stone bands around a sandstone processional axis.
    panel((0, 80.1, 43, 12.4), GOLD, SLATE, SAND, edge=1.3, rim=0.7)
    # Fountain promenades have a darker blue surround and two sandstone footways.
    panel((-95, -30, 44, 46), LIMESTONE, SLATE, BLUE, edge=1.65)
    panel((-81, -32.5, 15.6, 43.4), SAND, INK, SLATE, edge=1.3, rim=0.65)
    panel((95, -30, 44, 46), LIMESTONE, SLATE, GOLD, edge=1.65)
    panel((81.4, -21.1, 15.5, 24.6), SAND, INK, SLATE, edge=1.3)
    panel((81.4, -50.6, 15.5, 13.0), SAND, INK, SLATE, edge=1.3)
    # Outdoor living and coffee courtyards. Grass islands retain their own geometry and material.
    for cx in (-32, 32):
        panel((cx, -95, 46, 46), SLATE, LIMESTONE, GOLD, edge=1.35, rim=0.65)
        panel((cx, -95, 7.5, 45.6), GOLD, SLATE, SAND, edge=0.7, rim=0.65, clip=0.65)
        panel((cx, -95, 45.6, 7.5), GOLD, SLATE, SAND, edge=0.7, rim=0.65, clip=0.65)
    # The eight small gardens use the original diagonal outlines rather than rectangular paint.
    for sx in (-1, 1):
        for sy in (-1, 1):
            for transpose in (False, True):
                points = [
                    (sx * (v if transpose else u), sy * (u if transpose else v))
                    for u, v in ((9, 55.8), (9, 42.7), (23, 36.8), (42, 55.8))
                ]
                if sx * sy * (-1 if transpose else 1) < 0:
                    points.reverse()
                field(points, SAND, INK, SLATE, edge=1.05, rim=0.62)

    # Civic plaza: radial outer walk and a warm stone apron; the compass remains its own material.
    field(circle(28.55, 8), SLATE, GOLD, BLUE, edge=2.65, rim=0.76)
    field(circle(22.7, 8), INK, SAND, "BFA987", edge=1.25, rim=0.8)
    panel((0, -23.5, 9.8, 7.0), BLUE, GOLD, SAND, edge=0.7, rim=0.55, clip=1.2)

    # Northern lake promenade has a continuous blue slate center and limestone side bands.
    panel((0, 164.95, 302, 11.1), SAND, INK, BLUE, edge=1.1, rim=0.65, clip=0)

    image = bpy.data.images.new(
        "Civic paving palette", width=SIZE, height=SIZE, alpha=False, is_data=True
    )
    rgba = np.ones((SIZE, SIZE, 4), dtype=np.float32)
    rgba[:, :, :3] = surface
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = str(DEST)
    image.file_format = "PNG"
    image.save()
    print(f"Paving atlas: {SIZE} x {SIZE}, {SPAN:g} m, {DEST.stat().st_size} bytes")


if __name__ == "__main__":
    main()
