r"""Build District 01's articulated citizen with colour painted into the geometry.

Run Blender in background mode with --factory-startup --python-exit-code 1
--python tools/blender/build_agent_citizen.py. One mesh per animated part
lets the web renderer instance a whole crowd in a single pass per part.
"""
import json
import math
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps/web/public/world/district-01/v1/agent-citizen.glb"
BLEND = ROOT / "tools/blends/agent-citizen.blend"
SKIN, INK = "FFC093", "30252A"
IVORY, NAVY = "FCF9F4", "282938"


def linear(hex_color):
    rgb = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb) + (1,)


def pigment(name, base="FFFFFF"):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.66
    # glTF preserves the multiply as baseColorFactor * COLOR_0.
    ink = mat.node_tree.nodes.new("ShaderNodeVertexColor")
    ink.layer_name = "Paint"
    mix = mat.node_tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1
    mix.inputs[7].default_value = linear(base)
    mat.node_tree.links.new(ink.outputs["Color"], mix.inputs[6])
    mat.node_tree.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    return mat


class Part:
    def __init__(self):
        self.verts, self.faces, self.colors = [], [], []
        self.smooth = []

    def face(self, points, color, smooth=False):
        start = len(self.verts)
        self.verts.extend(points)
        self.faces.append(tuple(range(start, len(self.verts))))
        self.colors.append(color)
        self.smooth.append(smooth)

    def rings(self, rows, color, segments=8, caps=(True, True), smooth=False):
        """Bottom-up elliptical sections; an optional palette paints successive bands."""
        bands = [color] * (len(rows)-1) if isinstance(color, str) else color
        rings = []
        for x, y, z, rx, ry in rows:
            rings.append([(x + rx * math.sin(i*math.tau/segments),
                           y - ry * math.cos(i*math.tau/segments), z) for i in range(segments)])
        if caps[0]:
            self.face(rings[0][::-1], bands[0])
        for lower, upper, band in zip(rings[:-1], rings[1:], bands, strict=True):
            for i in range(segments):
                j = (i+1) % segments
                self.face((lower[i], lower[j], upper[j], upper[i]), band, smooth)
        if caps[1]:
            self.face(rings[-1], bands[-1])

    def save(self, name, pivot, mat, root):
        mesh = bpy.data.meshes.new(name)
        # Share ring vertices so the cheeks shade continuously across the ink.
        indices = {point: i for i, point in enumerate(dict.fromkeys(self.verts))}
        vertices = [(x-pivot[0], y-pivot[1], z-pivot[2]) for x,y,z in indices]
        faces = [[indices[self.verts[i]] for i in face] for face in self.faces]
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        paint = mesh.color_attributes.new(name="Paint", type="BYTE_COLOR", domain="CORNER")
        palette = {c: linear(c) for c in set(self.colors)}
        for poly, c, smooth in zip(mesh.polygons, self.colors, self.smooth):
            poly.use_smooth = smooth
            for index in poly.loop_indices:
                paint.data[index].color = palette[c]
        mesh.materials.append(mat)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.location, obj.parent = pivot, root
        return obj


def build_head(root, painted, hair_ink):
    head = Part()
    # A flat cheek band lets the two painted eyes sit flush at any viewing angle.
    cheek_x, cheek_y = .401, .327
    head.rings([(0,-.012,1.083,.178,.154),(0,0,1.212,.367,.297),
                (0,0,1.325,cheek_x,cheek_y),(0,0,1.675,cheek_x,cheek_y)],
               SKIN, 10, (True,True), True)
    # Only the face and jaw show. Recess the back of the skull inside the bob
    # so skin never breaks through the nape in the bridge camera.
    head.verts = [(x*(1-.26*max(y,0)/cheek_y), y*.62 if y>0 else y, z)
                  for x,y,z in head.verts]

    def front(x):
        return -cheek_y + abs(x) * (cheek_y/cheek_x) * math.tan(math.pi/10)

    for side in (-1, 1):
        x = side * .145
        outline = [(-.034,-.050), (-.022,-.068), (.020,-.068), (.034,-.052),
                   (.034,.043), (.020,.057), (-.021,.057), (-.034,.042)]
        head.face([(x+dx, front(x+dx)-.004, 1.416+dz) for dx,dz in outline], INK)
        # The outer shell hides the top of the ear. Only the small peach lobe shows.
        ear = [(side*x, y, z) for x,y,z in
               ((.368,-.064,1.306), (.415,-.057,1.235), (.455,-.029,1.270),
                (.461,-.018,1.345), (.421,-.035,1.381))]
        head.face(ear if side > 0 else ear[::-1], SKIN)
    head.save("head", (0,0,1.40), painted, root)

    hair = Part()
    # Keep the bottom edge continuous. Short gaps in the fringe and the two long
    # temple locks are cut directly into the silhouette, without layered cards.
    angles = (0, 14, 22, 29, 39, 49, 58, 70, 92, 120, 150, 180,
              210, 240, 268, 290, 302, 311, 321, 331, 339, 347)
    fringe = (1.498,1.495,1.546,1.494,1.497,1.508,1.345,1.296,1.263,1.228,1.217,
              1.212,1.221,1.232,1.266,1.309,1.333,1.502,1.506,1.579,1.51,1.50)
    swept = (1.566,1.482,1.421,1.385,1.358,1.339,1.315,1.292,1.263,1.228,
             1.217,1.212,1.221,1.232,1.266,1.309,1.333,1.406,1.493,1.632,1.615,1.593)
    bases, mids = [], []
    changes = {}
    for angle, z, swept_z in zip(angles, fringe, swept):
        a = math.radians(angle)
        x, y = math.sin(a), -math.cos(a)
        # The front projects over the eyes; the nape turns inward toward the neck.
        turn = min(1, max(0, (y+.4)/1.4))
        point = ((.449-.090*turn)*x, (.367-.102*turn)*y+.006, z-.052*turn)
        bases.append(point)
        changes[point] = (0, -.010*max(0,-y), swept_z-z)
        mids.append((.449*x-.006, .367*y+.012, 1.591+.027*x))
    # The fringe needs more vertices than the crown. Stitch groups of fringe
    # edges into each wider crown panel instead of carrying every cut to the top.
    corners = (0, 4, 7, 9, 10, 11, 12, 13, 15, 18)
    def crown(rx, ry, z):
        return [(-.013+rx*math.sin(math.radians(angles[i])),
                 .018-ry*math.cos(math.radians(angles[i])),
                 z+.013*math.sin(math.radians(angles[i]))) for i in corners]
    shoulder, top = crown(.406,.336,1.731), crown(.277,.239,1.827)
    peak = (-.035,.032,1.884)
    for i, angle in enumerate(angles):
        j = (i+1) % len(angles)
        shade = "FCF8F8" if 60 <= angle <= 260 else "FFFFFF"
        hair.face((bases[i],bases[j],mids[j],mids[i]),shade,True)
        # A shallow inward lip gives the overhanging fringe a finished underside.
        inner_i = (bases[i][0]*.84, bases[i][1]*.84, bases[i][2]+.015)
        inner_j = (bases[j][0]*.84, bases[j][1]*.84, bases[j][2]+.015)
        changes[inner_i] = changes[bases[i]]
        hair.face((bases[j],bases[i],inner_i,inner_j),"E6DADB")
    for k, start in enumerate(corners):
        h = (k+1) % len(corners)
        end = corners[h] or len(mids)
        for i in range(start, end):
            hair.face((mids[i],mids[(i+1)%len(mids)],shoulder[k]),"FFFFFF",True)
        hair.face((mids[end%len(mids)],shoulder[h],shoulder[k]),"FFFFFF",True)
        hair.face((shoulder[k],shoulder[h],top[h],top[k]),"FFFFFF",True)
        hair.face((top[k],top[h],peak),"FFFFFF",True)
    # One small cowlick reads even from the bridge camera.
    hair.rings([(-.044,.036,1.848,.039,.035),(-.058,.034,1.929,.026,.022),
                (-.032,.040,1.968,.006,.007)],"FCF8F8",4,(False,True),True)
    pivot = (0,0,1.40)
    obj = hair.save("hair",pivot,hair_ink,root)
    obj.shape_key_add(name="Basis")
    swept_key = obj.shape_key_add(name="SideSweep")
    swept_key.value = 0
    for index, point in enumerate(dict.fromkeys(hair.verts)):
        delta = changes.get(point)
        if delta:
            for axis in range(3):
                swept_key.data[index].co[axis] += delta[axis]


def jacket(root, painted, accent):
    body = Part()
    body.rings([(0,0,.512,.202,.136),
                (0,0,.936,.161,.120), (0,0,1.019,.185,.126),
                (0,0,1.060,.107,.086)], IVORY, 8, (True,False), True)
    body.rings([(0,0,1.015,.130,.119),(0,0,1.091,.122,.103)], NAVY, 8,
               (False,True))
    # The graphic follows each of the two planes of the octagonal jacket.
    # Splitting at x = 0 keeps its centre above the seam in both views.
    def decal(part, corners, back, color, lift):
        pts = []
        for x, z in corners:
            t = min(1, max(0, (z-.588)/(.936-.588)))
            rx, ry = .196-.035*t, .135-.015*t
            surface = ry - abs(x)*ry/rx*math.tan(math.pi/8)
            pts.append((x, (surface+lift)*(1 if back else -1), z))
        part.face(pts[::-1] if back else pts, color)

    def diamond(part, z, width, above, below, back, tone, lift):
        for sign in (-1,1):
            half = [(0,z-below),(width*sign,z),(0,z+above)]
            decal(part,half if sign==1 else half[::-1],back,tone,lift)

    sash = Part()
    for side in (-1,1):
        bib = [(0,.798),(.125*side,1.029),(0,1.041)]
        decal(body,bib if side==1 else bib[::-1],False,NAVY,.013)
    diamond(sash,.846,.043,.061,.111,False,"FFFFFF",.018)
    decal(sash,[(-.014,.518),(.014,.518),(.006,.733),(-.006,.733)],False,"F7FFFF",.005)
    diamond(body,.867,.153,.126,.180,True,NAVY,.013)
    diamond(sash,.864,.081,.076,.082,True,"FFFFFF",.018)
    diamond(body,.864,.041,.040,.044,True,NAVY,.021)
    diamond(sash,.865,.014,.021,.023,True,"FFFFFF",.025)
    body.save("body",(0,0,.78),painted,root)
    sash.save("badge",(0,0,.85),accent,root)


def limbs(root, painted):
    for side,s in (("L",-1),("R",1)):
        leg = Part()
        x = s*.105
        # Tapered shorts, short sock, dark toe. Each colour boundary is a ring.
        leg.rings([(x,-.038,.008,.078,.117),(x,-.035,.074,.085,.120),
                   (x,0,.151,.065,.069),(x,0,.253,.069,.064),
                   (x,0,.264,.082,.078),(s*.092,0,.539,.084,.082)],
                  ("242732","242732","B4DCDE",NAVY,NAVY),5,(True,False),True)
        leg.save("leg"+side,(s*.101,0,.533),painted,root)

        arm = Part()
        arm.rings([(s*.305,-.011,.583,.029,.031),(s*.300,-.018,.630,.058,.050),
                   (s*.282,-.009,.689,.047,.045),(s*.244,0,.811,.067,.061),
                   (s*.193,0,.989,.082,.077),(s*.168,0,1.026,.054,.055)],
                  ("292935","292935",NAVY,IVORY,IVORY),5,(True,True),True)
        arm.save("arm"+side,(s*.183,0,.985),painted,root)


bpy.ops.wm.read_factory_settings(use_empty=True)
root = bpy.data.objects.new("AgentCitizen", None)
bpy.context.scene.collection.objects.link(root)
painted = pigment("citizen_painted")
hair_ink = pigment("citizen_hair_chestnut", "573931")
accent = pigment("citizen_insignia", "43DCD0")
jacket(root, painted, accent)
build_head(root, painted, hair_ink)
limbs(root, painted)
OUT.parent.mkdir(parents=True, exist_ok=True)
BLEND.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format="GLB", export_texcoords=False)
tris = sum(len(p.vertices)-2 for part in root.children for p in part.data.polygons)
print("AGENT_CITIZEN_RESULT " + json.dumps({"bytes": OUT.stat().st_size, "tris": tris,
                                          "parts": sorted(o.name for o in root.children)}))
