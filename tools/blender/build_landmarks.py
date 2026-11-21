"""Build the four District 01 landmark GLBs (low-poly, P0+).

Sizes are copied from packages/domain/src/scene/district-01.ts
(district-01@1, immutable manifest) — see BOUNDS below. The PROJECT tower
carries four switchable stage groups named stage_foundation / stage_frame /
stage_facade / stage_complete; the renderer toggles their visibility.

Charcoal stone, satin brass and warm light unite the four landmarks. The
identity display uses ice blue, the core has smoked glazing, and the roof
monument uses polished gold.

Run: & "G:\\blender\\blender.exe" --background --factory-startup --python tools\\blender\\build_landmarks.py
"""
import bpy
import json
import math
import pathlib
from mathutils import Vector

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "apps" / "web" / "public" / "world" / "district-01" / "v1"
BLEND_DIR = ROOT / "tools" / "blends"

# district-01.ts bounds [width, height, depth]: COUNCIL 7/9/7, IDENTITY 7/11/7,
# PROJECT 9/14/9, CORE 7/10/7. Ground footprint uses x/z in glTF (Blender x/y).
BOUNDS = {"COUNCIL": (7, 9, 7), "IDENTITY": (7, 11, 7), "PROJECT": (9, 14, 9), "CORE": (7, 10, 7)}

# Author colours in sRGB (the same hex values used by the web UI), then convert
# to Blender/glTF scene-linear values. Feeding sRGB numbers directly to
# Principled Base Color makes every facade look chalky and overexposed.
def srgb(hex_color):
    channels = [int(hex_color[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return (*linear, 1.0)


C_PLINTH = srgb("#202329")
C_GRAPHITE = srgb("#42454A")
C_CHARCOAL = srgb("#2D3035")
C_BRASS = srgb("#C09A54")
C_YELLOW = srgb("#FCD535")
C_WINDOW = srgb("#F7CC83")


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def make_mat(name, rgba, metallic=0.05, roughness=0.65, emission=None, strength=1.0, alpha=1.0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*rgba[:3], alpha)
    material.use_nodes = True
    if alpha < 1.0:
        material.blend_method = "BLEND"
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Alpha"].default_value = alpha
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = strength
    return material


def box(name, dims, loc, material, parent, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    obj.parent = parent
    return obj


def cyl(name, radius, depth, loc, material, parent, verts=16):
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=depth, location=loc, vertices=verts
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    obj.parent = parent
    return obj


def cone(name, r1, r2, depth, loc, material, parent, verts=20):
    bpy.ops.mesh.primitive_cone_add(
        radius1=r1, radius2=r2, depth=depth, location=loc, vertices=verts
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    obj.parent = parent
    return obj


def torus(name, major, minor, loc, material, parent):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor, location=loc,
        major_segments=24, minor_segments=8,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    obj.parent = parent
    return obj


def root_empty(name):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def window_grid(name, cols, rows, wsize, hsize, xgap, zgap, face, z0, material, parent, x0=0.0):
    """Rows of flat emissive window boxes slightly proud of a facade.

    `face` is the y coordinate of the wall surface (Blender y); windows sit
    0.03 outside it so they read as glowing panes, not paint.
    """
    for i in range(cols):
        for j in range(rows):
            x = x0 + (i - (cols - 1) / 2) * xgap
            z = z0 + j * zgap
            box(f"win_{name}_{i}_{j}", (wsize, 0.06, hsize), (x, face - 0.03, z), material, parent)


def dome(name, radius, height, base_z, materials, parent, segments=24, rings=6):
    """Low-poly half dome with alternating architectural roof panels."""
    vertices = []
    for ring in range(rings):
        theta = (math.pi / 2) * ring / rings
        r = radius * math.cos(theta)
        z = base_z + height * math.sin(theta)
        for segment in range(segments):
            angle = 2 * math.pi * segment / segments
            vertices.append((r * math.cos(angle), r * math.sin(angle), z))
    vertices.append((0, 0, base_z + height))
    top = len(vertices) - 1
    faces = []
    for ring in range(rings - 1):
        for segment in range(segments):
            a = ring * segments + segment
            b = ring * segments + (segment + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    for segment in range(segments):
        a = (rings - 1) * segments + segment
        b = (rings - 1) * segments + (segment + 1) % segments
        faces.append((a, b, top))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for material in materials:
        obj.data.materials.append(material)
    for index, polygon in enumerate(obj.data.polygons):
        segment = index % segments
        polygon.material_index = 1 if (segment // 3) % 2 else 0
    obj.parent = parent
    return obj


def merge_static_meshes(root):
    """Join static architecture by material to keep GLB draw calls bounded."""
    # Flush freshly assigned locations/rotations before join; otherwise Blender
    # can transform rotated emblems using a stale matrix_world.
    bpy.context.view_layer.update()
    groups = {}
    for obj in list(root.children_recursive):
        if obj.type != "MESH":
            continue
        key = tuple(material.name for material in obj.data.materials)
        groups.setdefault(key, []).append(obj)
    for key, objects in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        # Bake local rotations before joining. Blender 5.3 otherwise miscalculates
        # the joined bounds for these small rotated diamond emblems.
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        if len(objects) > 1:
            bpy.ops.object.join()
        merged = bpy.context.view_layer.objects.active
        # Only the four switchable group nodes use the reserved stage_ prefix.
        merged.name = f"{root.name.removeprefix('stage_').lower()}_geo_{'_'.join(key)}"


def build_council():
    """Reference-quality civic hall within the immutable 7 x 9 x 7 bounds."""
    root = root_empty("COUNCIL")
    plinth = make_mat("council_plinth", C_PLINTH, 0.07, 0.72)
    stone = make_mat("council_graphite", C_GRAPHITE, 0.12, 0.58)
    lacquer = make_mat("council_charcoal", C_CHARCOAL, 0.32, 0.43)
    seal = make_mat("council_enamel", C_YELLOW, 0.21, 0.40)
    brass = make_mat("council_brass", C_BRASS, 0.52, 0.37)
    window = make_mat("council_window", C_WINDOW, 0.04, 0.42, C_WINDOW, 0.60)

    # Terraced foundation and a broad ceremonial staircase.
    box("podium", (7.0, 7.0, 0.45), (0, 0, 0.225), plinth, root)
    box("terrace", (6.5, 6.2, 0.35), (0, 0, 0.625), stone, root)
    for i in range(7):
        top = 0.45 + (i + 1) * 0.355 / 7
        box(f"grand_step_{i}", (3.2, 0.29, top), (0, -3.35 + i * 0.26, top / 2), stone, root)

    # Central parliament hall and two lower side wings create a distinct silhouette.
    box("main_hall", (3.6, 3.6, 3.9), (0, 0.45, 2.75), stone, root)
    for side in (-1, 1):
        x = side * 2.275
        box(f"wing_{side}", (1.45, 4.0, 2.5), (x, 0.35, 2.05), stone, root)
        box(f"wing_roof_{side}", (1.65, 4.2, 0.22), (x, 0.35, 3.41), lacquer, root)
        box(f"wing_gold_trim_{side}", (1.65, 0.09, 0.12), (x, -1.77, 3.52), brass, root)
        window_grid(f"council_wing_{side}", 2, 2, 0.28, 0.55, 0.85, 0.95, -1.65, 1.45, window, root, x0=x)
        box(f"banner_{side}", (0.34, 0.055, 1.3), (x, -1.72, 2.15), lacquer, root)
        emblem = box(f"banner_emblem_{side}", (0.23, 0.065, 0.23), (x, -1.755, 2.25), seal, root, rot=(0, math.radians(45), 0))

    # Columned portico, glowing entrance and upper chamber windows.
    box("portico_beam", (3.9, 0.55, 0.34), (0, -1.5, 4.45), stone, root)
    box("portico_gold_line", (3.95, 0.59, 0.1), (0, -1.5, 4.65), brass, root)
    for x in (-1.42, -0.48, 0.48, 1.42):
        cyl(f"portico_column_{x}", 0.115, 3.45, (x, -1.55, 2.525), lacquer, root, verts=12)
        cyl(f"column_base_{x}", 0.17, 0.13, (x, -1.55, 0.865), brass, root, verts=12)
        cyl(f"column_cap_{x}", 0.16, 0.13, (x, -1.55, 4.185), brass, root, verts=12)
    box("golden_door_frame", (1.5, 0.12, 2.55), (0, -1.405, 2.075), brass, root)
    box("golden_door_light", (1.2, 0.08, 2.3), (0, -1.475, 2.0), window, root)
    box("door_mullion", (0.055, 0.09, 2.3), (0, -1.525, 2.0), brass, root)
    for x in (-1.05, 1.05):
        box(f"upper_window_{x}", (0.48, 0.07, 0.72), (x, -1.395, 3.72), window, root)

    # Drum, panelled gold dome, roof edges and a compact civic flag.
    box("main_entablature", (3.95, 3.95, 0.3), (0, 0.45, 4.85), stone, root)
    box("main_roof_band", (4.05, 4.05, 0.16), (0, 0.45, 5.08), brass, root)
    cyl("dome_drum", 1.65, 0.45, (0, 0.45, 5.385), lacquer, root, verts=24)
    dome_obj = dome("panelled_dome", 1.55, 1.05, 5.61, [brass, lacquer], root)
    dome_obj.location.y = 0.45
    cyl("flag_mast", 0.045, 1.25, (0, 0.45, 7.225), brass, root, verts=10)
    box("civic_flag", (0.82, 0.055, 0.46), (0.43, 0.45, 7.62), lacquer, root)
    box("flag_emblem", (0.2, 0.065, 0.2), (0.43, 0.415, 7.62), seal, root, rot=(0, math.radians(45), 0))
    for x in (-1.78, 1.78):
        for y in (-1.32, 2.22):
            cone("roof_finial", 0.12, 0.0, 0.38, (x, y, 5.28), brass, root, verts=10)

    # Slim terrace balustrades remain inside the published footprint.
    for side in (-1, 1):
        x = side * 3.05
        for y in (-0.5, 0.5, 1.5, 2.5):
            box(f"baluster_{side}_{y}", (0.075, 0.075, 0.48), (x, y, 1.04), brass, root)
        box(f"balustrade_rail_{side}", (0.08, 3.15, 0.08), (x, 1.0, 1.31), brass, root)

    merge_static_meshes(root)
    return root


def solid_mesh(name, vertices, faces, material, parent):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    mesh.materials.append(material)
    obj.parent = parent
    return obj


def bar(name, start, end, radius, material, parent, sides=6):
    a, b = Vector(start), Vector(end)
    obj = cyl(name, radius, (b - a).length, (a + b) / 2, material, parent, verts=sides)
    obj.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    return obj


def crest(name, outline, y, depth, material, parent):
    """A shallow relief on the front (negative Y) of the tower."""
    n = len(outline)
    vertices = [(x, plane, z) for plane in (y, y + depth) for x, z in outline]
    faces = [tuple(range(n)), tuple(reversed(range(n, n * 2)))]
    faces.extend(((i + 1) % n, i, n + i, n + (i + 1) % n) for i in range(n))
    return solid_mesh(name, vertices, faces, material, parent)


def steps(root, width, edge, stone, direction=-1):
    for i in range(5):
        h = (i + 1) * 0.13
        box("entry_tread", (width, 0.29, h), (0, direction * (edge - i * 0.24), h / 2), stone, root)


def build_identity():
    root = root_empty("IDENTITY")
    stone = make_mat("id_graphite", C_GRAPHITE, 0.13, 0.49)
    slate = make_mat("id_carbon", C_CHARCOAL, 0.23, 0.44)
    bronze = make_mat("id_bronze", srgb("#967748"), 0.48, 0.40)
    gold = make_mat("id_brass", C_BRASS, 0.44, 0.36)
    lamp = make_mat("id_amber", C_WINDOW, 0.10, 0.36, C_WINDOW, 0.75)
    ice = srgb("#96E1F3")
    trace = make_mat("id_phosphor", ice, 0.10, 0.30, ice, 0.85)
    enamel = make_mat("id_display", srgb("#193440"), 0.22, 0.28)

    cyl("civic_plinth", 2.89, 0.28, (0, 0, 0.14), bronze, root, 12)
    cyl("upper_stylobate", 2.72, 0.35, (0, 0, 0.44), stone, root, 12)
    cyl("recessed_lobby", 2.38, 1.63, (0, 0, 1.39), slate, root, 12)
    cyl("lobby_cornice", 2.70, 0.32, (0, 0, 2.31), gold, root, 12)
    steps(root, 1.82, 3.30, stone)
    for i in range(8):
        a = math.tau * i / 8 + math.pi / 8
        x, y = 2.33 * math.sin(a), -2.33 * math.cos(a)
        box("portico_pier", (0.34, 0.50, 1.72), (x, y, 1.44), stone, root, rot=(0, 0, a))
    for x in (-0.32, 0.32):
        box("entry_lantern", (0.49, 0.09, 1.22), (x, -2.32, 1.29), lamp, root)
    # Three closely fitted pylons ascend towards an asymmetric signal mast.
    for x, y, width, depth, top, slope, mat in (
        (-1.03, 0.26, 0.84, 1.22, 7.50, 0.46, slate),
        (-0.17, 0.38, 1.01, 1.47, 9.84, 0.31, bronze),
        (0.72, 0.26, 0.92, 1.30, 8.73, -0.41, slate),
    ):
        w, d = width / 2, depth / 2
        cut = 0.12
        xy = [(-w+cut,-d),(w-cut,-d),(w,-d+cut),(w,d-cut),
              (w-cut,d),(-w+cut,d),(-w,d-cut),(-w,-d+cut)]
        vertices = [(x + u, y + v, 2.44) for u, v in xy]
        vertices.extend((x + u * 0.81, y + v * 0.81, top + slope * u) for u, v in xy)
        faces = [tuple(reversed(range(8))), tuple(range(8, 16))]
        faces.extend((i, (i+1)%8, (i+1)%8+8, i+8) for i in range(8))
        solid_mesh("beacon_pylon", vertices, faces, mat, root)
        box("signal_strip", (0.12, 0.13, top-3.42),
            (x, y-d+0.02, (2.55+top-0.87)/2), gold, root)
    cyl("beacon_socket", 0.13, 0.30, (-0.15, 0.37, 9.94), gold, root, 8)
    cyl("beacon_tip", 0.083, 0.62, (-0.15, 0.37, 10.39), lamp, root, 8)

    # A relief portrait, clipped corners and two etched lines read at city scale.
    # The display floats above a lens in front of the pylons.
    cyl("projector_seat", 0.82, 0.18, (0, -1.23, 2.53), gold, root, 16)
    cyl("projector_lens", 0.56, 0.12, (0, -1.23, 2.66), trace, root, 16)
    card = [(-1.12,3.14),(0.97,3.14),(1.24,3.41),(1.24,5.89),
            (1.04,6.09),(-1.02,6.09),(-1.24,5.87),(-1.24,3.26)]
    y = -1.38
    crest("holographic_plate", card, y, 0.095, enamel, root)
    for i, (x, z) in enumerate(card):
        u, v = card[(i+1) % len(card)]
        bar("card_luminous_rim", (x,y-0.032,z), (u,y-0.032,v), 0.052, trace, root)
    portrait = cyl("portrait_head", 0.32, 0.055, (-0.15,y-0.09,5.16), trace, root, 16)
    portrait.rotation_euler.x = math.pi / 2
    shoulders = [(-0.79,4.22),(0.49,4.22),(0.44,4.50),(0.24,4.72),
                 (0.02,4.81),(-0.32,4.81),(-0.54,4.72),(-0.74,4.50)]
    crest("portrait_shoulders", shoulders, y-0.12, 0.07, trace, root)
    for x, z, width in ((-0.20,3.88,1.26),(-0.38,3.65,0.90)):
        box("etched_data", (width,0.052,0.075), (x,y-0.074,z), trace, root)
    for i in range(3):
        box("contact_pad", (0.14,0.06,0.11), (0.58+i*0.19,y-0.07,5.70), gold, root)
    return root


def build_core():
    root = root_empty("CORE")
    stone = make_mat("core_graphite", C_GRAPHITE, 0.16, 0.50)
    slate = make_mat("core_foundation", C_PLINTH, 0.16, 0.57)
    brass = make_mat("core_brass", C_BRASS, 0.48, 0.36)
    amber = make_mat("core_amber", C_WINDOW, 0.06, 0.36, C_WINDOW, 0.65)
    rail = make_mat("core_gold_mullion", srgb("#E8B94F"), 0.46, 0.32)
    light = make_mat("core_junction", C_YELLOW, 0.14, 0.30, C_WINDOW, 0.68)
    glass = make_mat("core_smoked_glass", srgb("#414B56"), 0.18, 0.21, alpha=0.57)
    glass.use_backface_culling = True

    cyl("stepped_foundation", 3.09, 0.28, (0,0,0.14), slate, root, 16)
    cyl("gallery_floor", 2.98, 0.36, (0,0,0.45), stone, root, 16)
    cyl("recessed_gallery", 2.56, 1.24, (0,0,1.23), slate, root, 16)
    steps(root, 1.65, 3.33, stone, direction=1)
    for i in range(10):
        a = math.tau * i / 10
        x, y = math.sin(a), -math.cos(a)
        box("amber_clerestory", (0.65,0.09,0.82), (x*2.55,y*2.55,1.23), amber, root, (0,0,a))
        angle = a + math.pi / 10
        pier = box("buttress", (0.38,0.49,1.45),
                   (2.75*math.sin(angle),-2.75*math.cos(angle),1.28), stone, root)
        pier.rotation_euler = (math.radians(-9),0,angle)
    cyl("overhanging_eave", 3.06, 0.34, (0,0,1.99), stone, root, 20)
    cyl("dome_seal", 2.83, 0.15, (0,0,2.22), brass, root, 32)
    cyl("dark_reflecting_floor", 2.67, 0.09, (0,0,2.32), slate, root, 32)
    cyl("reactor_pedestal", 0.72, 0.52, (0,0,2.62), brass, root, 8)
    cone("crystal_lower", 0.13, 0.65, 0.86, (0,0,3.28), light, root, 6)
    cone("crystal_upper", 0.65, 0.0, 0.87, (0,0,4.145), light, root, 6)

    # Offset successive parallels by half a panel to form a triangulated shell.
    sides, radius, rise, sill = 12, 2.68, 2.68, 2.36
    vertices, faces = [], []
    for ring, degrees in enumerate((0,24,49,70)):
        latitude = math.radians(degrees)
        for i in range(sides):
            a = math.tau * (i + (ring % 2) / 2) / sides
            vertices.append((radius*math.cos(latitude)*math.cos(a),
                             radius*math.cos(latitude)*math.sin(a), sill+rise*math.sin(latitude)))
    for ring in range(3):
        for i in range(sides):
            a = ring*sides + i
            b = ring*sides + (i+1) % sides
            c = (ring+1)*sides + (i + ring%2) % sides
            d = (ring+1)*sides + (i + ring%2 - 1) % sides
            faces.extend(((a,b,c),(a,c,d)))
    top = len(vertices)
    vertices.append((0,0,sill+rise))
    faces.extend((top-sides+i, top-sides+(i+1)%sides, top) for i in range(sides))
    solid_mesh("faceted_glazing", vertices, faces, glass, root)
    edges = {tuple(sorted((face[i-1],face[i]))) for face in faces for i in range(3)}
    for a, b in sorted(edges):
        bar("glazing_mullion", vertices[a], vertices[b], 0.037, rail, root, 5)
    for point in vertices:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.085, location=point)
        joint = bpy.context.active_object
        joint.name = "luminous_bolt"
        joint.data.materials.append(light)
        joint.parent = root
    return root


def monument_bowl(stage, shaft_top, gold):
    """An oval gold shell with a recessed interior and a rounded seat rim."""
    profile = (
        (0.60, 0.00), (0.82, 0.12), (0.71, 0.42), (1.20, 0.72),
        (1.88, 1.20), (2.04, 1.62), (1.98, 1.72), (1.60, 1.72),
        (1.52, 1.52), (1.22, 1.18), (0.60, 0.96),
    )
    segments = 32
    vertices = []
    faces = []
    for radius, height in profile:
        for side in range(segments):
            angle = side * math.tau / segments
            vertices.append((radius * math.cos(angle), radius * 1.14 * math.sin(angle),
                             shaft_top + height))
    for ring in range(len(profile) - 1):
        for side in range(segments):
            a = ring * segments + side
            b = ring * segments + (side + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    faces.append(tuple(reversed(range(segments))))
    faces.append(tuple(range(len(vertices) - segments, len(vertices))))
    mesh = bpy.data.meshes.new("Monument bowl")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("golden_bowl", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(gold)
    obj.parent = stage


def build_project():
    """Golden Toilet Tower with four switchable stage groups (design doc §3)."""
    root = root_empty("PROJECT")
    w, h, d = BOUNDS["PROJECT"]
    shaft_w, shaft_d = w * 0.56, d * 0.56
    shaft_h = 7.2
    shaft_top = 0.9 + shaft_h
    rim_r = w * 0.38

    plinth = make_mat("p_plinth", C_PLINTH, 0.07, 0.67)
    stone = make_mat("p_graphite", srgb("#35383C"), 0.18, 0.51)
    steel = make_mat("p_steel", srgb("#747474"), 0.42, 0.47)
    trim = make_mat("p_satin_gold", srgb("#DBAD4F"), 0.47, 0.36)
    monument = make_mat("p_monument_gold", srgb("#FFCA46"), 0.64, 0.23)
    accent = make_mat("p_gold_glow", C_YELLOW, 0.19, 0.38, C_YELLOW, 0.50)
    amber = make_mat("p_amber", srgb("#E8A73B"), 0.12, 0.41, C_WINDOW, 0.55)
    window = make_mat("p_window", C_WINDOW, 0.05, 0.41, C_WINDOW, 0.52)
    wire = make_mat("p_wire", C_BRASS, 0.06, 0.50, alpha=0.14)

    box("plinth", (w * 0.92, d * 0.92, 0.9), (0, 0, 0.45), plinth, root)

    foundation = root_empty("stage_foundation"); foundation.parent = root
    box("slab", (shaft_w * 1.16, shaft_d * 1.16, 0.18), (0, 0, 0.99), stone, foundation)
    for cx in (-1, 0, 1):
        for cz in (-1, 0, 1):
            box("stub", (0.3, 0.3, 1.6), (cx * shaft_w * 0.36, cz * shaft_d * 0.36, 1.8), amber, foundation)
    box("hologram", (shaft_w, shaft_d, shaft_h), (0, 0, 0.9 + shaft_h / 2), wire, foundation)
    mast_x, mast_y = shaft_w / 2 + 0.8, -shaft_d / 2 - 0.6
    box("crane_mast", (0.26, 0.26, 6.6), (mast_x, mast_y, 0.9 + 3.3), trim, foundation)
    box("crane_jib", (5.4, 0.14, 0.14), (mast_x - 2.7, mast_y, 7.35), trim, foundation)
    box("crane_counter", (1.0, 0.14, 0.14), (mast_x + 0.5, mast_y, 7.35), trim, foundation)
    box("crane_cable", (0.04, 0.04, 5.3), (mast_x - 5.2, mast_y, 4.55), steel, foundation)
    box("crane_hook", (0.24, 0.24, 0.24), (mast_x - 5.2, mast_y, 1.85), amber, foundation)

    frame = root_empty("stage_frame"); frame.parent = root
    for sx in (-1, 1):
        for sy in (-1, 1):
            box("column", (0.34, 0.34, shaft_h), (sx * (shaft_w / 2 - 0.18), sy * (shaft_d / 2 - 0.18), 0.9 + shaft_h / 2), steel, frame)
    for fraction in (0.2, 0.4, 0.6, 0.8, 1.0):
        box("floor", (shaft_w, shaft_d, 0.16), (0, 0, 0.9 + shaft_h * fraction), trim, frame)
    box("arm", (1.8, 0.14, 0.14), (shaft_w / 2 + 0.9, 0, shaft_top + 0.35), trim, frame)

    def build_topped(stage_name):
        """Shared shaft + golden bowl geometry for the facade/complete stages."""
        stage = root_empty(stage_name); stage.parent = root
        box("shaft", (shaft_w, shaft_d, shaft_h), (0, 0, 0.9 + shaft_h / 2), stone, stage)
        for sx in (-1, 1):
            for sy in (-1, 1):
                box("fin", (0.2, 0.2, shaft_h), (sx * shaft_w / 2, sy * shaft_d / 2, 0.9 + shaft_h / 2), trim, stage)
        for z in (3.2, 6.1):
            box("band", (shaft_w * 0.82, 0.08, 0.08), (0, -shaft_d / 2 - 0.02, z), accent, stage)
        window_grid(f"proj_{stage_name}", 3, 4, 0.62, 0.78, 1.5, 1.50, -shaft_d / 2, 2.65, window, stage)
        box("cornice", (shaft_w + 0.34, shaft_d + 0.34, 0.26),
            (0, 0, shaft_top - 0.13), trim, stage)
        monument_bowl(stage, shaft_top, monument)
        if stage_name == "stage_facade":
            for sx in (-1, 1):
                for sy in (-1, 1):
                    box("post", (0.07, 0.07, 1.8), (sx * rim_r * 0.8, sy * rim_r * 0.8, shaft_top + 0.9), steel, stage)
            for sign in (-1, 1):
                box("beam_x", (rim_r * 1.6, 0.07, 0.07), (0, sign * rim_r * 0.8, shaft_top + 1.8), steel, stage)
                box("beam_y", (0.07, rim_r * 1.6, 0.07), (sign * rim_r * 0.8, 0, shaft_top + 1.8), steel, stage)
        for sx in (-1, 1):
            for sy in (-1, 1):
                box("equipment", (0.26, 0.1, 0.16), (sx * shaft_w * 0.36, sy * (shaft_d / 2 + 0.04), shaft_top - 0.4), accent, stage)
        return stage

    build_topped("stage_facade")
    complete = build_topped("stage_complete")
    # Hinge the lid to the back of the seat. Its height stays inside the 14 m envelope.
    hinge = cyl("hinge", 0.14, 1.70, (0, 1.72, shaft_top + 1.72), monument, complete)
    hinge.rotation_euler.y = math.pi / 2
    lid_center = (0, 2.10, shaft_top + 3.21)
    lid = cyl("raised_lid", 1.77, 0.22, lid_center, monument, complete, verts=32)
    lid.rotation_euler.x = math.radians(77)
    lid.scale.x = 0.84
    lip = torus("lid_trim", 1.62, 0.07, (0, 1.98, lid_center[2] + 0.025), trim, complete)
    lip.rotation_euler = lid.rotation_euler
    lip.scale.x = 0.84
    box("plaque", (1.35, 0.10, 0.36), (0, -shaft_d / 2 - 0.08, 2.07), trim, complete)
    box("entrance", (1.55, 0.12, 1.04), (0, -shaft_d / 2 - 0.02, 1.42), amber, complete)
    return root


def export_root(root, filename):
    bpy.context.view_layer.update()
    if root.name == "PROJECT":
        for group in root.children:
            if group.name.startswith("stage_"):
                merge_static_meshes(group)
    elif root.name in ("IDENTITY", "CORE"):
        merge_static_meshes(root)
    bpy.context.view_layer.update()
    w, h, d = BOUNDS[root.name]
    for obj in root.children_recursive:
        if obj.type != "MESH":
            continue
        for vertex in obj.data.vertices:
            x, y, z = obj.matrix_world @ vertex.co
            if abs(x) > w/2 + 0.01 or abs(y) > d/2 + 0.01 or not -0.01 <= z <= h + 0.01:
                raise ValueError(f"{root.name}: {obj.name} exceeds its district bounds at {(x, y, z)}")
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)
    out = OUT_DIR / filename
    bpy.ops.export_scene.gltf(
        filepath=str(out), export_format="GLB", use_selection=True, export_apply=True
    )
    tris = sum(len(p.vertices) - 2 for obj in root.children_recursive if obj.type == "MESH" for p in obj.data.polygons)
    print("LANDMARK_RESULT " + json.dumps({"file": filename, "bytes": out.stat().st_size, "tris": tris}))


clear_scene()
OUT_DIR.mkdir(parents=True, exist_ok=True)
BLEND_DIR.mkdir(parents=True, exist_ok=True)
landmarks = [builder() for builder in (build_council, build_identity, build_core, build_project)]
bpy.ops.object.select_all(action="DESELECT")
# Save the modelling scene first so windows, lid and scaffolding stay editable.
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_DIR / "landmarks.blend"))
for root in landmarks:
    export_root(root, f"{root.name.lower()}.glb")
