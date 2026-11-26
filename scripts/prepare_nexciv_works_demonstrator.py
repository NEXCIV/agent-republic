"""Prepare the user's robotics station for the Works forecourt."""

import argparse
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

OBJECT = "WORKS_Robotics_Demonstrator"
TRIANGLE_TARGET = 64000
TEXTURE_SIZE = 2048
# Registered against the existing scene object in Blender coordinates.
LOCAL_ROTATION = 157
LOCAL_SCALE = (3.571356, 3.573723, 3.573991)
LOCAL_OFFSET = (-.001888, -.000129, 0)


def prepare(source, output):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source.resolve()), merge_vertices=True)
    objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(objects) != 1:
        raise ValueError("Expected one robotics station mesh")
    obj = objects[0]
    obj.name = OBJECT
    obj.data.name = OBJECT
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)

    modifier = obj.modifiers.new("Forecourt detail budget", "DECIMATE")
    modifier.ratio = min(1, TRIANGLE_TARGET / len(obj.data.polygons))
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    transform = (
        Matrix.Translation(Vector(LOCAL_OFFSET))
        @ Matrix.Diagonal((*LOCAL_SCALE, 1))
        @ Matrix.Rotation(math.radians(LOCAL_ROTATION), 4, "Z")
    )
    obj.data.transform(transform)
    obj.data.validate(clean_customdata=False)
    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    obj.data.set_sharp_from_angle(angle=math.radians(49))

    material = obj.data.materials[0]
    nodes = material.node_tree.nodes
    for node in nodes:
        if node.type == "NORMAL_MAP":
            node.inputs["Strength"].default_value = .55
        if node.type != "TEX_IMAGE" or node.image is None:
            continue
        image = node.image
        image.scale(TEXTURE_SIZE, TEXTURE_SIZE)
        if image.name.endswith("_rm.jpg"):
            # Preserve the source variations while tempering mirror-like highlights.
            pixels = np.empty(TEXTURE_SIZE * TEXTURE_SIZE * 4, dtype=np.float32)
            image.pixels.foreach_get(pixels)
            channels = pixels.reshape((-1, 4))
            channels[:, 1] = .39 + channels[:, 1] * .46
            channels[:, 2] *= .66
            image.pixels.foreach_set(pixels)
        image.pack()

    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output.resolve()), compress=True)
    obj.data.calc_loop_triangles()
    print(f"WORKS DEMONSTRATOR: {len(obj.data.loop_triangles):,} triangles, {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    prepare(**vars(parser.parse_args(sys.argv[sys.argv.index("--") + 1:])))
