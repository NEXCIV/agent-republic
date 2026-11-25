"""Model the council hall and two street-front replacements in Blender metres."""

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_corner_market import edges, orient
from build_civrum_lakeside import material, shader
from build_civrum_world import Geometry, circle, rectangle
from build_nexciv_road_markings import DESTINATION as WORLD_SOURCE
from detail_civrum_world import emblem, rod

GOVERNANCE_HALL = "HERO_01_Governance_Hall"
RESIDENCE = "CIVRUM_PH_RESIDENTIAL_HOUSE"
RESIDENCE_OVERLAY = "Residences | terraces and roof pergola"
GARDEN_RETAIL = "HI3D | Garden Roof Retail"
BILLBOARD_COMMERCIAL = "HI3D | Billboard Commercial"
STONE, IVORY, BONE, INK, PANEL, BRONZE, GOLD, DOME, PATINA, GLASS, LIGHT, WOOD, GRASS, LEAF, SAGE, TILE, INTERIOR = range(17)
FINISHES = (
    ("Limestone", "AF9E85", .75, 0, 0),
    ("Cut limestone", "DAC6A5", .67, 0, 0),
    ("Light stone", "E6D5BB", .72, 0, 0),
    ("Basalt", "20252A", .72, .05, 0),
    ("Graphite cladding", "343C43", .54, .22, 0),
    ("Dark bronze", "564939", .43, .57, 0),
    ("Brushed brass", "BB914D", .37, .63, 0),
    ("Patinated copper", "3E6870", .48, .42, 0),
    ("Copper panels", "4B777A", .49, .40, 0),
    ("Smoke glass", "7BABB1", .21, .25, 0),
    ("Warm opal", "FFD190", .45, 0, 1.65),
    ("Oiled oak", "9F7751", .67, 0, 0),
    ("Roof groundcover", "52613B", .94, 0, 0),
    ("Olive foliage", "657547", .91, 0, 0),
    ("Sage foliage", "839054", .92, 0, 0),
    ("Paving stone", "B2A692", .88, 0, 0),
    ("Warm interior plaster", "B69973", .83, 0, .23),
)
PALETTE = tuple(("NEXCIV_Facade_" + item[0],) for item in FINISHES)


def finishes():
    for slot, (_, color, roughness, metal, emission) in enumerate(FINISHES):
        name = "MAT_" + PALETTE[slot][0]
        if name in bpy.data.materials:
            continue
        finish = material(name, color, roughness, metal, emission)
        if slot == GLASS:
            shader(finish).inputs["Alpha"].default_value = .26
            finish.surface_render_method = "BLENDED"


def profile(g, points, front, back, finish):
    """Extrude a counterclockwise X/Z outline into the facade."""
    n, first = len(points), len(g.verts)
    g.verts.extend((x, y, z) for y in (front, back) for x, z in points)
    g.face(tuple(first + i for i in range(n)), finish)
    g.face(tuple(first + n + i for i in reversed(range(n))), finish)
    for i in range(n):
        j = (i + 1) % n
        g.face((first + i, first + n + i, first + n + j, first + j), finish)


def plaque(g, text, x, y, z, size, finish):
    font = bpy.data.curves.new(text, "FONT")
    font.body, font.size, font.align_x = text, size, "CENTER"
    font.extrude, font.resolution_u = .008, 4
    obj = bpy.data.objects.new(text, font)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.update()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    first = len(g.verts)
    g.verts.extend((x + v.co.x, y - v.co.z, z + v.co.y) for v in mesh.vertices)
    for polygon in mesh.polygons:
        g.face(tuple(first + i for i in polygon.vertices), finish)
    bpy.data.meshes.remove(mesh)
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.curves.remove(font)


def glazing(g, x, y, z, w, h, division=2):
    left, right = x - w / 2, x + w / 2
    pane = len(g.verts)
    g.verts.extend(((left, y + .045, z), (right, y + .045, z),
                    (right, y + .045, z + h), (left, y + .045, z + h)))
    g.face(tuple(range(pane, pane + 4)), GLASS)
    for i in range(division + 1):
        g.box(left + i * w / division, y, z, .072, .15, h, BRONZE)
    for height in (z, z + h - .053):
        g.box(x, y, height, w, .15, .057, BRONZE)


def window_bays(g, width, height, bottom, count, wall, lit_seed, entrance=False, furnishings=True):
    bay = width / count
    for i in range(count):
        x = (i + .5) * bay - width / 2
        w = bay - .53
        door = entrance and i == count // 2
        sill = .11 if door else .65
        opening = height - sill - .50
        g.box(x - bay / 2, .25, bottom, .46, .71, height, wall, .04)
        g.box(x, .36, bottom + height - .48, w + .07, .74, .48, wall)
        g.box(x, .30, bottom, w + .07, .67, sill, wall)
        g.box(x, -.07, bottom + sill - .085, w + .16, .43, .085, BRONZE)
        glazing(g, x, .57, bottom + sill, w, opening, 2)
        g.box(x, .69, bottom + sill + opening * .74, w, .14, .043, BRONZE)
        # Light, back wall and fittings are set behind the glass plane.
        lit = (i + lit_seed) % 4 != 0
        g.box(x, 1.94, bottom + .08, w + .09, .12, height - .45, INTERIOR if lit else INK)
        g.box(x, 1.18, bottom + .03, w, 1.58, .05, WOOD)
        if lit:
            g.box(x, 1.43, bottom + height - .64, w * .83, .10, .105, LIGHT)
            if furnishings and bottom < 4 and not door:
                g.box(x, 1.40, bottom + .14, w * .79, .60, .67, WOOD, .06)
                g.box(x, 1.40, bottom + .81, w * .84, .63, .08, IVORY, .055)
                for direction in (-1, 1):
                    g.box(x + direction * .24, 1.39, bottom + .89, .25, .29, .32, DOME, .04)
        if door:
            for direction in (-1, 1):
                g.box(x + direction * .11, .446, bottom + 1.03, .047, .11, .39, GOLD)
    g.box(width / 2, .25, bottom, .46, .71, height, wall, .04)


def archway(g, x, front, bottom, spring, radius, fine):
    outer, top, segments = radius + .64, 9.42, 24
    for side in (-1, 1):
        g.box(x + side * (radius + .32), front + .30, bottom, .64, 1.32, spring - bottom, IVORY, .10)
        g.box(x + side * (radius + .32), front + .29, bottom, .80, 1.48, .19, STONE, .08)
        g.box(x + side * (radius + .32), front + .30, spring - .20, .83, 1.42, .21, BONE, .07)
    for i in range(segments):
        a, b = i * math.pi / segments, (i + 1) * math.pi / segments

        def at(distance, angle):
            return (x + distance * math.cos(angle), spring + distance * math.sin(angle))

        profile(g, [at(outer, a + .004), at(outer, b - .004), at(radius, b - .004), at(radius, a + .004)],
                front - .34, front + .95, BONE if i % 5 == 2 else IVORY)
        profile(g, [at(outer, b), at(outer, a), (at(outer, a)[0], top), (at(outer, b)[0], top)],
                front + .18, front + .93, STONE)
        gx, gz = at(radius - .035, a)
        hx, hz = at(radius - .035, b)
        rod(g, (gx, front + 1.10, gz), (hx, front + 1.10, hz), .047, BRONZE, sides=6)
    glass_y = front + 1.16
    glazing(g, x, glass_y, bottom + .10, radius * 2 - .08, spring - bottom - .06, 4)
    fan = len(g.verts)
    g.verts.extend((x + (radius - .043) * math.cos(i * math.pi / segments), glass_y + .045,
                    spring + (radius - .043) * math.sin(i * math.pi / segments)) for i in range(segments + 1))
    g.face(tuple(range(fan, fan + segments + 1)), GLASS)
    for i in range(1, 6):
        theta = i * math.pi / 6
        rod(g, (x, glass_y, spring), (x + radius * math.cos(theta), glass_y, spring + radius * math.sin(theta)),
            .028, BRONZE)
    if fine:
        for direction in (-1, 1):
            g.box(x + direction * .15, glass_y - .11, bottom + 1.16, .049, .15, .59, GOLD)
        g.box(x, glass_y, bottom + 2.45, radius * 2 - .08, .12, .052, GOLD)


def dome(g, fine):
    sides, rows = (80, 16) if fine else (64, 12)
    for radius, z, h, finish in ((9.73, 11.75, .38, INK), (9.65, 12.13, .16, GOLD),
                                 (9.31, 12.29, 2.07, DOME), (9.61, 14.36, .22, INK), (9.54, 14.58, .12, GOLD)):
        g.slab(circle(radius, sides), z, z + h, finish)
    arc = circle(9.37, 32)
    for i, (start, end) in enumerate(edges(arc)):
        trim = Geometry()
        length = (Vector(end) - Vector(start)).length
        trim.box(length / 2, -.03, 12.56, length - .18, .10, 1.51, DOME if i % 4 == 0 else BRONZE)
        trim.box(length / 2, -.086, 12.78, length - .39, .085, .95, PANEL if i % 3 == 0 else GOLD)
        trim.box(.073, -.09, 12.45, .12, .22, 1.77, BRONZE)
        orient(g, trim, start, end)
    first = len(g.verts)

    def surface(theta, angle, offset=0):
        reach = (9.27 + offset) * math.cos(theta)
        return reach * math.cos(angle), reach * math.sin(angle), 14.69 + (6.60 + offset) * math.sin(theta)

    for row in range(rows + 1):
        theta = 1.50 * row / rows
        g.verts.extend(surface(theta, math.tau * i / sides) for i in range(sides))
    smooth_from = len(g.faces)
    for row in range(rows):
        for i in range(sides):
            a, b = first + row * sides + i, first + row * sides + (i + 1) % sides
            g.face((a, b, b + sides, a + sides), PATINA if (i // (sides // 16)) % 4 == 1 else DOME)
    smooth_to = len(g.faces)
    for rib in range(16):
        angle = rib * math.tau / 16
        for step in range(rows):
            rod(g, surface(1.50 * step / rows, angle, .046), surface(1.50 * (step + 1) / rows, angle, .046),
                .061 if rib % 4 else .084, BRONZE, sides=5)
    for r, z, h, finish in ((.86, 21.20, .27, INK), (.66, 21.47, .16, GOLD), (.38, 21.63, .45, BRONZE),
                             (.23, 22.08, .30, GOLD), (.105, 22.38, .60, GOLD)):
        g.slab(circle(r, 24), z, z + h, finish)
    g.loft(circle(.24, 20), circle(.09, 20), 22.98, 23.137, GOLD)
    return smooth_from, smooth_to


def council_hall(fine):
    g = Geometry()
    g.box(0, .47, 0, 32.96, 24.14, .34, TILE, .42)
    for step in range(6):
        front = -12.55 + step * .48
        g.box(0, (front - 7.9) / 2, .34 + step * .17, 21.65 - step * .39, -7.9 - front, .17, IVORY, .12, TILE)
    g.box(0, .9, .34, 31.10, 21.1, .43, INK, .32)
    g.box(0, 1.0, .77, 30.80, 20.86, .60, STONE, .30, TILE)
    for side in (-1, 1):
        x = side * 12.97
        wing = [(x + px, py + 1.27) for px, py in rectangle(0, 0, 5.28, 19.72)]
        for index, (start, end) in enumerate(edges(wing)):
            length = (Vector(end) - Vector(start)).length
            bays = 2 if index % 2 == 0 else 4
            lower = Geometry()
            window_bays(lower, length - .5, 3.98, 1.37, bays, INK, index, furnishings=fine)
            window_bays(lower, length - .5, 3.66, 5.58, bays, PANEL, index + 1, furnishings=False)
            center = (Vector(start) + Vector(end)) / 2
            orient(g, lower, center, end)
        for z, height, width, depth, finish in ((5.35, .22, 5.55, 19.89, STONE), (9.24, .37, 5.78, 20.16, IVORY),
                                                    (9.61, .105, 5.81, 20.19, GOLD), (9.715, .41, 5.65, 20.02, INK)):
            g.box(x, 1.27, z, width, depth, height, finish, .21)
        for y in (-5.32, .92, 7.2):
            g.box(x, y, 10.13, 2.75, 2.76, .36, PANEL, .15)
            g.box(x, y, 10.49, 2.43, 2.45, .08, GRASS, .12)
    # Deep front arches, straight stone piers and a paneled central lobby.
    front = -9.30
    for x in (-6.72, 0, 6.72):
        archway(g, x, front, 1.37, 5.66, 2.46, fine)
    for x, w in ((-10.05, .78), (-3.36, .53), (3.36, .53), (10.05, .78)):
        g.box(x, front + .32, 1.37, w, .91, 8.05, IVORY, .10)
        g.box(x, front - .20, 1.40, w + .24, .35, .28, STONE, .07)
        for z in (3.46, 5.45, 7.44):
            g.box(x, front - .16, z, w + .02, .18, .039, STONE)
        g.box(x, front - .29, 3.27, .34, .39, .18, BRONZE, .04)
        g.box(x, front - .33, 3.45, .16, .19, .73, LIGHT, .035)
        g.box(x, front - .33, 4.18, .32, .32, .12, GOLD, .06)
    g.box(0, 2.65, 1.37, 20.6, .44, 8.01, INK)
    # The porch reveals the floor, soffit, warm lighting and furniture three metres behind the doors.
    g.box(0, -3.1, 1.32, 19.8, 10.6, .052, TILE)
    for x in (-6.72, 0, 6.72):
        g.box(x, 2.39, 1.37, 5.02, .075, 4.78, INTERIOR, .03)
        g.box(x, -4.15, 1.37, 3.79, .53, .60, WOOD, .12)
        g.box(x, -4.15, 1.97, 3.92, .63, .11, IVORY, .09)
        for dx in (-1.55, 1.55):
            g.box(x + dx, -5.05, 1.37, .34, .34, 4.14, BRONZE, .05)
        g.box(x, -5.18, 5.48, 3.88, .28, .085, GOLD, .04)
        g.box(x, -5.18, 5.38, 3.64, .18, .10, LIGHT, .025)
    rear = Geometry()
    window_bays(rear, 19.72, 4.24, 1.37, 5, INK, 1, furnishings=fine)
    window_bays(rear, 19.72, 3.57, 5.66, 5, PANEL, 2, furnishings=False)
    orient(g, rear, (0, 10.53), (-10, 10.53))
    for z, w, y, d, h, finish in ((9.42, 21.68, .40, 21.62, .36, STONE), (9.78, 22.06, .37, 21.95, .14, GOLD),
                                   (9.92, 21.43, .43, 21.11, .48, INK), (10.4, 20.94, .42, 20.32, .31, IVORY),
                                   (10.71, 20.16, .37, 19.92, 1.04, PANEL)):
        g.box(0, y, z, w, d, h, finish, .24)
    g.box(0, -9.58, 8.64, 11.42, .64, 1.19, BRONZE, .18)
    g.box(0, -9.93, 8.75, 11.17, .14, .99, INK, .06)
    emblem(g, -4.20, -10.008, 9.25, .30, GOLD)
    plaque(g, "COUNCIL HALL", .39, -10.005, 9.06, .58, BONE)
    smooth = dome(g, fine)
    mesh = g.mesh("Council Hall | architectural geometry", PALETTE)
    for index in range(*smooth):
        mesh.polygons[index].use_smooth = True
    return mesh


def street_block(style, fine):
    g = Geometry()
    tall, residence = style == "midrise", style == "residence"
    width, depth, floors, clear = {
        "midrise": (17.0, 12.2, 4, 3.52),
        "retail": (16.0, 11.6, 2, 3.61),
        "residence": (24.0, 16.3, 4, 3.02),
    }[style]
    top = .49 + floors * (clear + .36)
    g.box(0, 0, 0, width, depth, .25, TILE, .27)
    g.box(0, 0, .25, width - .47, depth - .42, .24, INK, .19)
    for level in range(floors):
        setback = level * .53 if residence else .52 if tall and level == floors - 1 else 0
        w, d = width - .95 - setback * 2, depth - .96 - setback * 2
        bottom = .49 + level * (clear + .36)
        for index, (start, end) in enumerate(edges(rectangle(0, 0, w, d))):
            center = (Vector(start) + Vector(end)) / 2
            length = (Vector(end) - Vector(start)).length
            face = Geometry()
            bays = (5 if tall or residence else 3) if index % 2 == 0 else 3
            window_bays(face, length - .49, clear, bottom, bays, INK if level % 3 != 2 else PANEL,
                        index + level * 2, index == 0 and level == 0, fine)
            if fine and level > 0 and not residence:
                face.box(0, -.105, bottom + 1.05, length - .39, .083, .058, GOLD)
            orient(g, face, center, end)
        floor = bottom + clear
        g.box(0, 0, floor, w + .48, d + .48, .28, IVORY if residence else INK, .16)
        g.box(0, 0, floor + .28, w + .52, d + .52, .08, GOLD, .16)
    g.box(0, -depth / 2 + .22, 3.19, width * .59, .75, .29, INK, .10)
    g.box(0, -depth / 2 - .17, 3.27, width * .58, .045, .085, GOLD)
    g.box(0, 0, top, width - 1.22, depth - 1.17, .12, TILE, .17)
    for side in (-1, 1):
        g.box(0, side * (depth / 2 - .71), top + .12, width - 1.18, .24, .48, PANEL, .08, GOLD)
        g.box(side * (width / 2 - .73), 0, top + .12, .24, depth - 1.63, .48, PANEL, .06, GOLD)
        for x in (-3.6, 3.6):
            y = side * (depth / 2 - 1.65)
            g.box(x, y, top + .12, 5.2, 1.38, .28, INK, .14)
            g.box(x, y, top + .4, 4.92, 1.08, .10, GRASS, .125)
            for i in range(7 if fine else 5):
                g.loft(circle(.24, 7, x - 2 + i * (4 / (6 if fine else 4)), y),
                       circle(.14, 7, x - 2 + i * (4 / (6 if fine else 4)), y + .07),
                       top + .48, top + .75 + (i % 3) * .055, LEAF if i % 2 else SAGE)
    if residence:
        g.box(0, -depth / 2 + .30, 2.86, 7.15, .62, .36, PANEL, .10)
        plaque(g, "GARDEN RESIDENCES", 0, -depth / 2 - .025, 2.99, .23, BONE)
        g.box(0, .8, top + .12, 12.35, 5.32, .19, STONE, .20)
        for x in (-5.68, -.06, 5.68):
            for y in (-1.39, 2.99):
                g.box(x, y, top + .31, .20, .20, 2.03, PANEL, .026)
        for i in range(15):
            g.box(-5.72 + i * .817, .8, top + 2.34, .16, 4.70, .15, WOOD, .025)
        for y in (-1.45, 3.04):
            g.box(0, y, top + 2.22, 11.82, .23, .19, PANEL, .029)
    elif tall:
        g.box(0, .40, top + .12, 5.8, 5.1, 1.41, INK, .16)
        g.box(0, -2.15, top + .34, 5.68, .16, .95, BRONZE, .035)
        g.box(0, -2.25, top + .39, 5.57, .067, .85, INK, .028)
        emblem(g, -1.82, -2.294, top + .80, .30, GOLD)
        plaque(g, "NEXCIV", .49, -2.294, top + .64, .49, GOLD)
        g.box(0, .4, top + 1.53, 6.0, 5.26, .10, GOLD, .14)
    else:
        g.box(0, .42, top + .12, 4.32, 2.7, .49, BRONZE, .15)
        g.box(0, .42, top + .61, 4.10, 2.5, .15, DOME, .14)
        for x in (-1.35, 0, 1.35):
            g.box(x, .42, top + .76, .072, 2.5, .037, GOLD)
        for x in (-5.8, 5.8):
            g.box(x, .42, top + .12, 1.48, 3.35, .24, PANEL, .13)
            g.box(x, .42, top + .36, 1.26, 3.12, .078, GRASS, .095)
    return g.mesh({"midrise": "Civic avenue midrise", "retail": "Garden retail | recessed glazing",
                   "residence": "Garden residences | stepped terraces"}[style], PALETTE)


def fit_mesh(mesh, source):
    """Fit the new local mesh to the old asset's anchor and footprint."""
    old = [Vector(point) for point in source.bound_box]
    new = [vertex.co for vertex in mesh.vertices]
    low, high = (Vector([bound(pt[axis] for pt in new) for axis in range(3)]) for bound in (min, max))
    target_low, target_high = (Vector([bound(pt[axis] for pt in old) for axis in range(3)]) for bound in (min, max))
    ratio = [(target_high[i] - target_low[i]) / (high[i] - low[i]) for i in range(3)]
    mesh.transform(Matrix.Translation(target_low) @ Matrix.Diagonal((*ratio, 1)) @ Matrix.Translation(-low))
    mesh.update()


def save_library(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    finishes()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    for name, mesh, x, y in (("Council Hall", council_hall(True), 0, 0),
                             ("Civic midrise", street_block("midrise", True), 31, 0),
                             ("Garden retail", street_block("retail", True), -31, 0),
                             ("Garden residences", street_block("residence", True), 0, 32)):
        group = bpy.data.collections.new(name)
        scene.collection.children.link(group)
        obj = bpy.data.objects.new(name, mesh)
        group.objects.link(obj)
        obj.location = (x, y, 0)
        obj.asset_mark()
    for area in bpy.context.screen.areas:
        if area.type == "VIEW_3D":
            area.spaces.active.region_3d.view_location = (0, 0, 8)
            area.spaces.active.region_3d.view_distance = 73
            area.spaces.active.region_3d.view_rotation = Euler((math.radians(71), 0, math.radians(20))).to_quaternion()
            area.spaces.active.shading.color_type = "MATERIAL"
    path.parent.mkdir(exist_ok=True, parents=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(path.resolve()))


def save_world(path):
    if path.resolve() == WORLD_SOURCE.resolve():
        raise ValueError("Use a new path for the facade revision")
    bpy.ops.wm.open_mainfile(filepath=str(WORLD_SOURCE))
    scene = bpy.context.scene
    finishes()
    replacements = {}
    instances = 0
    for obj in list(scene.objects):
        original = obj.instance_collection
        if not original or obj.hide_render or obj.hide_viewport:
            continue
        if original not in replacements:
            source = next((item for item in original.all_objects if item.type == "MESH"
                           and item.name.startswith((GARDEN_RETAIL, BILLBOARD_COMMERCIAL))), None)
            if source is None:
                replacements[original] = None
                continue
            style = "retail" if source.name.startswith(GARDEN_RETAIL) else "midrise"
            mesh = street_block(style, True)
            fit_mesh(mesh, source)
            collection = bpy.data.collections.new(mesh.name)
            collection.instance_offset = original.instance_offset
            model = bpy.data.objects.new(mesh.name, mesh)
            collection.objects.link(model)
            model.matrix_world = source.matrix_world
            replacements[original] = collection
        replacement = replacements[original]
        if replacement:
            obj.instance_collection = replacement
            instances += 1
    for name, mesh in ((GOVERNANCE_HALL, council_hall(True)), (RESIDENCE, street_block("residence", True))):
        obj = scene.objects[name]
        fit_mesh(mesh, obj)
        obj.data = mesh
    overlay = scene.objects[RESIDENCE_OVERLAY]
    overlay.hide_render = True
    overlay.hide_viewport = True
    if instances < 25:
        raise RuntimeError(f"Only {instances} street instances were updated")
    path.parent.mkdir(exist_ok=True, parents=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(path.resolve()))
    print(f"FACADE WORLD: 2 civic and residential buildings, {instances} street placements", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path)
    parser.add_argument("--world", type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    if not (args.library or args.world):
        parser.error("Choose --library or --world")
    bpy.context.preferences.filepaths.save_version = 0
    if args.library:
        save_library(args.library)
    if args.world:
        save_world(args.world)


if __name__ == "__main__":
    main()
