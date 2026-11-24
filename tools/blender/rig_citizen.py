"""Fit the shared CIVRUM rig to the textured, 19-part Tripo export of citizen 01."""

import argparse
from collections import defaultdict
from hashlib import sha256
from math import pi, sin, tau
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rig_researcher import author_action, blend, ramp, save_motion_asset, skeleton


SOURCE = "1ba4a1b2ae863d2f5cc473b914921ebe14936e9f63dc7ad41ecf975063d77b22"
HEIGHT = 1.70
ARM_LOWER = 14
WAVE_FRAMES = 72
# Neutral landmarks in units of one character height, looking down Blender -Y.
LANDMARKS = {
    (.091,.002,.69): (.092,.010,.713),
    (.153,.001,.588): (.156,.013,.611),
    (.210,-.009,.495): (.218,-.004,.506),
    (.242,-.020,.417): (.254,-.023,.412),
    (.058,0,.435): (.060,.002,.438),
    (.061,-.014,.242): (.072,-.009,.244),
    (.066,-.002,.072): (.077,.009,.084),
    (.071,-.093,.027): (.078,-.093,.031),
    (0,0,.435): (0,.002,.438), (0,0,.695): (0,.010,.705),
    (0,0,.735): (0,.009,.744), (0,0,.779): (0,.009,.783),
}


def fit_joint(point):
    x,y,z = point
    px,py,pz = LANDMARKS.get((abs(x),y,z), (abs(x),y,z))
    return (-px if x < 0 else px),py,pz


def shoulder_seams(parts):
    body = parts[1].data.vertices
    tree = KDTree(len(body))
    for v in body:
        tree.insert(v.co/HEIGHT,v.index)
    tree.balance()
    anchors = []
    for sleeve in (6,8):
        for v in parts[sleeve].data.vertices:
            p = v.co/HEIGHT
            _,_,distance = tree.find(p)
            if distance < .003:
                anchors.append(p)
    if not anchors:
        raise ValueError("Missing sleeve attachment on the source jacket.")
    seam = KDTree(len(anchors))
    for i,p in enumerate(anchors):
        seam.insert(p,i)
    seam.balance()
    return seam


def distribution(part, p, seam):
    x,y,z = p
    side = ".L" if x > 0 else ".R"

    def joint(name):
        return {name: 1.0}

    if part in (0,15,16):
        if part == 0 and z < .79:
            return blend(joint("Neck"),joint("Head"),ramp(z,.737,.783))
        return joint("Head")
    if part in (2,3,5,9,12):
        lower = blend(joint("Foot"+side),joint("Shin"+side),ramp(z,.085,.145))
        leg = blend(lower,joint("Thigh"+side),ramp(z,.196,.288))
        return blend(leg,joint("Hips"),ramp(z,.363+.042*min(abs(x)/.09,1),.513))

    torso = blend(joint("Hips"),joint("Spine"),ramp(z,.495,.58))
    torso = blend(torso,joint("Chest"),ramp(z,.572,.651))
    # Use the same continuous shoulder field on both sides of the mesh cut.
    # Jacket hem/hood remain on the torso even when level with a hand or upper arm.
    ax = abs(x)
    edge = .134-.080*ramp(z,.51,.685)
    amount = ramp(ax,edge,edge+.058)*(1-ramp(y,.059,.102))*(1-ramp(z,.741,.784))
    if part in (4,6,7,8):
        # Detached sleeve cloth must follow the limb even when a wide fold
        # happens to be level with the ribs. Feather only the actual armhole.
        _,_,distance = seam.find(p)
        amount += (1-amount)*ramp(distance,.004,.050)
    along = (ax-.092)*.526+(.713-z)*.85
    arm = blend(joint("Forearm"+side),joint("Hand"+side),ramp(along,.215,.266))
    arm = blend(joint("UpperArm"+side),arm,ramp(along,.087,.155))
    collar = blend(joint("Clavicle"+side),joint("UpperArm"+side),ramp(ax,.071,.134))
    arm = blend(arm,collar,ramp(z,.65,.718))
    return blend(torso,arm,amount)


def bind(source):
    bpy.ops.import_scene.gltf(filepath=str(source.resolve()))
    parts = {int(o.name.split("_")[-1]):o for o in bpy.context.scene.objects if o.type == "MESH"}
    assert set(parts) == set(range(19))
    turn = Matrix.Rotation(-pi/2,4,"Z")
    world = {i:turn @ o.matrix_world.copy() for i,o in parts.items()}
    heights = [(world[i] @ v.co).z for i,o in parts.items() for v in o.data.vertices]
    bottom,top = min(heights),max(heights)
    normalization = Matrix.Scale(HEIGHT/(top-bottom),4) @ Matrix.Translation((0,0,-bottom))
    for i,o in parts.items():
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
        o.data.transform(normalization @ world[i])
    for o in list(bpy.context.scene.objects):
        if o.type == "EMPTY":
            bpy.data.objects.remove(o,do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    rig = skeleton(HEIGHT,"Citizen01",fit_joint)
    # Imported sections and UV islands can carry duplicate boundary vertices.
    # Identical positions receive identical weights to keep sleeves and cuffs sewn.
    at_position = defaultdict(list)
    seam = shoulder_seams(parts)
    for part,o in parts.items():
        for v in o.data.vertices:
            key = tuple(round(a,5) for a in v.co)
            at_position[key].append((part,v.index,distribution(part,v.co/HEIGHT,seam)))
    groups = {i:{b.name:o.vertex_groups.new(name=b.name) for b in rig.data.bones} for i,o in parts.items()}
    for matches in at_position.values():
        weights = defaultdict(float)
        for _,_,entry in matches:
            for name,w in entry.items():
                weights[name] += w
        strongest = [(name,w) for name,w in sorted(weights.items(),key=lambda item:-item[1])[:4] if w>1e-6]
        total = sum(w for _,w in strongest)
        for part,idx,_ in matches:
            for name,w in strongest:
                groups[part][name].add([idx],w/total,"REPLACE")
    for part,o in parts.items():
        o.parent = rig
        o.modifiers.new("Citizen skin","ARMATURE").object = rig
    return rig


def add_greeting(rig):
    # Start and finish in the shared idle pose, with both feet planted throughout.
    base = author_action(rig,HEIGHT,"Idle",WAVE_FRAMES,arm_lower_degrees=ARM_LOWER)
    base.name = "Wave"
    chain = ["UpperArm.R","Forearm.R","Hand.R"]
    bones = rig.data.bones
    rest = {n:bones[n].matrix_local.to_quaternion() for n in chain}
    for frame in range(WAVE_FRAMES+1):
        bpy.context.scene.frame_set(frame)
        t = frame/WAVE_FRAMES
        amount = ramp(t,.04,.32)*(1-ramp(t,.71,.97))
        oscillation = sin(tau*(t-.31)/.235)*ramp(t,.28,.37)*(1-ramp(t,.66,.76))
        # Absolute directions avoid bending the elbow behind the shoulder.
        targets = [Vector((-.78,-.42,-.32)),
                   Vector((-.30+.16*oscillation,-.40,.88)),
                   Vector((-.31+.59*oscillation,-.30,.91))]
        clav = rig.pose.bones["Clavicle.R"]
        parent = (clav.matrix @ clav.bone.matrix_local.inverted()).to_quaternion()
        for name,goal in zip(chain,targets):
            bone = bones[name]
            pose = rig.pose.bones[name]
            original = (pose.matrix @ bone.matrix_local.inverted()).to_quaternion()
            target = (bone.tail_local-bone.head_local).rotation_difference(goal.normalized())
            target.make_compatible(original)
            wanted = original.slerp(target,amount)
            local = rest[name].inverted() @ parent.inverted() @ wanted @ rest[name]
            local.make_compatible(pose.rotation_quaternion)
            pose.rotation_quaternion = local
            pose.keyframe_insert("rotation_quaternion",frame=frame,group=name)
            parent = wanted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source",type=Path)
    parser.add_argument("output",type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    if sha256(args.source.read_bytes()).hexdigest() != SOURCE:
        raise ValueError("Expected the textured 19-part GLB of citizen 01.")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig = bind(args.source)
    add_greeting(rig)
    args.output.mkdir(parents=True,exist_ok=True)
    save_motion_asset(rig,HEIGHT,args.output.resolve()/"CIVRUM_Citizen_01",
                      arm_lower_degrees=ARM_LOWER,viewport_color="TEXTURE")


if __name__ == "__main__":
    main()
