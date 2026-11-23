"""Build the CIVRUM researcher motion study from the original Tripo mesh."""

import argparse
from collections import defaultdict
from hashlib import sha256
from math import cos, pi, radians, sin, sqrt, tau
from pathlib import Path
import sys

import bpy
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree


SOURCE_HASH = "017f63173066ea4d422a9a44e184f4a6b308ee950aa5011bf0045f2068eb6b28"
HEIGHT = 1.68
FPS = 30
CYCLE = 36
STRIDE = .56  # In source-height units per full walk cycle
X, Y, Z = (Vector(v) for v in ((1, 0, 0), (0, 1, 0), (0, 0, 1)))


def smooth(t):
    t = min(1, max(0, t))
    return t * t * (3 - 2 * t)


def ramp(z, low, high):
    return smooth((z - low) / (high - low))


def blend(a, b, t):
    weights = defaultdict(float)
    for name, w in a.items():
        weights[name] += w * (1 - t)
    for name, w in b.items():
        weights[name] += w * t
    return weights


def components(adjacency, vertices):
    remaining = set(vertices)
    groups = []
    while remaining:
        stack = [remaining.pop()]
        group = []
        while stack:
            i = stack.pop()
            group.append(i)
            found = remaining.intersection(adjacency[i])
            remaining.difference_update(found)
            stack.extend(found)
        groups.append(group)
    return sorted(groups, key=lambda g: (-len(g), min(g)))


def identify(mesh, p):
    adjacency = [set() for _ in p]
    for edge in mesh.edges:
        i, j = edge.vertices
        adjacency[i].add(j)
        adjacency[j].add(i)
    islands = components(adjacency, range(len(p)))
    regions = ["detail"] * len(p)
    def mark(group, name):
        for i in group:
            regions[i] = name
    hair, main = islands[:2]
    mark(hair, "hair")
    mark(main, "body")
    # Below the lapels the inner shirt and trousers form one shell, separate
    # from the coat. A lower cut also separates each sleeve from the hem.
    for group in components(adjacency, (i for i in main if p[i].z < .63)):
        if min(p[i].z for i in group) < .15:
            mark(group, "undercoat")
    for group in components(adjacency, (i for i in main if p[i].z < .59)):
        zmin = min(p[i].z for i in group)
        if .30 < zmin < .33:
            mark(group, "hem")
        elif zmin > .48:
            mark(group, "sleeve")
    for group in islands[2:]:
        c = sum((p[i] for i in group), Vector()) / len(group)
        if c.z < .12:
            kind = "shoe" if len(group) > 300 else ("sock" if c.z > .08 else "lace")
        elif c.z < .54:
            kind = "hand" if abs(c.x) > .14 else "pen"
        elif c.z > .87:
            kind = "brow"
        elif c.z > .80:
            kind = "glasses"
        elif c.z > .68:
            kind = "earpad" if len(group) < 50 else "headphones"
        else:
            kind = "badge" if c.x > .025 else "button"
        mark(group, kind)
    return regions


def skeleton(scale, name="Researcher03", map_joint=None):
    data = bpy.data.armatures.new(name + " · skeleton")
    rig = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    def bone(name, start, end, parent=None):
        b = data.edit_bones.new(name)
        if map_joint:
            start, end = map_joint(start), map_joint(end)
        b.head, b.tail = Vector(start) * scale, Vector(end) * scale
        if parent:
            b.parent = data.edit_bones[parent]
    bone("Root", (0, 0, 0), (0, 0, .05))
    bone("Hips", (0, 0, .435), (0, 0, .52), "Root")
    bone("Spine", (0, 0, .52), (0, 0, .615), "Hips")
    bone("Chest", (0, 0, .615), (0, 0, .735), "Spine")
    bone("Neck", (0, 0, .735), (0, 0, .779), "Chest")
    bone("Head", (0, 0, .779), (0, 0, .958), "Neck")
    for side, sign in (("L", 1), ("R", -1)):
        def pair(name, start, end, parent):
            bone(name + "." + side, (start[0]*sign, *start[1:]),
                 (end[0]*sign, *end[1:]), parent)
        shoulder, elbow = (.091, .002, .69), (.153, .001, .588)
        wrist, fingers = (.210, -.009, .495), (.242, -.020, .417)
        hip, knee, ankle = (.058, 0, .435), (.061, -.014, .242), (.066, -.002, .072)
        pair("Clavicle", (0, 0, .695), shoulder, "Chest")
        pair("UpperArm", shoulder, elbow, "Clavicle." + side)
        pair("Forearm", elbow, wrist, "UpperArm." + side)
        pair("Hand", wrist, fingers, "Forearm." + side)
        pair("Thigh", hip, knee, "Hips")
        pair("Shin", knee, ankle, "Thigh." + side)
        pair("Foot", ankle, (.071, -.093, .027), "Shin." + side)
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.show_in_front = True
    data.display_type = 'STICK'
    return rig


def skin_weights(point, region):
    x, y, z = point
    side = ".L" if x > 0 else ".R"
    def joint(name):
        return {name: 1.0}
    if region in ("hair", "brow", "glasses") or z > .784:
        return joint("Head")
    if region in ("earpad", "headphones"):
        return joint("Chest")
    if region in ("shoe", "lace"):
        return joint("Foot" + side)
    if region == "sock":
        return blend(joint("Foot"+side), joint("Shin"+side), ramp(z, .073, .102))
    if region == "hand":
        return blend(joint("Hand"+side), joint("Forearm"+side), ramp(z, .488, .515))
    if region == "sleeve" or (region == "body" and .585 < z < .727):
        base = blend(joint("Forearm"+side), joint("UpperArm"+side), ramp(z,.560,.614))
        arm = blend(base, joint("Clavicle"+side), ramp(z,.651,.715))
        if region == "sleeve":
            return arm
        inner = .094 - .30*(z-.59)
        strength = ramp(abs(x), inner-.014, inner+.015) * (1-ramp(z,.697,.727))
        chest = blend(joint("Spine"),joint("Chest"),ramp(z,.58,.65))
        return blend(chest,arm,strength)
    if region == "undercoat" and z < .485:
        lower = blend(joint("Shin"+side), joint("Thigh"+side), ramp(z,.185,.298))
        if z>.345:
            cross = blend(joint("Thigh.R"),joint("Thigh.L"),ramp(x,-.023,.023))
            lower = blend(lower,cross,ramp(z,.345,.386))
        return blend(lower, joint("Hips"), ramp(z,.358,.460))
    if region in ("hem", "pen"):
        # A continuous back panel needs a smooth blend across both thighs.
        width = .013 + .049*ramp(y,-.064,.030)
        legs = blend(joint("Thigh.R"), joint("Thigh.L"), ramp(x,-width,width))
        return blend(legs, joint("Hips"), ramp(z,.358,.475))
    if z < .59:
        return blend(joint("Hips"), joint("Spine"), ramp(z,.493,.566))
    if z < .72:
        return blend(joint("Spine"), joint("Chest"), ramp(z,.58,.65))
    if z < .754:
        return blend(joint("Chest"), joint("Neck"), ramp(z,.728,.754))
    return blend(joint("Neck"), joint("Head"), ramp(z,.754,.782))


PALETTE = {
    "ivory":"E7D9BF", "hair":"64768C", "skin":"E9AA82", "brow":"583D34",
    "glasses":"463B3B", "headphones":"294D55", "earpad":"E7AE4F",
    "shoe":"41828A", "sole":"E7D7BE", "lace":"E6AF54", "sock":"C3BDAF",
    "pants":"464E61", "shirt":"586880", "badge":"44958E", "button":"DEC9A9",
    "pen":"547F9E", "white":"F8E8D0", "iris":"75492F", "pupil":"2A2427",
}


def linear_color(code):
    x = [int(code[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(c/12.92 if c<.04045 else ((c+.055)/1.055)**2.4 for c in x) + (1,)


def finish(region, p):
    x, y, z = p
    if region == "hand" or (region == "body" and (z>.761 or (z>.729 and abs(x)<.027))):
        return "skin"
    if region == "shoe":
        return "sole" if z < .021 or (y < -.082 and z < .045) else "shoe"
    if region == "undercoat":
        return "pants" if z < .493 else "shirt"
    if region == "body" and abs(x) < .018 and y < -.030 and .61 < z < .72:
        return "shirt"
    return region if region in PALETTE else "ivory"


def build_surface(source):
    bpy.ops.import_scene.gltf(filepath=str(source))
    mesh_obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    mesh = mesh_obj.data
    points = [mesh_obj.matrix_world @ v.co for v in mesh.vertices]
    faces = [tuple(poly.vertices) for poly in mesh.polygons]
    regions = identify(mesh, points)
    # Add ease to the open front panels and their pockets so the trousers
    # can swing forward. Fade the offset at the placket and side seams.
    for p,region in zip(points,regions):
        if region == "hem":
            p.y -= .012 * (1-ramp(p.z,.442,.51)) * (1-ramp(p.y,-.074,-.030))
    surface = BVHTree.FromPolygons(points, faces, all_triangles=True)
    face_colors = []
    for face in faces:
        center = sum((points[i] for i in face), Vector())/len(face)
        face_colors.append(finish(regions[face[0]], center))
    # Place small elliptical eyes directly on the face surface inside each
    # spectacle rim. The source has sculpted glasses and blank eyeballs.
    for sign in (1, -1):
        cx, cz = .033*sign, .844
        def eye_vertex(dx, dz, inset):
            x, z = cx+dx, cz+dz
            hit, *_ = surface.ray_cast((x,-.3,z), (0,1,0))
            if hit is None:
                raise ValueError("Eye lies outside source face")
            points.append(Vector((x,hit.y-inset,z)))
            regions.append("eye")
            return len(points)-1
        center = eye_vertex(0,0,.0019)
        previous = [center]*32
        for rx, rz, color in ((.0054,.008,"pupil"),(.009,.012,"iris"),(.0145,.015,"white")):
            ring = [eye_vertex(rx*cos(tau*i/32),rz*sin(tau*i/32),.0018) for i in range(32)]
            for i in range(32):
                j=(i+1)%32
                faces.append((previous[i],ring[i],ring[j]))
                face_colors.append(color)
                if previous[i] != previous[j]:
                    faces.append((previous[i],ring[j],previous[j]))
                    face_colors.append(color)
            previous=ring
        c = eye_vertex(-.0025,.0038,.0029)
        ring = [eye_vertex(-.0025+.002*cos(tau*i/12),.0038+.002*sin(tau*i/12),.0029) for i in range(12)]
        for i in range(12):
            faces.append((c,ring[i],ring[(i+1)%12]))
            face_colors.append("white")
    for o in list(bpy.context.scene.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    scale = HEIGHT/max(p.z for p in points)
    mesh = bpy.data.meshes.new("Researcher03 · skinned surface")
    mesh.from_pydata([p*scale for p in points], [], faces)
    mesh.update()
    obj = bpy.data.objects.new("Researcher03_Surface", mesh)
    bpy.context.collection.objects.link(obj)
    colors = mesh.color_attributes.new(name="Outfit", type='BYTE_COLOR', domain='CORNER')
    swatches = {k:linear_color(v) for k,v in PALETTE.items()}
    for poly, name in zip(mesh.polygons, face_colors):
        poly.use_smooth=True
        for i in poly.loop_indices:
            colors.data[i].color = swatches[name]
    mat=bpy.data.materials.new("Researcher · outfit colors")
    mat.use_nodes=True
    node=mat.node_tree.nodes.new('ShaderNodeVertexColor')
    node.layer_name = colors.name
    shader=mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value=.76
    mat.node_tree.links.new(node.outputs["Color"], shader.inputs["Base Color"])
    mesh.materials.append(mat)
    rig=skeleton(scale)
    obj.parent = rig
    groups={b.name:obj.vertex_groups.new(name=b.name) for b in rig.data.bones}
    weights=[skin_weights(p,region) for p,region in zip(points,regions)]
    # Relax only the joined shoulder / sleeve transition. Mesh adjacency
    # keeps adjacent layers such as ears, hair, lapels and hands independent.
    adjacency=[set() for _ in points]
    for edge in mesh.edges:
        a,b=edge.vertices
        adjacency[a].add(b)
        adjacency[b].add(a)
    shoulder=[i for i,p in enumerate(points) if regions[i] in ("sleeve","body")
              and .572<p.z<.732 and abs(p.x)>.057]
    for _ in range(8):
        updates={}
        for i in shoulder:
            near=defaultdict(float)
            for j in adjacency[i]:
                for name,w in weights[j].items():
                    near[name]+=w/len(adjacency[i])
            updates[i]=blend(weights[i],near,.60)
        for i,value in updates.items():
            weights[i]=value
    for i, distribution in enumerate(weights):
        strongest=sorted(distribution.items(),key=lambda kv:-kv[1])[:4]
        used = {k:v for k,v in strongest if v>1e-6}
        for name,w in used.items():
            groups[name].add([i], w/sum(used.values()), 'REPLACE')
    modifier=obj.modifiers.new("Researcher skin", 'ARMATURE')
    modifier.object=rig
    return rig, scale


def foot_target(ankle, t):
    if t <= .5:
        forward = STRIDE*(.25-t)
        lift = 0.
    else:
        swing = 2*t-1
        # Same backward velocity on both sides of toe-off / heel strike.
        forward = STRIDE*(-.25 + smooth(swing) - .5*swing)
        lift = .065*sin(pi*swing)**2
    return ankle + Vector((0,-forward,lift))


def author_action(rig, scale, name, duration, direction=0, *, arm_lower_degrees=20):
    bones=rig.data.bones
    pose=rig.pose.bones
    rest={b.name:b.matrix_local.to_quaternion() for b in bones}
    neutral=Quaternion()
    rig.animation_data_create()
    action=bpy.data.actions.new(name)
    action.use_fake_user=True
    rig.animation_data.action=action
    previous={}
    for frame in range(duration+1):
        t=frame/duration
        phase=tau*t
        breath=sin(phase) if name=="Idle" else 0.
        gait=1 if name=="Walk" else 0
        heading=direction*pi/2*smooth(t)
        yaw=Quaternion(Z,heading)
        dip = -.012 if not gait else -.031-.008*cos(2*phase)
        travel=Vector((gait*.009*sin(phase),0,dip+.002*breath))
        hp=pose["Hips"]
        hp.location=rest["Hips"].inverted() @ (travel*scale)
        hp.keyframe_insert('location',frame=frame,group="Hips")
        world={"Root":neutral}
        def orient(bone, q):
            parent=bones[bone].parent.name
            rot=rest[bone].inverted() @ world[parent].inverted() @ q @ rest[bone]
            if bone in previous:
                rot.make_compatible(previous[bone])
            previous[bone]=rot.copy()
            pose[bone].rotation_quaternion=rot
            pose[bone].keyframe_insert('rotation_quaternion',frame=frame,group=bone)
            world[bone]=q
        orient("Hips",yaw)
        orient("Spine",yaw @ Quaternion(Z,radians(-2.8*gait*cos(phase))))
        chest=world["Spine"] @ Quaternion(X,radians(-1.3+.65*breath))
        orient("Chest",chest)
        orient("Neck",yaw @ Quaternion(Z,radians(1.2*breath)))
        orient("Head",yaw @ Quaternion(Z,radians(2.3*breath + direction*7*sin(phase))))
        for sign,side in ((1,".L"),(-1,".R")):
            offset=(t+(0 if sign==1 else .5))%1
            arm_phase=cos(tau*offset)
            clav=chest @ Quaternion(Y,radians(sign*.6*breath))
            orient("Clavicle"+side,clav)
            arm=clav @ Quaternion(X,radians(12*gait*arm_phase+1)) @ Quaternion(Y,radians(arm_lower_degrees*sign))
            fore=arm @ Quaternion(X,radians(-9-3*gait*(1-arm_phase)))
            orient("UpperArm"+side,arm)
            orient("Forearm"+side,fore)
            orient("Hand"+side,fore)
            thigh,shin,foot = (bones[n+side] for n in ("Thigh","Shin","Foot"))
            hip, knee, ankle = (b.head_local/scale for b in (thigh,shin,foot))
            goal=ankle.copy()
            foot_yaw=yaw
            if gait:
                goal=foot_target(ankle,offset)
            elif direction:
                # Move one foot at a time. Each planted shoe stays fixed in
                # scene space while the pelvis turns between the feet.
                first=(sign==direction)
                step=min(1,max(0,2*t-(0 if first else 1)))
                foot_yaw=Quaternion(Z,direction*pi/2*smooth(step))
                goal=foot_yaw @ ankle
                goal.z+=.042*sin(pi*step)**2
            origin=(yaw @ hip) + travel
            local_goal=yaw.inverted() @ (goal-origin)
            length=local_goal.length
            upper,lower=(knee-hip).length,(ankle-knee).length
            if not abs(upper-lower)<length<upper+lower:
                raise ValueError(f"Unreachable target {name} at frame {frame}")
            axis=local_goal.normalized()
            pole=Vector((0,-1,0))
            bend=(pole-axis*axis.dot(pole)).normalized()
            along=(upper**2-lower**2+length**2)/(2*length)
            solved=axis*along + bend*sqrt(max(0,upper**2-along**2))
            orient(thigh.name,yaw @ (knee-hip).rotation_difference(solved))
            orient(shin.name,yaw @ (ankle-knee).rotation_difference(local_goal-solved))
            orient(foot.name,foot_yaw)
    return action


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source",type=Path)
    parser.add_argument("output",type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    if sha256(args.source.read_bytes()).hexdigest() != SOURCE_HASH:
        raise ValueError("This rig's landmarks are calibrated to the original 03 GLB.")
    args.output.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig,scale=build_surface(args.source.resolve())
    save_motion_asset(rig, scale, args.output.resolve()/"CIVRUM_Researcher_03")


def save_motion_asset(rig, scale, dest, *, arm_lower_degrees=20, viewport_color='VERTEX'):
    scene=bpy.context.scene
    scene.render.fps=FPS
    actions = [
        author_action(rig, scale, name, duration, turn, arm_lower_degrees=arm_lower_degrees)
        for name, duration, turn in (
            ("Idle", 90, 0), ("Walk", CYCLE, 0), ("TurnLeft90", 30, 1), ("TurnRight90", 30, -1)
        )
    ]
    rig.animation_data.action=actions[0]
    scene.frame_start=0
    scene.frame_end=90
    scene.frame_set(0)
    rig["walk_stride_m"]=scale*STRIDE
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active=rig
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active
            space.region_3d.view_distance=3.4
            space.region_3d.view_location=(0,0,.87)
            space.region_3d.view_rotation=Quaternion(X,pi/2)
            space.shading.color_type=viewport_color
            space.overlay.show_overlays=False
    bpy.context.preferences.filepaths.save_version=0
    bpy.data.orphans_purge(do_recursive=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(dest.with_suffix(".blend")),compress=True)
    bpy.ops.export_scene.gltf(filepath=str(dest.with_suffix(".glb")),export_format='GLB',
        export_animations=True,export_animation_mode='ACTIONS',export_frame_range=False,
        export_force_sampling=True,export_extras=True,export_all_vertex_colors=False)


if __name__=="__main__":
    main()
