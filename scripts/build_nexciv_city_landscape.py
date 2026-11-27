"""Create two additional street-building designs and surveyed city planting beds."""

import json
import math
import sys
from itertools import pairwise
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_corner_market import edges, orient
from build_civrum_lakeside import color, shader
from build_civrum_world import DISTRICTS, Geometry, circle, rectangle, road_graph
from build_nexciv_facades import (
    BRONZE,
    DOME,
    GOLD,
    GRASS,
    INK,
    LEAF,
    LIGHT,
    PALETTE,
    PANEL,
    SAGE,
    STONE,
    TILE,
    WOOD,
    finishes,
    plaque,
    window_bays,
)
from export_nexciv_walk_preview import (
    DEST,
    SOURCE,
    export_chunk,
    group_overview_instances,
    precise_meshopt_positions,
)

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "apps/web/src/app/nexciv-preview/city-landscape.json"
SLOTS = {"terrace": (6, 16, 31, 35), "arcade": (4, 26, 39, 45)}


def bounds(obj, transform):
    points = [transform @ Vector(co) for co in obj.bound_box]
    return tuple(
        Vector([bound(p[i] for p in points) for i in range(3)]) for bound in (min, max)
    )


def route_points(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "points" and isinstance(item, list):
                yield from (
                    (p[0], -p[2]) for p in item if isinstance(p, list) and len(p) == 3
                )
            else:
                yield from route_points(item)
    elif isinstance(value, list):
        for item in value:
            yield from route_points(item)


def distance_to_segment(x, y, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)


def survey():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene = bpy.context.scene
    graph = bpy.context.evaluated_depsgraph_get()
    placements, obstacles = [], []
    for style, slots in SLOTS.items():
        for slot in slots:
            ob = scene.objects[f"Street shop {slot}"]
            source = next(iter(ob.instance_collection.all_objects))
            assert "Garden Roof Retail" in source.name
            m = (
                ob.matrix_world
                @ Matrix.Translation(-ob.instance_collection.instance_offset)
                @ source.matrix_world
            )
            # Fit the new ground plate to the original building, leaving the foundation and entrance in place.
            scale = m.to_scale()
            low, high = bounds(source, Matrix.Identity(4))
            w, d = (high.x - low.x) * scale.x, (high.y - low.y) * scale.y
            height = (high.z - low.z) * scale.z
            x, y, z = m.translation
            placements.append((style, slot, (x, y, z), (w, d, height), m.to_euler().z))

    for obj in scene.objects:
        if obj.hide_render or obj.hide_viewport:
            continue
        members = (
            [(obj, obj.matrix_world)]
            if obj.type == "MESH"
            else [
                (
                    part,
                    obj.matrix_world
                    @ Matrix.Translation(-obj.instance_collection.instance_offset)
                    @ part.matrix_world,
                )
                for part in obj.instance_collection.all_objects
                if part.type == "MESH"
            ]
            if obj.instance_collection
            else []
        )
        for part, matrix in members:
            low, high = bounds(part, matrix)
            if (
                high.z > 0.31
                and low.z < 3.0
                and high.z - low.z > 0.20
                and high.x - low.x < 55
                and high.y - low.y < 65
            ):
                obstacles.append((low.x, high.x, low.y, high.y))
    # The web versions of these landmarks have a larger footprint than their legacy authoring proxy.
    obstacles.extend(
        [
            (-117, -79, 49, 83),
            (72, 91, 13, 31),
            (-7, 7, -21, 10),
            (17.93, 30.17, -77.60, -70.25),
            (-91.35, -74.05, -56.2, -53.8),
        ]
    )
    routes = [
        p
        for file in (*DEST.glob("*route*.json"), DEST / "nexus-connector.json")
        for p in route_points(json.loads(file.read_text(encoding="utf8")))
    ]
    roads = list(road_graph().items())
    plants = []

    def place_if_clear(x, y, kind, rotation):
        r = 1.78 if kind in ("tree", "amber") else 1.02
        if (
            min(distance_to_segment(x, y, a, b) - width / 2 for (a, b), width in roads)
            < 2.75 + r + 0.65
        ):
            return False
        if any(
            a - r - 0.35 < x < b + r + 0.35 and c - r - 0.35 < y < d + r + 0.35
            for a, b, c, d in obstacles
        ):
            return False
        if any((x - px) ** 2 + (y - py) ** 2 < (r + 1.65) ** 2 for px, py in routes):
            return False
        if any(
            math.hypot(x - px, y - py) < r + pr + 0.65 for _, px, py, _, _, pr in plants
        ):
            return False
        hit, location, normal, *_ = scene.ray_cast(
            graph, Vector((x, y, 8)), Vector((0, 0, -1))
        )
        if not hit or not -0.035 <= location.z <= 0.25 or normal.z < 0.95:
            return False
        plants.append((kind, x, y, location.z + 0.003, rotation, r))
        return True

    # Work around the edges of the established lots. Alternate tall shade trees and low planting.
    areas = [(*center, *size) for center, size in DISTRICTS.values()]
    areas += [
        (-95, -30, 44, 46),
        (95, -30, 44, 46),
        (-32, -95, 46, 46),
        (32, -95, 46, 46),
    ]
    areas += [(side * 139, 0, 19, 242) for side in (-1, 1)]
    areas += [(0, side * 139, 242, 19) for side in (-1, 1)]
    for index, (cx, cy, w, d) in enumerate(areas):
        for row in range(math.floor(d / 6)):
            for col in range(math.floor(w / 6)):
                x = cx + (col - (math.floor(w / 6) - 1) / 2) * 6
                y = cy + (row - (math.floor(d / 6) - 1) / 2) * 6
                if abs(x - cx) < w / 2 - 9 and abs(y - cy) < d / 2 - 9:
                    continue
                kind = "amber" if (row + col + index) % 5 == 0 else "tree"
                place_if_clear(
                    x, y, kind, ((row * 13 + col * 7 + index) % 12) * math.pi / 6
                )
    # Leaf beds fill the small forecourts between the planted islands, without narrowing the walkways.
    for cx, cy, w, d in areas + [(0, 0, 112, 112)]:
        for row in range(math.floor(d / 5)):
            for col in range(math.floor(w / 5)):
                x = cx + (col - (math.floor(w / 5) - 1) / 2) * 5 + 1.2
                y = cy + (row - (math.floor(d / 5) - 1) / 2) * 5 + 1.2
                if abs(x) > 148 or abs(y) > 148 or (abs(x) < 30 and abs(y) < 30):
                    continue
                if (row + 2 * col) % 3 == 0 and (
                    abs(x - cx) > w / 2 - 8 or abs(y - cy) > d / 2 - 8 or cx == cy == 0
                ):
                    place_if_clear(x, y, "hedge", math.pi / 2 * ((row + col) % 2))
    # Shaded groves inside the large lawn quarters, between their axial pedestrian paths.
    for cx in (-32, 32):
        for sx in (-1, 1):
            for sy in (-1, 1):
                x, y = cx + sx * 12, -95 + sy * 12
                for dx, dy in ((-5, -5), (5, 5), (-5, 5), (5, -5)):
                    place_if_clear(x + dx, y + dy, "tree", (sx + sy) * math.pi / 4 + dx)
                for dx, dy in ((0, -6.7), (0, 6.7), (-6.7, 0), (6.7, 0)):
                    place_if_clear(x + dx, y + dy, "hedge", math.pi / 2 if dx else 0)
    return placements, plants


def lobe(g, cx, cy, z, rx, ry, rz, material, phase=0.0):
    """Small rounded crowns with shared smooth normals, in local metres."""
    rings = []
    for i in range(1, 6):
        angle = math.pi * i / 6
        first = len(g.verts)
        g.verts.extend(
            (
                cx + rx * math.sin(angle) * math.cos(j * math.tau / 10 + phase),
                cy + ry * math.sin(angle) * math.sin(j * math.tau / 10 + phase),
                z + rz * math.cos(angle),
            )
            for j in range(10)
        )
        rings.append(first)
    for upper, lower in pairwise(rings):
        for j in range(10):
            k = (j + 1) % 10
            g.face((upper + j, lower + j, lower + k, upper + k), material)
    g.face(tuple(rings[0] + j for j in range(10)), material)
    g.face(tuple(rings[-1] + j for j in reversed(range(10))), material)


def roof_garden(g, w, d, z):
    g.box(0, 0, z, w, d, 0.16, STONE, 0.36)
    g.box(0, 0, z + 0.16, w - 3.25, d - 3.25, 0.055, GRASS, 0.30)
    for side in (-1, 1):
        for x, y, pw, pd in (
            (0, side * (d / 2 - 0.65), w - 1.28, 0.54),
            (side * (w / 2 - 0.66), 0, 0.54, d - 1.8),
        ):
            g.box(x, y, z + 0.16, pw, pd, 0.42, INK, 0.15)
            g.box(x, y, z + 0.55, pw + 0.03, pd + 0.03, 0.065, GOLD, 0.12)
        for x in (-w * 0.29, 0, w * 0.29):
            y = side * (d / 2 - 1.38)
            g.box(x, y, z + 0.16, w * 0.22, 1.13, 0.33, BRONZE, 0.18)
            g.box(x, y, z + 0.49, w * 0.20, 0.94, 0.08, GRASS, 0.16)
            for j in range(4):
                lobe(
                    g,
                    x + (j - 1.5) * w * 0.043,
                    y,
                    z + 0.73,
                    0.43,
                    0.44,
                    0.36,
                    LEAF if j % 2 else SAGE,
                    j * 0.8,
                )


def facade(g, outline, bottom, height, seed, entrance=False, wall=INK):
    for i, (a, b) in enumerate(edges(outline)):
        a, b = Vector(a), Vector(b)
        length = (b - a).length
        if length < 1.8:
            continue
        panel = Geometry()
        window_bays(
            panel,
            length - 0.18,
            height,
            bottom,
            max(1, round(length / 2.5)),
            wall,
            seed + i,
            entrance and i == 0,
            True,
        )
        orient(g, panel, (a + b) / 2, b)


def terrace():
    g = Geometry()
    g.box(0, 0, 0, 16, 11.6, 0.24, TILE, 0.35)
    for i, (w, d) in enumerate(((15.2, 10.9), (15.2, 10.9), (12.5, 9.2), (9.8, 7.75))):
        z = 0.24 + i * 3.65
        outline = rectangle(0, 0, w, d)
        facade(g, outline, z, 3.35, i, entrance=i == 0, wall=PANEL if i >= 2 else INK)
        for side in (-1, 1):
            for x in (-w / 2 + 0.13, w / 2 - 0.13):
                g.box(x, side * (d / 2 - 0.07), z + 0.1, 0.19, 0.14, 3.24, GOLD, 0.035)
        g.box(0, 0, z + 3.35, w + 0.40, d + 0.38, 0.24, INK, 0.16)
        g.box(0, 0, z + 3.59, w + 0.45, d + 0.43, 0.06, GOLD, 0.16)
        if i in (1, 2):
            for side in (-1, 1):
                for x in (-w * 0.28, 0, w * 0.28):
                    y = side * (d / 2 - 0.29)
                    g.box(x, y, z + 3.65, w * 0.21, 0.44, 0.29, BRONZE, 0.10)
                    for j in range(4):
                        lobe(
                            g,
                            x + (j - 1.5) * w * 0.043,
                            y,
                            z + 4.02,
                            0.31,
                            0.19,
                            0.25,
                            LEAF if j % 2 else SAGE,
                        )
    roof_garden(g, 9.8, 7.75, 14.84)
    # A split brass crown, rooftop lounge and backlit wayfinding distinguish this profile.
    g.box(0, -0.1, 14.84, 6.8, 4.4, 1.24, INK, 0.20)
    g.box(0, -0.1, 16.08, 7.1, 4.7, 0.22, GOLD, 0.23)
    plaque(g, "TERRACE", 0, -2.36, 15.25, 0.48, LIGHT)
    g.box(0, -5.6, 3.10, 6.6, 0.73, 0.24, BRONZE, 0.12)
    g.box(0, -5.94, 3.17, 6.33, 0.045, 0.085, LIGHT)
    return g


def arcade():
    g = Geometry()
    g.box(0, 0, 0, 16, 11.6, 0.22, TILE, 1.85)
    for i, (w, d) in enumerate(((15.2, 10.85), (15.2, 10.85), (12.5, 8.8))):
        z = 0.22 + i * 3.45
        footprint = rectangle(0, 0, w, d, 1.8)
        facade(g, footprint, z, 3.08, 2 * i, entrance=i == 0, wall=PANEL)
        # Patinated copper piers give the arcade its own street-level material rhythm.
        for side in (-1, 1):
            for x in (-w / 2 + 1.72, w / 2 - 1.72):
                g.box(x, side * (d / 2 - 0.08), z + 0.04, 0.28, 0.19, 2.97, DOME, 0.05)
        # The chamfered corners and continuous curved-looking bronze fascia step around each storey.
        g.slab(rectangle(0, 0, w + 0.5, d + 0.5, 1.85), z + 3.02, z + 3.30, BRONZE)
        g.slab(rectangle(0, 0, w + 0.56, d + 0.56, 1.85), z + 3.30, z + 3.42, GOLD)
        g.slab(rectangle(0, 0, w + 0.56, d + 0.56, 1.85), z + 3.42, z + 3.45, INK)
    roof_garden(g, 12.5, 8.8, 10.58)
    g.box(0, 0.2, 10.82, 5.4, 3.2, 0.96, DOME, 0.65)
    g.box(0, 0.2, 11.78, 5.6, 3.4, 0.16, GOLD, 0.65)
    g.box(0, -5.72, 2.89, 6.2, 0.74, 0.24, BRONZE, 0.16)
    g.box(0, -6.06, 2.96, 5.95, 0.06, 0.09, LIGHT)
    plaque(g, "ARCADE", 0, -6.105, 3.16, 0.32, LIGHT)
    return g


def plant(kind):
    g = Geometry()
    if kind == "hedge":
        g.box(0, 0, 0, 1.95, 1.18, 0.24, INK, 0.19)
        g.box(0, 0, 0.24, 2.02, 1.25, 0.075, STONE, 0.2)
        g.box(0, 0, 0.315, 1.81, 1.04, 0.033, GRASS, 0.16)
        for j in range(5):
            lobe(
                g,
                (j - 2) * 0.31,
                0,
                0.57,
                0.29,
                0.43,
                0.37,
                SAGE if j % 2 else LEAF,
                j * 0.51,
            )
        return g
    g.slab(circle(1.12, 16), 0, 0.18, INK)
    g.slab(circle(1.18, 16), 0.18, 0.26, STONE)
    g.slab(circle(1.02, 16), 0.26, 0.29, GRASS)
    g.loft(circle(0.23, 10), circle(0.13, 10, 0.08, 0.05), 0.29, 2.72, WOOD)
    g.loft(
        circle(0.14, 9, 0.08, 0.05), circle(0.062, 9, -0.05, -0.04), 2.70, 4.12, WOOD
    )
    for j in range(7):
        a = j * math.tau / 7 + 0.27
        x, y = math.cos(a) * 0.87, math.sin(a) * 0.87
        g.loft(circle(0.105, 7, 0.08, 0.05), circle(0.047, 7, x, y), 2.24, 3.55, WOOD)
        lobe(
            g,
            x,
            y,
            3.47 + (j % 3) * 0.18,
            0.87,
            0.84,
            1.0,
            SAGE if kind == "amber" or j % 3 == 0 else LEAF,
            a,
        )
    lobe(g, -0.04, 0.04, 4.19, 1.12, 1.04, 1.17, SAGE if kind == "amber" else LEAF)
    return g


def create_mesh(g, name):
    mesh = g.mesh(name, PALETTE)
    for poly, finish in zip(mesh.polygons, g.colors):
        if finish in (LEAF, SAGE, WOOD):
            poly.use_smooth = True
    return mesh


def main():
    placements, plants = survey()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    finishes()
    for index, tint in ((LEAF, "4F8247"), (SAGE, "8DA358"), (GRASS, "557443")):
        finish = bpy.data.materials["MAT_" + PALETTE[index][0]]
        finish.diffuse_color = color(tint)
        shader(finish).inputs["Base Color"].default_value = color(tint)
    shader(bpy.data.materials["MAT_NEXCIV_Facade_Warm interior plaster"]).inputs[
        "Emission Strength"
    ].default_value = 0.68
    models = {
        "terrace": create_mesh(terrace(), "Terrace Exchange"),
        "arcade": create_mesh(arcade(), "Arcade House"),
    }
    for mesh in models.values():
        low, high = (
            Vector([bound(v.co[i] for v in mesh.vertices) for i in range(3)])
            for bound in (min, max)
        )
        mesh.transform(
            Matrix.Translation((-(low.x + high.x) / 2, -(low.y + high.y) / 2, -low.z))
        )
    greens = {
        kind: create_mesh(plant(kind), f"City planting {kind}")
        for kind in ("tree", "amber", "hedge")
    }
    for style, slot, pos, (width, depth, height), angle in placements:
        mesh = models[style]
        # Derive widths from the complete model, including the entrance canopy.
        coords = [v.co for v in mesh.vertices]
        size = [max(v[i] for v in coords) - min(v[i] for v in coords) for i in range(3)]
        obj = bpy.data.objects.new(f"{mesh.name} | slot {slot}", mesh)
        bpy.context.collection.objects.link(obj)
        obj.location = pos
        obj.rotation_euler.z = angle
        obj.scale = (
            width / size[0],
            depth / size[1],
            min(1.12, max(0.82, height / (9.6 if style == "terrace" else 8.8))),
        )
    for i, (kind, x, y, z, angle, _) in enumerate(plants):
        obj = bpy.data.objects.new(f"Planting | {kind} {i:03}", greens[kind])
        bpy.context.collection.objects.link(obj)
        obj.location = (x, y, z)
        obj.rotation_euler.z = angle
        obj.scale.z = 0.90 + ((i * 17) % 18) / 100
    for obj in bpy.context.collection.objects:
        obj["previewTier"] = "landscape"
    group_overview_instances(bpy.context.collection)
    bpy.ops.object.select_all(action="SELECT")
    with precise_meshopt_positions():
        export_chunk(DEST / "city-landscape.glb", gpu_instances=True)
    MANIFEST.write_text(
        json.dumps(
            {
                "retailReplacements": [
                    [round(pos[0], 3), round(-pos[1], 3)]
                    for _, _, pos, _, _ in placements
                ],
                "plantingCounts": {
                    kind: sum(p[0] == kind for p in plants) for kind in greens
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf8",
    )
    print(
        "LANDSCAPE",
        len(placements),
        "building variants",
        len(plants),
        "planting beds",
        MANIFEST.read_text(),
    )


if __name__ == "__main__":
    main()
