"""Build the additive Nexus-to-coffee-street dressing, in the 300 m world's coordinates."""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_lakeside import material
from build_civrum_world import Geometry, circle
from detail_civrum_world import rod
from export_nexciv_walk_preview import DEST, export_chunk, precise_meshopt_positions

STONE, TILE, CLAY, ROSE, OAK, DARK, BRASS, PINE, LINEN, OPAL, SOIL, LEAF, SAGE, BLOOM, HONEY = range(15)
FINISHES = (
    ("Sandstone", "B49F87"),
    ("Hearth brick", "9D674E"),
    ("Fired clay", "B97C60"),
    ("Rose clay", "AA7059"),
    ("Oiled timber", "94694C"),
    ("Green bronze", "27413E"),
    ("Satin brass", "BD945B"),
    ("Pine canvas", "44695F"),
    ("Unbleached canvas", "E8D5B1"),
    ("Lantern glass", "FFD39B"),
    ("Earth", "594C3D"),
    ("Myrtle", "455E3E"),
    ("Sage", "81915C"),
    ("Marigold", "E7AD68"),
    ("Lit linen blind", "DAAF75"),
)
PALETTE = tuple(("Promenade " + name,) for name, _ in FINISHES)
FLOOR = 0.184


def furnishings(name, geometry):
    mesh = geometry.mesh(name, PALETTE)
    # Batch matte finishes into a vertex-colour material. Keep cloth two-sided,
    # and retain separate brass and luminous finishes for their light response.
    colours = mesh.color_attributes.new(name="Tint", type="BYTE_COLOR", domain="CORNER")
    slots = list(mesh.materials)
    matte = bpy.data.materials.get("Promenade painted surfaces")
    if matte is None:
        matte = material("Promenade painted surfaces", "FFFFFF", 0.78)
        tint = matte.node_tree.nodes.new("ShaderNodeVertexColor")
        tint.layer_name = colours.name
        matte.node_tree.links.new(
            tint.outputs["Color"], matte.node_tree.nodes.get("Principled BSDF").inputs["Base Color"]
        )
    retained = {bpy.data.materials["MAT_" + PALETTE[i][0]] for i in (PINE, LINEN, BRASS, OPAL, HONEY)}
    finishes = [matte, *(original for original in slots if original in retained)]
    indices = []
    for poly in mesh.polygons:
        original = slots[poly.material_index]
        separate = original in retained
        indices.append(finishes.index(original) if separate else 0)
        for idx in poly.loop_indices:
            colours.data[idx].color = (1, 1, 1, 1) if separate else original.diffuse_color
    mesh.materials.clear()
    for finish in finishes:
        mesh.materials.append(finish)
    mesh.polygons.foreach_set("material_index", indices)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def planter(g, x, y, length, depth, floor):
    g.box(x, y, floor, length, depth, 0.43, DARK, 0.09)
    g.box(x, y, floor + 0.43, length + 0.05, depth + 0.05, 0.07, STONE, 0.1)
    g.box(x, y, floor + 0.5, length - 0.12, depth - 0.12, 0.025, SOIL, 0.06)
    # Each little clump has an upright and two spreading blades; silhouettes vary in both views.
    count = max(2, round(length / 0.24))
    for i in range(count):
        px = x + (i + 0.5 - count / 2) * (length - 0.23) / count
        for j in range(3):
            angle = i * 2.4 + j * 2.1
            py = y + (j - 1) * depth * 0.22
            base = floor + 0.50
            height = 0.25 + 0.07 * ((i + 2 * j) % 4)
            dx, dy = 0.13 * math.cos(angle), 0.13 * math.sin(angle)
            g.loft(
                circle(0.042, 5, px, py), circle(0.115, 5, px + dx, py + dy), base, base + height * 0.55, LEAF
            )
            g.loft(
                circle(0.115, 5, px + dx, py + dy),
                circle(0.012, 5, px + 1.7 * dx, py + 1.7 * dy),
                base + height * 0.55,
                base + height,
                SAGE if (i + j) % 4 == 0 else LEAF,
            )
            if j == 1 and i % 3 == 0:
                g.loft(circle(0.035, 6, px, py), circle(0.085, 6, px, py), base + 0.28, base + 0.33, BLOOM)


def lantern(g, x, y, base, height=0.82):
    g.slab(circle(0.14, 10, x, y), base, base + 0.055, BRASS)
    g.loft(circle(0.092, 10, x, y), circle(0.067, 10, x, y), base + 0.05, base + height - 0.19, DARK)
    g.slab(circle(0.095, 10, x, y), base + height - 0.19, base + height - 0.055, OPAL)
    g.slab(circle(0.113, 10, x, y), base + height - 0.055, base + height, BRASS)


def paving(g):
    # Shares an edge with the existing stall apron. Finer pavers give the terrace a human scale.
    x0, x1, y0, y1 = 17.93, 30.17, -77.60, -70.25
    g.box((x0 + x1) / 2, (y0 + y1) / 2, -0.015, x1 - x0, y1 - y0, FLOOR + 0.008, STONE)
    for row in range(18):
        depth = (y1 - y0) / 18
        x = x0
        i = 0
        while x < x1 - 0.001:
            width = min(0.9 if i or row % 2 == 0 else 0.45, x1 - x)
            g.box(
                x + width / 2,
                y0 + (row + 0.5) * depth,
                FLOOR - 0.007,
                width - 0.009,
                depth - 0.008,
                0.007,
                (ROSE, TILE, CLAY, ROSE, TILE, ROSE, CLAY)[(row * 5 + i * 3) % 7],
            )
            x += width
            i += 1


def chair(g, x, y, angle):
    ca, sa = math.cos(angle), math.sin(angle)

    def at(u, v, z):
        return (x + u * ca - v * sa, y + u * sa + v * ca, FLOOR + z)

    for u in (-0.19, 0.19):
        for v in (-0.17, 0.17):
            rod(g, at(u * 1.28, v * 1.3, 0), at(u, v, 0.44 if v < 0 else 0.84), 0.026, DARK)
    g.slab(circle(0.265, 16, x, y), FLOOR + 0.42, FLOOR + 0.47, OAK)
    for z in (0.64, 0.77):
        rod(g, at(-0.22, 0.17, z), at(0.22, 0.17, z), 0.051, OAK, sides=8)


def table(g, x, y, rotation):
    g.slab(circle(0.255, 20, x, y), FLOOR, FLOOR + 0.045, DARK)
    g.slab(circle(0.057, 12, x, y), FLOOR + 0.045, FLOOR + 0.72, BRASS)
    g.slab(circle(0.51, 32, x, y), FLOOR + 0.72, FLOOR + 0.763, DARK)
    g.slab(circle(0.505, 32, x, y), FLOOR + 0.763, FLOOR + 0.783, STONE)
    for angle in (rotation, rotation + math.pi):
        chair(g, x + 0.88 * math.sin(angle), y + 0.88 * math.cos(angle), -angle)
    for side in (-1, 1):
        cx = x + side * 0.235
        g.slab(circle(0.084, 16, cx, y), FLOOR + 0.783, FLOOR + 0.794, LINEN)
        g.loft(circle(0.039, 12, cx, y), circle(0.054, 12, cx, y), FLOOR + 0.794, FLOOR + 0.879, LINEN)
        g.slab(circle(0.046, 12, cx, y), FLOOR + 0.879, FLOOR + 0.880, SOIL)
    g.slab(circle(0.055, 12, x, y + 0.1), FLOOR + 0.783, FLOOR + 0.92, BRASS)
    g.slab(circle(0.05, 12, x, y + 0.1), FLOOR + 0.92, FLOOR + 1.00, OPAL)


def canopy(g):
    left, right, back, front = 18.8, 29.45, -76.90, -73.02
    for x in (left, (left + right) / 2, right):
        for y in (back, front):
            g.box(x, y, FLOOR, 0.21, 0.21, 0.15, BRASS, 0.025)
            g.box(x, y, FLOOR + 0.15, 0.115, 0.115, 3.06, DARK, 0.014)
        g.box(x, (back + front) / 2, FLOOR + 3.13, 0.13, front - back + 0.2, 0.16, OAK)
    for y in (back, front):
        g.box((left + right) / 2, y, FLOOR + 3.06, right - left + 0.3, 0.14, 0.19, DARK)
    g.box(21.42, front + 0.10, FLOOR + 2.85, 2.80, 0.105, 0.38, DARK, 0.035)
    g.box(21.42, front + 0.107, FLOOR + 2.835, 2.83, 0.12, 0.024, BRASS)
    # Two tensioned textile bays with bowed gores, piping and a short front valance.
    for bay in range(2):
        xmin = left + bay * (right - left) / 2 + 0.10
        xmax = xmin + (right - left) / 2 - 0.20
        for i in range(12):
            a, b = xmin + i * (xmax - xmin) / 12, xmin + (i + 1) * (xmax - xmin) / 12
            tone = LINEN if i % 6 in (0, 5) else PINE

            def height(t):
                return FLOOR + 3.20 + 0.49 * math.sin(math.pi * t) + 0.12 * (1 - t)

            for k in range(8):
                u, v = k / 8, (k + 1) / 8
                start = len(g.verts)
                g.verts.extend(
                    [
                        (a, back + (front - back) * u, height(u)),
                        (b, back + (front - back) * u, height(u)),
                        (b, back + (front - back) * v, height(v)),
                        (a, back + (front - back) * v, height(v)),
                    ]
                )
                g.face((start, start + 1, start + 2, start + 3), tone)
            start = len(g.verts)
            g.verts.extend(
                [
                    (a, front, height(1)),
                    (b, front, height(1)),
                    (b, front, height(1) - 0.13),
                    ((a + b) / 2, front, height(1) - 0.18),
                    (a, front, height(1) - 0.13),
                ]
            )
            g.face(tuple(range(start, start + 5)), tone)
        y = front - 0.17
        prev = None
        for i in range(11):
            t = i / 10
            x = xmin + (xmax - xmin) * t
            z = FLOOR + 3.05 - 0.36 * 4 * t * (1 - t)
            if prev:
                rod(g, prev, (x, y, z), 0.014, DARK)
            if i % 2:
                rod(g, (x, y, z), (x, y, z - 0.1), 0.018, DARK)
                g.loft(circle(0.046, 10, x, y), circle(0.09, 10, x, y), z - 0.23, z - 0.17, OPAL)
                g.loft(circle(0.09, 10, x, y), circle(0.036, 10, x, y), z - 0.17, z - 0.10, OPAL)
            prev = (x, y, z)
    for x in (20.1, 23.9, 27.7):
        planter(g, x, back + 0.31, 3.15, 0.54, FLOOR)
    for x, angle in ((20.05, 0.4), (22.9, 1.23), (26.05, 0.2), (28.15, 1.12)):
        table(g, x, -75.1, angle)
    for x in (18.8, 29.45):
        lantern(g, x, -71.35, FLOOR)


def market(g):
    # Display joinery sits inside the original market glazing, leaving the corner door clear.
    for x in (15.2, 19.1, 23.05):
        g.box(x, -55.05, 0.35, 2.7, 0.62, 0.58, OAK, 0.05)
        g.box(x, -55.04, 0.93, 2.78, 0.70, 0.067, STONE, 0.05)
        for i in range(5):
            xx = x + (i - 2) * 0.38
            g.loft(
                circle(0.12, 12, xx, -55.09),
                circle(0.16, 12, xx, -55.09),
                1.0,
                1.20 + 0.055 * (i % 3),
                CLAY if i % 2 else LINEN,
            )
        g.box(x, -55.10, 3.31, 2.45, 0.21, 0.09, DARK)
        g.box(x, -55.10, 3.29, 2.33, 0.18, 0.024, OPAL)
    for y in (-46.72, -49.25, -51.94):
        g.box(12.48, y, 2.96, 0.19, 1.66, 0.12, DARK)
        g.box(12.47, y, 2.93, 0.18, 1.54, 0.04, OPAL)
    # Backlit linen, oak shelves and ceramics sit behind the shopfront. The
    # spaces between bays give views through to the original, deeper rooms.
    for y in (-47.1, -51.15):
        g.box(13.95, y, 0.64, 0.09, 2.57, 2.22, OAK)
        g.box(13.89, y, 0.73, 0.04, 2.42, 2.04, HONEY)
        for z in (1.1, 1.72):
            g.box(13.65, y, z, 0.52, 2.55, 0.065, OAK)
            for i in range(4):
                cy = y + (i - 1.5) * 0.51
                g.loft(
                    circle(0.09, 10, 13.66, cy),
                    circle(0.13, 10, 13.66, cy),
                    z + 0.067,
                    z + 0.32 + (i % 2) * 0.1,
                    LINEN if i % 3 else PINE,
                )
    for x, width, z in ((16.15, 2.78, 4.8), (22.25, 2.28, 4.8), (20.9, 1.92, 8.22)):
        y = -54.45 if z < 6 else -53.42
        g.box(x, y, z, width, 0.09, 1.73, HONEY)
        for i in range(7):
            g.box(x + (i - 3) * width / 7, y - 0.053, z, 0.027, 0.034, 1.73, BRASS)
    # Two short, retractable fabric awnings face the route out of the plaza.
    for y in (-47.1, -51.15):
        for i in range(9):
            a, b = y - 1.53 + i * 0.34, y - 1.53 + (i + 1) * 0.34
            start = len(g.verts)
            g.verts.extend([(11.64, a, 3.70), (11.64, b, 3.70), (10.61, b, 3.33), (10.61, a, 3.33)])
            g.face(tuple(range(start, start + 4)), PINE if i not in (1, 7) else LINEN)
        rod(g, (10.60, y - 1.54, 3.32), (10.60, y + 1.54, 3.32), 0.048, BRASS, sides=10)
        for dy in (-1.35, 1.35):
            rod(g, (11.64, y + dy, 2.99), (10.61, y + dy, 3.30), 0.032, DARK)
    for x, y, level in ((4.15, -25.2, 0.18), (-1.15, -25.2, 0.18), (9.0, -46.45, 0.02), (9.0, -50, 0.02)):
        lantern(g, x, y, level)
    planter(g, 10.17, -46.45, 1.65, 0.70, 0.015)
    planter(g, 10.17, -50, 1.65, 0.70, 0.015)


def counter_table(g):
    # Just off the surveyed counter-to-bench segment where the two residents stop to talk.
    x, y = 14.2, -71.18
    g.slab(circle(0.23, 18, x, y), FLOOR, FLOOR + 0.042, DARK)
    g.slab(circle(0.056, 12, x, y), FLOOR + 0.042, FLOOR + 0.99, BRASS)
    g.slab(circle(0.36, 28, x, y), FLOOR + 0.99, FLOOR + 1.045, OAK)
    for dx in (-0.16, 0.16):
        g.loft(
            circle(0.044, 12, x + dx, y), circle(0.063, 12, x + dx, y), FLOOR + 1.045, FLOOR + 1.155, LINEN
        )
        g.slab(circle(0.055, 12, x + dx, y), FLOOR + 1.155, FLOOR + 1.156, SOIL)


def prepare_finishes():
    for idx, (name, tint) in enumerate(FINISHES):
        mat = material(
            "MAT_" + PALETTE[idx][0],
            tint,
            0.43 if idx in (BRASS, OPAL) else 0.78,
            0.55 if idx == BRASS else 0.18 if idx == DARK else 0,
            2.3 if idx == OPAL else 0.69 if idx == HONEY else 0,
        )
        mat.use_backface_culling = idx not in (PINE, LINEN)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    prepare_finishes()
    terrace, display = Geometry(), Geometry()
    paving(terrace)
    canopy(terrace)
    counter_table(terrace)
    market(display)
    furnishings("Coffee garden terrace", terrace)
    furnishings("Market windows and plaza lanterns", display)
    lettering = bpy.data.curves.new("Coffee garden fascia", "FONT")
    lettering.body = "COFFEE GARDEN"
    lettering.align_x = "CENTER"
    lettering.size = 0.255
    lettering.space_character = 1.12
    lettering.extrude = 0.004
    lettering.materials.append(bpy.data.materials["MAT_Promenade Lantern glass"])
    sign = bpy.data.objects.new("Coffee garden fascia", lettering)
    bpy.context.collection.objects.link(sign)
    sign.location = (21.42, -72.852, FLOOR + 2.955)
    sign.rotation_euler = (math.pi / 2, 0, math.pi)
    bpy.context.view_layer.objects.active = sign
    sign.select_set(True)
    bpy.ops.object.convert(target="MESH")
    # Derive the city-distance kiosk from the same textured artist asset as the counter at street level.
    bpy.ops.import_scene.gltf(filepath=str(DEST / "coffee-stall.glb"))
    obj = next(o for o in bpy.context.selected_objects if o.type == "MESH")
    kiosk_world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = (
        Matrix.Translation((12.6, -74, FLOOR))
        @ Matrix.Rotation(math.pi, 4, "Z")
        @ Matrix.Scale(2.75 / 97.84, 4)
        @ kiosk_world
    )
    obj.name = "Coffee kiosk distance mesh"
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new("Distant silhouette", "DECIMATE")
    mod.ratio = 0.036
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for img in bpy.data.images:
        if img.type == "IMAGE" and max(img.size) > 256:
            ratio = 256 / max(img.size)
            img.scale(*(max(1, round(n * ratio)) for n in img.size))
            img.pack()
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            o.select_set(True)
    with precise_meshopt_positions():
        export_chunk(DEST / "coffee-promenade.glb", jpeg_quality=84)


if __name__ == "__main__":
    main()
