"""Build the independent CIVRUM city greybox with Blender's bundled Python."""

import argparse
import math
import sys
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
BLACK, GRAPHITE, YELLOW, METAL, CONCRETE, WHITE = range(6)
PALETTE = (
    ("OBSIDIAN_BLACK", "141619", .14, .52),
    ("GRAPHITE_GRAY", "292D32", .06, .77),
    ("TECH_YELLOW", "F0B90B", .15, .43),
    ("METALLIC_GRAY", "747A80", .40, .54),
    ("CONCRETE_GRAY", "C5C6C3", .00, .83),
    ("WARM_WHITE", "E7E5DF", .02, .67),
)
LAYERS = ("ENVIRONMENT", "ROADS", "PLAZA", "VEGETATION", "PUBLIC_FACILITIES",
          "CONSTRUCTION", "PLACEHOLDER_BUILDINGS", "DEBUG_SCALE", "LIGHTING", "CAMERAS")
DISTRICTS = {
    "Governance": ((0, 95), (78, 47)),
    "Research": ((-95, 65), (46, 63)),
    "Residential": ((95, 65), (46, 63)),
    "Community": ((-95, -85), (46, 57)),
    "Construction": ((95, -85), (46, 57)),
}
WALK = 2.75
ROAD_Z = .038
WALK_Z = .18
TAU = math.tau
V = Vector


def rectangle(x, y, width, depth, clip=0):
    a, b = width / 2, depth / 2
    if not clip:
        return [(x-a, y-b), (x+a, y-b), (x+a, y+b), (x-a, y+b)]
    return [(x-a+clip, y-b), (x+a-clip, y-b), (x+a, y-b+clip),
            (x+a, y+b-clip), (x+a-clip, y+b), (x-a+clip, y+b),
            (x-a, y+b-clip), (x-a, y-b+clip)]


def circle(r, n, x=0, y=0, phase=0):
    return [(x+r*math.cos(phase+i*TAU/n), y+r*math.sin(phase+i*TAU/n)) for i in range(n)]


class Geometry:
    """One editable mesh per module, with local coordinates baked in metres."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.colors = []

    def face(self, indices, color):
        self.faces.append(indices)
        self.colors.append(color)

    def surface(self, points, z, color):
        first = len(self.verts)
        self.verts.extend((x, y, z) for x, y in points)
        self.face(tuple(range(first, len(self.verts))), color)

    def loft(self, lower, upper, z, top, color, cap=None):
        first, n = len(self.verts), len(lower)
        self.verts.extend((x, y, h) for h, pts in ((z, lower), (top, upper)) for x, y in pts)
        self.face(tuple(first+i for i in reversed(range(n))), color)
        self.face(tuple(first+n+i for i in range(n)), color if cap is None else cap)
        for i in range(n):
            j = (i+1) % n
            self.face((first+i, first+j, first+n+j, first+n+i), color)

    def slab(self, points, z, top, color, cap=None):
        self.loft(points, points, z, top, color, cap)

    def box(self, x, y, z, w, d, h, color, clip=0, cap=None):
        self.slab(rectangle(x, y, w, d, clip), z, z+h, color, cap)

    def band(self, outer, inner, z, color):
        for i in range(len(outer)):
            j = (i+1) % len(outer)
            self.surface([outer[i], outer[j], inner[j], inner[i]], z, color)

    def mesh(self, name, palette=PALETTE):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        slots = sorted(set(self.colors))
        for idx in slots:
            mesh.materials.append(bpy.data.materials["MAT_"+palette[idx][0]])
        for poly, color in zip(mesh.polygons, self.colors):
            poly.material_index = slots.index(color)
        mesh.update()
        return mesh


def put(layer, name, mesh, pos=(0, 0, 0), angle=0):
    obj = bpy.data.objects.new("CIVRUM_"+name, mesh)
    bpy.data.collections[layer].objects.link(obj)
    obj.location = pos
    obj.rotation_euler.z = angle
    return obj


def lettering(layer, name, words, size, pos, color, parent=None, vertical=False):
    """Built-in font as scale/wayfinding paint. Fascia lettering follows its mass."""
    font = bpy.data.curves.new(name, "FONT")
    font.body, font.size, font.space_character, font.align_x = words, size, 1.12, "CENTER"
    font.materials.append(bpy.data.materials["MAT_"+PALETTE[color][0]])
    obj = put(layer, name, font, pos)
    obj.parent = parent
    if vertical:
        obj.rotation_euler.x = math.pi/2
    return obj


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "CIVRUM • City Blockout 01"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1
    root = bpy.data.collections.new("CIVRUM_WORLD")
    scene.collection.children.link(root)
    for name in LAYERS:
        root.children.link(bpy.data.collections.new(name))
    bpy.data.collections["PLACEHOLDER_BUILDINGS"].children.link(bpy.data.collections.new("CONTEXT_MASSING"))
    for name, hex_color, metal, roughness in PALETTE:
        srgb = [int(hex_color[i:i+2], 16)/255 for i in (0, 2, 4)]
        rgba = tuple(((v+.055)/1.055)**2.4 if v > .04045 else v/12.92 for v in srgb)+(1,)
        mat = bpy.data.materials.new("MAT_"+name)
        if mat.node_tree is None:
            mat.use_nodes = True
        shader = mat.node_tree.nodes.get("Principled BSDF")
        for key, val in (("Base Color", rgba), ("Metallic", metal), ("Roughness", roughness)):
            shader.inputs[key].default_value = val
        mat.diffuse_color = rgba
    ground = Geometry()
    ground.surface(rectangle(0, 0, 300, 300), 0, CONCRETE)
    put("ENVIRONMENT", "ENV_GROUND_MAIN", ground.mesh("GROUND_300m"))
    return scene


def road_graph():
    edges = {}

    def link(a, b, width):
        key = tuple(sorted((a, b)))
        assert key not in edges
        edges[key] = width

    inner = [(0, 37), (26, 26), (37, 0), (26, -26), (0, -37), (-26, -26), (-37, 0), (-26, 26)]
    middle = [(0, 64), (64, 64), (64, 0), (64, -64), (0, -64), (-64, -64), (-64, 0), (-64, 64)]
    for i, p in enumerate(inner):
        link(p, inner[i-1], 10)
        link(middle[i], middle[i-1], 7)
        link(p, middle[i], 7 if i % 2 else 10)
    for x in (-64, 64):
        for sign in (-1, 1):
            link((x, sign*64), (x, sign*126), 7)
            link((x, sign*126), (x, sign*150), 7)
    for sign in (-1, 1):
        y = sign*126
        for a, b in zip((-150, -126, -64, 0, 64, 126), (-126, -64, 0, 64, 126, 150)):
            link((a, y), (b, y), 7)
        x = sign*126
        for a, b in ((-150, -126), (-126, 0), (0, 126), (126, 150)):
            link((x, a), (x, b), 7)
        link((64*sign, 0), (x, 0), 10)
        link((x, 0), (sign*150, 0), 10)
        link((0, y), (0, sign*150), 10)
    link((0, -64), (0, -126), 10)
    return edges


def perp(direction):
    return V((-direction.y, direction.x))


def offset_corner(a, b, wa, wb):
    """Intersect the left side of outgoing arm A with the right side of arm B."""
    p, q = perp(a)*wa, -perp(b)*wb
    det = a.cross(b)
    if abs(det) < 1e-5:
        return (p+q)/2
    return p + a*((q-p).cross(b)/det)


def junction(arms):
    corners = []
    for i, (a, width) in enumerate(arms):
        b, other = arms[(i+1) % len(arms)]
        corners.append([offset_corner(a, b, width/2+t, other/2+t) for t in (0, .22, WALK)])
    trim = max(5.5, max(max(c[-1].dot(arms[i][0]), c[-1].dot(arms[(i+1) % len(arms)][0]))
                         for i, c in enumerate(corners))+1.0)
    geom, deck = Geometry(), []
    for i, (a, width) in enumerate(arms):
        b, other = arms[(i+1) % len(arms)]
        start = [a*trim+perp(a)*(width/2+t) for t in (0, .22, WALK)]
        end = [b*trim-perp(b)*(other/2+t) for t in (0, .22, WALK)]
        deck.extend([a*trim-perp(a)*width/2, start[0], corners[i][0]])
        for part, color in ((0, WHITE), (1, CONCRETE)):
            lo, hi = part, part+1
            for l, r in ((start, corners[i]), (corners[i], end)):
                geom.surface([l[hi], r[hi], r[lo], l[lo]], WALK_Z, color)
        for p, q in ((start[0], corners[i][0]), (corners[i][0], end[0])):
            first = len(geom.verts)
            geom.verts.extend([(p.x,p.y,ROAD_Z), (q.x,q.y,ROAD_Z),
                               (q.x,q.y,WALK_Z), (p.x,p.y,WALK_Z)])
            geom.face(tuple(reversed(range(first, first+4))), METAL)
    geom.surface(deck, ROAD_Z, GRAPHITE)
    return geom, trim


def straight(length, width):
    g = Geometry()
    g.surface(rectangle(length/2, 0, length, width), ROAD_Z, GRAPHITE)
    for sign in (-1, 1):
        g.box(length/2, sign*(width+WALK)/2, ROAD_Z, length, WALK, WALK_Z-ROAD_Z, CONCRETE)
        g.surface(rectangle(length/2, sign*(width+.22)/2, length, .22), WALK_Z+.002, WHITE)
        g.surface(rectangle(length/2, sign*(width/2-.23), length, .11), ROAD_Z+.003, WHITE)
        for i in range(max(0, math.ceil(length/2.5)-1)):
            g.surface(rectangle((i+1)*2.5,sign*(width/2+WALK/2+.11),.032,WALK-.22),
                      WALK_Z+.003,METAL)
    count = max(1, round(length/7))
    for i in range(count):
        g.surface(rectangle((i+.5)*length/count, 0, min(2.25, length*.28), .13), ROAD_Z+.004,
                  YELLOW if width == 10 else WHITE)
    return g


def build_roads():
    edges = road_graph()
    neighbors = defaultdict(list)
    for (a, b), width in edges.items():
        for p, q in ((a, b), (b, a)):
            neighbors[p].append(((V(q)-V(p)).normalized(), width))
    trims, meshes, stripes = {}, {}, {}
    for p, arms in neighbors.items():
        if len(arms) == 1:
            trims[p] = 0
            continue
        arms.sort(key=lambda arm: math.atan2(arm[0].y, arm[0].x))
        g, trims[p] = junction(arms)
        signature = tuple((round(d.x,4), round(d.y,4), w) for d,w in arms)
        label = {2:"TURN", 3:"TEE", 4:"CROSS"}.get(len(arms), "MULTI")
        if signature not in meshes:
            meshes[signature] = g.mesh("JUNCTION_"+label)
        obj = put("ROADS", "ROAD_"+label, meshes[signature], (*p, 0))
        obj["node_xy"], obj["setback_m"] = list(p), trims[p]
    for (a, b), width in edges.items():
        direction = (V(b)-V(a)).normalized()
        length = (V(b)-V(a)).length-trims[a]-trims[b]
        assert length > 1, (a, b, length)
        angle = math.atan2(direction.y, direction.x)
        cursor = V(a)+direction*trims[a]
        # Keep the nominal 20 m pitch; use one closure at the end of each run.
        pieces = [20.]*int(length//20)
        remainder = length-sum(pieces)
        if remainder > .0001:
            pieces.append(remainder)
        for distance in pieces:
            key = (width, round(distance, 5))
            if key not in meshes:
                meshes[key] = straight(distance, width).mesh(f"ROAD_{width}x{distance:.3f}")
            obj = put("ROADS", "ROAD_STRAIGHT_"+("MAIN" if width == 10 else "LOCAL"),
                      meshes[key], (*cursor, 0), angle)
            obj["edge_xy"], obj["length_m"], obj["width_m"] = [*a,*b], distance, width
            cursor += direction*distance
        assert (cursor-(V(b)-direction*trims[b])).length < .001
        for p, q, dx in ((a, b, direction), (b, a, -direction)):
            if max(map(abs, p)) > 65 or len(neighbors[p]) < 3 or width != 10:
                continue
            if width not in stripes:
                paint = Geometry()
                for i in range(-5, 6):
                    if i:  # keep the centre guide visible between the two lanes
                        paint.surface(rectangle(0, i*.85, 2.3, .43), ROAD_Z+.007, WHITE)
                stripes[width] = paint.mesh("CROSSWALK_10m")
            pt = V(p)+dx*(trims[p]+1.45)
            put("ROADS", "ROAD_CROSSWALK", stripes[width], (*pt, 0), angle)


def build_plaza():
    base = Geometry()
    base.slab(circle(28.55, 8), 0, WALK_Z, METAL, CONCRETE)
    base.band(circle(26.1, 8), circle(25.84, 8), .211, METAL)
    base.band(circle(24.95, 8), circle(24.79, 8), .212, YELLOW)
    put("PLAZA", "PLAZA_OCTAGON", base.mesh("PLAZA_OCTAGON"))
    tile = Geometry()
    tile.box(0, 0, 0, 9.96, 9.96, .025, CONCRETE)
    for axis in (-2.5, 0, 2.5):
        tile.surface(rectangle(axis, 0, .033, 9.96), .026, METAL)
        tile.surface(rectangle(0, axis, 9.96, .033), .027, METAL)
    tile_mesh = tile.mesh("PLAZA_TILE_10m_pitch")
    for ix in range(-1, 2):
        for iy in range(-2, 3):
            if abs(ix)+abs(iy) == 3:
                continue
            put("PLAZA", "PLAZA_TILE_01", tile_mesh, (ix*10, iy*10, WALK_Z+.002))
    apron = Geometry()
    apron.band(circle(11.8, 48, 0, -8.3), circle(11.15, 48, 0, -8.3), .214, METAL)
    apron.band(circle(10.85, 48, 0, -8.3), circle(10.71, 48, 0, -8.3), .216, YELLOW)
    for sign in (-1, 1):
        apron.surface(rectangle(sign*3.8, -22.2, .15, 6.0), .215, YELLOW)
    apron.band(circle(4.4, 32, 0,-8.3), circle(4.15, 32, 0,-8.3), .216, WHITE)
    apron.band(circle(2.35, 6, 0,-8.3, math.pi/6), circle(1.83, 6, 0,-8.3, math.pi/6), .216, YELLOW)
    for i in range(16):
        angle = i*TAU/16
        direction = V((math.cos(angle), math.sin(angle)))
        centre = V((0,-8.3))+direction*11.48
        pts = [centre+direction*x+perp(direction)*y for x,y in rectangle(0,0,.40,.16)]
        apron.surface(pts, .217, YELLOW)
    put("PLAZA", "PLAZA_FORUM_INLAY", apron.mesh("FORUM_INLAY"))
    lettering("PLAZA", "PLAZA_ENTRY_PAINT", "CENTRAL   /   NEXUS", .83, (0,-22,.219), GRAPHITE)
    # The permanent steps stay when the separate Nexus mass is replaced.
    for i in range(4):
        g = Geometry()
        g.slab(rectangle(0, 0, 24.4-i*1.05, 18.4-i*1.05, 3.0-i*.22), 0, .16, CONCRETE, WHITE)
        put("PLAZA", "PLAZA_NEXUS_STEP", g.mesh("NEXUS_STEP"), (0, 6, .21+i*.16))


def build_lots():
    for number, (name, ((x, y), (w, d))) in enumerate(DISTRICTS.items(), 1):
        g = Geometry()
        g.slab(rectangle(0, 0, w, d, 2.2), 0, .17, METAL, WHITE)
        g.surface(rectangle(0, 0, w-2.2, d-2.2, 1.6), .172, CONCRETE)
        for sign in (-1, 1):
            g.surface(rectangle(sign*(w/2-2.6), 0, .13, d-7), .178, METAL)
        apron_y = (-d/2+5) if y > 0 else (d/2-5)
        g.surface(rectangle(0, apron_y, w-8, 4.2), .177, WHITE)
        g.surface(rectangle(0, apron_y-2.3, w-8, .14), .18, METAL)
        g.surface(rectangle(-w/2+6.4, apron_y-2.3, 4.8, .17), .182, YELLOW)
        obj = put("ENVIRONMENT", "LOT_"+name.upper(), g.mesh(name+"_LOT"), (x, y, 0))
        obj["district"], obj["footprint_m"] = name, [w, d]
        lettering("ENVIRONMENT", "LOT_PAINT_"+name.upper(), f"{number:02}   /   {name.upper()}",
                  1.4, (x,y+apron_y-.55,.182), GRAPHITE)
    # Walks meet the public side of each parcel and the adjacent sidewalk.
    for name, x, y, w, d in (
        ("GOVERNANCE", 0, 70.88, 11, 1.27),
        ("RESEARCH", -71.12, 59, 1.77, 7), ("RESIDENTIAL", 71.12, 59, 1.77, 7),
        ("COMMUNITY", -95, -32.125, 7, 48.75), ("CONSTRUCTION", 95, -32.125, 7, 48.75),
    ):
        g = Geometry()
        g.box(0, 0, 0, w, d, .17, CONCRETE, cap=WHITE)
        put("ENVIRONMENT", "WALK_"+name, g.mesh("PARCEL_APPROACH"), (x, y, 0))
    forum = Geometry()
    forum.box(0,0,0,31,21,.16,METAL,2,CONCRETE)
    for i in range(3):
        radius = 7.8+i*1.25
        angles = [math.radians(145+j*17.5) for j in range(13)]
        for a, b in zip(angles, angles[1:]):
            sector = [(r*math.cos(ang),r*math.sin(ang)) for r,ang in
                      ((radius,a),(radius+1.2,a),(radius+1.2,b),(radius,b))]
            forum.slab(sector,.16,.47+i*.31,GRAPHITE,WHITE)
    forum.band(circle(5.8,24),circle(5.45,24),.167,YELLOW)
    put("ENVIRONMENT", "COMMUNITY_OPEN_FORUM", forum.mesh("OPEN_FORUM"), (-95,-86,.172))


def hero(name, geom, pos):
    mesh = geom.mesh(name+"_MASS")
    obj = put("PLACEHOLDER_BUILDINGS", "PH_"+name, mesh, pos)
    obj["replacement_anchor"] = "Base centre, Blender +Z up, primary approach from local -Y"
    return obj


def build_masses():
    g = Geometry()
    g.slab(rectangle(0, 1.1, 18.5, 10.5, 1.7), 0, 4.1, GRAPHITE)
    for sign in (-1,1):
        g.box(sign*6.9,-4.25,0,4.65,4.2,4.1,GRAPHITE,.72)
    g.box(0,-4.25,0,6.9,.23,3.4, METAL)
    g.box(0,-4.39,.05,2.2,.12,2.9,BLACK)
    g.box(0,-5.75,3.3,8.75,3.45,.28,WHITE,.42)
    g.box(0,-7.50,3.38,4.35,.09,.14,YELLOW)
    g.slab(rectangle(0, 0, 19.6, 13.6, 2.8), 4.1, 4.65, METAL)
    for sign in (-1, 1):
        lo = rectangle(sign*5.8, 0, 5.3, 9.2, 1.05)
        hi = rectangle(sign*4.4, .7, 2.5, 6.5, .45)
        height = 23.8 if sign == 1 else 19.1
        g.loft(lo, hi, 4.65, height, BLACK, YELLOW)
        for i, (x, y) in enumerate(hi):
            idx = len(g.verts)-len(hi)+i
            g.verts[idx] = (x,y,height+(y-.7)*.4)
        g.loft(rectangle(sign*5.8, -4.62, 1.0, .10), rectangle(sign*4.4, -2.57, .42, .10),
               4.65, height-1.43, YELLOW)
    g.box(0, -.7, 4.65, 7, 7.5, 8.4, GRAPHITE, .66, METAL)
    # Six-sided civic mark recessed visually into the main entrance fascia.
    emblem = circle(1.17, 6, phase=math.pi/6)
    for p, q in zip(emblem, emblem[1:]+emblem[:1]):
        first = len(g.verts)
        g.verts.extend((x,-4.465,10.85+z) for x,z in (p,q,(q[0]*.69,q[1]*.69),(p[0]*.69,p[1]*.69)))
        g.face(tuple(range(first, first+4)),YELLOW)
    nexus = hero("CENTRAL_NEXUS", g, (0, 6, .85))
    lettering("PLACEHOLDER_BUILDINGS","PH_NEXUS_FASCIA","NEXUS",1.18,(0,-4.467,8.65),WHITE,nexus,True)
    g = Geometry()
    g.box(0, 0, 0, 38, 22, .72, CONCRETE, 1.2)
    g.box(0, 1, .72, 32, 16, 8.45, GRAPHITE, 1)
    for x in (-14.2, -8.5, 8.5, 14.2):
        g.box(x, -8.5, .72, 1.35, 3.4, 8.45, WHITE)
    g.box(0, -.6, 9.17, 36, 20, 2.15, CONCRETE, .9, WHITE)
    g.box(0, -10.63, 9.52, 12, .08, .24, YELLOW)
    hall = hero("GOVERNANCE_HALL", g, (0,95,.172))
    lettering("PLACEHOLDER_BUILDINGS","PH_GOVERNANCE_FASCIA","GOVERNANCE HALL",.98,
              (0,-7.02,6.2),WHITE,hall,True)
    g = Geometry()
    g.box(0, 1.2, 0, 26, 17.6, 4.5, CONCRETE, 1.35)
    for sign in (-1, 1):
        g.box(sign*9.1, -7.8, 0, 7.8, 4.4, 4.5, WHITE, .72)
    g.box(0,-7.66,0,8,.18,3.65,METAL)
    g.box(0,-7.78,0,2.7,.12,2.85,BLACK)
    g.box(0,-9.1,3.15,11,3.3,.30,WHITE,.28)
    g.box(0,-10.79,3.24,6.6,.10,.13,YELLOW)
    g.box(0, .5, 4.5, 24.5, 17.2, 2.05, BLACK, 1.05)
    g.box(0, 0, 6.55, 27.2, 20.6, .8, METAL, 1.3, WHITE)
    g.loft(circle(7.3, 12, -2, 1), circle(5, 12, -2, 1), 7.35, 11.25, GRAPHITE)
    g.loft(circle(5, 12, -2, 1), circle(1.9, 12, -2, 1), 11.25, 13.1, METAL)
    lab = hero("RESEARCH_CENTER", g, (-95,65,.172))
    lettering("PLACEHOLDER_BUILDINGS","PH_RESEARCH_FASCIA","RESEARCH",1.05,(0,-8.13,5),WHITE,lab,True)
    g = Geometry()
    g.box(0, 0, 0, 18, 14, 2.8, GRAPHITE, .45)
    for i in range(3):
        x = .8 if i % 2 else -.8
        g.box(x, 0, 2.8+i*3.4, 21, 15, 2.55, CONCRETE, .48, WHITE)
        g.box(0, .35, 5.35+i*3.4, 17.5, 13.1, .85, BLACK, .38)
    g.box(0, .2, 13, 18, 14, .38, WHITE, .38)
    hero("RESIDENTIAL_HOUSE", g, (95,65,.172))
    g = Geometry()
    g.box(0, 0, 0, 28, 17, 4.6, GRAPHITE, .45)
    for x in (-8.8, 0, 8.8):
        lo = rectangle(x, 0, 8.8, 16.5)
        g.loft(lo, rectangle(x+2.7, 0, 3.4, 16.5), 4.6, 7.4, METAL, CONCRETE)
    g.box(0, -9.05, 4.05, 24, 1.1, .5, YELLOW)
    works = hero("BUILD_WORKSHOP", g, (95,-85,.172))
    lettering("PLACEHOLDER_BUILDINGS","PH_WORKSHOP_FASCIA","BUILD WORKSHOP",.92,
              (0,-8.53,2.2),WHITE,works,True)


def build_context():
    # Quiet, linked envelopes mark street walls and future development parcels.
    types = []
    for w, d, h in ((17,10,5.4), (20,12,8.3), (12,10,10.6), (20,11,4.15)):
        g = Geometry()
        g.box(0, 0, 0, w-1.2, d-1, 2.45, GRAPHITE, .48)
        g.box(0, 0, 2.45, w, d, h-2.45, CONCRETE, .6, WHITE)
        g.box(-w*.09, .25, h, w*.65, d*.66, 1.25, METAL, .4)
        types.append(g.mesh(f"INFILL_{len(types)+1:02}"))
    for w,d,h,top in ((13,11,15,6),(16,12,10,4),(12,9,17,10)):
        g = Geometry()
        g.box(0,0,0,w,d,3.4,GRAPHITE,.45)
        g.box(0,0,3.4,w+.5,d+.5,h-3.4,CONCRETE,.55)
        g.box(-w*.14,0,h,w*.65,d-.7,top,GRAPHITE,.35,METAL)
        g.box(w*.34,0,3.4,1.15,d+.6,h-3.35,METAL)
        types.append(g.mesh(f"OUTER_MASS_{len(types)-3:02}"))
    for sx in (-1, 1):
        for sy in (-1, 1):
            pockets = [(18,50,0,0), (51,19,3,90), (49,94,1,90), (25,112,0,0),
                       (107,27,3,90), (107,105,0,0), (86,108,2,0),
                       (140,17,2,90), (140,46,5,90), (140,74,1,90),
                       (140,103,4,90), (104,140,5,0), (78,140,6,0),
                       (42,140,0,0), (17,140,4,0)]
            for x, y, idx, heading in pockets:
                # Keep the civic forecourt, open forum and works parcel readable.
                if sy == -1 and (x,y) in ((86,108), (107,105)):
                    continue
                if sy == -1 and idx >= 4:
                    idx = (idx+sx) % 4
                pos = (sx*x, sy*y, .172 if (sy==1 and x==25) else 0)
                put("CONTEXT_MASSING", "PH_INFILL", types[idx], pos, math.radians(heading))


def build_scale():
    g = Geometry()
    for x in (-.12, .12):
        g.box(x, 0, 0, .15, .23, .82, GRAPHITE, .035)
    g.loft(rectangle(0,0,.35,.22,.05), rectangle(0,0,.42,.24,.05), .8,1.43, GRAPHITE)
    for x in (-.245, .245):
        g.box(x, 0, .9, .09,.13,.48, METAL,.02)
    g.slab(circle(.135, 8), 1.46, 1.75, YELLOW)
    g.slab(circle(.07, 8), 1.4, 1.47, METAL)
    mesh = g.mesh("SCALE_FIGURE_1_75m")
    for x, y, z in ((-4.5,-8,.207),(3,-13,.207),(11,-3,.207),(0,77,.172)):
        put("DEBUG_SCALE", "DEBUG_HUMAN_175", mesh, (x,y,z))


def setup_studio(scene):
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "Khronos PBR Neutral"
    world = bpy.data.worlds.new("CIVRUM_DAYLIGHT")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    nodes = world.node_tree.nodes
    ambient = nodes.get("Background")
    ambient.inputs["Color"].default_value = (.70,.82,1,1)
    ambient.inputs["Strength"].default_value = .53
    sky = nodes.new("ShaderNodeBackground")
    coords = nodes.new("ShaderNodeTexCoord")
    split = nodes.new("ShaderNodeSeparateXYZ")
    gradient = nodes.new("ShaderNodeValToRGB")
    gradient.color_ramp.elements[0].color = (.73,.83,.96,1)
    gradient.color_ramp.elements[1].position = .48
    gradient.color_ramp.elements[1].color = (.23,.47,.79,1)
    mix = nodes.new("ShaderNodeMixShader")
    link = world.node_tree.links.new
    link(coords.outputs["Generated"],split.inputs[0])
    link(split.outputs["Z"],gradient.inputs[0])
    link(gradient.outputs[0],sky.inputs["Color"])
    link(nodes.new("ShaderNodeLightPath").outputs["Is Camera Ray"], mix.inputs[0])
    link(ambient.outputs[0], mix.inputs[1])
    link(sky.outputs[0], mix.inputs[2])
    link(mix.outputs[0], nodes.get("World Output").inputs["Surface"])
    sun = bpy.data.lights.new("CIVRUM_SOFT_SUN", "SUN")
    sun.energy, sun.angle, sun.color = 3.25, math.radians(6), (1,.905,.77)
    lamp = put("LIGHTING","SUN",sun,(-70,-85,108))
    lamp.rotation_euler = (-lamp.location).to_track_quat("-Z","Y").to_euler()
    # Photographic ground sweep, separate from the 300 m editable/game geometry.
    sweep = Geometry()
    sweep.surface(rectangle(0,0,3500,3500), 0, CONCRETE)
    obj = put("LIGHTING","STUDIO_GROUND_SWEEP",sweep.mesh("RENDER_BACKDROP"),(0,0,-.08))
    obj.hide_set(True)
    cameras = {}
    for name, pos, target, lens in (
        ("World_Overview", (49,-350,305), (0,-25,0), 34),
        ("Central_Plaza", (7,-56,9.2), (0,5,10), 31),
        ("Street_Detail", (-68.6,8,2.25), (-84,58,4.8), 30),
    ):
        data = bpy.data.cameras.new(name)
        data.lens, data.clip_end = lens, 2500
        obj = put("CAMERAS", "CAM_"+name.upper(), data, pos)
        obj.rotation_euler = (V(target)-obj.location).to_track_quat("-Z","Y").to_euler()
        cameras[name] = obj
    scene.camera = cameras["World_Overview"]
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.clip_end = 2500
                space.overlay.show_overlays = False
                space.shading.color_type = "MATERIAL"
                space.region_3d.view_distance = 200
                space.region_3d.view_perspective = "CAMERA"
    return cameras


def check_saved_scene(source):
    """Audit persisted geometry, including both sides of every road deck seam."""
    bpy.ops.wm.open_mainfile(filepath=str(source.resolve()))
    scene = bpy.context.scene
    root = bpy.data.collections["CIVRUM_WORLD"]
    assert set(root.children.keys()) == set(LAYERS)
    assert scene.unit_settings.system == "METRIC" and scene.unit_settings.scale_length == 1
    ground = bpy.data.objects["CIVRUM_ENV_GROUND_MAIN"]
    assert {tuple(v.co) for v in ground.data.vertices} == {(x,y,0) for x in (-150,150) for y in (-150,150)}
    assert len(bpy.data.collections["CAMERAS"].objects) == 3 and scene.camera
    assert scene.render.resolution_x*9 == scene.render.resolution_y*16
    for name, (xy, size) in DISTRICTS.items():
        obj = bpy.data.objects["CIVRUM_LOT_"+name.upper()]
        assert (obj.location.xy-V(xy)).length < .001 and (obj.dimensions.xy-V(size)).length < .001
    for obj in bpy.data.collections["DEBUG_SCALE"].objects:
        assert abs(obj.dimensions.z-1.75) < .001
    heroes = [obj for obj in bpy.data.collections["PLACEHOLDER_BUILDINGS"].objects if obj.type == "MESH"]
    assert {o.name.removeprefix("CIVRUM_PH_") for o in heroes} == {
        "CENTRAL_NEXUS","GOVERNANCE_HALL","RESEARCH_CENTER","BUILD_WORKSHOP","RESIDENTIAL_HOUSE"}
    for obj in root.all_objects:
        if obj.type != "MESH" or obj.name == "CIVRUM_STUDIO_GROUND_SWEEP":
            continue
        for corner in obj.bound_box:
            point = obj.matrix_world @ V(corner)
            assert max(abs(point.x),abs(point.y)) <= 150.001, (obj.name, point)
        assert (obj.scale-V((1,1,1))).length < .0001

    edges = road_graph()
    runs, caps, adjacency = defaultdict(list), {}, defaultdict(set)
    for obj in bpy.data.collections["ROADS"].objects:
        if "edge_xy" in obj:
            ax,ay,bx,by = obj["edge_xy"]
            runs[((ax,ay),(bx,by))].append(obj)
        if "node_xy" in obj:
            poly = obj.data.polygons[-1]
            caps[tuple(obj["node_xy"])] = [obj.matrix_world @ obj.data.vertices[i].co for i in poly.vertices]
    assert set(runs) == set(edges)
    max_gap, pieces = 0, 0
    for (a,b), width in edges.items():
        adjacency[a].add(b)
        adjacency[b].add(a)
        direction = (V(b)-V(a)).normalized()
        segments = sorted(runs[(a,b)], key=lambda obj: obj.location.xy.dot(direction))
        previous = None
        for obj in segments:
            assert obj["width_m"] == width and 0 < obj["length_m"] <= 20.001
            deck = [obj.matrix_world @ obj.data.vertices[i].co for i in obj.data.polygons[0].vertices]
            assert abs((deck[0]-deck[3]).length-width) < .001
            if previous:
                max_gap = max(max_gap,(previous[1]-deck[0]).length,(previous[2]-deck[3]).length)
            for node, pair, is_end in ((a,(0,3),obj == segments[0]),(b,(1,2),obj == segments[-1])):
                if not is_end:
                    continue
                if node in caps:
                    for i in pair:
                        max_gap = max(max_gap,min((v-deck[i]).length for v in caps[node]))
                else:
                    centre = (deck[pair[0]]+deck[pair[1]])*.5
                    max_gap = max(max_gap,(centre.xy-V(node)).length)
            previous = deck
            pieces += 1
    reached, pending = set(), [next(iter(adjacency))]
    while pending:
        node = pending.pop()
        if node not in reached:
            reached.add(node)
            pending.extend(adjacency[node]-reached)
    assert reached == set(adjacency) and max_gap < .001, (len(reached),max_gap)
    meshes = [o for o in root.all_objects if o.type == "MESH" and o.name != "CIVRUM_STUDIO_GROUND_SWEEP"]
    unique = {o.data for o in meshes}
    def tris(mesh):
        return sum(len(p.vertices)-2 for p in mesh.polygons)
    print(f"PASS: 300 x 300 m, 5 district parcels, 5 replacement anchors, scale figures 1.75 m, 3 cameras")
    print(f"PASS: {len(edges)} connected runs, {len(caps)} junctions, {pieces} straight pieces; "
          f"maximum deck seam error {max_gap*1000:.4f} mm")
    print(f"Mesh statistics (excluding studio sweep and text): {len(meshes)} placements, "
          f"{len(unique)} unique meshes, {sum(tris(o.data) for o in meshes)} placed triangles")


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--output-root", type=Path, default=ROOT)
    cli.add_argument("--render", action="store_true", help="Render all three review cameras.")
    cli.add_argument("--check", action="store_true", help="Reopen and inspect the existing blend read-only.")
    opts = cli.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    source = opts.output_root/"blender"/"CIVRUM_World_Blockout.blend"
    if opts.check:
        check_saved_scene(source)
        return
    names = ("World_Overview","Central_Plaza","Street_Detail")
    outputs = {name: opts.output_root/"renders"/f"CIVRUM_{name}.png" for name in names}
    for path in [source, *(outputs.values() if opts.render else [])]:
        if path.exists():
            raise FileExistsError(f"{path} already exists. Choose an empty --output-root.")
        path.parent.mkdir(parents=True, exist_ok=True)
    scene = build_scene()
    build_roads()
    build_plaza()
    build_lots()
    build_masses()
    build_context()
    build_scale()
    cameras = setup_studio(scene)
    scene["production_stage"] = "01 • Layout greybox"
    scene.render.filepath = "//../renders/CIVRUM_World_Overview.png"
    bpy.ops.wm.save_as_mainfile(filepath=str(source.resolve()), compress=True)
    if opts.render:
        for name, path in outputs.items():
            scene.camera = cameras[name]
            scene.render.filepath = str(path.resolve())
            bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
