"""Check the saved 300 m walkthrough, including the crossing and console gesture."""

import math
import sys
from itertools import pairwise
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_lakeside_walk import CROSSING_Y, ground_sampler
from civrum_lakeside_pedestrians import FPS


def curves_for(obj):
    animation = obj.animation_data
    return animation.action.layers[0].strips[0].channelbag(animation.action_slot).fcurves


def facing(rig, graph):
    evaluated = rig.evaluated_get(graph)
    hips = evaluated.pose.bones["Hips"]
    rotation = evaluated.matrix_world.to_quaternion() @ hips.matrix.to_quaternion()
    direction = rotation @ hips.bone.matrix_local.to_quaternion().inverted() @ Vector((0, -1, 0))
    return math.degrees(math.atan2(direction.x, -direction.y))


def verify():
    scene = bpy.context.scene
    assert tuple(scene.objects["CIVRUM_ENV_GROUND_MAIN"].dimensions) == (300, 300, 0)
    assert scene.camera.name == "WALK_CAM_01 | Follow the citizen"
    assert scene.render.fps == FPS
    assert len(bpy.data.collections["06_Street_Residents"].objects) == 8
    assert bpy.data.collections["06_Street_Residents"].hide_render
    cast = sorted(
        (obj for obj in bpy.data.collections["03 | Animated residents"].objects if obj.type == "ARMATURE"),
        key=lambda obj: obj.name,
    )
    assert len(cast) == 8
    for actor in cast:
        assert len(actor.data.bones) == 20 and all(mesh.find_armature() == actor for mesh in actor.children)
        assert actor.children and actor.animation_data.nla_tracks[0].strips[0].action.name == "Idle"
    for lib in bpy.data.libraries:
        assert lib.filepath.startswith("//") and Path(bpy.path.abspath(lib.filepath)).is_file(), lib.filepath

    visitor, worker = cast[:2]
    graph = bpy.context.evaluated_depsgraph_get()
    height = ground_sampler(scene, [(actor, {}) for actor in cast])
    curves = curves_for(visitor)
    coordinates = [curves.find("location", index=axis) for axis in range(3)]
    yaw = curves.find("rotation_euler", index=2)
    arrival, cross = (scene[f"walkthrough_{key}_frame"] for key in ("arrival", "crossing"))
    ignore = {mesh for actor in cast for mesh in actor.children}
    previous = None
    rise = 0
    for frame in range(33, arrival + 1, 5):
        x, y, z = (curve.evaluate(frame) for curve in coordinates)
        angle = yaw.evaluate(frame)
        if previous is not None:
            rise = max(rise, abs(previous - z))
        previous = z
        for side in (-0.24, 0, 0.24):
            px, py = x + math.cos(angle) * side, y + math.sin(angle) * side
            hit, pos, _, _, obj, _ = scene.ray_cast(graph, Vector((px, py, 1.95)), Vector((0, 0, -1)))
            assert not hit or pos.z <= 0.37 or obj.original in ignore, (frame, obj.name, pos[:])
    assert rise < 0.042, f"Unexpected route step of {rise:.3f} m"
    assert abs(coordinates[0].evaluate(cross) - 63.5) < 0.04
    assert abs(coordinates[1].evaluate(cross) - CROSSING_Y) < 0.001

    shoes = [obj for obj in visitor.children if obj.name.endswith(("tripo_part_3", "tripo_part_5"))]
    assert len(shoes) == 2
    sole_gap = 0
    for frame in (*range(cross - 24, cross + 25, 3), arrival - 78, arrival):
        scene.frame_set(frame)
        offsets = []
        for shoe in shoes:
            obj = shoe.evaluated_get(graph)
            low = sorted((obj.matrix_world @ v.co for v in obj.data.vertices), key=lambda v: v.z)[:6]
            offsets.append(min(v.z - height(v.x, v.y) for v in low))
        sole_gap = max(sole_gap, abs(min(offsets)))
    assert sole_gap < 0.030, f"Support shoe ground error {sole_gap:.3f} m"
    turn = next(marker.frame for marker in scene.timeline_markers if "Turn towards" in marker.name)
    angles = []
    for frame in range(turn, turn + FPS + 2):
        scene.frame_set(frame)
        angles.append(facing(visitor, graph))
    assert abs(angles[0] - 90) < 0.1 and abs(angles[-1]) < 0.1
    assert all(-6 < b - a < 0.1 for a, b in pairwise(angles))
    assert abs(coordinates[1].evaluate(arrival) + 72.6) < 0.01

    scene.frame_set(worker["panel_check_frame"])
    evaluated = worker.evaluated_get(graph)
    hand = evaluated.matrix_world @ evaluated.pose.bones["Hand.R"].tail
    button = scene.objects["Work panel | acknowledgement key"].matrix_world.translation
    gap = (hand - button).length
    assert gap < 0.027, f"Right hand misses the console by {gap:.3f} m"
    print(f"PASS: {len(cast)} linked rigs, {visitor['route_m']:.2f} m clear at sampled points.")
    print(f"PASS: sampled support shoe error {sole_gap:.3f} m, 90-degree turn, console reach {gap:.3f} m.")


if __name__ == "__main__":
    verify()
