"""Build the editable public construction centre and its world-aligned GLB."""

import argparse
import math
import random
import sys
from itertools import pairwise
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_lakeside import material, shader
from build_civrum_world import Geometry, circle
from detail_civrum_world import rod

ANCHOR = (95, -82, .172)
MATERIALS = (
    ("Works Limestone", "C9B99C", .77, 0),
    ("Works Cut Stone", "DDD0B4", .68, 0),
    ("Works Paving", "A59B89", .89, 0),
    ("Works Bronze", "6B543D", .42, .64),
    ("Works Brushed Brass", "C08F50", .34, .70),
    ("Works Enamel", "255257", .48, .12),
    ("Works Glass", "729DAB", .15, .08),
    ("Works Amber", "D29B3D", .44, .25),
    ("Works Copper", "B4683D", .43, .54),
    ("Works Plaster", "A59579", .81, 0),
    ("Works Oak", "7B5940", .61, 0),
    ("Works Shadow", "343936", .77, .15),
    ("Works Light", "F7DCA4", .39, 0),
    ("Works Leaf Dark", "37462B", .87, 0),
    ("Works Leaf Olive", "627441", .9, 0),
    ("Works Leaf Light", "8B9A59", .85, 0),
    ("Works Petal Gold", "E6BA51", .68, 0),
    ("Works Petal Rose", "C88683", .74, 0),
    ("Works Banner", "40566A", .76, 0),
    ("Works Ivory", "F2E3BD", .54, .10),
)
(STONE, CUT, PAVE, BRONZE, BRASS, TEAL, GLASS, AMBER, COPPER, PLASTER, OAK, SHADOW,
 LIGHT, DARK_LEAF, OLIVE, PALE_LEAF, GOLD_PETAL, ROSE_PETAL, BANNER, IVORY) = range(len(MATERIALS))


def periodic_noise(rng, cells, size):
    values = rng.random((cells, cells))
    axis = np.arange(size) * cells / size
    low = axis.astype(int)
    high = (low + 1) % cells
    t = axis - low
    t = t * t * (3 - 2 * t)
    columns = values[:, low] * (1 - t) + values[:, high] * t
    return columns[low] * (1 - t[:, None]) + columns[high] * t[:, None]


def packed_map(name, rgb, *, data=False):
    size = rgb.shape[0]
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    if data:
        image.colorspace_settings.name = "Non-Color"
    pixels = np.ones((size, size, 4), dtype=np.float32)
    pixels[:, :, :3] = np.clip(rgb, 0, 1)
    image.pixels.foreach_set(pixels.ravel())
    image.file_format = "PNG"
    image.pack()
    return image


def finish_textures():
    for idx, (name, color, roughness, metallic) in enumerate(MATERIALS):
        surface_mat = material("MAT_" + name, color, roughness, metallic, 1.25 if idx == LIGHT else 0)
        surface = shader(surface_mat)
        if idx == GLASS:
            surface.inputs["Alpha"].default_value = .25
            surface.inputs["IOR"].default_value = 1.45
            surface_mat.surface_render_method = "BLENDED"
        if idx not in (STONE, CUT, PAVE, BRONZE, TEAL, GLASS, OAK, AMBER, COPPER):
            continue
        size = 384 if idx == GLASS else 512
        rng = np.random.default_rng(4500 + idx)
        broad = periodic_noise(rng, 7, size) - .5
        grain = periodic_noise(rng, 55, size) - .5
        fine = rng.random((size, size)) - .5
        stone = idx in (STONE, CUT, PAVE)
        relief = broad * .26 + grain * .13 + fine * (.07 if stone else .024)
        tint = np.array([int(color[i:i + 2], 16) / 255 for i in (0, 2, 4)])
        modulation = 1 + relief * (.22 if stone else .12)
        color_map = packed_map(name + " · Base Color", tint * modulation[:, :, None])
        rough_map = packed_map(name + " · Roughness", (roughness + relief * .25)[:, :, None], data=True)

        tree = surface_mat.node_tree
        nodes, links = tree.nodes, tree.links
        for image, socket, y in ((color_map, "Base Color", 180), (rough_map, "Roughness", -70)):
            texture = nodes.new("ShaderNodeTexImage")
            texture.image = image
            texture.location = (-440, y)
            links.new(texture.outputs["Color"], surface.inputs[socket])
        if idx == GLASS:
            continue
        gradient = np.stack((
            (np.roll(relief, 1, axis=1) - np.roll(relief, -1, axis=1)) * (.52 if stone else .20),
            (np.roll(relief, 1, axis=0) - np.roll(relief, -1, axis=0)) * (.52 if stone else .20),
            np.ones_like(relief),
        ), axis=2)
        gradient /= np.linalg.norm(gradient, axis=2)[:, :, None]
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = packed_map(name + " · Normal", gradient * .5 + .5, data=True)
        texture.location = (-440, -315)
        bump = nodes.new("ShaderNodeNormalMap")
        bump.location = (-155, -315)
        bump.inputs["Strength"].default_value = .74 if stone else .38
        links.new(texture.outputs["Color"], bump.inputs["Color"])
        links.new(bump.outputs["Normal"], surface.inputs["Normal"])


def round_rect(x, y, width, depth, radius, steps=7):
    points = []
    for index, (sign_x, sign_y) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        center_x, center_y = x + sign_x * (width / 2 - radius), y + sign_y * (depth / 2 - radius)
        for step in range(steps + 1):
            angle = (index + step / steps) * math.pi / 2
            points.append((center_x + radius * math.cos(angle), center_y + radius * math.sin(angle)))
    return points


def rounded_stack(g, x, y, width, depth, radius, z, height, color, bevel=.045):
    outline = round_rect(x, y, width, depth, radius)
    small = round_rect(x, y, width - 2 * bevel, depth - 2 * bevel, radius - bevel)
    g.loft(small, outline, z, z + bevel, color)
    g.slab(outline, z + bevel, z + height - bevel, color)
    g.loft(outline, small, z + height - bevel, z + height, color)


def beam(g, first, last, width, depth, color, up=(0, 0, 1)):
    a, b = Vector(first), Vector(last)
    along = (b - a).normalized()
    side = along.cross(Vector(up))
    if side.length_squared < .001:
        side = along.cross(Vector((1, 0, 0)))
    u = side.normalized() * width / 2
    v = along.cross(u).normalized() * depth / 2
    i = len(g.verts)
    for p in (a, b):
        g.verts.extend(tuple(p + u * sx + v * sy) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1)))
    g.face((i + 3, i + 2, i + 1, i), color)
    g.face((i + 4, i + 5, i + 6, i + 7), color)
    for n in range(4):
        m = (n + 1) % 4
        g.face((i + n, i + m, i + m + 4, i + n + 4), color)


def pane(g, a, b, low, high):
    at = len(g.verts)
    g.verts.extend(((*a, low), (*b, low), (*b, high), (*a, high)))
    g.face((at, at + 1, at + 2, at + 3), GLASS)


def glazing(frame, glass, a, b, low, high, count, *, door=False):
    def xy(t):
        return tuple(p + (q - p) * t for p, q in zip(a, b))

    for n in range(count):
        pane(glass, xy((n + .008) / count), xy((n + .992) / count), low + .035, high - .035)
    for n in range(count + 1):
        x, y = xy(n / count)
        beam(frame, (x, y, low), (x, y, high), .067, .108, BRONZE)
    for z in (low, high - .55, high):
        beam(frame, (*a, z), (*b, z), .091, .075, BRONZE)
    beam(frame, (*a, high + .037), (*b, high + .037), .032, .022, BRASS)
    if not door:
        beam(frame, (*a, low - .069), (*b, low - .069), .183, .081, CUT)


def tile_column(g, x, y, low, high, w, d, color=STONE):
    courses = math.ceil((high - low) / .49)
    step = (high - low) / courses
    for i in range(courses):
        g.box(x, y, low + i * step, w, d, step - .008, color, .026)
    g.box(x, y, low, w + .036, d + .038, .083, CUT, .024)


def add_uvs(mesh):
    layer = mesh.uv_layers.new(name="Metre repeating")
    for poly in mesh.polygons:
        normal = poly.normal
        drop = max(range(3), key=lambda axis: abs(normal[axis]))
        u, v = tuple(axis for axis in range(3) if axis != drop)
        for i in poly.loop_indices:
            co = mesh.vertices[mesh.loops[i].vertex_index].co
            layer.data[i].uv = (co[u] / 1.35 + .37, co[v] / 1.35 + .19)


def make_part(collection, name, geo, *, bevel=0):
    mesh = geo.mesh(name, MATERIALS)
    add_uvs(mesh)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    if bevel:
        modifier = obj.modifiers.new("Rounded manufactured edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
        modifier.harden_normals = True
    return obj


def envelope(stone, frames, glass):
    rounded_stack(stone, 0, -.12, 22.8, 16.4, .64, 0, .20, STONE, .033)
    rounded_stack(stone, 0, -.34, 21.4, 13.45, .90, .20, .92, STONE, .035)
    rounded_stack(stone, 0, -.38, 21.55, 13.65, 1.0, 1.12, .16, CUT, .024)
    # North stair ends at the same landing position as the original building.
    for index in range(6):
        front, height = 8.50 - index * .35, .24 + index * .165
        east, west = 3.61, -3.61
        rear = front - .35 if index < 5 else 5.77
        stone.box((east + west) / 2, (front + rear) / 2, .185, east - west, front - rear, height - .185, STONE, .026)
        for x in (-2.70, -.90, .90, 2.70):
            stone.box(x, front - .065, height - .044, 1.785, .13, .044, CUT, .014)
    for x in (-3.79, 3.79):
        beam(stone, (x, 8.49, .32), (x, 6.20, 1.28), .35, .20, CUT)
        for y, z in ((8.38, .31), (7.38, .74), (6.28, 1.23)):
            beam(frames, (x, y, z), (x, y, z + .82), .045, .046, BRONZE)
        beam(frames, (x, 8.40, 1.12), (x, 6.25, 2.05), .052, .060, BRASS)

    opening = 5.39
    for x, w in ((-10.35, .66), (-7.83, .52), (-3.87, .66), (3.87, .66), (7.83, .52), (10.35, .66)):
        tile_column(stone, x, 5.43, 1.15, 4.41, w, .63, CUT)
    for x in (-3.87, 3.87):
        tile_column(stone, x, 5.79, 1.35, 4.28, .39, .13, COPPER)
        frames.box(x, 5.88, 2.95, .19, .09, .69, BRONZE, .018)
        frames.box(x, 5.934, 3.06, .112, .032, .46, LIGHT, .013)
    for left, right, divisions in ((-10.08, -8.10, 2), (-7.55, -4.2, 3), (4.2, 7.55, 3), (8.1, 10.08, 2)):
        glazing(frames, glass, (left, opening), (right, opening), 1.58, 4.27, divisions)
        beam(stone, (left, 5.44, 1.34), (right, 5.44, 1.34), .46, .39, STONE)
    for left, right, divisions in ((-3.55, -1.80, 2), (-1.80, 1.80, 2), (1.80, 3.55, 2)):
        glazing(frames, glass, (left, opening), (right, opening), 1.28, 4.27, divisions, door=True)
    for x in (-.23, .23):
        rod(frames, (x, 5.51, 1.95), (x, 5.51, 2.48), .027, BRASS, sides=10)
        for z in (2.00, 2.43):
            rod(frames, (x, 5.42, z), (x, 5.52, z), .021, BRASS, sides=8)

    # Every elevation uses real columns, recessed panes and a full floor behind them.
    for wall_x in (-10.23, 10.23):
        for y in (-5.8, -3.1, -.45, 2.14, 4.83):
            tile_column(stone, wall_x, y, 1.22, 4.37, .48, .53)
        for y1, y2 in ((-5.52, -3.37), (-2.83, -.72), (-.18, 1.87), (2.41, 4.56)):
            glazing(frames, glass, (wall_x, y1), (wall_x, y2), 1.61, 4.27, 2)
            beam(stone, (wall_x, y1, 1.39), (wall_x, y2, 1.39), .34, .40, STONE)
    for x in (-9.65, -5.60, -1.92, 1.92, 5.60, 9.65):
        tile_column(stone, x, -6.35, 1.15, 4.37, .48, .50)
    for a, b in ((-9.38, -5.87), (-5.33, -2.19), (2.19, 5.33), (5.87, 9.38)):
        glazing(frames, glass, (a, -6.34), (b, -6.34), 1.57, 4.27, 3)
        beam(stone, (a, -6.35, 1.40), (b, -6.35, 1.40), .36, .30, STONE)
    stone.box(0, -6.38, 1.26, 3.47, .31, 2.79, SHADOW, .045)
    for k in range(18):
        stone.box(0, -6.558, 1.37 + .128 * k, 3.25, .065, .038, BRONZE, .011)
    stone.box(0, -6.53, 3.93, 3.66, .23, .18, STONE, .02)


def terrace(stone, detail, glass):
    for x, y, width, depth, radius, z in (
        (0, -.35, 22.20, 14.11, 1.23, 4.35),
        (3.86, -.71, 13.69, 12.55, 1.44, 7.37),
        (-6.68, -1.33, 7.89, 11.05, 1.23, 7.80),
    ):
        rounded_stack(stone, x, y, width, depth, radius, z, .40, STONE)
        rounded_stack(stone, x, y, width + .065, depth + .065, radius + .03, z + .32, .11, CUT, .023)
        skirt = round_rect(x, y, width + .013, depth + .013, radius + .007)
        for a, b in pairwise((*skirt, skirt[0])):
            beam(detail, (*a, z + .137), (*b, z + .137), .032, .031, BRASS)
        for a, b in pairwise((*skirt, skirt[0])):
            if z > 5 and min(a[1], b[1]) > 1.4:
                rod(detail, (*a, z + 1.34), (*b, z + 1.34), .045, BRASS, sides=8)
        if z > 5:
            for px in (x - width * .36, x - width * .15, x + width * .10, x + width * .35):
                py = y + depth / 2
                rod(detail, (px, py, z + .43), (px, py, z + 1.33), .027, BRONZE, sides=8)
            pane(glass, (x - width * .36, y + depth / 2), (x + width * .35, y + depth / 2), z + .51, z + 1.24)

    for left, right, face, top in ((-9.63, -3.83, 3.88, 7.80), (-3.55, 9.66, 3.43, 7.37)):
        for k in range(5):
            x = left + (right - left) * k / 4
            tile_column(stone, x, face, 4.75, top, .35, .44, CUT)
        for k in range(4):
            a, b = left + (right - left) * k / 4 + .19, left + (right - left) * (k + 1) / 4 - .19
            glazing(detail, glass, (a, face - .016), (b, face - .016), 5.02, top - .09, 3)
        for x in (left, right):
            for y in (-5.25, -2.85, -.65, 2.0):
                tile_column(stone, x, y, 4.74, top, .40, .43)
            for a, b in ((-5.00, -3.10), (-2.60, -.90), (-.40, 1.75), (2.25, face)):
                glazing(detail, glass, (x, a), (x, b), 5.04, top - .10, 2)
        stone.box((left + right) / 2, -5.48, 4.75, right - left, .24, top - 4.75, STONE, .05)


def curved_band(g, curve, thickness, height, color):
    first = len(g.verts)
    for x, y, z in curve:
        g.verts.extend(((x, y, z), (x, y, z + height), (x, y - thickness, z + height), (x, y - thickness, z)))
    g.face(tuple(first + i for i in (3, 2, 1, 0)), color)
    for i in range(len(curve) - 1):
        a, b = first + 4 * i, first + 4 * (i + 1)
        for edge in range(4):
            end = (edge + 1) % 4
            g.face((a + end, b + end, b + edge, a + edge), color)
    g.face(tuple(first + 4 * (len(curve) - 1) + i for i in range(4)), color)


def canopy(shell, hardware):
    path = []
    for index in range(51):
        x = -6.75 + index * 14.9 / 50
        y = 6.09 + .55 * (1 - (x / 8.2) ** 2)
        z = 4.10 + .36 * math.exp(-((x - 2.8) / 3.2) ** 2) - .24 * math.exp(-((x - 7.75) / .9) ** 2)
        path.append((x, y, z))
    curved_band(shell, path, 1.01, 1.45, TEAL)
    curved_band(shell, [(x, y + .032, z - .15) for x, y, z in path], 1.09, .195, CUT)
    curved_band(shell, [(x, y + .014, z + 1.43) for x, y, z in path], 1.04, .135, CUT)
    for index in range(0, len(path) - 1, 2):
        a, b = path[index], path[index + 2]
        beam(hardware, (a[0], a[1] + .05, a[2] + .06), (b[0], b[1] + .05, b[2] + .06), .024, .023, BRASS)
    for x in (-4.85, -3.15, -1.55, .03, 1.65, 3.23, 5.08, 6.65):
        nearest = min(path, key=lambda p: abs(x - p[0]))
        hardware.slab(circle(.119, 20, x, nearest[1] - .28), nearest[2] - .164, nearest[2] - .147, LIGHT)
    for x, length in ((3.1, .41), (3.57, .72), (4.04, .54)):
        hardware.box(x, 6.68, 4.83, .25, .085, length, IVORY, .024)
        hardware.box(x, 6.735, 4.96, .082, .014, length * .61, AMBER, .008)
    sweep = [
        (3.57 + 1.0 * math.cos(a), 6.79, 4.90 + .185 * math.sin(a) + .09 * math.cos(a))
        for a in (math.radians(153 + 8 * i) for i in range(31))
    ]
    for a, b in pairwise(sweep):
        beam(hardware, a, b, .053, .045, IVORY, up=(0, 1, 0))


def dome(stone, frame, glass):
    x, y, z = 4.38, -.75, 7.81
    rounded_stack(stone, x, y, 9.65, 9.05, 4.38, 7.75, .25, BRONZE, .046)
    rings = []
    spans = 26
    for row in range(8):
        lat = .038 + row * .193
        outline = []
        for n in range(spans):
            angle = math.tau * (n + (row % 2) * .5) / spans
            outline.append((x + 4.65 * math.cos(lat) * math.cos(angle),
                            y + 4.37 * math.cos(lat) * math.sin(angle),
                            z + 5.82 * math.sin(lat)))
        rings.append(outline)
    edges = set()
    for idx, (lower, upper) in enumerate(pairwise(rings)):
        for n in range(spans):
            nxt = (n + 1) % spans
            if idx % 2:
                triangles = ((lower[n], lower[nxt], upper[nxt]), (lower[n], upper[nxt], upper[n]))
            else:
                triangles = ((lower[n], lower[nxt], upper[n]), (lower[nxt], upper[nxt], upper[n]))
            for triangle in triangles:
                first = len(glass.verts)
                glass.verts.extend(triangle)
                glass.face((first, first + 1, first + 2), GLASS)
                for a, b in pairwise((*triangle, triangle[0])):
                    edges.add(tuple(sorted((a, b))))
    for a, b in sorted(edges):
        rod(frame, a, b, .051, BRONZE, sides=8)
    cap_z = rings[-1][0][2]
    lower = circle(.98, 34, x, y)
    frame.slab(lower, cap_z - .035, cap_z + .16, BRASS)
    glass.slab(circle(.88, 34, x, y), cap_z + .15, cap_z + .55, GLASS)
    frame.slab(lower, cap_z + .53, cap_z + .66, STONE)
    for n in range(10):
        a = math.tau * n / 10
        px, py = x + .887 * math.cos(a), y + .887 * math.sin(a)
        beam(frame, (px, py, cap_z + .12), (px, py, cap_z + .58), .045, .045, BRONZE)
    halo = circle(2.38, 40, x, y)
    for a, b in pairwise((*halo, halo[0])):
        rod(frame, (*a, 11.5), (*b, 11.5), .055, LIGHT, sides=7)
    for a in (halo[4], halo[16], halo[29]):
        beam(frame, (*a, 11.53), (*a, 12.84), .032, .033, BRONZE)
    for a, b in pairwise((*circle(3.83, 36, x, y), circle(3.83, 36, x, y)[0])):
        rod(frame, (*a, 8.88), (*b, 8.88), .036, BRASS, sides=7)

    # The illuminated copper sweep is fixed to two stone piers.
    arch = []
    for j in range(34):
        a = .08 + math.pi * .82 * j / 33
        arch.append((x + 5.58 * math.cos(a), y + 5.24 * math.sin(a), 8.09 + .32 * math.sin(a - .15)))
    for a, b in pairwise(arch):
        beam(frame, a, b, .37, .28, COPPER)
        beam(frame, (a[0], a[1], a[2] - .126), (b[0], b[1], b[2] - .126), .062, .043, LIGHT)
    for p in (arch[0], arch[-1]):
        frame.loft(circle(.23, 10, *p[:2]), circle(.16, 10, *p[:2]), 7.77, p[2], BRONZE)


def sail(shell, seams):
    # Profile from the entrance wing to the swept, ivory-clad apex.
    levels = (
        (5.38, -6.02, -.95, 4.05), (6.18, -5.63, -1.04, 3.84),
        (7.18, -5.18, -1.50, 3.61), (8.32, -4.85, -1.95, 3.35),
        (9.52, -4.68, -2.19, 3.06), (10.72, -4.62, -2.52, 2.73),
        (11.9, -4.61, -2.97, 2.37), (13.0, -4.67, -3.50, 2.10),
        (14.11, -4.73, -4.05, 1.88), (15.37, -4.72, -4.66, 1.70),
    )
    lanes = (0, .12, .36, .61, .84, 1)
    for row, (lo, hi) in enumerate(pairwise(levels)):
        for lane, (u, v) in enumerate(pairwise(lanes)):
            vertices = []
            for side in (0.0, -.62):
                for level, t in ((lo, u), (lo, v), (hi, v), (hi, u)):
                    z, x1, x2, y = level
                    vertices.append((x1 + (x2 - x1) * t, y + .32 * math.sin(math.pi * t) + side, z))
            material_index = CUT if lane in (0, 4) else TEAL if row < 6 else AMBER if row < 8 else COPPER
            start = len(shell.verts)
            shell.verts.extend(vertices)
            shell.face((start, start + 1, start + 2, start + 3), material_index)
            shell.face((start + 7, start + 6, start + 5, start + 4), material_index)
            if lane in (0, 4):
                k = 0 if lane == 0 else 1
                shell.face((start + k, start + 4 + k, start + 7 - k, start + 3 - k), CUT)
            if row == 0:
                shell.face((start, start + 1, start + 5, start + 4), STONE)
            if row == len(levels) - 2:
                shell.face((start + 2, start + 3, start + 7, start + 6), CUT)
            if lane in (1, 2, 3):
                a, b = vertices[0], vertices[3]
                rod(seams, (a[0], a[1] + .01, a[2]), (b[0], b[1] + .01, b[2]), .021, BRONZE, sides=6)
            a, b = vertices[0], vertices[1]
            rod(seams, (a[0], a[1] + .012, a[2]), (b[0], b[1] + .012, b[2]), .016, BRASS, sides=6)


def crane(geo, glass):
    x, y = -7.6, -1.96
    for k in range(3):
        geo.box(x, y, 8.20 + .2 * k, 1.31 - .16*k, 1.24 - .15*k, .19, STONE, .045)
    geo.box(x, y, 8.75, .80, .78, 1.88, BRONZE, .040)
    for dx in (-.37, .37):
        for dy in (-.37, .37):
            beam(geo, (x + dx, y + dy, 8.76), (x + dx, y + dy, 10.65), .071, .072, BRASS)
    geo.box(x, y, 10.56, 1.7, 1.03, .25, AMBER, .044)
    geo.box(x, y, 11.38, 1.60, 1.03, .13, AMBER, .033)
    glazing(geo, glass, (x - .62, y + .464), (x + .65, y + .464), 10.81, 11.38, 2)
    glazing(geo, glass, (x - .68, y - .43), (x - .68, y + .46), 10.81, 11.38, 1)
    geo.box(x, y - .45, 10.77, 1.54, .10, .63, AMBER, .033)
    end, start, z = -11.20, -5.39, 11.10
    for side in (-.31, .31):
        for lift in (0, .60):
            beam(geo, (end, y + side, z + lift), (start, y + side, z + lift), .10, .10, AMBER)
        for i in range(8):
            a, b = end + (start - end) * i / 8, end + (start - end) * (i + 1) / 8
            beam(geo, (a, y + side, z), (a, y + side, z + .60), .073, .073, AMBER)
            beam(geo, (a, y + side, z + (i % 2) * .60), (b, y + side, z + ((i + 1) % 2) * .60), .06, .07, AMBER)
    for px in (end, end + 1.04, -8.7, start):
        beam(geo, (px, y - .31, z), (px, y + .31, z), .078, .084, BRONZE)
    geo.box(-9.34, -3.4, 8.22, 1.68, 1.21, .53, STONE, .058)
    for k in range(7):
        px = -10.04 + k * .22
        beam(geo, (px, -2.781, 8.28), (px + .14, -2.781, 8.52), .057, .013, AMBER)


def drawing_board(g, x, y, z, width, height):
    g.box(x, y, z, width, .088, height, BRONZE, .038)
    g.box(x, y + .053, z + .065, width - .13, .037, height - .13, TEAL, .022)
    for row, span in ((.18, .43), (.27, .59), (.36, .73)):
        g.box(x - width * .05, y + .080, z + height - row, width * span, .010, .018, IVORY)
    baseline = z + .22
    for k, scale in enumerate((.32, .54, .42, .63, .38)):
        px = x + width * (k - 2) * .142
        half = width * .048
        top = baseline + (height - .48) * scale
        for edge in (-half, half):
            g.box(px + edge, y + .080, baseline, .017, .011, top - baseline, LIGHT)
        g.box(px, y + .080, top, 2 * half, .010, .018, LIGHT)
    g.box(x, y + .080, baseline - .014, width * .72, .010, .018, LIGHT)


def interior(g):
    g.box(0, .10, 1.268, 19.88, 10.34, .043, OAK)
    g.box(0, 2.74, 1.308, 5.76, 5.04, .016, TEAL, .23)
    for x in (-2.84, 2.84):
        g.box(x, 2.74, 1.326, .023, 4.78, .009, BRASS, .006)
    for x in (-6.86, 0, 6.86):
        g.box(x, -.58, 1.30, 6.18, .20, 2.96, PLASTER, .048)
        g.box(x, -.46, 1.33, 6.15, .053, .37, BRONZE, .018)
        drawing_board(g, x, -.405, 2.06, 3.07 if x == 0 else 2.13, 1.41)
    for x in (-3.23, 3.23):
        tile_column(g, x, 2.12, 1.32, 4.33, .25, .30, CUT)
        g.box(x, 2.30, 2.62, .079, .093, .42, LIGHT, .013)
    for x, y in ((-5.83, 1.77), (6.18, 2.10), (8.72, .56), (-8.76, .47)):
        g.box(x, y, 1.31, 2.19, .86, .058, BRONZE, .022)
        g.box(x, y, 1.38, 2.08, .79, .71, TEAL, .041)
        g.box(x, y, 2.09, 2.20, .89, .079, OAK, .034)
        for i, h in enumerate((.267, .40, .34, .56)):
            px = x + (i - 1.5) * .31
            g.box(px, y + .10, 2.17, .17, .18, h, CUT, .014)
            for row in range(round(h / .12)):
                g.box(px, y + .200, 2.23 + row * .11, .095, .015, .036, TEAL, .004)
    for x in (-1.27, 1.27):
        g.box(x, 2.66, 1.32, 1.34, .83, .995, TEAL, .057)
        for i in range(9):
            g.box(x + (i - 4) * .128, 3.096, 1.46, .023, .021, .72, BRONZE, .005)
        g.box(x, 2.66, 2.315, 1.44, .98, .079, OAK, .040)
        g.box(x - .16, 2.557, 2.43, .52, .085, .34, BRONZE, .020)
        g.box(x - .16, 2.606, 2.478, .44, .025, .25, TEAL, .012)
        g.box(x - .16, 2.621, 2.64, .22, .008, .015, LIGHT)
        g.box(x - .16, 2.62, 2.55, .31, .008, .013, IVORY)
        g.box(x - .16, 2.557, 2.39, .051, .068, .066, BRONZE, .006)
        g.box(x + .36, 2.95, 2.397, .24, .17, .037, IVORY, .009)
    for x, r in ((0, 1.61), (0, 1.99)):
        fixture = circle(r, 40, x, 2.39)
        for a, b in pairwise((*fixture, fixture[0])):
            rod(g, (*a, 4.145), (*b, 4.145), .039, LIGHT, sides=7)
    for x in (-8.3, -5.15, 5.15, 8.3):
        for y in (.53, 3.1):
            g.box(x, y, 4.23, 1.3, .10, .04, LIGHT, .019)


def entry_props(g):
    for x in (-3.26, 3.26):
        y = 5.80
        g.box(x, y, 1.281, .66, .51, .105, BRONZE, .04)
        g.loft([(x - .285, y - .21), (x + .285, y - .21), (x + .285, y + .21), (x - .285, y + .21)],
               [(x - .249, y - .20), (x + .249, y - .20), (x + .249, y + .16), (x - .249, y + .16)],
               1.386, 2.61, CUT)
        g.box(x, y + .176, 2.18, .46, .091, .392, BRONZE, .024)
        g.box(x, y + .229, 2.24, .36, .025, .267, TEAL, .013)
        for z, width in ((2.429, .208), (2.365, .169), (2.302, .228)):
            g.box(x, y + .25, z, width, .010, .015, LIGHT)
        g.box(x, y + .205, 1.993, .17, .039, .042, BRONZE, .010)
    x, y, z = 7.56, 6.63, 2.07
    rounded_stack(g, x, y, 2.85, 1.65, .23, .21, .49, CUT, .039)
    for idx, (radius, depth) in enumerate(((1.63, .22), (1.36, .12))):
        curve = []
        for i in range(46):
            angle = -.85 + math.pi * 1.71 * i / 45
            curve.append((x + radius * math.sin(angle), y + .23 * math.cos(angle) - .19 * idx,
                          z - .10 - radius * math.cos(angle)))
        for a, b in pairwise(curve):
            beam(g, a, b, depth, .18 if idx == 0 else .10, BRASS if idx else BRONZE, up=(0, 1, 0))
    ico = bmesh.new()
    try:
        bmesh.ops.create_icosphere(ico, subdivisions=1, radius=1.00)
        for face in ico.faces:
            offset = len(g.verts)
            g.verts.extend((x + v.co.x, y + v.co.y, z + v.co.z) for v in face.verts)
            g.face(tuple(range(offset, len(g.verts))), BRASS if face.normal.z > .21 else AMBER)
    finally:
        ico.free()
    g.box(-8.17, 4.23, 4.70, 1.53, .063, 3.00, BANNER, .026)
    for h in (4.70, 7.69):
        rod(g, (-9.01, 4.29, h), (-7.33, 4.29, h), .047, BRASS, sides=10)
    for i, h in enumerate((.50, .88, .67, 1.17, .71)):
        g.box(-8.65 + i * .244, 4.269, 5.15, .148, .012, h, IVORY)
    beam(g, (-8.79, 4.284, 5.09), (-7.62, 4.284, 5.43), .065, .018, BRASS)


def planter(stone, plants, x, y, w, d, z, seed):
    rounded_stack(stone, x, y, w, d, .285, z, .48, STONE, .034)
    rounded_stack(stone, x, y, w + .045, d + .045, .306, z + .40, .097, CUT, .017)
    plants.slab(round_rect(x, y, w - .20, d - .17, .18, 5), z + .492, z + .526, SHADOW)
    rng = random.Random(seed)
    bushes = max(1, int(w / .76))
    for i in range(bushes):
        cx = x - w / 2 + (i + .5) * w / bushes
        cy = y + rng.uniform(-.15, .15) * d
        radius = min(.36, d * .27)
        heights = (z + .52, z + .70, z + rng.uniform(.79, .88))
        for row, (low, high) in enumerate(pairwise(heights)):
            edge = circle(radius * (.69 if row == 0 else 1), 9, cx, cy)
            tip = circle(radius * (1 if row == 0 else .52), 9, cx, cy)
            plants.loft(edge, tip, low, high, OLIVE if i % 3 else DARK_LEAF)
    for i in range(round(w * d * 36)):
        px = x + rng.uniform(-w / 2 + .16, w / 2 - .16)
        py = y + rng.uniform(-d / 2 + .11, d / 2 - .11)
        h = z + rng.uniform(.56, .82)
        scale = rng.uniform(.064, .138)
        angle = rng.random() * math.tau
        for direction in (angle, angle + 2.1, angle + 4.1):
            dx, dy = math.cos(direction) * scale, math.sin(direction) * scale
            index = len(plants.verts)
            plants.verts.extend(((px, py, h - .06), (px + .65 * dx - .32 * dy, py + .65 * dy + .32 * dx, h + .02),
                                 (px + 1.65 * dx, py + 1.65 * dy, h), (px + .65 * dx + .32 * dy, py + .65 * dy - .32 * dx, h + .02)))
            plants.face((index, index + 3, index + 2, index + 1), rng.choice((DARK_LEAF, OLIVE, PALE_LEAF, OLIVE)))
        if i % 6 == 0:
            center = h + .016
            flower = GOLD_PETAL if i % 12 else ROSE_PETAL
            for n in range(5):
                a = n * math.tau / 5
                plants.surface(circle(.027, 5, px + .028 * math.cos(a), py + .028 * math.sin(a)), center, flower)
            plants.surface(circle(.019, 6, px, py), center + .003, IVORY)


def text_mesh(collection, title, name, font, location, size):
    text = bpy.data.curves.new(name, "FONT")
    text.body = title
    text.align_x = "CENTER"
    text.size, text.extrude, text.bevel_depth = size, .013, .004
    if font:
        text.font = font
    text.materials.append(bpy.data.materials["MAT_" + MATERIALS[IVORY][0]])
    obj = bpy.data.objects.new(name, text)
    collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (math.pi / 2, 0, math.pi)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    return bpy.context.view_layer.objects.active


def camera(scene, name, location, target, lens):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.clip_end = 200
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


def area_light(scene, name, location, target, power, color, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.color, data.size = power, color, size
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def construction_scene(font_path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    collection = bpy.data.collections.new("NEXCIV Public Construction Center")
    scene.collection.children.link(collection)
    scene.unit_settings.system = "METRIC"
    finish_textures()
    stone, frame, glass, interior_geom, fabric, vegetation = (Geometry() for _ in range(6))
    envelope(stone, frame, glass)
    terrace(stone, frame, glass)
    canopy(stone, frame)
    dome(stone, frame, glass)
    sail(stone, frame)
    crane(frame, glass)
    interior(interior_geom)
    entry_props(fabric)
    for i, spec in enumerate((
        (-7.39, 7.19, 5.93, 1.70, .20), (7.44, 7.30, 5.67, 1.36, .20),
        (-7.08, 5.62, 5.05, .91, 4.77), (8.12, 4.83, 3.81, .95, 4.77),
        (2.99, 4.81, 3.06, .91, 7.80), (-6.74, 3.41, 5.60, .89, 8.22),
    )):
        planter(stone, vegetation, *spec, seed=5300 + i)
    pieces = [
        make_part(collection, "01 Limestone facade, steps and terraces", stone),
        make_part(collection, "02 Bronze framework, dome lattice and crane", frame),
        make_part(collection, "03 Clear glazing", glass),
        make_part(collection, "04 Interior, furniture and illuminated displays", interior_geom, bevel=.017),
        make_part(collection, "05 Sculpture, terminals and banner", fabric, bevel=.009),
        make_part(collection, "06 Flowers and foliage", vegetation),
    ]
    font = bpy.data.fonts.load(str(font_path))
    pieces.append(text_mesh(collection, "公共建设中心", "07 Public Construction lettering · Chinese", font, (-.61, 6.705, 5.075), .65))
    pieces.append(text_mesh(collection, "PUBLIC CONSTRUCTION CENTER", "08 Public Construction lettering · English", None, (-.63, 6.705, 4.78), .254))
    scene.camera = camera(scene, "Street level", (7.4, 18.3, 3.85), (.2, 4.3, 3.42), 34)
    camera(scene, "Silhouette", (22, 39, 19), (0, 0, 7.0), 40)
    sun = bpy.data.lights.new("Evening sun", "SUN")
    sun.energy, sun.angle = 2.7, math.radians(14)
    key = bpy.data.objects.new("Evening sun", sun)
    scene.collection.objects.link(key)
    key.rotation_euler = (math.radians(36), math.radians(-28), math.radians(-125))
    sun.color = (1, .84, .63)
    area_light(scene, "Cool outdoor fill", (-5, 14, 12), (0, 0, 4), 1850, (.76, .85, 1), 16)
    area_light(scene, "Lobby warm light", (0, 3.2, 4.1), (0, 2.0, 1.2), 165, (1, .66, .36), 3)
    scene.world = bpy.data.worlds.new("Evening sky")
    scene.world.color = (.31, .33, .37)
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    return pieces


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--font", type=Path, default=Path("C:/Windows/Fonts/Dengb.ttf"))
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    pieces = construction_scene(args.font)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in pieces:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output / "Public_Construction_Rebuilt.blend"), compress=True)
    for obj in pieces:
        obj.location += Vector(ANCHOR)
        obj["previewTier"] = "works_rebuilt"
    bpy.context.view_layer.update()
    path = output / "public-construction-rebuilt.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True, export_apply=True,
        export_animations=False, export_extras=True, export_cameras=False, export_lights=False,
        export_image_format="AUTO", export_meshopt_compression_enable=True,
        export_meshopt_extension="EXT_meshopt_compression",
    )
    print(f"WORKS BUILT {len(pieces)} editable components, {path.stat().st_size:,} bytes", flush=True)


if __name__ == "__main__":
    main()
