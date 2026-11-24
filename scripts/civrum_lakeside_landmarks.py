"""Finish the citizen registry frontage and connect the construction yard to its street."""

import math

import bpy
from build_civrum_world import Geometry
from civrum_lakeside_blocks import BASALT, GOLD, METAL, PALETTE, STONE, place
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
    site.box(107.4 - 95, 3.55, finish, 6.45, 6.3, 0.124, STONE, 0.18)
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
    crane.rotation_euler.z = math.radians(13.5)
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
    for suffix, y in (("", -104.25), (".001", -109.50)):
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
