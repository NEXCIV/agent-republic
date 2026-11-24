"""Build a lakeside lighting study from the packed CIVRUM 300 m master."""

import argparse
import math
import random
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_world import Geometry
from civrum_lakeside_blocks import (
    avenue_trees,
    facades,
    garden_paving,
    place,
    public_spaces,
    replace_infill,
    service_vehicles,
    street_walls,
    terraces,
)
from civrum_lakeside_terrain import (
    WATER_HEIGHT,
    far_bank,
    ground_surface,
    near_bank,
    park_trails,
    plant_park,
    shoreline_rocks,
)
from prepare_civrum_hi3d import ASSETS, HI3D

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "art-direction/world-upgrade-v1"
MASTER = PROJECT / "landmark-masters/CIVRUM_World_300m_Master.blend"
OUTPUT = PROJECT / "lakeside-study"
TOWER_DIR = ROOT / "art-direction/hi3d/lakeside-tower-v1"
TOWER_SOURCE = TOWER_DIR / "Hi3D_现代豪华摩天大楼3D模型_allparts_20261125_000239.glb"
TOWER_LIBRARY = TOWER_DIR / "CIVRUM_Lakeside_Tower.blend"
TOWER_COLLECTION = "CIVRUM | Lakeside Tower"
TOWER_PLACEMENT = (-83, 145.2, .185)
TOWER_HEIGHT = 37


def color(hex_code):
    components = [int(hex_code[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(
        value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4
        for value in components
    ) + (1,)


def collection(parent, name):
    result = bpy.data.collections.new(name)
    parent.children.link(result)
    return result


def shader(material):
    return next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")


def material(name, tint, roughness=.72, metallic=0, emission=0):
    result = bpy.data.materials.new(name)
    result.diffuse_color = color(tint)
    result.use_nodes = True
    surface = shader(result)
    surface.inputs["Base Color"].default_value = result.diffuse_color
    surface.inputs["Roughness"].default_value = roughness
    surface.inputs["Metallic"].default_value = metallic
    surface.inputs["Emission Color"].default_value = result.diffuse_color
    surface.inputs["Emission Strength"].default_value = emission
    return result


def noise(tree, source, scale, detail=3):
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.inputs["Scale"].default_value = scale
    node.inputs["Detail"].default_value = detail
    tree.links.new(source, node.inputs["Vector"])
    return node


def ramp(tree, source, low, high):
    node = tree.nodes.new("ShaderNodeValToRGB")
    for point, settings in zip(node.color_ramp.elements, (low, high)):
        point.position, point.color = settings
    tree.links.new(source, node.inputs[0])
    return node.outputs["Color"]


def textured(name, tint, variation, scale, grain, strength=.16):
    result = material(name, tint)
    tree = result.node_tree
    surface = shader(result)
    coord = tree.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    mottling = noise(tree, coord, scale)
    pigment = ramp(tree, mottling.outputs["Fac"], (.24, color(tint)), (.83, color(variation)))
    tree.links.new(pigment, surface.inputs["Base Color"])
    if grain:
        bump = tree.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = strength
        bump.inputs["Distance"].default_value = .037
        tree.links.new(noise(tree, coord, grain, 2).outputs["Fac"], bump.inputs["Height"])
        tree.links.new(bump.outputs[0], surface.inputs["Normal"])
    return result


def point_light(group, name, position):
    data = bpy.data.lights.new(name, "POINT")
    data.energy = 72
    data.shadow_soft_size = .22
    data.color = (1, .65, .36)
    obj = bpy.data.objects.new(name, data)
    group.objects.link(obj)
    obj.location = position


def mesh(group, name, vertices, faces, surface):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    group.objects.link(obj)
    data.materials.append(surface)
    return obj


def box(group, name, x, y, z, width, depth, height, surface):
    # Share unit-box data by material. Positions describe the centre of each part.
    key = "Lake study unit box | " + surface.name
    data = bpy.data.meshes.get(key)
    if data is None:
        verts = [(a, b, c) for c in (-.5, .5) for a, b in ((-.5, -.5), (.5, -.5), (.5, .5), (-.5, .5))]
        obj = mesh(group, name, verts, [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
                                        (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], surface)
        obj.data.name = key
    else:
        obj = bpy.data.objects.new(name, data)
        group.objects.link(obj)
    obj.location = (x, y, z)
    obj.scale = (width, depth, height)
    return obj


def band(group, name, low, high, surface):
    count = len(low)
    faces = [(i, i + 1, count + i + 1, count + i) for i in range(count - 1)]
    return mesh(group, name, low + high, faces, surface)


def make_water(group, shore):
    water = material("LAKE_Water", "244C67", 0.22, 0.06)
    tree = water.node_tree
    surface = shader(water)
    surface.inputs["IOR"].default_value = 1.333
    surface.inputs["Coat Weight"].default_value = 0.28
    surface.inputs["Coat Roughness"].default_value = 0.16
    coord = tree.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    wind = tree.nodes.new("ShaderNodeVectorMath")
    wind.operation = "MULTIPLY"
    wind.inputs[1].default_value = (0.58, 2.2, 1)
    tree.links.new(coord, wind.inputs[0])
    ripples = noise(tree, wind.outputs[0], 1.35, 3)
    swell = noise(tree, wind.outputs[0], 0.18, 3)
    long_bump = tree.nodes.new("ShaderNodeBump")
    long_bump.inputs["Strength"].default_value = 0.34
    long_bump.inputs["Distance"].default_value = 0.26
    tree.links.new(swell.outputs["Fac"], long_bump.inputs["Height"])
    ripple_bump = tree.nodes.new("ShaderNodeBump")
    ripple_bump.inputs["Strength"].default_value = 0.44
    ripple_bump.inputs["Distance"].default_value = 0.11
    tree.links.new(long_bump.outputs["Normal"], ripple_bump.inputs["Normal"])
    tree.links.new(ripples.outputs["Fac"], ripple_bump.inputs["Height"])
    tree.links.new(ripple_bump.outputs[0], surface.inputs["Normal"])
    tree.links.new(ripple_bump.outputs[0], surface.inputs["Coat Normal"])
    tree.links.new(
        ramp(tree, swell.outputs["Fac"], (0.19, (0.12, 0.12, 0.12, 1)), (0.80, (0.26, 0.26, 0.26, 1))),
        surface.inputs["Roughness"],
    )
    shades = tree.nodes.new("ShaderNodeVertexColor")
    shades.layer_name = "Water depth tint"
    tree.links.new(shades.outputs["Color"], surface.inputs["Base Color"])

    # The narrow outer bands provide a smooth shallow-to-deep colour transition.
    depths = [0, 0.018, 0.065, 0.19, 0.5, 0.81, 0.935, 0.982, 1]
    tints = ["6A8B6E", "4F837D", "356773", "25496D", "243C60", "264668", "2E5D6D", "42736F", "64826D"]
    span = len(shore)
    vertices = [
        (x, near + fraction * (far - near), WATER_HEIGHT) for fraction in depths for x, near, far in shore
    ]
    faces = [
        (row * span + i, row * span + i + 1, (row + 1) * span + i + 1, (row + 1) * span + i)
        for row in range(len(depths) - 1)
        for i in range(span - 1)
    ]
    sheet = mesh(group, "CIVRUM_Lake_Surface", vertices, faces, water)
    tint = sheet.data.color_attributes.new(name=shades.layer_name, type="FLOAT_COLOR", domain="POINT")
    tint.data.foreach_set(
        "color", [component for shade in tints for _ in shore for component in color(shade)]
    )


def moored_boats(group):
    palette = tuple((name,) for name in ("LAKE_Hull", "LAKE_Deck", "LAKE_Glass", "LAKE_Bench", "LAKE_Trim"))
    for (name,), tint, rough, metal in zip(
        palette,
        ("25454D", "E6D7B9", "4B6D7B", "876249", "AD975C"),
        (0.28, 0.47, 0.20, 0.70, 0.28),
        (0.25, 0.0, 0.35, 0.0, 0.48),
    ):
        material("MAT_" + name, tint, rough, metal)
    hull = [
        (-1.53, -3.96),
        (1.53, -3.96),
        (1.63, 1.58),
        (1.04, 3.20),
        (0, 4.66),
        (-1.04, 3.20),
        (-1.63, 1.58),
    ]
    rope_surface = material("LAKE_Mooring line", "B2A58C", 0.92)
    for x, y, angle, size, cabin in (
        (-90.7, 191, -4, 1.0, True),
        (-102.6, 190.5, 176, 0.76, False),
        (76.7, 183.7, 2, 0.87, False),
        (65.5, 192.3, 178, 0.96, True),
    ):
        boat = Geometry()
        keel = [(dx * 0.60, dy * 0.92) for dx, dy in hull]
        boat.loft(keel, hull, -0.64, 0.59, 0, 1)
        boat.band(hull, [(dx * 0.87, dy * 0.91) for dx, dy in hull], 0.605, 4)
        boat.box(0, -1.8, 0.603, 2.45, 0.78, 0.43, 3, 0.13)
        boat.box(0, -3.11, 0.603, 2.36, 0.61, 0.34, 3, 0.10)
        if cabin:
            boat.box(0, 0.80, 0.601, 2.17, 3.28, 0.66, 1, 0.19)
            boat.loft(
                [(-1.06, -0.81), (1.06, -0.81), (1.06, 2.44), (-1.06, 2.44)],
                [(-0.91, -0.81), (0.91, -0.81), (0.91, 2.05), (-0.91, 2.05)],
                1.26,
                2.18,
                2,
            )
            boat.box(0, 0.64, 2.18, 2.13, 3.07, 0.17, 1, 0.25)
            for side in (-1, 1):
                for yy in (-0.80, 0.42, 1.83):
                    boat.loft(
                        [
                            (side * 1.06 + dx, yy + dy)
                            for dx, dy in ((-0.038, -0.033), (0.038, -0.033), (0.038, 0.033), (-0.038, 0.033))
                        ],
                        [
                            (side * 0.92 + dx, yy - 0.12 + dy)
                            for dx, dy in ((-0.038, -0.033), (0.038, -0.033), (0.038, 0.033), (-0.038, 0.033))
                        ],
                        1.27,
                        2.19,
                        4,
                    )
        else:
            boat.box(0, 1.3, 0.601, 1.98, 0.91, 0.59, 1, 0.13)
            boat.box(0, 1.39, 1.18, 1.91, 0.14, 0.55, 2, 0.035)
        boat.box(0, -4.04, 0.10, 0.71, 0.42, 0.77, 0, 0.08)
        obj = place(group, "Marina boat", boat.mesh("Harbour motorboat", palette), x, y, WATER_HEIGHT, angle)
        obj.scale = (size,) * 3
        dock = -96 if x < 0 else 71
        side = math.copysign(1, x - dock)
        inward = math.copysign(1, -side * math.cos(math.radians(angle)))
        tie_x = dock + side * 3.07
        cleats = range(174, 172 + (31 if dock < 0 else 25) - 1, 3)
        for end in (-1, 1):
            local = Vector((inward * 1.23, end * 2.96, 0.636)) * size
            local.rotate(obj.rotation_euler.to_matrix())
            start = obj.location + local
            tie_y = min(cleats, key=lambda position: abs(position - start.y))
            finish = Vector((tie_x, tie_y, 0.28))
            middle = (start + finish) * 0.5
            middle.z -= 0.18
            curve = bpy.data.curves.new("Dock line", "CURVE")
            curve.dimensions = "3D"
            curve.bevel_depth = 0.027
            curve.bevel_resolution = 2
            curve.materials.append(rope_surface)
            rope = curve.splines.new("BEZIER")
            rope.bezier_points.add(2)
            for point, position in zip(rope.bezier_points, (start, middle, finish)):
                point.co = position
                point.handle_left_type = point.handle_right_type = "AUTO"
            place(group, "Mooring line", curve, 0, 0, 0)


def waterfront_tiles():
    paving = material("LAKE_Bluestone pavers", "928B79", 0.77)
    tree = paving.node_tree
    pattern = tree.nodes.new("ShaderNodeTexBrick")
    pattern.offset_frequency = 2
    for name, value in (
        ("Color1", color("9B907E")),
        ("Color2", color("B2A793")),
        ("Mortar", color("625A50")),
        ("Scale", 1),
        ("Mortar Size", 0.018),
        ("Mortar Smooth", 0.014),
        ("Brick Width", 1.36),
        ("Row Height", 0.83),
    ):
        pattern.inputs[name].default_value = value
    tree.links.new(tree.nodes.new("ShaderNodeNewGeometry").outputs["Position"], pattern.inputs["Vector"])
    tree.links.new(pattern.outputs["Color"], shader(paving).inputs["Base Color"])
    return paving


def corner_gardens(ground, planting, trees, paving, stone, planted):
    benches = bpy.data.objects["CIVRUM_PROP_BENCH_01"].data
    for side in (-1, 1):
        x, y = side * 141.0, -141.35
        box(ground, "South gate pocket garden", x, y, 0.07, 12.4, 12.0, 0.15, paving)
        for dx, dy, width, depth in ((side * 3.30, 0.94, 4.3, 8.8), (-side * 2.1, -3.38, 5.6, 3.09)):
            box(ground, "Pocket garden planter edge", x + dx, y + dy, 0.205, width, depth, 0.15, stone)
            box(
                ground,
                "Pocket garden planting bed",
                x + dx,
                y + dy,
                0.284,
                width - 0.23,
                depth - 0.23,
                0.045,
                planted,
            )
        for i, dy in enumerate((-1.02, 3.32)):
            tree = place(
                planting,
                "Pocket garden oak",
                trees[(i + 2 * side) % 4],
                x + side * 3.2,
                y + dy,
                0.30,
                side * 90,
            )
            tree.scale = (0.59, 0.59, 0.60)
        place(ground, "Pocket garden bench", benches, x - side * 0.2, y + 0.8, 0.147, -side * 90)


def build_landscape(parent):
    ground = collection(parent, "01 | Terrain and shore")
    water = collection(parent, "02 | Lake")
    promenade = collection(parent, "03 | Promenade and piers")
    planting = collection(parent, "04 | Shore trees")
    land = textured("LAKE_Meadow", "354D35", "908450", 0.028, 2.6, 0.28)
    sand = textured("LAKE_Shingle", "555041", "9C8B69", 0.54, 3.7, 0.25)
    shallows = textured("LAKE_Wet shingle", "5C6453", "7D8268", 0.49, 4.5, 0.25)
    stone = textured("LAKE_Quay limestone", "827367", "C4AF98", 0.22, 6)
    timber = material("LAKE_Warm teak", "856449", 0.63)
    timber_tones = [
        timber,
        material("LAKE_Pier sun-bleached teak", "A68A65"),
        material("LAKE_Pier dark teak", "755743"),
    ]
    iron = material("LAKE_Blackened metal", "292C2D", 0.33, 0.45)
    brass = material("LAKE_Handrail bronze", "92734A", 0.31, 0.58)
    lens = material("LAKE_Lantern lens", "FFD294", 0.28, emission=1.8)
    paving = waterfront_tiles()
    paving_edge = material("LAKE_Granite edging", "B6AA92")
    park_path = textured("LAKE_Gravel path", "9A8B68", "BCAF86", 0.68, 3.3)
    planted = material("LAKE_Promenade planting", "485C3C", 0.90)
    seam = material("LAKE_Paving joints", "555044")
    drive = textured("LAKE_Connector asphalt", "343942", "42444A", 0.33, 5)

    shore_x = sorted({-309, 313, -150, 150, *range(-308, 313, 2)})
    shore = [(x, near_bank(x), far_bank(x)) for x in shore_x]
    make_water(water, shore)
    terrain_x = [*range(-570, -310, 6), *shore_x, *range(318, 571, 6)]
    near_land = ground_surface(ground, "City parkland", terrain_x, near_bank, -480, land, mesh, far=False)
    far_land = ground_surface(ground, "Far shore parkland", terrain_x, far_bank, 760, land, mesh, far=True)
    for bank, side in ((near_bank, 1), (far_bank, -1)):
        start = [(x, bank(x), -0.056) for x in shore_x]
        waterline = [(x, bank(x) + side * 1.75, -1.29) for x in shore_x]
        end = [(x, bank(x) + side * 4.4, -2.35) for x in shore_x]
        band(ground, "Dry shingle bank", *((start, waterline) if side == 1 else (waterline, start)), sand)
        band(ground, "Wet shingle bank", *((waterline, end) if side == 1 else (end, waterline)), shallows)
    park_trails(ground, park_path, mesh, near_land, far_land)
    shoreline_rocks(ground, material, place)

    # Piers extend from a continuous 11 m wide walk behind the existing city grid.
    box(promenade, "Quay masonry", 0, 170.8, -0.68, 302, 2.5, 1.85, stone)
    box(promenade, "Quay lower band", 0, 171.84, -0.93, 302, 0.52, 0.13, paving_edge)
    box(promenade, "Quay coping", 0, 172.05, 0.20, 302, 0.59, 0.23, stone)
    box(promenade, "Promenade underlay", 0, 165.5, 0.055, 302, 12.5, 0.21, seam)
    box(promenade, "Civic granite walk", 0, 164.95, 0.155, 302, 11.1, 0.07, paving)
    box(promenade, "Walking lane inlay", 0, 162.4, 0.197, 300, 0.115, 0.014, brass)
    for y, width, surf in (
        (160.12, 0.18, paving_edge),
        (164.62, 0.11, seam),
        (167.5, 0.12, paving_edge),
        (170.28, 0.24, seam),
    ):
        box(promenade, "Promenade paving course", 0, y, 0.197, 300, width, 0.015, surf)
    for x in (-64, 0, 64):
        box(promenade, "Footway connection", x, 154.55, 0.04, 5.0 if x else 10, 9.5, 0.11, paving)
    for x in range(-148, 150, 5):
        box(promenade, "Paving joint", x, 165.0, 0.194, 0.036, 11, 0.006, seam)
    for x in range(-147, 151, 6):
        box(promenade, "Quay panel joint", x, 172.095, -0.51, 0.047, 0.052, 1.36, seam)
        box(promenade, "Quay stone pilaster", x + 0.18, 172.18, -0.59, 0.31, 0.28, 1.4, stone)
    for x in range(-148, 149, 4):
        if min(abs(x + 96), abs(x - 71)) < 4.25:
            continue
        box(promenade, "Quay rail post", x, 171.59, 0.70, 0.11, 0.11, 1.02, iron)
        box(promenade, "Quay upper rail", x + 1.8, 171.59, 1.20, 3.78, 0.075, 0.075, brass)
        box(promenade, "Quay lower rail", x + 1.8, 171.59, 0.51, 3.78, 0.041, 0.065, iron)
    for x, length, tip in ((-96, 31, -1), (71, 25, 1)):
        width = 6.6
        box(promenade, "Pier deck beams", x, 172 + length / 2, -0.27, width, length, 0.45, iron)
        plank_count = math.ceil(length / 0.44)
        for i in range(plank_count):
            step = length / plank_count
            surf = timber_tones[1 if i % 7 in (1, 3) else 2 if i % 5 == 0 else 0]
            box(
                promenade,
                "Pier timber board",
                x,
                172 + (i + 0.5) * step,
                0.010,
                width + 0.22,
                step - 0.020,
                0.16,
                surf,
            )
        for side in (-1, 1):
            xx = x + side * 3.35
            box(promenade, "Dock edge beam", xx, 172 + length / 2, 0.073, 0.23, length, 0.27, iron)
            for i in range(2, length - 1, 3):
                box(
                    promenade,
                    "Dock mooring bollard",
                    xx - side * 0.28,
                    172 + i,
                    0.20,
                    0.17,
                    0.22,
                    0.23,
                    brass,
                )
            for start, end in ((173, 181 if x < 0 else 177.5), (172 + length - 5.5, 172 + length - 1)):
                box(
                    promenade,
                    "Pier rail handhold",
                    xx,
                    (start + end) / 2,
                    1.05,
                    0.08,
                    end - start,
                    0.075,
                    brass,
                )
                box(
                    promenade,
                    "Pier rail lower bar",
                    xx,
                    (start + end) / 2,
                    0.48,
                    0.052,
                    end - start,
                    0.062,
                    iron,
                )
                count = math.ceil((end - start) / 2.9)
                for i in range(count + 1):
                    box(
                        promenade,
                        "Pier rail upright",
                        xx,
                        start + (end - start) * i / count,
                        0.57,
                        0.09,
                        0.09,
                        0.98,
                        iron,
                    )
        for i in range(2, length, 5):
            for side in (-1, 1):
                box(promenade, "Pier pile", x + side * 2.6, 172 + i, -1.52, 0.34, 0.34, 3.45, timber)
                box(promenade, "Pier lantern", x + side * 2.6, 172 + i, 0.253, 0.21, 0.21, 0.24, lens)
        box(promenade, "Lateral landing", x + tip * 4.3, 171.2 + length, -0.06, 12.3, 4.5, 0.30, timber)
        tip_x = x + tip * 6.0
        tip_y = 171.2 + length
        for dx in (-2.2, 2.2):
            for dy in (-1.41, 1.41):
                box(
                    promenade, "Landing support pile", tip_x + dx, tip_y + dy, -1.50, 0.31, 0.31, 3.02, timber
                )
                box(promenade, "Pier shelter column", tip_x + dx, tip_y + dy, 1.50, 0.19, 0.19, 2.81, iron)
        for i in range(11):
            box(
                promenade,
                "Pier shelter slat",
                tip_x + (i - 5) * 0.46,
                tip_y,
                2.91,
                0.25,
                3.56,
                0.18,
                timber_tones[i % len(timber_tones)],
            )
        box(promenade, "Pier shelter seat", tip_x, tip_y + 0.92, 0.55, 3.6, 0.46, 0.13, timber)
        for step in range(3):
            box(
                promenade,
                "Pier access stair",
                x,
                171.96 + step * 0.28,
                0.184 - step * 0.041,
                width,
                0.32,
                0.14,
                stone,
            )

    moored_boats(collection(promenade, "Marina boats"))
    prototypes = plant_park(planting, material, place)
    corner_gardens(ground, planting, prototypes, paving, stone, planted)
    rng = random.Random(8093)
    for i, x in enumerate(range(-137, 141, 9)):
        if min(abs(x - v) for v in (-96, -83, -64, 0, 64, 71, 81.5)) < 4.2:
            continue
        box(promenade, "Quay tree bed coping", x, 160.05, 0.240, 4.7, 2.50, 0.18, stone)
        box(promenade, "Quay tree bed fill", x, 160.05, 0.325, 4.35, 2.18, 0.06, planted)
        tree = place(
            planting,
            "Quayside tree",
            prototypes[(i + i // 3) % len(prototypes)],
            x,
            160.05,
            0.35,
            rng.uniform(0, 360),
        )
        tree.scale = (rng.uniform(0.42, 0.54),) * 3
    for side in (-1, 1):
        box(ground, "Park perimeter lane", side * 156.8, -5, -0.016, 5.6, 314, 0.05, drive)
        box(ground, "Park roadside footpath", side * 161.3, -4, 0.04, 2.2, 310, 0.12, paving)
        for y in (-126, 0, 126):
            box(ground, "West and east street approach", side * 152.1, y, -0.016, 5, 7, 0.05, drive)
        for y in range(-153, 149, 9):
            if min(abs(y - v) for v in (-126, 0, 126)) > 5:
                box(ground, "Park lane marking", side * 156.8, y, 0.012, 0.10, 2.65, 0.008, paving)
    for x in (-126, -101, -68, -33, 29, 61, 102, 129):
        bench = bpy.data.objects.new("Quay bench", bpy.data.objects["CIVRUM_PROP_BENCH_01"].data)
        promenade.objects.link(bench)
        bench.location = (x, 168.0, 0.198)
        bench.rotation_euler.z = math.pi
    box(ground, "Southern belt road", 0, -162.5, -0.016, 390, 8.4, 0.05, drive)
    box(ground, "South park cycleway", 0, -169.1, 0.016, 335, 2.45, 0.06, park_path)
    for i, x in enumerate(range(-156, 157, 8)):
        if min(abs(x - v) for v in (-126, -64, 0, 64, 126)) >= 7:
            box(ground, "Belt road planted verge", x, -154.9, 0.087, 7.2, 3.9, 0.22, stone)
            box(ground, "Belt road planted verge fill", x, -154.9, 0.202, 6.9, 3.6, 0.034, planted)
            if i % 2 == 0:
                tree = place(
                    planting,
                    "South entry tree",
                    prototypes[(x // 8) % 6],
                    x,
                    -154.9,
                    0.22,
                    rng.uniform(0, 360),
                )
                tree.scale = (0.49, 0.49, 0.54)
    for x in range(-186, 193, 8):
        if min(abs(x - lane) for lane in (-126, -64, 0, 64, 126)) > 7:
            box(ground, "Belt road lane marking", x, -162.5, 0.020, 2.6, 0.14, 0.006, brass)
    for x in (-126, -64, 0, 64, 126):
        box(ground, "Southern approach", x, -156.2, -0.016, 10 if x == 0 else 7, 12.8, 0.05, drive)
    for x in range(-139, 144, 16):
        box(promenade, "Lantern stand", x, 169.24, 1.66, 0.12, 0.12, 3.02, iron)
        box(promenade, "Lantern diffuser", x, 169.24, 3.18, 0.27, 0.25, 0.18, lens)
        box(promenade, "Lantern cap", x, 169.24, 3.30, 0.34, 0.32, 0.07, brass)
        point_light(promenade, "Quay lantern light", (x, 169.24, 3.04))
        box(promenade, "Stone planter", x + 4.1, 160.42, 0.35, 3.6, 1.22, 0.51, stone)
        shrub = bpy.data.objects.new("Promenade planter shrub", bpy.data.objects["CIVRUM_SHRUB_01"].data)
        planting.objects.link(shrub)
        shrub.location = (x + 4.1, 160.42, 0.61)
        shrub.scale = (1.64, 0.66, 0.63)


def tune_city():
    sweep = bpy.data.objects["CIVRUM_STUDIO_GROUND_SWEEP"]
    sweep.hide_render = True
    sweep.hide_viewport = True
    base = bpy.data.objects["CIVRUM_ENV_GROUND_MAIN"]
    base.data.materials[0] = textured("LAKE_City gravel and stone", "6F716A", "AAA491", 0.105, 4.2)
    road = shader(bpy.data.materials["MAT_GRAPHITE_GRAY"])
    road.inputs["Base Color"].default_value = color("3B4146")
    glass = shader(bpy.data.materials["MAT_HARBOR_GLASS"])
    glass.inputs["Base Color"].default_value = color("385D69")
    glass.inputs["Roughness"].default_value = 0.26
    milk = shader(bpy.data.materials["MAT_OPAL_GLASS"])
    milk.inputs["Emission Color"].default_value = color("FFC78B")
    milk.inputs["Emission Strength"].default_value = 1.5
    for name, tint in (("MAT_LEAF_SAGE", "54834A"), ("MAT_LEAF_TIP", "85A058"), ("MAT_TURF", "4C763E")):
        shader(bpy.data.materials[name]).inputs["Base Color"].default_value = color(tint)
    for name, tint, rough, metal, emit in (
        ("Basalt", "343943", 0.66, 0.12, 0),
        ("Bronze", "675440", 0.45, 0.54, 0),
        ("Brass", "E4AD4F", 0.36, 0.61, 0.10),
        ("Light", "FFD399", 0.32, 0.12, 1.7),
        ("Smoke_Glass", "344C58", 0.20, 0.40, 0),
        ("Jet", "A5DAE9", 0.13, 0.08, 0.14),
        ("Amber_Glass", "B48456", 0.25, 0.27, 0.28),
        ("Sky_Glass", "51616B", 0.23, 0.39, 0.06),
        ("Planting", "566F40", 0.87, 0, 0),
        ("Terracotta", "BC6747", 0.74, 0, 0),
        ("Canvas", "F4DDB8", 0.85, 0, 0),
    ):
        material("MAT_CIVIC_" + name, tint, rough, metal, emit)
    textured("MAT_CIVIC_Paving", "A79B89", "C7B69A", 0.93, 8)
    # Stone joints are procedural in metres and follow the existing ground modules.
    paving = material("MAT_CIVIC_Square_Pavers", "938F86", 0.77)
    tree = paving.node_tree
    brick = tree.nodes.new("ShaderNodeTexBrick")
    tree.links.new(tree.nodes.new("ShaderNodeTexCoord").outputs["Object"], brick.inputs["Vector"])
    for name, value in (
        ("Color1", color("A49D92")),
        ("Color2", color("878985")),
        ("Mortar", color("625E58")),
        ("Scale", 1.0),
        ("Mortar Size", 0.019),
        ("Brick Width", 1.8),
        ("Row Height", 0.91),
    ):
        brick.inputs[name].default_value = value
    tree.links.new(brick.outputs["Color"], shader(paving).inputs["Base Color"])
    for layer in ("ENVIRONMENT", "ROADS", "PLAZA"):
        for obj in bpy.data.collections[layer].objects:
            if obj.type == "MESH":
                for slot in obj.material_slots:
                    treatments = (
                        ("MAT_CONCRETE_GRAY",)
                        if layer == "ROADS"
                        else ("MAT_CONCRETE_GRAY", "MAT_WARM_WHITE")
                    )
                    if slot.material and slot.material.name in treatments:
                        slot.link = "OBJECT"
                        slot.material = paving
    fountain = material("MAT_CIVIC_Fountain", "319FBA", 0.19, 0.16, 0.22)
    spray = shader(bpy.data.materials["MAT_CIVIC_Jet"])
    spray.inputs["Transmission Weight"].default_value = 0.52
    spray.inputs["IOR"].default_value = 1.333
    tree = fountain.node_tree
    surface = shader(fountain)
    ripples = noise(tree, tree.nodes.new("ShaderNodeTexCoord").outputs["Object"], 3.6, 3)
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.22
    bump.inputs["Distance"].default_value = 0.055
    tree.links.new(ripples.outputs["Fac"], bump.inputs["Height"])
    tree.links.new(bump.outputs[0], surface.inputs["Normal"])


def light(scene, group):
    elevation = math.radians(25)
    azimuth = math.radians(211)
    sunward = Vector(
        (
            math.cos(elevation) * math.cos(azimuth),
            math.cos(elevation) * math.sin(azimuth),
            math.sin(elevation),
        )
    )
    world = bpy.data.worlds.new("Lakeside | low sun and blue skylight")
    world.use_nodes = True
    tree = world.node_tree
    direction = tree.nodes.new("ShaderNodeTexCoord").outputs["Normal"]
    height = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(direction, height.inputs[0])
    horizon_distance = tree.nodes.new("ShaderNodeMath")
    horizon_distance.operation = "ABSOLUTE"
    tree.links.new(height.outputs["Z"], horizon_distance.inputs[0])
    sky_color = ramp(tree, height.outputs["Z"], (0, color("A6A5B3")), (0.7, color("3D6093")))
    glow = tree.nodes.new("ShaderNodeVectorMath")
    glow.operation = "DOT_PRODUCT"
    glow.inputs[1].default_value = sunward
    tree.links.new(direction, glow.inputs[0])
    glow_color = ramp(tree, glow.outputs["Value"], (0.78, (0, 0, 0, 1)), (1, color("845544")))
    tint = tree.nodes.new("ShaderNodeMixRGB")
    tint.blend_type = "ADD"
    tint.inputs[0].default_value = 0.68
    tree.links.new(sky_color, tint.inputs[1])
    tree.links.new(glow_color, tint.inputs[2])
    background = next(node for node in tree.nodes if node.type == "BACKGROUND")
    background.inputs["Strength"].default_value = 0.92
    tree.links.new(tint.outputs[0], background.inputs["Color"])
    horizon = ramp(tree, horizon_distance.outputs[0], (0, color("DDC6B6")), (0.26, color("668BAF")))
    haze = noise(tree, direction, 7, 3.5)
    wisps = ramp(tree, haze.outputs["Fac"], (0.50, (0, 0, 0, 1)), (0.72, (0.14, 0.125, 0.115, 1)))
    sky_haze = tree.nodes.new("ShaderNodeMixRGB")
    sky_haze.blend_type = "ADD"
    sky_haze.inputs[0].default_value = 0.82
    tree.links.new(horizon, sky_haze.inputs[1])
    tree.links.new(wisps, sky_haze.inputs[2])
    sky_background = tree.nodes.new("ShaderNodeBackground")
    tree.links.new(sky_haze.outputs[0], sky_background.inputs["Color"])
    rays = tree.nodes.new("ShaderNodeLightPath")
    visual_sky = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(rays.outputs["Is Camera Ray"], visual_sky.inputs[0])
    tree.links.new(background.outputs[0], visual_sky.inputs[1])
    tree.links.new(sky_background.outputs[0], visual_sky.inputs[2])
    output = next(node for node in tree.nodes if node.type == "OUTPUT_WORLD")
    tree.links.new(visual_sky.outputs[0], output.inputs["Surface"])
    scene.world = world
    sun = bpy.data.objects["CIVRUM_SUN"]
    sun.hide_render = True
    key = bpy.data.lights.new("Lakeside warm sun", "SUN")
    key.energy = 4.2
    key.angle = math.radians(2.0)
    key.color = (1, 0.72, 0.43)
    obj = bpy.data.objects.new(key.name, key)
    group.objects.link(obj)
    obj.location = sunward * 150
    obj.rotation_euler = (-sunward).to_track_quat("-Z", "Y").to_euler()
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.29


def camera(group, name, location, target, lens):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.clip_end = 1800
    obj = bpy.data.objects.new(name, data)
    group.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


def build_library(source, destination, name, *, original=None, crane=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=str(source))
    (tower,) = [obj for obj in scene.objects if obj.type == "MESH"]
    corners = [tower.matrix_world @ Vector(corner) for corner in tower.bound_box]
    low = Vector([min(point[axis] for point in corners) for axis in range(3)])
    high = Vector([max(point[axis] for point in corners) for axis in range(3)])
    foot = (low + high) / 2
    foot.z = low.z
    height = high.z - low.z
    if crane:
        # Measure the foundation, excluding the boom and long counterweight.
        points = [tower.matrix_world @ v.co for v in tower.data.vertices]
        bottom = [point for point in points if point.z <= low.z + 0.025 * height]
        for axis in (0, 1):
            foot[axis] = (min(point[axis] for point in bottom) + max(point[axis] for point in bottom)) / 2
    tower.data.transform(Matrix.Scale(1 / height, 4) @ Matrix.Translation(-foot) @ tower.matrix_world)
    tower.parent = None
    tower.matrix_world = Matrix.Identity(4)
    tower.name = "HI3D | " + name.removeprefix("CIVRUM | ")
    tower["source_glb"] = (original or source).name
    if "Tower Crane" not in name and "Planter Tree" not in name:
        tower["entrance_axis"] = "-Y"
    asset = collection(scene.collection, name)
    for previous_group in list(tower.users_collection):
        previous_group.objects.unlink(tower)
    asset.objects.link(tower)
    asset.asset_mark()
    bpy.ops.file.pack_all()
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(destination), compress=True)


def instance_asset(group, library, asset, name, position, height):
    with bpy.data.libraries.load(str(library), link=True, relative=True) as (_, linked):
        linked.collections = [asset]
    obj = bpy.data.objects.new(name, None)
    obj.instance_type = "COLLECTION"
    obj.instance_collection = linked.collections[0]
    obj.location = position
    obj.scale = (height,) * 3
    group.objects.link(obj)
    return obj


def place_tower(parent):
    group = collection(parent, "08 | Lakeside tower")
    tower = instance_asset(
        group, TOWER_LIBRARY, TOWER_COLLECTION, "CIVRUM_LAKESIDE_TOWER", TOWER_PLACEMENT, TOWER_HEIGHT
    )
    replace_infill(tower, ".025")

    x, y, top = TOWER_PLACEMENT
    paving = textured("LAKE_Tower foundation stone", "706C63", "9E9184", 0.54, 4)
    # The existing 300 m ground ends midway under the tower's round base.
    # A shallow foundation bridges the ground seam and aligns with the footway.
    ring = [(11.48 * math.cos(i * math.tau / 64), 11.52 * math.sin(i * math.tau / 64)) for i in range(64)]
    corners = [(px, py, z) for z in (-0.12, top) for px, py in ring]
    faces = [tuple(reversed(range(64))), tuple(range(64, 128))]
    faces.extend((i, (i + 1) % 64, 64 + (i + 1) % 64, 64 + i) for i in range(64))
    foundation = mesh(group, "Tower foundation", corners, faces, paving)
    foundation.location = (x, y, 0)
    box(group, "Tower entrance footway", x, 133.0, 0.04, 3.9, 1.50, 0.28, paving)


def library_location(key):
    _, name, _, _ = ASSETS[key]
    return HI3D / key / ("CIVRUM_" + name.replace(" ", "_") + ".blend"), "CIVRUM | " + name


def place_district_assets(parent):
    shops = collection(parent, "09 | South commercial corner")
    works = collection(parent, "10 | Construction crane")
    paving = textured("LAKE_Commercial entrance paving", "857A6C", "ADA08A", 0.85, 5)
    placements = (
        ("garden-roof-retail-v1", shops, (-18.6, -50.55, 0.177), 10.3, "", -55.8),
        ("billboard-commercial-v1", shops, (18.5, -50.87, 0.177), 18, ".028", -56.20),
        ("green-planter-tree-v1", shops, (-9.55, -52.55, 0.176), 3.45, None, None),
        ("autumn-planter-tree-v1", shops, (9.75, -54.10, 0.176), 3.65, None, None),
        ("tower-crane-v1", works, (101.1, -105.2, 0.172), 22, None, None),
    )
    for key, group, location, height, suffix, approach_y in placements:
        library, asset = library_location(key)
        obj = instance_asset(
            group, library, asset, "CIVRUM_HI3D_" + asset.split(" | ")[1].replace(" ", "_"), location, height
        )
        if suffix is not None:
            replace_infill(obj, suffix)
            box(
                shops,
                "Commercial storefront footing",
                location[0],
                location[1],
                0.034,
                15.05,
                11.95 if suffix == "" else 12.9,
                0.286,
                paving,
            )
            end_y = -57.75
            box(
                shops,
                "Storefront walk to sidewalk",
                location[0],
                (end_y + approach_y) / 2,
                0.092,
                6.4,
                approach_y - end_y,
                0.174,
                paving,
            )
        elif group == shops:
            box(shops, "Planter setting stone", location[0], location[1], 0.041, 1.83, 1.83, 0.27, paving)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--draft", action="store_true")
    parser.add_argument(
        "--prepare-tower", action="store_true", help="Rebuild the linked library from its archived GLB"
    )
    parser.add_argument("--hi3d-imports", type=Path, help=argparse.SUPPRESS)
    parser.add_argument(
        "--views",
        nargs="+",
        choices=["overview", "lake", "street", "tower", "shops", "crane", "avenue", "marina"],
        help="Render only the selected cameras",
    )
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    if args.prepare_tower:
        build_library(TOWER_SOURCE, TOWER_LIBRARY, TOWER_COLLECTION)
    if args.hi3d_imports:
        for source in sorted(args.hi3d_imports.glob("*-v1.glb")):
            stamp, *_ = ASSETS[source.stem]
            (original,) = (HI3D / source.stem).glob(f"*_{stamp}.glb")
            library, name = library_location(source.stem)
            build_library(source, library, name, original=original, crane=source.stem == "tower-crane-v1")
        return
    bpy.ops.wm.open_mainfile(filepath=str(MASTER))
    scene = bpy.context.scene
    scene.name = "CIVRUM | Lakeside at golden hour"
    parent = collection(bpy.data.collections["CIVRUM_WORLD"], "07 | Lakeside atmosphere")
    build_landscape(parent)
    tune_city()
    light(scene, collection(parent, "05 | Lighting"))
    place_tower(parent)
    place_district_assets(parent)
    blocks = collection(parent, "11 | Avenue buildings")
    civic = collection(parent, "12 | Fountains and forum")
    street_walls(blocks)
    facades(blocks)
    public_spaces(civic)
    public_terraces = collection(parent, "13 | Street terraces")
    avenue_trees(public_terraces)
    terraces(public_terraces, blocks, civic)
    garden_paving(civic)
    service_vehicles(collection(parent, "14 | Street vehicles"))
    cameras = collection(parent, "06 | Study cameras")
    views = {
        "overview": (
            "CIVRUM_Lakeside_Overview",
            camera(cameras, "LAKE_CAM_01 | City overview", (23, -389, 307), (0, -13, 3), 39),
        ),
        "lake": (
            "CIVRUM_Lakeside_Walk",
            camera(cameras, "LAKE_CAM_02 | Waterfront walk", (-82, 163.8, 1.92), (-104, 175.0, 2.08), 29),
        ),
        "street": (
            "CIVRUM_Street_Golden_Hour",
            camera(cameras, "LAKE_CAM_03 | Ordinary street", (-61.1, -107.0, 1.90), (-66.8, -53.0, 2.85), 29),
        ),
        "tower": (
            "CIVRUM_Lakeside_Tower",
            camera(cameras, "LAKE_CAM_04 | Lakeside tower", (-116, 110, 3.4), (-83, 145.2, 16.5), 26),
        ),
        "shops": (
            "CIVRUM_South_Commercial_Corner",
            camera(cameras, "LAKE_CAM_05 | Commercial corner", (-3.2, -92, 4.3), (0.5, -50.2, 6.5), 23),
        ),
        "crane": (
            "CIVRUM_Construction_Crane",
            camera(cameras, "LAKE_CAM_06 | Construction site", (129, -129, 3.7), (96, -103, 11.5), 28),
        ),
        "avenue": (
            "CIVRUM_West_Garden_Avenue",
            camera(cameras, "LAKE_CAM_07 | Fountain avenue", (-73.2, -58.1, 5.8), (-91, -15.5, 8.0), 27),
        ),
        "marina": (
            "CIVRUM_Lakeside_Marina",
            camera(cameras, "LAKE_CAM_08 | Marina and far bank", (-66, 154, 12.4), (-96, 192, 1.4), 39),
        ),
    }
    scene.camera = views["overview"][1]
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 10 if args.draft else 36
    scene.cycles.use_denoising = True
    scene.cycles.adaptive_threshold = 0.05 if args.draft else 0.022
    scene.render.resolution_x, scene.render.resolution_y = (960, 540) if args.draft else (1920, 1080)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    output = Path(tempfile.gettempdir()) / "civrum-lake-study/draft" if args.draft else OUTPUT / "renders"
    output.mkdir(parents=True, exist_ok=True)
    if not args.draft:
        bpy.context.preferences.filepaths.save_version = 0
        scene.render.filepath = "//renders/CIVRUM_Lakeside_Overview.png"
        for screen in bpy.data.screens:
            for area in screen.areas:
                if area.type == "VIEW_3D":
                    area.spaces.active.region_3d.view_perspective = "CAMERA"
        bpy.ops.wm.save_as_mainfile(
            filepath=str(OUTPUT / "CIVRUM_World_300m_Lakeside.blend"), relative_remap=True
        )
    for view in args.views or views:
        name, cam = views[view]
        scene.camera = cam
        scene.render.filepath = str(output / (name + ".png"))
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
