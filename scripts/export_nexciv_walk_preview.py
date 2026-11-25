"""Export the walkable Nexus to Corner Market slice from the NEXCIV Blender scene."""

import argparse
import json
import math
import sys
from itertools import pairwise
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_lakeside import material, shader
from build_nexciv_road_markings import DESTINATION as SOURCE

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "apps/web/public/nexciv-walk"
WEST, EAST, SOUTH, NORTH = -52, 53, -81, 46
WAYPOINTS = (
    (0, -21.4),
    (2.3, -29.4),
    (3.35, -30.4),
    (6.99, -34.04),
    (10.52, -37.57),
    (10.6, -39.7),
    (6.3, -43.7),
    (6.3, -57.85),
    (11.45, -57.85),
)
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


def in_slice(obj, matrix):
    points = [matrix @ Vector(co) for co in obj.bound_box]
    return (
        max(p.x for p in points) > WEST
        and min(p.x for p in points) < EAST
        and max(p.y for p in points) > SOUTH
        and min(p.y for p in points) < NORTH
    )


def world_geometry(scene, graph):
    layers = bpy.data.collections
    candidates = {ob for name in LAYERS for ob in layers[name].objects if ob.name in scene.objects}
    for obj in sorted(candidates, key=lambda item: item.name):
        if obj.hide_render or obj.hide_viewport or obj.name.startswith(SKIP):
            continue
        if obj.instance_collection:
            for part in obj.instance_collection.all_objects:
                matrix = (
                    obj.matrix_world
                    @ Matrix.Translation(-obj.instance_collection.instance_offset)
                    @ part.matrix_world
                )
                if part.type == "MESH" and in_slice(part, matrix):
                    yield part, matrix, "buildings" if "retail" in part.name.lower() else "detail"
        elif obj.type in {"MESH", "FONT"} and in_slice(obj, obj.matrix_world):
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
            yield obj.evaluated_get(graph), obj.matrix_world, subgroup


def sidewalk_route(scene, graph):
    route = []
    for start, end in pairwise(WAYPOINTS):
        start, end = Vector(start), Vector(end)
        intervals = math.ceil((end - start).length / 0.5)
        for index in range(intervals):
            point = start.lerp(end, index / intervals)
            route.append(tuple(point))
    route.append(WAYPOINTS[-1])
    result = []
    for x, y in route:
        hit, point, _, _, obj, _ = scene.ray_cast(graph, (x, y, 1.52), (0, 0, -1), distance=1.85)
        if not hit:
            raise RuntimeError(f"Missing ground at {(x, y)}")
        if point.z > 0.45:
            raise RuntimeError(f"Blocked route at {(x, y)} by {obj.name} at {point.z}")
        result.append([round(x, 3), round(point.z, 3), round(-y, 3)])
    return result


def stage_assets(scene, graph):
    root = bpy.data.collections.new("NEXCIV web export")
    scene.collection.children.link(root)
    glass = material("NEXCIV browser glazing", "B0B9BF", 0.20, 0.25)
    shader(glass).inputs["Alpha"].default_value = 0.26
    pbr = {}
    textures = {}

    def export_material(source):
        if source.name == "MAT_SHOP_Glass":
            return glass
        if source in pbr or not source.use_nodes:
            return pbr.get(source, source)
        finish = source.copy()
        pbr[source] = finish
        surface = next((node for node in finish.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
        if surface is None:
            return finish
        base = surface.inputs["Base Color"]
        if base.is_linked and base.links[0].from_node.type != "TEX_IMAGE":
            finish.node_tree.links.remove(base.links[0])
            base.default_value = source.diffuse_color
        for node in finish.node_tree.nodes:
            if node.type != "TEX_IMAGE" or node.image is None:
                continue
            image = node.image
            if max(image.size) <= 1024:
                continue
            if image not in textures:
                resized = image.copy()
                factor = 1024 / max(image.size)
                resized.scale(*(max(1, round(n * factor)) for n in image.size))
                textures[image] = resized
            node.image = textures[image]
        return finish

    cache, parts = {}, []
    for source, transform, tier in world_geometry(scene, graph):
        key = source.original.data
        mesh = cache.get(key) if len(source.modifiers) == 0 and source.type == "MESH" else None
        if mesh is None:
            mesh = bpy.data.meshes.new_from_object(source.evaluated_get(graph), depsgraph=graph)
            if source.type == "MESH" and not source.modifiers:
                cache[key] = mesh
        # Preserve original object-level finish overrides, including the white paint in the road.
        asset = bpy.data.objects.new(source.name, mesh)
        root.objects.link(asset)
        asset.matrix_world = transform
        for index, original in enumerate(source.material_slots):
            if not original.material:
                continue
            slot = asset.material_slots[index]
            slot.link = "OBJECT"
            slot.material = export_material(original.material)
        # Keep repeated asset meshes shared, reducing each large source once.
        if len(mesh.polygons) > 55000:
            asset["previewReduce"] = True
        asset["previewTier"] = tier
        parts.append(asset)

    reduced = {}
    for obj in parts:
        if not obj.get("previewReduce"):
            continue
        key = obj.data
        if key not in reduced:
            modifier = obj.modifiers.new("Preview silhouette", "DECIMATE")
            modifier.ratio = 30000 / len(key.polygons)
            bpy.context.view_layer.update()
            reduced[key] = bpy.data.meshes.new_from_object(obj.evaluated_get(graph), depsgraph=graph)
            obj.modifiers.remove(modifier)
        obj.data = reduced[key]

    # Merge untextured pavement/fixtures by material into two batches while retaining the original UVs.
    bpy.ops.object.select_all(action="DESELECT")
    shared = set(reduced.values())
    for tier in ("city", "paving", "detail"):
        keep = [
            o
            for o in root.objects
            if o["previewTier"] == tier
            and o.data not in shared
            and not any(slot.material == glass for slot in o.material_slots)
        ]
        if not keep:
            continue
        for obj in keep:
            obj.select_set(True)
        head = keep[0]
        bpy.context.view_layer.objects.active = head
        bpy.ops.object.join()
        head.name = "NEXCIV " + tier
        head.select_set(False)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(4, -19, -0.006))
    ground = bpy.context.object
    ground.name = "NEXCIV terrain"
    ground.scale = (260, 260, 1)
    ground.data.materials.append(material("NEXCIV ground", "55564F", 0.89))
    root.objects.link(ground)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in root.objects:
        if obj.name in scene.objects:
            obj.select_set(True)
    return root


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEST)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene = bpy.context.scene
    scene.frame_set(1)
    graph = bpy.context.evaluated_depsgraph_get()
    route = sidewalk_route(scene, graph)
    root = stage_assets(scene, graph)
    args.output.mkdir(parents=True, exist_ok=True)
    output = args.output / "nexus-market.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(output),
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
    manifest = {"points": route, "target": [1, 0, 24]}
    (args.output / "route.json").write_text(
        json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    print(
        f"PREVIEW PASS {len(root.objects)} nodes, {len(route)} walk samples, {output.stat().st_size:,} bytes",
        flush=True,
    )


if __name__ == "__main__":
    main()
