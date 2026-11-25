"""Build the pedestrian scene from the signed-off 300 m lakeside world."""

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_lakeside import (
    OUTPUT,
    box,
    camera,
    collection,
    material,
    mesh,
    shader,
    textured,
)
from civrum_lakeside_pedestrians import FPS, link_cast, stage_cast

SOURCE = OUTPUT / "CIVRUM_World_300m_Lakeside.blend"
DESTINATION = OUTPUT / "CIVRUM_World_300m_Walkthrough.blend"
TRIPO = OUTPUT.parents[1] / "tripo"
CROSSING_Y = -31.8
ROUTE = (
    (12, -12),
    (20.4, -14.2),
    (24.1, -16.4),
    (34.1, -20.85),
    (39.5, -25),
    (47, -30),
    (52, CROSSING_Y),
    (59.6, CROSSING_Y),
    (95, CROSSING_Y),
)


def sloped_walk(group, name, start, end, width, stone):
    direction = Vector((end[0] - start[0], end[1] - start[1])).normalized()
    offset = Vector((-direction.y, direction.x)) * width / 2
    corners = [
        (x + offset.x * side, y + offset.y * side, z)
        for (x, y, z), side in ((start, -1), (end, -1), (end, 1), (start, 1))
    ]
    # Close the sides below the road mesh so the ramp reads as part of the curb at eye level.
    base = [(x, y, -0.025) for x, y, _ in corners]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (1, 0, 4, 5), (2, 1, 5, 6), (3, 2, 6, 7), (0, 3, 7, 4)]
    mesh(group, name, corners + base, faces, stone)


def lay_crossing(group):
    stone = textured("Walkthrough | pale volcanic paver", "938D7B", "ADA58D", 0.92, 19, 0.13)
    mortar = material("Walkthrough | granite joints", "66675F")
    asphalt = material("Walkthrough | tactile crossing gold", "C7943B", 0.82)
    paint = material("Walkthrough | crosswalk ivory", "DDD9C8", 0.84)
    # Recessed joints align with the transverse access between the two water gardens.
    for start, end in ((53.4, 58.1), (70.12, 95.3)):
        width = 1.02
        box(
            group,
            "Connector | base",
            (start + end) / 2,
            CROSSING_Y,
            0.07,
            end - start,
            2 * width,
            0.194,
            mortar,
        )
        count = math.ceil((end - start) / 1.1)
        step = (end - start) / count
        for i in range(count):
            for row in (-1, 1):
                box(
                    group,
                    "Connector | stone setts",
                    start + (i + 0.5) * step,
                    CROSSING_Y + row * width / 2,
                    0.163,
                    step - 0.013,
                    width - 0.014,
                    0.021,
                    stone,
                )
    for start, end in (
        ((24.55, -16.6, 0.181), (25.83, -17.17, 0.047)),
        ((32.40, -20.1, 0.046), (33.70, -20.7, 0.181)),
        ((35.98, -22.3, 0.183), (37.65, -23.6, 0.009)),
        ((50.6, -31.35, 0.009), (53.55, CROSSING_Y, 0.174)),
    ):
        sloped_walk(group, "Pedestrian route | curb transition", start, end, 1.62, stone)
    flowers = bpy.data.objects["CIVRUM_GREEN_FLOWERS_01.076"]
    # This planter has a rotated parent. Move it south of the crossing in world space.
    placement = flowers.matrix_world.copy()
    placement.translation += Vector((1.6, -1.8, 0))
    flowers.matrix_world = placement
    for i in range(10):
        x = 60.93 + i * 0.68
        box(group, "Walkthrough | zebra crossing", x, CROSSING_Y, 0.046, 0.40, 2.05, 0.006, paint)
    for x0, x1, z0, z1 in ((60.51, 61.68, 0.185, 0.046), (66.32, 67.49, 0.046, 0.185)):
        sloped_walk(group, "Walkthrough | curb ramp", (x0, CROSSING_Y, z0), (x1, CROSSING_Y, z1), 1.98, stone)
        x = x0 - 0.27 if z0 > z1 else x1 + 0.27
        box(group, "Crossing | detectable pad", x, CROSSING_Y, 0.186, 0.53, 1.98, 0.012, asphalt)
    for x, y in ((58.8, -33.36), (69.25, -30.27)):
        box(group, "Crossing | wayfinding post", x, y, 1.25, 0.12, 0.12, 2.13, mortar)
        box(group, "Crossing | enamel marker", x, y, 2.15, 0.94, 0.09, 0.27, mortar)
        box(group, "Crossing | enamel edge", x, y, 2.283, 0.94, 0.094, 0.017, asphalt)
        for side in (-1, 1):
            type_line(
                group,
                "Crossing | public works lettering",
                "PUBLIC WORKS",
                (x, y + side * 0.046, 2.152),
                0.098,
                paint,
                (math.pi / 2, 0, math.pi if side > 0 else 0),
            )


def type_line(group, name, body, location, size, surface, angle=(0, 0, 0)):
    data = bpy.data.curves.new(name, "FONT")
    data.body = body
    data.size = size
    data.align_x = "CENTER"
    data.materials.append(surface)
    obj = bpy.data.objects.new(name, data)
    group.objects.link(obj)
    obj.location, obj.rotation_euler = location, angle
    return obj


def light(group, name, location, target, power, color, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.color, data.size = power, color, size
    obj = bpy.data.objects.new(name, data)
    group.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    obj.visible_glossy = False
    obj.visible_transmission = False
    data.specular_factor = 0
    data.transmission_factor = 0


def work_frontage(group):
    bronze = material("Walkthrough | patinated bronze", "514B3D", 0.41, 0.53)
    slate = material("Walkthrough | blue enamel", "245055", 0.54)
    gold = material("Walkthrough | brass edges", "AE8A4F", 0.40, 0.58)
    glass = material("Walkthrough | entry clear glass", "E2F3ED", 0.13)
    glass_tree = glass.node_tree
    glass_surface = shader(glass)
    glass_surface.inputs["Specular IOR Level"].default_value = 0.17
    film = glass_tree.nodes.new("ShaderNodeBsdfTransparent")
    film.inputs["Color"].default_value = (0.91, 0.97, 0.95, 1)
    layer = glass_tree.nodes.new("ShaderNodeMixShader")
    layer.inputs[0].default_value = 0.08
    glass_tree.links.new(film.outputs[0], layer.inputs[1])
    glass_tree.links.new(glass_surface.outputs[0], layer.inputs[2])
    output = next(node for node in glass_tree.nodes if node.type == "OUTPUT_MATERIAL")
    glass_tree.links.new(layer.outputs[0], output.inputs["Surface"])
    lit = material("Walkthrough | foyer luminaires", "FFDEA4", 0.40, emission=1.6)
    letter = material("Walkthrough | ivory sign", "FFF2C9", 0.65)
    paving = [
        textured("Works forecourt | limestone " + str(i), shade, soft, 0.8, 19, 0.1)
        for i, (shade, soft) in enumerate((("9D9586", "ABA192"), ("A49B8A", "B1A897"), ("A1998A", "ABA392")))
    ]
    # Thin stone courses preserve the finished grade of the existing promenade.
    for row in range(13):
        for index in range(10):
            x = 90.25 + index * 1.055 + (row % 2) * 0.32
            if x > 99.63:
                continue
            box(
                group,
                "Forecourt | limestone paver",
                x,
                -72.91 + row * 0.96,
                0.197,
                1.041,
                0.946,
                0.012,
                paving[(index * 13 + row * 5 + row // 3) % 3],
            )
    # The original doors already have real recesses. Add glass and fixtures inside the opening.
    for x in (93.12, 94.90, 96.67):
        box(group, "Vestibule | mullion", x, -76.63, 2.34, 0.056, 0.083, 2.25, bronze)
    for z in (1.24, 3.47):
        box(group, "Vestibule | horizontal frame", 94.90, -76.63, z, 3.6, 0.08, 0.062, bronze)
    for x in (94.012, 95.787):
        box(group, "Vestibule | clear pane", x, -76.66, 2.35, 1.72, 0.015, 2.18, glass)
    for x in (94.66, 95.12):
        box(group, "Vestibule | pull handle", x, -76.527, 2.11, 0.032, 0.074, 0.36, gold)
    for y in (-77.30, -78.91):
        box(group, "Vestibule | warm ceiling strip", 95.1, y, 3.48, 2.95, 0.115, 0.035, lit)
    box(group, "Vestibule | reception front", 96, -78.15, 1.62, 0.88, 0.32, 0.74, slate)
    box(group, "Vestibule | reception cap", 96, -78.15, 2.012, 0.98, 0.40, 0.050, bronze)
    light(group, "Vestibule | doorway spill", (95.05, -76.42, 3.6), (95, -74, 1), 260, (1, 0.76, 0.45), 2.3)
    light(
        group,
        "Vestibule | warm fill behind glass",
        (95.25, -77.28, 3.4),
        (95.5, -79.2, 1.5),
        285,
        (1, 0.65, 0.33),
        2,
    )
    light(group, "Works frontage | reflected sky", (99, -66.5, 6), (95, -76, 2), 1300, (0.74, 0.86, 1), 8)

    x, y, z = 98.25, -67.86, 0.203
    box(group, "Work panel | plinth", x, y, z + 0.047, 0.70, 0.38, 0.094, bronze)
    box(group, "Work panel | column", x, y, z + 0.46, 0.39, 0.25, 0.84, slate)
    box(group, "Work panel | console", x, y, z + 0.91, 0.60, 0.40, 0.14, bronze)
    glass_panel = box(group, "Work panel | display", x, y + 0.016, z + 0.993, 0.51, 0.313, 0.027, slate)
    glass_panel.rotation_euler.x = 0.10
    type_line(
        group, "Work panel | label", "WORKS / 04", (x, y + 0.059, z + 1.016), 0.061, letter, (0, 0, math.pi)
    )
    for offset, length in ((-0.045, 0.17), (-0.088, 0.25)):
        box(
            group, "Work panel | level indicator", x - 0.04, y + offset, z + 1.010, length, 0.014, 0.012, gold
        )
    box(group, "Work panel | acknowledgement key", x - 0.21, y + 0.13, z + 0.995, 0.052, 0.046, 0.012, lit)


def ground_sampler(scene, cast):
    # The cast and the console are not part of the walkable surface.
    cast_objects = {obj for rig, _ in cast for obj in (rig, *rig.children)}
    graph = bpy.context.evaluated_depsgraph_get()

    def height(x, y):
        ray = Vector((x, y, 1.12))
        for _ in range(12):
            hit, pos, normal, _, obj, _ = scene.ray_cast(graph, ray, Vector((0, 0, -1)), distance=2)
            if not hit:
                break
            if obj.original not in cast_objects and pos.z <= 0.34 and normal.z > 0.08:
                return pos.z + 0.003
            ray.z = pos.z - 0.003
        raise ValueError(f"Missing walkable surface at {(round(x, 2), round(y, 2))}")

    return height


def configure_views(scene, group, cast, stop, arrival):
    viewer, worker = cast[0][0], cast[1][0]
    overview = bpy.data.objects["LAKE_CAM_01 | City overview"]
    plaza = camera(group, "WALK_CAM_02 | Nexus plaza", (18.6, -19.5, 1.90), (9.0, -8.1, 2.25), 32)
    crossing = camera(group, "WALK_CAM_03 | Garden crossing", (59.6, -38.5, 1.97), (67, -31.3, 1.91), 28)
    steps = camera(group, "WALK_CAM_04 | Works approach", (93.4, -56.8, 2.02), (95, -78.4, 5.5), 23)
    panel = camera(group, "WALK_CAM_05 | Worker and panel", (96.1, -69.1, 1.86), (98.45, -67.7, 1.2), 38)
    # Choose the frame from the host's root motion without evaluating the entire city for each key.
    action = viewer.animation_data
    channel = action.action.layers[0].strips[0].channelbag(action.action_slot)
    motion_x = channel.fcurves.find("location", index=0)
    crossing_frame = min(
        range(33, stop),
        key=lambda frame: abs(motion_x.evaluate(frame) - 63.5),
    )
    views = {
        "overview": (overview, 120, "CIVRUM_Walkthrough_Overview"),
        "plaza": (plaza, 115, "CIVRUM_Walkthrough_Nexus_Plaza"),
        "crossing": (crossing, crossing_frame, "CIVRUM_Walkthrough_Crossing"),
        "entrance": (steps, arrival - 78, "CIVRUM_Walkthrough_Public_Works"),
        "panel": (panel, worker["panel_check_frame"], "CIVRUM_Walkthrough_Work_Panel"),
    }
    for label, frame in (
        ("01 · Nexus departure", 33),
        ("02 · Cross the avenue", crossing_frame),
        ("03 · Turn towards Public Works", stop + 8),
        ("04 · Approach the entrance", arrival - 120),
        ("05 · Worker reads the console", worker["panel_check_frame"]),
        ("06 · Arrive at the stairs", arrival),
    ):
        scene.timeline_markers.new(label, frame=frame)
    scene["walkthrough_crossing_frame"] = crossing_frame
    scene["walkthrough_arrival_frame"] = arrival
    return views


def follow_camera(group, actor, turn_at, arrival):
    follow = camera(group, "WALK_CAM_01 | Follow the citizen", (0, 3.7, 1.72), (0.30, -6.0, 1.66), 25)
    rig = bpy.data.objects.new("Follow camera | route pivot", None)
    group.objects.link(rig)
    follow.parent = rig
    action = actor.animation_data
    channels = action.action.layers[0].strips[0].channelbag(action.action_slot)
    xyz = [channels.fcurves.find("location", index=i) for i in range(3)]
    yaw = channels.fcurves.find("rotation_euler", index=2)
    frames = sorted({1, arrival, *range(33, arrival, 5), *range(turn_at, turn_at + FPS + 1)})
    before, after = yaw.evaluate(turn_at), yaw.evaluate(turn_at + FPS)
    for frame in frames:
        x, y, _ = [channel.evaluate(frame) for channel in xyz]
        z = sum(xyz[2].evaluate(frame + offset) for offset in (-14, -7, 0, 7, 14)) / 5
        angle = (yaw.evaluate(frame - 4) + yaw.evaluate(frame + 4)) / 2
        if turn_at <= frame <= turn_at + FPS:
            t = (frame - turn_at) / FPS
            angle = before + (after - before) * t * t * (3 - 2 * t)
        rig.location = (x, y, z)
        rig.rotation_euler.z = angle
        rig.keyframe_insert("location", frame=frame)
        rig.keyframe_insert("rotation_euler", index=2, frame=frame)
    return follow


def render_views(scene, views, keys, draft, output):
    scene.cycles.use_denoising = True
    output.mkdir(parents=True, exist_ok=True)
    for key in keys:
        obj, frame, stem = views[key]
        scene.camera = obj
        scene.frame_set(frame)
        width = 960 if draft else 2560 if key == "overview" else 1920
        scene.render.resolution_x, scene.render.resolution_y = width, width * 9 // 16
        scene.cycles.samples = 8 if draft else 36
        scene.cycles.adaptive_threshold = 0.09 if draft else 0.024
        scene.render.filepath = str(output / (stem + ".png"))
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--draft", type=Path, help="Render quick views to an explicit directory")
    parser.add_argument("--save", action="store_true", help="Save the separate walkthrough Blender scene")
    parser.add_argument(
        "--views", nargs="+", choices=("overview", "plaza", "crossing", "entrance", "panel"), default=[]
    )
    parser.add_argument("--device", choices=("CPU", "CUDA"), default="CPU")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene = bpy.context.scene
    scene.name = "CIVRUM | Lakeside pedestrian walkthrough"
    scene.render.fps = FPS
    scene.frame_start = 1
    parent = collection(bpy.data.collections["CIVRUM_WORLD"], "15 | Lakeside walkthrough")
    lay_crossing(collection(parent, "01 | Pedestrian crossings"))
    work_frontage(collection(parent, "02 | Public Works at eye level"))
    cast = link_cast(TRIPO, collection(parent, "03 | Animated residents"))
    bpy.context.view_layer.update()
    height = ground_sampler(scene, cast)
    stop, arrival, _ = stage_cast(scene, cast, ROUTE, height)
    cameras = collection(parent, "04 | Walkthrough cameras")
    views = configure_views(scene, cameras, cast, stop, arrival)
    scene.camera = follow_camera(cameras, cast[0][0], stop + 8, arrival)
    scene.frame_set(33)
    scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
    scene.render.filepath = "//renders/CIVRUM_Walkthrough_Follow.png"
    if args.save:
        bpy.context.preferences.filepaths.save_version = 0
        for library in bpy.data.libraries:
            library.filepath = bpy.path.relpath(bpy.path.abspath(library.filepath))
        bpy.ops.wm.save_as_mainfile(filepath=str(DESTINATION), compress=True)
    print(
        f"Staged 8 actors. Plaza to entrance {cast[0][0]['route_m']:.2f} m. Arrival at frame {arrival}.",
        flush=True,
    )
    print({key: frame for key, (_, frame, _) in views.items()}, flush=True)
    if args.device == "CUDA":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "CUDA"
        prefs.refresh_devices()
        cuda = [device for device in prefs.devices if device.type == "CUDA"]
        if not cuda:
            raise RuntimeError("No CUDA device found")
        for device in prefs.devices:
            device.use = device in cuda
        scene.cycles.device = "GPU"
    if args.views:
        render_views(scene, views, args.views, bool(args.draft), args.draft or OUTPUT / "renders")


if __name__ == "__main__":
    main()
