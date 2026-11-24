"""Reopen both city files and verify spatial and replacement invariants."""

import hashlib
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).resolve().parent))
from civrum_landmark_slots import COLLECTION, ROOT, ends, measure, vec, support


def snapshot():
    def matrix(o):
        return [round(v,6) for row in o.matrix_world for v in row]
    roads={o.name:matrix(o) for o in bpy.data.collections["ROADS"].objects}
    cameras={o.name: [matrix(o),o.data.type,o.data.lens,o.data.sensor_width,o.data.shift_x,o.data.shift_y]
             for o in bpy.data.collections["CAMERAS"].objects}
    return roads,cameras


def metrics(group):
    meshes=[o for o in bpy.context.scene.objects if o.type=="MESH"
            and not o.hide_render and all(not c.hide_render for c in o.users_collection)]
    if group:
        meshes=[o for o in meshes if o.name.startswith(group)]
    unique={o.data for o in meshes}
    for m in unique:
        m.calc_loop_triangles()
    return dict(mesh_instances=len(meshes),unique_meshes=len(unique),
                drawn_triangles=sum(len(o.data.loop_triangles) for o in meshes))


def overlaps(a,b,epsilon=.025):
    return all(min(a[1][i],b[1][i])-max(a[0][i],b[0][i])>epsilon for i in range(3))


def main():
    out=Path(sys.argv[-1]).resolve()
    legacy=ROOT/"art-direction/refined/blender/world_legacy_backup.blend"
    original=legacy.with_name("CIVRUM_World_Environment.blend")
    digest=hashlib.sha256(legacy.read_bytes()).digest()
    assert digest==hashlib.sha256(original.read_bytes()).digest()
    bpy.ops.wm.open_mainfile(filepath=str(legacy))
    baseline=snapshot()
    families={"all_visible_meshes":None,"streetlights":"CIVRUM_PROP_STREETLIGHT","benches":"CIVRUM_PROP_BENCH"}
    before={name:metrics(prefix) for name,prefix in families.items()}
    bpy.ops.wm.open_mainfile(filepath=str(out/"CIVRUM_World_Upgrade.blend"))
    assert baseline==snapshot(), "Road transforms or camera calibration changed"
    scene=bpy.context.scene
    assert not bpy.data.libraries
    assert all(not i.filepath or i.packed_file for i in bpy.data.images if i.users)
    archive=bpy.data.collections["Legacy_Replaced_Massing"]
    assert archive.hide_render and archive.hide_viewport and len(archive.objects)==6
    target=bpy.data.collections[COLLECTION]
    slots=json.loads((out/"landmarks_manifest.json").read_text(encoding="utf8"))["landmarks"]
    assert len(target.objects)==len(slots)==4
    blockers=[]
    for c in ("VEGETATION","PUBLIC_FACILITIES","CONSTRUCTION","05_Street_Architecture",
              "PLACEHOLDER_BUILDINGS"):
        for o in bpy.data.collections[c].all_objects:
            if o.type=="MESH" and not o.hide_render:
                blockers.append((o.name,ends([o.matrix_world@Vector(p) for p in o.bound_box])))
    conflicts=[]
    for slot in slots:
        obj=target.objects[slot["name"]]
        assert obj.users_collection[:]==(target,) and obj.parent is None
        assert obj.rotation_euler.to_matrix().is_identity and vec(obj.scale)==[1,1,1]
        assert all(abs(x-y)<.0001 for x,y in zip(obj.location,slot["anchor_world_m"]))
        lo,hi=ends([v.co for v in obj.data.vertices])
        assert max(abs(lo.z),abs(lo.x+hi.x),abs(lo.y+hi.y))<.0001
        assert measure(obj)["aabb_world_m"]==slot["aabb_world_m"]
        assert abs(support(slot["support_object"],obj.location.x,obj.location.y)-obj.location.z)<.001
        for name,bb in blockers:
            if overlaps(slot["aabb_world_m"],bb):
                conflicts.append((obj.name,name))
    assert len(bpy.data.collections["CONTEXT_MASSING"].objects)==56
    actors=bpy.data.collections["04_Character_Activity"].objects
    ids=sorted(o.name[6:8] for o in actors)
    assert ids==[f"{n:02d}" for n in range(1,9)]
    actors_report=[]
    for o in actors:
        x,y,z=o.location
        assert o.type=="EMPTY" and -.001<=z-support(o["support"],x,y)<.06
        bb=[(x-.23,y-.23,z+.04),(x+.23,y+.23,z+1.75)]
        for name,ob in blockers+[(s["name"],s["aabb_world_m"]) for s in slots]:
            if overlaps(bb,ob):
                conflicts.append((o.name,name))
        actors_report.append(dict(name=o.name,activity=o["activity"],anchor_m=vec(o.location)))
    print("COLLISION_CANDIDATES",conflicts)
    assert not conflicts,conflicts
    report=dict(blender=bpy.app.version_string,backup_sha256=digest.hex(),
                unchanged_road_objects=len(baseline[0]),matched_cameras=list(baseline[1]),validated_slots=len(slots),
                tested_bounds="World bounds versus furniture, vegetation, construction, active buildings and street retrofit meshes; 0.46 m x 1.75 m clearance for each actor",
                actors=actors_report,before=before,after={name:metrics(prefix) for name,prefix in families.items()},
                render_pixels=[scene.render.resolution_x,scene.render.resolution_y],
                samples=scene.cycles.samples)
    (out/"verification.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf8")
    print("PASS",report["after"])


main()
