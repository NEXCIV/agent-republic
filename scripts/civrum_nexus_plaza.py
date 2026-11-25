"""Build the concentric Nexus inlay shared by the lakeside scene builds."""

import math

import bpy
from build_civrum_world import Geometry, circle, rectangle

CENTER = (0.0, -12.15)
RADIUS = 8.25
SURFACE = 0.223
MEDALLION = "Nexus | stone and brass compass"
BEACON = "CIVRUM_PROP_PLAZA_BEACON_01"
LEGACY_INLAYS = ("CIVRUM_PLAZA_FORUM_INLAY", "CIVRUM_Plaza_Compass")


def arc(radius, sector):
    return [
        (radius * math.cos(step * math.tau / 128), radius * math.sin(step * math.tau / 128))
        for step in range(sector * 8, sector * 8 + 9)
    ]


def rebuild_medallion(group, palette, stone, basalt, metal, gold):
    """Share the contour between each field, brass inlay and ring on a single surface."""
    for name in LEGACY_INLAYS:
        obj = bpy.data.objects[name]
        obj.hide_render = obj.hide_viewport = True
    beacon = bpy.data.objects[BEACON]
    beacon.location = (*CENTER, SURFACE)

    g = Geometry()
    g.surface(circle(2.30, 128), 0, stone)
    for outer, inner, finish in (
        (2.46, 2.30, basalt),
        (2.53, 2.46, gold),
        (2.84, 2.53, basalt),
        (7.96, 7.76, basalt),
        (8.05, 7.96, gold),
        (RADIUS, 8.05, stone),
    ):
        g.band(circle(outer, 128), circle(inner, 128), 0, finish)

    for i in range(16):
        field = basalt if i % 2 else metal
        outer, inner = arc(7.76, i), arc(2.84, i)
        tip = arc(3.27, i)[4]
        # Three tiles share the same edges at the tip. The outer arc stays continuous around the border.
        g.surface([*outer[:2], tip, *reversed(inner[:5])], 0, field)
        g.surface([*outer[1:-1], tip], 0, gold if i % 2 else stone)
        g.surface([*outer[-2:], *reversed(inner[4:]), tip], 0, field)

    border = circle(RADIUS, 128)
    for index, point in enumerate(border):
        next_point = border[(index + 1) % len(border)]
        start = len(g.verts)
        g.verts.extend((x, y, z) for z in (-0.025, 0) for x, y in (point, next_point))
        g.face((start, start + 1, start + 3, start + 2), stone)

    obj = bpy.data.objects.get(MEDALLION)
    mesh = g.mesh("Nexus concentric stone inlay", palette)
    if obj is None:
        obj = bpy.data.objects.new(MEDALLION, mesh)
        group.objects.link(obj)
    else:
        obj.data = mesh
    obj.location = (*CENTER, SURFACE)

    # The south approach markers frame the lettering and stop before the medallion.
    approach = Geometry()
    for sign in (-1, 1):
        approach.surface(rectangle(sign * 5.95, -23.40, 0.12, 2.35), 0, gold)
    trim = bpy.data.objects.new("Nexus | south entry markers", approach.mesh("Nexus entry markers", palette))
    group.objects.link(trim)
    trim.location.z = SURFACE - 0.003
    return obj
