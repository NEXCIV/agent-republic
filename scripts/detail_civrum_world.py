"""Dress the approved CIVRUM blockout and build its reusable Blender asset library."""

import argparse
import math
import random
import sys
import tempfile
from collections import Counter
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import convex_hull_2d

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_civrum_world as base
from build_civrum_world import (
    BLACK, CONCRETE, GRAPHITE, METAL, WHITE, YELLOW, Geometry, circle, rectangle,
)


LEAF, SUNLEAF, DEEPLEAF, GRASS, SOIL, BARK = range(6, 12)
PALETTE = base.PALETTE + (
    ("LEAF_SAGE", "75944D", 0, .86),
    ("LEAF_TIP", "A4B958", 0, .88),
    ("LEAF_SHADE", "476B4A", 0, .91),
    ("TURF", "82975F", 0, .94),
    ("PLANTING_SOIL", "605248", 0, .98),
    ("BARK", "645448", 0, .9),
)
PUBLIC, VEG, WORK = "PUBLIC_FACILITIES", "VEGETATION", "CONSTRUCTION"
WORLD_FILE = "CIVRUM_World_Environment.blend"
LIBRARY_FILE = "CIVRUM_Asset_Library.blend"
V = Vector


def garden_materials():
    for name, color, _, rough in PALETTE[6:]:
        mat = bpy.data.materials.new("MAT_" + name)
        if mat.node_tree is None:
            mat.use_nodes = True
        rgb = [int(color[i:i+2], 16)/255 for i in (0, 2, 4)]
        rgba = tuple(((v+.055)/1.055)**2.4 for v in rgb) + (1,)
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = rough
        mat.diffuse_color = rgba


def rod(g, start, end, r, color, tip=None, sides=6):
    a, b = V(start), V(end)
    axis = (b-a).normalized()
    ref = V((0, 1, 0)) if abs(axis.y) < .8 else V((1, 0, 0))
    u = axis.cross(ref).normalized()
    v = axis.cross(u)
    first = len(g.verts)
    for p, radius in ((a, r), (b, r if tip is None else tip)):
        for i in range(sides):
            angle = i*math.tau/sides
            g.verts.append(tuple(p + radius*(u*math.cos(angle)+v*math.sin(angle))))
    g.face(tuple(first+i for i in reversed(range(sides))), color)
    g.face(tuple(first+sides+i for i in range(sides)), color)
    for i in range(sides):
        j = (i+1) % sides
        g.face((first+i, first+j, first+sides+j, first+sides+i), color)


def panel(g, points, y, color):
    """Front-facing (-Y) graphic in local X/Z coordinates, counterclockwise."""
    first = len(g.verts)
    g.verts.extend((x, y, z) for x, z in points)
    g.face(tuple(range(first, first+len(points))), color)


def emblem(g, x, y, z, r, color=YELLOW):
    outer = circle(r, 6, x, z, math.pi/6)
    inner = circle(r*.65, 6, x, z, math.pi/6)
    for i in range(6):
        j = (i+1) % 6
        panel(g, [outer[i], outer[j], inner[j], inner[i]], y, color)


def streetlight(style):
    g = Geometry()
    g.box(0,0,0,.54,.54,.16,CONCRETE,.065)
    if style == 1:
        g.box(0,0,.16,.29,.28,.78,GRAPHITE,.035)
        g.loft(rectangle(0,0,.23,.23), rectangle(.1,0,.13,.18), .94,5.45,METAL)
        rod(g,(.10,0,5.22),(1.18,0,5.82),.095,GRAPHITE,.075,4)
        g.box(1.27,0,5.72,1.18,.38,.16,BLACK,.07)
        g.box(1.43,0,5.69,.72,.26,.032,WHITE,.04)
        g.box(0,0,.81,.295,.285,.075,YELLOW)
    elif style == 2:
        g.box(0,0,.16,.28,.26,4.8,GRAPHITE,.035)
        g.box(.32,0,4.68,1.06,.17,.11,METAL)
        g.box(.53,0,2.54,.73,.075,2.12,YELLOW)
        emblem(g,.53,-.04,4.08,.232,GRAPHITE)
        for i in range(3):
            panel(g,rectangle(.53,2.8+i*.14,.45-i*.09,.045),-.04,GRAPHITE)
        g.box(0,0,4.96,1.25,.38,.18,GRAPHITE,.055)
        for x in (-.38,.38):
            g.box(x,0,4.92,.38,.26,.04,WHITE)
    else:
        g.box(0,0,.16,.32,.30,2.72,GRAPHITE,.055)
        g.box(0,0,2.88,.37,.34,.48,WHITE,.052)
        for x in (-.18,.18):
            g.box(x,0,2.87,.05,.36,.52,METAL)
        g.box(0,0,3.36,.46,.43,.11,BLACK,.05)
        g.box(0,-.155,2.45,.15,.02,.26,YELLOW)
    return g


def bench(style):
    g = Geometry()
    length = 2.45 if style == 1 else 3.12
    for x in (-length*.34,length*.34):
        g.box(x,0,0,.20,.56,.39,GRAPHITE,.045)
        g.box(x,0,0,.33,.63,.07,METAL,.045)
    if style == 1:
        for i in range(4):
            g.box(0,-.23+i*.15,.39,length,.13,.095,METAL,.028)
        for x in (-.82,.82):
            rod(g,(x,.21,.40),(x,.36,.90),.043,BLACK, sides=4)
        for i in range(2):
            g.box(0,.30+i*.033,.65+i*.16,length,.09,.13,METAL,.022)
        g.box(0,-.288,.39,.55,.028,.042,YELLOW)
    else:
        g.box(0,0,.35,length,.8,.16,CONCRETE,.16,WHITE)
        g.box(.29,.19,.51,1.98,.22,.29,GRAPHITE,.08)
    return g


def kiosk(style):
    g = Geometry()
    w, h = (1.15,2.25) if style == 1 else (.80,1.52)
    g.box(0,0,0,w+.25,.79,.12,CONCRETE,.10)
    g.loft(rectangle(0,0,w*.75,.4,.055),rectangle(0,0,w,.51,.06),.12,h,GRAPHITE)
    g.box(0,0,h,w+.055,.54,.12,YELLOW,.05)
    g.box(0,-.25,h*.37,w*.84,.07,h*.50,BLACK,.024)
    front = -.291
    if style == 1:
        for pts in (
            [(-.37,1.80),(-.06,1.80),(-.15,1.55),(-.37,1.49)],
            [(.02,1.80),(.38,1.80),(.38,1.57),(.14,1.51)],
            [(-.36,1.44),(-.14,1.48),(.05,1.24),(-.35,1.16)],
            [(.18,1.46),(.37,1.52),(.37,1.18),(.11,1.24)],
        ):
            panel(g,list(reversed(pts)),front,LEAF)
        emblem(g,0,front-.003,1.48,.11,WHITE)
        for i in range(3):
            panel(g,rectangle(-.15,1.00+i*.07,.40-i*.07,.025),front,WHITE)
    else:
        emblem(g,0,front,h*.73,.17)
        for i in range(2):
            panel(g,rectangle(0,.73+i*.09,.43-i*.08,.032),front,WHITE)
    return g


def planter(style):
    g = Geometry()
    if style == 1:
        top, bottom, inside, h = circle(1.75,10), circle(1.46,10), circle(1.54,10), .52
    elif style == 2:
        top, bottom, inside, h = rectangle(0,0,4.6,1.65,.28),rectangle(0,0,4.3,1.42,.20),rectangle(0,0,4.28,1.33,.20),.52
    else:
        top, bottom, inside, h = rectangle(0,0,2.8,2.8,.53),rectangle(0,0,2.55,2.55,.42),rectangle(0,0,2.43,2.43,.39),.68
    g.loft(bottom, top, 0,h-.115, GRAPHITE if style == 3 else CONCRETE)
    g.slab(top,h-.115,h,WHITE)
    g.surface(inside,h+.003,SOIL)
    return g


def street_furniture():
    catalog = {}
    for prefix, count, builder in (("STREETLIGHT",3,streetlight),("BENCH",2,bench),
                                    ("INFO_KIOSK",2,kiosk),("PLANTER",3,planter)):
        for n in range(1,count+1):
            catalog[f"PROP_{prefix}_{n:02}"] = builder(n)
    g = Geometry()
    g.slab(circle(.32,8),0,.10,METAL)
    g.loft(circle(.27,8),circle(.32,8),.10,.83,GRAPHITE)
    g.slab(circle(.33,8),.83,.89,YELLOW)
    g.slab(circle(.32,8),.89,.98,METAL)
    g.surface(circle(.19,8),.981,BLACK)
    catalog["PROP_BIN_01"] = g
    g = Geometry()
    g.box(0,0,0,.42,.42,.12,CONCRETE,.05)
    g.box(0,0,.12,.16,.16,2.77,GRAPHITE)
    g.box(.38,0,2.32,1.28,.14,.49,BLACK,.05)
    emblem(g,.06,-.073,2.565,.13)
    panel(g,[(.37,2.51),(.68,2.51),(.68,2.42),(.90,2.565),(.68,2.71),(.68,2.62),(.37,2.62)],-.073,WHITE)
    catalog["PROP_WAYFINDER_01"] = g
    g = Geometry()
    g.slab(circle(.18,8),0,.09,METAL)
    g.slab(circle(.115,8),.09,.82,GRAPHITE)
    g.slab(circle(.119,8),.65,.73,YELLOW)
    g.slab(circle(.12,8),.82,.87,METAL)
    catalog["PROP_BOLLARD_01"] = g
    g = Geometry()
    for x in (-1.42,1.42):
        g.box(x,0,0,.14,.21,1.02,GRAPHITE,.022)
    for z in (.38,.87):
        g.box(0,0,z,2.84,.085,.095,METAL)
    catalog["PROP_RAIL_01"] = g
    # A faceted civic marker for the forum. The crystal seats into a dark socket.
    g = Geometry()
    g.loft(circle(1.97,32),circle(1.88,32),0,.18,CONCRETE,WHITE)
    g.slab(circle(1.54,16,phase=math.pi/16),.18,.38,GRAPHITE)
    g.slab(circle(1.37,16,phase=math.pi/16),.38,.42,YELLOW)
    g.loft(circle(1.27,8),circle(.86,8),.42,.77,METAL,BLACK)
    g.loft(circle(.69,6,phase=.15),circle(.57,6,phase=.15),.77,.91,BLACK)
    rings = [(.43,.88,.15), (1.14,1.55,.65), (.91,2.23,.15), (.28,2.57,.65)]
    for r,z,turn in rings:
        g.verts.extend((x,y,z) for x,y in circle(r,5,phase=turn))
    start = len(g.verts)-20
    g.face(tuple(start+i for i in reversed(range(5))),YELLOW)
    for row in range(3):
        for i in range(5):
            a,b = start+row*5+i,start+row*5+(i+1)%5
            g.face((a,b,b+5),YELLOW)
            g.face((a,b+5,a+5),YELLOW)
    g.face(tuple(start+15+i for i in range(5)),YELLOW)
    catalog["PROP_PLAZA_BEACON_01"] = g
    return catalog


def crown(g, pos, radius, height, sides, seed, shades):
    """Irregular, faceted canopy with brighter upper planes and a shaded underside."""
    rng = random.Random(seed)
    x,y,z = pos
    first = len(g.verts)
    for spread,lev,twist in ((.40,.03,.3),(.91,.26,0),(1,.58,.45),(.70,.86,.1),(.27,.98,.5)):
        for i in range(sides):
            a = (i+twist+rng.uniform(-.12,.12))*math.tau/sides
            r = radius*spread*rng.uniform(.83,1.12)
            g.verts.append((x+r*math.cos(a)+.12*radius*lev,y+r*math.sin(a),
                            z+height*(lev+rng.uniform(-.025,.025))))
    g.face(tuple(first+i for i in reversed(range(sides))),shades[0])
    for row in range(4):
        for i in range(sides):
            j = (i+1) % sides
            a,b = first+row*sides+i,first+row*sides+j
            c,d = b+sides,a+sides
            for face in ((a,b,c),(a,c,d)):
                # Neighbouring faces share most pigments; silhouette supplies the detail.
                color = shades[0] if row == 0 else shades[1]
                if row >= 2 and rng.random() < .30:
                    color = shades[2]
                g.face(face,color)
    g.face(tuple(first+4*sides+i for i in range(sides)),shades[2])


def tree(kind):
    g = Geometry()
    shades = (DEEPLEAF,LEAF,SUNLEAF)
    if kind == 1:  # Planted shade tree with a branching, asymmetrical crown.
        rod(g,(0,0,0),(.06,.03,2.85),.24,BARK,.14)
        lobes = [(-.95,.32,2.72,1.72,2.46),(.84,.30,3.08,1.62,2.62),(.08,-.48,3.68,1.95,2.77)]
    elif kind == 2:  # Upright crown suits the narrower street-side beds.
        rod(g,(0,0,0),(.02,0,3.3),.17,BARK,.10)
        lobes = [(0,0,2.0,1.24,3.8),(.12,.02,3.35,1.05,3.55)]
        shades = (DEEPLEAF,DEEPLEAF,LEAF)
    else:  # Broad multi-stem tree for the public garden.
        rod(g,(0,0,0),(-.13,0,2.13),.24,BARK,.16)
        lobes = [(-1.46,.23,2.56,1.55,2.02),(1.25,.35,2.9,1.69,2.02),(.16,-.55,3.56,1.88,2.10)]
    # The trunk leans, but its mounting face sits flat in the planting bed.
    for i in range(6):
        x,y,_ = g.verts[i]
        g.verts[i] = (x,y,0)
    for i,(x,y,z,r,h) in enumerate(lobes):
        rod(g,(0,0,1.48+i*.18),(x,y,z+.5),.135,BARK,.075)
        crown(g,(x,y,z),r,h,7 if kind != 2 else 8, 150*kind+i,shades)
    return g


def landscape_assets():
    catalog = {f"TREE_{n:02}":tree(n) for n in (1,2,3)}
    for n in (1,2):
        g = Geometry()
        for i,(x,y,r,h) in enumerate(((-.42,.04,.57,.70),(.37,.11,.64,.90),(0,-.21,.58,.70))):
            crown(g,(x,y,.03),r if n==1 else r*.82,h if n==1 else h*1.28,
                  6,421*n+i,(DEEPLEAF,LEAF,SUNLEAF) if n==1 else (DEEPLEAF,DEEPLEAF,LEAF))
        bottom = min(z for x,y,z in g.verts)
        g.verts = [(x,y,z-bottom) for x,y,z in g.verts]
        catalog[f"SHRUB_{n:02}"] = g
    g = Geometry()
    g.box(0,0,0,12,8,.065,GRASS)
    catalog["GREEN_LAWN_01"] = g
    g = Geometry()
    g.box(0,0,0,10,3.2,.16,CONCRETE,.48)
    g.surface(rectangle(0,0,9.67,2.87,.37),.162,GRASS)
    catalog["GREEN_VERGE_01"] = g
    g = Geometry()
    # Plant as one flowering cushion. Only the exposed leaves and corollas need faces.
    for i,(x,y) in enumerate(((-.33,.05),(.27,.04),(0,-.16))):
        outline = circle(.39,7,x,y,i*.6)
        first = len(g.verts)
        g.verts.extend((xx,yy,0) for xx,yy in outline)
        g.verts.append((x,y,.27))
        for j in range(7):
            g.face((first+j,first+(j+1)%7,first+7), LEAF if (j+i)%3 else DEEPLEAF)
        for j in range(3):
            a = .6+i+j*math.tau/3
            cx,cy = x+math.cos(a)*.125,y+math.sin(a)*.125
            first_bloom = len(g.verts)
            g.verts.append((cx,cy,.185))
            for k in range(10):
                r = .10 if k%2==0 else .047
                turn = a+k*math.tau/10
                g.verts.append((cx+r*math.cos(turn),cy+r*math.sin(turn),.225 if k%2==0 else .20))
            for k in range(10):
                g.face((first_bloom,first_bloom+1+k,first_bloom+1+(k+1)%10),WHITE if j!=1 else YELLOW)
    catalog["GREEN_FLOWERS_01"] = g
    return catalog


def works_assets():
    assets = {}
    g = Geometry()
    g.box(0,0,0,6,4,.30,CONCRETE,.05)
    for x in (-2.55,2.55):
        for y in (-1.55,1.55):
            g.box(x,y,.30,.70,.70,.32,METAL,.04)
            for dx in (-.18,.18):
                rod(g,(x+dx,y,.62),(x+dx,y,.94),.045,GRAPHITE,sides=5)
    assets["CONSTRUCTION_FOUNDATION_01"] = g
    g = Geometry()
    for x in (-1.90,1.90):
        g.box(x,0,0,.20,.54,.14,CONCRETE,.035)
        g.box(x,0,.14,.13,.14,1.83,METAL)
    g.box(0,0,.22,3.76,.10,1.60,GRAPHITE)
    for x in (-1.3,-.66,0,.66,1.3):
        g.box(x,0,.28,.038,.125,1.45,METAL)
    g.box(0,0,1.82,3.87,.15,.10,YELLOW)
    assets["CONSTRUCTION_FENCE_01"] = g
    g = Geometry()
    for x in (-1.43,1.43):
        for y in (-.63,.63):
            rod(g,(x,y,0),(x,y,2.4),.059,METAL)
        rod(g,(x,-.63,1.45),(x,.63,1.45),.059,METAL)
        rod(g,(x,-.63,2.32),(x,.63,2.32),.050,YELLOW)
    for y in (-.63,.63):
        for z in (.19,1.45,2.32):
            rod(g,(-1.43,y,z),(1.43,y,z),.050,YELLOW if z>2 else METAL)
        for a,b in ((.19,1.45),(1.45,.19)):
            rod(g,(-1.43,y,a),(1.43,y,b),.035,METAL,sides=5)
    for y in (-.42,0,.42):
        g.box(0,y,1.45,2.92,.40,.092,GRAPHITE)
    assets["CONSTRUCTION_SCAFFOLD_01"] = g
    g = Geometry()
    for x in (-1.45,1.45):
        for y in (-.67,.67):
            g.box(x,y,0,.12,.12,1.70,GRAPHITE)
        for z in (.18,.89):
            g.box(x,0,z,.16,1.46,.12,YELLOW)
    for y in (-.60,.60):
        g.box(0,y,.18,3.06,.12,.12,METAL)
    for z in (.31,1.02):
        for y in (-.39,0,.39):
            rod(g,(-1.84,y,z+.16),(1.84,y,z+.16),.145,METAL,sides=8)
    assets["CONSTRUCTION_RACK_01"] = g
    g = Geometry()
    g.box(0,0,0,3.8,.70,.16,CONCRETE,.055)
    g.box(0,0,.16,3.7,.27,.43,CONCRETE)
    g.box(0,0,.59,3.8,.70,.16,CONCRETE,.055)
    assets["CONSTRUCTION_PRECAST_01"] = g
    g = Geometry()
    for x in (-1.03,1.03):
        g.box(x,0,0,.32,.76,.13,GRAPHITE,.07)
        g.box(x,0,.13,.11,.13,.94,METAL)
    g.box(0,0,.53,2.6,.15,.52,YELLOW,.025)
    for i in range(5):
        x = -.94+i*.43
        panel(g,[(x-.15,.55),(x+.02,.55),(x+.22,1.03),(x+.05,1.03)],-.077,BLACK)
    assets["CONSTRUCTION_BARRIER_01"] = g
    return assets


def create_catalog():
    catalog = {}
    for layer, assets in ((PUBLIC,street_furniture()),(VEG,landscape_assets()),(WORK,works_assets())):
        for key, geom in assets.items():
            mesh = geom.mesh("CIVRUM_MODULE_"+key, PALETTE)
            mesh["module"],mesh["layer"] = key,layer
            catalog[key] = mesh
    return catalog


def terrain_bvh():
    verts, faces = [], []
    for layer in ("ENVIRONMENT","ROADS","PLAZA"):
        for obj in bpy.data.collections[layer].objects:
            if obj.type != "MESH":
                continue
            offset = len(verts)
            verts.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
            faces.extend(tuple(offset+i for i in p.vertices) for p in obj.data.polygons)
    return BVHTree.FromPolygons(verts,faces)


def ground_z(terrain,x,y):
    hit = terrain.ray_cast(V((x,y,20)),V((0,0,-1)),25)[0]
    if hit is None:
        raise ValueError(f"Outside city ground at {x}, {y}")
    return hit.z


def surface_details():
    # Site-specific paving belongs to the environment. Furniture remains removable.
    paved = Geometry()
    w,d = 19.75,25.5
    paved.box(0,0,0,w,d,.155,METAL)
    for row in range(10):
        y = -d/2+(row+.5)*d/10
        # Stagger half a slab on alternate courses while retaining straight edges.
        seams = [-w/2]+[-w/2+w*(i+.5*(row%2))/6 for i in range(7)
                          if 0 < i+.5*(row%2) < 6]+[w/2]
        for a,b in zip(seams,seams[1:]):
            paved.surface(rectangle((a+b)/2,y,b-a-.031,d/10-.031),.158,CONCRETE)
    for row in range(5):
        y = -10+row*5
        paved.surface(rectangle(8.85,y,.52,2.25),.16,METAL)
        for j in range(7):
            paved.surface(rectangle(8.85,y-.84+j*.28,.31,.075),.163,GRAPHITE)
    walk = paved.mesh("CIVRUM_PRECINCT_PAVING",PALETTE)
    for side in (-1,1):
        x = side*80.125
        base.put("ENVIRONMENT","PAVED_FORECOURT",walk,(x,20.75,0),math.pi if side>0 else 0)
    # Short sloping apron joins the eight-metre works gate to the outer public sidewalk.
    lane = Geometry()
    for x,y,z in ((-4,-4.1,.18),(4,-4.1,.18),(4,4.1,.173),(-4,4.1,.173)):
        lane.verts.append((x,y,z))
    lane.face((0,1,2,3),CONCRETE)
    base.put("ENVIRONMENT","WORKS_GATE_APPROACH",lane.mesh("GATE_APPROACH",PALETTE),(99,-115.7,0))
    paint = Geometry()
    for sign in (-1,1):
        paint.surface(rectangle(sign*3.7,-3.4,.11,9.6),.187,YELLOW)
        for i in range(6):
            x,y = sign*2.80,-7.7+i*.79
            stripe = [(x-.42,y-.20),(x+.42,y+.15),(x+.42,y+.37),(x-.42,y+.02)]
            paint.surface(stripe,.188,WHITE)
    paint.surface([(-.15,-4),(.15,-4),(.15,-2.3),(.58,-2.3),(0,-1.55),(-.58,-2.3),(-.15,-2.3)],.189,YELLOW)
    for x,y,w,d in ((-12,4.2,19,6.8),(10.1,5.8,6,6.3)):
        paint.band(rectangle(x,y,w,d,.18),rectangle(x,y,w-.18,d-.18,.12),.188,METAL)
    base.put("ENVIRONMENT","WORKS_YARD_MARKINGS",paint.mesh("WORKS_PAINT",PALETTE),(99,-111.6,0))
    base.lettering("ENVIRONMENT","WORKS_GATE_PAINT","05   /   WORKS",.80,(99,-111.65,.191),GRAPHITE)

    # Recessed apron and tactile metal strips make each pair of seats a small bay.
    bay = Geometry()
    footprint = rectangle(0,0,6.1,3.4,.45)
    bay.slab(footprint,0,.035,METAL,CONCRETE)
    bay.band(footprint,rectangle(0,0,5.91,3.21,.38),.038,METAL)
    for i in range(3):
        bay.surface(rectangle(-2.38+i*.18,0,.075,2.47),.040,METAL)
    seat_base = bay.mesh("CIVRUM_SEATING_APRON",PALETTE)
    for side in (-1,1):
        base.put("PLAZA","PLAZA_SEATING_APRON",seat_base,(side*15.3,-8.1,.181),math.radians(side*-74))


class Footprint:
    """Convex footprint and AABB for reserving actual parcels, roads and paths."""
    def __init__(self, points):
        points = [V(p) for p in points]
        self.poly = [points[i] for i in convex_hull_2d(points)]
        self.lo = tuple(min(p[i] for p in self.poly) for i in (0,1))
        self.hi = tuple(max(p[i] for p in self.poly) for i in (0,1))

    def overlaps(self, other):
        if any(self.hi[i] <= other.lo[i]+.001 or other.hi[i] <= self.lo[i]+.001 for i in (0,1)):
            return False
        for poly in (self.poly,other.poly):
            for i,p in enumerate(poly):
                edge = p-poly[i-1]
                axis = V((-edge.y,edge.x)).normalized()
                aa = [v.dot(axis) for v in self.poly]
                bb = [v.dot(axis) for v in other.poly]
                if max(aa) <= min(bb)+.001 or max(bb) <= min(aa)+.001:
                    return False
        return True


def footprint(obj):
    pts = [(obj.matrix_world @ v.co).xy for v in obj.data.vertices]
    return Footprint(pts)


class Dressing:
    def __init__(self, catalog):
        self.catalog = catalog
        self.terrain = terrain_bvh()

    def place(self, key, x, y, heading=0, *, z=None, parent=None):
        if z is None:
            if parent:
                raise ValueError("Provide the height of the local mounting surface")
            z = ground_z(self.terrain,x,y)
        mesh = self.catalog[key]
        obj = base.put(mesh["layer"],key,mesh,(x,y,z),math.radians(heading))
        if parent:
            obj.parent = parent
        return obj

    def banner(self,x,y,heading,code):
        lamp = self.place("PROP_STREETLIGHT_02",x,y,heading)
        # The district nameplate belongs to this placement, not to the reusable lamp.
        base.lettering("ENVIRONMENT","BANNER_DISTRICT_CODE",code,.225,
                       (.53,-.045,3.52),GRAPHITE,lamp,True)
        return lamp

    def planter(self, kind, x,y, heading, tree_id=0):
        bed = self.place(f"PROP_PLANTER_{kind:02}",x,y,heading)
        top = .683 if kind==3 else .523
        if tree_id:
            self.place(f"TREE_{tree_id:02}",0,0,heading*1.7,z=top,parent=bed)
        if kind == 2:
            for xx,n in ((-1.35,1),(0,2),(1.35,1)):
                self.place(f"SHRUB_{n:02}",xx,0,xx*42,z=top,parent=bed)
        else:
            for a in (30,150,270):
                r = .88 if kind==1 else .80
                self.place("GREEN_FLOWERS_01",r*math.cos(math.radians(a)),r*math.sin(math.radians(a)),
                           a+90,z=top,parent=bed)
        return bed

    def verge(self,x,y,heading,trees=(2,),flowers=False):
        bed = self.place("GREEN_VERGE_01",x,y,heading)
        for i,n in enumerate(trees):
            xx = 0 if len(trees)==1 else -2.6+i*5.2
            self.place(f"TREE_{n:02}",xx,0,i*139+x,z=.162,parent=bed)
        if flowers:
            for xx in (-3.5,-1.8,1.8,3.5):
                self.place("GREEN_FLOWERS_01",xx,-.58,xx*19,z=.162,parent=bed)
        else:
            for xx in (-3.4,3.4):
                self.place("SHRUB_02",xx,.28,xx*19,z=.162,parent=bed)
        return bed


def plaza_and_districts(d):
    d.place("PROP_PLAZA_BEACON_01",0,-8.3,16)
    for side in (-1,1):
        d.planter(1,side*17.8,-7.5,side*24,1)
        d.planter(3,side*14.6,14.8,side*20,2)
        d.planter(2,side*12.7,-17.5,side*30)
        d.place("PROP_BENCH_01",side*15.3,-8.2,side*-74)
        d.place("PROP_BENCH_02",side*9.4,18.5,0)
        d.place("PROP_BIN_01",side*15,-10.25)
        d.place("PROP_INFO_KIOSK_01" if side<0 else "PROP_INFO_KIOSK_02",side*9,-14.4,side*-12)
        d.banner(side*12.8,-18.95,side*10,"N X")
        d.place("PROP_STREETLIGHT_03",side*20.4,3)
        for y in (-23.4,-20):
            d.place("PROP_BOLLARD_01",side*5.4,y)
        # Governance forecourt. Long galleries flank the central approach.
        d.verge(side*20,78,0,(1,2),True)
        d.planter(2,side*9,81,side*90)
        d.place("PROP_BENCH_01",side*16,81,180)
        d.place("PROP_INFO_KIOSK_01",side*7.8,78,side*-15)
        d.banner(side*24,82,0,"G 01")
        d.verge(side*30,96,90,(2,3))
        # Research and housing share a green frontage but keep their entries clear.
        x = side*95
        for dx in (-14,14):
            d.verge(x+dx,45,90,(1 if dx<0 else 2,),True)
            d.place("PROP_BENCH_01",x+dx*.79,45,90 if dx>0 else -90)
            d.place("PROP_STREETLIGHT_03",x+dx,52)
        d.planter(3,x+side*7.8,50.5,10,2)
        d.place("PROP_INFO_KIOSK_02",x-side*7.5,50.6,-10*side)
        d.place("PROP_BIN_01",x+side*10.6,42.9)
        d.verge(x,83,0,(3,1))
        for xoff,y,n in ((80,16,2),(85.5,27,1)):
            d.verge(side*xoff,y,90,(n,),True)
        d.place("PROP_BENCH_02",side*76.7,23,side*-90)
        d.banner(side*73,22,side*-20,"R 02" if side<0 else "H 03")
        # Parallel alleys leading into the community and works parcels.
        for y in (-17,-34,-50):
            d.verge(side*88,y,90,(1 if y!=-34 else 2,),True)
        d.place("PROP_WAYFINDER_01",side*91,-17,math.degrees(math.atan2(17,-side*91)))
    for side in (-1,1):
        d.verge(-95+side*17,-75,90,(3,),True)
        d.verge(-95+side*14,-103,0,(1,),True)
        d.place("PROP_BENCH_02",-95+side*11,-72,180)
        d.place("PROP_STREETLIGHT_03",-95+side*14,-75)
        d.place("PROP_BIN_01",-95+side*13,-72)
        for i in range(3):
            d.place("PROP_RAIL_01",-95+side*(3+i*3),-100)
    d.place("PROP_INFO_KIOSK_01",-106,-66)


def road_lights(d):
    caps = {tuple(o["node_xy"]):o["setback_m"] for o in bpy.data.collections["ROADS"].objects if "node_xy" in o}
    buildings = [footprint(o) for o in bpy.data.collections["PLACEHOLDER_BUILDINGS"].all_objects if o.type=="MESH"]
    for i,((p,q),width) in enumerate(base.road_graph().items()):
        a,b = V(p),V(q)
        direction = (b-a).normalized()
        side = base.perp(direction)
        low = caps.get(p,0)+3
        span = (b-a).length-low-caps.get(q,0)-3
        if span < 6:
            continue
        count = max(1,round(span/(27 if width==10 else 32)))
        for j in range(count):
            mid = a+direction*(low+(j+.5)*span/count)
            for sign in ((-1,1) if width==10 else (1 if (i+j)%2 else -1,)):
                xy = mid+side*(width/2+.85)*sign
                angle = math.degrees(math.atan2(-side.y*sign,-side.x*sign))
                banner = width==10 and 39 < max(abs(xy.x),abs(xy.y)) < 65 and sign==1
                key = "PROP_STREETLIGHT_02" if banner else "PROP_STREETLIGHT_01"
                # At outer blocks some building eaves project over the footway.
                light_dir = -side*sign
                shape = Footprint([xy+light_dir*v.co.x+base.perp(light_dir)*v.co.y
                                   for v in d.catalog[key].vertices])
                if not any(shape.overlaps(b) for b in buildings):
                    d.place(key,*xy,angle)


def worksite(d):
    # A forty-metre frontage with an eight-metre entrance on the south.
    for x in range(77,115,4):
        d.place("CONSTRUCTION_FENCE_01",x,-95.6)
        if x not in (97,101):
            d.place("CONSTRUCTION_FENCE_01",x,-111.6,180)
    for x in (75,115):
        for y in (-109.6,-105.6,-101.6,-97.6):
            d.place("CONSTRUCTION_FENCE_01",x,y,90)
    for x in (82,88,94):
        for y in (-104,-100):
            d.place("CONSTRUCTION_FOUNDATION_01",x,y)
    for i in range(5):
        for level in range(3 if i<3 else 2):
            xy = (80+i*3,-106.95)
            d.place("CONSTRUCTION_SCAFFOLD_01",*xy,z=ground_z(d.terrain,*xy)+level*2.4)
    for y in (-98.5,-102.4):
        d.place("CONSTRUCTION_RACK_01",108.5,y)
    for i in range(3):
        for level in range(2):
            xy = (107.9,-106-i*.97)
            d.place("CONSTRUCTION_PRECAST_01",*xy,z=ground_z(d.terrain,*xy)+level*.75)
    for x,y,heading in ((94,-109.5,-12),(104,-109.5,12),(79,-96.9,0)):
        d.place("CONSTRUCTION_BARRIER_01",x,y,heading)
    placard = Geometry()
    placard.box(0,0,0,1.52,.085,.90,WHITE,.06)
    placard.box(0,-.047,.61,1.49,.015,.24,YELLOW)
    sign = base.put("ENVIRONMENT","WORKS_GATE_SIGN",placard.mesh("SITE_NOTICE",PALETTE),
                    (93,-111.72,.90))
    for label,size,height in (("WORKS",.30,.28),("SERVICE ENTRY",.12,.10)):
        base.lettering("ENVIRONMENT","WORKS_GATE_SIGN_TYPE",label,size,
                       (0,-.049,height),GRAPHITE,sign,True)


def pocket_parks(d):
    # Plant on clear ground only. This also respects future manual edits to the input blockout.
    bpy.context.view_layer.update()
    keepout = []
    for layer in ("ROADS","ENVIRONMENT","PLAZA","PLACEHOLDER_BUILDINGS",PUBLIC,VEG,WORK):
        for obj in bpy.data.collections[layer].all_objects:
            if obj.type=="MESH" and obj.name!="CIVRUM_ENV_GROUND_MAIN":
                keepout.append(footprint(obj))
    # The south gate opens onto the outer road; reserve the approach for vehicles.
    keepout.append(Footprint(rectangle(99,-114.7,10,11)))
    # Reserve the complete sidewalk at junctions and a buffer around each planting tile.
    for row,y in enumerate(range(-137,143,14)):
        for col,x in enumerate(range(-137+(row%2)*5,144,14)):
            if max(abs(x),abs(y))>126 and (row+col)%2:
                continue
            heading = 90 if (row+col)%3==1 else 0
            w,h = (10,14) if heading else (14,10)
            bounds = Footprint(rectangle(x,y,w,h))
            if any(bounds.overlaps(k) for k in keepout):
                continue
            keepout.append(bounds)
            bed = d.place("GREEN_LAWN_01",x,y,heading)
            variant = (row*3+col)%5
            for i,(xx,yy) in enumerate(((-3,1),(2.7,-.55))):
                n = (variant+i)%3+1
                d.place(f"TREE_{n:02}",xx,yy,32*col+107*i,z=.065,parent=bed)
            d.place("SHRUB_01",.35,-2.15,56*row,z=.065,parent=bed)
            if variant%2==0:
                d.place("SHRUB_02",-1,2.15,48*col,z=.065,parent=bed)
    # Smaller linear beds fit the wedge-shaped blocks that cannot take a lawn.
    # Keep the full sidewalk free and give street-facing buildings an approach.
    for i,((p,q),width) in enumerate(base.road_graph().items()):
        a,b = V(p),V(q)
        direction = (b-a).normalized()
        normal = base.perp(direction)
        length = (b-a).length
        count = max(1,round(length/19))
        angle = math.degrees(math.atan2(direction.y,direction.x))
        for j in range(count):
            mid = a+direction*(length*(j+.5)/count)
            for sign in (-1,1):
                centre = mid+normal*(width/2+base.WALK+2.15)*sign
                if max(map(abs,centre))>143:
                    continue
                pts = [centre+direction*x+normal*y for x,y in rectangle(0,0,10.6,3.8)]
                bounds = Footprint(pts)
                if any(bounds.overlaps(k) for k in keepout):
                    continue
                keepout.append(bounds)
                n = 1+(i+j+sign)%3
                d.verge(*centre,angle,(n,),False)


def asset_previews(assets):
    """Pack a colour thumbnail per module for drag-and-drop browsing."""
    studio = bpy.data.scenes.new("Asset preview studio")
    studio.render.engine = "CYCLES"
    studio.cycles.samples = 6
    studio.render.resolution_x = studio.render.resolution_y = 144
    studio.render.resolution_percentage = 100
    studio.render.film_transparent = True
    studio.render.image_settings.color_mode = "RGBA"
    studio.view_settings.view_transform = "Khronos PBR Neutral"
    world = bpy.data.worlds.new("Asset preview daylight")
    if world.node_tree is None:
        world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (.76,.86,1,1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = .8
    studio.world = world
    sun = bpy.data.lights.new("Preview key","SUN")
    sun.energy,sun.angle = 3.0,math.radians(15)
    lamp = bpy.data.objects.new("Preview key",sun)
    lamp.rotation_euler = V((.46,.7,-1)).to_track_quat("-Z","Y").to_euler()
    data = bpy.data.cameras.new("Preview camera")
    data.type = "ORTHO"
    cam = bpy.data.objects.new("Preview camera",data)
    subject = bpy.data.objects.new("Preview subject",assets[0].data)
    for o in (lamp,cam,subject):
        studio.collection.objects.link(o)
    studio.camera = cam
    view = V((.87,-1.7,.97)).normalized()
    rotation = (-view).to_track_quat("-Z","Y")
    cam.rotation_euler = rotation.to_euler()
    with tempfile.TemporaryDirectory(prefix="civrum-icons-") as temp:
        for obj in assets:
            subject.data = obj.data
            points = [rotation.inverted() @ v.co for v in obj.data.vertices]
            low = V([min(v[i] for v in points) for i in range(3)])
            high = V([max(v[i] for v in points) for i in range(3)])
            data.ortho_scale = max((high-low).x,(high-low).y)*1.18
            cam.location = rotation @ ((high+low)*.5)+view*25
            studio.render.filepath = str(Path(temp)/(obj.name+".png"))
            bpy.ops.render.render(scene=studio.name,write_still=True)
            with bpy.context.temp_override(id=obj):
                bpy.ops.ed.lib_id_load_custom_preview(filepath=studio.render.filepath)
    for o in (lamp,cam,subject):
        bpy.data.objects.remove(o,do_unlink=True)
    bpy.data.scenes.remove(studio)
    bpy.data.cameras.remove(data)
    bpy.data.lights.remove(sun)
    bpy.data.worlds.remove(world)


def write_library(world,library,catalog_names):
    # Build a separate blend without importing the city, its roadwork or its cameras.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "CIVRUM • Environment Asset Library"
    scene.unit_settings.system = "METRIC"
    with bpy.data.libraries.load(str(world)) as (available,selected):
        selected.meshes = ["CIVRUM_MODULE_"+key for key in catalog_names]
        assert set(selected.meshes) <= set(available.meshes)
    rows = Counter()
    for layer in (PUBLIC,VEG,WORK):
        scene.collection.children.link(bpy.data.collections.new(layer))
    for mesh in selected.meshes:
        layer,key = mesh["layer"],mesh["module"]
        i = rows[layer]
        rows[layer] += 1
        offset = {PUBLIC:0,VEG:3,WORK:5}[layer]
        obj = base.put(layer,key,mesh,((i%6)*13,(offset+i//6)*11,0))
        obj.asset_mark()
        obj.asset_data.author = "NEXCIV"
        obj.asset_data.description = f"CIVRUM {key.replace('_',' ').lower()} • metre-scale environment module"
        obj.asset_data.tags.new(layer.lower())
    asset_previews(list(scene.objects))
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=="VIEW_3D":
                space = area.spaces.active
                space.shading.color_type = "MATERIAL"
                space.region_3d.view_location = (31,26,1)
                space.region_3d.view_distance = 94
    bpy.ops.wm.save_as_mainfile(filepath=str(library),compress=True)


def check(world,library):
    base.check_saved_scene(world)
    terrain = terrain_bvh()
    totals, counts, meshes = Counter(),Counter(),{}
    for layer in (PUBLIC,VEG,WORK):
        for o in bpy.data.collections[layer].objects:
            key = o.data["module"]
            assert o.data["layer"]==layer and (o.scale-V((1,1,1))).length < .0001
            if key not in meshes:
                assert abs(min(v.co.z for v in o.data.vertices)) < .001, f"Floating origin on {key}"
            assert meshes.setdefault(key,o.data)==o.data, f"Unlinked duplicate of {key}"
            totals[layer] += 1
            counts[key] += 1
            if o.parent:
                assert o.parent.data["module"].startswith(("PROP_PLANTER","GREEN_VERGE","GREEN_LAWN"))
                assert abs(o.location.z-o.parent.dimensions.z) < .008, o.name
            else:
                # A solid footing bridges narrow paving joints. The centre can
                # sit over an 8 mm joint while the surrounding pad is supported.
                x,y = o.location.xy
                support = ground_z(terrain,x,y)
                if o.location.z-support > .006:
                    support = max(support, *(ground_z(terrain,x+dx,y+dy) for dx,dy in
                                            ((.02,0),(-.02,0),(0,.02),(0,-.02))))
                delta = o.location.z-support
                pitch = {"CONSTRUCTION_SCAFFOLD_01":2.4,"CONSTRUCTION_PRECAST_01":.75}.get(key)
                if pitch and delta>.01:
                    below = [b for b in bpy.data.collections[WORK].objects if b.data==o.data and
                             (b.location-(o.location-V((0,0,pitch)))).length<.002]
                    assert below, f"Unsupported {o.name}"
                else:
                    assert abs(delta)<.006,(o.name,delta)
    expected = set(street_furniture()) | set(landscape_assets()) | set(works_assets())
    assert set(counts)==expected and len(expected)==29
    # Test the physical footprint at street level, allowing overhead lamp arms.
    asphalt = []
    for road in bpy.data.collections["ROADS"].objects:
        if "edge_xy" not in road and "node_xy" not in road:
            continue
        m = road.data
        m.calc_loop_triangles()
        idx = 0 if "edge_xy" in road else len(m.polygons)-1
        asphalt.extend(Footprint([(road.matrix_world@m.vertices[i].co).xy for i in t.vertices])
                       for t in m.loop_triangles if t.polygon_index==idx)
    buildings = [footprint(o) for o in bpy.data.collections["PLACEHOLDER_BUILDINGS"].all_objects if o.type=="MESH"]
    furniture = []
    gate = Footprint(rectangle(99,-115.75,7.7,8.15))
    for layer in (PUBLIC,VEG,WORK):
        for o in bpy.data.collections[layer].objects:
            if o.parent:
                continue
            hull = footprint(o)
            assert not any(hull.overlaps(b) for b in buildings), f"{o.name} overlaps a building"
            pts = [(o.matrix_world@v.co).xy for v in o.data.vertices if v.co.z<.24]
            if len(pts)>2:
                boundary = Footprint(pts)
                assert not any(boundary.overlaps(road) for road in asphalt), f"{o.name} enters traffic"
                assert not boundary.overlaps(gate), f"Works gate obstructed by {o.name}"
                if layer != WORK:
                    assert not any(boundary.overlaps(k) for k in furniture), f"Street furniture overlap at {o.name}"
                    furniture.append(boundary)
    print(f"PASS stage 2: {len(meshes)} modules, placements {dict(totals)}, all supports and road clearances checked")
    bpy.ops.wm.open_mainfile(filepath=str(library))
    objects = list(bpy.context.scene.objects)
    assert {o.data["module"] for o in objects}==expected and len(objects)==len(expected)
    assert all(o.asset_data and o.asset_data.author=="NEXCIV" and not o.library and
               o.preview and min(o.preview.image_size)>0 for o in objects)
    assert all(not m.library for m in bpy.data.meshes) and not bpy.data.libraries
    print(f"PASS library: {len(objects)} independent assets with local meshes and packed thumbnails")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base",type=Path,default=base.ROOT/"blender"/"CIVRUM_World_Blockout.blend")
    parser.add_argument("--output-root",type=Path,default=base.ROOT)
    parser.add_argument("--render",action="store_true")
    parser.add_argument("--check",action="store_true",help="Read-only inspection of both saved blends")
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    root = args.output_root.resolve()
    world,library = (root/"blender"/name for name in (WORLD_FILE,LIBRARY_FILE))
    if args.check:
        check(world,library)
        return
    frames = ["World_Overview","Central_Plaza","Street_Detail","Construction"]
    renders = {name:root/"renders"/"environment"/f"CIVRUM_{name}.png" for name in frames}
    for path in (world,library,*(renders.values() if args.render else [])):
        if path.exists():
            raise FileExistsError(f"Choose a fresh --output-root to preserve {path}")
        path.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(args.base.resolve()))
    if any(bpy.data.collections[layer].objects for layer in (PUBLIC,VEG,WORK)):
        raise ValueError("Expected a phase-one blockout with empty dressing collections")
    garden_materials()
    surface_details()
    bpy.context.view_layer.update()
    catalog = create_catalog()
    d = Dressing(catalog)
    plaza_and_districts(d)
    road_lights(d)
    worksite(d)
    pocket_parks(d)
    scene = bpy.context.scene
    scene.name,scene["production_stage"] = "CIVRUM • City Environment 02","02 • Environment dressing"
    scene.render.filepath = "//../renders/environment/CIVRUM_World_Overview.png"
    bpy.ops.wm.save_as_mainfile(filepath=str(world),compress=True)
    if args.render:
        for name,path in renders.items():
            if name=="Construction":
                data = bpy.data.cameras.new("Works inspection")
                cam = base.put("CAMERAS","REVIEW_WORKS",data,(115.4,-124.5,10.2))
                cam.rotation_euler = (V((94,-100,3))-cam.location).to_track_quat("-Z","Y").to_euler()
                data.lens = 34
            else:
                cam = bpy.data.objects["CIVRUM_CAM_"+name.upper()]
            scene.camera,scene.render.filepath = cam,str(path)
            bpy.ops.render.render(write_still=True)
    write_library(world,library,list(catalog))


if __name__=="__main__":
    main()
