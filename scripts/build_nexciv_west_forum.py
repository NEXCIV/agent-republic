"""Dress the existing west auditorium and reflecting pool, in the lakeside world's metres."""

import json
import math
import sys
from itertools import pairwise
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_world import Geometry, circle
from build_nexciv_coffee_promenade import (
    BRASS,
    DARK,
    OAK,
    OPAL,
    STONE,
    furnishings,
    prepare_finishes,
)
from civrum_lakeside_blocks import sector
from export_nexciv_walk_preview import DEST, export_chunk, precise_meshopt_positions

FLOOR = 0.172
ROW_SECTORS = ((4, 68), (112, 176), (184, 265), (275, 356))


def entrance(g):
    # The north opening also admits residents to both ground-level seat anchors.
    y = 10.18
    for side in (-1, 1):
        x = 3.42 * side
        g.box(x, y, 0, 0.76, 0.94, 0.22, STONE, 0.09)
        g.box(x, y, 0.22, 0.62, 0.76, 2.82, DARK, 0.06)
        for dx in (-0.16, 0, 0.16):
            g.box(x + dx, y + 0.38, 0.36, 0.048, 0.052, 2.40, BRASS, 0.009)
        g.box(x, y, 2.82, 0.69, 0.82, 0.24, BRASS, 0.06)
    g.box(0, y, 3.00, 7.74, 1.19, 0.13, BRASS, 0.18)
    g.box(0, y, 3.13, 7.44, 1.00, 0.54, DARK, 0.13)
    g.box(0, y, 3.67, 7.71, 1.16, 0.095, BRASS, 0.14)
    for side in (-1, 1):
        for i in range(3):
            g.box(side * (2.12 + i * 0.27), y + 0.51, 3.31, 0.17, 0.045, 0.055, OPAL)
    # Chevron rays rise above the middle of the canopy, visible from the back rows.
    for i in range(-3, 4):
        h = 0.15 + (3 - abs(i)) * 0.10
        g.box(i * 0.17, y, 3.765, 0.13, 0.37, h, BRASS, 0.025)


def auditorium(g):
    for tier in range(6):
        inner = 5.8 + 1.34 * tier
        top = 0.35 + tier * 0.37
        for start, end in ROW_SECTORS:
            # Leave a visible joint between individual timber bench sections.
            count = math.ceil(math.radians(end - start) * (inner + 0.45) / 1.54)
            for bay in range(count):
                a = start + 0.7 + bay * (end - start - 1.4) / count
                b = start + 0.7 + (bay + 1) * (end - start - 1.4) / count
                g.slab(
                    sector(inner + 0.19, inner + 0.75, a + 0.11, b - 0.11, 5),
                    top + 0.128,
                    top + 0.158,
                    OAK,
                )
            if tier == 5:
                g.slab(
                    sector(inner + 1.22, inner + 1.38, start, end, 24),
                    top + 0.01,
                    top + 0.13,
                    BRASS,
                )
        # Each side and rear aisle rises in half-steps, between the original seating blocks.
        for angle in (0, 180, 270):
            for step in range(2):
                r = inner + step * 0.67
                h = top - (1 - step) * 0.185
                g.slab(sector(r, r + 0.668, angle - 3.65, angle + 3.65, 4), 0, h, STONE)
                g.slab(
                    sector(r + 0.06, r + 0.14, angle - 2.9, angle + 2.9, 4),
                    h,
                    h + 0.012,
                    OPAL,
                )
    # Circular boards over the original flat stage. Keep the playable floor within 1 cm.
    n, radius = 40, 4.72
    for i in range(n):
        x0 = -radius + 2 * radius * i / n + 0.006
        x1 = -radius + 2 * radius * (i + 1) / n - 0.006
        h0, h1 = (math.sqrt(radius**2 - x**2) for x in (x0, x1))
        g.surface([(x0, -h0), (x1, -h1), (x1, h1), (x0, h0)], 0.247, OAK)
    g.band(circle(4.82, 96), circle(4.75, 96), 0.248, BRASS)


def lamps(g):
    # Mounted on the existing western coping, clear of the public footpath and its trees.
    for y in (-15, -5, 5, 15):
        x = -3.58
        g.box(x, y, 0.685, 0.29, 0.48, 0.13, STONE, 0.043)
        g.box(x, y, 0.815, 0.19, 0.29, 1.05, DARK, 0.035)
        g.box(x, y, 1.865, 0.29, 0.41, 0.065, BRASS, 0.04)
        g.box(x, y, 1.93, 0.23, 0.32, 0.38, OPAL, 0.04)
        for dx in (-0.11, 0.11):
            for dy in (-0.15, 0.15):
                g.box(x + dx, y + dy, 1.93, 0.034, 0.034, 0.38, DARK)
        g.box(x, y, 2.31, 0.33, 0.43, 0.085, BRASS, 0.07)


def south_landing(g):
    # The surveyed walk turns west on level ground just beyond the last fountain jet.
    x0, x1, y = -91.35, -74.05, -55.0
    g.box((x0 + x1) / 2, y, -0.012, x1 - x0, 2.40, 0.024, DARK, 0.18)
    for row in range(4):
        for bay in range(20):
            width = (x1 - x0 - 0.26) / 20
            x = x0 + 0.13 + (bay + 0.5) * width
            g.box(
                x,
                y + (row - 1.5) * 0.56,
                0.012,
                width - 0.015,
                0.548,
                0.006,
                STONE,
                0.018,
            )
    # Inlaid paired arrows follow actual resident travel bearings and ground elevations.
    route = json.loads((DEST / "west-route.json").read_text(encoding="utf-8"))["points"]
    distance = 0.0
    for previous, current in pairwise(route):
        x, floor, z = current
        if z < 54.5 or z > 73.7:
            continue
        dx, dz = x - previous[0], z - previous[2]
        step = math.hypot(dx, dz)
        distance += step
        if distance < 4.0:
            continue
        distance = 0
        ux, uy = dx / step, -dz / step
        on_landing = x0 <= x <= x1 and abs(z + y) < 1.2
        elevation = 0.024 if on_landing else floor + 0.014
        for offset in (-0.13, 0.13):
            points = [
                (x + ux * (u + offset) - uy * v, -z + uy * (u + offset) + ux * v)
                for u, v in (
                    (0.14, 0),
                    (-0.07, 0.23),
                    (-0.15, 0.23),
                    (0.06, 0),
                    (-0.15, -0.23),
                    (-0.07, -0.23),
                )
            ]
            g.slab(points, elevation - 0.004, elevation, BRASS)


def fascia():
    font = bpy.data.curves.new("Forum lettering", "FONT")
    font.body = "C I V I C   F O R U M"
    font.size, font.extrude, font.align_x = 0.35, 0.006, "CENTER"
    font.materials.append(bpy.data.materials["MAT_Promenade Lantern glass"])
    sign = bpy.data.objects.new("Forum north lettering", font)
    bpy.context.collection.objects.link(sign)
    sign.rotation_euler = (math.pi / 2, 0, math.pi)
    sign.location = (-95, -88.5 + 10.705, FLOOR + 3.26)
    bpy.context.view_layer.objects.active = sign
    sign.select_set(True)
    bpy.ops.object.convert(target="MESH")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    prepare_finishes()
    theatre, pool, landing = Geometry(), Geometry(), Geometry()
    entrance(theatre)
    auditorium(theatre)
    lamps(pool)
    south_landing(landing)
    furnishings("Forum auditorium trim", theatre).location = (-95, -88.5, FLOOR)
    furnishings("Pool edge lanterns", pool).location = (-80.8, -32.5, 0)
    furnishings("West promenade paving", landing)
    fascia()
    bpy.ops.object.select_all(action="SELECT")
    with precise_meshopt_positions():
        export_chunk(DEST / "west-forum-promenade.glb")


if __name__ == "__main__":
    main()
