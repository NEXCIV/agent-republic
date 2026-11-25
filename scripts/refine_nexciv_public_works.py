"""Refine the public construction centre using its linked original Tripo mesh."""

import argparse
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_world import Geometry

STUDY = Path(__file__).resolve().parents[1] / "art-direction/world-upgrade-v1/lakeside-study"
WORLD = STUDY / "NEXCIV_World_300m_Facades.blend"
WORKS = "HERO_04_Public_Construction"
OLD_ROOF = ("Public works | geometric glass dome", "Public works | roof planters and pavers")
REVEALS = "Vestibule | recessed bronze returns"


def refine_public_works(scene):
    body = scene.objects[WORKS]
    body.material_slots[0].link = "DATA"
    for name in OLD_ROOF:
        obj = scene.objects.get(name)
        if obj is not None:
            obj.hide_render = obj.hide_viewport = True

    if scene.objects.get(REVEALS):
        return
    # The source already has a deep entrance. Frame its opening behind the existing clear panes.
    reveal = Geometry()
    for x in (93.15, 96.65):
        reveal.box(x, -76.95, 1.27, .075, .53, 2.15, 0, .014)
    reveal.box(94.90, -76.95, 3.42, 3.57, .53, .046, 0, .014)
    reveal.box(94.90, -76.84, 1.205, 3.56, .40, .038, 0, .014)
    mesh = bpy.data.meshes.new(REVEALS)
    mesh.from_pydata(reveal.verts, [], reveal.faces)
    mesh.materials.append(bpy.data.materials["Walkthrough | patinated bronze"])
    mesh.update()
    obj = bpy.data.objects.new(REVEALS, mesh)
    bpy.data.collections["02 | Public Works at eye level"].objects.link(obj)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    if args.output.resolve() == WORLD.resolve():
        parser.error("Choose a separate path for the public works revision")
    bpy.ops.wm.open_mainfile(filepath=str(WORLD))
    refine_public_works(bpy.context.scene)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output.resolve()))


if __name__ == "__main__":
    main()
