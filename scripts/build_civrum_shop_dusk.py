"""Light the approved lakeside shop and its streets for dusk in a separate Blender world."""

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_lakeside import OUTPUT, collection, color, shader
from build_civrum_south_shop import DEST as SHOP_WORLD
from build_civrum_south_shop import render

DEST = OUTPUT / "CIVRUM_World_300m_Dusk.blend"
CAMERAS = {"street": "SHOP_CAM_01 | Street frontage", "overview": "LAKE_CAM_01 | City overview"}


def stops(node, entries):
    ramp = node.color_ramp
    ramp.interpolation = "EASE"
    first, last = ramp.elements
    first.position, first.color = entries[0]
    last.position, last.color = entries[-1]
    for pos, tint in entries[1:-1]:
        ramp.elements.new(pos).color = tint


def evening_sky(scene, gold):
    # The original sky has separate backgrounds for visible sky and diffuse illumination.
    tree = scene.world.node_tree
    nodes = tree.nodes
    altitude, azimuth = map(math.radians, (10, 211))
    direction = Vector(
        (math.cos(altitude) * math.cos(azimuth), math.cos(altitude) * math.sin(azimuth), math.sin(altitude))
    )
    sun = bpy.data.objects["Lakeside warm sun"]
    sun.location = direction * 150
    sun.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    sun.data.energy = 2.02 if gold else 1.27
    sun.data.angle = math.radians(1.9)
    sun.data.color = (1, 0.58, 0.22) if gold else (1, 0.57, 0.32)
    nodes["Vector Math"].inputs[1].default_value = direction
    fill = ("C4B0B0", "8DA1BA", "4F73A4") if gold else ("BFADB7", "8999B0", "526C9B")
    sky = ("FFD08C", "F8BB86", "B1A6B5", "617EA9") if gold else ("F8C090", "E9B5A4", "AAA2BF", "627DA6")
    stops(nodes["Color Ramp"], [(p, color(tint)) for p, tint in zip((0, 0.28, 0.78), fill, strict=True)])
    stops(
        nodes["Color Ramp.002"],
        [(p, color(tint)) for p, tint in zip((0, 0.08, 0.26, 0.68), sky, strict=True)],
    )
    nodes["Background"].inputs["Strength"].default_value = 0.68 if gold else 0.62
    nodes["Background.001"].inputs["Strength"].default_value = 0.82
    nodes["Mix (Legacy).001"].inputs[0].default_value = 0.38
    # Reflected sky follows the visible sky, including across the lake and in the clear shop glazing.
    visible = nodes.new("ShaderNodeMath")
    visible.operation = "MAXIMUM"
    for index, ray in enumerate(("Is Camera Ray", "Is Glossy Ray")):
        tree.links.new(nodes["Light Path"].outputs[ray], visible.inputs[index])
    tree.links.new(visible.outputs[0], nodes["Mix Shader"].inputs[0])


def area(group, parent, name, location, target, size, watts, tint):
    data = bpy.data.lights.new(name, "AREA")
    data.shape = "RECTANGLE"
    data.size, data.size_y = size
    data.energy, data.color = watts, tint
    obj = bpy.data.objects.new(name, data)
    group.objects.link(obj)
    obj.parent, obj.location = parent, location
    obj.rotation_euler = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y").to_euler()


def shop_lights(group):
    root = bpy.data.objects["Shop 40 | Ground centre"]
    for obj in root.children:
        if obj.type != "LIGHT":
            continue
        if "Rear window" in obj.name:
            obj.data.energy, obj.data.color = 340, (1, 0.69, 0.40)
        elif obj.location.z < 4:
            obj.data.energy, obj.data.color = 410, (1, 0.66, 0.35)
        else:
            obj.data.energy, obj.data.color = 230, (1, 0.76, 0.51)
    shader(bpy.data.materials["MAT_SHOP_Opal"]).inputs["Emission Strength"].default_value = 4.5
    for x in (-1.43, 1.43):
        area(
            group,
            root,
            "Dusk | canopy downlight",
            (x, -5.1, 2.96),
            (x, -5.65, 0.14),
            (0.12, 1.12),
            75,
            (1, 0.70, 0.40),
        )
    # A shielded sign wash sits on the canopy lip, facing back towards the raised lettering.
    area(
        group,
        root,
        "Dusk | fascia wash",
        (0, -5.79, 3.29),
        (0, -5.14, 3.57),
        (3.70, 0.09),
        48,
        (1, 0.78, 0.54),
    )
    for x in (-4.15, 4.15):
        area(
            group,
            root,
            "Dusk | rear display",
            (x, 3.63, 2.93),
            (x, 2.50, 0.70),
            (2.40, 0.35),
            195,
            (1, 0.69, 0.42),
        )
    area(
        group,
        root,
        "Dusk | rooflight well",
        (0, -0.38, 5.93),
        (0, 0.78, 4.47),
        (3.10, 0.52),
        140,
        (1, 0.71, 0.43),
    )


def street_lights(scene, group):
    original = bpy.data.materials["MAT_OPAL_GLASS"]
    lens = original.copy()
    lens.name = "Dusk | warm street lantern glass"
    surface = shader(lens)
    surface.inputs["Emission Color"].default_value = color("FFDBA6")
    surface.inputs["Emission Strength"].default_value = 6.0
    heads = {}
    for fixture in list(scene.objects):
        if fixture.type != "MESH" or "PROP_STREETLIGHT_" not in fixture.name or fixture.hide_render:
            continue
        # Lamp styles share geometry. Only the opal lens gets this material override.
        slot = next(slot for slot in fixture.material_slots if slot.material == original)
        slot.link, slot.material = "OBJECT", lens
        if fixture.data not in heads:
            centers = [
                face.center for face in fixture.data.polygons if face.material_index == slot.slot_index
            ]
            low = Vector(tuple(min(pt[i] for pt in centers) for i in range(3)))
            high = Vector(tuple(max(pt[i] for pt in centers) for i in range(3)))
            head = (low + high) / 2
            head.z = low.z - 0.04
            data = bpy.data.lights.new("Dusk | " + fixture.data.name, "AREA")
            data.shape, data.size = "DISK", 0.42
            data.energy = 58 if head.z < 3.5 else 155
            data.color = (1, 0.74, 0.46)
            heads[fixture.data] = (head, data)
        position, data = heads[fixture.data]
        obj = bpy.data.objects.new("Dusk pool | " + fixture.name, data)
        group.objects.link(obj)
        obj.parent, obj.location = fixture, position


def garden_windows(scene):
    """Object-level finish for the old retail instances, retaining their linked mesh and original UVs."""
    source = bpy.data.objects["CIVRUM_HI3D_Garden_Roof_Retail"].instance_collection
    (facade,) = source.objects
    targets = [o for o in scene.objects if o.instance_collection == source and not o.hide_render]
    local = bpy.data.collections.new("Dusk | occupied garden retail")
    local.instance_offset = source.instance_offset
    obj = facade.copy()
    local.objects.link(obj)
    finish = facade.material_slots[0].material.copy()
    finish.name = "Dusk | garden retail window mask"
    obj.material_slots[0].link = "OBJECT"
    obj.material_slots[0].material = finish
    tree = finish.node_tree
    surface = shader(finish)
    albedo = surface.inputs["Base Color"].links[0].from_socket
    sep = tree.nodes.new("ShaderNodeSeparateColor")
    tree.links.new(albedo, sep.inputs[0])
    chroma = tree.nodes.new("ShaderNodeMath")
    chroma.operation = "SUBTRACT"
    tree.links.new(sep.outputs["Red"], chroma.inputs[0])
    tree.links.new(sep.outputs["Blue"], chroma.inputs[1])

    def mask(source_socket, entries, label):
        node = tree.nodes.new("ShaderNodeValToRGB")
        node.label = label
        stops(node, [(u, (v, v, v, 1)) for u, v in entries])
        tree.links.new(source_socket, node.inputs[0])
        return node.outputs[0]

    glass = mask(chroma.outputs[0], [(0.05, 0), (0.29, 1)], "Amber glazing in the original diffuse map")
    axis = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(tree.nodes.new("ShaderNodeTexCoord").outputs["Generated"], axis.inputs[0])
    bands = mask(
        axis.outputs["Z"],
        [(0.064, 0), (0.086, 1), (0.277, 1), (0.310, 0), (0.476, 0), (0.497, 1), (0.680, 1), (0.70, 0)],
        "Two window bands; exclude roof, beams and plinth",
    )
    pattern = tree.nodes.new("ShaderNodeTexNoise")
    pattern.inputs["Scale"].default_value = 0.11
    pattern.inputs["Detail"].default_value = 0.0
    tree.links.new(tree.nodes.new("ShaderNodeNewGeometry").outputs["Position"], pattern.inputs["Vector"])
    occupied = mask(pattern.outputs["Fac"], [(0.34, 0.09), (0.63, 1)], "Variation between occupied bays")
    value = glass
    for factor in (bands, occupied, 2.5):
        node = tree.nodes.new("ShaderNodeMath")
        node.operation = "MULTIPLY"
        tree.links.new(value, node.inputs[0])
        if isinstance(factor, float):
            node.inputs[1].default_value = factor
        else:
            tree.links.new(factor, node.inputs[1])
        value = node.outputs[0]
    tree.links.new(albedo, surface.inputs["Emission Color"])
    tree.links.new(value, surface.inputs["Emission Strength"])
    for inst in targets:
        inst.instance_collection = local
    return len(targets)


def plaza_lighting(group):
    # Grazing light gives the black Nexus pilasters and the council portico a readable front at dusk.
    for side in (-1, 1):
        area(
            group,
            None,
            "Dusk | Nexus plinth uplight",
            (side * 4.25, -2.72, 0.94),
            (side * 3.3, 4.25, 9.1),
            (1.15, 0.27),
            400,
            (1, 0.72, 0.42),
        )
        area(
            group,
            None,
            "Dusk | council portico uplight",
            (side * 7.2, 81.9, 0.52),
            (side * 6.20, 85.50, 6.6),
            (1.10, 0.31),
            530,
            (1, 0.76, 0.47),
        )
    # Submerged jet lighting is local to the three basins. The lake retains the reflected sky.
    for jet, strength in (("MAT_CIVIC_Jet", 0.75), ("MAT_CIVIC_Fountain", 0.41)):
        shader(bpy.data.materials[jet]).inputs["Emission Strength"].default_value = strength
    for pool in (o for o in bpy.context.scene.objects if o.name.startswith("Civic reflecting pool")):
        count = max(1, round(pool.dimensions.y / 6))
        for i in range(count):
            y = (i - (count - 1) / 2) * 5.1
            area(
                group,
                pool,
                "Dusk | basin jet wash",
                (0.68, y, 0.60),
                (0, y, 1.54),
                (0.15, 0.15),
                26,
                (0.46, 0.82, 1),
            )


def gold_accents(scene):
    # Retain the blue upper sky, lake material and cool water lights. Change the practicals by use.
    lights = {
        "Dusk | canopy downlight": ((1, 0.65, 0.27), 1.18),
        "Dusk | fascia wash": ((1, 0.77, 0.42), 1.13),
        "Dusk | rear display": ((1, 0.66, 0.32), 1.10),
        "Dusk | rooflight well": ((1, 0.68, 0.29), 1.12),
        "Dusk | council portico uplight": ((1, 0.70, 0.32), 1.32),
        "Dusk | Nexus plinth uplight": ((1, 0.71, 0.25), 1.40),
    }
    # One shared light data-block per street fixture style, updated once per style.
    for data in bpy.data.lights:
        if data.library:
            continue
        key = data.name.partition(".")[0]
        if key in lights:
            data.color, gain = lights[key]
            data.energy *= gain
        elif key.startswith("Dusk | CIVRUM_Street_PROP_STREETLIGHT_"):
            data.color = (1, 0.70, 0.34)
    for obj in bpy.data.objects["Shop 40 | Ground centre"].children:
        if obj.type == "LIGHT" and obj.name.startswith("Shop 40 |"):
            r, g, b = obj.data.color
            obj.data.color = (r, g * 0.97, b * 0.80)

    def gold_finish(name, base, light, strength):
        surface = shader(bpy.data.materials[name])
        if base:
            surface.inputs["Base Color"].default_value = color(base)
        surface.inputs["Emission Color"].default_value = color(light)
        surface.inputs["Emission Strength"].default_value = strength

    gold_finish("MAT_SHOP_Brass", "DCB761", "FFD179", 0.16)
    gold_finish("MAT_SHOP_Opal", None, "FFD29A", 4.8)
    gold_finish("Dusk | warm street lantern glass", None, "FFD594", 6.2)
    # Use a separate finish for the city accents rather than changing every object using brass.
    trim = bpy.data.materials["MAT_CIVIC_Brass"].copy()
    trim.name = "Civic | architectural gold trim"
    gold_finish(trim.name, "F0B90B", "FFD06E", 0.29)
    ribbon = bpy.data.materials["MAT_CIVIC_Light"].copy()
    ribbon.name = "Civic | amber guide lens"
    gold_finish(ribbon.name, "F0B90B", "FFD06A", 3.1)
    nexus = bpy.data.materials["MAT_TECH_YELLOW"].copy()
    nexus.name = "Nexus | saffron crown"
    gold_finish(nexus.name, "F0B90B", "FFD277", 0.34)
    for obj in scene.objects:
        if obj.name.startswith(
            (
                "Nexus | boulevard guides",
                "Nexus | stone and brass compass",
                "Nexus | south entry markers",
                "Civic setback office ",
            )
        ):
            for slot in obj.material_slots:
                if slot.material.name in {"MAT_CIVIC_Brass", "MAT_CIVIC_Light"}:
                    finish = trim if slot.material.name == "MAT_CIVIC_Brass" else ribbon
                    slot.link, slot.material = "OBJECT", finish
    for slot in scene.objects["CIVRUM_PH_CENTRAL_NEXUS"].material_slots:
        if slot.material.name == "MAT_TECH_YELLOW":
            slot.link, slot.material = "OBJECT", nexus


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", action="store_true")
    parser.add_argument("--views", nargs="+", choices=CAMERAS, default=[])
    parser.add_argument("--draft", type=Path)
    parser.add_argument("--device", choices=("CPU", "CUDA"), default="CPU")
    parser.add_argument(
        "--gold", action="store_true", help="Render the warmer graphite and gold dusk variant"
    )
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    bpy.ops.wm.open_mainfile(filepath=str(SHOP_WORLD))
    scene = bpy.context.scene
    group = collection(bpy.data.collections["CIVRUM_WORLD"], "18 | Dusk practical lighting")
    evening_sky(scene, args.gold)
    shop_lights(group)
    street_lights(scene, group)
    plaza_lighting(group)
    shops = garden_windows(scene)
    for name, strength in (
        ("MAT_CIVIC_Amber_Glass", 1.75),
        ("MAT_CIVIC_Sky_Glass", 0.17),
        ("LAKE_Lantern lens", 4.5),
    ):
        shader(bpy.data.materials[name]).inputs["Emission Strength"].default_value = strength
    if args.gold:
        gold_accents(scene)
    version = "Gold_Dusk" if args.gold else "Dusk"
    destination = OUTPUT / "CIVRUM_World_300m_Gold_Dusk.blend" if args.gold else DEST
    scene.frame_set(120)
    scene.camera = bpy.data.objects[CAMERAS["street"]]
    scene.render.filepath = f"//renders/CIVRUM_{version}_Street.png"
    if args.save:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(destination), compress=True)
        bpy.ops.wm.open_mainfile(filepath=str(destination))
        scene = bpy.context.scene
    lamps = [o for o in scene.objects if o.name.startswith("Dusk pool |")]
    assert len(lamps) == 99 and all(o.parent and o.type == "LIGHT" for o in lamps)
    assert len({o.data for o in lamps}) == 3
    retail = bpy.data.collections["Dusk | occupied garden retail"]
    assert shops == 28 == sum(o.instance_collection == retail for o in scene.objects)
    assert all(not lib.is_missing and lib.filepath.startswith("//") for lib in bpy.data.libraries)
    if args.gold:
        path_light = bpy.data.materials["Civic | amber guide lens"]
        guides = [o for o in scene.objects if o.name.startswith("Nexus | boulevard guides")]
        assert guides and all(any(slot.material == path_light for slot in o.material_slots) for o in guides)
        target_gold = color("F0B90B")
        metal = shader(bpy.data.materials["Nexus | saffron crown"]).inputs["Base Color"].default_value
        assert max(abs(a - b) for a, b in zip(metal, target_gold, strict=True)) < 1e-5
    print(
        f"DUSK OK: {shops} retail instances, {len(lamps)} street lanterns, six existing shop lights.",
        flush=True,
    )
    if args.device == "CUDA":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "CUDA"
        prefs.refresh_devices()
        assert any(d.type == "CUDA" for d in prefs.devices)
        for device in prefs.devices:
            device.use = device.type == "CUDA"
        scene.cycles.device = "GPU"
    output = args.draft or OUTPUT / "renders"
    output.mkdir(parents=True, exist_ok=True)
    for key in args.views:
        width = 960 if args.draft else 2560 if key == "overview" else 1920
        render(
            scene,
            bpy.data.objects[CAMERAS[key]],
            output / f"CIVRUM_{version}_{key.title()}.png",
            width,
            bool(args.draft),
        )


if __name__ == "__main__":
    main()
