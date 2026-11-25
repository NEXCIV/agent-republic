"""Build the NEXCIV waterfront tower in the approved gold dusk world."""

import argparse
import math
import sys
from itertools import pairwise
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_corner_market import DESTINATION as MARKET_WORLD
from build_civrum_corner_market import green_box
from build_civrum_lakeside import OUTPUT, camera, collection, material, shader
from build_civrum_shop_dusk import area
from build_civrum_south_shop import (
    BRASS,
    BRONZE,
    GLASS,
    INK,
    LIGHT,
    PALETTE,
    PLASTER,
    STONE,
    WOOD,
    lettering,
)
from build_civrum_world import Geometry, circle

DESTINATION = OUTPUT / "NEXCIV_World_300m_Waterfront.blend"
ORIGINAL = "CIVRUM_LAKESIDE_TOWER"
BUILDING = "20 | NEXCIV Waterfront Tower"
VIEWS = {
    "skyline": "NEXCIV_CAM | Waterfront tower",
    "lobby": "NEXCIV_CAM | Waterfront entrance",
    "crown": "NEXCIV_CAM | Waterfront crown",
    "market": "NEXCIV_CAM | Corner Market roof sign",
    "overview": "LAKE_CAM_01 | City overview",
}
WINDOW_AMBER, WINDOW_DIM = len(PALETTE), len(PALETTE) + 1
FINISHES = (*PALETTE, ("NEXCIV_Window_Amber",), ("NEXCIV_Window_Dim",))
BAYS = 36
AZIMUTH = -math.pi / 2 - math.pi / BAYS


def shell_point(z, angle, margin=0):
    t = max(0, min((z - 4.65) / 27.18, 1))
    taper = 1.55 * (t * t * (3 - 2 * t))
    return (
        0.55 * t + (8.07 - taper + margin) * math.cos(angle),
        0.25 * t + (7.61 - taper + margin) * math.sin(angle),
    )


def ring(geom, low, high, width, finish, margin=0, count=BAYS):
    """Closed annular extrusion with a distinct underside and bearing surface."""
    start = len(geom.verts)
    geom.verts.extend(
        (*shell_point(z, AZIMUTH + k * math.tau / count, radius), z)
        for radius, z in ((margin, low), (margin, high), (margin - width, high), (margin - width, low))
        for k in range(count)
    )
    for k in range(count):
        j = (k + 1) % count
        for row in range(4):
            nxt = (row + 1) % 4
            geom.face(
                tuple(start + r * count + i for r, i in ((row, k), (row, j), (nxt, j), (nxt, k))), finish
            )


def facade_quad(geom, a, b, low, high, finish, margin=0):
    start = len(geom.verts)
    geom.verts.extend(
        (*shell_point(z, angle, margin), z) for angle, z in ((a, low), (b, low), (b, high), (a, high))
    )
    geom.face(tuple(range(start, start + 4)), finish)


def put(group, root, label, geometry):
    data = geometry.mesh("NEXCIV | " + label, FINISHES)
    ob = bpy.data.objects.new(data.name, data)
    group.objects.link(ob)
    ob.parent = root
    return ob


def facade(group, root):
    bands, mullions, glazing, interiors = (Geometry() for _ in range(4))
    for storey, low, high in (
        (0, 0.27, 4.48),
        *((storey + 1, 4.91 + storey * 2.68, 7.29 + storey * 2.68) for storey in range(10)),
        (11, 31.71, 34.32),
    ):
        ring(bands, high, high + 0.27, 0.48, INK, 0.22)
        ring(bands, high + 0.24, high + 0.28, 0.16, BRASS if storey in (0, 3, 7, 11) else BRONZE, 0.25)
        bands.slab(
            [shell_point(high, AZIMUTH + k * math.tau / BAYS, -0.10) for k in range(BAYS)],
            high + 0.015,
            high + (0.44 if storey == 0 else 0.30),
            INK,
        )
        # The lobby has actual doors and joinery. The upper window bands have recessed room surfaces.
        for bay in range(BAYS):
            alpha = AZIMUTH + bay * math.tau / BAYS
            beta = alpha + math.tau / BAYS
            entry = bay in (35, 0, 1) and storey == 0
            facade_quad(glazing, alpha, beta, low, high, GLASS, -0.78 if entry else -0.19)
            facade_quad(mullions, alpha - 0.010, alpha + 0.010, low, high, BRONZE, -0.15)
            if entry:
                facade_quad(mullions, alpha - 0.011, alpha + 0.011, low, high, BRONZE, -0.73)
            if storey:
                occupied = (bay * 13 + storey * 17 + bay // 3) % 31
                finish = WINDOW_AMBER if occupied in (0, 3, 6, 12, 17, 25) else WINDOW_DIM
                facade_quad(interiors, alpha + 0.014, beta - 0.014, low + 0.22, high - 0.16, finish, -1.31)
                facade_quad(interiors, alpha + 0.014, beta - 0.014, low + 0.68, low + 0.74, INK, -1.26)
        if storey in (3, 7, 11):
            ring(bands, high - 0.15, high - 0.105, 0.19, BRONZE, 0.05)
    put(group, root, "Continuous stone and gold spandrels", bands)
    put(group, root, "Vertical glazing mullions and entry frame", mullions)
    put(group, root, "Recessed glazing", glazing)
    put(group, root, "Setback window-bay interiors", interiors)


def ribs_and_roof(group, root):
    ribs = Geometry()
    levels = [0.29, 4.51, 7.59, 10.27, 12.95, 15.63, 18.31, 20.99, 23.67, 26.35, 29.03, 31.71, 34.59]
    for azimuth in (math.radians(-127), math.radians(-54), math.radians(25), math.radians(151)):
        start = len(ribs.verts)
        for z in levels:
            # Fins follow the taper and gather towards the top.
            angle = azimuth + 0.24 * math.sin(math.pi * z / 69)
            corners = ((-0.056, 0.19), (-0.038, 0.87), (0.032, 0.87), (0.054, 0.19))
            ribs.verts.extend((*shell_point(z, angle + width, depth), z) for width, depth in corners)
        for n in range(len(levels) - 1):
            for k in range(4):
                j = (k + 1) % 4
                ribs.face(
                    tuple(start + a * 4 + b for a, b in ((n, k), (n, j), (n + 1, j), (n + 1, k))),
                    BRONZE,
                )
        ribs.face(tuple(start + i for i in reversed(range(4))), BRONZE)
        ribs.face(tuple(start + (len(levels) - 1) * 4 + i for i in range(4)), BRONZE)
        for low, high in pairwise(levels):
            points = []
            for z in (low, high):
                angle = azimuth + 0.24 * math.sin(math.pi * z / 69)
                points.extend((*shell_point(z, angle + offset, 0.88), z) for offset in (-0.014, 0.006))
            face_start = len(ribs.verts)
            ribs.verts.extend(points)
            ribs.face(tuple(face_start + i for i in (0, 1, 3, 2)), BRASS)
    put(group, root, "Swept structural fins", ribs)

    crown = Geometry()
    for z0, z1, r in ((34.58, 34.86, 0.35), (34.86, 35.02, 0.23)):
        crown.slab(
            [shell_point(z0, AZIMUTH + k * math.tau / BAYS, r) for k in range(BAYS)],
            z0,
            z1,
            INK if z0 < 34.8 else BRONZE,
        )
    # The raised half-oval roof canopy opens towards the lake and is edged with a thin gold lip.
    points = []
    for k in range(33):
        angle = -0.25 + k * (math.pi + 0.50) / 32
        lift = 35.46 + 1.27 * math.sin(angle) ** 2
        points.append((angle, lift))
    for section, ((a, za), (b, zb)) in enumerate(pairwise(points)):
        idx = len(crown.verts)
        crown.verts.extend(
            (*shell_point(35, theta, radius), z)
            for theta, z, radius in (
                (a, za, 0.66),
                (b, zb, 0.66),
                (b, zb, -1.51),
                (a, za, -1.51),
                (a, za - 0.20, 0.66),
                (b, zb - 0.20, 0.66),
                (b, zb - 0.20, -1.51),
                (a, za - 0.20, -1.51),
            )
        )
        for face, finish in (
            ((0, 1, 2, 3), INK),
            ((4, 7, 6, 5), INK),
            ((0, 4, 5, 1), BRASS),
            ((2, 6, 7, 3), BRONZE),
        ):
            crown.face(tuple(idx + i for i in face), finish)
        if section == 0:
            crown.face(tuple(idx + i for i in (0, 3, 7, 4)), BRONZE)
        if section == len(points) - 2:
            crown.face(tuple(idx + i for i in (1, 5, 6, 2)), BRONZE)
    for position in (-4.45, -2.45, 2.45, 4.45):
        crown.box(position, 3.60, 35, 0.18, 0.18, 1.22, BRONZE, 0.03)
    crown.box(0.55, 0.75, 35.02, 4.65, 3.8, 0.63, INK, 0.31)
    for x in (-0.87, 0.00, 0.87):
        crown.box(x, 1.22, 35.63, 0.42, 1.18, 0.11, BRONZE, 0.06)
    for x in (-2.35, 0.60, 3.55):
        green_box(crown, x, -3.10, 35.02, 1.97, 0.66)
        crown.box(x, -1.88, 35.02, 1.42, 0.48, 0.35, BRONZE, 0.04)
        crown.box(x, -1.88, 35.37, 1.47, 0.50, 0.08, WOOD, 0.05)
    put(group, root, "Lake-facing observation crown", crown)


def lobby(group, root):
    g = Geometry()
    g.slab(circle(11.20, 64), 0, 0.106, STONE)
    g.slab(circle(9.66, 64), 0.105, 0.26, INK, STONE)
    g.box(0, -8.99, 0.26, 5.82, 2.00, 0.028, STONE, 0.11)
    g.box(0, 1.30, 0.26, 10.80, 4.80, 4.19, PLASTER, 0.62)
    for x in (-4.94, 4.94):
        g.box(x, -2.54, 0.26, 1.09, 2.84, 1.01, INK, 0.12)
        g.box(x, -2.54, 1.26, 1.16, 2.92, 0.11, WOOD, 0.12)
        for offset in (-0.80, 0, 0.80):
            g.box(x, -2.54 + offset, 1.38, 0.35, 0.40, 0.23, PLASTER, 0.07)
    for x in (-2.84, 2.84):
        g.box(x, -6.92, 0.27, 0.17, 0.26, 4.21, BRONZE, 0.03)
        g.box(x, -6.94, 3.77, 0.061, 0.044, 0.37, LIGHT)
    g.box(0, -6.86, 3.66, 5.73, 0.22, 0.56, INK, 0.03)
    g.box(0, -7.85, 3.62, 6.50, 2.52, 0.073, BRASS, 0.06)
    g.box(0, -7.85, 3.70, 6.56, 2.57, 0.19, BRONZE, 0.06)
    g.box(0, -9.095, 3.76, 4.55, 0.16, 0.40, INK, 0.03)
    for x in (-2.1, 0, 2.1):
        g.box(x, -8.34, 3.60, 1.11, 0.079, 0.047, LIGHT, 0.012)
    for x in (-3.15, -1.05, 1.05, 3.15):
        g.box(x, -3.34, 3.72, 1.49, 0.18, 0.076, LIGHT, 0.026)
    # Gold handles have real stand-offs and step clear of the glazing.
    for x in (-0.21, 0.21):
        for z in (0.96, 1.59):
            g.box(x, -6.96, z, 0.047, 0.18, 0.051, BRASS, 0.016)
        g.box(x, -7.04, 0.96, 0.043, 0.044, 0.69, BRASS, 0.015)
    put(group, root, "Portico, reception, handles and stone apron", g)
    lettering(group, root, "NEXCIV", 0, -9.184, 3.846, 0.40, BRASS)
    bpy.data.objects["Shop 40 | NEXCIV"].name = "NEXCIV | Entry wordmark"
    area(
        group,
        root,
        "NEXCIV | Canopy wash",
        (0, -8.27, 3.59),
        (0, -8.50, 0.25),
        (4.40, 0.30),
        270,
        (1, 0.71, 0.43),
    )
    area(
        group,
        root,
        "NEXCIV | Reception light",
        (0, -4.15, 4.15),
        (0, -2.15, 1.15),
        (5.50, 0.60),
        382,
        (1, 0.72, 0.46),
    )


def verify(scene, group):
    source = scene.objects[ORIGINAL]
    assert source.hide_render and source.hide_viewport
    assert (
        len(
            [
                o
                for o in scene.objects
                if o.instance_collection == source.instance_collection and not o.hide_render
            ]
        )
        == 6
    )
    assert all(not lib.is_missing and lib.filepath.startswith("//") for lib in bpy.data.libraries)
    texts = tuple(o.data.body for o in scene.objects if o.type == "FONT" and not o.hide_render)
    assert texts.count("NEXCIV") == 2 and all("CIVRUM" not in text.upper().replace(" ", "") for text in texts)
    graph = bpy.context.evaluated_depsgraph_get()
    count = 0
    for ob in group.objects:
        if ob.type not in {"MESH", "FONT"}:
            continue
        obj = ob.evaluated_get(graph)
        data = obj.to_mesh()
        data.calc_loop_triangles()
        count += len(data.loop_triangles)
        obj.to_mesh_clear()
        assert max(obj.dimensions) < 37
    assert 0 < count < 30_000
    origin = scene.objects["NEXCIV | Tower ground centre"].location
    hit, location, _, _, ob, _ = scene.ray_cast(
        graph, origin + Vector((0.49, -11.6, 1.55)), Vector((0, 1, 0))
    )
    assert hit and ob.name == "NEXCIV | Recessed glazing", ob and ob.name
    assert -7.0 < location.y - origin.y < -6.5
    view = scene.objects[VIEWS["skyline"]]
    lo, hi = (world_to_camera_view(scene, view, origin + Vector((0, 0, z))) for z in (0.0, 36.75))
    assert 0.04 < lo.y < hi.y < 0.97
    print(
        f"NEXCIV tower reopened and verified. {count:,} evaluated triangles. Clear entrance, six shared tower instances.",
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", action="store_true")
    parser.add_argument("--views", nargs="+", choices=(*VIEWS, "before"), default=[])
    parser.add_argument("--draft", type=Path)
    parser.add_argument("--device", choices=("CPU", "CUDA"), default="CPU")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    bpy.ops.wm.open_mainfile(filepath=str(MARKET_WORLD))
    scene = bpy.context.scene
    source = scene.objects[ORIGINAL]
    world = bpy.data.collections["CIVRUM_WORLD"]
    group = collection(world, BUILDING)
    root = bpy.data.objects.new("NEXCIV | Tower ground centre", None)
    group.objects.link(root)
    root.location = source.location
    amber = material("MAT_NEXCIV_Window_Amber", "A87947", 0.58, emission=0.91)
    shader(amber).inputs["Emission Color"].default_value = (0.79, 0.455, 0.18, 1)
    material("MAT_NEXCIV_Window_Dim", "343B44", 0.61, emission=0.18)
    facade(group, root)
    ribs_and_roof(group, root)
    lobby(group, root)
    source.hide_render = source.hide_viewport = True
    cameras = collection(world, "21 | NEXCIV review cameras")
    camera(cameras, VIEWS["skyline"], (-46, 102, 2.14), (-83, 145.2, 17.0), 27)
    camera(cameras, VIEWS["lobby"], (-70.5, 122.8, 1.84), (-83, 138.1, 2.51), 39)
    camera(cameras, VIEWS["crown"], (-46, 113, 46), (-83, 145.2, 27.6), 49)
    camera(cameras, VIEWS["market"], (8, -75, 20), (18.5, -51, 15.7), 57)
    scene.frame_set(120)
    scene.camera = scene.objects[VIEWS["skyline"]]
    scene.render.filepath = "//renders/NEXCIV_Waterfront_Skyline.png"
    scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
    bpy.context.view_layer.update()
    if args.save:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(DESTINATION), compress=True)
        bpy.ops.wm.open_mainfile(filepath=str(DESTINATION))
        scene = bpy.context.scene
        group = bpy.data.collections[BUILDING]
        source = scene.objects[ORIGINAL]
    verify(scene, group)
    if args.device == "CUDA":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "CUDA"
        prefs.refresh_devices()
        assert any(d.type == "CUDA" for d in prefs.devices)
        for device in prefs.devices:
            device.use = device.type == "CUDA"
        scene.cycles.device = "GPU"
    if not args.views:
        return
    output = args.draft or OUTPUT / "renders"
    output.mkdir(parents=True, exist_ok=True)
    for key in args.views:
        group.hide_render = key == "before"
        source.hide_render = key != "before"
        scene.camera = scene.objects[VIEWS["skyline" if key == "before" else key]]
        width = 960 if args.draft else (2560 if key == "overview" else 1600)
        scene.render.resolution_x, scene.render.resolution_y = width, width * 9 // 16
        scene.render.resolution_percentage = 100
        scene.cycles.samples = 10 if args.draft else 28
        scene.cycles.adaptive_threshold = 0.078 if args.draft else 0.032
        scene.cycles.use_denoising = True
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = str(output / f"NEXCIV_Waterfront_{key.title()}.png")
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
