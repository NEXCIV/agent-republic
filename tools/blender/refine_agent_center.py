"""Refine the Tripo Agent Center for the District 01 street benchmark."""

import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmarks import box, make_mat, srgb


STONE, GLASS, PLUM, GOLD, BRONZE, ROOF, LEAF, LIGHT, IVORY = range(9)
# Source geometry faces -Y in Blender. The benchmark root rotates it toward
# -Z in glTF, the direction of the P12 approach to CORE in District 01.
CORE_WIDTH = 7.0
HORIZONTAL_SCALE = CORE_WIDTH / 0.9995118379592896
SOURCE_LEVELS = np.array([0, .018, .041, .165, .195, .255, .518, .625, .765])
WORLD_LEVELS = np.array([0, .09, .25, 2.57, 2.76, 3.22, 5.03, 5.77, 6.75])


def options():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("references", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--font", type=Path, required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def world_z(values):
    return np.interp(values, SOURCE_LEVELS, WORLD_LEVELS)


def make_materials():
    return [
        make_mat("Cream limestone", srgb("#D3B99A"), .025, .68),
        make_mat("Blue-green glazing", srgb("#20515B"), .29, .27),
        make_mat("Plum painted cladding", srgb("#77496E"), .16, .48),
        make_mat("Transit gold", srgb("#EBA124"), .45, .34),
        make_mat("Bronze window trim", srgb("#98704A"), .48, .40),
        make_mat("Dome and roof equipment", srgb("#6F605D"), .47, .45),
        make_mat("Terrace evergreen", srgb("#627534"), .0, .84),
        make_mat("Warm entrance lights", srgb("#FFD79B"), .04, .37, srgb("#FFB55D"), 1.05),
        make_mat("Ivory sign graphics", srgb("#F5E1B6"), .05, .49),
    ]


def get_reference(path):
    img = bpy.data.images.load(str(path))
    img.colorspace_settings.name = "Non-Color"
    width, height = img.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    img.pixels.foreach_get(pixels)
    bpy.data.images.remove(img)
    return pixels.reshape(height, width, 4)[::-1, :, :3]


def pixel_votes(rgb):
    red, green, blue = rgb.T
    label = np.full(len(rgb), STONE, dtype=np.int8)
    label[(green > red * 1.16) & (blue > red * 1.15)] = GLASS
    label[(red > green * 1.115) & (blue > green * 1.10)] = PLUM
    label[(red > green * 1.20) & (green > blue * 1.36) & (red > .50)] = GOLD
    label[(red > green * 1.17) & (green > blue * 1.14) & (red < .57)] = BRONZE
    label[(green > red * .85) & (green > blue * 1.55) & (red < .60)] = LEAF
    label[(red > .86) & (green > .64) & (blue < .52) & (green > red * .64)] = GOLD
    weight = np.where(np.min(rgb, axis=-1) > .91, 0.0, 1.0)
    return label, weight


def geometry(mesh_obj):
    mesh = mesh_obj.data
    points = np.array([tuple(mesh_obj.matrix_world @ v.co) for v in mesh.vertices])
    mesh.calc_loop_triangles()
    triangles = np.array([tuple(t.vertices) for t in mesh.loop_triangles])
    if len(triangles) != len(mesh.polygons):
        raise ValueError("Expected the triangled Tripo export")
    return points, triangles


def islands(vertex_count, triangles):
    parents = np.arange(vertex_count)
    def representative(value):
        while parents[value] != value:
            parents[value] = parents[parents[value]]
            value = parents[value]
        return value
    for a, b, c in triangles:
        first = representative(a)
        parents[representative(b)] = first
        parents[representative(c)] = first
    return np.array([representative(a) for a in triangles[:, 0]])


def surface_finishes(points, triangles, refs):
    # These calibration points come from matching the Tripo mesh to the three v3 elevations.
    # Faces hidden in an elevation get their finish from their geometry or adjacent shell.
    sample = points[triangles]
    mid = sample.mean(axis=1)
    normals = np.cross(sample[:, 1] - sample[:, 0], sample[:, 2] - sample[:, 0])
    normals /= np.maximum(1e-12, np.linalg.norm(normals, axis=1, keepdims=True))
    x, y, z = mid.T
    bvh = BVHTree.FromPolygons(points.tolist(), triangles.tolist(), all_triangles=True)
    votes = np.zeros((len(mid), 9), dtype=np.float32)
    votes[:, STONE] = .08
    levels = [0, .041, .150, .165, .200, .257, .450, .493, .518, .541, .625, .765]
    image_y = np.interp(z, levels, [989, 940, 790, 770, 723, 625, 415, 350, 296, 275, 202, 20])

    views = [
        ("01-front.png", (0, -1, 0), 768 + 1374 * x),
        ("02-pipe-side.png", (-1, 0, 0), 731 - 1190 * y),
        ("03-back.png", (0, 1, 0), 785 - 1327 * x),
        # Opposite side has no drawing. Project broad finishes from the pipe-side
        # elevation at a lower weight and preserve the actual geometry.
        ("02-pipe-side.png", (1, 0, 0), 731 - 1190 * y),
    ]
    for filename, xyz, image_x in views:
        direction = Vector(xyz)
        facing = normals @ np.array(xyz)
        indices = np.flatnonzero(facing > .20)
        visible = []
        for i in indices:
            # Query the frontmost surface, ignoring the material of occluders
            # such as the projecting sign, planter and pipes.
            center = Vector(mid[i])
            hit, _, _, dist = bvh.ray_cast(center + 1.4 * direction, -direction, 1.42)
            if hit is not None and abs(dist - 1.4) < .007:
                visible.append(i)
        ids = np.array(visible, dtype=int)
        rgb = get_reference(refs / filename)
        u = np.clip(np.rint(image_x[ids]).astype(int), 2, rgb.shape[1] - 3)
        v = np.clip(np.rint(image_y[ids]).astype(int), 2, rgb.shape[0] - 3)
        for a, b in [(0, 0), (-2, 0), (2, 0), (0, -2), (0, 2)]:
            label, weight = pixel_votes(rgb[v + b, u + a])
            if xyz[0] == 1:
                weight *= .50
                weight[(label == GOLD) | (label == LEAF)] = 0
            votes[ids, label] += np.square(facing[ids]) * weight
    label = votes.argmax(axis=1)
    grouped = islands(len(points), triangles)
    pipe_faces = np.zeros(len(mid), dtype=bool)

    for group in np.unique(grouped):
        ids = np.flatnonzero(grouped == group)
        vertices = points[np.unique(triangles[ids])]
        lo, hi = vertices.min(0), vertices.max(0)
        dx, dy, dz = hi - lo
        cx, cy, cz = (lo + hi) * .5

        # Material boundaries on high-value silhouette parts use mesh bounds to
        # survive occlusion by the front canopy and small window mullions.
        if len(ids) > 6000:
            r = np.hypot(x[ids] - .013, y[ids] - .014)
            tz = z[ids]
            result = label[ids].copy()
            glazed_drum = (tz > .185) & (tz < .493) & (r > .146)
            result[glazed_drum] = GLASS
            horizontal = np.min(np.abs(tz[:, None] - np.array([.294, .350, .398, .458, .483])), axis=1)
            narrow = np.ptp(sample[ids, :, 2], axis=1) < .010
            result[glazed_drum & (r > .2026) & narrow & (horizontal < .0036)] = BRONZE
            result[(tz >= .492) & (tz < .518)] = GOLD
            result[(tz >= .518) & (tz < .540)] = PLUM
            result[tz >= .540] = ROOF
            result[tz >= .632] = BRONZE
            label[ids] = result
        elif cx < -.407 and cz < .185 and dz > .190:
            label[ids] = GOLD  # Three pipes preserved from the generated mesh.
            pipe_faces[ids] = True
        elif cx < -.233 and cz > .525 and dx > .105:
            label[ids] = ROOF  # Dish.
        elif -.354 < cx < -.267 and -.127 < cy < -.025 and .500 < cz < .561:
            label[ids] = ROOF  # Dish bracket and pedestal.
        elif cx > .215 and .450 < cz < .534 and min(dx, dy, dz) > .060:
            label[ids] = GOLD  # Orb.
        elif .406 < cz < .471 and cy < -.064 and dx > .35:
            label[ids] = GOLD  # Front orbit beam.
        elif dx > .85 and cz < .12 and hi[2] < .24:
            label[ids] = STONE  # Continuous lower masonry shell.
        elif cy < -.310 and dx > .330 and cz > .185 and dz < .115:
            label[ids] = PLUM  # Main sign.
        elif cy < -.195 and dx > .375 and .188 < cz < .239 and dz < .048:
            label[ids] = PLUM  # Front canopy.
        elif cx > .30 and .411 < cz < .490 and cy > .036 and .046 < min(dx, dy, dz) < .141:
            label[ids] = ROOF  # Roof ventilation cabinet.
        elif .022 < min(dx, dy) < .078 and dz < .048 and ((cz > .376 and len(ids) > 250) or (cz < .09 and cy < -.16 and len(ids) > 450)):
            label[ids] = LEAF  # Planter crowns.
        elif min(dx, dy, dz) < .0045 and max(dx, dy) > .065 and cz > .20:
            label[ids] = BRONZE  # Rail profiles.
        elif len(ids) < 125:
            total = votes[ids].sum(axis=0)
            if total.max() > len(ids) * .26:
                label[ids] = total.argmax()

    # Do not let a projected window colour bleed into adjacent wide, bevelled wall strips.
    wing = (np.abs(x - .013) > .217)
    low = z < .176
    zmin = sample[:,:,2].min(axis=1)
    zmax = sample[:,:,2].max(axis=1)
    band = (zmin > .161) & (zmax < .197) & wing & ~pipe_faces
    label[band] = PLUM
    face_height = np.ptp(sample[:, :, 2], axis=1)
    facades = wing & (z > .196) & (z < .446)
    guessed_gold = facades & (label == GOLD) & (np.abs(x) < .409)
    label[guessed_gold] = BRONZE
    # The wall/window boundary of the pipe wing is especially easy to see in
    # the source because each storey has a horizontal masonry moulding.
    pipe_wall = (x < -.328) & (y > -.174) & (y < .151) & (z > .198) & (z < .419)
    inside_windows = np.zeros(len(z), dtype=bool)
    for lo, hi in [(.211,.263), (.278,.319), (.347,.390)]:
        inside_windows |= (zmin > lo) & (zmax < hi)
    frame = pipe_wall & ~inside_windows & ((label == GLASS) | (label == BRONZE))
    label[frame] = STONE
    label[pipe_wall & inside_windows & (label == STONE) & (np.abs(normals[:,0]) > .75)] = GLASS
    label[facades & (face_height > .065) & (label == BRONZE)] = STONE
    label[low & (label == GLASS) & (np.abs(normals[:,2]) > .45)] = STONE
    lower_window_plane = (np.abs(sample[:,:,1] + .173).max(axis=1) < .0041)
    lower_windows = (lower_window_plane & (np.abs(x) > .168) & (np.abs(x) < .435)
        & (zmin >= .034) & (zmax <= .152) & ~pipe_faces)
    label[lower_windows] = GLASS
    dish_pavilion = (x < -.219) & (x > -.353) & (z > .429) & (z < .490) & (y < -.020)
    label[dish_pavilion & (label == GLASS) & (np.abs(normals[:,2]) > .25)] = PLUM
    cabinet = (x > .333) & (x < .427) & (y > .059) & (y < .195) & (z > .406) & (z < .505)
    label[cabinet & (label != LEAF)] = ROOF
    label[pipe_faces] = GOLD
    # Dome glazing and edge frames can be repainted independently of the
    # white building shell that interfaced with the original dome.
    radial = np.hypot(x - .013, y - .014)
    label[(z > .538) & (z < .625) & (radial < .188)] = ROOF
    label[z < .013] = STONE
    return label


def rebuild_opening(root, bvh, mats):
    # Use the depth of the exported vestibule. New frames sit on that same
    # frontage, leaving the steps and the canopy supports from the source.
    def surface_y(raw_x, raw_z):
        hit, _, _, _ = bvh.ray_cast(Vector((raw_x, -2, raw_z)), Vector((0, 1, 0)), 2.20)
        if hit is None:
            raise ValueError("Missing vestibule behind the selected entrance")
        return hit.y * HORIZONTAL_SCALE

    x_center = .010 * HORIZONTAL_SCALE
    sill = float(world_z(.040))
    top = 2.30
    height = top - sill
    wall_y = surface_y(.010, .098)
    y = wall_y - .021
    width = 1.71
    def detail(name, dims, loc, material):
        return box(name, dims, loc, material, root)
    for direction in (-1, 1):
        x = x_center + direction * .410
        detail("Entrance dark glazing", (.786, .046, height-.092), (x, y, (sill+top)/2), mats[GLASS])
        detail("Vertical door stile", (.038, .063, height-.06), (x_center + direction*.808, y-.008, (sill+top)/2), mats[BRONZE])
        detail("Door pull", (.031, .052, .283), (x_center + direction*.104, y-.042, sill+1.10), mats[GOLD])
    detail("Meeting stile", (.049, .067, height-.054), (x_center, y-.009, (sill+top)*.5), mats[BRONZE])
    for level in (sill+.021, top-.030):
        detail("Door horizontal rail", (width, .070, .054), (x_center, y-.010, level), mats[BRONZE])
    for lower, upper in [(-.360, -.176), (.171, .412)]:
        a, b = lower*HORIZONTAL_SCALE, upper*HORIZONTAL_SCALE
        base, cap = world_z(.038), world_z(.147)
        # Cover the broken Tripo mullion fragments while keeping glazing
        # recessed behind the stone opening at about -0.194 source units.
        face_y = -.190*HORIZONTAL_SCALE
        detail("Recessed storefront glazing", (b-a, .015, cap-base), ((a+b)*.5,face_y,(base+cap)*.5),mats[GLASS])
        for x in np.linspace(a, b, 5):
            detail("Storefront vertical mullion", (.023,.024,cap-base), (x,face_y-.016,(base+cap)*.5),mats[BRONZE])
        for h in (base+.013,(base+cap)*.5,cap-.013):
            detail("Storefront horizontal mullion", (b-a,.025,.023), ((a+b)*.5,face_y-.016,h),mats[BRONZE])
    for dx in (-.88, -.44, 0, .44, .88):
        # The canopy extends in front of both the back wall and the new door.
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=.041, depth=.013, location=(x_center+dx, -1.93, 2.56))
        fixture = bpy.context.object
        fixture.name = "Recessed canopy light"
        fixture.data.materials.append(mats[LIGHT])
        fixture.parent = root
    return {"height_m": round(height, 3), "width_m": width, "threshold_m": round(sill, 3)}


def lettering(root, mats, font_path):
    sign_y = -2.466
    sign_z = 2.955
    font = bpy.data.fonts.load(str(font_path))
    bpy.ops.object.text_add(location=(-.666, sign_y, sign_z), rotation=(math.pi/2, 0, 0))
    text = bpy.context.object
    text.name = "Agent center sign lettering"
    text.data.body = "Agent 中心"
    text.data.font = font
    text.data.align_x = "LEFT"
    text.data.align_y = "CENTER"
    text.data.resolution_u = 4
    text.data.extrude = .003
    text.data.materials.append(mats[IVORY])
    bpy.context.view_layer.update()
    text.scale = (1.52 / text.dimensions.x,) * 3
    bpy.ops.object.convert(target="MESH")
    bpy.context.object.parent = root

    # Original robot pictogram built from a beveled faceplate and two sockets.
    face = box("Robot sign pictogram", (.321, .014, .190), (-.935, sign_y-.008, sign_z), mats[IVORY], root)
    bevel = face.modifiers.new("Rounded corners", "BEVEL")
    bevel.width = .013
    bevel.segments = 3
    for dx in (-.077,.077):
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=.022, depth=.006,
            location=(-.935+dx, sign_y-.020, sign_z+.010), rotation=(math.pi/2, 0, 0))
        eye = bpy.context.object
        eye.name = "Robot sign lens"
        eye.data.materials.append(mats[PLUM])
        eye.parent = root
    box("Robot sign antenna", (.023, .013, .066), (-.935,sign_y-.012,sign_z+.115), mats[IVORY], root)


def apply_preview(s):
    s.unit_settings.system = "METRIC"
    s.unit_settings.scale_length = 1.0
    s.world = bpy.data.worlds.new("Review studio")
    s.world.color = (.14,.18,.22)
    s.render.engine = "BLENDER_WORKBENCH"
    shading = s.display.shading
    shading.light = "STUDIO"
    shading.studio_light = "paint.sl"
    shading.color_type = "MATERIAL"
    shading.background_type = "WORLD"
    shading.show_shadows = False
    shading.show_cavity = True
    shading.cavity_type = "BOTH"
    shading.curvature_ridge_factor = .65
    shading.curvature_valley_factor = .60
    s.view_settings.view_transform = "Standard"
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.overlay.show_overlays = False
                space.shading.color_type = "MATERIAL"
                space.region_3d.view_distance = 17.0
                space.region_3d.view_location = (0,0,4.55)
                space.region_3d.view_rotation = Vector((-4, -13, -5)).to_track_quat("-Z", "Y")


def triangle_count(mesh):
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def main():
    args = options()
    args.output.mkdir(parents=True, exist_ok=True)
    if not args.font.is_file():
        raise ValueError("Provide a font that supports the two Chinese characters on the sign")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.source))
    building, = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    points, tris = geometry(building)
    labels = surface_finishes(points, tris, args.references)
    bvh = BVHTree.FromPolygons(points.tolist(), tris.tolist(), all_triangles=True)

    scene = bpy.context.scene
    root = bpy.data.objects.new("CIVRUM_Agent_Center", None)
    root["source"] = args.source.name
    root["orientation"] = "-Z in glTF faces the plaza"
    scene.collection.objects.link(root)
    original_parent = building.parent
    building.parent = root
    building.name = "Agent_Center_Shell"
    if original_parent is not None:
        bpy.data.objects.remove(original_parent, do_unlink=True)

    material_list = make_materials()
    building.data.materials.clear()
    for material in material_list:
        building.data.materials.append(material)
    for p, label in zip(building.data.polygons, labels):
        p.material_index = int(label)
    # Reduce density before reshaping the floors, retaining the authored roof,
    # plaques, rails and isolated props. Keep the source file separately.
    bpy.context.view_layer.objects.active = building
    bpy.ops.object.select_all(action="DESELECT")
    building.select_set(True)
    simplify = building.modifiers.new("Street benchmark triangle budget", "DECIMATE")
    simplify.ratio = .685
    simplify.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=simplify.name)
    for vert in building.data.vertices:
        x,y,z = vert.co
        vert.co = (x*HORIZONTAL_SCALE, y*HORIZONTAL_SCALE, world_z(z))
    building.data.update()
    portal = rebuild_opening(root, bvh, material_list)
    lettering(root, material_list, args.font)
    root.rotation_euler.z = math.pi
    apply_preview(scene)
    bpy.ops.object.select_all(action="DESELECT")
    building.select_set(True)
    bpy.context.view_layer.objects.active = building

    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output/"CIVRUM_Agent_Center_Street.blend"), compress=True)
    shell_triangles = triangle_count(building.data)
    # Keep the .blend parts editable. Batch static faces by material in the
    # GLB so repeated windows and fixtures do not add one draw call apiece.
    for ob in (obj for obj in scene.objects if obj.type == "MESH"):
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        for modifier in list(ob.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.context.view_layer.objects.active = building
    bpy.ops.object.join()
    bpy.ops.export_scene.gltf(filepath=str(args.output/"CIVRUM_Agent_Center_Street.glb"), export_format="GLB",
        export_cameras=False, export_lights=False, export_animations=False, export_extras=True)
    print("BENCHMARK", json.dumps({"input_triangles":len(tris), "shell_triangles":shell_triangles,
        "export_triangles":triangle_count(building.data),
        "entry":portal, "palette_faces":{m.name:int(c) for m,c in zip(material_list, np.bincount(labels,minlength=9))}}),flush=True)

    camdata = bpy.data.cameras.new("Review camera")
    cam = bpy.data.objects.new("Review camera",camdata)
    scene.collection.objects.link(cam)
    scene.camera = cam
    camdata.lens = 44
    scene.render.resolution_x = 1080
    scene.render.resolution_y = 810
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    for name, eye, focus in [
        ("Front", (0,14,3.25), (0,0,3.25)),
        ("Street", (7.3,13.9,2.45), (0,0,3.10)),
        ("Rear", (-7.5,-13.7,6.2), (0,0,3.40)),
    ]:
        cam.location=eye
        cam.rotation_euler=(Vector(focus)-cam.location).to_track_quat("-Z","Y").to_euler()
        scene.render.filepath=str(args.output/f"Review_{name}.png")
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
