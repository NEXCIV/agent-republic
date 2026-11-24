"""Shared street, arcade and plaza modules fitted around the legacy road network."""

import math
import bpy
import bmesh
from mathutils import Vector

from build_civrum_world import Geometry, circle, rectangle, PALETTE
from detail_civrum_world import rod, panel, emblem
from civrum_landmark_slots import collection, support

INK, ROAD, GOLD, ALLOY, STONE, CREAM, TEAL, GLASS, WOOD, OCHRE, BRASS, MILK = range(12)
EXTRA = (("CIVIC_TEAL","326D72",.18,.40),("HARBOR_GLASS","487C89",.38,.22),
         ("SEAT_WOOD","A96B42",.02,.54),("CLAY_OCHRE","C76F45",.08,.48),
         ("SATIN_BRASS","C39C5F",.57,.35),("OPAL_GLASS","FFE3AC",.04,.35))
PAINT = PALETTE + EXTRA


def tint(name, hex_color, metal, rough):
    mat = bpy.data.materials.get("MAT_"+name) or bpy.data.materials.new("MAT_"+name)
    mat.use_nodes = True
    s = [int(hex_color[i:i+2],16)/255 for i in (0,2,4)]
    rgba = tuple((x/12.92 if x <= .04045 else ((x+.055)/1.055)**2.4) for x in s)+(1,)
    mat.diffuse_color = rgba
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    for key,value in (("Base Color",rgba),("Roughness",rough),("Metallic",metal)):
        bsdf.inputs[key].default_value = value
    return mat


def mount(group,name,data,pos,angle=0):
    obj = bpy.data.objects.new(name,data)
    group.objects.link(obj)
    obj.location = pos
    obj.rotation_euler.z = math.radians(angle)
    return obj


def word(group, parent, msg, size, x, y, z, color=CREAM):
    font = bpy.data.curves.new(msg,"FONT")
    font.body, font.align_x, font.align_y, font.size = msg,"CENTER","CENTER",size
    font.space_character = 1.06
    font.materials.append(bpy.data.materials["MAT_"+PAINT[color][0]])
    obj = mount(group,"CIVRUM_Sign_"+msg,font,(x,y,z))
    obj.parent = parent
    obj.rotation_euler.x = math.pi/2
    return obj


def replace_module(key,g):
    objs = [o for o in bpy.data.collections["PUBLIC_FACILITIES"].objects if o.name.split(".")[0] == "CIVRUM_"+key]
    if not objs:
        raise ValueError(key)
    mesh = g.mesh("CIVRUM_Street_"+key,PAINT)
    mesh["module"] = key
    for obj in objs:
        obj.data = mesh


def lamps(style):
    g = Geometry()
    g.slab(circle(.26,12),0,.13,STONE)
    g.slab(circle(.18,12),.13,.34,TEAL)
    top = (5.16,4.79,3.01)[style-1]
    rod(g,(0,0,.34),(0,0,top),.102,TEAL,.063,12)
    for z in (.36,.70,top-.32):
        g.slab(circle(.116,12),z,z+.065,BRASS)
    if style == 2:
        g.box(.53,0,2.54,.73,.085,2.12,GOLD,.022)
        emblem(g,.53,-.047,4.12,.20,TEAL)
        for z in (2.61,4.56):
            rod(g,(0,0,z),(.89,0,z),.034,BRASS,sides=8)
        for i in range(3):
            g.box(.5,-.048,2.78+.13*i,.45-.07*i,.014,.033,TEAL)
    reach = (1.43,1.02,.0)[style-1]
    if reach:
        points = [(0,0,top-.18),(.12,0,top+.20),(.39,0,top+.40),
                  (reach-.22,0,top+.40),(reach,0,top+.19),(reach,0,top+.03)]
        for a,b in zip(points,points[1:]):
            rod(g,a,b,.062,BRASS,sides=10)
    z = top+.02
    def ring(r):
        return circle(r,20,reach,0)
    g.loft(ring(.37),ring(.15),z-.05,z+.17,TEAL)
    g.slab(ring(.39),z-.087,z-.045,BRASS)
    g.loft(ring(.19),ring(.34),z-.265,z-.082,MILK)
    g.slab(ring(.20),z-.30,z-.262,ALLOY)
    return g


def bench(style):
    g = Geometry()
    length = 2.36 if style == 1 else 2.85
    for x in (-length*.34,length*.34):
        g.box(x,0,0,.22,.58,.08,ALLOY,.035)
        g.loft(rectangle(x,0,.22,.50,.04),rectangle(x,0,.16,.44,.04),.08,.40,TEAL)
        g.box(x,0,.37,.20,.67,.065,TEAL,.035)
    for i in range(5):
        g.box(0,-.25+i*.125,.435,length,.108,.075,WOOD,.025)
    for x in (-length*.37,length*.37):
        rod(g,(x,.21,.42),(x,.36,.91),.038,BRASS,sides=8)
        rod(g,(x,-.20,.45),(x,-.20,.64),.033,TEAL,sides=8)
        rod(g,(x,-.20,.64),(x,.27,.68),.034,TEAL,sides=8)
    for i in range(3):
        g.box(0,.28+i*.029,.60+i*.112,length,.072,.086,WOOD,.024)
    return g


def shopfront(w,d,h,variant):
    """One instanced retrofit per existing shell family, aligned to its street face."""
    g = Geometry()
    y = -d/2-.075
    w *= .89
    bays = max(3,round(w/3.1))
    spacing = w/bays
    g.box(0,y-.31,.005,w+1.3,1.55,.12,STONE,.24)
    for i in range(bays):
        x = -w/2+(i+.5)*spacing
        g.box(x,y,.13,spacing-.15,.16,2.60,TEAL,.06)
        g.box(x,y-.11,.28,spacing-.36,.11,2.22,GLASS,.035)
        g.box(x,y-.18,.29,.055,.055,2.18,BRASS)
        g.box(x,y-.18,2.02,spacing-.33,.055,.055,BRASS)
        if i != bays//2:
            g.box(x,y-.20,.24,spacing-.28,.16,.30,CREAM,.025)
        else:
            for off in (-.10,.10):
                g.box(x+off,y-.21,1.00,.025,.07,.34,BRASS)
    accent = (TEAL,OCHRE,TEAL,WOOD)[variant%4]
    g.box(0,y-.20,2.75,w+.38,.85,.30,accent,.12)
    g.box(0,y-.40,3.04,w+.43,.55,.075,BRASS,.065)
    upper = max(1,int((h-3.8)/3.05))
    for row in range(upper):
        z = 3.55+3.05*row
        for i in range(bays):
            x = -w/2+(i+.5)*spacing
            g.box(x,y,z,spacing*.82,.14,1.64,CREAM,.08)
            g.box(x,y-.093,z+.12,spacing*.73,.10,1.38,GLASS,.045)
            g.box(x,y-.16,z+.12,.066,.045,1.36,ALLOY)
            g.box(x,y-.18,z-.05,spacing*.89,.33,.12,accent,.035)
    g.box(w*.38,y-.5,2.94,.10,.76,.11,BRASS)
    g.box(w*.38,y-.84,2.40,.18,.54,.57,accent,.07)
    return g


def arc_canopy():
    g = Geometry()
    for x in (-2.32,2.32):
        g.box(x,.50,0,.36,.40,.13,STONE,.07)
        rod(g,(x,.50,.13),(x,.50,3.03),.084,TEAL,.069,12)
        for side in (-1,1):
            rod(g,(x,.5,2.32),(x,.48+side*.88,3.08),.044,BRASS,sides=8)
    def section(x,y):
        return (x,y,3.02+.50*(1-((y-.04)/1.34)**2))
    for i in range(12):
        x0=-2.90+i*5.80/12
        x1=x0+5.80/12
        for j in range(8):
            a=-1.28+j*.33
            b=a+.33
            start=len(g.verts)
            g.verts.extend([section(x0,a),section(x1,a),section(x1,b),section(x0,b)])
            g.face(tuple(range(start,start+4)),CREAM if i%3 else OCHRE)
        g.box((x0+x1)/2,-1.28,2.82,x1-x0-.008,.055,.21,CREAM if i%3 else OCHRE,.012)
    for y in (-1.27,1.36):
        rod(g,(-2.92,y,3.01),(2.92,y,3.01),.045,BRASS,sides=10)
    g.box(0,-1.30,2.63,2.65,.09,.38,TEAL,.07)
    return g


def retint():
    for row in (*EXTRA,("CONCRETE_GRAY","D7CCB9",.02,.73),("WARM_WHITE","F0E8D9",.04,.58),
                ("GRAPHITE_GRAY","454A50",.05,.77),("METALLIC_GRAY","7A8588",.43,.37),
                ("LEAF_SHADE","3C6255",0,.80),("LEAF_SAGE","709273",0,.80),
                ("LEAF_TIP","99AD71",0,.82),("TURF","8E9D74",0,.90)):
        tint(*row)
    # Reassign per shared mesh, avoiding a separate material copy per tree or planter.
    swaps = {"PROP_PLANTER":{"MAT_METALLIC_GRAY":BRASS,"MAT_GRAPHITE_GRAY":TEAL},
             "PROP_WAYFINDER":{"MAT_GRAPHITE_GRAY":TEAL,"MAT_METALLIC_GRAY":BRASS},
             "PROP_INFO_KIOSK":{"MAT_GRAPHITE_GRAY":TEAL,"MAT_METALLIC_GRAY":BRASS},
             "PROP_RAIL":{"MAT_GRAPHITE_GRAY":TEAL},"PROP_BIN":{"MAT_GRAPHITE_GRAY":TEAL},
             "CONSTRUCTION_FENCE":{"MAT_GRAPHITE_GRAY":TEAL}}
    for c in ("PUBLIC_FACILITIES","CONSTRUCTION"):
        seen = set()
        for obj in bpy.data.collections[c].objects:
            if obj.type != "MESH" or obj.data in seen:
                continue
            seen.add(obj.data)
            for prefix,remap in swaps.items():
                if obj.name.startswith("CIVRUM_"+prefix):
                    for i,old in enumerate(list(obj.data.materials)):
                        if old.name in remap:
                            obj.data.materials[i]=bpy.data.materials["MAT_"+PAINT[remap[old.name]][0]]


def forecourt():
    # Move complete planted strips together, keeping trunks and flowers on their soil.
    bpy.data.objects["CIVRUM_GREEN_VERGE_01.015"].location.x -= 8.1
    east_bed=bpy.data.objects["CIVRUM_GREEN_VERGE_01.016"]
    east_bed.location.x += 2.7
    east_bed.location.y += 1.35
    # This planted strip's own X axis runs north in world space.
    tree=next(o for o in east_bed.children if o.name.startswith("CIVRUM_TREE_"))
    tree.location.x += 1.1
    bench_obj = bpy.data.objects["CIVRUM_PROP_BENCH_02.003"]
    bench_obj.location.x,bench_obj.location.y = 78.0,11.25
    lamp = bpy.data.objects["CIVRUM_PROP_STREETLIGHT_02.005"]
    lamp.location.x, lamp.location.y = 72.15,28.15
    label=bpy.data.objects["CIVRUM_BANNER_DISTRICT_CODE.005"]
    if label.parent != lamp:
        label.location.x -= .85
        label.location.y += 6.15


def arcades(group):
    families = {}
    shells = list(bpy.data.collections["CONTEXT_MASSING"].objects)
    for obj in shells:
        name=obj.data.name
        if name not in families:
            lo=[min(p[i] for p in obj.bound_box) for i in range(3)]
            hi=[max(p[i] for p in obj.bound_box) for i in range(3)]
            width,depth=hi[0]-lo[0],hi[1]-lo[1]
            shoulder={"OUTER_MASS_01":15,"OUTER_MASS_02":10,"OUTER_MASS_03":17}.get(name,hi[2]-1.25)
            retrofit=shopfront(width,depth,shoulder,len(families))
            # Rear elevations face other streets across the same blocks.
            for row in range(max(1,int((shoulder-.9)/2.7))):
                z=.48+row*2.67
                retrofit.box(0,depth/2+.055,z,width*.84,.13,1.54,TEAL,.07)
                retrofit.box(0,depth/2+.14,z+.09,width*.80,.09,1.33,GLASS,.06)
                for k in range(-3,4):
                    retrofit.box(k*width*.112,depth/2+.195,z+.09,.066,.04,1.33,CREAM)
                retrofit.box(0,depth/2+.16,z-.04,width*.87,.30,.11,CREAM,.045)
            if name.startswith("OUTER_MASS"):
                for z in range(int(shoulder)+1,int(hi[2]-1),2):
                    retrofit.box(0,0,z,width*.46,depth-.35,.33,TEAL,.15)
                retrofit.box(0,0,hi[2]+.04,width*.46,depth-.38,.19,BRASS,.16)
            for sign in (-1,1):
                for row in range(max(0,int((shoulder-3.55)/2.75))):
                    z=3.55+2.65*row
                    retrofit.box(sign*(width/2+.026),0,z,.09,depth*.80,1.36,GLASS,.04)
                    for j in range(-2,3):
                        retrofit.box(sign*(width/2+.088),j*depth*.15,z,.044,.082,1.36,BRASS)
            families[name]=retrofit.mesh("Streetfront_"+name,PAINT)
        kit=mount(group,"CIVRUM_Streetfront_"+obj.name.removeprefix("CIVRUM_PH_"),families[name],(0,0,0))
        kit.parent=obj
        east=abs(obj.rotation_euler.z)>1
        along=obj.location.x if east else obj.location.y
        road=min((-126,-64,0,64,126), key=lambda v: abs(v-along))
        if (east and road<along) or (not east and road>along):
            kit.rotation_euler.z=math.pi

    # Two-storey walk-up for the research precinct, alongside the small Agent landmark.
    g=Geometry()
    g.box(0,0,0,15,6,6.78,CREAM,.45)
    g.box(0,0,6.78,15.3,6.3,.22,TEAL,.48)
    g.box(1.55,0,7,10,5.20,2.40,TEAL,.64)
    g.box(1.55,0,9.4,10.22,5.42,.22,CREAM,.68)
    g.box(1.55,-2.63,7.42,8.8,.12,1.50,GLASS,.12)
    for x in (-2.25,-.35,1.55,3.45,5.35):
        g.box(x,-2.72,7.42,.10,.13,1.55,BRASS)
    pos=(-91,52,.172)
    wing=mount(group,"CIVRUM_Research_Reading_Room",g.mesh("Reading room shell",PAINT),pos)
    face=mount(group,"CIVRUM_Research_Reading_Room_Front",shopfront(15,6,6.8,1).mesh("Reading room frontage",PAINT),(0,0,0))
    face.parent=wing
    word(group,wing,"RESEARCH  /  READING ROOM",.35,0,-3.74,2.92)
    g=Geometry()
    g.box(0,0,0,3.93,.22,1.20,CREAM,.16)
    g.box(0,-.15,.12,3.64,.11,.94,TEAL,.12)
    sign=mount(group,"CIVRUM_Research_Roof_Sign",g.mesh("Research rooftop sign",PAINT),(-94,49.5,7.12))
    word(group,sign,"ARCHIVE",.46,0,-.22,.60)


def plaza(group):
    g=Geometry()
    g.band(circle(4.18,64),circle(4.09,64),.002,BRASS)
    g.band(circle(3.94,64),circle(3.72,64),.0025,TEAL)
    for k in range(12):
        a=k*math.tau/12
        rod(g,(4.22*math.cos(a),4.22*math.sin(a),.002),(4.55*math.cos(a),4.55*math.sin(a),.002),.028,BRASS,sides=6)
    mount(group,"CIVRUM_Plaza_Compass",g.mesh("Plaza compass inlay",PAINT),(0,-8.3,.222))
    canopy=arc_canopy().mesh("Striped vaulted city shelter",PAINT)
    entries=[((-77.8,22.9,.158),20,"RESEARCH WALK"),((15.6,-10.5,.222),-65,"NEXUS WALK"),
             ((-13.8,-8.3,.222),74,"FORUM WALK"),((-84,-78,.172),35,"COMMUNITY")]
    for pos,yaw,title in entries:
        obj=mount(group,"CIVRUM_Public_Arcade",canopy,pos,yaw)
        word(group,obj,title,.215,0,-1.352,2.82)


def visitor_maps(group):
    # A binocular-height city map and directional tile band at pedestrian decision points.
    g=Geometry()
    g.box(0,0,0,1.10,.49,.11,STONE,.09)
    for x in (-.35,.35):
        g.box(x,0,.11,.12,.15,1.30,TEAL,.025)
    g.box(0,0,.59,1.23,.20,1.27,TEAL,.075)
    g.box(0,-.125,.75,1.04,.065,.82,CREAM,.035)
    for x,z,w,h in ((-.30,.95,.20,.24),(.30,1.33,.22,.21),(.22,.96,.24,.20),(-.25,1.32,.27,.16)):
        g.box(x,-.168,z,w,.018,h,GLASS,.025)
    emblem(g,0,-.185,1.18,.14,OCHRE)
    for x in (-.14,.14):
        g.box(x,-.167,1.16,.025,.013,.45,BRASS)
    g.box(0,0,1.85,1.31,.31,.065,BRASS,.04)
    mesh=g.mesh("Pedestrian map with inset district diagram",PAINT)
    for pos,angle,title in (((-73.8,15.9,.158),22,"R  /  02"),((82.9,11.4,.158),-12,"C  /  03"),
                            ((9,78,.172),0,"G  /  01"),((100.8,-67,.172),165,"W  /  04")):
        obj=mount(group,"CIVRUM_Public_District_Map",mesh,pos,angle)
        word(group,obj,title,.20,0,-.106,1.72)
        word(group,obj,"DISTRICT GUIDE",.096,0,-.106,.67)
    band=Geometry()
    for x in (-.26,.26):
        band.box(x,0,0,.042,21,.006,BRASS)
    for y in (-8,-4,0,4,8):
        for x in (-.10,.10):
            p=[(x-.055,y-.12),(x+.055,y-.12),(x+.055,y+.12),(x-.055,y+.12)]
            band.surface(p,.007,TEAL)
    stripe=band.mesh("Inlaid direction band",PAINT)
    for x in (-71.4,71.4):
        mount(group,"CIVRUM_Forecourt_Inlay",stripe,(x,20.75,.162))


def street_drains():
    seen=set()
    for obj in bpy.data.collections["ROADS"].objects:
        if "length_m" not in obj or obj.data in seen:
            continue
        seen.add(obj.data)
        length,width=obj["length_m"],obj["width_m"]
        if length<1.8:
            continue
        geom=Geometry()
        for side in (-1,1):
            y=side*(width/2+.40)
            x=length*.52
            geom.surface(rectangle(x,y,.76,.27,.025),.184,ALLOY)
            for k in range(-4,5):
                geom.surface(rectangle(x+k*.074,y,.036,.18,.009),.185,INK)
            geom.surface(rectangle(length/2,side*(width/2+2.35),length,.047),.1845,BRASS)
        mesh=obj.data
        bm=bmesh.new()
        bm.from_mesh(mesh)
        verts=[bm.verts.new(p) for p in geom.verts]
        for verts_idx,idx in zip(geom.faces,geom.colors):
            mat=bpy.data.materials["MAT_"+PAINT[idx][0]]
            slot=mesh.materials.find(mat.name)
            if slot<0:
                mesh.materials.append(mat)
                slot=len(mesh.materials)-1
            bm.faces.new([verts[i] for i in verts_idx]).material_index=slot
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()


def people():
    group=collection("04_Character_Activity")
    positions=[
        ("01_Citizen","Nexus welcome",(-4.5,-14.7),"CIVRUM_PLAZA_OCTAGON",0),
        ("02_Builder","Visitor entrance",(98,-69),"CIVRUM_LOT_CONSTRUCTION",180),
        ("03_Researcher","Agent services",(-89.5,64),"CIVRUM_LOT_RESEARCH",90),
        ("04_Creator","Public gallery",(7,-12),"CIVRUM_PLAZA_OCTAGON",32),
        ("05_Citizen","Council portico",(3,82),"CIVRUM_LOT_GOVERNANCE",0),
        ("06_Service","Registration queue",(81,12.8),"CIVRUM_PAVED_FORECOURT.001",0),
        ("07_Creator","Community forum",(-92,-71.2),"CIVRUM_LOT_COMMUNITY",180),
        ("08_Technician","Works yard",(99,-92.5),"CIVRUM_LOT_CONSTRUCTION",0)]
    for name,activity,(x,y),floor,yaw in positions:
        z=support(floor,x,y)
        if floor=="CIVRUM_PLAZA_OCTAGON":
            for tile in bpy.data.collections["PLAZA"].objects:
                if tile.name.startswith("CIVRUM_PLAZA_TILE"):
                    try:
                        z=max(z,support(tile.name,x,y))
                    except ValueError:
                        pass
        obj=mount(group,"ACTOR_"+name,None,(x,y,z),yaw)
        obj.empty_display_type="ARROWS"
        obj.empty_display_size=.55
        obj["activity"]=activity
        obj["support"]=floor


def build_streets():
    retint()
    forecourt()
    for i in range(1,4):
        replace_module("PROP_STREETLIGHT_0"+str(i),lamps(i))
    for i in range(1,3):
        replace_module("PROP_BENCH_0"+str(i),bench(i))
    group=collection("05_Street_Architecture")
    arcades(group)
    plaza(group)
    visitor_maps(group)
    street_drains()
    bpy.context.view_layer.update()
    people()
