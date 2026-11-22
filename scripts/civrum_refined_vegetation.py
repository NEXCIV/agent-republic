"""Original, softly sculpted planting modules for the CIVRUM refinement pass.

All vertices are baked in metres.  No textures, modifiers, external assets or
random global state are needed.  Foliage faces may use smooth shading; bark and
flower petals should retain their small geometric planes.
"""

import math
import random

from mathutils import Vector

from build_civrum_world import Geometry, WHITE, YELLOW
from detail_civrum_world import BARK, DEEPLEAF, LEAF, SUNLEAF, rod, tree as original_tree


def foliage_lobe(g, center, radii, seed, color=LEAF, sides=12, rings=7):
    """A watertight organic crown lobe with shared vertices and soft scalloping."""
    rng = random.Random(seed)
    cx, cy, cz = center
    rx, ry, rz = radii
    phases = [rng.uniform(0, math.tau) for _ in range(3)]
    first = len(g.verts)
    g.verts.append((cx, cy, cz-rz))
    for row in range(1, rings):
        lat = -math.pi/2 + row*math.pi/rings
        spread = math.cos(lat)
        for i in range(sides):
            a = (i + .13*math.sin(row*.7))*math.tau/sides
            # Correlated waves form small lobes instead of random noisy facets.
            ripple = (1 + .10*math.sin(3*a+phases[0])*spread
                      + .055*math.sin(5*a+phases[1]+lat)*spread
                      + .035*math.cos(3*lat+phases[2]))
            g.verts.append((cx + rx*spread*math.cos(a)*ripple,
                            cy + ry*spread*math.sin(a)*ripple,
                            cz + rz*math.sin(lat) + .035*rz*math.sin(2*a+phases[0])*spread))
    top = len(g.verts)
    g.verts.append((cx+.04*rx, cy-.025*ry, cz+rz))
    for i in range(sides):
        j = (i+1) % sides
        g.face((first, first+1+j, first+1+i), color)
    for row in range(rings-2):
        start = first+1+row*sides
        for i in range(sides):
            j = (i+1) % sides
            a, b, c, d = start+i, start+j, start+sides+j, start+sides+i
            if (row+i) % 2:
                g.face((a, b, d), color)
                g.face((b, c, d), color)
            else:
                g.face((a, b, c), color)
                g.face((a, c, d), color)
    start = first+1+(rings-2)*sides
    for i in range(sides):
        g.face((start+i, start+(i+1) % sides, top), color)


def canopy(g, lobes, seed):
    """Sculpted branch clusters: flattened, asymmetrical, triangulated foliage."""
    upper = max(range(len(lobes)), key=lambda i: lobes[i][2]+lobes[i][5])
    for i, (x, y, z, rx, ry, rz, _) in enumerate(lobes):
        # Alternating elongation gives a layered branch structure.  All main
        # clusters share one pigment; just the highest crown gets a light tip.
        radii = (rx*(1.03 if i % 2 else .94),
                 ry*(.92 if i % 2 else 1.04),
                 rz*(.80 if i % 3 else .87))
        foliage_lobe(g, (x, y, z), radii, seed+i,
                     SUNLEAF if i == upper else LEAF, sides=12, rings=7)


def branch(g, centers, radii, sides=9):
    """Bent, tapered limb with a flat planting face and continuous bark rings."""
    first = len(g.verts)
    for level, (center, radius) in enumerate(zip(centers, radii)):
        p = Vector(center)
        if level == 0 and abs(p.z) < 1e-6:
            u, v = Vector((-1, 0, 0)), Vector((0, -1, 0))
        else:
            before = Vector(centers[max(0, level-1)])
            after = Vector(centers[min(len(centers)-1, level+1)])
            axis = (after-before).normalized()
            u = axis.cross(Vector((0, 1, 0))).normalized()
            v = axis.cross(u)
        for i in range(sides):
            a = i*math.tau/sides
            # Mild ridges keep a trunk readable in the otherwise matte palette.
            r = radius*(1+.055*math.sin(i*2.7+level*.35))
            g.verts.append(tuple(p + r*(u*math.cos(a)+v*math.sin(a))))
    g.face(tuple(first+i for i in reversed(range(sides))), BARK)
    for row in range(len(centers)-1):
        start = first+row*sides
        for i in range(sides):
            j = (i+1) % sides
            g.face((start+i, start+j, start+sides+j, start+sides+i), BARK)
    g.face(tuple(first+(len(centers)-1)*sides+i for i in range(sides)), BARK)


def fit_tree_envelope(g, kind):
    """Preserve the approved canopy footprint and height of the planted module."""
    reference = original_tree(kind)
    low = [min(v[i] for v in g.verts) for i in range(3)]
    high = [max(v[i] for v in g.verts) for i in range(3)]
    old_low = [min(v[i] for v in reference.verts) for i in range(3)]
    old_high = [max(v[i] for v in reference.verts) for i in range(3)]
    # Keep the trunk at its planting origin: fit XY by scale about zero.
    xy = [min(old_high[i]/high[i], old_low[i]/low[i])*.975 for i in range(2)]
    z_scale = old_high[2]/high[2]
    g.verts = [(x*xy[0], y*xy[1], max(0, z*z_scale)) for x, y, z in g.verts]
    return g


def tree(kind):
    g = Geometry()
    if kind == 1:
        branch(g, [(0, 0, 0), (.045, .01, .3), (.06, -.045, 1.55),
                   (-.02, .035, 2.7), (.17, .11, 3.65)], [.25, .20, .155, .11, .055])
        tips = [(-1.28, .32, 3.65), (1.18, .41, 4.08), (.08, -.94, 4.24)]
        lobes = [(-1.28, .24, 3.82, 1.10, .98, .95, DEEPLEAF),
                 (.95, .46, 4.09, 1.18, 1.08, 1.17, LEAF),
                 (.04, -.73, 4.31, 1.40, 1.17, 1.12, LEAF),
                 (-.91, -.48, 4.75, 1.04, .94, 1.02, LEAF),
                 (.45, .36, 5.27, 1.34, 1.23, 1.16, LEAF),
                 (-.55, .67, 4.92, .94, 1.01, 1.01, LEAF),
                 (1.40, -.39, 4.77, .92, .88, .95, LEAF),
                 (.01, -.94, 5.35, 1.08, .86, 1.04, SUNLEAF),
                 (-1.43, .03, 4.46, .74, .81, .75, LEAF),
                 (.89, .76, 5.09, .95, .84, .85, SUNLEAF)]
    elif kind == 2:
        branch(g, [(0, 0, 0), (.025, 0, .3), (-.035, .025, 1.55),
                   (.065, .01, 3.0), (.12, -.02, 5.25)], [.19, .16, .12, .085, .032])
        tips = [(-.61, .1, 3.4), (.57, .14, 4.06), (.02, -.53, 4.62)]
        lobes = [(-.36, .06, 3.00, .82, .79, 1.13, DEEPLEAF),
                 (.40, .08, 3.37, .77, .81, 1.19, LEAF),
                 (-.37, -.24, 4.12, .80, .84, 1.22, LEAF),
                 (.36, .36, 4.51, .88, .80, 1.22, LEAF),
                 (.09, -.41, 4.98, .78, .81, 1.15, LEAF),
                 (-.29, .13, 5.43, .83, .79, 1.11, LEAF),
                 (.23, .10, 6.03, .66, .67, .85, SUNLEAF),
                 (.58, -.19, 3.78, .59, .62, .82, LEAF)]
    else:
        branch(g, [(0, 0, 0), (-.04, 0, .28), (-.13, .02, 1.28),
                   (-.05, .02, 2.09), (.27, .14, 3.46)], [.28, .22, .19, .14, .05])
        tips = [(-1.59, .28, 3.30), (1.43, .38, 3.48), (.03, -.87, 3.88)]
        lobes = [(-1.66, .26, 3.53, 1.10, .97, .80, DEEPLEAF),
                 (1.48, .38, 3.80, 1.22, 1.06, .88, LEAF),
                 (.05, -.79, 4.00, 1.38, 1.12, 1.02, LEAF),
                 (-.98, -.43, 4.30, 1.15, .99, .94, LEAF),
                 (.30, .37, 4.66, 1.44, 1.16, .99, LEAF),
                 (-.72, .76, 4.35, 1.13, .98, .90, LEAF),
                 (1.53, -.48, 4.22, .98, .94, .79, LEAF),
                 (-.03, -.86, 4.82, 1.08, .89, .78, SUNLEAF),
                 (.98, .71, 4.64, 1.01, .81, .84, SUNLEAF)]
    for i, tip in enumerate(tips):
        x, y, z = tip
        branch(g, [(0, 0, 1.45+i*.25), (x*.45, y*.42, z*.75), tip],
               [.12 if kind != 2 else .085, .075, .035], 8)
        branch(g, [(x*.45, y*.42, z*.75), (x*.79-y*.2, y*.8+x*.15, z+.30)],
               [.065, .025], 7)
    canopy(g, lobes, 117*kind)
    return fit_tree_envelope(g, kind)


def shrub(kind):
    g = Geometry()
    lobes = [(-.43, .03, .33, .49, .46, .34),
             (.42, .10, .43, .54, .47, .44),
             (.02, -.25, .39, .52, .42, .37),
             (-.07, .29, .49, .46, .42, .43),
             (.29, -.28, .58, .39, .33, .32)]
    for i, (x, y, z, rx, ry, rz) in enumerate(lobes):
        s = .82 if kind == 2 else 1
        h = 1.24 if kind == 2 else 1
        foliage_lobe(g, (x*s, y*s, z*h), (rx*s, ry*s, rz*h), 237*kind+i,
                     LEAF if i != 0 else DEEPLEAF, sides=12, rings=6)
    bottom = min(v[2] for v in g.verts)
    g.verts = [(x, y, z-bottom) for x, y, z in g.verts]
    return g


def leaf(g, origin, angle, length, width, lift, color):
    """A tiny closed leaf blade; the centre ridge catches natural skylight."""
    x, y, z = origin
    dx, dy = math.cos(angle), math.sin(angle)
    first = len(g.verts)
    g.verts.extend([(x, y, z),
                    (x+dx*length*.52-dy*width, y+dy*length*.52+dx*width, z+lift*.55),
                    (x+dx*length, y+dy*length, z+lift),
                    (x+dx*length*.52+dy*width, y+dy*length*.52-dx*width, z+lift*.55),
                    (x+dx*length*.54, y+dy*length*.54, z+lift*.55+.025)])
    for i in range(4):
        g.face((first+4, first+(i+1) % 4, first+i), color)
    g.face((first, first+1, first+2, first+3), color)


def flowers():
    g = Geometry()
    rng = random.Random(781)
    for i, (x, y) in enumerate(((-.35, .03), (.29, .06), (.01, -.18))):
        for k in range(8):
            a = k*math.tau/8+i*.39
            leaf(g, (x, y, .01), a, .26+rng.uniform(0, .08), .065, .08+rng.uniform(0, .1),
                 LEAF if k % 3 else DEEPLEAF)
        for k in range(4):
            a = k*math.tau/4+i*.7
            bx, by = x+.12*math.cos(a), y+.12*math.sin(a)
            z = .20+rng.uniform(-.025, .055)
            rod(g, (x, y, .015), (bx, by, z-.012), .011, DEEPLEAF, .007, sides=5)
            # Five cupped petals. Their folded side planes keep the flower
            # legible at close range without textures or transparent cards.
            for p in range(5):
                pa = a+p*math.tau/5
                dx, dy = math.cos(pa), math.sin(pa)
                first = len(g.verts)
                g.verts.extend([(bx, by, z-.012),
                                (bx+dx*.043-dy*.032, by+dy*.043+dx*.032, z+.009),
                                (bx+dx*.087-dy*.021, by+dy*.087+dx*.021, z+.025),
                                (bx+dx*.095, by+dy*.095, z+.022),
                                (bx+dx*.087+dy*.021, by+dy*.087-dx*.021, z+.025),
                                (bx+dx*.043+dy*.032, by+dy*.043-dx*.032, z+.009)])
                g.face(tuple(first+j for j in reversed(range(6))), WHITE if k != 1 else YELLOW)
            # Tiny warm flower centre, seen from above at plaza cameras.
            foliage_lobe(g, (bx, by, z+.002), (.022, .022, .015), i*17+k, YELLOW,
                         sides=6, rings=3)
    bottom = min(v[2] for v in g.verts)
    g.verts = [(x, y, z-bottom) for x, y, z in g.verts]
    return g


def build_vegetation():
    """Six replacements; turf and kerb modules retain their approved geometry."""
    result = {f"TREE_{n:02}": tree(n) for n in (1, 2, 3)}
    result.update({f"SHRUB_{n:02}": shrub(n) for n in (1, 2)})
    result["GREEN_FLOWERS_01"] = flowers()
    return result
