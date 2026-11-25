"""Apply the concentric Nexus inlay to the saved waterfront scene and render a matched close-up."""

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_lakeside import OUTPUT, camera
from build_nexciv_waterfront_tower import DESTINATION as SOURCE
from civrum_lakeside_blocks import BASALT, GOLD, METAL, PALETTE, STONE
from civrum_nexus_plaza import (
    BEACON,
    CENTER,
    LEGACY_INLAYS,
    MEDALLION,
    RADIUS,
    SURFACE,
    rebuild_medallion,
)

DESTINATION = OUTPUT / "NEXCIV_World_300m_Plaza.blend"
CAMERA = "NEXCIV_CAM | Nexus plaza paving"


def verify(scene):
    bpy.context.view_layer.update()
    medallion, beacon = (scene.objects[name] for name in (MEDALLION, BEACON))
    assert (medallion.location - beacon.location).length < 1e-5
    assert (medallion.location - Vector((*CENTER, SURFACE))).length < 1e-5
    assert all(
        scene.objects[name].hide_render and scene.objects[name].hide_viewport for name in LEGACY_INLAYS
    )
    assert all(not lib.is_missing and lib.filepath.startswith("//") for lib in bpy.data.libraries)
    graph = bpy.context.evaluated_depsgraph_get()
    # Inspect rings and all sixteen stone fields from above. Each point must hit the same top surface.
    samples = 0
    for radius in (2.35, 2.49, 2.65, 3.11, 4.60, 7.54, 7.89, 8.00, 8.19):
        for i in range(128):
            angle = (i + 0.23) * math.tau / 128
            x = CENTER[0] + radius * math.cos(angle)
            y = CENTER[1] + radius * math.sin(angle)
            hit, position, _, _, obj, _ = scene.ray_cast(graph, (x, y, 3.5), (0, 0, -1))
            assert hit and obj == medallion and abs(position.z - SURFACE) < 0.0001, (radius, i, obj.name)
            samples += 1
    stairs = scene.objects["CIVRUM_PLAZA_NEXUS_STEP"]
    clearance = min((stairs.matrix_world @ Vector(v)).y for v in stairs.bound_box) - CENTER[1] - RADIUS
    assert clearance > 0.65, clearance
    label = scene.objects["CIVRUM_PLAZA_ENTRY_PAINT"]
    label_max_y = max((label.matrix_world @ Vector(v)).y for v in label.bound_box)
    assert CENTER[1] - RADIUS - label_max_y > 0.65
    print(
        f"NEXUS PLAZA PASS: {samples} height samples, concentric beacon, {clearance:.2f} m before steps.",
        flush=True,
    )


def render(scene, label, directory, draft):
    width = 960 if draft else 1600
    scene.camera = bpy.data.objects[CAMERA]
    scene.render.resolution_x, scene.render.resolution_y = width, width * 9 // 16
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 10 if draft else 28
    scene.cycles.adaptive_threshold = 0.08 if draft else 0.031
    scene.cycles.use_denoising = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(directory / f"NEXCIV_Plaza_{label}.png")
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
    camera_group = bpy.data.collections["21 | NEXCIV review cameras"]
    cam = camera(camera_group, CAMERA, (2.1, -36.5, 29.8), (0, -12.7, 0), 40)
    scene.camera = cam
    scene.frame_set(120)
    if args.device == "CUDA":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "CUDA"
        prefs.refresh_devices()
        assert any(device.type == "CUDA" for device in prefs.devices)
        for device in prefs.devices:
            device.use = device.type == "CUDA"
        scene.cycles.device = "GPU"
    directory = args.draft or OUTPUT / "renders"
    if args.render:
        directory.mkdir(parents=True, exist_ok=True)
        render(scene, "Before", directory, args.draft)

    group = bpy.data.collections["12 | Fountains and forum"]
    inlay = rebuild_medallion(group, PALETTE, STONE, BASALT, METAL, GOLD)
    trim = scene.objects["Nexus | south entry markers"]
    accent = bpy.data.materials.get("Civic | architectural gold trim")
    if accent:
        for obj in (inlay, trim):
            for slot in obj.material_slots:
                if slot.material.name in {"MAT_CIVIC_Brass", accent.name}:
                    slot.link, slot.material = "OBJECT", accent
    verify(scene)
    if args.render:
        render(scene, "After", directory, args.draft)
    if args.save:
        scene.render.filepath = "//renders/NEXCIV_Plaza_After.png"
        scene.cycles.device = "CPU"
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(DESTINATION), compress=True)
        bpy.ops.wm.open_mainfile(filepath=str(DESTINATION))
        verify(bpy.context.scene)


if __name__ == "__main__":
    main()
