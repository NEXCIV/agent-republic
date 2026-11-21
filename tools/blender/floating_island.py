"""Original District 01 stonework, grassy island and water geometry (Blender Z-up)."""

import math
import random

import bpy


def linear_color(rgb):
    channels = [int(rgb[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels) + (1.0,)


class PaintedMesh:
    """Flat face colours share one vertex-colour material and one glTF primitive."""

    def __init__(self):
        self.vertices = []
        self.faces = []
        self.colors = []

    def face(self, points, color):
        first = len(self.vertices)
        self.vertices.extend(points)
        self.faces.append(tuple(range(first, first + len(points))))
        self.colors.append(color)

    def link(self, name, parent, material):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update()
        layer = mesh.color_attributes.new(name="Surface", type="FLOAT_COLOR", domain="CORNER")
        palette = {color: linear_color(color) for color in set(self.colors)}
        for poly, color in zip(mesh.polygons, self.colors):
            for corner in poly.loop_indices:
                layer.data[corner].color = palette[color]
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
        mesh.materials.append(material)
        return obj


def surface_material(name, roughness):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = roughness
    tint = material.node_tree.nodes.new("ShaderNodeVertexColor")
    tint.layer_name = "Surface"
    material.node_tree.links.new(tint.outputs["Color"], shader.inputs["Base Color"])
    return material


# Counterclockwise cliff edge. The front two level segments are waterfall lips.
COAST = (
    (-17.2, -6.5), (-15.7, -10.5), (-13.6, -13.1), (-11.7, -14.5),
    (-9.1, -14.5), (-6.7, -15.2), (-4.0, -14.0), (-1.8, -14.6),
    (2.2, -14.4), (5.2, -13.9), (7.8, -15.4), (10.4, -15.4),
    (13.8, -14.0), (15.6, -12.1), (16.2, -8.8), (18.1, -6.3),
    (17.8, -2.7), (18.6, 0.8), (17.6, 4.8), (17.9, 8.3),
    (15.6, 11.8), (12.9, 13.5), (9.5, 14.1), (6.0, 15.6),
    (2.5, 15.2), (-0.7, 16.3), (-3.8, 15.6), (-7.4, 15.9),
    (-11.1, 14.3), (-14.6, 13.5), (-16.3, 10.8), (-16.1, 7.5),
    (-18.0, 5.7), (-18.5, 2.5), (-17.5, -0.5), (-18.2, -3.7),
)


def crag(mesh, coast, center, depth, seed):
    rng = random.Random(seed)
    cx, cy = center
    count = len(coast)
    # Splitting offset rings makes broad irregular strata with a broken underside.
    rows = []
    for radius, variation, z, relief in (
        (1, 0, -0.075, 0), (1.012, 0.008, -0.13 * depth, 0.035 * depth),
        (0.985, 0.035, -0.26 * depth, 0.075 * depth),
        (0.95, 0.065, -0.64 * depth, 0.15 * depth),
        (0.70, 0.095, -0.93 * depth, 0.17 * depth),
        (0.36, 0.09, -1.10 * depth, 0.17 * depth),
    ):
        row = []
        for x, y in coast:
            r = radius + rng.uniform(-variation, variation)
            row.append((cx + (x - cx) * r, cy + (y - cy) * r, z + rng.uniform(-relief, relief)))
        rows.append(row)

    greens = ("A5B875", "A8B972", "9EAF6D", "A6B576", "A5B371")
    rim = [(cx + (x - cx) * 0.82, cy + (y - cy) * 0.82, -0.075) for x, y in coast]
    for i in range(count):
        j = (i + 1) % count
        mesh.face((rim[i], rows[0][i], rows[0][j], rim[j]), rng.choice(greens))
        mesh.face(((cx, cy, -0.075), rim[i], rim[j]), "A3B471")
    strata = (
        ("94A363", "8E9F64", "98AA69", "A0AE6A", "8E9D62"),
        ("79786F", "817D73", "77776F", "918679", "77736C"),
        ("757581", "777883", "82818B", "88858A", "7E7D87", "6B707B"),
        ("606774", "6C6F7B", "696B78", "787780", "626976"),
        ("5A6171", "606574", "696A77", "565E6C"),
    )
    for ring, colors in enumerate(strata):
        upper, lower = rows[ring:ring + 2]
        for i in range(count):
            j = (i + 1) % count
            if rng.randrange(2):
                mesh.face((upper[i], lower[i], upper[j]), rng.choice(colors))
                mesh.face((upper[j], lower[i], lower[j]), rng.choice(colors))
            else:
                mesh.face((upper[i], lower[i], lower[j]), rng.choice(colors))
                mesh.face((upper[i], lower[j], upper[j]), rng.choice(colors))
    for i in range(count):
        mesh.face((rows[-1][(i + 1) % count], rows[-1][i], (cx, cy, -1.23 * depth)), "5B6270")


def cascade(mesh, x, y, width, height, seed):
    rng = random.Random(seed)
    # Separate four broad ribbons, curved over the lip. The bottom of each
    # breaks away at a different length; the narrow white strokes taper too.
    colors = ("52B6CB", "91DEDF", "51ABCA", "78CBD7")
    outline = ((1.65, 0.025), (0.4, 0.035), (-0.21, -0.02),
               (-0.49, -0.21), (-0.74, -1.05), (-0.88, -height * 0.62))
    for i, color in enumerate(colors):
        left = x + width * (i / 4 - 0.5)
        right = left + width / 4
        bottom = -height * rng.uniform(0.91, 1.08)
        sections = (*outline, (-1.02, bottom))
        for (dy, z), (next_dy, next_z) in zip(sections, sections[1:]):
            mesh.face(((left, y + dy, z), (left, y + next_dy, next_z),
                       (right, y + next_dy, next_z), (right, y + dy, z)), color)
        for j in range(2):
            px = left + width * (0.06 + 0.12 * j)
            z = -rng.uniform(0.8, 1.5) if j == 0 else bottom + 1.2
            offset = -0.90 if j == 0 else -1.04
            mesh.face(((px, y + offset, z), (px - 0.035, y + offset - 0.05, z - 0.5),
                       (px, y + offset - 0.08, z - 0.95),
                       (px + 0.036, y + offset - 0.05, z - 0.35)), "C3EFED")


def rectangle(mesh, x1, y1, x2, y2, z, color):
    mesh.face(((x1, y1, z), (x2, y1, z), (x2, y2, z), (x1, y2, z)), color)


def pave(mesh):
    # Rows stop short of the landmark footprints and run level with the walkers.
    stone = ("B8B1AA", "BFB7AE", "B7B4B0", "C3BCB2", "B9B4B0", "C2BCB4")
    rng = random.Random(38)
    for row in range(19):
        y = -20 + row
        span = 1.74 if y < -13 else (1.94 if y < -6 else 2.18)
        rectangle(mesh, -span, y, span, y + 1, 0.012, "89847F")
        breaks = [-span, -0.8, 0.72, span] if row % 2 else [-span, -0.18, span]
        for x1, x2 in zip(breaks, breaks[1:]):
            rectangle(mesh, x1 + 0.015, y + 0.013, x2 - 0.015, y + 0.987, 0.017, rng.choice(stone))
    for row in range(10):
        y = -5 + row
        span = 4.35 if row in (0, 9) else 5.25
        rectangle(mesh, -span, y, span, y + 1, 0.026, "93908A")
        x = -span
        while x < span - 0.001:
            edge = min(span, x + (0.79 if x == -span and row % 2 else 1.65))
            rectangle(mesh, x + 0.015, y + 0.018, edge - 0.015, y + 0.982, 0.031, rng.choice(stone))
            x = edge


def bridge_arch(mesh, x, outward):
    # Cut an actual semicircular opening into either load-bearing parapet.
    cy, cz, radius = -17.06, -1.58, 1.14
    inner = []
    crown = []
    for i in range(13):
        a = math.pi * i / 12
        inner.append((cy + radius * math.cos(a), cz + radius * math.sin(a)))
        outer_radius = radius + 0.25
        crown.append((cy + outer_radius * math.cos(a), cz + outer_radius * math.sin(a)))
    for a, b, c, d in zip(inner, inner[1:], crown, crown[1:]):
        def side(points, depth, color):
            pts = [(x + depth * outward, y, z) for y, z in points]
            mesh.face(pts if outward == 1 else pts[::-1], color)
        side((a, c, d, b), 0.025, "D6CBB5")
        side((c, (c[0], -0.06), (d[0], -0.06), d), 0, "A69F93")
        mesh.face(((x, a[0], a[1]), (x, b[0], b[1]),
                   (x - 0.3 * outward, b[0], b[1]), (x - 0.3 * outward, a[0], a[1])), "827F79")


def build_landscape(parent):
    land, water = PaintedMesh(), PaintedMesh()
    crag(land, COAST, (0, 0.6), 6.1, 197)
    # A separate landing at the scene boundary leaves open sky below the bridge.
    landing = ((-2.72, -19.68), (-1.4, -19.9), (1.6, -19.9), (2.8, -19.64),
               (2.65, -19.12), (1.7, -18.7), (0.4, -18.85), (-1.7, -18.7), (-2.6, -19.05))
    crag(land, landing, (0, -19.45), 2.1, 11)
    pave(land)
    for side in (-1, 1):
        bridge_arch(land, side * 1.64, side)
    cascade(water, -10.46, -14.5, 1.75, 7.35, 19)
    cascade(water, 9.05, -15.4, 2.02, 8.25, 98)
    land.link("basalt_meadow_and_masonry", parent, surface_material("env_landscape", 0.9))
    water.link("waterfall_ribbons", parent, surface_material("env_streams", 0.35))
