"""Finish the citizen registry frontage and connect the construction yard to its street."""

import math

import bpy
from build_civrum_world import Geometry, circle, rectangle
from civrum_lakeside_blocks import BASALT, GOLD, LEAF, METAL, PALETTE, STONE, place
from detail_civrum_world import rod
from mathutils import Matrix

REGISTRY = "HERO_03_Citizen_Registration"
REGISTRY_BODY = "CIVRUM_Citizen_Registry_Textured"
REGISTRY_SIGN = "CIVRUM_Citizen_Registry_Nameplate"


def enamel_sign(name, artwork, center, size, slope=0):
    cx, cy, cz = center
    half_w, half_h = (value / 2 for value in size)
    sign = bpy.data.meshes.new(name)
    sign.from_pydata(
        [
            (cx + x * half_w, cy + slope * x * half_w, cz + z * half_h)
            for x, z in ((-1, -1), (1, -1), (1, 1), (-1, 1))
        ],
        [],
        [(0, 1, 2, 3)],
    )
    sign.update()
    uv = sign.uv_layers.new()
    for loop, coord in zip(uv.data, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop.uv = coord
    material = bpy.data.materials.new(name + " enamel")
    material.use_nodes = True
    texture = material.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(artwork))
    texture.image.pack()
    surface = material.node_tree.nodes.get("Principled BSDF")
    surface.inputs["Roughness"].default_value = 0.52
    material.node_tree.links.new(texture.outputs["Color"], surface.inputs["Base Color"])
    sign.materials.append(material)
    return sign


def build_registry_library(source, artwork, destination):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    group = bpy.context.scene.collection
    (body,) = [o for o in group.all_objects if o.type == "MESH"]
    bpy.context.view_layer.update()
    body.data.transform(body.matrix_world)
    body.matrix_world = Matrix.Identity(4)
    body.data.name = REGISTRY_BODY
    assert abs(body.dimensions.x - 13) < 0.001, "Expected the 13 m registry atlas export"

    # The sign sits on the exterior fascia. Keep glyphs off the projected elevation atlas.
    factor = 13 / 7
    center = (0.19 * factor, -2.79 * factor - 0.012, 1.70 * factor)
    sign = enamel_sign(REGISTRY_SIGN, artwork, center, (2.62 * factor, 0.55 * factor))
    place(group, "Registry frontage badge", sign, 0, 0, 0)
    bpy.ops.file.pack_all()
    destination.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(destination), compress=True)


def finish_registry(library):
    body = bpy.data.objects[REGISTRY]
    with bpy.data.libraries.load(str(library), link=True, relative=True) as (_, linked):
        linked.meshes = [REGISTRY_BODY, REGISTRY_SIGN]
    body.data, badge = linked.meshes
    body["asset_status"] = "AUTHORED_ELEVATION_TEXTURES"
    body["asset_finish"] = "Existing registry mesh with civic elevation atlas and enamel nameplate"
    sign = bpy.data.objects.new("Registry | Enamel nameplate", badge)
    body.users_collection[0].objects.link(sign)
    sign.parent = body


def finish_works_frontage(artwork):
    body = bpy.data.objects["HERO_04_Public_Construction"]
    data = enamel_sign("Public Works Nameplate", artwork, (0.965, -8.085, 5.77), (6.12, 1.45), 0.145)
    sign = place(body.users_collection[0], "Public works | Enamel nameplate", data, 0, 0, 0)
    sign.parent = body
    sign.rotation_euler.z = math.pi
    backing = sign.modifiers.new("Enamel thickness", "SOLIDIFY")
    backing.thickness = 0.18


def works_entrance_trim(material):
    """Rebuild the main treads and canopy edge from their measured local profiles."""
    body = bpy.data.objects["HERO_04_Public_Construction"]
    group = body.users_collection[0]
    limestone = material("MAT_Works honed limestone", "B2A08A", 0.71)
    shadow = material("MAT_Works recessed joint", "69564A", 0.83)
    palette = (*PALETTE, (limestone.name[4:],), (shadow.name[4:],))
    stone, joint = len(PALETTE), len(PALETTE) + 1

    stairs = Geometry()
    # The flat treads cover the uneven import up to the existing door landing.
    for front, top in ((8.21, 0.329), (7.68, 0.570), (7.115, 0.811), (6.535, 1.052)):
        back = 5.38
        stairs.box(0.02, (front + back) / 2, 0.018, 7.91, front - back, top - 0.018, stone, 0.025)
        stairs.box(0.02, front - 0.090, top, 7.37, 0.058, 0.003, joint)
    for x in (-4.035, 4.075):
        footprint = rectangle(x, 7.055, 0.60, 3.32, 0.038)
        # Close the side cheeks back into the entrance wall, following the whole pitch.
        low = len(stairs.verts)
        stairs.verts.extend((px, py, 0.013) for px, py in footprint)
        stairs.verts.extend((px, py, 1.185 - (py - 5.395) * 0.233) for px, py in footprint)
        size = len(footprint)
        stairs.face(tuple(range(low + size - 1, low - 1, -1)), stone)
        stairs.face(tuple(range(low + size, low + 2 * size)), stone)
        for i in range(size):
            a, b = low + i, low + (i + 1) % size
            stairs.face((a, b, b + size, a + size), stone)
    assembly = place(
        group, "Public works | square treads and stringers", stairs.mesh("Works stair", palette), 0, 0, 0
    )
    assembly.parent = body
    bevel = assembly.modifiers.new("Honed stair edges", "BEVEL")
    bevel.width = 0.026
    bevel.segments = 3
    bevel.harden_normals = True

    # Long continuous section with recessed bronze under the visible limestone edge.
    sections = (
        (-5.48, 7.31, 4.32),
        (-4.73, 7.66, 4.30),
        (-3.6, 7.92, 4.29),
        (-2.3, 8.10, 4.28),
        (-0.8, 8.29, 4.28),
        (0.75, 8.43, 4.28),
        (2.25, 8.52, 4.29),
        (3.4, 8.55, 4.30),
        (4.24, 8.41, 4.31),
        (5.1, 8.10, 4.33),
        (5.89, 7.69, 4.36),
        (6.35, 7.26, 4.40),
    )
    profile = (
        (-0.40, 0),
        (-0.09, 0),
        (0.002, 0.051),
        (0.032, 0.100),
        (0.033, 0.259),
        (-0.009, 0.317),
        (-0.40, 0.317),
    )
    eave = Geometry()
    count = len(profile)

    def add_coping(path, height):
        start = len(eave.verts)
        for x, y, z in path:
            eave.verts.extend((x, y + dy, z + dz * height) for dy, dz in profile)
        end = len(eave.verts)
        for offset in range(start, end - count, count):
            for i in range(count):
                a, b = offset + i, offset + (i + 1) % count
                eave.face((a, b, b + count, a + count), joint if i == 1 else stone)
        eave.face(tuple(range(start + count - 1, start - 1, -1)), stone)
        eave.face(tuple(range(end - count, end)), stone)

    add_coping(sections, 1.0)
    # Fit a continuous crown across the existing wave without covering the sign or emblem.
    crest = (
        (-5.53, 6.51, 6.535),
        (-5.29, 6.94, 6.51),
        (-4.76, 7.34, 6.386),
        (-3.95, 7.64, 6.319),
        (-3.08, 7.80, 6.298),
        (-2.14, 7.94, 6.326),
        (-1.37, 8.04, 6.405),
        (-0.49, 8.13, 6.596),
        (0.29, 8.21, 6.776),
        (1.18, 8.29, 6.941),
        (2.0, 8.34, 7.023),
        (2.74, 8.38, 7.055),
        (3.45, 8.38, 7.005),
        (4.17, 8.30, 6.78),
        (4.70, 8.12, 6.48),
        (5.17, 7.79, 6.13),
    )
    add_coping(crest, 0.57)
    lip = place(
        group, "Public works | continuous entrance coping", eave.mesh("Works eave coping", palette), 0, 0, 0
    )
    lip.parent = body
    for polygon in lip.data.polygons:
        polygon.use_smooth = len(polygon.vertices) == 4
    normals = lip.modifiers.new("Continuous stone highlights", "WEIGHTED_NORMAL")
    normals.keep_sharp = True


def works_roof(material):
    body = bpy.data.objects["HERO_04_Public_Construction"]
    group = body.users_collection[0]
    # Retain the atlas for masonry, but temper its baked highlight before fitting the roof.
    surface = body.data.materials[0].copy()
    surface.name = "Public Works | limestone and bronze"
    slot = body.material_slots[0]
    slot.link = "OBJECT"
    slot.material = surface
    tree = surface.node_tree
    shader = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    color_socket = shader.inputs["Base Color"]
    image_color = color_socket.links[0].from_socket
    grade = tree.nodes.new("ShaderNodeHueSaturation")
    grade.inputs["Saturation"].default_value = 0.87
    grade.inputs["Value"].default_value = 0.83
    tree.links.new(image_color, grade.inputs["Color"])
    tree.links.new(grade.outputs["Color"], color_socket)

    glazing = (
        ("Works roof | petrol glass", "286271"),
        ("Works roof | blue glass", "347E93"),
        ("Works roof | slate glass", "345262"),
    )
    names = []
    for name, tint in glazing:
        mat = material("MAT_" + name, tint, 0.25, 0.34)
        names.append((mat.name.removeprefix("MAT_"),))
    palette = (*PALETTE, *names)
    glass = len(PALETTE)
    cx, cy = 4.45, 1.16
    sectors = 16
    # Dome crown and lower curb fit the roof measured on the linked source mesh.
    profile = (
        (1.58, 13.16),
        (2.43, 13.00),
        (3.15, 12.63),
        (3.76, 12.06),
        (4.29, 11.19),
        (4.59, 10.28),
        (4.72, 9.40),
    )
    frame = Geometry()
    for row, (radius, z) in enumerate(profile):
        phase = math.pi / sectors * (row % 2)
        frame.verts.extend((x, y, z) for x, y in circle(radius, sectors, cx, cy, phase))
    joints = set()
    for row in range(len(profile) - 1):
        for i in range(sectors):
            j = (i + 1) % sectors
            a, b = row * sectors + i, row * sectors + j
            c, d = (row + 1) * sectors + i, (row + 1) * sectors + j
            triangles = ((a, c, b), (b, c, d)) if row % 2 == 0 else ((a, c, d), (a, d, b))
            for panel, face in enumerate(triangles):
                frame.face(face, glass + (i * 5 + row * 2 + panel) % 3)
                for u, v in zip(face, (*face[1:], face[0])):
                    joints.add(tuple(sorted((u, v))))
    for a, b in sorted(joints):
        rod(frame, frame.verts[a], frame.verts[b], 0.084, METAL if a // sectors == b // sectors else GOLD)
    frame.loft(circle(4.80, sectors, cx, cy), circle(4.76, sectors, cx, cy), 9.14, 9.43, BASALT)
    frame.band(circle(4.76, sectors, cx, cy), circle(4.55, sectors, cx, cy), 9.445, GOLD)
    frame.slab(circle(1.62, sectors, cx, cy), 13.14, 13.69, glass)
    frame.slab(circle(1.70, sectors, cx, cy), 13.69, 13.82, GOLD)
    frame.slab(circle(1.49, sectors, cx, cy), 13.82, 13.94, BASALT)
    for i in range(8):
        angle = i * math.tau / 8
        x, y = cx + 1.59 * math.cos(angle), cy + 1.59 * math.sin(angle)
        rod(frame, (x, y, 13.17), (x, y, 13.69), 0.075, METAL)
    dome = place(
        group, "Public works | geometric glass dome", frame.mesh("CIVRUM Works dome", palette), 0, 0, 0
    )
    dome.parent = body

    deck = Geometry()
    deck.box(-7.32, -2.60, 8.46, 4.55, 3.80, 0.26, BASALT, 0.34, METAL)
    deck.box(-7.32, -2.60, 8.71, 3.98, 3.31, 0.042, STONE, 0.28)
    for x in (-8.63, -6.0):
        deck.box(x, -2.60, 8.75, 1.12, 2.98, 0.20, METAL, 0.17, GOLD)
        deck.box(x, -2.60, 8.94, 0.96, 2.84, 0.08, LEAF, 0.15)
        for i, y in enumerate((-3.53, -2.60, -1.64)):
            dz = 0.24 + i % 2 * 0.12
            deck.loft(circle(0.25, 7, x, y), circle(0.39, 7, x, y, 0.31), 9.02, 9.11, LEAF)
            deck.loft(circle(0.39, 7, x, y, 0.31), circle(0.18, 7, x + 0.035, y), 9.11, 9.11 + dz, LEAF)
    terrace = place(
        group,
        "Public works | roof planters and pavers",
        deck.mesh("CIVRUM Works roof deck", PALETTE),
        0,
        0,
        0,
    )
    terrace.parent = body


def worksite(group, crane, yard_material):
    """Seat the gate approach and equipment on one finished yard surface."""
    objects = bpy.data.objects
    palette = (*PALETTE, (yard_material.name.removeprefix("MAT_"),))
    aggregate = len(PALETTE)
    for name in ("CIVRUM_WORKS_GATE_APPROACH", "CIVRUM_WORKS_YARD_MARKINGS"):
        objects[name].hide_render = objects[name].hide_viewport = True

    site = Geometry()
    finish = 0.205
    site.box(0, 0, -0.035, 39.64, 15.68, finish + 0.035, aggregate)
    site.box(-7, 1.62, finish, 18.35, 8.32, 0.073, STONE, 0.13)
    # Offset the mast east of the delivery aisle and leave room south for storage.
    site.box(107.4 - 95, 3.55, finish, 7.0, 7.0, 0.124, STONE, 0.18)
    for side in (-1, 1):
        site.box(4.4 + side * 2.20, 0, finish + 0.001, 0.11, 14.86, 0.005, GOLD)
        site.box(4.4 + side * 2.20, -3.8, finish + 0.007, 0.20, 0.58, 0.07, BASALT)
    for y in (-4.7, -1.9, 0.9, 3.7):
        site.box(4.4, y, finish + 0.001, 0.095, 1.08, 0.003, STONE)
    for x in (17.8, 18.6):
        site.box(x, -4.6, finish, 0.11, 5.5, 0.006, GOLD)
    place(group, "Works | graded yard and pads", site.mesh("CIVRUM works surfaces", palette), 95, -103.6, 0)

    apron = Geometry()
    x0, x1 = 95, 103
    y0, y1 = -119.76, -111.32
    apron.verts = [
        (x0, y0, -0.035),
        (x1, y0, -0.035),
        (x1, y1, -0.035),
        (x0, y1, -0.035),
        (x0, y0, 0.176),
        (x1, y0, 0.176),
        (x1, y1, finish),
        (x0, y1, finish),
    ]
    for polygon in ((3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        apron.face(polygon, STONE)
    for x in (95.58, 102.42):
        apron.surface([(x - 0.05, y0), (x + 0.05, y0), (x + 0.05, y1), (x - 0.05, y1)], finish + 0.003, GOLD)
        for vertex in (0, 1):
            index = len(apron.verts) - 4 + vertex
            px, py, _ = apron.verts[index]
            apron.verts[index] = (px, py, 0.179)
    place(group, "Works | solid gate approach", apron.mesh("CIVRUM works ramp", PALETTE), 0, 0, 0)

    crane.location = (107.4, -100.05, finish + 0.124)
    crane.rotation_euler.z = math.radians(64)
    fence_colors = {"MAT_CIVIC_TEAL": PALETTE[BASALT][0], "MAT_TECH_YELLOW": PALETTE[GOLD][0]}
    keep = bpy.data.collections["CONSTRUCTION"]
    for obj in keep.objects:
        name = obj.name
        if name.startswith("CIVRUM_CONSTRUCTION_FENCE"):
            for slot in obj.material_slots:
                replacement = fence_colors.get(slot.material.name)
                if replacement:
                    slot.link = "OBJECT"
                    slot.material = bpy.data.materials["MAT_" + replacement]
        else:
            top = 0.278 if name.startswith("CIVRUM_CONSTRUCTION_FOUNDATION") else finish
            obj.location.z += top - 0.172
    for suffix, y in (("", -104.65), (".001", -109.50)):
        objects["CIVRUM_CONSTRUCTION_RACK_01" + suffix].location.xy = (111.0, y)
    objects["CIVRUM_CONSTRUCTION_BARRIER_01"].location.x = 93.2
    objects["CIVRUM_CONSTRUCTION_BARRIER_01.001"].location.x = 105.15

    public_walk = Geometry()
    public_walk.box(0, 0, -0.032, 10.4, 12.9, 0.231, STONE, 0.58)
    for side in (-1, 1):
        public_walk.box(side * 4.85, 0, 0.199, 0.19, 11.72, 0.02, METAL)
        public_walk.box(side * 3.7, 2.9, 0.20, 0.09, 5.41, 0.009, GOLD)
    place(
        group,
        "Public works | entrance promenade",
        public_walk.mesh("CIVRUM works public walk", PALETTE),
        95,
        -66.95,
        0,
    )
    builder = bpy.data.objects["RESIDENT_02"]
    builder.location.z += 0.199 - 0.172
