"""Bake the 300 m city's asphalt markings into the supporting road faces."""

import argparse
import sys
from collections import defaultdict
from itertools import pairwise
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_lakeside import OUTPUT, camera, collection
from build_civrum_world import ROAD_Z
from build_nexciv_plaza_patch import DESTINATION as SOURCE

DESTINATION = OUTPUT / "NEXCIV_World_300m_Roads.blend"
ROAD_PREFIX = "CIVRUM_ROAD_STRAIGHT"
CROSSWALK_PREFIX = "CIVRUM_ROAD_CROSSWALK"
GARDEN_PREFIX = "Walkthrough | zebra crossing"
WHITE = "MAT_WARM_WHITE"
ASPHALT = "MAT_GRAPHITE_GRAY"
TOLERANCE = 0.00005


def footprint(points):
    return tuple(
        round(value, 5)
        for axis in range(2)
        for value in (min(p[axis] for p in points), max(p[axis] for p in points))
    )


def overlap(rect, other):
    x0, x1, y0, y1 = rect
    a0, a1, b0, b1 = other
    clipped = max(x0, a0), min(x1, a1), max(y0, b0), min(y1, b1)
    u0, u1, v0, v1 = clipped
    return clipped if u1 - u0 > TOLERANCE and v1 - v0 > TOLERANCE else None


def walkable_bounds(road):
    width = road["width_m"]
    return 0, round(road["length_m"], 5), -width / 2, width / 2


def contains(road, point):
    local = road.matrix_world.inverted() @ point
    return 0 < local.x < road["length_m"] and abs(local.y) < road["width_m"] / 2


def gather(scene, roads):
    patches = defaultdict(list)
    crossings = [o for o in scene.objects if o.name.startswith(CROSSWALK_PREFIX) and not o.hide_render]
    garden = sorted(
        (o for o in scene.objects if o.name.startswith(GARDEN_PREFIX) and not o.hide_render),
        key=lambda o: o.location.x,
    )
    ramps = [o for o in scene.objects if o.name.startswith("Pedestrian route | curb transition")]
    ignored = 0
    for crossing in crossings:
        (road,) = [o for o in roads if contains(o, crossing.matrix_world.translation)]
        inverse = road.matrix_world.inverted()
        transform = inverse @ crossing.matrix_world
        blockers = [
            footprint([inverse @ ramp.matrix_world @ v.co for v in ramp.data.vertices[:4]]) for ramp in ramps
        ]
        for face in crossing.data.polygons:
            stripe = footprint([transform @ crossing.data.vertices[i].co for i in face.vertices])
            if any(overlap(stripe, ramp) for ramp in blockers):
                ignored += 1
                continue
            assert overlap(stripe, walkable_bounds(road)) == stripe, (road.name, stripe)
            patches[road].append((stripe, WHITE))

    west = scene.objects["Walkthrough | curb ramp"]
    east = scene.objects["Walkthrough | curb ramp.001"]
    start = max((west.matrix_world @ Vector(p)).x for p in west.bound_box)
    end = min((east.matrix_world @ Vector(p)).x for p in east.bound_box)
    y = garden[0].matrix_world.translation.y
    center = Vector(((start + end) / 2, y, ROAD_Z))
    (road,) = [o for o in roads if contains(o, center)]
    inverse = road.matrix_world.inverted()
    paint = garden[0].data.materials[0].name
    usable_width = end - start - 0.26
    for i in range(7):
        x = start + 0.13 + (i + 0.5) * usable_width / 7
        stripe = footprint(
            [
                inverse @ Vector((x + sign * 0.19, y + other * 0.95, ROAD_Z))
                for sign in (-1, 1)
                for other in (-1, 1)
            ]
        )
        assert overlap(stripe, walkable_bounds(road)) == stripe
        patches[road].append((stripe, paint))
    assert len(crossings) == 27 and len(garden) == 10
    print(
        f"Collected {len(crossings)} junction crossings, trimmed {ignored} stripes at curb ramps.", flush=True
    )
    return patches, crossings + garden


def integrate(road, crossing):
    """Replace the asphalt polygon and its paint overlays with one partitioned surface."""
    mesh = road.data.copy()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    materials = {m.name: i for i, m in enumerate(mesh.materials)}
    overlay = [
        f
        for f in bm.faces
        if max(v.co.z for v in f.verts) < ROAD_Z + 0.005 and min(v.co.z for v in f.verts) > ROAD_Z + 0.002
    ]
    (deck,) = [
        f
        for f in bm.faces
        if f.material_index == materials[ASPHALT] and all(abs(v.co.z - ROAD_Z) < TOLERANCE for v in f.verts)
    ]
    marks = [(footprint([v.co for v in f.verts]), f.material_index) for f in overlay]
    for rect, name in crossing:
        if name not in materials:
            materials[name] = len(mesh.materials)
            mesh.materials.append(bpy.data.materials[name])
        marks.append((rect, materials[name]))
    bmesh.ops.delete(bm, geom=[deck, *overlay], context="FACES")
    x0, x1, y0, y1 = walkable_bounds(road)
    stations = sorted({x0, x1, *(x for rect, _ in marks for x in rect[:2])})
    # Shared vertices along subdivision edges keep the deck watertight within each module.
    offsets = sorted({y0, y1, *(y for rect, _ in marks for y in rect[2:])})
    vertices = {(x, y): bm.verts.new((x, y, ROAD_Z)) for x in stations for y in offsets}
    for left, right in pairwise(stations):
        for bottom, top in pairwise(offsets):
            cx, cy = (left + right) / 2, (bottom + top) / 2
            face = bm.faces.new(
                [vertices[xy] for xy in ((left, bottom), (right, bottom), (right, top), (left, top))]
            )
            face.material_index = next(
                (index for (a, b, c, d), index in reversed(marks) if a < cx < b and c < cy < d),
                materials[ASPHALT],
            )
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return mesh


def fix_roads(scene):
    roads = [o for o in scene.objects if o.name.startswith(ROAD_PREFIX) and not o.hide_render]
    patches, old_paint = gather(scene, roads)
    shared = {}
    for road in roads:
        key = road.data, tuple(sorted(patches[road]))
        if key not in shared:
            shared[key] = integrate(road, patches[road])
        overrides = [
            (slot.slot_index, slot.material) for slot in road.material_slots if slot.link == "OBJECT"
        ]
        road.data = shared[key]
        for index, material in overrides:
            slot = road.material_slots[index]
            slot.link, slot.material = "OBJECT", material
    for paint in old_paint:
        paint.hide_render = paint.hide_viewport = True
    print(f"Integrated paint into {len(roads)} road sections using {len(shared)} meshes.", flush=True)
    return patches


def verify(scene, patches):
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    count = 0
    for road_name, marks in patches.items():
        road = scene.objects[road_name]
        for (x0, x1, y0, y1), name in marks:
            for u, v in ((0.08, 0.09), (0.92, 0.09), (0.50, 0.50), (0.08, 0.91), (0.92, 0.91)):
                pos = road.matrix_world @ Vector((x0 + (x1 - x0) * u, y0 + (y1 - y0) * v, ROAD_Z))
                hit, point, _, face, obj, _ = scene.ray_cast(
                    graph, pos + Vector((0, 0, 0.25)), (0, 0, -1), distance=0.50
                )
                assert hit and obj == road and abs(point.z - pos.z) < 0.0001, (
                    road_name,
                    pos[:],
                    obj and obj.name,
                )
                material = road.material_slots[road.data.polygons[face].material_index].material
                assert material.name == name, (road_name, pos[:], material.name)
                count += 1
    assert not [
        o
        for o in scene.objects
        if o.name.startswith((CROSSWALK_PREFIX, GARDEN_PREFIX)) and (not o.hide_render or not o.hide_viewport)
    ]
    assert all(not lib.is_missing and lib.filepath.startswith("//") for lib in bpy.data.libraries)
    print(
        f"ROAD QA PASS: {count} ray samples hit the white marking material directly on the asphalt surface.",
        flush=True,
    )


def render(scene, camera_obj, path, draft):
    width = 800 if draft else 1440
    scene.camera = camera_obj
    scene.render.resolution_x, scene.render.resolution_y = width, width * 9 // 16
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 8 if draft else 24
    scene.cycles.adaptive_threshold = 0.08 if draft else 0.04
    scene.cycles.use_denoising = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", action="store_true")
    parser.add_argument("--render", action="store_true")
    parser.add_argument("--draft", type=Path)
    parser.add_argument("--device", choices=("CPU", "CUDA"), default="CPU")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene = bpy.context.scene
    scene.frame_set(120)
    cameras = collection(bpy.data.collections["CIVRUM_WORLD"], "22 | Street marking review cameras")
    wide = camera(cameras, "NEXCIV_CAM | Avenues from above", (3, -125, 127), (0, -7, 0), 43)
    near = camera(
        cameras, "NEXCIV_CAM | Crossing at eye level", (26.0, -26.65, 2.52), (29.23, -18.38, 0.51), 29
    )
    for cam in (wide, near):
        cam.data.clip_end = 950
    for screen in bpy.data.screens:
        for region in (area.spaces.active for area in screen.areas if area.type == "VIEW_3D"):
            region.clip_start, region.clip_end = 0.15, 1000
    if args.device == "CUDA":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "CUDA"
        prefs.refresh_devices()
        assert any(d.type == "CUDA" for d in prefs.devices)
        for device in prefs.devices:
            device.use = device.type == "CUDA"
        scene.cycles.device = "GPU"
    output = args.draft or OUTPUT / "renders"
    if args.render:
        output.mkdir(parents=True, exist_ok=True)
        render(scene, wide, output / "NEXCIV_Roads_Before.png", args.draft)
    patches = {road.name: marks for road, marks in fix_roads(scene).items() if marks}
    verify(scene, patches)
    if args.render:
        render(scene, wide, output / "NEXCIV_Roads_After.png", args.draft)
        render(scene, near, output / "NEXCIV_Roads_Near.png", args.draft)
    if args.save:
        scene.camera = wide
        scene.cycles.device = "CPU"
        scene.render.filepath = "//renders/NEXCIV_Roads_After.png"
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(DESTINATION), compress=True)
        bpy.ops.wm.open_mainfile(filepath=str(DESTINATION))
        verify(bpy.context.scene, patches)


if __name__ == "__main__":
    main()
