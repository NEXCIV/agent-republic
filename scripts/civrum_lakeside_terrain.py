"""Sculpt and plant the continuous parkland outside the city parcels."""

import math
import random
from itertools import pairwise

import bmesh
import bpy
from build_civrum_world import Geometry, circle
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.noise import noise

NEAR_BANK = (
    (-570, 149),
    (-309, 219),
    (-255, 181),
    (-216, 134),
    (-188, 136),
    (-164, 172),
    (153, 172),
    (175, 167),
    (213, 128),
    (246, 143),
    (313, 215),
    (570, 207),
)
FAR_BANK = (
    (-309, 219),
    (-282, 275),
    (-239, 329),
    (-196, 352),
    (-130, 355),
    (-56, 367),
    (38, 349),
    (104, 334),
    (169, 344),
    (221, 303),
    (277, 269),
    (313, 215),
)
WATER_HEIGHT = -1.34


def smooth(t):
    t = max(0, min(1, t))
    return t * t * (3 - 2 * t)


def bank_height(samples, x):
    for (start, low), (end, high) in pairwise(samples):
        if start <= x <= end:
            return low + (high - low) * smooth((x - start) / (end - start))
    return samples[0][1] if x < samples[0][0] else samples[-1][1]


def near_bank(x):
    wiggle = math.sin(x * 0.232) * 0.62 + math.sin(x * 0.091) * 1.36
    outside_quay = smooth((abs(x) - 154) / 23)
    inside_lake = smooth(min(x + 309, 313 - x) / 18)
    return bank_height(NEAR_BANK, x) + wiggle * outside_quay * inside_lake


def far_bank(x):
    if not -309 < x < 313:
        return near_bank(x)
    fade = smooth(min(x + 309, 313 - x) / 22)
    return bank_height(FAR_BANK, x) + math.sin(x * 0.125) * 1.46 * fade + math.sin(x * 0.35) * 0.5 * fade


def ground_height(x, y, far=False):
    if far:
        fade = smooth((y - far_bank(x)) / 22)
        base = 17
    else:
        setback = max(abs(x) - 163, -y - 169)
        fade = smooth(setback / 32) * smooth((near_bank(x) - y) / 18)
        base = 10
    broad = noise(Vector((x * 0.009, y * 0.011, 1.28)))
    detail = noise(Vector((x * 0.026, y * 0.027, 3.83)))
    return -0.055 + fade * (base * (0.5 + 0.62 * broad) + 3.8 * detail)


def ground_surface(group, name, xs, bank, limit, surface, make_mesh, far):
    band_count = math.ceil(max(abs(limit - bank(x)) for x in xs) / 5)
    points = []
    for row in range(band_count + 1):
        for x in xs:
            border = bank(x)
            t = row / band_count
            y = border + (limit - border) * (t if far else t**1.30)
            points.append((x, y, ground_height(x, y, far)))
    width = len(xs)
    faces = []
    for row in range(band_count):
        for col in range(width - 1):
            i = row * width + col
            corners = (i, i + 1, i + width + 1, i + width)
            faces.append(corners if far else tuple(reversed(corners)))
    land = make_mesh(group, name, points, faces, surface)
    for face in land.data.polygons:
        face.use_smooth = True
    return land


def trail_x(side, y):
    return side * (173.8 + 8.5 * math.sin(y * 0.019 + side * 0.61) + 3.9 * math.sin(y * 0.048))


def trail(group, name, route, width, surface, make_mesh, terrain):
    vertices = []
    for i, (x, y) in enumerate(route):
        before = Vector(route[max(0, i - 1)])
        after = Vector(route[min(i + 1, len(route) - 1)])
        tangent = (after - before).normalized()
        normal = Vector((-tangent.y, tangent.x))
        for side in (-1, 1):
            px, py = Vector((x, y)) + normal * side * width * 0.5
            point, *_ = terrain.ray_cast((px, py, 100), (0, 0, -1), 200)
            vertices.append((px, py, point.z + 0.13))
    faces = [(i, i + 2, i + 3, i + 1) for i in range(0, len(vertices) - 2, 2)]
    make_mesh(group, name, vertices, faces, surface)


def park_trails(group, surface, make_mesh, near_land, far_land):
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    near_terrain = BVHTree.FromObject(near_land, graph)
    far_terrain = BVHTree.FromObject(far_land, graph)
    for side in (-1, 1):
        start = [(side * 162.1, -154), (side * 165.4, -153.3)]
        route = start + [
            (trail_x(side, y), y) for y in range(-152, 172, 2) if y < near_bank(trail_x(side, y)) - 5
        ]
        trail(group, "Meadow walking path", route, 2.25, surface, make_mesh, near_terrain)
    far_route = [(x, far_bank(x) + 13 + 2.9 * math.sin(x * 0.031)) for x in range(-265, 267, 2)]
    trail(group, "Far shore trail", far_route, 2.10, surface, make_mesh, far_terrain)


def canopy_part(model, position, axes, material_index, rng):
    sphere = bmesh.ops.create_icosphere(model, subdivisions=2, radius=1)
    new_verts = sphere["verts"]
    for vertex in new_verts:
        wobble = rng.uniform(0.89, 1.12)
        vertex.co = Vector(position) + Vector(tuple(a * c * wobble for a, c in zip(axes, vertex.co)))
    for face in {face for vertex in new_verts for face in vertex.link_faces}:
        face.smooth = True
        face.material_index = material_index


def woodland_mesh(variant, palette):
    """Share a few irregular crown profiles in the forest and along the promenade."""
    rng = random.Random(1048 + variant)
    geometry = Geometry()
    height = (7.8, 9.8, 6.2, 10.4, 7.2, 5.4)[variant]
    trunk_height = height * 0.58
    geometry.loft(circle(0.20, 8), circle(0.095, 8, 0.11, -0.05), 0, trunk_height, 0)
    trunk = geometry.mesh(f"CIVRUM shore tree {variant + 1}", palette[:1])
    for (name,) in palette[1:]:
        trunk.materials.append(bpy.data.materials["MAT_" + name])
    model = bmesh.new()
    model.from_mesh(trunk)
    if variant in (3, 5):
        for level in range(4):
            h = height * (0.47 + level * 0.132)
            width = (1.80 - level * 0.34) * height / 9
            for part in range(4):
                angle = part * math.tau / 4 + level * 0.51
                distance = width * 0.45
                canopy_part(
                    model,
                    (math.cos(angle) * distance, math.sin(angle) * distance, h),
                    (width, width * 0.85, height * 0.15),
                    5 + (level + part) % 2,
                    rng,
                )
    else:
        for part in range(13):
            angle = part * 2.399
            edge = part < 9
            distance = rng.uniform(0.7, 2.1) * (1 if edge else 0.43) * height / 8.2
            h = height * (rng.uniform(0.62, 0.82) if edge else rng.uniform(0.80, 0.94))
            radius = rng.uniform(1.08, 1.75) * height / 8.2
            material_index = (3 if variant in (2, 4) else 1) + (part % 3 == 0)
            canopy_part(
                model,
                (distance * math.cos(angle), distance * math.sin(angle), h),
                (radius, radius * 0.86, radius * 1.08),
                material_index,
                rng,
            )
    model.to_mesh(trunk)
    model.free()
    return trunk


def plant_park(group, material, place):
    palettes = (("BARK",),)
    for key, tint in (
        ("Oak", "4E6735"),
        ("Oak_Tip", "7B8C49"),
        ("Autumn", "96733C"),
        ("Autumn_Tip", "AE8D4C"),
        ("Pine", "375647"),
        ("Pine_Tip", "566D45"),
    ):
        name = "Shore_" + key
        material("MAT_" + name, tint, 0.85)
        palettes += ((name,),)
    models = [woodland_mesh(i, palettes) for i in range(6)]
    rng = random.Random(4873)
    for side in (-1, 1):
        for dx in range(172, 343, 5):
            for dy in range(-196, 226, 5):
                x = side * (dx + rng.uniform(-2.1, 2.1))
                y = dy + rng.uniform(-2.1, 2.1)
                if y > near_bank(x) - 5 or abs(x - trail_x(side, y)) < 4.8:
                    continue
                if abs(y + 162) < 8 and abs(x) < 203:
                    continue
                grove = noise(Vector((x * 0.028, y * 0.027, 7.14)))
                if rng.random() > max(0.025, min(0.82, 0.19 + grove * 1.14)):
                    continue
                model = rng.choices(models, weights=(4, 3, 1, 2.8, 1.0, 0.7))[0]
                tree = place(
                    group, "Park woodland", model, x, y, ground_height(x, y) - 0.12, rng.uniform(0, 360)
                )
                tree.scale = (rng.uniform(0.72, 1.1), rng.uniform(0.78, 1.13), rng.uniform(0.73, 1.23))
    for px in range(-302, 308, 4):
        for row in (5, 22, 28, 34, 44, 54, 66):
            x = px + rng.uniform(-2.15, 2.15)
            y = far_bank(x) + row + rng.uniform(-2, 2)
            density = noise(Vector((x * 0.010, y * 0.026, 9.34)))
            if rng.random() < 0.70 + density * 0.54:
                model = rng.choices(models, weights=(3, 2, 0.5, 3, 1, 1))[0]
                tree = place(
                    group,
                    "Far bank woodland",
                    model,
                    x,
                    y,
                    ground_height(x, y, True) - 0.13,
                    rng.uniform(0, 360),
                )
                s = rng.uniform(0.58, 1.19)
                tree.scale = (s, s, s * rng.uniform(0.85, 1.17))
    return models


def shoreline_rocks(group, material, place):
    shades = [
        material(f"LAKE_Shore rock {i}", tint, 0.86)
        for i, tint in enumerate(("796D56", "72746A", "918574"), 1)
    ]
    rng = random.Random(6871)
    rocks = []
    for i, shade in enumerate(shades):
        data = bpy.data.meshes.new(f"Lakeside shingle boulder {i + 1}")
        model = bmesh.new()
        canopy_part(model, (0, 0, 0), (1.42, 0.83, 0.54), 0, rng)
        model.to_mesh(data)
        model.free()
        data.materials.append(shade)
        rocks.append(data)
    near_sites = (*range(-289, -162, 6), *range(159, 291, 6))
    for bank, side, sites in ((near_bank, 1, near_sites), (far_bank, -1, range(-274, 279, 9))):
        for center in sites:
            if rng.random() < 0.20:
                continue
            for _ in range(rng.randint(2, 5)):
                x = center + rng.uniform(-2.5, 2.5)
                depth = rng.uniform(-0.25, 1.15)
                y = bank(x) + side * depth
                obj = place(
                    group,
                    "Shingle boulder",
                    rng.choice(rocks),
                    x,
                    y,
                    -0.09 - max(0, depth) * 0.73,
                    rng.uniform(0, 360),
                )
                s = rng.uniform(0.45, 1.18)
                obj.scale = (s, s * rng.uniform(0.75, 1.1), s * rng.uniform(0.76, 1.28))
