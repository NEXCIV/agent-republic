"""Check the textured citizen's round trip, foot contact and split garment seams."""

from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import struct
import sys

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

FRAMES = {"Idle":90,"Walk":36,"TurnLeft90":30,"TurnRight90":30,"Wave":72}


def embedded_images(path):
    data = path.read_bytes()
    length, = struct.unpack_from("<I",data,12)
    doc = json.loads(data[20:20+length])
    binary = memoryview(data)[28+length:]
    images = []
    for image in doc["images"]:
        view = doc["bufferViews"][image["bufferView"]]
        pos = view.get("byteOffset",0)
        images.append(sha256(binary[pos:pos+view["byteLength"]]).digest())
    return Counter(images)


def check_skin():
    rig, = (o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    parts = {int(o.name.removeprefix("tripo_part_")):o for o in bpy.context.scene.objects
             if o.type == "MESH" and o.find_armature() == rig}
    assert set(parts) == set(range(19)) and len(rig.data.bones) == 20
    assert len(bpy.data.actions) == len(FRAMES)
    for name,end in FRAMES.items():
        action = bpy.data.actions[name]
        assert np.allclose(action.frame_range,(0,end),atol=.01)
    triangles = 0
    for o in parts.values():
        assert o.find_armature() == rig and o.data.uv_layers.active
        material, = o.data.materials
        tex, = [n.image for n in material.node_tree.nodes if n.type == "TEX_IMAGE"]
        assert tex.packed_file
        for v in o.data.vertices:
            weights = [g.weight for g in v.groups if g.weight>0]
            assert 1 <= len(weights) <= 4 and abs(sum(weights)-1)<.0001
        o.data.calc_loop_triangles()
        triangles += len(o.data.loop_triangles)
    assert triangles == 8500
    return rig,parts


def sample_seams(parts):
    # Compare close cross-section vertices in rest space, without assuming matching UV topology.
    samples = []
    for a,b in ((6,1),(8,1),(4,8),(7,6),(9,2),(12,2),(13,1),(14,1)):
        tree = KDTree(len(parts[b].data.vertices))
        for v in parts[b].data.vertices:
            tree.insert(v.co,v.index)
        tree.balance()
        pairs = []
        for v in parts[a].data.vertices:
            _,j,d = tree.find(v.co)
            if d < .0035:
                pairs.append((v.index,j,d))
        if not pairs and (a,b) in ((6,1),(8,1),(4,8),(7,6)):
            raise ValueError(f"No comparable pairs for garment seam {a,b}")
        if pairs:
            i,j,d = np.array(pairs).T
            samples.append((a,b,i.astype(int),j.astype(int),d))
    return samples


def movement(rig, parts):
    samples = sample_seams(parts)
    faces = {i:[tuple(p.vertices) for p in o.data.polygons] for i,o in parts.items()}
    xyz = {i:np.empty((len(o.data.vertices),3),dtype=np.float32) for i,o in parts.items()}
    max_gap, ground_error, wave_height = 0,0,0
    for name,end in FRAMES.items():
        rig.animation_data.action = bpy.data.actions[name]
        for frame in range(end+1):
            bpy.context.scene.frame_set(frame)
            graph = bpy.context.evaluated_depsgraph_get()
            for i,o in parts.items():
                o.evaluated_get(graph).data.vertices.foreach_get("co",xyz[i].ravel())
            for a,b,indices,other,original in samples:
                extra = (np.linalg.norm(xyz[a][indices]-xyz[b][other],axis=1)-original).max()
                max_gap = max(max_gap,extra)
                assert extra < .008, (name,frame,"seam",a,b,float(extra))
            low = min(float(xyz[i][:,2].min()) for i in (3,5))
            ground_error = max(ground_error,abs(low))
            assert abs(low)<.003, (name,frame,"planted sole",low)
            trees = {i:BVHTree.FromPolygons(xyz[i].tolist(),faces[i],all_triangles=True)
                     for i in (0,1,2,4,7,9,12)}
            for hand in (4,7):
                for panel in (0,1,2,9,12):
                    assert not trees[hand].overlap(trees[panel]), (name,frame,"hand collision",hand,panel)
            if name == "Wave":
                wave_height = max(wave_height,float(xyz[4][:,2].max()))
    assert wave_height > 1.38, wave_height
    print("FRAMES",sum(n+1 for n in FRAMES.values()),"seam pairs",sum(len(s[2]) for s in samples),
          "max extra gap m",float(max_gap),"planted sole error m",ground_error,"wave fingertip m",wave_height)


def main():
    source,directory = map(Path,sys.argv[sys.argv.index("--")+1:])
    base = directory.resolve()/"CIVRUM_Citizen_01"
    bpy.ops.wm.open_mainfile(filepath=str(base.with_suffix(".blend")))
    movement(*check_skin())
    glb = base.with_suffix(".glb")
    assert embedded_images(source) == embedded_images(glb)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(glb))
    check_skin()
    print("PASS: Reimported animated GLB with original image payloads and normalized skin weights.")


if __name__ == "__main__":
    main()
