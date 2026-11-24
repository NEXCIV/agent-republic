"""Preview a replacement's fit, or explicitly save it to a new Blender scene."""

import argparse
import json
import sys
from pathlib import Path

import bpy

sys.path.insert(0,str(Path(__file__).resolve().parent))
from civrum_landmark_slots import COLLECTION, fit, measure, move, source_mesh


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("manifest",type=Path)
    parser.add_argument("slot")
    parser.add_argument("glb",type=Path)
    parser.add_argument("--front",choices=("north","south","east","west"),required=True,
                        help="Entrance direction of the incoming asset after Blender glTF import.")
    parser.add_argument("--save-as",type=Path,help="New .blend file. Default prints the fit only.")
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    manifest=json.loads(args.manifest.read_text(encoding="utf8"))
    slot=next(s for s in manifest["landmarks"] if s["name"]==args.slot)
    old=bpy.data.collections[COLLECTION].objects[args.slot]
    if args.save_as and (args.save_as.exists() or args.save_as.suffix.lower()!=".blend"):
        raise ValueError("Choose a new .blend output path.")
    obj=source_mesh(args.glb)
    front={"north":(0,1),"south":(0,-1),"east":(1,0),"west":(-1,0)}[args.front]
    fit(obj,front,slot["entrance_world_xy"],slot["width_across_entrance_m"],slot["anchor_world_m"])
    measured=measure(obj)
    drift=[round(x-y,4) for x,y in zip(measured["dimensions_world_xyz_m"],slot["dimensions_world_xyz_m"])]
    print("FIT",json.dumps(dict(slot=args.slot,dimensions_m=measured["dimensions_world_xyz_m"],
                                delta_xyz_m=drift,anchor_m=list(obj.location))))
    if args.save_as:
        move(obj,bpy.data.collections[COLLECTION])
        bpy.data.objects.remove(old,do_unlink=True)
        obj.name=args.slot
        obj["entrance_world_xy"]=slot["entrance_world_xy"]
        obj["replaceable_landmark"]=True
        # Blender's GLB importer packs embedded textures. Pack any file-backed resources too.
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=str(args.save_as.resolve()),compress=True)


if __name__=="__main__":
    main()
