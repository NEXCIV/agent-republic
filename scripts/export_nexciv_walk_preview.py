"""Export the NEXCIV observation scene, district chunks and pedestrian routes."""

import argparse
import json
import math
import sys
from contextlib import contextmanager
from itertools import pairwise
from pathlib import Path

import bmesh
import bpy
from io_scene_gltf2.io.exp import meshopt
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_lakeside import material, shader
from build_nexciv_road_markings import ASPHALT, ROAD_Z, WHITE
from build_nexciv_road_markings import DESTINATION as SOURCE

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "apps/web/public/nexciv-walk"
WEST, EAST, SOUTH, NORTH = -52, 53, -81, 46
GOVERNANCE_NORTH = 116
GOVERNANCE_CROSSING_ROAD = "CIVRUM_ROAD_STRAIGHT_LOCAL.002"
GOVERNANCE_CROSSING_X = (10.7, 13.1)
GOVERNANCE_CROSSING_STRIPES = tuple((61.06 + i * 0.52, 61.37 + i * 0.52) for i in range(12))
EAST_CROSSING_ROAD = "CIVRUM_ROAD_STRAIGHT_MAIN.018"
EAST_CROSSING_X = (93.8, 96.55)
EAST_CROSSING_STRIPES = tuple((-4.59 + i * 0.61, -4.24 + i * 0.61) for i in range(16))
WEST_CROSSING_ROAD = "CIVRUM_ROAD_STRAIGHT_LOCAL.018"
WEST_CROSSING_Y = (-38.5, -36.0)
WEST_CROSSING_STRIPES = tuple((-67.35 + i * 0.60, -67.01 + i * 0.60) for i in range(12))
SHORE_CROSSING_ROAD = "CIVRUM_ROAD_STRAIGHT_LOCAL.071"
SHORE_CROSSING_X = (16.4, 19.7)
SHORE_CROSSING_STRIPES = tuple((122.63 + i * 0.59, 122.97 + i * 0.59) for i in range(12))
WAYPOINTS = (
    (0, -21.4),
    (2.3, -29.4),
    (3.35, -30.4),
    (6.99, -34.04),
    (10.52, -37.57),
    (10.6, -39.7),
    (6.3, -43.7),
    (6.3, -58.15),
    (11.45, -58.15),
)
GOVERNANCE_WAYPOINTS = (
    (8.0, 19.7),
    (4.4, 27.8),
    (5.7, 31.15),
    (7.15, 34.8),
    (9.35, 39.6),
    (6.6, 44.4),
    (6.6, 57.8),
    (11.9, 59.25),
    (11.9, 69.1),
    (0.0, 73.6),
    (0.0, 81.10),
)
PLAZA_CONNECTOR = (
    WAYPOINTS[0],
    (2, -22.4),
    (16.7, -22.4),
    (19.8, -17.0),
    (21.9, -12.0),
    (22.5, -6.0),
    (22.6, 7.0),
    (21.0, 14.7),
    (17.4, 18.0),
    GOVERNANCE_WAYPOINTS[0],
)
MARKET_GREETING_WAYPOINTS = ((7.2, -59.65), (11.45, -59.65))
EAST_JUNCTION = (95, -31.8)
EAST_JUNCTION_ALT = (96, -31.05)
EAST_AVENUE = (
    (24.59, -16.6), (25.83, -17.17), (32.4, -20.1), (33.7, -20.7),
    (35.98, -22.3), (37.65, -23.6), (47, -30), (53.55, -31.8), EAST_JUNCTION,
)
EAST_AVENUE_ALT = (
    (24.55, -15.8), (25.83, -16.36), (32.4, -19.29), (33.7, -19.89),
    (35.98, -21.49), (37.65, -22.79), (47, -29.19), (53.55, -31.05),
    (70, -31.05), (76, -32.62), (91, -32.62), EAST_JUNCTION_ALT,
)
REGISTRY_WAYPOINTS = (
    EAST_JUNCTION, (95, -12), (94.3, -8), (94.3, 8.4), (92.6, 11.2), (80, 13.9),
)
REGISTRY_ALTERNATE = (EAST_JUNCTION_ALT, (96, 9), (93.6, 12.1), (80.8, 14.5))
WORKS_WAYPOINTS = (EAST_JUNCTION, (95, -60.55), (95, -72.2))
WORKS_ALTERNATE = (EAST_JUNCTION_ALT, (96, -61.2), (96.65, -66.4), (96.65, -72.2))
FORUM_WAYPOINTS = (
    WAYPOINTS[0], (-8, -22), (-16.7, -22.4), (-19.8, -17), (-24.59, -16.6),
    (-26, -17.2), (-33.7, -20.7), (-37.65, -23.6), (-47, -30),
    (-53.55, -31.8), (-58, -37.6), (-73.6, -37.6), (-74.6, -51), (-74.6, -54.8),
    (-91.8, -55.3), (-93.7, -58.5), (-92.26, -64), (-92.26, -68.4), (-94.12, -74.9),
)
FORUM_ALTERNATE = (
    (-8, -21.16), (-16.7, -21.56), (-19.8, -16.16), (-24.59, -15.8),
    (-26, -16.4), (-33.7, -19.9), (-37.65, -22.8), (-47, -29.2),
    (-53.55, -31.05), (-58, -36.8), (-73.6, -36.8), (-73.75, -51), (-73.75, -54.8),
    (-90.95, -55.3), (-92.7, -58.5), (-91.46, -64), (-91.46, -68.4), (-93.21, -75.1),
)
SHORE_HALL_SIDE = ((8, 77), (10, 77), (13, 82.5), (16, 84.5), (17, 85.5), (17, 108))
SHORE_WAYPOINTS = (
    GOVERNANCE_WAYPOINTS[-1], *SHORE_HALL_SIDE, (16.5, 117), (17.5, 119.5),
    (17.5, 132.5), (8.5, 134), (7.5, 136), (6.5, 146.8), (4, 151.6),
    (4, 165.3), (71, 165.3), (71, 174), (71, 190),
)
SHORE_ALTERNATE = (
    *SHORE_HALL_SIDE, (16.5, 115.5), (17, 117.5), (18.5, 119.5), (18.5, 132.5),
    (8.5, 134), (7.5, 136), (7.25, 146.8), (3.15, 151.6),
    (3.15, 166.15), (71.85, 166.15), (71.85, 174), (71.85, 190),
)
EAST_HEROES = {
    "HERO_03_Citizen_Registration": "registry",
    "HERO_04_Public_Construction": "works",
}
LAYERS = {
    "ROADS",
    "PLAZA",
    "PUBLIC_FACILITIES",
    "VEGETATION",
    "PLACEHOLDER_BUILDINGS",
    "05_Street_Architecture",
    "09 | South commercial corner",
    "11 | Avenue buildings",
    "12 | Fountains and forum",
    "13 | Street terraces",
    "14 | Street vehicles",
    "19 | Corner Market",
    "01 | Pedestrian crossings",
    "ENVIRONMENT",
}
SKIP = (
    "CIVRUM_ENV_GROUND",
    "CIVRUM_LOT_",
    "Civic reflecting pool",
    "Forum |",
    "Nexus | boulevard guides",
    "Nexus | radial garden",
    "South garden |",
)
MARKET_SHELL = (
    "Market | Level ",
    "Market | Stone apron",
    "Market | Wraparound rain canopy",
    "Market | Roof plant room",
    "Market | NEXCIV",
)
GARDEN_RETAIL = "HI3D | Garden Roof Retail"
CHUNKS = {
    "base": "nexus-market.glb",
    "street": "nexus-street-detail.glb",
    "market": "corner-market-detail.glb",
    "governance": "governance-north.glb",
    "retail": "garden-roof-retail-detail.glb",
    "east": "east-civic-district.glb",
    "registry": "citizen-registry-detail.glb",
    "works": "public-construction-detail.glb",
    "west": "west-community-district.glb",
    "shore": "north-lakeshore.glb",
}
SHORE_LAYER_NAMES = {
    "01 | Terrain and shore", "02 | Lake", "03 | Promenade and piers", "04 | Shore trees", "Marina boats",
}
LAKE_SURFACE = "CIVRUM_Lake_Surface"
PARKLAND = "City parkland"


def in_slice(obj, matrix, area):
    points = [matrix @ Vector(co) for co in obj.bound_box]
    low_y = min(p.y for p in points)
    top_y = max(p.y for p in points)
    low_x = min(p.x for p in points)
    top_x = max(p.x for p in points)
    central_x = top_x > WEST and low_x < EAST
    base = central_x and top_y > SOUTH and low_y < NORTH
    governance = central_x and top_y > NORTH and NORTH <= low_y < GOVERNANCE_NORTH
    if area == "east":
        return not (base or governance) and top_x > EAST and low_x < 143 and top_y > -125 and low_y < 44
    if area == "west":
        return not (base or governance) and low_x < WEST and top_x > -151 and top_y > -130 and low_y < 15
    if area == "shore":
        return not (base or governance) and top_y > 116 and low_y < 164 and top_x > -153 and low_x < 153
    return governance if area == "governance" else base


def world_geometry(scene, graph, area):
    layers = bpy.data.collections
    named_layers = LAYERS.copy()
    if area in {"governance", "east", "west"}:
        named_layers.add("05_Street_Assets")
    if area in {"governance", "east"}:
        named_layers.add("03_Hero_Landmarks")
    if area == "east":
        named_layers.update(("CONSTRUCTION", "10 | Construction crane", "02 | Public Works at eye level"))
    if area == "shore":
        named_layers.update(SHORE_LAYER_NAMES)
        named_layers.update(("05_Street_Assets", "08 | Lakeside tower", "20 | NEXCIV Waterfront Tower"))
    candidates = {ob for name in named_layers for ob in layers[name].objects if ob.name in scene.objects}
    lot_types = {"governance": "GOVERNANCE", "east": "CONSTRUCTION", "west": "COMMUNITY"}
    lot = lot_types.get(area)
    for obj in sorted(candidates, key=lambda item: item.name):
        civic_paving = lot and obj.name.startswith((f"CIVRUM_LOT_{lot}", f"CIVRUM_LOT_PAINT_{lot}"))
        scenery = (
            area in {"east", "west"} and obj.name.startswith("Civic reflecting pool")
        ) or (area == "west" and obj.name.startswith("Forum |"))
        if obj.hide_render or obj.hide_viewport or (obj.name.startswith(SKIP) and not (civic_paving or scenery)):
            continue
        if obj.name.startswith("HERO_"):
            heroes = EAST_HEROES if area == "east" else ("HERO_01_Governance_Hall",)
            if obj.name not in heroes:
                continue
        if area == "shore" and any(group.name in SHORE_LAYER_NAMES for group in obj.users_collection):
            # The lake and shaped banks extend past the regular street chunks.
            name = obj.name
            if obj.type == "MESH" and not name.startswith(("South ", "Pocket garden", "Belt road", "Southern ")):
                bounds = [obj.matrix_world @ Vector(co) for co in obj.bound_box]
                if max(point.y for point in bounds) > 111:
                    if name.startswith(("Park woodland", "Far bank woodland")):
                        x, y, _ = obj.matrix_world.translation
                        if abs(x) > 285 or y > 410:
                            continue
                        # Thin the distant crowns without changing the authored quayside planting.
                        index = name.rpartition(".")[2]
                        if (y > 230 or abs(x) > 154) and index.isdigit() and int(index) % 3:
                            continue
                    tier = "water" if name == LAKE_SURFACE else "land" if name in (PARKLAND, "Far shore parkland") else "shore"
                    yield obj.evaluated_get(graph), obj.matrix_world, tier
            continue
        if obj.instance_collection:
            for part in obj.instance_collection.all_objects:
                matrix = (
                    obj.matrix_world
                    @ Matrix.Translation(-obj.instance_collection.instance_offset)
                    @ part.matrix_world
                )
                if part.type == "MESH" and in_slice(part, matrix, area):
                    yield part, matrix, "buildings" if "retail" in part.name.lower() else "detail"
        elif obj.type in {"MESH", "FONT"} and in_slice(obj, obj.matrix_world, area):
            name = obj.name
            if name.startswith("CIVRUM_BANNER_DISTRICT_CODE"):
                continue
            if name.startswith(("CIVRUM_PH_", "CIVRUM_Streetfront_")) and "NEXUS" not in name:
                continue
            if min(obj.dimensions.x, obj.dimensions.y) > 95:
                continue
            # Preserve road markings, beacon, shelter and wayfinding across camera ranges.
            subgroup = (
                "detail"
                if any(
                    token in name
                    for token in (
                        "FLOWERS",
                        "SHRUB",
                        "railing",
                        "BANNER",
                        "BOLLARD",
                        "BIN_",
                        "Bollard",
                        "Vent",
                        "Ceramics",
                    )
                )
                else "city"
            )
            if name.startswith(("CIVRUM_ROAD_", "CIVRUM_PLAZA_TILE", "CIVRUM_PLAZA_SEATING_APRON")):
                subgroup = "paving"
            if name in EAST_HEROES:
                subgroup = f"{EAST_HEROES[name]}_proxy"
            if lot and (
                civic_paving or name.startswith(("WALK_Paving_", "CIVRUM_WALK_", "Forecourt | limestone paver"))
            ):
                subgroup = "paving"
            yield obj.evaluated_get(graph), obj.matrix_world, subgroup


def sidewalk_route(scene, graph, waypoints, clearance=0.0):
    route = []
    for start, end in pairwise(waypoints):
        start, end = Vector(start), Vector(end)
        intervals = math.ceil((end - start).length / 0.5)
        for index in range(intervals):
            point = start.lerp(end, index / intervals)
            route.append(tuple(point))
    route.append(waypoints[-1])
    result = []
    for x, y in route:
        hit, point, _, _, obj, _ = scene.ray_cast(graph, (x, y, 1.52), (0, 0, -1), distance=1.85)
        if not hit:
            raise RuntimeError(f"Missing ground at {(x, y)}")
        if point.z > 0.45:
            raise RuntimeError(f"Blocked route at {(x, y)} by {obj.name} at {point.z}")
        if clearance:
            for dx, dy in ((clearance, 0), (-clearance, 0), (0, clearance), (0, -clearance)):
                blocked, blocker, _, _, obstacle, _ = scene.ray_cast(
                    graph, (x + dx, y + dy, 1.9), (0, 0, -1), distance=2.10
                )
                if not blocked or blocker.z > 0.45:
                    raise RuntimeError(f"Insufficient clearance at {(x, y)} next to {obstacle}")
        result.append([round(x, 3), round(point.z, 3), round(-y, 3)])
    return result


def alternate_lanes(scene, graph):
    """Offset the continuous spine before splitting it, so all shared nodes still line up."""
    spine = [
        Vector(point) for point in (*reversed(WAYPOINTS), *PLAZA_CONNECTOR[1:], *GOVERNANCE_WAYPOINTS[1:])
    ]
    tangents = [(end - start).normalized() for start, end in pairwise(spine)]
    normals = [Vector((-direction.y, direction.x)) for direction in tangents]
    alternate = []
    for i, point in enumerate(spine):
        before = normals[max(0, i - 1)]
        after = normals[min(i, len(normals) - 1)]
        bisector = (before + after).normalized()
        alternate.append(point - bisector * (0.84 / max(0.5, bisector.dot(after))))
    south = len(WAYPOINTS) - 1
    north = south + len(PLAZA_CONNECTOR) - 1
    # Follow the outer part of the slope where the curb turns into the north crossing.
    alternate[north + 1].x += 0.32
    alternate[north + 2].x += 0.32
    # The second Agent stops at the Market's sidewalk corner, clear of the greeting spot.
    spans = (list(reversed(alternate[1 : south + 1])), alternate[south : north + 1], alternate[north:])
    return [sidewalk_route(scene, graph, span, clearance=0.22) for span in spans], alternate[south : south + 4]


def paint_crossing(mesh, transform, white, asphalt, across, bands, cross_axis=0):
    """Cut the existing roadway into paint regions at the pedestrian approach."""
    inverse = transform.inverted()
    axes = transform.to_3x3().transposed()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    planes = [(cross_axis, value) for value in across]
    planes.extend((1 - cross_axis, value) for band in bands for value in band)
    for coordinate, value in planes:
        point, normal = Vector((0, 0, 0)), Vector((0, 0, 0))
        point[coordinate], normal[coordinate] = value, 1
        bmesh.ops.bisect_plane(
            bm,
            geom=[*bm.verts, *bm.edges, *bm.faces],
            dist=0.00001,
            plane_co=inverse @ point,
            plane_no=axes @ normal,
        )
    for face in bm.faces:
        pos = transform @ face.calc_center_median()
        band_pos = pos[1 - cross_axis]
        if not (across[0] < pos[cross_axis] < across[1] and bands[0][0] <= band_pos <= bands[-1][1]):
            continue
        if all(abs((transform @ vertex.co).z - ROAD_Z) < 0.0001 for vertex in face.verts):
            face.material_index = white if any(start < band_pos < end for start, end in bands) else asphalt
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def trim_parkland(mesh, transform):
    """Match the north edge of the starter terrain at 111 m."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.bisect_plane(
        bm,
        geom=[*bm.verts, *bm.edges, *bm.faces],
        dist=0.00001,
        plane_co=transform.inverted() @ Vector((0, 111, 0)),
        plane_no=transform.to_3x3().transposed() @ Vector((0, 1, 0)),
        clear_inner=True,
    )
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def stage_assets(scene, graph, chunk):
    root = bpy.data.collections.new("NEXCIV web export")
    scene.collection.children.link(root)
    glass = material("NEXCIV browser glazing", "B0B9BF", 0.20, 0.25)
    shader(glass).inputs["Alpha"].default_value = 0.26
    transparent = {glass}
    solid_window = material("NEXCIV starter glazing", "505553", 0.24, 0.32)
    texture_limit = {"base": 512, "retail": 2048, "registry": 2048, "works": 2048}.get(chunk, 1024)
    pbr = {}
    textures = {}

    def export_material(source):
        if source.name == "MAT_SHOP_Glass":
            return solid_window if chunk == "base" else glass
        if source in pbr or not source.use_nodes:
            return pbr.get(source, source)
        finish = source.copy()
        pbr[source] = finish
        surface = next((node for node in finish.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
        if surface is None:
            return finish
        if source.name == "Walkthrough | entry clear glass":
            # Translate Blender's Transparent BSDF mix into glTF alpha blending.
            output = next(node for node in finish.node_tree.nodes if node.type == "OUTPUT_MATERIAL")
            finish.node_tree.links.new(surface.outputs[0], output.inputs["Surface"])
            surface.inputs["Alpha"].default_value = 0.08
            finish.surface_render_method = "BLENDED"
            transparent.add(finish)
        base = surface.inputs["Base Color"]
        if base.is_linked and base.links[0].from_node.type not in {"TEX_IMAGE", "VERTEX_COLOR"}:
            links = finish.node_tree.links
            upstream = base.links[0].from_node
            atlas = upstream.inputs["Color"].links if upstream.type == "HUE_SAT" else ()
            if atlas and atlas[0].from_node.type == "TEX_IMAGE":
                # glTF can't export Blender's Hue/Saturation node. Keep the atlas and its UVs.
                links.new(atlas[0].from_socket, base)
            else:
                links.remove(base.links[0])
                base.default_value = source.diffuse_color
        for node in finish.node_tree.nodes:
            if node.type != "TEX_IMAGE" or node.image is None:
                continue
            image = node.image
            if max(image.size) <= texture_limit:
                continue
            if image not in textures:
                resized = image.copy()
                factor = texture_limit / max(image.size)
                resized.scale(*(max(1, round(n * factor)) for n in image.size))
                textures[image] = resized
            node.image = textures[image]
        return finish

    crossings = {
        ("governance", GOVERNANCE_CROSSING_ROAD): (GOVERNANCE_CROSSING_X, GOVERNANCE_CROSSING_STRIPES, 0),
        ("east", EAST_CROSSING_ROAD): (EAST_CROSSING_X, EAST_CROSSING_STRIPES, 0),
        ("west", WEST_CROSSING_ROAD): (WEST_CROSSING_Y, WEST_CROSSING_STRIPES, 1),
        ("shore", SHORE_CROSSING_ROAD): (SHORE_CROSSING_X, SHORE_CROSSING_STRIPES, 0),
    }
    cache, parts = {}, []
    area = "east" if chunk in {"east", "registry", "works"} else chunk
    for source, transform, tier in world_geometry(scene, graph, area):
        name = source.original.name
        if chunk == "retail" and not name.startswith(GARDEN_RETAIL):
            continue
        if chunk in {"registry", "works"} and EAST_HEROES.get(name) != chunk:
            continue
        market = name.startswith("Market | ")
        street = tier in ("detail", "buildings") or name.startswith("Courtyard | roses")
        street_proxy = street and chunk == "base"
        market_proxy = market and chunk == "base"
        if (chunk == "market" and not market) or (chunk == "street" and (market or not street)):
            continue
        if market_proxy and not name.startswith(MARKET_SHELL):
            continue
        if street_proxy and (source.type != "MESH" or len(source.data.polygons) < 55000):
            continue
        key = source.original.data
        mesh = cache.get(key) if len(source.modifiers) == 0 and source.type == "MESH" else None
        if mesh is None:
            if market_proxy and source.type == "MESH":
                mesh = source.original.data.copy()
            else:
                mesh = bpy.data.meshes.new_from_object(source.evaluated_get(graph), depsgraph=graph)
            mesh.validate(clean_customdata=False)
            if source.type == "MESH" and not source.modifiers:
                cache[key] = mesh
        # Preserve original object-level finish overrides, including the white paint in the road.
        asset = bpy.data.objects.new(source.name, mesh)
        root.objects.link(asset)
        asset.matrix_world = Matrix.Identity(4) if chunk == "retail" else transform
        if chunk == "shore" and name == PARKLAND:
            trim_parkland(mesh, transform)
        if name.startswith("CIVRUM_LOT_PAINT_"):
            # The lettering and the top of the stone are both at 0.182 m in the source scene.
            asset.location.z += 0.004
        if crossing := crossings.get((chunk, name)):
            mesh = asset.data = mesh.copy()
            slots = {slot.material.name: i for i, slot in enumerate(source.material_slots) if slot.material}
            paint_crossing(mesh, transform, slots[WHITE], slots[ASPHALT], *crossing)
        for index, original in enumerate(source.material_slots):
            if not original.material:
                continue
            slot = asset.material_slots[index]
            slot.link = "OBJECT"
            slot.material = export_material(original.material)
        # Keep repeated asset meshes shared, reducing each large source once.
        if market_proxy:
            tier = "market_proxy"
        elif street_proxy:
            tier = "street_proxy"
        asset["previewTier"] = "detail" if chunk in {"registry", "works"} else tier
        if chunk == "retail":
            parts.append((asset, 180000))
            break
        if chunk == "works":
            parts.append((asset, 230000))
        elif chunk == "east" and len(mesh.polygons) > 10000:
            face_limit = {"registry_proxy": 18500, "works_proxy": 61000}.get(tier, 9000)
            if name.startswith(GARDEN_RETAIL):
                face_limit = 30000
            if len(mesh.polygons) > face_limit:
                parts.append((asset, face_limit))
        elif chunk == "west" and len(mesh.polygons) > 55000:
            parts.append((asset, 30000 if name.startswith(GARDEN_RETAIL) else 14000))
        elif chunk == "shore" and len(mesh.polygons) > 20000:
            parts.append((asset, 30000 if name.startswith(GARDEN_RETAIL) else 12000))
        elif chunk == "governance" and len(mesh.polygons) > 10000:
            parts.append((asset, 52000 if name == "HERO_01_Governance_Hall" else 6500))
        elif name.startswith("Courtyard | roses") and len(mesh.polygons) > 12000:
            parts.append((asset, 12000))
        elif len(mesh.polygons) > 55000:
            face_limit = 2200 if street_proxy else 30000
            parts.append((asset, face_limit))

    if chunk == "retail" and len(parts) != 1:
        raise RuntimeError("Expected a single Garden Roof Retail source mesh")
    if chunk in {"registry", "works"} and len(root.objects) != 1:
        raise RuntimeError(f"Expected one landmark source mesh for {chunk}")

    reduced = {}
    for obj, face_limit in parts:
        key = obj.data
        if key not in reduced:
            modifier = obj.modifiers.new("Preview silhouette", "DECIMATE")
            modifier.ratio = min(1.0, face_limit / len(key.polygons))
            bpy.context.view_layer.update()
            reduced[key] = bpy.data.meshes.new_from_object(obj.evaluated_get(graph), depsgraph=graph)
            reduced[key].validate(clean_customdata=False)
            if (chunk in {"street", "retail", "east", "west", "shore"} and obj.name.startswith(GARDEN_RETAIL)) or (
                chunk in {"east", "works"} and obj.name in EAST_HEROES
            ):
                mesh = reduced[key]
                mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
                mesh.set_sharp_from_angle(angle=math.radians(35))
            obj.modifiers.remove(modifier)
        obj.data = reduced[key]

    # Batch stable surfaces while keeping repeated meshes shared and both replacements independent.
    bpy.ops.object.select_all(action="DESELECT")
    shared = set(reduced.values())
    for tier in ("city", "paving", "detail", "market_proxy", "land", "shore", "water"):
        keep = [
            o
            for o in root.objects
            if o["previewTier"] == tier
            and o.data not in shared
            and not any(slot.material in transparent for slot in o.material_slots)
        ]
        if len(keep) == 1:
            keep[0].name = "NEXCIV " + tier
        if len(keep) < 2:
            continue
        for obj in keep:
            obj.select_set(True)
        head = keep[0]
        bpy.context.view_layer.objects.active = head
        bpy.ops.object.join()
        head.name = "NEXCIV " + tier
        head.select_set(False)
    terrain = {
        "base": ((4, -19, -0.006), (260, 260, 1)),
        "east": ((173, -40, -0.006), (78, 220, 1)),
        "west": ((-165, -40, -0.006), (78, 220, 1)),
    }
    if chunk in terrain:
        location, scale = terrain[chunk]
        bpy.ops.mesh.primitive_plane_add(size=1, location=location)
        ground = bpy.context.object
        ground.name = "NEXCIV terrain"
        ground.scale = scale
        ground.data.materials.append(material("NEXCIV ground", "55564F", 0.89))
        root.objects.link(ground)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in root.objects:
        if obj.name in scene.objects:
            obj.select_set(True)
    return root


@contextmanager
def precise_meshopt_positions():
    """Blender 5.3 uses 12-bit shared precision, collapsing adjacent paving layers."""
    encode = meshopt.MeshoptEncoder.encode_attribute

    def encode_attribute(name, data, stride, settings):
        if name != "POSITION":
            return encode(name, data, stride, settings)
        original_bits = meshopt.EXP_FILTER_BITS
        meshopt.EXP_FILTER_BITS = 19
        try:
            return encode(name, data, stride, settings)
        finally:
            meshopt.EXP_FILTER_BITS = original_bits

    meshopt.MeshoptEncoder.encode_attribute = staticmethod(encode_attribute)
    try:
        yield
    finally:
        meshopt.MeshoptEncoder.encode_attribute = staticmethod(encode)


def export_chunk(path):
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_image_format="JPEG",
        export_jpeg_quality=83,
        export_meshopt_compression_enable=True,
        export_meshopt_extension="EXT_meshopt_compression",
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEST)
    parser.add_argument("--chunk", choices=CHUNKS)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene = bpy.context.scene
    scene.frame_set(1)
    graph = bpy.context.evaluated_depsgraph_get()
    route = sidewalk_route(scene, graph, WAYPOINTS)
    north_route = sidewalk_route(scene, graph, GOVERNANCE_WAYPOINTS, clearance=0.23)
    connector = sidewalk_route(scene, graph, PLAZA_CONNECTOR, clearance=0.28)
    (market_lane, plaza_lane, north_lane), east_prefix = alternate_lanes(scene, graph)
    market_guest = sidewalk_route(scene, graph, MARKET_GREETING_WAYPOINTS, clearance=0.32)
    if any(point[1] < 0.15 for point in market_guest):
        raise RuntimeError("The Market greeting approach must stay on the sidewalk")
    east_routes = {
        name: {
            "points": sidewalk_route(scene, graph, waypoints, clearance=0.22),
            "alternate": sidewalk_route(scene, graph, alternate, clearance=0.22),
        }
        for name, waypoints, alternate in (
            ("avenue", (*PLAZA_CONNECTOR[:4], *EAST_AVENUE), (*east_prefix, *EAST_AVENUE_ALT)),
            ("registry", REGISTRY_WAYPOINTS, REGISTRY_ALTERNATE),
            ("works", WORKS_WAYPOINTS, WORKS_ALTERNATE),
        )
    }
    forum_route = {
        "points": sidewalk_route(scene, graph, FORUM_WAYPOINTS, clearance=0.22),
        "alternate": sidewalk_route(scene, graph, (east_prefix[0], *FORUM_ALTERNATE), clearance=0.22),
    }
    shore_route = None
    if args.chunk in {None, "shore"}:
        end_x, _, end_z = north_lane[-1]
        shore_route = {
            "points": sidewalk_route(scene, graph, SHORE_WAYPOINTS, clearance=0.22),
            "alternate": sidewalk_route(scene, graph, ((end_x, -end_z), *SHORE_ALTERNATE), clearance=0.22),
        }
    args.output.mkdir(parents=True, exist_ok=True)
    for chunk, filename in CHUNKS.items():
        if args.chunk and chunk != args.chunk:
            continue
        root = stage_assets(scene, graph, chunk)
        path = args.output / filename
        with precise_meshopt_positions():
            export_chunk(path)
        print(f"PREVIEW {chunk}: {len(root.objects)} nodes, {path.stat().st_size:,} bytes", flush=True)
        for obj in list(root.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.collections.remove(root)
    manifest = {"points": route, "alternate": market_lane, "target": [1, 0, 24]}
    (args.output / "route.json").write_text(
        json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    (args.output / "governance-route.json").write_text(
        json.dumps(
            {"points": north_route, "alternate": north_lane, "target": [0, 0, -15]}, separators=(",", ":")
        )
        + "\n",
        encoding="utf-8",
    )
    (args.output / "nexus-connector.json").write_text(
        json.dumps({"points": connector, "alternate": plaza_lane}, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    (args.output / "market-greeting.json").write_text(
        json.dumps({"points": market_guest}, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    (args.output / "east-routes.json").write_text(
        json.dumps(east_routes, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    (args.output / "west-route.json").write_text(
        json.dumps(forum_route, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    if shore_route:
        (args.output / "lakeshore-route.json").write_text(
            json.dumps(shore_route, separators=(",", ":")) + "\n", encoding="utf-8"
        )
    print(f"PREVIEW PASS {len(route)} market and {len(north_route)} governance route samples", flush=True)


if __name__ == "__main__":
    main()
