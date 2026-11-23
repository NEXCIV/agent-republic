"""Verify the researcher working file and reopen its exported game mesh."""

from pathlib import Path
import sys

import bpy
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rig_researcher import FPS, identify


FRAMES = {"Idle": 90, "Walk": 36, "TurnLeft90": 30, "TurnRight90": 30}


def inspect_rig(expected_triangles=22193):
    rig, = (o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    mesh, = (o for o in bpy.context.scene.objects if o.type == "MESH" and o.find_armature() == rig)
    assert len(rig.data.bones) == 20
    assert set(FRAMES) == {action.name for action in bpy.data.actions}
    for v in mesh.data.vertices:
        weights = [g.weight for g in v.groups if g.weight > 0]
        assert 1 <= len(weights) <= 4
        assert abs(sum(weights) - 1) < .0001
    for name, end in FRAMES.items():
        start, last = bpy.data.actions[name].frame_range
        assert abs(start) < .01 and abs(last - end) < .01, (name, start, last)
    mesh.data.calc_loop_triangles()
    assert len(mesh.data.loop_triangles) == expected_triangles
    return rig, mesh


def inspect_coat(rig, obj):
    # Inspect the lower 0.80 m, where both legs overlap the coat in elevation.
    # Use the working mesh so graphics splits at color boundaries do not
    # fragment the connected shells used to label trousers and hem.
    scale = max(v.co.z for v in obj.data.vertices) / .99951172
    points = [v.co / scale for v in obj.data.vertices]
    regions = identify(obj.data, points)
    surfaces = []
    for region in ("undercoat", "hem"):
        faces = [
            tuple(poly.vertices) for poly in obj.data.polygons
            if all(regions[i] == region and points[i].z < .475 for i in poly.vertices)
        ]
        assert faces, region
        surfaces.append(faces)
    for name, end in FRAMES.items():
        rig.animation_data.action = bpy.data.actions[name]
        for frame in range(end + 1):
            bpy.context.scene.frame_set(frame)
            evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            vertices = [v.co for v in evaluated.data.vertices]
            trousers, hem = [
                BVHTree.FromPolygons(vertices, faces, all_triangles=True) for faces in surfaces
            ]
            assert not trousers.overlap(hem), f"{name} frame {frame}: coat touches trousers"
        print(f"{name}: checked {end + 1} coat poses")


def main():
    folder = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
    bpy.ops.wm.open_mainfile(filepath=str(folder / "CIVRUM_Researcher_03.blend"))
    inspect_coat(*inspect_rig())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    bpy.ops.import_scene.gltf(filepath=str(folder / "CIVRUM_Researcher_03.glb"))
    inspect_rig()
    print("GLB: verified mesh, joints, skin weights and four clip durations")


if __name__ == "__main__":
    main()
