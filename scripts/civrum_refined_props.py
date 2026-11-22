"""Refined civic furniture for the standalone CIVRUM environment.

All geometry is original, metre-scaled and uses the existing shared palette.
The module IDs, ground origins, planter mounting heights and banner lettering
positions remain compatible with ``detail_civrum_world``. Mesh finishing and
linked-instance replacement belong to the refinement scene builder.
"""

import math

from build_civrum_world import (
    BLACK, CONCRETE, GRAPHITE, METAL, WHITE, YELLOW, Geometry, circle, rectangle,
)
from detail_civrum_world import LEAF, SOIL, emblem, panel, rod


def collar(g, outer, inner, low, high, material):
    """Open ring with shared vertices: the opening stays open after beveling."""
    first, n = len(g.verts), len(outer)
    for z, points in ((low, outer), (high, outer), (low, inner), (high, inner)):
        g.verts.extend((x, y, z) for x, y in points)
    for i in range(n):
        j = (i + 1) % n
        g.face((first+i, first+j, first+n+j, first+n+i), material)
        g.face((first+2*n+j, first+2*n+i, first+3*n+i, first+3*n+j), material)
        g.face((first+n+i, first+n+j, first+3*n+j, first+3*n+i), material)
        g.face((first+j, first+i, first+2*n+i, first+2*n+j), material)


def fasteners(g, positions, radius=.026):
    for x, y, z in positions:
        g.slab(circle(radius, 6, x, y), z, z+.012, METAL)


def streetlight(style):
    g = Geometry()
    g.box(0, 0, 0, .54, .54, .085, CONCRETE, .055)
    g.box(0, 0, .085, .37, .37, .055, BLACK, .035)
    fasteners(g, [(x, y, .14) for x in (-.145, .145) for y in (-.145, .145)], .025)
    if style == 1:
        g.box(0, 0, .14, .29, .28, .80, GRAPHITE, .036)
        g.loft(rectangle(0, 0, .23, .23, .023), rectangle(.1, 0, .13, .18, .023),
               .94, 5.45, METAL)
        rod(g, (.10, 0, 5.22), (1.18, 0, 5.82), .095, GRAPHITE, .075, 8)
        # A cast housing, thin heat-sink cap and separately recessed optical tray.
        g.box(1.27, 0, 5.73, 1.18, .38, .15, BLACK, .07)
        g.box(1.27, 0, 5.88, 1.02, .31, .01, METAL, .05)
        g.box(1.40, 0, 5.715, .82, .29, .025, GRAPHITE, .032)
        for x in (1.13, 1.40, 1.67):
            g.box(x, 0, 5.69, .20, .235, .025, WHITE, .024)
        g.box(0, 0, .81, .295, .285, .048, YELLOW, .025)
        g.box(0, -.144, .29, .14, .012, .30, BLACK, .012)
        g.box(.045, -.152, .43, .026, .006, .042, METAL, .006)
    elif style == 2:
        g.box(0, 0, .14, .28, .26, 4.82, GRAPHITE, .035)
        g.box(.32, 0, 4.68, 1.06, .17, .11, METAL, .022)
        # Retain the light banner ground behind the existing dark district code.
        g.box(.53, 0, 2.54, .73, .075, 2.12, YELLOW, .018)
        g.box(.88, -.041, 2.56, .03, .012, 2.08, GRAPHITE, .006)
        emblem(g, .53, -.045, 4.08, .232, GRAPHITE)
        for i in range(3):
            panel(g, rectangle(.53, 2.8+i*.14, .45-i*.09, .032), -.045, GRAPHITE)
        for z in (2.61, 4.57):
            rod(g, (.10, 0, z), (.27, 0, z), .025, METAL, sides=8)
        g.box(0, 0, 4.96, 1.25, .38, .14, GRAPHITE, .055)
        g.box(0, 0, 5.10, 1.15, .33, .04, METAL, .045)
        for x in (-.38, .38):
            g.box(x, 0, 4.92, .38, .26, .04, WHITE, .018)
        g.box(0, -.132, .30, .16, .008, .32, BLACK, .018)
    else:
        g.box(0, 0, .14, .32, .30, 2.74, GRAPHITE, .055)
        g.box(0, 0, 2.87, .37, .34, .035, BLACK, .045)
        g.box(0, 0, 2.905, .31, .285, .445, WHITE, .035)
        for x in (-.16, .16):
            for y in (-.145, .145):
                g.box(x, y, 2.88, .035, .035, .49, METAL, .009)
        g.box(0, 0, 3.35, .40, .37, .045, METAL, .038)
        g.box(0, 0, 3.395, .46, .43, .075, BLACK, .05)
        g.box(0, -.155, 2.45, .15, .02, .26, YELLOW, .016)
        g.box(0, -.153, .29, .15, .012, .25, BLACK, .016)
    return g


def bench(style):
    g = Geometry()
    length = 2.45 if style == 1 else 3.12
    for x in (-length*.34, length*.34):
        # Slim trapezoidal cast supports and genuine under-seat clearance.
        g.box(x, 0, 0, .33, .63, .055, METAL, .035)
        g.loft(rectangle(x, 0, .16, .51, .025), rectangle(x, 0, .12, .40, .02),
               .055, .38, GRAPHITE)
        g.box(x, 0, .36, .18, .62, .05, BLACK, .018)
        fasteners(g, [(x, -.24, .055), (x, .24, .055)], .024)
    if style == 1:
        for y in (-.235, -.08, .075, .23):
            g.box(0, y, .405, length, .136, .080, METAL, .024)
        for x in (-.82, .82):
            rod(g, (x, .21, .40), (x, .36, .90), .038, BLACK, sides=8)
        for i in range(3):
            g.box(0, .30+i*.023, .60+i*.113, length, .076, .092, METAL, .016)
        # Curved-profile arm rails drawn with tapered octagonal segments.
        for x in (-1.04, 1.04):
            rod(g, (x, -.16, .46), (x, -.16, .65), .032, GRAPHITE, sides=8)
            rod(g, (x, -.16, .65), (x, .25, .69), .032, GRAPHITE, sides=8)
        g.box(0, -.307, .418, .33, .008, .035, YELLOW, .007)
    else:
        g.box(0, 0, .365, length, .8, .145, CONCRETE, .145, WHITE)
        # Inlaid modular seat slats soften the otherwise monolithic bench.
        for i in range(10):
            g.box(-1.35+i*.30, -.04, .51, .27, .59, .028, METAL, .015)
        g.box(.29, .255, .538, 1.98, .15, .245, GRAPHITE, .045)
        g.box(.29, .248, .783, 1.92, .165, .017, METAL, .028)
        g.box(-1.28, -.394, .41, .20, .008, .045, YELLOW, .008)
    return g


def kiosk(style):
    g = Geometry()
    w, h = (1.15, 2.25) if style == 1 else (.80, 1.52)
    g.box(0, 0, 0, w+.25, .79, .07, CONCRETE, .10)
    g.box(0, 0, .07, w*.80, .46, .05, BLACK, .06)
    g.loft(rectangle(0, 0, w*.75, .4, .055), rectangle(0, 0, w, .51, .06),
           .12, h, GRAPHITE)
    g.box(0, 0, h, w+.055, .54, .038, YELLOW, .045)
    g.box(0, 0, h+.038, w+.045, .53, .082, BLACK, .044)
    # A recessed bezel with an inset warm-white instruction strip below it.
    screen_base, screen_height = (.82, 1.12) if style == 1 else (.58, .73)
    g.box(0, -.258, screen_base-.035, w*.89, .048, screen_height+.07, METAL, .028)
    g.box(0, -.282, screen_base, w*.83, .018, screen_height, BLACK, .024)
    front = -.293
    if style == 1:
        # A schematic district map is geometry, so it survives standalone GLB.
        for x, z, width, height in ((-.26, 1.66, .25, .28), (.20, 1.72, .35, .20),
                                   (.23, 1.36, .31, .22), (-.25, 1.29, .25, .18)):
            panel(g, rectangle(x, z, width, height, .018), front, LEAF)
        panel(g, rectangle(-.03, 1.52, .030, .64), front-.001, WHITE)
        panel(g, rectangle(.03, 1.51, .65, .030), front-.002, WHITE)
        panel(g, rectangle(.03, 1.42, .030, .25), front-.003, YELLOW)
        emblem(g, .03, front-.004, 1.56, .075, YELLOW)
        for i in range(3):
            panel(g, rectangle(-.08, 1.00+i*.065, .47-i*.085, .020), front, WHITE)
        g.box(0, -.267, .667, .76, .024, .075, WHITE, .012)
        g.box(.27, -.283, .682, .13, .012, .043, YELLOW, .008)
    else:
        emblem(g, 0, front-.002, 1.12, .16, YELLOW)
        for i in range(3):
            panel(g, rectangle(-.04, .73+i*.065, .44-i*.075, .022), front, WHITE)
        g.box(0, -.257, .43, .49, .025, .065, WHITE, .01)
    # Rear access cover and individual vents distinguish the service side.
    g.box(0, .243, .25, w*.54, .018, .40, BLACK, .023)
    for i in range(4):
        g.box(0, .257, .31+i*.065, w*.36, .008, .014, METAL, .004)
    fasteners(g, [(x, y, .07) for x in (-w*.39, w*.39) for y in (-.30, .30)], .020)
    return g


def planter(style):
    g = Geometry()
    if style == 1:
        # Preserve the original decagon's axis bounds despite the rounder rim.
        def rim(radius):
            return [(x, y*math.sin(math.pi*.4)) for x, y in circle(radius, 24)]
        top, body, foot = rim(1.75), rim(1.68), rim(1.46)
        inside, h = rim(1.54), .52
    elif style == 2:
        top, body = rectangle(0, 0, 4.6, 1.65, .28), rectangle(0, 0, 4.47, 1.52, .24)
        foot, inside, h = rectangle(0, 0, 4.3, 1.42, .20), rectangle(0, 0, 4.28, 1.33, .20), .52
    else:
        top, body = rectangle(0, 0, 2.8, 2.8, .53), rectangle(0, 0, 2.70, 2.70, .47)
        foot, inside, h = rectangle(0, 0, 2.55, 2.55, .42), rectangle(0, 0, 2.43, 2.43, .39), .68
    g.slab(foot, 0, .065, BLACK)
    g.loft(foot, body, .065, h-.10, GRAPHITE if style == 3 else CONCRETE)
    collar(g, top, inside, h-.10, h-.078, METAL)
    collar(g, top, inside, h-.078, h, WHITE)
    # Parent plants continue to mount at exactly .523 / .683 metres.
    g.surface(inside, h+.003, SOIL)
    if style == 2:
        for x in (-1.40, 1.40):
            g.box(x, -.760, .14, .014, .012, .21, METAL, .003)
        g.box(-1.84, -.766, .24, .22, .012, .038, YELLOW, .006)
    elif style == 3:
        g.box(0, -1.353, .23, .40, .012, .048, YELLOW, .007)
    return g


def bin_asset():
    g = Geometry()
    g.slab(circle(.29, 16), 0, .07, BLACK)
    g.loft(circle(.27, 16), circle(.31, 16), .07, .83, GRAPHITE)
    for i in range(12):
        angle = i*math.tau/12
        x, y = math.cos(angle), math.sin(angle)
        rod(g, (.273*x, .273*y, .17), (.305*x, .305*y, .77), .012, METAL, sides=4)
    collar(g, circle(.325, 16), circle(.205, 16), .83, .88, YELLOW)
    collar(g, circle(.33, 16), circle(.19, 16), .88, .98, METAL)
    g.surface(circle(.19, 16), .89, BLACK)
    return g


def wayfinder():
    g = Geometry()
    g.box(0, 0, 0, .42, .42, .09, CONCRETE, .05)
    g.box(0, 0, .09, .24, .24, .03, METAL, .022)
    g.box(0, 0, .12, .16, .16, 2.77, GRAPHITE, .02)
    g.box(.38, 0, 2.32, 1.28, .14, .49, BLACK, .05)
    g.box(.38, -.074, 2.345, 1.20, .012, .028, YELLOW, .006)
    emblem(g, .06, -.076, 2.565, .13)
    panel(g, [(.37, 2.51), (.68, 2.51), (.68, 2.42), (.90, 2.565),
              (.68, 2.71), (.68, 2.62), (.37, 2.62)], -.076, WHITE)
    for z in (2.40, 2.71):
        g.box(0, .095, z, .25, .065, .055, METAL, .009)
    return g


def bollard():
    g = Geometry()
    g.slab(circle(.18, 12), 0, .055, METAL)
    g.slab(circle(.13, 12), .055, .10, BLACK)
    g.slab(circle(.115, 12), .10, .82, GRAPHITE)
    for z in (.645, .705):
        g.slab(circle(.119, 12), z, z+.024, YELLOW)
    g.slab(circle(.12, 12), .82, .852, BLACK)
    g.loft(circle(.12, 12), circle(.098, 12), .852, .87, METAL)
    return g


def railing():
    g = Geometry()
    for x in (-1.42, 1.42):
        g.box(x, 0, 0, .14, .21, .05, METAL, .024)
        g.box(x, 0, .05, .105, .135, .94, GRAPHITE, .018)
        g.box(x, 0, .99, .14, .17, .03, METAL, .020)
    for z in (.38, .87):
        g.box(0, 0, z, 2.84, .085, .065, METAL, .018)
    for x in (-.95, -.48, 0, .48, .95):
        g.box(x, 0, .445, .025, .035, .425, GRAPHITE, .005)
    return g


def beacon():
    g = Geometry()
    g.loft(circle(1.97, 48), circle(1.88, 48), 0, .18, CONCRETE, WHITE)
    g.slab(circle(1.54, 32), .18, .34, GRAPHITE)
    g.slab(circle(1.54, 32), .34, .38, BLACK)
    g.slab(circle(1.37, 32), .38, .405, YELLOW)
    g.slab(circle(1.34, 32), .405, .42, METAL)
    g.loft(circle(1.27, 16), circle(.86, 16), .42, .77, METAL, BLACK)
    g.loft(circle(.69, 8, phase=math.pi/8), circle(.57, 8, phase=math.pi/8), .77, .91, BLACK)
    # A seated precision cube is the civic emblem; it is not a floating object.
    first = len(g.verts)
    side = 1.23
    g.box(0, 0, -side/2, side, side, side, YELLOW)
    turn_x, turn_z = math.atan(1/math.sqrt(2)), math.pi/4
    top_offset = side/2*(math.cos(turn_x)+math.sin(turn_x))
    for i in range(first, len(g.verts)):
        x, y, z = g.verts[i]
        y, z = y*math.cos(turn_x)-z*math.sin(turn_x), y*math.sin(turn_x)+z*math.cos(turn_x)
        x, y = x*math.cos(turn_z)-y*math.sin(turn_z), x*math.sin(turn_z)+y*math.cos(turn_z)
        g.verts[i] = (x, y, z+2.57-top_offset)
    return g


def build_props():
    """Return the same fifteen public-facility module IDs as stage two."""
    assets = {}
    for prefix, count, builder in (("STREETLIGHT", 3, streetlight), ("BENCH", 2, bench),
                                    ("INFO_KIOSK", 2, kiosk), ("PLANTER", 3, planter)):
        for style in range(1, count+1):
            assets[f"PROP_{prefix}_{style:02}"] = builder(style)
    for suffix, builder in (("BIN", bin_asset), ("WAYFINDER", wayfinder),
                            ("BOLLARD", bollard), ("RAIL", railing),
                            ("PLAZA_BEACON", beacon)):
        assets[f"PROP_{suffix}_01"] = builder()
    return assets
