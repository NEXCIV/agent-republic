"""Build the four independent Blender landmark slots on a copy of the refined city."""

import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_world import Geometry, circle

COLLECTION = "03_Hero_Landmarks"
ROOT = Path(__file__).resolve().parents[1]
TRIPO = ROOT / "art-direction/tripo"


def collection(name, parent="CIVRUM_WORLD"):
    target = bpy.data.collections.new(name)
    bpy.data.collections[parent].children.link(target)
    return target


def move(obj, target):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    target.objects.link(obj)


def ends(points):
    return [Vector([op(p[i] for p in points) for i in range(3)]) for op in (min, max)]


def vec(v):
    return [round(float(x), 5) for x in v]


def support(obj_name, x, y):
    obj = bpy.data.objects[obj_name]
    inv = obj.matrix_world.inverted()
    hit, point, _, _ = obj.ray_cast(inv @ Vector((x, y, 100)), Vector((0, 0, -1)))
    if not hit:
        raise ValueError(f"No pavement under {(x, y)} in {obj_name}")
    return (obj.matrix_world @ point).z


def source_mesh(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = set(bpy.data.objects) - before
    meshes = sorted((o for o in imported if o.type == "MESH"), key=lambda o: o.name)
    bpy.ops.object.select_all(action="DESELECT")
    # Blender join preserves UVs and material indices for future textured replacements.
    for obj in meshes:
        matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = matrix
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.data = obj.data.copy() if obj.data.users > 1 else obj.data
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    for empty in [o for o in list(bpy.data.objects) if o in imported and o != obj]:
        bpy.data.objects.remove(empty, do_unlink=True)
    return obj


def fit(obj, source_front, world_front, width, anchor):
    """Source front is Blender XY after import. Width is perpendicular to the entrance."""
    target_angle = math.atan2(world_front[1], world_front[0])
    source_angle = math.atan2(source_front[1], source_front[0])
    obj.data.transform(Matrix.Rotation(target_angle - source_angle, 4, 'Z'))
    across = Vector((-world_front[1], world_front[0], 0))
    xs = [v.co.dot(across) for v in obj.data.vertices]
    ratio = width / (max(xs) - min(xs))
    obj.data.transform(Matrix.Scale(ratio, 4))
    lo, hi = ends([v.co for v in obj.data.vertices])
    obj.data.transform(Matrix.Translation(-Vector(((lo.x + hi.x)/2, (lo.y + hi.y)/2, lo.z))))
    obj.data.update()
    obj.location = anchor
    bpy.context.view_layer.update()


def governance():
    # A replaceable civic hall massing, with a ribbed cupola, deep portico and two wings.
    g = Geometry()
    g.box(0, 0, 0, 33, 19, .45, 4, .75)
    for x in (-11.8, 11.8):
        g.box(x, .75, .45, 8.25, 15, 6.5, 5, .48)
        g.box(x, .75, 6.95, 8.6, 15.4, .42, 4, .50)
        for dx in (-2.4, 0, 2.4):
            g.box(x+dx, -6.80, 1.1, 1.75, .10, 4.45, 3, .03)
    g.box(0, .6, .45, 17, 15.6, 8, 5, .65)
    g.box(0, -7.35, 1, 13, .3, 5.95, 3, .06)
    for x in (-6.3, -2.1, 2.1, 6.3):
        g.box(x, -8.25, .45, .72, .85, 6.6, 5, .12)
    g.box(0, -7.94, 7.05, 15.5, 2.8, .65, 4, .25)
    g.slab(circle(8.05, 40, 0, .7), 8.2, 8.8, 4)
    rings = [(8*math.cos(i*math.pi/16), 8.8+4.65*math.sin(i*math.pi/16)) for i in range(8)]
    for (r1,z1),(r2,z2) in zip(rings,rings[1:]):
        g.loft(circle(r1,40,0,.7), circle(r2,40,0,.7), z1,z2,3)
    g.slab(circle(1.58,32,0,.7),13.34,13.68,5)
    from detail_civrum_world import rod
    for i in range(16):
        a = i*math.tau/16
        for (r1,z1),(r2,z2) in zip(rings,rings[1:]):
            rod(g,(r1*math.cos(a),.7+r1*math.sin(a),z1),
                (r2*math.cos(a),.7+r2*math.sin(a),z2),.07,5,sides=6)
    obj = bpy.data.objects.new("Governance mass", g.mesh("Governance dome and portico"))
    bpy.context.scene.collection.objects.link(obj)
    return obj


def measure(obj):
    vertices = [obj.matrix_world @ v.co for v in obj.data.vertices]
    lo, hi = ends(vertices)
    base = ends([p for p in vertices if p.z <= lo.z+.35])
    return dict(aabb_world_m=[vec(lo),vec(hi)], dimensions_world_xyz_m=vec(hi-lo),
                base_band_world_xy_m=[vec(p)[:2] for p in base])


def build(out, registry):
    archive = collection("Legacy_Replaced_Massing")
    for stem in ("GOVERNANCE_HALL", "GOVERNANCE_FASCIA", "RESEARCH_CENTER",
                 "RESEARCH_FASCIA", "BUILD_WORKSHOP", "WORKSHOP_FASCIA"):
        move(bpy.data.objects["CIVRUM_PH_"+stem], archive)
    archive.hide_render = archive.hide_viewport = True
    target = collection(COLLECTION)
    rows = [
        ("HERO_01_Governance_Hall", None, (0,-1), (0,-1), 33, (0,95), "CIVRUM_LOT_GOVERNANCE"),
        ("HERO_02_Agent_Center", TRIPO/"agent-center-v3/benchmark/CIVRUM_Agent_Center_Street.glb",
         (0,1), (1,0), 7, (-95,65), "CIVRUM_LOT_RESEARCH"),
        ("HERO_03_Citizen_Registration", registry, (0,-1), (0,-1), 13, (80,21), "CIVRUM_PAVED_FORECOURT.001"),
        ("HERO_04_Public_Construction", TRIPO/"construction-center-v1/public construction center 3d model.glb",
         (0,-1), (0,1), 23, (95,-82), "CIVRUM_LOT_CONSTRUCTION")]
    slots = []
    ceramic = bpy.data.materials["MAT_WARM_WHITE"]
    shade = bpy.data.materials["MAT_CONCRETE_GRAY"]
    for name, path, source_front, front, width, xy, ground in rows:
        anchor = (*xy,support(ground,*xy))
        obj = source_mesh(path) if path else governance()
        for i, mat in enumerate(list(obj.data.materials)):
            dark = mat and any(k in mat.name.lower() for k in ("glass","window","graphite","metallic"))
            obj.data.materials[i] = shade if dark else ceramic
        if not len(obj.data.materials):
            obj.data.materials.append(ceramic)
        # Collapse duplicate clay slots while retaining the two material assignments.
        assignments = [obj.data.materials[p.material_index] == shade for p in obj.data.polygons]
        obj.data.materials.clear()
        obj.data.materials.append(ceramic)
        if any(assignments):
            obj.data.materials.append(shade)
            for p, dark in zip(obj.data.polygons, assignments):
                p.material_index = int(dark)
        obj.name = name
        move(obj, target)
        fit(obj, source_front, front, width, anchor)
        obj["entrance_world_xy"] = list(front)
        obj["replaceable_landmark"] = True
        slots.append(dict(name=name, anchor_world_m=vec(anchor), entrance_world_xy=front,
                          yaw_deg_from_south_ccw=(math.degrees(math.atan2(front[0],-front[1]))%360),
                          width_across_entrance_m=width, support_object=ground,
                          clay_source=path.name if path else "CIVRUM original dome and portico blockout",
                          source_front_blender_xy=source_front,
                          source_sha256=hashlib.sha256(path.read_bytes()).hexdigest() if path else None,
                          **measure(obj)))
    manifest = dict(version=1, collection=COLLECTION, coordinates="Blender world XYZ in metres, Z up, +Y north",
                    anchor="World horizontal bounding-box centre at the lowest mesh vertex; local base Z = 0",
                    fit="Rotate the imported entrance to entrance_world_xy, uniformly fit width across entrance, then centre bottom. Recheck height and overhang against bounds.",
                    base_band="XY bounds of vertices in the lowest 0.35 m; includes steps and plinth if present",
                    landmarks=slots)
    out.mkdir(parents=True,exist_ok=True)
    (out/"landmarks_manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf8")
    return slots
