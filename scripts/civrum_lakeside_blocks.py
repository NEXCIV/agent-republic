"""Street blocks and civic spaces for the 300 m Blender lakeside study."""

import math

import bpy
from build_civrum_world import Geometry, circle, rectangle
from mathutils import Vector

STONE, BASALT, METAL, GOLD, LIGHT, GLASS, WATER, FOAM, LEAF, BRICK, CANVAS, WOOD, AMBER, COOL = range(14)
PALETTE = tuple(
    (name,)
    for name in (
        "CIVIC_Paving",
        "CIVIC_Basalt",
        "CIVIC_Bronze",
        "CIVIC_Brass",
        "CIVIC_Light",
        "CIVIC_Smoke_Glass",
        "CIVIC_Fountain",
        "CIVIC_Jet",
        "CIVIC_Planting",
        "CIVIC_Terracotta",
        "CIVIC_Canvas",
        "SEAT_WOOD",
        "CIVIC_Amber_Glass",
        "CIVIC_Sky_Glass",
    )
)


def place(group, name, data, x, y, z, angle=0):
    obj = bpy.data.objects.new(name, data)
    group.objects.link(obj)
    obj.location = (x, y, z)
    obj.rotation_euler.z = math.radians(angle)
    return obj


def asset_instance(group, source, x, y, z, scale, angle, label):
    obj = place(group, label, None, x, y, z, angle)
    obj.instance_type = "COLLECTION"
    obj.instance_collection = source.instance_collection
    obj.scale = scale
    return obj


def replace_infill(asset, suffix):
    names = ("CIVRUM_PH_INFILL" + suffix, "CIVRUM_Streetfront_INFILL" + suffix)
    for name in names:
        placeholder = bpy.data.objects[name]
        placeholder.hide_render = True
        placeholder.hide_viewport = True
    asset["replaces"] = ", ".join(names)


def make_office(floors):
    """A glazed office with a stepped crown, a recessed lobby and lit window bays."""
    g = Geometry()
    g.box(0, 0, 0, 14.8, 18, 0.18, STONE, 0.5)
    g.box(0, 0, 0.18, 12.8, 15.8, 3.9, GLASS, 0.42)
    for side in (-1, 1):
        for y in (-6.6, -2.2, 2.2, 6.6):
            g.box(side * 6.75, y, 0.18, 0.43, 0.6, 3.95, METAL)
    g.box(0, -7.95, 3.16, 8, 1.55, 0.32, BASALT, 0.12, GOLD)
    for level in range(floors):
        setback = 1 if level >= floors - 3 else 0
        w, d, z = 14.0 - setback * 2.5, 16.9 - setback * 3.0, 4 + level * 3.0
        g.box(0, 0, z, w, d, 3.0, GLASS, 0.5)
        g.box(0, 0, z, w + 0.3, d + 0.3, 0.43, BASALT, 0.5, METAL)
        for side in (-1, 1):
            for k in range(-2, 3):
                for is_front in (True, False):
                    axis = k * (w if is_front else d) / 5.4
                    x, y = (axis, side * d / 2) if is_front else (side * w / 2, axis)
                    g.box(x, y, z + 0.43, 0.13, 0.13, 2.57, METAL)
                    pattern = (level * 5 + k * 3 + side + is_front) % 11
                    if pattern not in (0, 3):
                        tint = AMBER if pattern in (1, 4, 7, 8) else COOL
                        if is_front:
                            g.box(x + 0.69, y + side * 0.024, z + 0.71, 1.17, 0.05, 1.8, tint)
                        else:
                            g.box(x + side * 0.024, y + 0.69, z + 0.71, 0.05, 1.17, 1.8, tint)
        if level in (floors - 4, floors - 1):
            g.box(0, 0, z + 2.84, w + 0.35, d + 0.35, 0.16, GOLD, 0.5)
    roof = 4 + floors * 3
    g.box(0, 0, roof, 10.9, 13.2, 0.28, BASALT, 0.5)
    g.box(0, 0, roof + 0.28, 8.8, 10.8, 0.16, LEAF, 0.3)
    g.box(0, 2, roof + 0.44, 4.1, 4.3, 1.45, METAL, 0.3, GOLD)
    return g.mesh(f"Civic office | {floors} floors", PALETTE)


def street_walls(group):
    data = bpy.data.objects
    retail = data["CIVRUM_HI3D_Garden_Roof_Retail"]
    billboard = data["CIVRUM_HI3D_Billboard_Commercial"]
    tower = data["CIVRUM_LAKESIDE_TOWER"]
    # Street-front widths follow each parcel. The height rhythm opens towards the lake and Nexus.
    round_heights = {7: 48, 20: 39, 23: 32, 34: 59, 50: 46, 53: 34}
    office_floors = {5: 9, 8: 7, 21: 11, 33: 9, 36: 14, 49: 8, 51: 11}
    midrise = {2, 10, 15, 19, 24, 27, 30, 37, 43, 47, 52, 55}
    office_meshes = {}
    for slot in range(1, 56):
        if slot in (25, 28):
            continue
        suffix = f".{slot:03}"
        mass = data["CIVRUM_PH_INFILL" + suffix]
        x, y, base = mass.location
        z = base + 0.024
        outer_side = abs(x) == 140
        if outer_side:
            x = math.copysign(141.1, x)
        if abs(y) == 140:
            y = math.copysign(141, y)
            if abs(x) == 78:
                x = math.copysign(81.5, x)
            if slot == 53:
                y = 142.5
        if outer_side or abs(x) in (49, 51, 107) and abs(y) in (19, 27, 94):
            # At the outer avenue a west-side front looks east and vice versa.
            angle = 90 if (x < 0) == outer_side else -90
            if abs(x) == 49:
                angle = -angle
        else:
            angle = 0 if y > 0 and abs(y) != 50 or y < 0 and abs(y) == 50 else 180
        if slot in office_floors:
            floors = office_floors[slot]
            if floors not in office_meshes:
                office_meshes[floors] = make_office(floors)
            obj = place(group, "Civic setback office " + str(slot), office_meshes[floors], x, y, z, angle)
            obj.scale.y = 0.90
        elif slot in round_heights:
            obj = asset_instance(
                group, tower, x, y, z, (26, 26, round_heights[slot]), angle, "Lakeside tower " + str(slot)
            )
        else:
            source = billboard if slot in midrise else retail
            width = 15.5 if abs(y) in (50, 112, 105) else 17.1
            depth = 10.6 if abs(x) in (49, 51, 107) or abs(y) in (50, 112) else 12.8
            if abs(y) == 108:
                width, depth = 13.4, 11.4
            (geo,) = source.instance_collection.objects
            sx, sy = width / geo.dimensions.x, depth / geo.dimensions.y
            height = (15.8 + slot % 5) if source == billboard else (7.9 + 0.85 * (slot % 4))
            obj = asset_instance(group, source, x, y, z, (sx, sy, height), angle, "Street shop " + str(slot))
        # A narrow stone threshold joins the floor to the local terrain.
        if slot not in office_floors:
            (part,) = obj.instance_collection.objects
            w, d = part.dimensions.x * obj.scale.x, part.dimensions.y * obj.scale.y
            footing = Geometry()
            footing.box(0, 0, -0.075, w + 0.24, d + 0.24, 0.075, STONE, min(w, d) * 0.12)
            place(
                group,
                "Street foundation " + str(slot),
                footing.mesh("Parcel base " + str(slot), PALETTE),
                x,
                y,
                z,
                angle,
            )
        else:
            obj.location.z = base
        replace_infill(obj, suffix)


def sector(inner, outer, start, end, segments):
    angles = [math.radians(start + (end - start) * i / segments) for i in range(segments + 1)]
    return [
        (r * math.cos(a), r * math.sin(a))
        for r, seq in ((outer, angles), (inner, reversed(angles)))
        for a in seq
    ]


def public_spaces(group):
    # Two fountains sit between the radial road and the north/south pedestrian approach.
    # The east garden separates two basins and retains its mature trees.
    for x, y, length in ((-80.8, -32.5, 39.5), (81.4, -21.1, 19.8), (81.4, -50.6, 8.8)):
        g = Geometry()
        for w, d, low, top, mat in (
            (7.9, length + 0.8, -0.04, 0.16, STONE),
            (7.36, length + 0.26, 0.16, 0.48, BASALT),
            (7.27, length + 0.17, 0.48, 0.55, GOLD),
            (6.95, length - 0.15, 0.55, 0.58, WATER),
        ):
            g.box(0, 0, low, w, d, top - low, mat, 0.63)
        for side in (-1, 1):
            g.box(side * 3.58, 0, 0.55, 0.14, length - 1.15, 0.16, STONE)
            g.box(0, side * (length / 2 - 0.06), 0.55, 6.75, 0.16, 0.16, STONE)
        for jet in range(int(length // 5)):
            yy = (jet - (int(length // 5) - 1) / 2) * 5
            h = 1.15 + 0.65 * (jet % 3)
            for stream in range(7):
                angle = stream * math.tau / 7
                stations = []
                for sample in range(9):
                    t = sample / 8
                    offset = 0.035 + 0.59 * t
                    stations.append(
                        (
                            offset * math.cos(angle),
                            yy + offset * math.sin(angle),
                            0.586 + h * 3.4 * t * (1 - t),
                        )
                    )
                for step in range(8):
                    x0, y0, z0 = stations[step]
                    x1, y1, z1 = stations[step + 1]
                    g.loft(circle(0.026, 7, x0, y0), circle(0.026, 7, x1, y1), z0, z1, FOAM)
            for r in (0.72, 1.04):
                g.band(circle(r, 48, 0, yy), circle(r - 0.017, 48, 0, yy), 0.59, FOAM)
        place(group, "Civic reflecting pool", g.mesh("Jet basin", PALETTE), x, y, 0)

    forum = Geometry()
    for tier in range(6):
        r = 5.8 + tier * 1.34
        top = 0.35 + tier * 0.37
        # Three generous aisles and an open, level approach from the north.
        for a, b in ((112, 176), (184, 265), (275, 356), (4, 68)):
            pts = sector(r, r + 1.32, a, b, 22)
            forum.slab(pts, 0, top, BASALT, STONE)
            forum.slab(sector(r + 0.17, r + 0.77, a + 0.7, b - 0.7, 22), top, top + 0.13, METAL, WOOD)
            forum.slab(sector(r + 0.02, r + 0.075, a, b, 22), top, top + 0.008, GOLD)
    forum.slab(circle(5.15, 64), 0, 0.22, BASALT)
    forum.slab(circle(4.84, 64), 0.22, 0.24, WOOD)
    for angle in range(0, 360, 45):
        a = math.radians(angle)
        forum.slab(circle(0.16, 12, 4.9 * math.cos(a), 4.9 * math.sin(a)), 0.24, 0.255, LIGHT)
    old = bpy.data.objects["CIVRUM_COMMUNITY_OPEN_FORUM"]
    old.hide_render = old.hide_viewport = True
    arcade = bpy.data.objects["CIVRUM_Public_Arcade.003"]
    arcade.location.x -= 10.8
    arcade.location.y -= 28
    place(
        group, "Forum | outdoor auditorium", forum.mesh("Forum seating and stage", PALETTE), -95, -88.5, 0.172
    )

    compass = Geometry()
    for i in range(16):
        a, b = i * 22.5, (i + 1) * 22.5
        compass.surface(sector(3.15, 9.45, a + 0.4, b - 0.4, 3), 0, BASALT if i % 2 else METAL)
        ar, br = math.radians(a), math.radians(b)
        mid = (ar + br) / 2
        compass.surface(
            [
                (3.4 * math.cos(mid), 3.4 * math.sin(mid)),
                (8.9 * math.cos(ar + 0.02), 8.9 * math.sin(ar + 0.02)),
                (8.9 * math.cos(br - 0.02), 8.9 * math.sin(br - 0.02)),
            ],
            0.003,
            GOLD if i % 2 else STONE,
        )
    compass.band(circle(9.66, 96), circle(9.51, 96), 0.001, GOLD)
    place(
        group,
        "Nexus | stone and brass compass",
        compass.mesh("Nexus radial paving", PALETTE),
        0,
        -11.6,
        0.222,
    )
    strips = Geometry()
    for sign in (-1, 1):
        strips.box(0, sign * 5.03, 0, 32, 0.76, 0.012, GOLD)
        strips.box(0, sign * 5.03, 0.012, 31.85, 0.33, 0.004, LIGHT)
    strip_data = strips.mesh("Boulevard inset guide", PALETTE)
    for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
        place(
            group,
            "Nexus | boulevard guides",
            strip_data,
            sx * 43,
            sy * 43,
            0.189,
            math.degrees(math.atan2(sy, sx)),
        )


def garden_paving(group):
    for cx in (-32, 32):
        garden = Geometry()
        garden.box(0, 0, 0, 46, 46, 0.005, STONE, 1.4)
        for x in (-12, 12):
            for y in (-12, 12):
                garden.box(x, y, 0.005, 20.6, 20.6, 0.005, LEAF, 1.35)
                garden.band(
                    rectangle(x, y, 21.15, 21.15, 1.54), rectangle(x, y, 20.8, 20.8, 1.4), 0.012, METAL
                )
        for x in (-3.1, 3.1):
            garden.box(x, 0, 0.005, 0.16, 45, 0.008, GOLD)
        for y in (-3.1, 3.1):
            garden.box(0, y, 0.005, 45, 0.16, 0.008, GOLD)
        place(
            group, "South garden | paths and parterres", garden.mesh("Quartered garden", PALETTE), cx, -95, 0
        )
    for sx in (-1, 1):
        for sy in (-1, 1):
            for transpose in (False, True):
                garden = Geometry()
                for pts, z, mat in (
                    ([(9, 55.8), (9, 42.7), (23, 36.8), (42, 55.8)], 0.006, STONE),
                    ([(11, 54.8), (11, 44.1), (22.6, 39.5), (38, 54.8)], 0.009, LEAF),
                ):
                    vertices = [(sx * (y if transpose else x), sy * (x if transpose else y)) for x, y in pts]
                    if sx * sy * (-1 if transpose else 1) < 0:
                        vertices.reverse()
                    garden.surface(vertices, z, mat)
                place(group, "Nexus | radial garden", garden.mesh("Spoke pocket landscape", PALETTE), 0, 0, 0)


def facades(group):
    # The west towers share an enclosed gallery. Its ends extend into both buildings.
    g = Geometry()
    for i in range(14):
        a, b = i / 14, (i + 1) / 14
        x0, x1 = (1.85 * math.sin(math.pi * t) for t in (a, b))
        y0, y1 = 29 * a, 29 * b
        floor = [(x0 - 1.55, y0), (x0 + 1.55, y0), (x1 + 1.55, y1), (x1 - 1.55, y1)]
        g.slab(floor, 0, 0.34, BASALT, GOLD)
        g.slab(floor, 2.9, 3.13, METAL, GLASS)
        for side in (-1, 1):
            edge = [
                (x0 + side * 1.52, y0),
                (x0 + side * 1.52 + 0.065, y0),
                (x1 + side * 1.52 + 0.065, y1),
                (x1 + side * 1.52, y1),
            ]
            g.slab(edge, 0.34, 2.91, GLASS)
            g.slab(edge, 1.1, 1.18, GOLD)
            g.box(x0 + side * 1.52, y0, 0.34, 0.13, 0.12, 2.57, METAL)
    place(group, "West avenue | skybridge", g.mesh("West skybridge", PALETTE), -141.1, 17, 20)

    # Fit actual window frames, balcony slabs and planted roof to the old alternating floor plates.
    house = bpy.data.objects["CIVRUM_PH_RESIDENTIAL_HOUSE"]
    g = Geometry()
    for level in range(3):
        dx = 0.8 if level % 2 else -0.8
        z = 2.8 + level * 3.4
        for side in (-1, 1):
            for x in (-8, -4, 0, 4, 8):
                g.box(dx + x, side * 7.53, z + 0.32, 3.25, 0.09, 1.88, GLASS)
                g.box(dx + x, side * 7.60, z + 0.32, 0.09, 0.08, 1.88, METAL)
            g.box(dx, side * 7.72, z + 0.09, 20, 0.86, 0.16, BASALT, 0.11, GOLD)
            for y in (-4.8, -1.6, 1.6, 4.8):
                g.box(dx + side * 10.54, y, z + 0.42, 0.12, 2.6, 1.62, GLASS)
    g.box(0, 0.2, 13.4, 17.4, 13.5, 0.16, BASALT, 0.4, GOLD)
    g.box(0, 0.2, 13.56, 16.55, 12.65, 0.14, LEAF, 0.45)
    for dx in (-6.8, 6.8):
        for dy in (-3.6, 3.6):
            g.box(dx, dy, 13.7, 0.14, 0.14, 2.45, METAL)
    for dx in range(-7, 8):
        g.box(dx, 0, 16.13, 0.32, 7.9, 0.13, WOOD)
    place(
        group, "Residences | terraces and roof pergola", g.mesh("Garden apartments", PALETTE), *house.location
    )


def cafe_furniture(tint):
    g = Geometry()
    g.slab(circle(0.40, 12), 0, 0.07, BASALT)
    g.slab(circle(0.065, 10), 0.06, 3.12, METAL)
    g.slab(circle(0.86, 24), 0.78, 0.87, WOOD)
    outer = circle(1.88, 8, phase=math.pi / 8)
    inner = circle(0.27, 8, phase=math.pi / 8)
    g.loft(outer, inner, 2.67, 3.33, tint)
    for i in range(0, 8, 2):
        j = (i + 1) % 8
        p = len(g.verts)
        g.verts.extend(
            [
                (x, y, z)
                for (x, y), z in ((outer[i], 2.68), (outer[j], 2.68), (inner[j], 3.34), (inner[i], 3.34))
            ]
        )
        g.face((p, p + 1, p + 2, p + 3), CANVAS)
    for angle in (20, 140, 260):
        a = math.radians(angle)
        x, y = 1.16 * math.cos(a), 1.16 * math.sin(a)
        g.slab(circle(0.10, 10, x, y), 0, 0.48, METAL)
        g.slab(circle(0.34, 16, x, y), 0.48, 0.56, WOOD)
    return g.mesh("Street terrace parasol", PALETTE)


def bounds_xy(obj):
    geo = obj
    matrix = obj.matrix_world
    if obj.instance_collection:
        (geo,) = obj.instance_collection.objects
        matrix = matrix @ geo.matrix_world
    corners = [matrix @ Vector(v) for v in geo.bound_box]
    return (
        min(v.x for v in corners),
        max(v.x for v in corners),
        min(v.y for v in corners),
        max(v.y for v in corners),
    )


def avenue_trees(group):
    green = bpy.data.objects["CIVRUM_HI3D_Green_Planter_Tree"]
    amber = bpy.data.objects["CIVRUM_HI3D_Autumn_Planter_Tree"]
    for index, old in enumerate(sorted(bpy.data.collections["VEGETATION"].objects, key=lambda o: o.name)):
        if not old.name.startswith("CIVRUM_TREE_") or old.hide_render:
            continue
        x, y, z = old.matrix_world.translation
        if abs(x) > 121 or (abs(x) < 28 and abs(y) < 28) or (abs(x) < 72 and abs(y) < 68):
            continue
        h = 4.15 + 0.25 * (index % 5)
        source = amber if index % 5 == 0 else green
        new = asset_instance(group, source, x, y, z, (h,) * 3, (index % 4) * 90, "Street tree | " + old.name)
        new["replaces"] = old.name
        old.hide_render = old.hide_viewport = True


def service_vehicles(group):
    # Static vehicles provide scale at the crossings. Travel lanes keep their original geometry.
    def vehicle(van, tint):
        g = Geometry()
        length = 4.45 if van else 4.05
        g.box(0, 0, 0.26, 1.81, length, 0.32, BASALT, 0.25)
        g.loft(
            rectangle(0, 0, 1.88, length, 0.22), rectangle(0, 0, 1.83, length - 0.12, 0.30), 0.46, 0.91, tint
        )
        if van:
            g.loft(
                rectangle(0, -0.16, 1.78, 3.73, 0.22), rectangle(0, -0.31, 1.66, 3.29, 0.25), 0.91, 1.90, tint
            )
            g.loft(
                rectangle(0, 1.25, 1.68, 0.84, 0.09), rectangle(0, 1.10, 1.60, 0.68, 0.13), 1.06, 1.73, GLASS
            )
            for sign in (-1, 1):
                g.box(sign * 0.886, -0.61, 1.12, 0.035, 1.76, 0.54, GLASS, 0.01)
            g.box(0, -0.5, 1.90, 1.06, 1.35, 0.11, STONE, 0.13)
        else:
            g.loft(
                rectangle(0, -0.18, 1.78, 2.65, 0.28),
                rectangle(0, -0.28, 1.53, 1.70, 0.27),
                0.92,
                1.54,
                GLASS,
            )
            g.box(0, -0.28, 1.54, 1.57, 1.74, 0.055, tint, 0.27)
        for sign in (-1, 1):
            g.box(sign * 0.62, length / 2 - 0.054, 0.66, 0.37, 0.08, 0.13, LIGHT, 0.035)
            g.box(sign * 0.64, -length / 2 + 0.052, 0.65, 0.34, 0.08, 0.12, BRICK, 0.026)
            for y in (-1.29, 1.26):
                for inner, outer, r, mat in ((0.81, 0.973, 0.32, BASALT), (0.972, 0.982, 0.17, METAL)):
                    start = len(g.verts)
                    for x in (inner, outer):
                        for i in range(16):
                            a = i * math.tau / 16
                            g.verts.append((sign * x, y + r * math.cos(a), 0.32 + r * math.sin(a)))
                    g.face(tuple(start + 16 + i for i in range(16)), mat)
                    for i in range(16):
                        j = (i + 1) % 16
                        g.face((start + i, start + j, start + 16 + j, start + 16 + i), mat)
        return g.mesh("Service van" if van else "City compact", PALETTE)

    fleet = [vehicle(False, t) for t in (BRICK, STONE, COOL)] + [vehicle(True, t) for t in (CANVAS, LEAF)]
    lanes = (
        (-124.35, -88, 0),
        (-127.7, -21, 180),
        (-124.35, 41, 0),
        (-127.7, 87, 180),
        (127.65, -92, 0),
        (124.3, -47, 180),
        (127.65, 16, 0),
        (124.3, 82, 180),
        (-62.35, -81, 0),
        (62.3, -103, 180),
        (65.65, 41, 0),
        (-65.7, 87, 180),
        (-37, -127.7, -90),
        (22, -124.35, 90),
        (87, -127.7, -90),
        (-102, 124.35, -90),
        (-39, 127.65, 90),
        (48, 124.35, -90),
        (91, 127.65, 90),
        (-18, -65.7, -90),
        (41, 65.65, 90),
    )
    for i, (x, y, angle) in enumerate(lanes):
        place(group, "Street vehicle", fleet[(3 * i + i // 4) % len(fleet)], x, y, 0.038, angle)


def terraces(group, blocks, civic):
    # Reserve circulation, building entries and the existing garden and exhibition furniture.
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    obstacles = []
    for obj in scene.objects:
        if (
            obj.hide_render
            or obj.type not in ("MESH", "EMPTY")
            or (obj.type == "EMPTY" and not obj.instance_collection)
        ):
            continue
        collection_name = obj.users_collection[0].name
        if (
            collection_name == "ENVIRONMENT"
            and obj.name.startswith("CIVRUM_WALK_")
            or collection_name
            in (
                "ROADS",
                "VEGETATION",
                "PUBLIC_FACILITIES",
                "PLACEHOLDER_BUILDINGS",
                "03_Hero_Landmarks",
                "05_Street_Assets",
                "05_Street_Architecture",
                "06_Street_Residents",
                "09 | South commercial corner",
                blocks.name,
                civic.name,
                group.name,
            )
            and not obj.name.startswith("WALK_Paving")
        ):
            obstacles.append(bounds_xy(obj))

    data = bpy.data.objects
    planters = (data["CIVRUM_HI3D_Green_Planter_Tree"], data["CIVRUM_HI3D_Autumn_Planter_Tree"])
    stalls = data["STREET_Coffee_Stall"]
    canopies = [cafe_furniture(t) for t in (GOLD, BRICK, LEAF)]
    bed = Geometry()
    bed.box(0, 0, -0.03, 3.8, 2.15, 0.32, STONE, 0.24, METAL)
    bed.box(0, 0, 0.29, 3.57, 1.94, 0.12, LEAF, 0.24)
    bed_data = bed.mesh("Courtyard rose bed", PALETTE)
    rose = data["GARDEN_Roses"]
    # Start from a shared pedestrian courtyard, then alternate seating, planting and kiosks.
    for district, (cx, cy, width, depth, ground) in enumerate(
        (
            (-95, 68, 42, 51, 0.172),
            (95, 68, 42, 51, 0.172),
            (-32, -95, 43, 41, 0.0),
            (32, -95, 43, 41, 0.0),
            (-94, -85, 41, 47, 0.172),
            (95, -66, 39, 14, 0.172),
            (-2, 94, 67, 37, 0.172),
            (-103, -31, 39, 43, 0.0),
            (103, -31, 39, 43, 0.0),
        )
    ):
        for row in range(math.floor(depth / 7)):
            for col in range(math.floor(width / 7)):
                x = cx + (col - (math.floor(width / 7) - 1) / 2) * 7.0
                y = cy + (row - (math.floor(depth / 7) - 1) / 2) * 7.0
                if abs(x - cx) < 2.5 or abs(y - cy) < 2.0:
                    continue
                index = row * 7 + col * 3 + district
                kind = index % 10
                radius = 2.9 if kind == 0 else 2.0
                margin = 0.58
                if any(
                    x + radius + margin > a
                    and x - radius - margin < b
                    and y + radius + margin > c
                    and y - radius - margin < d
                    for a, b, c, d in obstacles
                ):
                    continue
                if kind == 0:
                    obj = stalls.copy()
                    group.objects.link(obj)
                    obj.name = "Neighbourhood coffee kiosk"
                    obj.location = (x, y, ground)
                    obj.rotation_euler.z += math.pi * (district % 2)
                elif kind in (1, 3, 5, 8):
                    h = 3.25 + 0.23 * (index % 5)
                    asset_instance(
                        group,
                        planters[(row + district) % 4 == 0],
                        x,
                        y,
                        ground,
                        (h,) * 3,
                        index * 45,
                        "Terrace planter",
                    )
                elif kind in (2, 4, 7, 9):
                    place(
                        group,
                        "Cafe | parasol and stools",
                        canopies[(district + row // 2) % 3],
                        x,
                        y,
                        ground,
                        index * 15,
                    )
                else:
                    place(group, "Courtyard | planted bed", bed_data, x, y, ground)
                    for offset in (-1.20, 0, 1.20):
                        shrub = rose.copy()
                        group.objects.link(shrub)
                        shrub.name = "Courtyard | roses"
                        shrub.location = (x + offset, y, ground + 0.41)
                obstacles.append((x - radius, x + radius, y - radius, y + radius))
