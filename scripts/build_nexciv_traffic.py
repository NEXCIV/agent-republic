"""Export the original vehicle meshes and verify right-hand lanes on the roads master."""

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_world import ROAD_Z, road_graph
from export_nexciv_walk_preview import (
    DEST,
    SOURCE,
    export_chunk,
    precise_meshopt_positions,
)

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "apps/web/src/app/nexciv-preview/traffic-layout.json"


def normals(direction):
    # In Blender's north-up plane, right of the heading is the clockwise normal.
    return Vector((direction.y, -direction.x))


def lane(outline, turn_trim, lane_offset):
    route = []
    for index, point in enumerate(outline):
        corner = Vector(point)
        a = (corner - Vector(outline[index - 1])).normalized()
        b = (Vector(outline[(index + 1) % len(outline)]) - corner).normalized()
        if a.dot(b) > 0.99:
            continue
        bisector = (normals(a) + normals(b)).normalized()
        pivot = corner + bisector * (lane_offset / bisector.dot(normals(a)))
        entry, exit = pivot - a * turn_trim, pivot + b * turn_trim
        # Tangent-matched quadratic for the corner. The long approaches remain straight.
        for step in range(9):
            t = step / 8
            point = (1 - t) ** 2 * entry + 2 * t * (1 - t) * pivot + t * t * exit
            route.append((round(point.x, 3), round(-point.y, 3)))
    return route


def verify(scene, paths):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    down = Vector((0, 0, -1))
    checked = 0
    for name, path, _, _ in paths:
        for a, b in zip(path, (*path[1:], path[0]), strict=True):
            start, end = Vector(a), Vector(b)
            forward = (end - start).normalized()
            right = Vector((-forward.y, forward.x))
            steps = max(1, math.ceil((end - start).length / 0.75))
            for i in range(steps):
                center = start.lerp(end, i / steps)
                # Sample both wheel tracks at the front and rear axle.
                for length in (-1.32, 1.32):
                    for width in (-0.97, 0.97):
                        x, z = center + length * forward + width * right
                        hit, pos, _, _, obj, _ = scene.ray_cast(
                            depsgraph, Vector((x, -z, 0.062)), down
                        )
                        assert hit and abs(pos.z - ROAD_Z) < 0.012, (
                            name,
                            x,
                            z,
                            obj.name if hit else None,
                        )
                        checked += 1
    return checked


def main():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene = bpy.context.scene
    vehicle_collection = bpy.data.collections["14 | Street vehicles"]
    originals = sorted(vehicle_collection.objects, key=lambda ob: ob.name)
    assert originals and all(ob.type == "MESH" for ob in originals)

    # Reuse the road graph for alignment and keep the centre junctions visible from Plaza and Market.
    graph = road_graph()
    outlines = (
        ("outer", ((-126, 126), (126, 126), (126, -126), (-126, -126)), 3.2, 1.65, 5),
        ("avenue", ((-64, 64), (64, 64), (64, -64), (-64, -64)), 3.2, 1.65, 4),
        (
            "plaza",
            (
                (-26, 26),
                (0, 37),
                (26, 26),
                (37, 0),
                (26, -26),
                (0, -37),
                (-26, -26),
                (-37, 0),
            ),
            5,
            2.35,
            2,
        ),
    )
    paths = []
    for name, outline, trim, offset, count in outlines:
        for a, b in zip(outline, (*outline[1:], outline[0]), strict=True):
            heading = (Vector(b) - Vector(a)).normalized()
            width = next(
                w
                for (p, q), w in graph.items()
                if min(a[0], b[0]) <= p[0] <= max(a[0], b[0])
                and min(a[1], b[1]) <= p[1] <= max(a[1], b[1])
                and abs((Vector(q) - Vector(p)).normalized().dot(heading)) > 0.99
            )
            assert offset + 1.0 < width / 2
        paths.append(
            (name, lane(outline, trim, offset), count, 8.5 if name == "outer" else 7.2)
        )
        paths.append(
            (
                name + "-return",
                lane(tuple(reversed(outline)), trim, offset),
                count - 1,
                8.0 if name == "outer" else 6.8,
            )
        )

    bounds = []
    for obj in originals:
        # Limit legacy patching to exact vehicle material IDs and their tight source bounds.
        px = [obj.matrix_world @ v.co for v in obj.data.vertices]
        lo, hi = (
            [round(op(p[i] for p in px), 4) for i in range(3)] for op in (min, max)
        )
        bounds.append(
            {
                "min": [lo[0], lo[2], -hi[1]],
                "max": [hi[0], hi[2], -lo[1]],
                "finishes": [mat.name for mat in obj.data.materials],
            }
        )
    vehicle_collection.hide_viewport = True
    bpy.context.view_layer.update()
    samples = verify(scene, paths)
    bpy.ops.object.select_all(action="DESELECT")
    for index, mesh in enumerate(dict.fromkeys(obj.data for obj in originals)):
        car = bpy.data.objects.new(f"Traffic body {index + 1}", mesh)
        scene.collection.objects.link(car)
        car.select_set(True)
    with precise_meshopt_positions():
        export_chunk(DEST / "city-traffic.glb")
    MANIFEST.write_text(
        json.dumps(
            {
                "roadHeight": ROAD_Z,
                "parkedVehicles": bounds,
                "lanes": [
                    {"id": name, "points": points, "count": count, "speed": speed}
                    for name, points, count, speed in paths
                ],
            },
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf8",
    )
    print(
        f"TRAFFIC: {len(bounds)} legacy vehicles, {sum(path[2] for path in paths)} moving cars, {samples} asphalt samples"
    )


if __name__ == "__main__":
    main()
