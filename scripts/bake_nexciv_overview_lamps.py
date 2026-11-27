"""Bake road light, shop spill and shop ceiling height into a linear RGB atlas."""

import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_corner_market import PODIUM
from export_nexciv_walk_preview import (
    BILLBOARD_COMMERCIAL,
    GARDEN_RETAIL,
    SOURCE,
    world_geometry,
)

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "apps/web/public/nexciv-walk/overview-lamp-wash.png"
SIZE = 512
SPAN = 352.0
HEIGHT_RANGE = 8.0


def storefronts():
    """Use the exporter's visible placements, including instances rotated at street corners."""
    graph = bpy.context.evaluated_depsgraph_get()
    for obj, matrix, _ in world_geometry(bpy.context.scene, graph, "citywide"):
        name = obj.original.name
        if name.startswith((GARDEN_RETAIL, BILLBOARD_COMMERCIAL)):
            low, high = Vector(obj.bound_box[0]), Vector(obj.bound_box[6])
            center = (low + high) * 0.5
            width, depth = high.x - low.x, high.y - low.y
            door = (center.x, low.y)
            normal = (0, -1)
            front_bays = 3 if name.startswith(GARDEN_RETAIL) else 5
            # Floor slab height relative to the fitted retail or midrise master.
            ceiling = low.z + (high.z - low.z) * (
                0.44 if name.startswith(GARDEN_RETAIL) else 0.23
            )
        elif name.startswith("Market | Level 0.13 recessed glazing"):
            center = Vector((0, 0))
            width, depth, ceiling = 13.5, 11.6, 3.8
            front_bays = 3
            door = (Vector(PODIUM[-1]) + Vector(PODIUM[0])) * 0.5
            normal = (-1, -1)
        elif name.startswith("Shop 40 | Entrance portal"):
            center = Vector((0, 0))
            width, depth, ceiling = 14.0, 10.0, 3.43
            front_bays = 3
            door, normal = (0, -5.6), (0, -1)
        else:
            continue
        origin = matrix @ Vector((center.x, center.y, ceiling))
        entry = matrix @ Vector((*door, 0))
        basis = matrix.to_3x3()
        along = basis @ Vector((1, 0, 0))
        across = basis @ Vector((0, 1, 0))
        outward = (basis @ Vector((*normal, 0))).normalized()
        yield (
            origin,
            width * along.length,
            depth * across.length,
            along.normalized(),
            entry,
            outward,
            front_bays,
        )


def shop_channels(axis):
    spill = np.zeros((SIZE, SIZE), dtype=np.float32)
    ceilings = np.zeros_like(spill)
    count = 0
    for origin, width, depth, along, entry, outward, front_bays in storefronts():
        dx, dy = axis[None, :] - origin.x, axis[:, None] - origin.y
        u, v = dx * along.x + dy * along.y, -dx * along.y + dy * along.x
        edge_x, edge_y = np.abs(u) - width / 2, np.abs(v) - depth / 2
        footprint = np.maximum(edge_x, edge_y)
        np.maximum(
            ceilings,
            np.clip(2.5 - footprint, 0, 1) * origin.z / HEIGHT_RANGE,
            out=ceilings,
        )
        # Light escaping the display bays is softer than the downlights under the entrance canopy.
        end_wall = edge_x > edge_y
        along_wall = np.where(end_wall, np.where(u > 0, v, -v), np.where(v < 0, u, -u))
        side = np.where(end_wall, np.where(u > 0, 1, 3), np.where(v < 0, 0, 2))
        bays = np.where(end_wall, 3, front_bays)
        bay = np.clip(
            (along_wall / np.where(end_wall, depth, width) + 0.5) * bays,
            0,
            bays - 0.001,
        )
        # Match the alternating window bays of the façade generator; piers receive less spill.
        lit = np.where((np.floor(bay) + side) % 4 == 0, 0.12, 1.0)
        display = (
            np.exp(-0.35 * footprint**2)
            * lit
            * (0.22 + 0.78 * np.sin(np.pi * bay) ** 2)
        )
        dx, dy = axis[None, :] - entry.x, axis[:, None] - entry.y
        front = dx * outward.x + dy * outward.y
        across_door = -dx * outward.y + dy * outward.x
        door_pool = np.exp(-(((front - 0.6) / 2.9) ** 2) - (across_door / 2.95) ** 2)
        spill += 1.55 * door_pool + 0.83 * display
        count += 1
    if not count:
        raise ValueError("No exported storefronts found")
    return 1.0 - np.exp(-spill), ceilings, count


def main():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    lamps = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "LIGHT"
        and obj.name.startswith("Dusk pool |")
        and not obj.hide_render
    ]
    if not lamps:
        raise ValueError("No dusk street lamps in the lakeside master")

    # Texel centres in Blender metres. In the web renderer the second axis is -world Z.
    axis = ((np.arange(SIZE, dtype=np.float32) + 0.5) / SIZE - 0.5) * SPAN
    irradiance = np.zeros((SIZE, SIZE), dtype=np.float32)
    for lamp in lamps:
        x, y, height = lamp.matrix_world.translation
        h = max(height - 0.17, 0.65)
        r2 = (axis[None, :] - x) ** 2 + (axis[:, None] - y) ** 2
        # Lambertian receiver below a downlight, feathered before the next pool of light.
        falloff = (h * h / (h * h + r2)) ** 2
        irradiance += (lamp.data.energy / (h * h * 4.0)) * falloff

    image = bpy.data.images.new(
        "West-east street irradiance",
        width=SIZE,
        height=SIZE,
        alpha=False,
        is_data=True,
    )
    rgba = np.ones((SIZE, SIZE, 4), dtype=np.float32)
    rgba[:, :, 0] = 1.0 - np.exp(-irradiance)
    rgba[:, :, 1], rgba[:, :, 2], shops = shop_channels(axis)
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = str(DEST)
    image.file_format = "PNG"
    image.save()
    print(
        f"Baked {len(lamps)} street lights and {shops} storefronts into {DEST.name} ({DEST.stat().st_size} bytes)"
    )


if __name__ == "__main__":
    main()
