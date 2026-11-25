"""Refine one garden-roof shop in the 300 m pedestrian world and render matched views."""

import argparse
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_lakeside import OUTPUT, camera, collection, material, shader, textured
from build_civrum_world import Geometry, circle
from detail_civrum_world import rod

SOURCE = OUTPUT / "CIVRUM_World_300m_Walkthrough.blend"
DEST = OUTPUT / "CIVRUM_World_300m_South_Shop.blend"
SLOT = "Street shop 40"
STONE, INK, BRONZE, BRASS, PLASTER, WOOD, GLASS, SOIL, SAGE, CLAY, LIGHT = range(11)
NAMES = (
    "Limestone",
    "Graphite",
    "Bronze",
    "Brass",
    "Plaster",
    "Oak",
    "Glass",
    "Soil",
    "Sage",
    "Clay",
    "Opal",
)
PALETTE = tuple(("SHOP_" + label,) for label in NAMES)


def finishes():
    for index, tone, detail in (
        (STONE, "827C70", "ABA699"),
        (INK, "343B3F", "474A49"),
        (PLASTER, "BAB5A3", "D6CFB9"),
        (WOOD, "976744", "AE8055"),
        (SOIL, "342C24", "504137"),
    ):
        textured("MAT_" + PALETTE[index][0], tone, detail, 2.2, 145, 0.033)
    for index, tint, roughness, metal in (
        (BRONZE, "52504C", 0.31, 0.68),
        (BRASS, "B99552", 0.32, 0.72),
        (GLASS, "BCD7D7", 0.07, 0),
        (SAGE, "526C48", 0.61, 0),
        (CLAY, "AA6C4F", 0.73, 0),
        (LIGHT, "FFE3AB", 0.36, 0),
    ):
        m = material("MAT_" + PALETTE[index][0], tint, roughness, metal, 1.8 if index == LIGHT else 0)
        if index == GLASS:
            # A clear thin pane: the Fresnel reflection grows at grazing angles.
            tree = m.node_tree
            clear = tree.nodes.new("ShaderNodeBsdfTransparent")
            clear.inputs[0].default_value = (0.94, 0.975, 0.97, 1)
            reflection = tree.nodes.new("ShaderNodeBsdfGlossy")
            reflection.inputs["Roughness"].default_value = 0.065
            # Use the same air/glass response on either face of the thin architectural pane.
            geometry = tree.nodes.new("ShaderNodeNewGeometry")
            angle = tree.nodes.new("ShaderNodeVectorMath")
            angle.operation = "DOT_PRODUCT"
            tree.links.new(geometry.outputs["Incoming"], angle.inputs[0])
            tree.links.new(geometry.outputs["Normal"], angle.inputs[1])
            value = angle.outputs["Value"]
            for op, constants in (
                ("ABSOLUTE", ()),
                ("MULTIPLY_ADD", (-1, 1)),
                ("POWER", (5,)),
                ("MULTIPLY_ADD", (0.96, 0.04)),
            ):
                node = tree.nodes.new("ShaderNodeMath")
                node.operation = op
                tree.links.new(value, node.inputs[0])
                for n, constant in enumerate(constants, 1):
                    node.inputs[n].default_value = constant
                value = node.outputs[0]
            mix = tree.nodes.new("ShaderNodeMixShader")
            tree.links.new(value, mix.inputs[0])
            tree.links.new(clear.outputs[0], mix.inputs[1])
            tree.links.new(reflection.outputs[0], mix.inputs[2])
            tree.nodes.remove(shader(m))
            tree.links.new(mix.outputs[0], tree.nodes.get("Material Output").inputs["Surface"])


def module(group, root, name, geo, bevel=0.018):
    mesh = geo.mesh(name, PALETTE)
    obj = bpy.data.objects.new("Shop 40 | " + name, mesh)
    group.objects.link(obj)
    obj.parent = root
    if bevel:
        edge = obj.modifiers.new("Machined edges", "BEVEL")
        edge.width, edge.segments = bevel, 3
        edge.harden_normals = True
        normal = obj.modifiers.new("Planar face normals", "WEIGHTED_NORMAL")
        normal.keep_sharp = True
    return obj


def frame_window(g, x, y, base, width, height, divisions=2):
    for dx in (-width / 2, width / 2):
        g.box(x + dx, y, base, 0.09, 0.14, height, BRONZE)
    for dz in (0, height - 0.08):
        g.box(x, y, base + dz, width, 0.14, 0.08, BRONZE)
    for i in range(1, divisions):
        g.box(x - width / 2 + width * i / divisions, y, base + 0.08, 0.065, 0.12, height - 0.16, BRONZE)
    g.box(x, y, base + height - 0.54, width, 0.10, 0.046, BRONZE)
    p = len(g.verts)
    g.verts.extend(
        (x + dx, y, base + dz)
        for dx, dz in (
            (-width / 2 + 0.038, 0.045),
            (width / 2 - 0.038, 0.045),
            (width / 2 - 0.038, height - 0.045),
            (-width / 2 + 0.038, height - 0.045),
        )
    )
    g.face((p, p + 1, p + 2, p + 3), GLASS)


def structure(group, root):
    g = Geometry()
    g.box(0, 0.48, 0, 16.72, 11.24, 0.09, STONE)
    for x in (-5.24, 5.24):
        g.box(x, -5.62, 0, 6.24, 0.96, 0.09, STONE)
    g.box(0, 0.205, 0.09, 15.48, 10.69, 0.10, STONE)
    g.box(0, 0.10, 3.24, 15.32, 10.22, 0.31, INK)
    # Split the top deck around the actual rooflight opening.
    for x, y, w, d in (
        (-5.30, 0, 4.9, 10.6),
        (5.30, 0, 4.9, 10.6),
        (0, -3.00, 5.7, 4.60),
        (0, 3.48, 5.7, 3.64),
    ):
        g.box(x, y, 6.20, w, d, 0.30, INK)
    for side in (-1, 1):
        for y in (-4.78, 0, 4.78):
            g.box(side * 7.20, y, 0.19, 0.62, 0.60, 6.01, INK)
        for x in (-2.42, 2.42):
            g.box(x, side * 4.78, 0.19, 0.44, 0.61, 6.01, INK)
        for z in (0.20, 3.58):
            # The front ground-floor entrance occupies a break in this sill.
            if side < 0 and z < 1:
                for x in (-4.81, 4.81):
                    g.box(x, side * 4.64, z, 4.80, 0.40, 0.26, STONE)
            else:
                g.box(0, side * 4.64, z, 14.0, 0.40, 0.26, STONE)
            g.box(side * 7.14, 0, z, 0.40, 9.30, 0.26, STONE)
    # A slim, continuous bronze reveal splits each storey from the stone face.
    for y in (-5.02, 5.02):
        g.box(0, y, 3.22, 15.25, 0.095, 0.075, BRASS)
    module(group, root, "Stone plinth, piers and floor plates", g, 0.032)

    # Repeated reeded pier caps and a slim projecting cornice carry across all four elevations.
    trim = Geometry()
    for side in (-1, 1):
        for x in (-7.2, -2.42, 2.42, 7.2):
            for flute in (-0.115, 0, 0.115):
                trim.box(x + flute, side * 5.095, 0.26, 0.036, 0.043, 5.87, BRONZE)
        for y in (-4.78, 0, 4.78):
            for flute in (-0.115, 0, 0.115):
                trim.box(side * 7.522, y + flute, 0.26, 0.043, 0.036, 5.87, BRONZE)
        trim.box(0, side * 5.30, 6.17, 15.65, 0.28, 0.095, BRONZE)
        trim.box(0, side * 5.435, 6.205, 15.58, 0.025, 0.035, BRASS)
        trim.box(side * 7.72, 0, 6.17, 0.22, 10.39, 0.095, BRONZE)
        for z in (5.76, 5.92):
            for y in (-2.38, 2.38):
                trim.box(side * 7.24, y, z, 0.42, 4.20, 0.060, BRONZE)
    module(group, root, "Reeded piers, end sunshades and drip edges", trim, 0.012)

    g = Geometry()
    for side in (-1, 1):
        for z, h in ((0.46, 2.74), (3.84, 2.35)):
            for x in (-4.81, 0, 4.81):
                if side == -1 and x == 0 and z < 1:
                    continue
                frame_window(g, x, side * 4.50, z, 4.40, h, 2)
            # The same shopfront joinery turns the corner on both end walls.
            end = Geometry()
            for y in (-2.38, 2.38):
                frame_window(end, y, -6.96, z, 4.22, h, 2)
            start = len(g.verts)
            g.verts.extend((-py * side, px * side, pz) for px, py, pz in end.verts)
            g.faces.extend(tuple(start + i for i in face) for face in end.faces)
            g.colors.extend(end.colors)
    module(group, root, "Recessed shop windows and glazing bars", g, 0.009)

    g = Geometry()
    for side in (-1, 1):
        g.box(side * 2.22, -4.12, 0.19, 0.17, 1.52, 3.04, WOOD)
    frame_window(g, 0, -3.40, 0.19, 4.36, 3.00, 4)
    for x in (-0.15, 0.15):
        for z in (1.10, 1.61):
            g.box(x, -3.49, z, 0.039, 0.15, 0.042, BRASS)
        g.box(x, -3.565, 1.10, 0.039, 0.043, 0.56, BRASS)
    g.box(0, -4.98, 3.04, 5.63, 2.01, 0.21, BRONZE, 0.09)
    g.box(0, -5.99, 3.16, 5.49, 0.032, 0.052, BRASS)
    for i in range(24):
        g.box((i - 11.5) * 0.222, -5.03, 2.985, 0.164, 1.75, 0.055, WOOD)
    for x in (-1.43, 1.43):
        g.box(x, -5.1, 2.977, 0.08, 1.20, 0.024, LIGHT)
    # One low sloping threshold meets the parcel on the side facing the avenue.
    p = len(g.verts)
    g.verts.extend(
        (x, y, z)
        for z0 in (0, 1)
        for y, h in ((-6.38, 0.005), (-5.14, 0.19))
        for x, z in ((-2.12, h * z0), (2.12, h * z0))
    )
    for f in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (1, 3, 7, 5), (3, 2, 6, 7), (2, 0, 4, 6)):
        g.face(tuple(p + i for i in f), STONE)
    module(group, root, "Entrance portal, ramp and timber soffit", g, 0.012)


def retained_plants(group, root, original):
    """Keep the actual textured succulent crowns, with cut edges buried in the new beds."""
    src = original.instance_collection.objects[0]
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bm.transform(Matrix.Diagonal((*original.scale, 1)) @ src.matrix_local)
    remove = []
    for vert in bm.verts:
        x, y, z = vert.co
        if not (6.68 <= z and 1.15 < abs(x) < 6.64 and -3.94 < y < 4.08 and (abs(x) > 4.89 or y > 2.42)):
            remove.append(vert)
    bmesh.ops.delete(bm, geom=remove, context="VERTS")
    mesh = bpy.data.meshes.new("Garden retail | retained textured planting")
    for mat in src.data.materials:
        mesh.materials.append(mat)
    bm.to_mesh(mesh)
    bm.free()
    assert mesh.uv_layers and len(mesh.polygons) > 1000
    plants = bpy.data.objects.new("Shop 40 | Original Hi3D roof plants", mesh)
    group.objects.link(plants)
    plants.parent = root
    simplify = plants.modifiers.new("Succulent silhouettes at building scale", "DECIMATE")
    simplify.ratio = 0.22


def roof(group, root):
    g = Geometry()
    for side in (-1, 1):
        for z, w, d, h, tint in (
            (6.50, 0.25, 0.24, 0.39, INK),
            (6.89, 0.32, 0.31, 0.09, BRONZE),
            (6.60, 0.27, 0.26, 0.035, BRASS),
        ):
            g.box(0, side * 5.09, z, 15.30, d, h, tint)
            g.box(side * 7.52, 0, z, w, 10.18 - d, h, tint)
        # The planting bed turns the corner into the back of the roof.
        for x, y, w, d in ((side * 5.80, 0.09, 1.88, 8.20), (side * 3.03, 3.27, 3.68, 1.87)):
            g.box(x, y, 6.50, w, d, 0.29, BRONZE, 0.045)
            g.box(x, y, 6.785, w - 0.13, d - 0.13, 0.025, SOIL, 0.035)
        for i in range(6):
            g.box(side * 3.83, (i - 2.5) * 0.88 - 0.36, 6.503, 0.76, 0.864, 0.045, STONE, 0.012)
    for i in range(8):
        g.box((i - 3.5) * 1.08, -3.39, 6.503, 1.062, 0.72, 0.045, STONE, 0.012)
    for i in (-1, 0, 1):
        g.box(0, 2.92 + i * 0.58, 6.503, 1.53, 0.562, 0.045, STONE, 0.012)
    # Raised, glazed northlight on its own upstand, with individual panes and ridge flashing.
    for y in (-0.75, 1.71):
        g.box(0, y, 6.49, 5.94, 0.17, 0.31, BRONZE)
    for x in (-2.93, 2.93):
        g.box(x, 0.48, 6.49, 0.16, 2.42, 0.31, BRONZE)
    for side in (-1, 1):
        y0, y1 = 0.48 + side * 1.26, 0.48
        for i in range(6):
            x0, x1 = -2.95 + i * 5.9 / 6, -2.95 + (i + 1) * 5.9 / 6
            p = len(g.verts)
            g.verts.extend(((x0, y0, 6.81), (x1, y0, 6.81), (x1, y1, 7.43), (x0, y1, 7.43)))
            g.face(tuple(p + j for j in ((0, 1, 2, 3) if side < 0 else (3, 2, 1, 0))), GLASS)
        for i in range(7):
            x = -2.95 + i * 5.9 / 6
            rod(g, (x, y0, 6.825), (x, y1, 7.445), 0.039, BRONZE, sides=8)
        rod(g, (-2.98, y0, 6.82), (2.98, y0, 6.82), 0.065, BRONZE, sides=8)
    for x in (-2.95, 2.95):
        p = len(g.verts)
        g.verts.extend(((x, -0.78, 6.80), (x, 1.74, 6.80), (x, 0.48, 7.43)))
        g.face((p, p + 1, p + 2) if x > 0 else (p + 2, p + 1, p), GLASS)
    rod(g, (-3, 0.48, 7.46), (3, 0.48, 7.46), 0.056, BRASS, sides=10)
    module(group, root, "Parapet coping, planters and glazed roof lantern", g, 0.017)


def interior(group, root):
    g = Geometry()
    for z in (0.20, 3.55):
        g.box(0, 0.55, z, 14.05, 0.16, 2.62, PLASTER)
        for x in (-4.72, 4.72):
            g.box(x, -0.1, z, 3.63, 0.72, 0.70, WOOD)
            for level in (0.72, 1.40, 2.08):
                g.box(x, -0.05, z + level, 3.69, 0.65, 0.065, WOOD)
                g.box(x, -0.31, z + level - 0.025, 3.47, 0.043, 0.027, LIGHT)
            for end in (-1, 1):
                g.box(x + end * 1.69, 0.08, z + 0.7, 0.06, 0.4, 1.80, BRONZE)
        for x in (-4.8, 4.8):
            g.box(x, -2.74, z, 2.78, 0.92, 0.54, PLASTER, 0.10)
            g.box(x, -2.74, z + 0.54, 2.81, 0.95, 0.08, WOOD, 0.09)
        # A second set of display niches is visible from the rear street.
        for x in (-5.6, -2.8, 2.8, 5.6):
            g.box(x, 2.78, z, 1.8, 0.66, 0.86, WOOD)
        for i in range(17):
            g.box((i - 8) * 0.196, 0.435, z, 0.103, 0.095, 2.62, WOOD)
    module(group, root, "Display floors, shelving and oak joinery", g, 0.016)

    g = Geometry()

    def planter(x, y, z, r, seed):
        g.loft(circle(r * 0.72, 16, x, y), circle(r, 16, x, y), z, z + r * 1.35, CLAY if seed % 3 else STONE)
        g.slab(circle(r * 1.05, 16, x, y), z + r * 1.30, z + r * 1.47, CLAY if seed % 3 else STONE)
        g.slab(circle(r * 0.91, 16, x, y), z + r * 1.47, z + r * 1.49, SOIL)
        base = z + r * 1.49
        for k in range(12):
            a = k * 2.40 + seed
            radius = r * (1.40 if k < 7 else 0.81)
            h = r * (1.25 if k < 7 else 2.05)
            u, v = math.cos(a), math.sin(a)
            p = len(g.verts)
            g.verts.extend(
                (
                    (x, y, base),
                    (
                        x + u * radius * 0.52 - v * r * 0.24,
                        y + v * radius * 0.52 + u * r * 0.24,
                        base + h * 0.66,
                    ),
                    (x + u * radius * 0.51, y + v * radius * 0.51, base + h * 0.83),
                    (x + u * radius, y + v * radius, base + h),
                    (
                        x + u * radius * 0.52 + v * r * 0.24,
                        y + v * radius * 0.52 - u * r * 0.24,
                        base + h * 0.66,
                    ),
                )
            )
            for face in ((0, 2, 1), (1, 2, 3), (3, 2, 4), (4, 2, 0)):
                g.face(tuple(p + i for i in face), SAGE)

    for storey, z in enumerate((0.20, 3.55)):
        for s in (-1, 1):
            for k in range(3):
                planter(
                    s * 4.8 + (k - 1) * 0.76,
                    -2.76,
                    z + 0.62,
                    ((0.22, 0.36, 0.14) if s < 0 else (0.15, 0.23, 0.19))[k],
                    k + storey,
                )
                for level in (0.785, 1.465, 2.145):
                    planter(
                        s * 4.72 + (k - 1) * 0.88, -0.15, z + level, 0.13 + 0.03 * (k % 2), k + int(level * 5)
                    )
            for x in (2.8, 5.6):
                planter(s * x, 2.78, z + 0.86, 0.31, storey + 2)
    planter(1.53, -2.24, 0.20, 0.45, 4)
    planter(-5.98, 1.61, 3.55, 0.51, 5)
    module(group, root, "Ceramic pots and folded leaves", g, 0)

    for side in (-1, 1):
        for floor in (0, 1):
            data = bpy.data.lights.new("Shop display wash", "AREA")
            data.energy, data.shape, data.size = (145 if floor else 210), "DISK", 4
            data.color = (1, 0.81, 0.61)
            obj = bpy.data.objects.new("Shop 40 | Interior display wash", data)
            group.objects.link(obj)
            obj.parent = root
            obj.location = (side * 4.35, -2.46, 6.04 if floor else 3.05)
            obj.rotation_euler.x = math.radians(26)
        data = bpy.data.lights.new("Rear clerestory daylight", "AREA")
        data.energy, data.color, data.shape, data.size = 210, (1, 0.87, 0.70), "DISK", 4.5
        obj = bpy.data.objects.new("Shop 40 | Rear window display wash", data)
        group.objects.link(obj)
        obj.parent = root
        obj.location = (side * 3.9, 2.05, 5.94)


def lettering(group, root, body, x, y, z, size, tint):
    font = bpy.data.curves.new(body, "FONT")
    font.body, font.align_x, font.size, font.space_character = body, "CENTER", size, 1.15
    font.extrude, font.bevel_depth = 0.006, 0.002
    font.resolution_u, font.bevel_resolution = 8, 1
    font.materials.append(bpy.data.materials["MAT_" + PALETTE[tint][0]])
    obj = bpy.data.objects.new("Shop 40 | " + body, font)
    group.objects.link(obj)
    obj.parent = root
    obj.location = (x, y, z)
    obj.rotation_euler.x = math.pi / 2


def signage(group, root):
    g = Geometry()
    g.box(0, -5.073, 3.29, 5.75, 0.12, 0.52, INK, 0.035)
    # Double-faced botanical sign on a bracket, legible along the pavement.
    x, y, z = 2.43, -5.59, 2.85
    g.box(x, -5.50, 3.42, 0.078, 1.00, 0.078, BRONZE)
    for dy in (-0.24, 0.24):
        g.box(x, y + dy, 3.21, 0.027, 0.027, 0.22, BRASS)
    g.box(x, y, z - 0.36, 0.095, 0.72, 0.72, BRASS, 0.025)
    g.box(x, y, z - 0.326, 0.11, 0.658, 0.653, SAGE, 0.015)
    for sign in (-1, 1):
        xx = x + sign * 0.059
        rod(g, (xx, y - 0.07, z - 0.20), (xx, y + 0.085, z + 0.20), 0.012, BRASS, sides=8)
        for a, b, tilt in ((-0.03, -0.055, -1), (0.018, 0.042, 1), (0.063, 0.138, -1)):
            p = len(g.verts)
            g.verts.extend(
                [
                    (xx, y + a, z + b),
                    (xx, y + a + tilt * 0.085, z + b + 0.015),
                    (xx, y + a + tilt * 0.125, z + b + 0.100),
                    (xx, y + a + tilt * 0.046, z + b + 0.075),
                ]
            )
            g.face((p, p + 1, p + 2, p + 3), BRASS)
    module(group, root, "Enamel shop fascia", g)
    lettering(group, root, "GARDEN SUPPLY", 0, -5.141, 3.405, 0.34, STONE)
    lettering(group, root, "40", -2.42, -5.127, 1.69, 0.21, BRASS)
    lettering(group, root, "PLANTS   /   TOOLS", 0, 0.356, 1.88, 0.155, INK)


def render(scene, cam, path, width, draft):
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = width, width * 9 // 16
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 12 if draft else 48
    scene.cycles.adaptive_threshold = 0.070 if draft else 0.018
    scene.cycles.use_denoising = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def verify(scene, group, root):
    original = bpy.data.objects[SLOT]
    assert original.hide_render and original.hide_viewport
    assert not group.hide_render and not group.hide_viewport
    assert not [lib.name for lib in bpy.data.libraries if lib.is_missing or not lib.filepath.startswith("//")]
    neighbours = [
        o
        for o in scene.objects
        if o != original
        and o.instance_collection
        and o.instance_collection == original.instance_collection
        and not o.hide_render
    ]
    assert len(neighbours) == 28
    graph = bpy.context.evaluated_depsgraph_get()

    def hit(start, direction):
        result, pt, _, _, obj, _ = scene.ray_cast(
            graph, root.matrix_world @ Vector(start), root.matrix_world.to_3x3() @ Vector(direction)
        )
        assert result, (start, direction)
        return root.matrix_world.inverted() @ pt, obj.name

    front, _ = hit((4, -7, 1.35), (0, 1, 0))
    door, _ = hit((1.4, -7, 1.35), (0, 1, 0))
    beyond, obj = hit((4, -4.47, 1.35), (0, 1, 0))
    glass, _ = hit((0.35, -0.12, 8), (0, 0, -1))
    floor, _ = hit((0.35, -0.12, 6.17), (0, 0, -1))
    assert abs(front.y + 4.50) < 0.025 and abs(door.y + 3.40) < 0.025, (front, door)
    assert beyond.y - front.y > 0.8 and obj.startswith("Shop 40"), (beyond, obj)
    assert glass.z > 6.85 and floor.z < 4.0, (glass, floor)
    mesh_tris = 0
    for obj in group.objects:
        if obj.type in {"MESH", "FONT"}:
            evaluated = obj.evaluated_get(graph)
            mesh = evaluated.to_mesh()
            mesh.calc_loop_triangles()
            mesh_tris += len(mesh.loop_triangles)
            evaluated.to_mesh_clear()
    (source,) = original.instance_collection.objects
    source.data.calc_loop_triangles()
    assert 0 < mesh_tris < len(source.data.loop_triangles), mesh_tris
    print(
        f"Shop QA: {len(neighbours)} other garden shops; {mesh_tris:,} evaluated triangles; "
        f"door setback {door.y - front.y:.2f} m; window sightline {beyond.y - front.y:.2f} m; "
        f"rooflight {glass.z:.2f} m above floor at {floor.z:.2f} m.",
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", action="store_true")
    parser.add_argument("--views", nargs="+", choices=["street", "roof", "overview"], default=[])
    parser.add_argument("--draft", type=Path)
    parser.add_argument("--device", choices=["CPU", "CUDA"], default="CPU")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene = bpy.context.scene
    world = bpy.data.collections["CIVRUM_WORLD"]
    original = bpy.data.objects[SLOT]
    assert original.instance_collection.name == "CIVRUM | Garden Roof Retail"
    group = collection(world, "16 | South garden shop")
    group.instance_offset = original.location
    root = bpy.data.objects.new("Shop 40 | Ground centre", None)
    group.objects.link(root)
    root.location, root.rotation_euler = original.location, original.rotation_euler
    finishes()
    structure(group, root)
    retained_plants(group, root, original)
    roof(group, root)
    interior(group, root)
    signage(group, root)
    views = collection(world, "17 | South shop review cameras")
    cams = {
        "street": camera(views, "SHOP_CAM_01 | Street frontage", (3.4, -120.2, 1.78), (17, -141, 3.65), 34),
        "roof": camera(views, "SHOP_CAM_02 | Roof inspection", (33, -165, 20), (17, -141, 3.6), 43),
        "overview": bpy.data.objects["LAKE_CAM_01 | City overview"],
    }
    original.hide_render = original.hide_viewport = True
    scene.camera = cams["street"]
    scene.render.filepath = "//renders/CIVRUM_South_Shop_Street_After.png"
    if args.save:
        camera_names = {key: obj.name for key, obj in cams.items()}
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(DEST), compress=True)
        bpy.ops.wm.open_mainfile(filepath=str(DEST))
        scene = bpy.context.scene
        group = bpy.data.collections["16 | South garden shop"]
        root = bpy.data.objects["Shop 40 | Ground centre"]
        original = bpy.data.objects[SLOT]
        cams = {key: bpy.data.objects[name] for key, name in camera_names.items()}
    verify(scene, group, root)
    output = args.draft or OUTPUT / "renders"
    output.mkdir(parents=True, exist_ok=True)
    if args.device == "CUDA":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "CUDA"
        prefs.refresh_devices()
        assert any(d.type == "CUDA" for d in prefs.devices)
        for d in prefs.devices:
            d.use = d.type == "CUDA"
        scene.cycles.device = "GPU"
    scene.frame_set(120)
    for key in args.views:
        for before in (True, False):
            group.hide_render = before
            original.hide_render = not before
            label = "Before" if before else "After"
            width = 960 if args.draft else 2560 if key == "overview" else 1920
            render(
                scene, cams[key], output / f"CIVRUM_South_Shop_{key.title()}_{label}.png", width, args.draft
            )


if __name__ == "__main__":
    main()
