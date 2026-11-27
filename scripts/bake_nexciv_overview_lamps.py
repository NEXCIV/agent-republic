"""Project the authored street lamps onto a linear irradiance map for the city overview."""

from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MASTER = (
    ROOT / "art-direction/world-upgrade-v1/lakeside-study/NEXCIV_World_300m_Roads.blend"
)
DEST = ROOT / "apps/web/public/nexciv-walk/overview-lamp-wash.png"
SIZE = 512
SPAN = 352.0


def main():
    bpy.ops.wm.open_mainfile(filepath=str(MASTER))
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
    rgba[:, :, :3] = 1.0 - np.exp(-irradiance[:, :, None])
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = str(DEST)
    image.file_format = "PNG"
    image.save()
    print(
        f"Baked {len(lamps)} street lights into {DEST.name} ({DEST.stat().st_size} bytes)"
    )


if __name__ == "__main__":
    main()
