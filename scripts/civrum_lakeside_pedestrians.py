"""Link the eight character libraries and stage their lakeside walkthrough."""

import itertools
from math import atan2, pi

import bpy
from mathutils import Quaternion, Vector

FPS = 30
FACING = ("Idle", "Walk", "TurnLeft90", "TurnRight90")
CAST = (
    ("citizen-01-v1", "Citizen_01"),
    ("builder-02-v1", "Builder_02"),
    ("researcher-03-v1", "Researcher_03"),
    ("creator-04-v1", "Creator_04"),
    ("citizen-05-v1", "Citizen_05"),
    ("service-06-v1", "Service_06"),
    ("creator-07-v1", "Creator_07"),
    ("technician-08-v1", "Technician_08"),
)


def link_cast(source, group):
    residents = bpy.data.collections["06_Street_Residents"]
    residents.hide_render = residents.hide_viewport = True
    cast = []
    for index, (folder, label) in enumerate(CAST, 1):
        library = source / folder / "motion" / f"CIVRUM_{label}.blend"
        with bpy.data.libraries.load(str(library), link=True) as (contents, linked):
            linked.objects = list(contents.objects)
            linked.actions = list(FACING)
        (source_rig,) = (obj for obj in linked.objects if obj.type == "ARMATURE")
        rig = source_rig.copy()
        rig.name = f"Resident {index:02d} | {label}"
        rig.animation_data_clear()
        group.objects.link(rig)
        for source_mesh in linked.objects:
            if source_mesh.type == "MESH" and source_mesh.find_armature() == source_rig:
                skin = source_mesh.copy()
                skin.name = f"Resident {index:02d} | {source_mesh.name}"
                group.objects.link(skin)
                skin.parent = rig
                for modifier in skin.modifiers:
                    if modifier.type == "ARMATURE":
                        modifier.object = rig
        cast.append((rig, dict(zip(FACING, linked.actions, strict=True))))
    return cast


def action_strip(rig, action, start, duration, *, fade=0, scale=1):
    # Each track holds one interval so the Idle bed and the gesture can crossfade.
    track = rig.animation_data_create().nla_tracks.new()
    track.name = action.name
    strip = track.strips.new(action.name, start, action)
    strip.action_slot = action.slots[0]
    strip.extrapolation = "NOTHING"
    strip.use_auto_blend = False
    strip.scale = scale
    strip.repeat = duration / (action.frame_range.length * scale)
    strip.blend_in = fade
    strip.blend_out = fade
    return strip


def heading(direction):
    return atan2(direction.x, -direction.y)


def angle_delta(before, after):
    return (after - before + pi) % (2 * pi) - pi


def smooth_path(points, radius=1.3):
    points = [Vector(point) for point in points]
    result = [points[0]]
    for a, b, c in zip(points, points[1:-1], points[2:]):
        run = min(radius, (b - a).length * 0.33, (c - b).length * 0.33)
        entry, exit = b + (a - b).normalized() * run, b + (c - b).normalized() * run
        for step in range(9):
            t = step / 8
            result.append((1 - t) ** 2 * entry + 2 * t * (1 - t) * b + t**2 * exit)
    return [*result, points[-1]]


def walk(rig, actions, points, start, height, *, blend=6):
    path = smooth_path(points)
    lengths = [(b - a).length for a, b in itertools.pairwise(path)]
    distance = sum(lengths)
    stride = rig["walk_stride_m"]
    cycles = max(1, round(distance / stride))
    duration = round(FPS * 1.2 * distance / stride)
    action_strip(rig, actions["Walk"], start, duration, fade=blend, scale=duration / (cycles * 36))
    # Sample the actual walkable mesh, including the crossing ramps, at footstep resolution.
    elapsed = 0
    for i, length in enumerate(lengths):
        a, b = path[i : i + 2]
        steps = max(1, int(length / 0.16))
        angle = heading(b - a)
        for step in range(steps):
            t = step / steps
            p = a.lerp(b, t)
            key_position(rig, p, angle, start + (elapsed + t * length) / distance * duration, height)
        elapsed += length
    key_position(rig, path[-1], angle, start + duration, height)
    return start + duration, angle, distance


def key_position(rig, point, angle, frame, height):
    rig.location = (*point, height(*point))
    previous = rig.rotation_euler.z
    rig.rotation_euler.z = previous + angle_delta(previous, angle)
    rig.keyframe_insert("location", frame=frame)
    rig.keyframe_insert("rotation_euler", index=2, frame=frame)


def turn(rig, actions, point, before, after, start, height):
    difference = angle_delta(before, after)
    assert abs(abs(difference) - pi / 2) < 0.001
    clip = actions["TurnLeft90" if difference > 0 else "TurnRight90"]
    action_strip(rig, clip, start, FPS - 1, scale=(FPS - 1) / FPS)
    key_position(rig, point, before, start, height)
    key_position(rig, point, before, start + FPS - 1, height)
    key_position(rig, point, after, start + FPS, height)
    return start + FPS


def linear_motion(rig):
    action = rig.animation_data.action
    if action:
        for layer in action.layers:
            for strip in layer.strips:
                for curve in strip.channelbag(rig.animation_data.action_slot).fcurves:
                    for key in curve.keyframe_points:
                        key.interpolation = "LINEAR"


def inspect_panel(rig, actions):
    """Two seconds for a glance and a single reach to the waist-height panel."""
    bones = rig.pose.bones
    names = ("Chest", "Neck", "Head", "Clavicle.R", "UpperArm.R", "Forearm.R", "Hand.R")
    rig.animation_data.action = actions["Idle"]
    rig.animation_data.action_slot = actions["Idle"].slots[0]
    bpy.context.scene.frame_set(0)
    baseline = {name: bones[name].rotation_quaternion.copy() for name in names}
    clip = bpy.data.actions.new("InspectWorkPanel")
    clip.use_fake_user = True
    rig.animation_data.action = clip
    for frame, lean, reach, nod in (
        (0, 0, 0, 0),
        (12, 1, 0, 0.3),
        (25, 1, 1, 1),
        (33, 1, 0.93, 0.75),
        (38, 1, 1, 0.85),
        (51, 0.9, 0, 0.2),
        (68, 0, 0, 0),
    ):
        angles = (
            (7 * lean, 0, 1 * lean),
            (10 * lean, 0, 0),
            (7 * nod, 0, -4 * lean),
            (-8 * reach, 0, 0),
            (-43 * reach, 2 * reach, -9 * reach),
            (-34 * reach, 0, 0),
            (9 * reach, 9 * reach, 0),
        )
        for name, values in zip(names, angles, strict=True):
            bone = bones[name]
            coords = bone.bone.matrix_local.to_quaternion()
            axes = [Vector(axis) for axis in ((1, 0, 0), (0, 1, 0), (0, 0, 1))]
            rot = Quaternion()
            for axis, degrees in zip(axes, values, strict=True):
                rot @= Quaternion(coords.inverted() @ axis, degrees * pi / 180)
            bone.rotation_quaternion = baseline[name] @ rot
            bone.keyframe_insert("rotation_quaternion", frame=frame, group=name)
    rig.animation_data.action = None
    return clip


def route_endpoints(scene, cast, path, height):
    citizen, clips = cast[0]
    stop, angle, first = walk(citizen, clips, path, 33, height)
    turn_end = turn(citizen, clips, path[-1], angle, 0, stop + 8, height)
    arrival, _, second = walk(citizen, clips, (path[-1], (95, -72.6)), turn_end + 8, height)
    citizen["route_m"] = first + second
    scene.frame_end = arrival + 150
    return stop, arrival


def stage_cast(scene, cast, path, height):
    # Reserve the bottom tracks before scheduling the walks.
    for rig, actions in cast:
        action_strip(rig, actions["Idle"], 1, 60)
    stop, arrival = route_endpoints(scene, cast, path, height)
    worker, clips = cast[1]
    panel_action = inspect_panel(worker, clips)
    panel_point = (98.5, -67.3)
    # Time a short approach and a quarter turn to coincide with the visitor's arrival.
    start = arrival - 180
    end, facing, _ = walk(worker, clips, ((96, -67.3), panel_point), start, height)
    panel_start = turn(worker, clips, panel_point, facing, 0, end + 8, height) + 9
    action_strip(worker, panel_action, panel_start, 68, fade=5)
    worker["panel_check_frame"] = panel_start + 26
    for index, start_xy, end_xy, delay in (
        (3, (8.2, -18.4), (6, -18.4), 87),
        (4, (3, 81.25), (3, 78.9), 135),
        (6, (-91.1, -70.15), (-89, -70.15), 153),
        (7, (103.6, -92.7), (103.6, -94.9), arrival - 51),
    ):
        rig, actions = cast[index]
        walk(rig, actions, (start_xy, end_xy), delay, height)
    for index, xy, angle in ((2, (-89.5, 64), pi / 2), (5, (-2.7, 78.16), -0.42)):
        key_position(cast[index][0], xy, angle, 1, height)
    for rig, _ in cast:
        base = rig.animation_data.nla_tracks[0].strips[0]
        base.repeat = (scene.frame_end - 1) / 90
        linear_motion(rig)
    return stop, arrival, panel_start
