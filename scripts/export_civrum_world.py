"""Export and round-trip the standalone CIVRUM environment and its modular kit."""

import argparse
import hashlib
import json
import math
import struct
import sys
import tempfile
from collections import Counter
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_civrum_world as base
import detail_civrum_world as detail

IDENTITY = Matrix.Identity(4)
WORLD = base.ROOT / "blender" / detail.WORLD_FILE
CITY = "CIVRUM_City_Environment"
GAME_LAYERS = ("ENVIRONMENT", "ROADS", "PLAZA", detail.PUBLIC, detail.VEG, detail.WORK,
               "PLACEHOLDER_BUILDINGS")
ROAD_LIBRARY = "CIVRUM_Road_Kit.blend"


def turn_90(width):
    """Quarter-circle centreline, tangent to +X at (0,0) and +Y at (20,20)."""
    g = base.Geometry()

    def point(step, lateral):
        a = step * math.pi / 24
        return ((20-lateral)*math.sin(a), 20-(20-lateral)*math.cos(a))

    def ribbon(low, high, z, material, start=0, stop=12):
        for i in range(start, stop):
            g.surface([point(i,low), point(i+1,low), point(i+1,high), point(i,high)], z, material)

    half = width/2
    ribbon(-half, half, base.ROAD_Z, base.GRAPHITE)
    for sign in (-1,1):
        lo,hi = sorted((sign*half, sign*(half+base.WALK)))
        ribbon(lo,hi,base.WALK_Z,base.CONCRETE)
        lo,hi = sorted((sign*half,sign*(half+.22)))
        ribbon(lo,hi,base.WALK_Z+.002,base.WHITE)
        lo,hi = sorted((sign*(half-.285),sign*(half-.175)))
        ribbon(lo,hi,base.ROAD_Z+.003,base.WHITE)
        for offset in (half,half+base.WALK):
            for i in range(12):
                a,b = point(i,sign*offset),point(i+1,sign*offset)
                first = len(g.verts)
                g.verts.extend([(*a,base.ROAD_Z),(*b,base.ROAD_Z),(*b,base.WALK_Z),(*a,base.WALK_Z)])
                indices = tuple(range(first,first+4))
                outward = sign if offset>half else -sign
                g.face(indices if outward<0 else indices[::-1],base.CONCRETE)
    for i in (1,4,7,10):
        ribbon(-.065,.065,base.ROAD_Z+.004,base.YELLOW if width==10 else base.WHITE,i,i+1)
    return g


def road_assets():
    """Road port coordinates are in Blender XY, headings point out of the module."""
    roads = {}
    for width,suffix in ((10,"MAIN"),(7,"LOCAL")):
        straight = base.straight(20,width)
        roads["STRAIGHT_"+suffix] = straight, [(0,0,180,width),(20,0,0,width)]
        roads["TURN_90_"+suffix] = turn_90(width), [(0,0,180,width),(20,20,90,width)]
        for key, bearings in (("TEE",(0,90,180)),("CROSS",(-90,0,90,180))):
            arms = [(Vector((math.cos(math.radians(a)), math.sin(math.radians(a)))),width) for a in bearings]
            mesh,cut = base.junction(arms)
            # Continue the 2 mm painted curb lip of the straight and curved modules.
            for face,color in list(zip(mesh.faces,mesh.colors)):
                if color==base.WHITE:
                    mesh.surface([mesh.verts[i][:2] for i in face],base.WALK_Z+.002,base.WHITE)
            roads[key+"_"+suffix] = mesh, [(round(v.x*cut,6),round(v.y*cut,6),a,width)
                                           for (v,_),a in zip(arms,bearings)]
    g = base.Geometry()
    g.box(10,base.WALK/2,base.ROAD_Z,20,base.WALK,base.WALK_Z-base.ROAD_Z,base.CONCRETE)
    for i in range(1,8):
        g.surface(base.rectangle(2.5*i,base.WALK/2,.032,base.WALK-.22),base.WALK_Z+.003,base.METAL)
    roads["SIDEWALK"] = g, []
    g = base.Geometry()
    g.box(10,.11,base.ROAD_Z,20,.22,base.WALK_Z+.002-base.ROAD_Z,base.WHITE)
    roads["CURB"] = g, []
    for width,suffix in ((10,"MAIN"),(7,"LOCAL")):
        wear = base.Geometry()
        for i in range(3):
            wear.surface(base.rectangle((i+.5)*20/3,0,2.25,.13),base.ROAD_Z+.004,
                         base.YELLOW if width==10 else base.WHITE)
        for side in (-1,1):
            wear.surface(base.rectangle(10,side*(width/2-.23),20,.11),base.ROAD_Z+.003,base.WHITE)
        roads["MARKINGS_"+suffix] = wear, []
        crossing = base.Geometry()
        for i in range(-(width//2),width//2+1):
            if i:
                crossing.surface(base.rectangle(0,i*.85,2.3,.43),base.ROAD_Z+.007,base.WHITE)
        roads["CROSSWALK_"+suffix] = crossing, []
    return roads


def make_road_library(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with bpy.data.libraries.load(str(WORLD)) as (_,selected):
        selected.materials = ["MAT_"+row[0] for row in base.PALETTE]
    scene = bpy.context.scene
    scene.name = "CIVRUM • Road Kit"
    scene.unit_settings.system = "METRIC"
    scene.collection.children.link(bpy.data.collections.new("ROADS"))
    ports = {}
    for i,(name,(geometry,ends)) in enumerate(road_assets().items()):
        key = "ROAD_"+name
        obj = base.put("ROADS",key,geometry.mesh("KIT_"+key),((i%4)*54,(i//4)*48,0))
        obj.asset_mark()
        obj.asset_data.author = "NEXCIV"
        obj.asset_data.tags.new("road")
        obj["module"] = key
        ports[key] = ends
    detail.asset_previews(list(scene.objects))
    for area in bpy.context.screen.areas:
        if area.type=="VIEW_3D":
            area.spaces.active.shading.color_type = "MATERIAL"
            area.spaces.active.region_3d.view_location = (87,77,0)
            area.spaces.active.region_3d.view_distance = 240
    bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
    return ports


def new_object(name,data,collection):
    obj = bpy.data.objects.new(name,data)
    collection.objects.link(obj)
    return obj


def export_glb(path, objects, instances=False):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    result = bpy.ops.export_scene.gltf(
        filepath=str(path),export_format="GLB",use_selection=True,export_yup=True,
        export_gpu_instances=instances,export_animations=False,export_cameras=False,
        export_lights=False,export_texcoords=False,export_tangents=False,
        export_all_vertex_colors=False,export_vertex_color="NONE",export_extras=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"GLB export failed for {path}")
    if instances:
        # No unbatched fallback geometry is embedded. A loader must honour this extension.
        blob = path.read_bytes()
        size = struct.unpack_from("<I",blob,12)[0]
        doc = json.loads(blob[20:20+size])
        extension = "EXT_mesh_gpu_instancing"
        if extension not in doc.get("extensionsUsed",[]):
            raise ValueError("No GPU instances in the city export")
        doc["extensionsRequired"] = sorted(set(doc.get("extensionsRequired",[])) | {extension})
        header = json.dumps(doc,separators=(",",":")).encode()
        header += b" "*(-len(header)%4)
        binary = blob[20+size:]
        path.write_bytes(struct.pack("<4sIII4s",b"glTF",2,20+len(header)+len(binary),len(header),b"JSON")
                         + header + binary)


def measures(objects):
    bpy.context.view_layer.update()
    low,high = [math.inf]*3,[-math.inf]*3
    materials = Counter()
    for obj in objects:
        if obj.type!="MESH":
            continue
        mesh = obj.data
        mesh.calc_loop_triangles()
        for tri in mesh.loop_triangles:
            materials[mesh.materials[tri.material_index].name] += 1
        for vert in mesh.vertices:
            for i,v in enumerate(obj.matrix_world @ vert.co):
                low[i],high[i] = min(low[i],v),max(high[i],v)
    return {"bounds": [[round(v,6) for v in corner] for corner in (low,high)],
            "triangles": sum(materials.values()), "materials": dict(sorted(materials.items()))}


class Exporter:
    def __init__(self,folder):
        self.folder = folder
        self.items = []
        self.collection = bpy.data.collections.new("Export staging")
        bpy.context.scene.collection.children.link(self.collection)
        self.fonts = {}

    def mesh(self,obj):
        if obj.type=="MESH":
            return obj.data
        if obj.data not in self.fonts:
            deps = bpy.context.evaluated_depsgraph_get()
            self.fonts[obj.data] = bpy.data.meshes.new_from_object(obj.evaluated_get(deps),depsgraph=deps)
        return self.fonts[obj.data]

    def write(self,key,category,objects,ports=(),instances=False):
        rel = Path(category)/(key+".glb") if category else Path(key+".glb")
        path = self.folder/rel
        path.parent.mkdir(exist_ok=True,parents=True)
        metrics = measures(objects)
        export_glb(path,objects,instances)
        record = {"id":key,"file":rel.as_posix(),**metrics,"bytes":path.stat().st_size,
                  "sha256":hashlib.sha256(path.read_bytes()).hexdigest()}
        if ports:
            record["portsXY"] = ports
        self.items.append(record)
        for obj in reversed(objects):
            bpy.data.objects.remove(obj,do_unlink=True)

    def module(self,key,category,source,parts=(),ports=()):
        obj = new_object("CIVRUM_GAME_"+key,self.mesh(source),self.collection)
        copies = [obj]
        # Parts keep their relative transforms; the detached root is in local metres.
        inverse = source.matrix_world.inverted_safe()
        obj.matrix_world = IDENTITY
        for part in parts:
            child = new_object("GAME_"+part.name,self.mesh(part),self.collection)
            child.parent = obj
            child.matrix_basis = inverse @ part.matrix_world
            copies.append(child)
        self.write(key,category,copies,ports)

    def city(self):
        # Sibling leaves sharing a mesh are batched by the glTF GPU-instancing exporter.
        # Flatten only the export copy. Keep each replaceable hero and its fascia together.
        copies = []
        for layer in GAME_LAYERS:
            root = new_object(layer,None,self.collection)
            copies.append(root)
            originals = sorted(bpy.data.collections[layer].all_objects,key=lambda o:o.name)
            heroes = {}
            for obj in originals:
                if "replacement_anchor" in obj:
                    anchor = new_object("GAME_"+obj.name,None,self.collection)
                    anchor.parent = root
                    anchor.matrix_basis = obj.matrix_world
                    heroes[obj] = anchor
                    copies.append(anchor)
            for obj in originals:
                if obj.type not in {"MESH","FONT"}:
                    continue
                clone = new_object("GAME_"+obj.name+"_mesh",self.mesh(obj),self.collection)
                hero = obj if obj in heroes else obj.parent
                clone.parent = heroes.get(hero,root)
                clone.matrix_basis = hero.matrix_world.inverted_safe() @ obj.matrix_world if hero in heroes else obj.matrix_world
                copies.append(clone)
        self.write(CITY,"",copies,instances=True)


def export_assets(folder,kit,ports):
    bpy.ops.wm.open_mainfile(filepath=str(WORLD))
    exporter = Exporter(folder)
    exporter.city()
    for coll,category in ((detail.PUBLIC,"facilities"),(detail.VEG,"vegetation"),(detail.WORK,"construction")):
        representatives = {o.data["module"]:o for o in bpy.data.collections[coll].objects}
        for key,obj in sorted(representatives.items()):
            exporter.module(key,category,obj)
    for obj in bpy.data.collections["PLACEHOLDER_BUILDINGS"].objects:
        if "replacement_anchor" in obj:
            exporter.module(obj.name.removeprefix("CIVRUM_"),"buildings",obj,obj.children)
    for name in ("ENV_GROUND_MAIN","PLAZA_OCTAGON","PLAZA_TILE_01","PLAZA_FORUM_INLAY","PLAZA_SEATING_APRON",
                 "COMMUNITY_OPEN_FORUM"):
        exporter.module(name,"plaza" if name.startswith("PLAZA") else "ground",bpy.data.objects["CIVRUM_"+name])
    steps = sorted((o for o in bpy.data.collections["PLAZA"].objects if o.name.startswith("CIVRUM_PLAZA_NEXUS_STEP")),
                   key=lambda o:o.location.z)
    exporter.module("PLAZA_NEXUS_BASE","plaza",steps[0],steps[1:])
    for i,obj in enumerate(steps,1):
        exporter.module(f"PLAZA_NEXUS_STEP_{i:02}","plaza",obj)
    for obj in bpy.data.collections["ENVIRONMENT"].objects:
        if "district" in obj:
            exporter.module(obj.name.removeprefix("CIVRUM_"),"ground",obj)
    items = exporter.items
    bpy.ops.wm.open_mainfile(filepath=str(kit))
    exporter = Exporter(folder)
    for obj in list(bpy.context.scene.objects):
        key = obj["module"]
        if not obj.asset_data or min(obj.preview.image_size)<1:
            raise ValueError(f"Missing Blender road asset or thumbnail: {key}")
        exporter.module(key,"roads",obj,ports=ports[key])
    return items+exporter.items


def check_ports(objects, record):
    # Match actual reimported edge vertices, not just a port declared in JSON.
    surfaces = {}
    for mat in ("MAT_GRAPHITE_GRAY","MAT_CONCRETE_GRAY","MAT_WARM_WHITE"):
        vs = []
        for o in objects:
            for p in o.data.polygons:
                if o.data.materials[p.material_index].name==mat:
                    vs.extend(o.matrix_world @ o.data.vertices[i].co for i in p.vertices)
        surfaces[mat] = vs
    max_gap = 0
    for x,y,angle,width in record["portsXY"]:
        a = math.radians(angle)
        for sign in (-1,1):
            for off,z,mat in ((width/2,base.ROAD_Z,"MAT_GRAPHITE_GRAY"),
                              (width/2+base.WALK,base.WALK_Z,"MAT_CONCRETE_GRAY"),
                              (width/2+.22,base.WALK_Z+.002,"MAT_WARM_WHITE")):
                target = Vector((x-sign*off*math.sin(a),y+sign*off*math.cos(a),z))
                gap = min((point-target).length for point in surfaces[mat])
                if gap>.0001:
                    raise ValueError(f"{record['id']} {mat} port {angle}: {gap:.6f} m")
                max_gap = max(max_gap,gap)
    return max_gap


def verify(folder,items):
    max_gap = 0
    if {p.relative_to(folder).as_posix() for p in folder.rglob("*.glb")}!={i["file"] for i in items}:
        raise ValueError("The catalog and GLB directory contain different files")
    for item in items:
        path = folder/item["file"]
        if hashlib.sha256(path.read_bytes()).hexdigest()!=item["sha256"]:
            raise ValueError(f"Hash mismatch: {path}")
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(path))
        meshes = [o for o in bpy.context.scene.objects if o.type=="MESH"]
        actual = measures(meshes)
        if actual["materials"]!=item["materials"]:
            raise ValueError(f"{item['id']} triangle/material mismatch: {actual['materials']} vs {item['materials']}")
        error = max(abs(a-b) for p,q in zip(actual["bounds"],item["bounds"]) for a,b in zip(p,q))
        if error>.001:
            raise ValueError(f"{item['id']} bounds changed by {error:.6f} m")
        if "portsXY" in item:
            max_gap = max(max_gap,check_ports(meshes,item))
        lo,hi = actual["bounds"]
        size = [b-a for a,b in zip(lo,hi)]
        # Nominal pitch includes intentional joints between paving slabs and scaffold uprights.
        pitches = {"CONSTRUCTION_FOUNDATION_01":((0,6),(1,4)), "CONSTRUCTION_FENCE_01":((0,4),),
                   "CONSTRUCTION_SCAFFOLD_01":((2,2.4),), "CONSTRUCTION_PRECAST_01":((2,.75),),
                   "GREEN_LAWN_01":((0,12),(1,8)), "PLAZA_TILE_01":((0,9.96),(1,9.96))}
        for axis,expected in pitches.get(item["id"],()):
            if abs(size[axis]-expected)>.001:
                raise ValueError(f"{item['id']} pitch mismatch on axis {axis}")
    print(f"PASS: Blender reimported {len(items)} GLBs; material triangle counts and bounds match; "
          f"maximum port error {max_gap*1000:.5f} mm")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root",type=Path,default=base.ROOT)
    parser.add_argument("--check",action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    root = args.output_root.resolve()
    target,kit = root/"exports", root/"blender"/ROAD_LIBRARY
    if args.check:
        verify(target,json.loads((target/"catalog.json").read_text(encoding="utf-8"))["assets"])
        return
    if target.exists() or kit.exists():
        raise FileExistsError("Choose a fresh --output-root to preserve existing exports and road library")
    root.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=root,prefix=".civrum-export-") as tmp:
        staging = Path(tmp)
        ports = make_road_library(staging/ROAD_LIBRARY)
        items = export_assets(staging/"exports",staging/ROAD_LIBRARY,ports)
        verify(staging/"exports",items)
        palette = {"MAT_"+name: {"sRGB":hex_color,"metalness":metal,"roughness":rough}
                   for name,hex_color,metal,rough in detail.PALETTE}
        catalog = {"version":1,"unit":"metre","boundsAxes":"Blender XYZ (+Z up)","palette":palette,
                   "portsXY":"[x, y, outward degrees from +X, carriageway width], Blender ground plane",
                   "assets":items}
        (staging/"exports"/"catalog.json").write_text(json.dumps(catalog,indent=2)+"\n",encoding="utf-8")
        kit.parent.mkdir(parents=True,exist_ok=True)
        (staging/ROAD_LIBRARY).rename(kit)
        (staging/"exports").rename(target)


if __name__=="__main__":
    main()
