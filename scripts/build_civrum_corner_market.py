"""Refine the Nexus corner commercial building in the 300 m gold dusk study."""

import argparse
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_lakeside import OUTPUT, camera, collection
from build_civrum_shop_dusk import area
from build_civrum_south_shop import (
    BRASS,
    BRONZE,
    CLAY,
    INK,
    LIGHT,
    PLASTER,
    SAGE,
    SOIL,
    STONE,
    WOOD,
    frame_window,
    lettering,
    module,
)
from build_civrum_world import Geometry, circle

SOURCE = OUTPUT / "CIVRUM_World_300m_Gold_Dusk.blend"
DESTINATION = OUTPUT / "CIVRUM_World_300m_Corner_Market.blend"
ORIGINAL = "CIVRUM_HI3D_Billboard_Commercial"
BUILDING = "19 | Corner Market"
STREET_CAMERA = "MARKET_CAM | From the south avenue"
DETAIL_CAMERA = "MARKET_CAM | Angled entrance"
OVERVIEW_CAMERA = "LAKE_CAM_01 | City overview"

# The southwest chamfer opens onto the existing sidewalk. The upper wing recedes on both street faces.
PODIUM = ((-5.05, -5.78), (6.70, -5.78), (6.70, 5.55), (-6.78, 5.55), (-6.78, -4.05))
WING = ((-3.46, -3.46), (6.33, -3.46), (6.33, 5.32), (-4.58, 5.32), (-4.58, -2.34))


def edges(outline):
    return zip(outline, (*outline[1:], outline[0]), strict=True)


def orient(destination, source, start, end):
    """Place facade joinery in a planar, inward-facing coordinate system."""
    start, end = Vector(start), Vector(end)
    front = (end - start).normalized()
    inward = Vector((-front.y, front.x))
    offset = len(destination.verts)
    destination.verts.extend((*(start + front * u + inward * v), h) for u, v, h in source.verts)
    destination.faces.extend(tuple(offset + i for i in face) for face in source.faces)
    destination.colors.extend(source.colors)


def part(group, root, name, geo, bevel=0.022):
    obj = module(group, root, name, geo, bevel)
    obj.name = "Market | " + name
    return obj


def frontage(group, root, outline, level, top, ground=False):
    structure, glazing = Geometry(), Geometry()
    bays = (3, 3, 4, 3, 1)
    for side, (start, end) in enumerate(edges(outline)):
        length = (Vector(end) - Vector(start)).length
        structure_local, glazing_local = Geometry(), Geometry()
        sill = level + (0.07 if ground else 0.34)
        for bay in range(bays[side]):
            width = length / bays[side]
            at = (bay + 0.5) * width
            if ground and side == 4:
                # A wide angled door is recessed into the chamfer. The glass plane is inside the canopy.
                frame_window(glazing_local, at, 1.13, level, 2.34, top - level - 0.18, 2)
                for x in (at - 1.20, at + 1.20):
                    structure_local.box(x, 0.64, level, 0.19, 1.40, top - level, WOOD)
                for x in (at - 0.13, at + 0.13):
                    glazing_local.box(x, 1.04, 1.04, 0.033, 0.16, 0.62, BRASS)
                continue
            if not ground:
                structure_local.box(at, 0.10, level, width, 0.45, 0.35, INK)
                structure_local.box(at, -0.055, sill - 0.042, width - 0.17, 0.37, 0.075, STONE)
            frame_window(glazing_local, at, 0.35, sill, width - 0.30, top - sill - 0.10, 2)
        for i in range(bays[side] + 1):
            u = length * i / bays[side]
            structure_local.box(u, 0.07, level, 0.21, 0.57, top - level, INK)
            if side == 4 or (level < 7.22 and 0 < i < bays[side]):
                structure_local.box(u, -0.234, level + 0.17, 0.038, 0.051, top - level - 0.23, BRASS)
        orient(structure, structure_local, start, end)
        orient(glazing, glazing_local, start, end)
    part(group, root, f"Level {level:g} graphite piers and sills", structure)
    part(group, root, f"Level {level:g} recessed glazing and frames", glazing, 0.008)


def massing(group, root):
    geom = Geometry()
    geom.slab(((-6.00, -6.35), (7.10, -6.35), (7.10, 6.12), (-7.10, 6.12), (-7.10, -5.25)), 0, 0.13, STONE)
    for floor, outline in ((3.80, PODIUM), (6.90, PODIUM), (9.87, WING), (12.84, WING), (15.81, WING)):
        # The layered slab projects beyond the recessed glass on all sides.
        geom.slab(outline, floor, floor + 0.18, INK)
        geom.slab(outline, floor + 0.18, floor + 0.225, BRASS)
        geom.slab(outline, floor + 0.225, floor + 0.32, BRONZE)
    part(group, root, "Stone apron and five layered cornices", geom)
    for level, top, outline in (
        (0.13, 3.80, PODIUM),
        (4.12, 6.90, PODIUM),
        (7.22, 9.87, WING),
        (10.19, 12.84, WING),
        (13.16, 15.81, WING),
    ):
        frontage(group, root, outline, level, top, ground=level < 1)

    canopy = Geometry()
    border = (
        (-5.55, -6.28),
        (5.83, -6.28),
        (5.83, -5.52),
        (-4.88, -5.52),
        (-6.51, -3.90),
        (-6.51, 1.30),
        (-7.08, 1.30),
        (-7.08, -4.75),
    )
    canopy.slab(border, 3.17, 3.35, BRONZE)
    canopy.slab(border, 3.35, 3.40, BRASS)
    canopy.box(0.37, -5.82, 3.42, 4.50, 0.13, 0.36, INK, 0.028)
    diag = Geometry()
    diag.box(1.22, 0.03, 3.14, 1.80, 0.09, 0.035, LIGHT)
    orient(canopy, diag, PODIUM[-1], PODIUM[0])
    for x in (-3.1, 0, 3.1):
        canopy.box(x, -5.98, 3.14, 1.34, 0.045, 0.035, LIGHT)
    part(group, root, "Wraparound rain canopy and amber diffusers", canopy)


def green_box(geom, x, y, base, wide, deep):
    geom.box(x, y, base, wide, deep, 0.34, INK, 0.075)
    geom.box(x, y, base + 0.33, wide - 0.10, deep - 0.10, 0.024, SOIL, 0.045)
    plants = max(2, round(wide / 0.49))
    for n in range(plants):
        px = x + (n - (plants - 1) / 2) * (wide - 0.36) / plants
        py = y + 0.07 * (-1) ** n
        for k in range(3):
            offset = (k - 1) * 0.08
            height = 0.23 + 0.045 * ((2 * n + k) % 4)
            geom.loft(
                circle(0.11, 7, px, py + offset),
                circle(0.15, 7, px + offset, py + offset),
                base + 0.35,
                base + 0.35 + height * 0.55,
                SAGE,
            )
            geom.loft(
                circle(0.15, 7, px + offset, py + offset),
                circle(0.045, 7, px + offset * 2, py + offset),
                base + 0.35 + height * 0.55,
                base + 0.35 + height,
                SAGE,
            )


def roof_and_terrace(group, root):
    g = Geometry()
    for outline, z in ((PODIUM, 7.22), (WING, 16.13)):
        for start, end in edges(outline):
            rails = Geometry()
            length = (Vector(end) - Vector(start)).length
            rails.box(length / 2, 0.12, z, length, 0.22, 0.36, INK)
            rails.box(length / 2, 0.12, z + 0.36, length, 0.26, 0.07, BRONZE)
            rails.box(length / 2, 0.12, z + 0.42, length, 0.26, 0.045, BRASS)
            orient(g, rails, start, end)
    for x in (-3.05, 0.45, 3.95):
        green_box(g, x, -5.06, 7.22, 2.48, 0.68)
    for y in (-2.08, 0, 2.08, 4.16):
        green_box(g, -6.08, y, 7.22, 0.56, 1.48)
    for y in (0.60, 2.13, 3.66):
        green_box(g, 5.60, y, 16.13, 0.75, 1.10)
    for x in (-2.34, 1.13):
        green_box(g, x, -2.78, 16.13, 2.68, 0.65)
    for i in range(8):
        g.box(-3.88 + i * 1.12, -4.27, 7.224, 1.10, 0.45, 0.054, STONE)
    for i in range(6):
        g.box(-5.30, -2.55 + i * 1.21, 7.224, 0.55, 1.19, 0.054, STONE)
    part(group, root, "Planted stepbacks and parapet caps", g, 0.012)

    g = Geometry()
    g.box(2.38, 3.06, 16.13, 3.97, 3.35, 1.37, INK, 0.10)
    g.box(2.38, 3.06, 17.50, 4.14, 3.50, 0.17, BRONZE, 0.10)
    g.box(2.38, 3.06, 17.67, 4.11, 3.47, 0.038, BRASS, 0.10)
    for i in range(11):
        g.box(1.35 + i * 0.196, 1.365, 16.56, 0.11, 0.053, 0.70, BRONZE)
    for x in (-2.52, -0.61, 1.34, 3.24):
        g.box(x, -1.52, 16.13, 0.14, 0.49, 1.04, BRONZE)
    g.box(0.36, -1.75, 16.67, 7.54, 0.36, 1.19, BRONZE, 0.09)
    g.box(0.36, -1.95, 16.76, 7.29, 0.072, 1.00, INK, 0.07)
    for z in (16.75, 17.76):
        g.box(0.36, -1.99, z, 7.13, 0.045, 0.038, BRASS, 0.014)
    part(group, root, "Roof plant room and framed rooftop sign", g)
    sign_before = set(root.children)
    lettering(group, root, "NEXCIV", 0.36, -2.001, 17.00, 0.66, BRASS)
    lettering(group, root, "CORNER MARKET", 0.37, -5.89, 3.47, 0.28, BRASS)
    for obj in set(root.children) - sign_before:
        obj.name = "Market | " + obj.data.body


def fit_out(group, root):
    rest, props = Geometry(), Geometry()
    for storey, base in enumerate((0.13, 4.12, 7.22, 10.19, 13.16)):
        core_x = 1.15 if base < 6 else 2.28
        rest.box(core_x, 2.82, base, 5.33, 3.29, 2.58 if storey else 3.44, PLASTER, 0.10)
        for idx in range(15):
            rest.box(core_x - 2.35 + idx * 0.335, 1.153, base + 0.10, 0.14, 0.105, 2.18, WOOD)
        for x in (-2.45, 3.65):
            rest.box(x, -1.91, base, 2.55, 0.89, 0.58, STONE, 0.13)
            rest.box(x, -1.91, base + 0.58, 2.62, 0.94, 0.063, WOOD, 0.14)
        if base < 6:
            rest.box(-4.50, 0.22, base, 0.74, 3.12, 0.91, WOOD, 0.13)
            rest.box(-4.50, 0.22, base + 0.91, 0.83, 3.18, 0.079, STONE, 0.13)
            for u in (-1.60, -0.40, 0.80, 2.0):
                rest.box(2.72, u, base, 0.91, 0.52, 0.96, PLASTER, 0.03)
                rest.box(2.72, u, base + 0.96, 0.98, 0.56, 0.06, WOOD)
        else:
            # Staggered room dividers and blinds break up sightlines through the upper floors.
            rest.box(-0.24, 0.71, base, 0.13, 3.52, 2.60, PLASTER)
            blind_x = (4.25, -2.55, 1.22)[storey - 2]
            for i in range(14):
                rest.box(blind_x, -2.98, base + 0.68 + i * 0.113, 2.25, 0.10, 0.045, WOOD)
            for x in (-1.75, 3.42):
                rest.box(x, -0.69, base, 1.28, 0.64, 0.75, INK, 0.09)
                rest.box(x, -0.38, base + 0.75, 1.11, 0.075, 0.47, BRONZE, 0.02)
        for slot in (-1, 0, 1):
            offset = slot * 0.58
            tone = CLAY if slot != 0 else SAGE
            for x in (3.65, -2.45):
                props.loft(
                    circle(0.12, 12, x + offset, -1.87),
                    circle(0.17, 12, x + offset, -1.87),
                    base + 0.643,
                    base + 0.90 + (0.085 if slot == 0 else 0),
                    tone,
                )
        # The front light is visible through the glazing as a thin pendant below the slab.
        for x in (-1.65, 3.48) if storey < 2 else ((-1.65,) if storey % 2 == 0 else (3.48,)):
            for dx in (-0.75, 0.75):
                rest.box(x + dx, -2.04, base + 2.28, 0.029, 0.030, 0.41, BRONZE)
            rest.box(x, -2.04, base + 2.23, 1.91, 0.14, 0.056, LIGHT)
    for x in (-3.38, -2.14, -0.90, 0.34, 1.58, 2.82, 4.06):
        rest.box(x, -4.64, 0.13, 1.22, 1.24, 0.014, STONE, 0.014)
    part(group, root, "Recessed rooms, counters and light fittings", rest)
    part(group, root, "Ceramics and display objects", props, 0.009)
    for z, west, east in (
        (0.13, 420, 340),
        (4.12, 240, 125),
        (7.22, 145, 215),
        (10.19, 60, 180),
        (13.16, 180, 75),
    ):
        area(
            group,
            root,
            "Market | west display light",
            (-3.0, -2.8, z + 2.34),
            (-2.9, 0.40, z + 0.60),
            (2.45, 0.55),
            west,
            (1, 0.72, 0.45),
        )
        area(
            group,
            root,
            "Market | south display light",
            (3.8, -2.8, z + 2.34),
            (3.8, 0.30, z + 0.55),
            (2.40, 0.55),
            east,
            (1, 0.75, 0.48),
        )
    area(
        group,
        root,
        "Market | entrance downlight",
        (-5.6, -4.98, 3.09),
        (-5.7, -5.17, 0.14),
        (0.46, 0.51),
        125,
        (1, 0.68, 0.32),
    )
    area(
        group,
        root,
        "Market | sign wash",
        (0.36, -2.65, 16.61),
        (0.36, -2.0, 17.32),
        (4.2, 0.15),
        45,
        (1, 0.78, 0.44),
    )


def verify(scene, group):
    assert bpy.data.objects["Market | NEXCIV"].data.body == "NEXCIV"
    original = scene.objects[ORIGINAL]
    assert original.hide_render and original.hide_viewport
    assert all(not lib.is_missing for lib in bpy.data.libraries)
    assert (
        len(
            [
                ob
                for ob in scene.objects
                if ob.instance_collection == original.instance_collection and not ob.hide_render
            ]
        )
        == 12
    )
    root = bpy.data.objects["Market | Ground centre"]
    graph = bpy.context.evaluated_depsgraph_get()
    tris = 0
    for obj in group.objects:
        if obj.type in {"MESH", "FONT"}:
            evaluated = obj.evaluated_get(graph)
            mesh = evaluated.to_mesh()
            mesh.calc_loop_triangles()
            tris += len(mesh.loop_triangles)
            evaluated.to_mesh_clear()
            for box_corner in obj.bound_box:
                point = root.matrix_world.inverted() @ obj.matrix_world @ Vector(box_corner)
                assert -7.18 <= point.x <= 7.18 and -6.40 <= point.y <= 6.40 and point.z <= 18
    assert 0 < tris < len(original.instance_collection.objects[0].data.polygons)

    def glass_ray(start, direction):
        start, direction = Vector(start), Vector(direction)
        hit, point, _, _, obj, _ = scene.ray_cast(graph, root.matrix_world @ start, direction, distance=10)
        assert hit and "recessed glazing" in obj.name, (start, obj and obj.name)
        first = point
        hit, point, _, _, obj, _ = scene.ray_cast(graph, first + direction * 0.012, direction, distance=9.0)
        assert hit and ("rooms" in obj.name or "display" in obj.name), (start, obj and obj.name)
        return (point - first).length

    south = glass_ray((3.4, -6.26, 1.60), (0, 1, 0))
    west = glass_ray((-7.10, 2.71, 1.61), (1, 0, 0))
    assert south > 2 and west > 2
    start = Vector((-6.32, -5.94, 1.63))
    direction = Vector((1, 1, 0)).normalized()
    hit, point, _, _, obj, _ = scene.ray_cast(graph, root.matrix_world @ start, direction, distance=4)
    assert hit and "recessed glazing" in obj.name
    diag_origin = Vector((*PODIUM[-1], 0))
    offset = (point - root.location - diag_origin).dot(direction)
    assert abs(offset - 1.13) < 0.03, offset
    for x, z in ((0.36, 17.9), (-5.75, 0.13), (6.85, 0.13)):
        point = world_to_camera_view(
            scene, scene.objects[STREET_CAMERA], root.matrix_world @ Vector((x, -5.78, z))
        )
        assert 0.02 < point.x < 0.98 and 0.02 < point.y < 0.98, point
    print(
        f"CORNER MARKET: {tris:,} evaluated triangles, glazed sightlines: south {south:.2f} m, "
        f"west {west:.2f} m. Entrance setback {offset:.2f} m."
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", action="store_true")
    parser.add_argument("--views", nargs="+", choices=("street", "detail", "overview", "before"), default=[])
    parser.add_argument("--draft", type=Path)
    parser.add_argument("--device", choices=("CPU", "CUDA"), default="CPU")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene = bpy.context.scene
    scene.frame_set(120)
    world = bpy.data.collections["CIVRUM_WORLD"]
    group = collection(world, BUILDING)
    original = scene.objects[ORIGINAL]
    root = bpy.data.objects.new("Market | Ground centre", None)
    group.objects.link(root)
    root.location = original.location
    massing(group, root)
    roof_and_terrace(group, root)
    fit_out(group, root)
    original.hide_render = original.hide_viewport = True
    camera(
        bpy.data.collections["17 | South shop review cameras"],
        STREET_CAMERA,
        (1.6, -77.6, 1.84),
        (18.5, -50.87, 8.05),
        26,
    )
    camera(
        bpy.data.collections["17 | South shop review cameras"],
        DETAIL_CAMERA,
        (8.1, -63.0, 1.83),
        (16.8, -54.9, 3.14),
        31,
    )
    scene.camera = scene.objects[STREET_CAMERA]
    scene.render.filepath = "//renders/CIVRUM_Corner_Market_Street.png"
    scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
    bpy.context.view_layer.update()
    verify(scene, group)
    if args.save:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(DESTINATION), compress=True)
        bpy.ops.wm.open_mainfile(filepath=str(DESTINATION))
        scene = bpy.context.scene
        group = bpy.data.collections[BUILDING]
        original = scene.objects[ORIGINAL]
        verify(scene, group)
    if args.device == "CUDA":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "CUDA"
        prefs.refresh_devices()
        assert any(device.type == "CUDA" for device in prefs.devices)
        for device in prefs.devices:
            device.use = device.type == "CUDA"
        scene.cycles.device = "GPU"
    if not args.views:
        return
    output = args.draft or OUTPUT / "renders"
    output.mkdir(parents=True, exist_ok=True)
    review_views = {"overview": OVERVIEW_CAMERA, "detail": DETAIL_CAMERA}
    for view in args.views:
        group.hide_render = view == "before"
        original.hide_render = view != "before"
        scene.camera = scene.objects[review_views.get(view, STREET_CAMERA)]
        width = 960 if args.draft else 2560 if view == "overview" else 1920
        scene.render.resolution_x, scene.render.resolution_y = width, width * 9 // 16
        scene.render.resolution_percentage = 100
        scene.cycles.samples = 12 if args.draft else 36
        scene.cycles.adaptive_threshold = 0.075 if args.draft else 0.026
        scene.cycles.use_denoising = True
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = str(output / f"CIVRUM_Corner_Market_{view.title()}.png")
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
