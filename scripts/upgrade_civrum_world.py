"""Sequential production passes for E6-07. See art-direction/world-upgrade-v1/README.md."""

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).resolve().parent))
from civrum_landmark_slots import ROOT, build


def lighting(scene):
    sun = bpy.data.objects["CIVRUM_SUN"]
    sun.rotation_euler = Vector((.59,.72,-.67)).to_track_quat("-Z","Y").to_euler()
    sun.data.energy, sun.data.angle, sun.data.color = 3.35, math.radians(5.0), (1,.875,.72)
    graph = scene.world.node_tree
    for n in graph.nodes:
        if n.type == "TEX_SKY":
            n.sun_elevation = math.radians(35)
            n.sun_rotation = math.radians(227)
        elif n.type == "BACKGROUND":
            old = n.inputs["Strength"].default_value
            n.inputs["Strength"].default_value = .098 if old < .10 else .23
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = .18


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pass_name",choices=("slots","streets","light","render"))
    parser.add_argument("output",type=Path)
    parser.add_argument("--registry",type=Path,default=Path.home()/"Downloads/citizens registration center 3d model.glb")
    parser.add_argument("--camera",choices=("overview","street"))
    parser.add_argument("--proof",action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    out = args.output.resolve()
    out.mkdir(parents=True,exist_ok=True)
    scene = bpy.context.scene
    if args.pass_name == "render":
        camera, label = {"overview":("WORLD_OVERVIEW","World_Overview"),"street":("STREET_DETAIL","Street_Detail")}[args.camera]
        scene.camera = bpy.data.objects["CIVRUM_CAM_"+camera]
        # Use the available compute backend, falling back to Cycles CPU.
        cp = bpy.context.preferences.addons["cycles"].preferences
        for backend in ("OPTIX","CUDA","HIP","METAL"):
            try:
                cp.compute_device_type = backend
                cp.refresh_devices()
                devices = [d for d in cp.devices if d.type == backend]
                if devices:
                    for d in cp.devices:
                        d.use = d in devices
                    scene.cycles.device = "GPU"
                    break
            except (RuntimeError,TypeError):
                continue
        scene.render.resolution_percentage = 36 if args.proof else 100
        scene.cycles.samples = 12 if args.proof else 96
        filename = ("Proof_" if args.proof else "CIVRUM_")+label+".png"
        scene.render.filepath = str(out/filename)
        bpy.ops.render.render(write_still=True)
        return
    if args.pass_name == "slots":
        if scene.name != "CIVRUM • Refined Environment":
            raise ValueError("Start with the legacy refined environment.")
        slots = build(out,args.registry)
        assert len(slots) == 4
        scene.name = "CIVRUM • City Upgrade"
        file = "02_Slots.blend"
    elif args.pass_name == "streets":
        from civrum_upgrade_streets import build_streets
        build_streets()
        file = "03_Streets.blend"
    else:
        lighting(scene)
        scene.camera = bpy.data.objects["CIVRUM_CAM_STREET_DETAIL"]
        file = "CIVRUM_World_Upgrade.blend"
    dest = out/file
    if dest == Path(bpy.data.filepath).resolve():
        raise ValueError("Output must be a separate scene.")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.outliner.orphans_purge(do_recursive=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(dest),compress=True)
    print("WROTE",dest)


if __name__ == "__main__":
    main()
