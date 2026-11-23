"""Fit the shared CIVRUM locomotion rig to the 02 construction worker."""

import argparse
from collections import defaultdict
from hashlib import sha256
from math import atan2, pi, radians
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rig_researcher import blend, components, ramp, save_motion_asset, skeleton


SOURCE_HASH = "286749d7eeb5c087b60636dd940c2e4523bd720907db3ea202ea20a60eae5adf"
HEIGHT_WITH_HELMET = 1.72
COLORS = {
    "helmet": "F4AF20", "goggle": "6B4938", "strap": "534647", "buckle": "E9AA39",
    "boot": "E9A82A", "sole": "4B403B", "lace": "54443D", "hardware": "89755D",
    "denim": "455D80", "cuff": "8B97A9", "shirt": "536D92", "sleeve": "798AA3",
    "vest": "E67F29", "zip": "AD5F27", "glove": "393A43",
    "leather": "715647", "bag": "DFA42C", "skin": "EDB38C", "hair": "513A31",
    "brow": "4D342B", "eye": "F7E9D6",
}
TILE = 128
NAMES = ("helmet","goggle","strap","buckle","lace","hardware","zip","leather","bag","brow","eye")
CHARTS = {"front": (0,512,512,512), "back": (512,512,512,512),
          "head": (0,384,512,128), "boot": (512,384,256,128)}


def map_joint(point):
    # Calibrated on the neutral, helmeted A pose (floor = 0, helmet top = 1).
    z_src = [0, .027, .072, .242, .417, .435, .495, .52, .588, .615, .69, .695, .735, .779, .958]
    z_dst = [0, .030, .085, .253, .418, .448, .516, .537, .611, .636, .716, .719, .752, .779, .960]
    x, y, z = point
    # Low joints follow the wider boot stance. Hands and elbows use their
    # own landmarks: a hand can be at the same height as a hip.
    width = 1.05 if abs(x) > .09 else 1 + .25 * (1-ramp(z,.38,.66))
    return x * width, y, float(np.interp(z, z_src, z_dst))


def classify(mesh, points):
    adjacency = [set() for _ in points]
    for edge in mesh.edges:
        a, b = edge.vertices
        adjacency[a].add(b)
        adjacency[b].add(a)
    groups = components(adjacency, range(len(points)))
    regions = ["body"] * len(points)

    def mark(group, name):
        for i in group:
            regions[i] = name

    body = groups[0]
    # A horizontal cut below the axilla separates both arms and the torso,
    # even though the original exporter fused the sleeves, hands and vest.
    for group in components(adjacency, (i for i in body if points[i].z < .62)):
        if min(points[i].z for i in group) > .30:
            mark(group, "arm")
    for group in components(adjacency, (i for i in body if points[i].z > .737)):
        if max(points[i].z for i in group) > .88:
            mark(group, "head")
    for group in groups[1:]:
        p = np.array([tuple(points[i]) for i in group])
        lo, hi = p.min(axis=0), p.max(axis=0)
        x, y, z = (lo+hi)/2
        if z > .80:
            if len(group) > 500:
                name = "helmet"
            elif len(group) > 120:
                name = "goggle"
            elif z < .876:
                name = "eye"
            elif z < .895 and y < -.055:
                name = "brow"
            else:
                name = "strap"
        elif z < .16:
            if lo[2] < .005:
                name = "boot"
            elif hi[2] > .13:
                name = "sock"
            else:
                name = "lace" if len(group) >= 35 else "hardware"
        elif z < .54:
            if len(group) >= 185:
                name = "yellow_pouch" if x < 0 and y < 0 else "pouch"
            elif abs(x) < .022 and y < -.05:
                name = "buckle"
            else:
                name = "belt"
        else:
            name = "zip"
        mark(group, name)
    return regions, adjacency


def make_atlas():
    # One packed base-color texture; procedural UV islands keep the vest
    # reflectors, pupil and lens details continuous across coarse triangles.
    swatches = {k: np.array(list(bytes.fromhex(v)))/255
                for k, v in COLORS.items()}
    grid = np.zeros((1024,1024,4), np.float32)
    grid[:, :, 3] = 1
    v, u = np.mgrid[0:TILE, 0:TILE]/(TILE-1)
    for i, name in enumerate(NAMES):
        color = np.broadcast_to(swatches[name], (TILE,TILE,3)).copy()
        if name == "eye":
            xx, yy = (u-.5)/.34, (v-.48)/.40
            radius = np.hypot(xx,yy)
            color[radius < 1] = [.36,.23,.14]
            color[radius < .70] = [.15,.115,.105]
            color[np.hypot((xx+.30)/.24,(yy-.35)/.24)<1] = [1,.97,.89]
        elif name == "goggle":
            radius = np.hypot((u-.5)/.49,(v-.5)/.48)
            color[radius < .94] = [.74,.57,.30]
            color[radius < .78] = [.20,.43,.49]
            color[radius < .66] = [.28,.57,.64]
            color[np.hypot((u-.40)/.066,(v-.62)/.045)<1] = [.75,.89,.89]
        row, col = divmod(i,8)
        grid[row*TILE:(row+1)*TILE,col*TILE:(col+1)*TILE,:3] = color
    for key,(left,bottom,width,height) in CHARTS.items():
        v,u=np.mgrid[0:height,0:width]/np.array([height-1,width-1])[:,None,None]
        color=np.broadcast_to(swatches["skin"],(height,width,3)).copy()
        if key in ("front","back"):
            x,z = np.abs((u-.5)*.58), .10+.69*v
            color[...] = swatches["denim"]
            color[z < .166] = swatches["cuff"]
            vest = z >= .529
            color[vest] = swatches["vest"]
            stripe = (abs(z-.562)<.011) | (abs(z-.604)<.011)
            stripe |= (z>=.604) & (abs(x-(.050+(z-.61)*.16)) < .012)
            color[vest & stripe] = [.79,.79,.75]
            color[vest & (abs(z-.536)<.002)] *= .82
            neckline = z > (.650+x*1.37 if key=="front" else .744)
            if key=="front":
                color[vest & (x<.0029)] = swatches["zip"]
            color[neckline] = swatches["shirt"]
            # Continuous fabric seams around both rolled sleeves and gloves.
            armhole = np.minimum(.141,.094+(.715-z)*.15+np.maximum(0,.620-z)*.41)
            arm = (x>armhole) & (z>.378)
            along = .55*(x-.212)-.84*(z-.516)
            color[arm] = swatches["shirt"]
            color[arm & (along>-.138)] = swatches["sleeve"]
            color[arm & (along>-.107)] = swatches["skin"]
            color[arm & (along>-.005)] = swatches["glove"]
            color[arm & (abs(along-.010)<.003)] *= .80
        elif key=="head":
            angle = (u-.5)*2*pi
            side = abs(angle)
            z = .732+.21*v
            hairline = np.interp(side,[0,.62,1.06,1.52,2.12,pi],
                                 [.895,.893,.850,.847,.808,.795])
            hairline += .0022*np.sin(13*angle)
            color[z>hairline] = swatches["hair"]
            ear = ((side-1.54)/.35)**2 + ((z-.837)/.025)**2 < 1
            color[ear] = swatches["skin"]
            mouth = (abs(angle)<.21) & (abs(z-(.804+.0025*(angle/.21)**2))<.0014)
            color[mouth] = [.64,.38,.29]
        else:
            y,z = -.12+u*.21, .14*v
            color[...] = swatches["boot"]
            sole = z<.020
            toe = (y<-.076) & (z < .025+(-.076-y)*.53)
            heel = (y>.052) & (z < .054)
            color[sole | toe | heel] = swatches["sole"]
            color[abs(z-.021)<.003] = swatches["leather"]
        grid[bottom:bottom+height,left:left+width,:3] = color
    atlas = bpy.data.images.new("Builder02 · workwear",1024,1024,alpha=False)
    atlas.colorspace_settings.name = "sRGB"
    atlas.pixels.foreach_set(grid.ravel())
    atlas.pack()
    material = bpy.data.materials.new("Builder02 · workwear")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    image_node = nodes.new("ShaderNodeTexImage")
    image_node.image = atlas
    nodes.active = image_node
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = .67
    material.node_tree.links.new(image_node.outputs["Color"],bsdf.inputs["Base Color"])
    return material


def finish(p, region):
    _, y, z = p
    if region == "boot":
        return "boot"
    if region == "sock":
        return "strap"
    if region in ("pouch", "yellow_pouch"):
        return "bag" if region == "yellow_pouch" and z < .478 else "leather"
    if region == "belt":
        return "leather"
    if region == "head":
        return "head"
    if region in ("body","arm"):
        return "front" if y<0 else "back"
    return region


def paint(obj, points, regions):
    mesh = obj.data
    mesh.materials.clear()
    mesh.materials.append(make_atlas())
    uv = mesh.uv_layers.new(name="Workwear")
    for poly in mesh.polygons:
        vertices = list(poly.vertices)
        center = sum((points[i] for i in vertices),Vector())/len(vertices)
        name = finish(center,regions[vertices[0]])
        if name in CHARTS:
            left,bottom,width,height = CHARTS[name]
        else:
            row,col = divmod(NAMES.index(name),8)
            left,bottom,width,height = col*TILE,row*TILE,TILE,TILE
        for i, loop in zip(vertices,poly.loop_indices):
            x, y, z = points[i]
            u, v = .5, .5
            if name in ("front","back"):
                u, v = x/.58+.5, (z-.10)/.69
            elif name=="head":
                angle = atan2(x,-y)
                if center.y>0 and x*center.x<0:
                    angle=pi if center.x>0 else -pi
                u, v = angle/(2*pi)+.5,(z-.732)/.21
            elif name=="boot":
                u,v = (y+.12)/.21,z/.14
            elif name == "eye":
                u, v = (x - (.030 if x>0 else -.030))/.033+.5, (z-.834)/.041
            elif name == "goggle":
                u, v = (x-(.035 if x>0 else -.035))/.060+.5, (z-.918)/.062
            uv.data[loop].uv = ((left+.5+min(1,max(0,u))*(width-1))/1024,
                                (bottom+.5+min(1,max(0,v))*(height-1))/1024)
        poly.use_smooth = True


BELT_PARTS = {"pouch","yellow_pouch","buckle","belt"}
HEAD_PARTS = {"helmet","goggle","strap","eye","brow"}


def weights(p, region):
    x, _, z = p
    side = ".L" if x > 0 else ".R"
    if region in HEAD_PARTS:
        return {"Head":1}
    if region == "head":
        return blend({"Neck":1},{"Head":1},ramp(z,.751,.778))
    if region in BELT_PARTS:
        return {"Hips":1}
    if region in ("boot","lace","hardware"):
        return {"Foot"+side:1}
    if region == "sock":
        return blend({"Foot"+side:1},{"Shin"+side:1},ramp(z,.112,.143))
    if region == "arm" or (region == "body" and .617 < z < .75):
        wrist = blend({"Hand"+side:1},{"Forearm"+side:1},ramp(z,.492,.539))
        elbow = blend(wrist,{"UpperArm"+side:1},ramp(z,.568,.647))
        arm = blend(elbow,{"Clavicle"+side:1},ramp(z,.682,.739))
        if region == "arm":
            return arm
        edge = .088-(z-.62)*.32
        arm_mix = ramp(abs(x),edge-.013,edge+.016)*(1-ramp(z,.716,.749))
        return blend({"Chest":1},arm,arm_mix)
    if z < .50:
        leg = blend({"Shin"+side:1},{"Thigh"+side:1},ramp(z,.203,.305))
        if z > .365:
            cross = blend({"Thigh.R":1},{"Thigh.L":1},ramp(x,-.027,.027))
            leg = blend(leg,cross,ramp(z,.365,.415))
        return blend(leg,{"Hips":1},ramp(z,.360,.446))
    if z < .598:
        return blend({"Hips":1},{"Spine":1},ramp(z,.529,.583))
    if z < .742:
        return blend({"Spine":1},{"Chest":1},ramp(z,.593,.622))
    return blend({"Chest":1},{"Neck":1},ramp(z,.744,.769))


def bind(obj, points, regions, adjacency, rig):
    fields = [weights(p,region) for p,region in zip(points,regions)]
    shoulder = [i for i,p in enumerate(points) if regions[i] in ("body","arm")
                and .599 < p.z < .748 and abs(p.x) > .055]
    for _ in range(8):
        updates = {}
        for i in shoulder:
            near = defaultdict(float)
            for j in adjacency[i]:
                for bone, w in fields[j].items():
                    near[bone] += w/len(adjacency[i])
            updates[i] = blend(fields[i],near,.6)
        for i,new in updates.items():
            fields[i] = new
    groups = {b.name:obj.vertex_groups.new(name=b.name) for b in rig.data.bones}
    for i, field in enumerate(fields):
        top = sorted(((k,w) for k,w in field.items() if w>1e-6),key=lambda kv:-kv[1])[:4]
        total = sum(w for _,w in top)
        for bone, w in top:
            groups[bone].add([i],w/total,'REPLACE')
    obj.parent = rig
    obj.modifiers.new("Builder skin","ARMATURE").object = rig


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source",type=Path)
    parser.add_argument("output",type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    if sha256(args.source.read_bytes()).hexdigest() != SOURCE_HASH:
        raise ValueError("Expected the original 02 worker GLB for these landmarks.")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.source.resolve()))
    obj, = (o for o in bpy.context.scene.objects if o.type=="MESH")
    matrix = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = Matrix.Identity(4)
    obj.data.transform(matrix)
    for root in list(bpy.context.scene.objects):
        if root != obj:
            bpy.data.objects.remove(root,do_unlink=True)
    obj.name = "Builder02_Surface"
    obj.data.name = "Builder02 · skinned surface"
    points = [v.co.copy() for v in obj.data.vertices]
    regions, adjacency = classify(obj.data,points)
    # A slight rigid cant from each belt loop gives the swinging thigh
    # clearance while retaining the pouch's original shape.
    pouch_ids = [i for i,r in enumerate(regions) if r in ("pouch","yellow_pouch")]
    for group in components(adjacency,pouch_ids):
        center = sum((points[i] for i in group),Vector()) / len(group)
        outward = Vector((center.x,center.y*1.30,0)).normalized()
        hinge = Vector((center.x,center.y,.513))
        rotation = Matrix.Rotation(radians(18),3,outward.cross(Vector((0,0,1))))
        offset = outward*.003
        if regions[group[0]] == "yellow_pouch":
            # This longer front pouch sits over the raised cargo-pocket flap.
            offset += Vector((-.005,-.010,.007))
        for i in group:
            points[i] = hinge + rotation @ (points[i]-hinge) + offset
            obj.data.vertices[i].co = points[i]
    obj.data.update()
    paint(obj,points,regions)
    scale = HEIGHT_WITH_HELMET/max(p.z for p in points)
    obj.data.transform(Matrix.Scale(scale,4))
    rig = skeleton(scale,"Builder02",map_joint)
    bind(obj,points,regions,adjacency,rig)
    args.output.mkdir(parents=True,exist_ok=True)
    save_motion_asset(rig,scale,args.output.resolve()/"CIVRUM_Builder_02",
                      arm_lower_degrees=12,viewport_color='TEXTURE')


if __name__ == "__main__":
    main()
