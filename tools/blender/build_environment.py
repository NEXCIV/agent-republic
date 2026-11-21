r"""Build the District 01 floating island, entrance bridge, civic plaza and airship.

Run from the repository root:
  & "G:\blender\blender.exe" --background --factory-startup --python tools\blender\build_environment.py
"""
import json
import math
import pathlib
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from floating_island import build_landscape

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "apps" / "web" / "public" / "world" / "district-01" / "v1"
OUT = OUT_DIR / "environment.glb"
BLEND_DIR = ROOT / "tools" / "blends"

# district-01.ts DISTRICT_01_WAYPOINTS (Blender Z-up: glTF x = x, y = -z).
WAYPOINTS = {
    "P0": (0, 0), "P1": (-4, 0), "P2": (4, 0), "P3": (0, 4), "P4": (0, -4),
    "P5": (-4, 4), "P6": (4, 4), "P7": (-4, -4), "P8": (4, -4),
    "P9": (-9, 1), "P10": (9, 1), "P11": (-8, -3), "P12": (9, -4),
}
EDGES = [("P0", "P1"), ("P0", "P2"), ("P0", "P3"), ("P0", "P4"), ("P1", "P5"), ("P1", "P7"),
         ("P2", "P6"), ("P2", "P8"), ("P3", "P5"), ("P3", "P6"), ("P4", "P7"), ("P4", "P8"),
         ("P1", "P9"), ("P2", "P10"), ("P7", "P11"), ("P8", "P12")]


def srgb(hex_value):
    """Convert the UI sRGB palette to Blender/glTF scene-linear RGBA."""
    h = hex_value.lstrip("#")
    channels = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return (*linear, 1.0)


C_DARK = srgb("2A2B26")
C_PAVE = srgb("ABA8A4")
C_STEEL = srgb("D8D5C7")
C_TEAL = srgb("51B8A7")
C_TEAL_DEEP = srgb("2D786C")
C_GOLD = srgb("F1C96D")
C_WINDOW = srgb("FFD88D")
C_GREEN = srgb("55865F")
C_GREEN_LIGHT = srgb("88A963")
C_TRUNK = srgb("76583B")


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def make_mat(name, rgba, metallic=0.05, roughness=0.65, emission=None, strength=1.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = rgba
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = strength
    return material


def finish(obj, name, material, parent):
    obj.name = name
    obj.data.materials.append(material)
    obj.parent = parent
    return obj


def box(name, dims, loc, material, parent, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.scale = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, material, parent)


def cyl(name, radius, depth, loc, material, parent, verts=16):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=loc, vertices=verts)
    return finish(bpy.context.active_object, name, material, parent)


def cone(name, r1, r2, depth, loc, material, parent, verts=12):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, location=loc, vertices=verts)
    return finish(bpy.context.active_object, name, material, parent)


def torus(name, major, minor, loc, material, parent, rot=(0, 0, 0), major_segments=32):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor, location=loc, rotation=rot,
        major_segments=major_segments, minor_segments=4,
    )
    return finish(bpy.context.active_object, name, material, parent)


def inlay(name, radius, half_width, z, material, parent, count):
    # Only the upper bevel of a strip set into paving is visible.
    vertices, faces = [], []
    for i in range(count):
        angle = i * math.tau / count
        for r, height in ((radius-half_width, z), (radius, z+half_width), (radius+half_width, z)):
            vertices.append((r * math.cos(angle), r * math.sin(angle), height))
        a, b = 3 * i, 3 * ((i + 1) % count)
        faces.extend(((a, a + 1, b + 1, b), (a + 1, a + 2, b + 2, b + 1)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return finish(obj, name, material, parent)


def garden_bud(name, radius, position, scale, material, root):
    # Eight flat faces read clearly at the scale of the ground cover.
    x, y, z = (radius * component for component in scale)
    mesh = bpy.data.meshes.new(name)
    vertices = [(x, 0, 0), (0, y, 0), (-x, 0, 0), (0, -y, 0), (0, 0, z), (0, 0, -z)]
    faces = [(i, (i + 1) % 4, 4) for i in range(4)]
    faces.extend(((i + 1) % 4, i, 5) for i in range(4))
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = position
    return finish(obj, name, material, root)


def ico(name, radius, loc, material, parent, subdivisions=2, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=radius, location=loc, subdivisions=subdivisions)
    obj = bpy.context.active_object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, material, parent)


def root_empty(name, parent=None, loc=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = loc
    return obj


def strut(name, start, end, radius, material, parent, verts=6):
    a, b = Vector(start), Vector(end)
    obj = cyl(name, radius, (b - a).length, (a + b) * 0.5, material, parent, verts)
    obj.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    return obj


def merge_direct_meshes(parent):
    """Batch static children by material while preserving the parent's animation pivot."""
    bpy.context.view_layer.update()
    groups = {}
    for obj in list(parent.children):
        if obj.type != "MESH":
            continue
        key = tuple(material.name for material in obj.data.materials)
        groups.setdefault(key, []).append(obj)
    for key, objects in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        if len(objects) > 1:
            bpy.ops.object.join()
        merged = bpy.context.view_layer.objects.active
        merged.name = f"{parent.name.lower()}_geo_{'_'.join(key)}"


def add_bench(root, index, x, y, rotation, m_wood, m_dark):
    def point(dx, dy, z):
        c, s = math.cos(rotation), math.sin(rotation)
        return (x + dx * c - dy * s, y + dx * s + dy * c, z)

    box(f"bench_seat_{index}", (0.95, 0.34, 0.12), point(0, 0, 0.34), m_wood, root, (0, 0, rotation))
    box(f"bench_back_{index}", (0.95, 0.09, 0.38), point(0, 0.15, 0.55), m_wood, root, (0, 0, rotation))
    for dx in (-0.34, 0.34):
        box(f"bench_leg_{index}_{dx}", (0.09, 0.26, 0.28), point(dx, 0, 0.14), m_dark, root, (0, 0, rotation))


def add_standard(root, x, y, brass, ivory, cloth, glow):
    """A notched woven district pennant with its inlaid six-sided civic seal."""
    side = 1 if x < 0 else -1
    cyl("standard_foot", 0.20, 0.20, (x, y, 0.10), ivory, root, 8)
    cyl("standard_mast", 0.045, 2.68, (x, y, 1.54), brass, root, 8)
    ico("standard_finial", 0.095, (x, y, 2.93), brass, root, subdivisions=1)
    strut("standard_crossarm", (x, y, 2.76), (x + side * 0.91, y, 2.76), 0.045, brass, root)
    cx = x + side * 0.49
    corners = [(cx - 0.34, y, 2.71), (cx - 0.34, y - 0.05, 1.18),
               (cx, y - 0.13, 1.40), (cx + 0.34, y - 0.05, 1.18), (cx + 0.34, y, 2.71)]
    mesh = bpy.data.meshes.new("district_banner")
    mesh.from_pydata(corners, [], [(0, 1, 2), (0, 2, 4), (2, 3, 4)])
    obj = bpy.data.objects.new("district_banner", mesh)
    bpy.context.scene.collection.objects.link(obj)
    finish(obj, "district_banner", cloth, root)
    torus("district_seal", 0.18, 0.031, (cx, y - 0.12, 2.14), glow, root,
          rot=(math.pi / 2, 0, 0), major_segments=6)
    ico("district_seal_heart", 0.065, (cx, y - 0.12, 2.14), ivory, root, subdivisions=1)


def add_bridge(root, stone, marble, gold, wood, light):
    box("stone_soffit", (3.47, 6.0, 0.23), (0, -17, -0.14), stone, root)
    for x in (-1.76, 1.76):
        for y, depth in ((-19.09, 1.78), (-14.82, 2.28)):
            box("arch_abutment", (0.46, depth, 1.56), (x * 0.87, y, -0.84), stone, root)
        for y in (-19.79, -17.16, -14.53):
            box("bridge_pier", (0.33, 0.36, 0.95), (x, y, 0.37), marble, root)
            box("bridge_pier_cap", (0.4, 0.40, 0.13), (x, y, 0.9), gold, root)
            if y != -17.16:
                cyl("bridge_pier_globe", 0.115, 0.22, (x, y, 1.05), light, root, 8)
        for y in (-18.475, -15.845):
            box("bridge_rail", (0.09, 2.54, 0.13), (x, y, 0.69), wood, root)
            box("bridge_lower_rail", (0.065, 2.54, 0.07), (x, y, 0.38), wood, root)


def add_hologram(plaza, stone, gold, glow):
    # The published P0 route crosses the floor emitter. Keep the volume above
    # a citizen's head and the physical footplate flush to the walkable surface.
    cyl("projector_foot", 0.64, 0.036, (0, 0, 0.094), stone, plaza, verts=12)
    inlay("projector_lens", 0.42, 0.034, 0.12, gold, plaza, 18)
    cyl("projector_lens_glass", 0.36, 0.018, (0, 0, 0.122), glow, plaza, verts=12)
    size, z0, z1 = 0.72, 1.76, 3.20
    angle = math.radians(31)
    def corner(x, y, z):
        return (x * math.cos(angle) - y * math.sin(angle), x * math.sin(angle) + y * math.cos(angle), z)
    for z in (z0, z1):
        loop = [corner(x, y, z) for x, y in ((-size, -size), (size, -size), (size, size), (-size, size))]
        for i in range(4):
            strut("hologram_edge", loop[i], loop[(i + 1) % 4], 0.039, glow, plaza)
            if z == z0:
                strut("hologram_riser", loop[i], (*loop[i][:2], z1), 0.039, glow, plaza)
            ico("hologram_joint", 0.068, loop[i], glow, plaza, subdivisions=1)
    core = ico("hologram_lattice", 0.28, (0, 0, (z0 + z1) / 2), glow, plaza, subdivisions=1)
    core.rotation_euler.z = angle


def build_environment():
    root = root_empty("Environment")
    build_landscape(root)
    m_pave = make_mat("env_pave", C_PAVE, 0.05, 0.78)
    m_dark = make_mat("env_dark", C_DARK, 0.05, 0.82)
    m_teal = make_mat("env_teal", C_TEAL, 0.0, 0.42, C_TEAL, 1.55)
    m_teal_deep = make_mat("env_teal_deep", C_TEAL_DEEP, 0.05, 0.62)
    m_gold = make_mat("env_gold", C_GOLD, 0.18, 0.46)
    m_gold_glow = make_mat("env_gold_glow", C_GOLD, 0.05, 0.45, C_GOLD, 1.0)
    m_window = make_mat("env_window", C_WINDOW, 0.0, 0.42, C_WINDOW, 2.0)
    m_green = make_mat("env_green", C_GREEN, 0.0, 0.86)
    m_green_light = make_mat("env_green_light", C_GREEN_LIGHT, 0.0, 0.84)
    m_trunk = make_mat("env_trunk", C_TRUNK, 0.0, 0.88)
    m_steel = make_mat("env_steel", C_STEEL, 0.08, 0.58)
    m_rock = make_mat("env_crag", srgb("797C87"), roughness=0.9)
    m_leaf = make_mat("env_leaves", srgb("A4B461"), roughness=0.9)
    m_cloth = make_mat("env_banner", srgb("267D80"), roughness=0.86)
    m_holo = make_mat("env_holograph", srgb("52DBDF"), 0, 0.38, srgb("51FCF1"), 1.55)
    add_bridge(root, m_pave, m_steel, m_gold, m_trunk, m_window)
    for x, y in ((-2.7, -13.4), (2.85, -13.1), (-4.65, 3.1), (4.75, 3.15)):
        add_standard(root, x, y, m_gold, m_steel, m_cloth, m_holo)

    plaza = root_empty("CivicPlaza", root)
    cyl("plaza_outer", 3.18, 0.018, (0, 0, 0.049), m_steel, plaza, verts=44)
    cyl("plaza_inner", 2.98, 0.016, (0, 0, 0.064), m_pave, plaza, verts=44)
    inlay("plaza_gold_ring", 2.72, 0.042, 0.075, m_gold, plaza, 40)
    inlay("plaza_teal_ring", 1.26, 0.041, 0.081, m_holo, plaza, 32)
    add_hologram(plaza, m_teal_deep, m_gold, m_holo)
    for i in range(8):
        angle = i * math.tau / 8
        box(
            f"plaza_inlay_{i}", (0.58, 0.055, 0.022),
            (math.cos(angle) * 1.9, math.sin(angle) * 1.9, 0.085),
            m_gold if i % 2 else m_steel, plaza, (0, 0, angle),
        )

    # The central level courtyard covers the inner graph; four avenue spurs
    # branch from it and meet the published entrance waypoints.
    for a, b in EDGES:
        if b not in ("P9", "P10", "P11", "P12"):
            continue
        ax, ay = WAYPOINTS[a]
        bx, by = WAYPOINTS[b]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy)
        angle = math.atan2(dy, dx)
        for segment in range(6):
            t = (segment + 0.5) / 6
            box(f"street_{a}_{b}_{segment}", (length / 6 - 0.022, 1.7, 0.075),
                (ax + dx * t, ay + dy * t, -0.032), m_pave if segment % 3 else m_steel,
                root, rot=(0, 0, angle))

    # Warm lanterns at the inner plaza and the four published entrance waypoints.
    for name in ("P1", "P2", "P3", "P4", "P9", "P10", "P11", "P12"):
        x, y = WAYPOINTS[name]
        x -= 0.5
        y -= 0.5
        cyl(f"lamp_base_{name}", 0.13, 0.12, (x, y, 0.06), m_gold, root, verts=8)
        cyl(f"pole_{name}", 0.05, 2.0, (x, y, 1.06), m_dark, root, verts=8)
        box(f"pole_light_{name}", (0.065, 0.065, 0.58), (x, y, 1.35), m_teal, root)
        box(f"lamp_{name}", (0.38, 0.26, 0.20), (x, y, 2.13), m_window, root)
        box(f"lamp_cap_{name}", (0.46, 0.32, 0.08), (x, y, 2.27), m_gold, root)

    # Benches stay outside the published walking lines and landmark footprints.
    for index, (x, y, rotation) in enumerate(((-5.7, -1.7, 0), (5.7, -1.7, 0),
                                               (-2.2, 5.0, math.pi / 2), (2.2, 5.0, math.pi / 2))):
        add_bench(root, index, x, y, rotation, m_trunk, m_dark)

    # Valleys and breaks in the tree line frame the landmarks rather than
    # forming a fence around them. All vegetation lies outside the street graph.
    tree_spots = (
        (-13.8, -10.2, 1.0), (-15.2, -7.8, 0.76), (-15.3, -1.1, 1.25),
        (-15.9, 3.8, 0.82), (-13.55, 7.1, 1.20), (-13.5, 11.4, 0.99),
        (-9.0, 12.9, 1.40), (-4.1, 13.2, 1.72), (-1.4, 11.8, 1.24),
        (3.2, 13.85, 1.4), (5.7, 12.1, 0.80), (11.9, 12.3, 1.05),
        (14.65, 8.9, 1.35), (16.0, 3.6, 0.78), (15.8, 1.35, 1.1),
        (14.2, -4.7, 0.97), (14.5, -9.8, 0.84), (4.15, -11.7, 0.78),
        (-3.0, -10.25, 0.74), (-5.0, -13.3, 0.70),
    )
    for i, (x, y, s) in enumerate(tree_spots):
        cyl(f"trunk_{i}", 0.13 * s, 1.05 * s, (x, y, 0.42 * s), m_trunk, root, verts=7)
        if i % 4 == 0 or i >= 17:
            ico(f"linden_{i}", 0.96 * s, (x, y, 1.52 * s), m_leaf, root, 1, (0.92, 0.91, 1.22))
            ico(f"linden_bough_{i}", 0.61 * s, (x - 0.38 * s, y + 0.1, 1.31 * s),
                m_green_light, root, 1, (0.95, 0.83, 1.13))
        else:
            cone(f"pine_lower_{i}", 0.86 * s, 0.07 * s, 1.39 * s, (x, y, 1.4 * s), m_green, root, 7)
            cone(f"pine_upper_{i}", 0.62 * s, 0, 1.31 * s, (x, y, 2.06 * s), m_green_light, root, 7)
        for j in range(3):
            angle = j * math.tau / 3 + i * 0.71
            px, py = x + math.cos(angle) * 0.81, y + math.sin(angle) * 0.70
            garden_bud("shrub", 0.24, (px, py, 0.13), (1.25, 0.87, 0.83), m_green_light, root)
            if j < 2:
                garden_bud("wildflower", 0.085, (px + 0.04, py, 0.30), (1, 1, 1), m_steel, root)

    # Long, low beds and rock gardens break up the exposed meadows, keeping
    # the wide sightline along the entrance and toward the rear dome open.
    for i, (x, y, s) in enumerate(((-11.98,-13.7,0.78),(-9.13,-13.9,0.55),
                                    (7.50,-14.3,0.65),(10.55,-14.75,0.8),
                                    (-14.6,1,0.8),(13.7,-0.4,0.85),
                                    (-2.45,9.1,1.1),(1.5,11.75,1.4),(7.3,11.2,1.05))):
        rock = ico("garden_basalt", s, (x, y, s * 0.18), m_rock, root, 1, (1.35, 0.84, 0.51))
        rock.rotation_euler.z = i * 0.88
        ico("garden_groundcover", s * 0.60, (x - 0.44 * s, y + 0.04, s * 0.3),
            m_green_light, root, 1, (1.24, 0.84, 0.62))
    for x, y, angle in ((-5.1,-14.0,0.18),(-13.6,-10.95,0.8),(12.9,-12.8,0.65),
                        (15.1,-7.3,1.18),(-11.8,12.0,0.05),(6.7,13.3,-0.24)):
        a, b = (math.cos(angle), math.sin(angle))
        for d in (-0.95, 0.95):
            box("fence_post", (0.14, 0.14, 0.67), (x + d*a, y + d*b, 0.26), m_trunk, root)
        box("fence_rail", (2.04, 0.09, 0.12), (x, y, 0.40), m_trunk, root, (0, 0, angle))

    for x, y, z, s in ((-16.2,-11.9,-3.4,0.57),(-15.7,-11.3,-4.65,0.24),
                        (14.7,-13.9,-4.25,0.80),(4.7,-15,-4.8,0.56),(-5.9,-14.9,-5.6,0.38)):
        rock = ico("suspended_basalt", s, (x, y, z), m_rock, root, 1, (1.06, 0.79, 1.21))
        rock.rotation_euler.z = x

    # Airship children are local to this named pivot; DistrictEnvironment animates only the pivot.
    airship = root_empty("airship", root, (-13, 9, 12))
    ico("airship_hull", 1.0, (0, 0, 0), m_steel, airship, subdivisions=2, scale=(2.6, 1.0, 1.0))
    torus("airship_band", 1.01, 0.045, (0.15, 0, 0), m_gold, airship, (0, math.pi / 2, 0), 32)
    box("airship_gondola", (1.2, 0.55, 0.42), (0, 0, -1.22), m_gold, airship)
    box("airship_tail_vertical", (0.58, 0.08, 0.72), (-2.18, 0, 0.42), m_teal_deep, airship)
    box("airship_tail_horizontal", (0.62, 1.45, 0.08), (-2.12, 0, -0.08), m_teal_deep, airship)
    for i, x in enumerate((-0.62, 0.0, 0.62)):
        box(f"airship_window_{i}", (0.32, 0.07, 0.18), (x, -0.92, 0.02), m_teal, airship)
    ico("airship_nose_light", 0.11, (2.55, 0, 0), m_gold_glow, airship, subdivisions=1)

    merge_direct_meshes(plaza)
    merge_direct_meshes(airship)
    merge_direct_meshes(root)
    return root


clear_scene()
bpy.context.preferences.filepaths.save_version = 0
OUT_DIR.mkdir(parents=True, exist_ok=True)
BLEND_DIR.mkdir(parents=True, exist_ok=True)
root = build_environment()
bpy.context.view_layer.update()
for obj in root.children_recursive:
    if obj.type == "MESH":
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            if max(abs(point.x), abs(point.y)) > 20.001:
                raise ValueError(f"{obj.name} is outside the published 40 m district at {point}")
bpy.ops.object.select_all(action="DESELECT")
root.select_set(True)
for child in root.children_recursive:
    child.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format="GLB", use_selection=True, export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_DIR / "environment.blend"))
tris = sum(
    len(poly.vertices) - 2
    for obj in root.children_recursive if obj.type == "MESH"
    for poly in obj.data.polygons
)
print("ENVIRONMENT_RESULT " + json.dumps({
    "file": str(OUT), "bytes": OUT.stat().st_size, "tris": tris,
    "meshes": sum(obj.type == "MESH" for obj in root.children_recursive),
    "airship": bpy.data.objects.get("airship") is not None,
}))
