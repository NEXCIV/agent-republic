"""Check worker equipment, trouser clearance and GLB round trip."""

from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rig_builder import BELT_PARTS, HEAD_PARTS, classify
from verify_researcher_motion import FPS, FRAMES, inspect_rig


def check_equipment(rig, obj):
    mesh = obj.data
    scale = max(v.co.z for v in mesh.vertices) / .99951172
    points = [v.co / scale for v in mesh.vertices]
    regions, _ = classify(mesh,points)
    shell = {}
    for name, parts in (("Head",HEAD_PARTS),("Hips",BELT_PARTS)):
        indices = [i for i,r in enumerate(regions) if r in parts]
        assert indices
        shell[name] = np.array(indices)
        for i in indices:
            weights = mesh.vertices[i].groups
            assert len(weights)==1 and weights[0].weight==1
            assert obj.vertex_groups[weights[0].group].name==name
    pools = {"bags":[], "bag_bottoms":[], "thighs":[], "hands":[], "left_leg":[], "right_leg":[]}
    for poly in mesh.polygons:
        ids = tuple(poly.vertices)
        region = regions[ids[0]]
        if region in ("pouch","yellow_pouch"):
            pools["bags"].append(ids)
            if max(points[i].z for i in ids)<.478:
                pools["bag_bottoms"].append(ids)
        elif region == "arm" and max(points[i].z for i in ids)<.56:
            pools["hands"].append(ids)
        elif region=="body" and max(points[i].z for i in ids)<.36:
            side = "left_leg" if points[ids[0]].x>0 else "right_leg"
            pools[side].append(ids)
        if region=="body" and all(.27<points[i].z<.506 for i in ids):
            pools["thighs"].append(ids)
    assert all(pools.values())
    original = np.array([list(v.co)+[1] for v in mesh.vertices])
    positions = np.empty(len(points)*3,dtype=np.float32)
    for clip, end in FRAMES.items():
        rig.animation_data.action = bpy.data.actions[clip]
        for frame in range(end+1):
            bpy.context.scene.frame_set(frame)
            current = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
            current.vertices.foreach_get("co",positions)
            xyz = positions.reshape(-1,3)
            for name, indices in shell.items():
                bone = rig.pose.bones[name]
                transform = np.array(bone.matrix @ bone.bone.matrix_local.inverted())
                expected = (original[indices] @ transform.T)[:,:3]
                assert np.max(np.abs(expected-xyz[indices])) < .00001, (clip,frame,name)
            vertices=xyz.tolist()
            trees = {key:BVHTree.FromPolygons(vertices,faces,all_triangles=True)
                     for key,faces in pools.items()}
            for a,b in (("hands","bags"),("bag_bottoms","thighs"),("left_leg","right_leg")):
                assert not trees[a].overlap(trees[b]), (clip,frame,a,b)
        print(f"{clip}: verified helmet, waist kit, hand and trouser clearance at {end+1} frames")


def main():
    folder = Path(sys.argv[sys.argv.index("--")+1]).resolve()
    bpy.ops.wm.open_mainfile(filepath=str(folder/"CIVRUM_Builder_02.blend"))
    rig, obj = inspect_rig(21371)
    check_equipment(rig,obj)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    bpy.ops.import_scene.gltf(filepath=str(folder/"CIVRUM_Builder_02.glb"))
    _, obj = inspect_rig(21371)
    material, = obj.data.materials
    image, = [n.image for n in material.node_tree.nodes if n.type=='TEX_IMAGE']
    assert image.packed_file and tuple(image.size)==(1024,1024)
    assert len(obj.data.uv_layers)==1
    print("Reimported GLB with four clips, 20 joints and a packed workwear atlas")


if __name__ == "__main__":
    main()
