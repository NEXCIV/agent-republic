"""Assemble the six shipped GLBs into an editable, offline art-review scene.

From the repository root, run Blender in background mode with
--factory-startup --python-exit-code 1 --python tools/blender/build_district_preview.py.
The two scale figures and the completed project stage are DEMO poses.
"""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "apps/web/public/world/district-01/v1"
OUTPUT = ROOT / "tools/blends"
STEM = "district-01-demo"


def import_asset(file, collection, position=(0, 0, 0)):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ASSETS / file))
    objects = set(bpy.data.objects) - before
    roots = [obj for obj in objects if obj.parent is None]
    if len(roots) != 1:
        raise ValueError(f"{file} has {len(roots)} roots, expected one")
    for obj in objects:
        for previous in list(obj.users_collection):
            previous.objects.unlink(obj)
        collection.objects.link(obj)
    roots[0].location += Vector(position)
    return roots[0]


def review_collection(label):
    collection = bpy.data.collections.new(label)
    bpy.context.scene.collection.children.link(collection)
    return collection


def add_scale_figures():
    figures = review_collection("DEMO · human scale")
    for label, location, heading, white_hair in (
        ("Bridge approach", (-0.55, -16.2, 0.017), 166, True),
        ("Plaza approach", (1.55, -3.6, 0.031), -22, False),
    ):
        # Offline scale figures use the same hair options as the web instances.
        source = bpy.data.collections.new(label + " model")
        root = import_asset("agent-citizen.glb", source)
        if white_hair:
            hair = next(obj for obj in root.children if obj.name.split(".")[0] == "hair")
            hair.data.shape_keys.key_blocks["SideSweep"].value = .3
            color = tuple(((v / 255 + .055) / 1.055)**2.4 for v in (239, 234, 247))
            mix = hair.data.materials[0].node_tree.nodes["Mix"]
            next(i for i in mix.inputs if i.type == "RGBA" and not i.is_linked).default_value = (*color, 1)
        figure = bpy.data.objects.new(label, None)
        figure.instance_type = "COLLECTION"
        figure.instance_collection = source
        figure.location = location
        figure.rotation_euler.z = math.radians(heading)
        figures.objects.link(figure)


def setup_daylight(scene, studio):
    world = bpy.data.worlds.new("Daylight over District 01")
    scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    link = world.node_tree.links.new
    ambient = nodes.get("Background")
    ambient.inputs["Color"].default_value = (0.73, 0.85, 1, 1)
    ambient.inputs["Strength"].default_value = 0.48

    # Screen-height gradient behind the floating island, independent of its light.
    window = nodes.new("ShaderNodeTexCoord")
    xyz = nodes.new("ShaderNodeSeparateXYZ")
    link(window.outputs["Window"], xyz.inputs[0])
    sky = nodes.new("ShaderNodeValToRGB")
    sky.color_ramp.elements[0].color = (0.43, 0.72, 0.87, 1)
    sky.color_ramp.elements[1].color = (0.12, 0.31, 0.53, 1)
    link(xyz.outputs["Y"], sky.inputs["Fac"])
    backdrop = nodes.new("ShaderNodeBackground")
    link(sky.outputs["Color"], backdrop.inputs["Color"])
    mix = nodes.new("ShaderNodeMixShader")
    link(nodes.new("ShaderNodeLightPath").outputs["Is Camera Ray"], mix.inputs[0])
    link(ambient.outputs[0], mix.inputs[1])
    link(backdrop.outputs[0], mix.inputs[2])
    link(mix.outputs[0], nodes.get("World Output").inputs["Surface"])

    sun = bpy.data.lights.new("Morning sun", "SUN")
    sun.energy = 2.25
    sun.angle = math.radians(10)
    sun.color = (1, 0.89, 0.72)
    lamp = bpy.data.objects.new(sun.name, sun)
    studio.objects.link(lamp)
    lamp.location = (-22, -28, 36)
    lamp.rotation_euler = (-lamp.location).to_track_quat("-Z", "Y").to_euler()


def setup_camera(scene, studio):
    data = bpy.data.cameras.new("Entrance view")
    camera = bpy.data.objects.new(data.name, data)
    studio.objects.link(camera)
    target = Vector((0, 0, 0))
    view = json.loads((ROOT / "apps/web/src/features/world-3d/entrance-view.json").read_text())
    pos = view["offset"]
    offset = Vector((pos["x"], -pos["z"], pos["y"]))
    camera.location = target + offset
    camera.rotation_euler = (-offset).to_track_quat("-Z", "Y").to_euler()
    data.type = "ORTHO"
    width, height = scene.render.resolution_x, scene.render.resolution_y
    pixels_per_metre = min(width / view["minWidth"], height / view["minHeight"], view["maxZoom"])
    data.ortho_scale = max(width, height) / pixels_per_metre
    scene.camera = camera
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.region_3d.view_perspective = "CAMERA"
                area.spaces.active.overlay.show_overlays = False
                area.spaces.active.shading.color_type = "MATERIAL"


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "District 01 · DEMO art review"
scene["review_stage"] = "DEMO — completed silhouette and two figures for visual scale"
city = review_collection("District 01")
import_asset("environment.glb", city)
layout = json.loads((ROOT / "examples/scene-manifest.demo.json").read_text(encoding="utf-8"))
for landmark in layout["manifest"]["landmarks"]:
    name = landmark["id"]
    if name == "PLAZA":  # Already part of the environment.
        continue
    x, height, z = landmark["position"]
    root = import_asset(f"{name.lower()}.glb", city, (x, -z, height))
    if name == "PROJECT":
        for group in root.children_recursive:
            if group.name.startswith("stage_") and group.name != "stage_complete":
                for obj in [group, *group.children_recursive]:
                    obj.hide_viewport = True
                    obj.hide_render = True

add_scale_figures()
studio = review_collection("Art review camera and light")
setup_daylight(scene, studio)
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 5
scene.render.resolution_x = 1500
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
setup_camera(scene, studio)
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = f"//{STEM}.png"
scene.view_settings.view_transform = "AgX"
bpy.ops.object.select_all(action="DESELECT")
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / f"{STEM}.blend"))
bpy.ops.render.render(write_still=True)
