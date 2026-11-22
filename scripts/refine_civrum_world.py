"""Refine the existing CIVRUM environment without replacing approved source files.

E6-07: softer vegetation, manufactured edges, human-scale paving and daylight.
The main building meshes remain replaceable blockout assets.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_civrum_world as base
import detail_civrum_world as detail
from build_civrum_world import Geometry, rectangle, BLACK, CONCRETE, GRAPHITE, METAL, WHITE

DEFAULT_ROOT = base.ROOT / "art-direction" / "refined"


def replace_mesh(old, new):
    name = old.name
    for key in old.keys():
        new[key] = old[key]
    for obj in list(bpy.data.objects):
        if obj.type == "MESH" and obj.data == old:
            obj.data = new
    bpy.data.meshes.remove(old)
    new.name = name
    return new


def manufactured_edges(mesh, width, segments=3):
    """Bake edge radii and weighted corner normals once per shared mesh."""
    import bmesh

    scratch = bpy.data.objects.new("REFINEMENT_TEMP", mesh.copy())
    bpy.context.scene.collection.objects.link(scratch)
    for poly in scratch.data.polygons:
        poly.use_smooth = True
    scratch.data.set_sharp_from_angle(angle=math.radians(42))
    bevel = scratch.modifiers.new("Manufactured edge radius", "BEVEL")
    bevel.width, bevel.segments = width, segments
    bevel.limit_method, bevel.angle_limit = "ANGLE", math.radians(38)
    bevel.use_clamp_overlap, bevel.harden_normals = True, True
    deps = bpy.context.evaluated_depsgraph_get()
    bevelled = bpy.data.meshes.new_from_object(scratch.evaluated_get(deps), depsgraph=deps)
    # Clamped bevels can collapse a corner of thin trim to a zero-area face.
    # Clean only sub-micrometre edges; preserve separate shells and open signage.
    bm = bmesh.new()
    bm.from_mesh(bevelled)
    bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=.000001)
    dead = [face for face in bm.faces if face.calc_area() <= 1e-8]
    if dead:
        bmesh.ops.delete(bm, geom=dead, context="FACES_ONLY")
    bm.to_mesh(bevelled)
    # A nonzero n-gon can still contain a collapsed triangle at a clamped corner.
    # Triangulate only those exceptional faces, leaving editable quads elsewhere.
    bevelled.calc_loop_triangles()
    invalid = {tri.polygon_index for tri in bevelled.loop_triangles if tri.area <= 1e-8}
    if invalid:
        bm.faces.ensure_lookup_table()
        bmesh.ops.triangulate(bm, faces=[bm.faces[i] for i in invalid])
        dead = [face for face in bm.faces if face.calc_area() <= 1e-8]
        if dead:
            bmesh.ops.delete(bm, geom=dead, context="FACES_ONLY")
    loose = [edge for edge in bm.edges if not edge.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="EDGES")
    loose = [vert for vert in bm.verts if not vert.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(bevelled)
    bm.free()
    temp = scratch.data
    scratch.modifiers.clear()
    scratch.data = bevelled
    for poly in bevelled.polygons:
        poly.use_smooth = True
    bevelled.set_sharp_from_angle(angle=math.radians(42))
    normals = scratch.modifiers.new("Area weighted normals", "WEIGHTED_NORMAL")
    normals.keep_sharp, normals.weight = True, 50
    deps.update()
    new = bpy.data.meshes.new_from_object(scratch.evaluated_get(deps), depsgraph=deps)
    # Very small valid bevel faces can still acquire a zero weighted corner.
    # Retain good weighted normals and use the geometric normal only at that corner.
    corners = [n.vector.copy() for n in new.corner_normals]
    for poly in new.polygons:
        for idx in poly.loop_indices:
            normal = corners[idx]
            if not all(math.isfinite(v) for v in normal) or normal.length_squared < .5:
                normal = poly.normal.copy()
            if normal.length_squared < .5:
                raise ValueError(f"Invalid geometric normal after bevel cleanup: {mesh.name}")
            corners[idx] = normal.normalized()
    new.normals_split_custom_set(corners)
    new.calc_loop_triangles()
    if any(tri.area <= 1e-10 for tri in new.loop_triangles):
        raise ValueError(f"Degenerate triangle after bevel cleanup: {mesh.name}")
    bpy.data.objects.remove(scratch, do_unlink=True)
    bpy.data.meshes.remove(temp)
    bpy.data.meshes.remove(bevelled)
    return replace_mesh(mesh, new)


def refine_modules():
    from civrum_refined_props import build_props
    from civrum_refined_vegetation import build_vegetation
    geometries = {**build_props(), **build_vegetation()}
    for key, geom in geometries.items():
        old = bpy.data.meshes["CIVRUM_MODULE_" + key]
        mesh = replace_mesh(old, geom.mesh("REFINED_" + key, detail.PALETTE))
        if key.startswith(("TREE_", "SHRUB_")):
            # The canopy needs continuous light across each connected lobe.
            for p in mesh.polygons:
                p.use_smooth = mesh.materials[p.material_index].name.startswith("MAT_LEAF_")
            mesh.set_sharp_from_angle(angle=math.radians(65))
            soft = [n.vector.copy() for n in mesh.corner_normals]
            for poly in mesh.polygons:
                for idx in poly.loop_indices:
                    soft[idx] = (soft[idx]*.45 + poly.normal*.55).normalized() if poly.use_smooth else poly.normal
            mesh.normals_split_custom_set(soft)
    for mesh in list(bpy.data.meshes):
        if not mesh.users:
            continue
        key = mesh.get("module", "")
        if key.startswith("PROP_"):
            manufactured_edges(mesh, .024 if "PLANTER" in key else .012, 2)
        elif key.startswith("CONSTRUCTION_"):
            manufactured_edges(mesh, .009, 1)
    # Large forms receive an edge catchlight, retaining their original massing.
    unique = {o.data for o in bpy.data.collections["PLACEHOLDER_BUILDINGS"].all_objects if o.type == "MESH"}
    for mesh in unique:
        manufactured_edges(mesh, .065, 2)


def paving():
    """Real 1.25 m stone modules with 8 mm joints; no painted oversized grid."""
    g = Geometry()
    g.box(0, 0, 0, 9.96, 9.96, .017, METAL)
    for row in range(8):
        for col in range(8):
            x, y = (col - 3.5) * 1.245, (row - 3.5) * 1.245
            g.box(x, y, .017, 1.237, 1.237, .008, CONCRETE)
    old = next(m for m in bpy.data.meshes if m.name == "PLAZA_TILE_10m_pitch")
    manufactured_edges(replace_mesh(old, g.mesh("REFINED_PLAZA")), .0025, 1)

    g = Geometry()
    w, d = 19.75, 25.5
    g.box(0, 0, 0, w, d, .150, METAL)
    rows = 25
    for row in range(rows):
        y = -d/2 + (row+.5)*d/rows
        step = w/16
        cuts = [-w/2] + [-w/2 + step*(j+.5*(row%2)) for j in range(17)
                         if 0 < j+.5*(row%2) < 16] + [w/2]
        for a, b in zip(cuts, cuts[1:]):
            g.box((a+b)/2, y, .150, b-a-.008, d/rows-.008, .008, CONCRETE)
    for row in range(5):
        y = -10+row*5
        g.box(8.85, y, .158, .52, 2.25, .002, METAL)
        for j in range(12):
            g.surface(rectangle(8.85, y-.98+j*.178, .35, .055), .163, GRAPHITE)
    old = bpy.data.meshes["CIVRUM_PRECINCT_PAVING"]
    manufactured_edges(replace_mesh(old, g.mesh("REFINED_FORECOURT")), .0018, 1)
    for mesh in list(bpy.data.meshes):
        if mesh.name.startswith("NEXUS_STEP") and mesh.users:
            manufactured_edges(mesh, .016, 3)


def materials():
    # The six brand colours remain exact; only their physical finish changes.
    finishes = {"OBSIDIAN_BLACK": (.22, .34), "GRAPHITE_GRAY": (.06, .70),
                "TECH_YELLOW": (.30, .32), "METALLIC_GRAY": (.62, .34),
                "CONCRETE_GRAY": (0, .76), "WARM_WHITE": (.03, .53)}
    vegetation = {"LEAF_SAGE": "67894E", "LEAF_TIP": "859E57", "LEAF_SHADE": "466C46",
                  "TURF": "74835C", "PLANTING_SOIL": "4F463A", "BARK": "675547"}
    for name, (metal, rough) in finishes.items():
        bsdf = bpy.data.materials["MAT_"+name].node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Roughness"].default_value = rough
    for name, color in vegetation.items():
        mat = bpy.data.materials["MAT_"+name]
        rgb = [int(color[i:i+2], 16)/255 for i in (0, 2, 4)]
        rgba = tuple(((v+.055)/1.055)**2.4 if v>.04045 else v/12.92 for v in rgb)+(1,)
        mat.diffuse_color = rgba
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = .82


def daylight(scene):
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    scene.cycles.adaptive_threshold = .012
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 4
    scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0
    world = scene.world
    world.node_tree.nodes.clear()
    nodes, links = world.node_tree.nodes, world.node_tree.links
    out = nodes.new("ShaderNodeOutputWorld")
    bg = nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = .065
    sky = nodes.new("ShaderNodeTexSky")
    sky_types = sky.bl_rna.properties["sky_type"].enum_items.keys()
    sky.sky_type = "MULTIPLE_SCATTERING" if "MULTIPLE_SCATTERING" in sky_types else "NISHITA"
    sky.sun_disc = False
    sky.sun_elevation, sky.sun_rotation = math.radians(40), math.radians(225)
    sky.air_density, sky.ozone_density = 1, 1
    setattr(sky, "aerosol_density" if hasattr(sky, "aerosol_density") else "dust_density", .7)
    links.new(sky.outputs[0], bg.inputs["Color"])
    # A brighter visible sky does not wash out the physically lit material surfaces.
    visible = nodes.new("ShaderNodeBackground")
    visible.inputs["Strength"].default_value = .16
    links.new(sky.outputs[0], visible.inputs["Color"])
    mix = nodes.new("ShaderNodeMixShader")
    links.new(nodes.new("ShaderNodeLightPath").outputs["Is Camera Ray"], mix.inputs[0])
    links.new(bg.outputs[0], mix.inputs[1])
    links.new(visible.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs["Surface"])
    sun = bpy.data.objects["CIVRUM_SUN"]
    sun.location = (-65, -78, 91)
    sun.rotation_euler = (-sun.location).to_track_quat("-Z", "Y").to_euler()
    sun.data.energy, sun.data.angle, sun.data.color = 3.2, math.radians(7), (1, .92, .82)
    # Neutral ground reflection fills dark sides without emissive decoration.
    for cam in bpy.data.collections["CAMERAS"].objects:
        cam.data.dof.use_dof = False
    scene.camera = bpy.data.objects["CIVRUM_CAM_CENTRAL_PLAZA"]


def stats(scene):
    objects = [o for o in scene.objects if o.type == "MESH" and
               all(c.name not in {"LIGHTING", "DEBUG_SCALE"} for c in o.users_collection)]
    for mesh in {o.data for o in objects}:
        mesh.calc_loop_triangles()
    modules = {o.data["module"]: o.data for o in objects if "module" in o.data}
    return {"task": "E6-07", "author": "NEXCIV", "variant": "refined",
            "render": {"engine": "Cycles", "resolution": [1920, 1080], "samples": 96},
            "objects": len(objects), "uniqueMeshes": len({o.data for o in objects}),
            "trianglesInstantiated": sum(len(o.data.loop_triangles) for o in objects),
            "moduleTriangles": {key: len(mesh.loop_triangles) for key, mesh in sorted(modules.items())}}


def render_views(root, draft=False):
    scene = bpy.context.scene
    folder = root / "renders"
    folder.mkdir(parents=True, exist_ok=True)
    if draft:
        scene.cycles.samples = 24
        scene.render.resolution_percentage = 67
    frames = ["Central_Plaza", "Street_Detail", "Detail_Study"] if draft else ["World_Overview", "Central_Plaza", "Street_Detail", "Detail_Study"]
    for name in frames:
        if name == "Detail_Study":
            data = bpy.data.cameras.new("Detail study")
            cam = base.put("CAMERAS", "CAM_DETAIL_REVIEW", data, (-5, -4, 5))
            cam.rotation_euler = (Vector((-17, -7, 3.1))-cam.location).to_track_quat("-Z", "Y").to_euler()
            data.lens = 28
            data.dof.use_dof, data.dof.focus_distance, data.dof.aperture_fstop = True, 12.5, 9
        else:
            cam = bpy.data.objects["CIVRUM_CAM_"+name.upper()]
        scene.camera = cam
        scene.render.filepath = str(folder / ("CIVRUM_"+name+("_draft" if draft else "")+".png"))
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=base.ROOT/"blender"/detail.WORLD_FILE)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--render", action="store_true")
    parser.add_argument("--draft", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    root = args.output_root.resolve()
    world, library = (root/"blender"/name for name in (detail.WORLD_FILE, detail.LIBRARY_FILE))
    if args.check:
        detail.check(world, library)
        return
    frames = ["Central_Plaza", "Street_Detail", "Detail_Study"] if args.draft else [
        "World_Overview", "Central_Plaza", "Street_Detail", "Detail_Study"]
    targets = [world, library, root/"refinement.json"]
    if args.render or args.draft:
        targets.extend(root/"renders"/("CIVRUM_"+name+("_draft" if args.draft else "")+".png")
                       for name in frames)
    if any(path.exists() for path in targets):
        raise FileExistsError("Use a fresh --output-root to preserve existing work")
    world.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(args.source.resolve()))
    refine_modules()
    paving()
    materials()
    daylight(bpy.context.scene)
    scene = bpy.context.scene
    scene.name = "CIVRUM • Refined Environment"
    scene["production_stage"] = "E6-07 • Environment refinement"
    scene.render.filepath = "//../renders/CIVRUM_Central_Plaza.png"
    bpy.context.view_layer.update()
    report = stats(scene)
    (root/"refinement.json").write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
    bpy.ops.wm.save_as_mainfile(filepath=str(world), compress=True)
    if args.render or args.draft:
        render_views(root, args.draft)
    if not args.draft:
        detail.write_library(world, library, list(report["moduleTriangles"]))
        detail.check(world, library)
    print("REFINEMENT:", json.dumps(report))


if __name__ == "__main__":
    main()
