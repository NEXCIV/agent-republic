"""Run in the saved Blender scene to check parcel occupancy, roads and shared asset libraries."""

from collections import Counter
from itertools import combinations, pairwise
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.geometry import convex_hull_2d


def footprint(obj):
    geometry = obj
    transform = obj.matrix_world
    if obj.instance_collection:
        (geometry,) = obj.instance_collection.objects
        transform = transform @ geometry.matrix_world
    # Road corners and diagonal sidewalks need their actual polygon, not a world-aligned box.
    vertices = (
        (v.co for v in geometry.data.vertices)
        if obj.name.startswith("CIVRUM_ROAD")
        else (Vector(v) for v in geometry.bound_box)
    )
    points = [(transform @ point).xy for point in vertices]
    return [points[i] for i in convex_hull_2d(points)]


def overlaps(left, right, tolerance=0.02):
    for polygon in (left, right):
        for a, b in pairwise([*polygon, polygon[0]]):
            edge = b - a
            normal = Vector((edge.y, -edge.x)).normalized()
            first = [v.dot(normal) for v in left]
            second = [v.dot(normal) for v in right]
            if max(first) <= min(second) + tolerance or max(second) <= min(first) + tolerance:
                return False
    return True


def main():
    scene = bpy.context.scene
    assert tuple(scene.objects["CIVRUM_ENV_GROUND_MAIN"].dimensions) == (300, 300, 0)
    assert scene.camera.name == "LAKE_CAM_01 | City overview"
    buildings = [o for o in scene.objects if o.get("replaces", "").startswith("CIVRUM_PH_INFILL")]
    old_slots = set(bpy.data.collections["CONTEXT_MASSING"].objects)
    replaced = []
    for obj in buildings:
        mass, front = (scene.objects[name] for name in obj["replaces"].split(", "))
        assert all(o.hide_render and o.hide_viewport for o in (mass, front)), obj.name
        replaced.append(mass)
    assert len(replaced) == len(old_slots) == 56 and set(replaced) == old_slots
    roads = {o.name: footprint(o) for o in bpy.data.collections["ROADS"].objects if "CROSSWALK" not in o.name}
    lots = {o.name: footprint(o) for o in buildings}
    for (a, left), (b, right) in combinations(lots.items(), 2):
        assert not overlaps(left, right), (a, b)
    for name, polygon in lots.items():
        for road, other in roads.items():
            assert not overlaps(polygon, other), (name, road)

    collections = Counter(o.instance_collection for o in scene.objects if o.instance_collection)
    for lib in bpy.data.libraries:
        assert lib.filepath.startswith("//") and Path(bpy.path.abspath(lib.filepath)).is_file(), lib.filepath
    for group in collections:
        (model,) = group.objects
        images = {n.image for m in model.data.materials for n in m.node_tree.nodes if n.type == "TEX_IMAGE"}
        assert images and all(im and im.packed_file for im in images), group.name
    for obj in bpy.data.collections["14 | Street vehicles"].objects:
        assert any(overlaps(footprint(obj), polygon) for polygon in roads.values()), obj.name
    print(
        f"Verified {len(lots)} occupied parcels, {len(roads)} road modules and {len(bpy.data.libraries)} libraries."
    )
    print({group.name: count for group, count in collections.items()})


if __name__ == "__main__":
    main()
