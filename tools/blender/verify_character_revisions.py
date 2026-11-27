"""Check the 02/03 rig files, web copies, poses and embedded textures."""

import argparse
from pathlib import Path
import sys

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rig_character_revisions import CAST, SOURCE_HASHES, rigid_parts
from verify_researcher_motion import FPS, FRAMES, inspect_rig


def check_poses(rig, obj):
    coordinates = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
    obj.data.vertices.foreach_get("co", coordinates)
    rest = coordinates.reshape(-1, 3).copy()
    _, first, seam = np.unique(rest, axis=0, return_index=True, return_inverse=True)
    edges = np.empty(len(obj.data.edges) * 2, dtype=np.int32)
    obj.data.edges.foreach_get("vertices", edges)
    a, b = edges.reshape(-1, 2).T
    lengths = np.linalg.norm(rest[a] - rest[b], axis=1)
    sample = lengths > .004
    sole = rest[:, 2] < .008
    for action, end in FRAMES.items():
        rig.animation_data.action = bpy.data.actions[action]
        minimum = float('inf')
        maximum_stretch = 1.0
        for frame in range(end + 1):
            bpy.context.scene.frame_set(frame)
            posed = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
            posed.vertices.foreach_get("co", coordinates)
            xyz = coordinates.reshape(-1, 3)
            assert np.isfinite(xyz).all(), (action, frame)
            assert np.max(np.abs(xyz - xyz[first[seam]])) < .00001, (action, frame, "seam")
            minimum = min(minimum, float(xyz[sole, 2].min()))
            stretch = np.linalg.norm(xyz[a[sample]] - xyz[b[sample]], axis=1) / lengths[sample]
            maximum_stretch = max(maximum_stretch, float(np.percentile(stretch, 99)))
        assert minimum > -.005 and maximum_stretch < 1.5, (action, minimum, maximum_stretch)
        print(f"{action}: {end + 1} poses, lowest sole {minimum:.4f} m, p99 edge stretch {maximum_stretch:.3f}")


def check_asset(number, file, *, working, resolution):
    character = CAST[number]
    if working:
        bpy.ops.wm.open_mainfile(filepath=str(file))
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.render.fps = FPS
        bpy.ops.import_scene.gltf(filepath=str(file))
    rig, mesh = inspect_rig({2: 52955, 3: 55796}[number])
    assert rig["source_sha256"] == SOURCE_HASHES[number]
    assert abs(rig["walk_stride_m"] - character.stride * character.height / .99951171875) < .0001
    material, = mesh.data.materials
    image, = [n.image for n in material.node_tree.nodes if n.type == "TEX_IMAGE"]
    assert image.packed_file and tuple(image.size) == (resolution, resolution)
    assert len(mesh.data.uv_layers) == 1
    assert abs(min(v.co.z for v in mesh.data.vertices)) < .00001
    assert abs(max(v.co.z for v in mesh.data.vertices) - character.height) < .00001
    if working:
        name = character.name.replace("_", "")
        assert (rig.name, mesh.name) == (name, name + "_Surface")
        scale = character.height / .99951171875
        equipment = rigid_parts(character, mesh.data, [v.co / scale for v in mesh.data.vertices])
        assert {"Head", "Foot.L", "Foot.R", "Hips" if number == 2 else "Chest"} <= {
            bone for weights in equipment.values() for bone in weights
        }
        for index, expected in equipment.items():
            assert {mesh.vertex_groups[g.group].name: g.weight for g in mesh.data.vertices[index].groups} == expected
        check_poses(rig, mesh)
    print(f"Verified {file.name}: 20 joints, 4 clips, {resolution}px embedded color texture")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--web", type=Path, help="Optional directory with the web GLBs")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    for number, character in CAST.items():
        base = args.root.resolve() / character.folder / "motion" / ("CIVRUM_" + character.name)
        check_asset(number, base.with_suffix(".blend"), working=True, resolution=8192)
        check_asset(number, base.with_suffix(".glb"), working=False, resolution=8192)
        if args.web:
            check_asset(number, args.web.resolve() / f"agent-{number:02}.glb", working=False, resolution=4096)


if __name__ == "__main__":
    main()
