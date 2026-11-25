"""Refine the public construction centre using its linked original Tripo mesh."""

import argparse
import math
import sys
from itertools import pairwise
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_civrum_lakeside import material
from build_civrum_world import Geometry, circle
from build_nexciv_facades import GOVERNANCE_HALL, council_hall, finishes, fit_mesh
from civrum_lakeside_landmarks import place_agent_center
from detail_civrum_world import rod
from refine_nexciv_registry import refine_registry
from refine_nexciv_works_railing import fit_curved_railing

STUDY = Path(__file__).resolve().parents[1] / "art-direction/world-upgrade-v1/lakeside-study"
WORLD = STUDY / "NEXCIV_World_300m_Facades.blend"
WORKS = "HERO_04_Public_Construction"
OLD_ROOF = ("Public works | geometric glass dome", "Public works | roof planters and pavers")
REVEALS = "Vestibule | recessed bronze returns"
ROOF_DETAILS = "Public works | fitted roof details"


def fit_roof_details(scene, body):
    if scene.objects.get(ROOF_DETAILS):
        return
    bpy.context.view_layer.update()
    inverse = body.matrix_world.inverted()
    down = inverse.to_3x3() @ Vector((0, 0, -1))

    def roof_height(x, y):
        hit, point, *_ = body.ray_cast(inverse @ Vector((x, y, 20)), down, distance=16)
        if not hit:
            raise RuntimeError(f"No construction centre roof at {(x, y)}")
        return (body.matrix_world @ point).z

    finishes = (
        ("Works Roof Bronze", "987450", .43, .62),
        ("Works Roof Patinated Joints", "756758", .61, .27),
        ("Works Roof Brass Fasteners", "BA935D", .38, .66),
    )
    palette = tuple((name,) for name, *_ in finishes)
    for name, tint, roughness, metal in finishes:
        if "MAT_" + name not in bpy.data.materials:
            material("MAT_" + name, tint, roughness, metal)

    detail = Geometry()
    center = Vector((99.28, -81.00))

    def crown_edge(direction):
        # The roof cap is irregular. Follow the measured drop to the glazed drum at each angle.
        low, high = .75, 1.65
        for _ in range(10):
            radius = (low + high) / 2
            if roof_height(*(center + direction * radius)) > 13.45:
                low = radius
            else:
                high = radius
        return low

    sectors = 64
    perimeter = []
    for index in range(sectors):
        theta = index * math.tau / sectors
        direction = Vector((math.cos(theta), math.sin(theta)))
        distance = crown_edge(direction)
        perimeter.append((direction, distance))
        for inset, offset in ((.024, -.012), (.024, .030), (.092, .030), (.092, -.012)):
            x, y = center + direction * (distance - inset)
            detail.verts.append((x, y, roof_height(x, y) + offset))
    for index in range(sectors):
        a, b = index * 4, ((index + 1) % sectors) * 4
        for side in range(4):
            following = (side + 1) % 4
            detail.face((a + side, b + side, b + following, a + following), 0)

    def crown_point(direction, radius):
        x, y = center + direction * radius
        return (x, y, roof_height(x, y) + .013)

    for direction, distance in perimeter[::8]:
        seam = [crown_point(direction, .31 + (distance - .46) * step / 8) for step in range(9)]
        for first, second in pairwise(seam):
            rod(detail, first, second, .017, 1, sides=4)
        x, y, z = crown_point(direction, distance - .12)
        detail.slab(circle(.039, 8, x, y), z, z + .029, 2)

    # Fit hardware directly onto the original rectangular service hatch.
    hatch = ((85.73, -85.58), (87.60, -85.58), (87.72, -83.92), (85.73, -83.92))
    for start, end in pairwise((*hatch, hatch[0])):
        segment = [Vector(start).lerp(Vector(end), index / 12) for index in range(13)]
        points = [(x, y, roof_height(x, y) + .022) for x, y in segment]
        for first, second in pairwise(points):
            rod(detail, first, second, .029, 0, sides=4)
    for x in (86.13, 87.26):
        y = -85.48
        z = roof_height(x, y)
        detail.box(x, y, z + .014, .22, .16, .052, 0, .018)
        rod(detail, (x - .12, y, z + .07), (x + .12, y, z + .07), .031, 2, sides=8)
    for x in (86.47, 86.86):
        y = -84.14
        z = roof_height(x, y)
        detail.box(x, y, z, .076, .10, .086, 0, .013)
    rod(detail, (86.47, -84.14, 8.86), (86.86, -84.14, 8.86), .029, 2, sides=8)

    # Clean two visible lengths of the existing handrail where its top is unobstructed by the crane.
    for start, end in ((-84.55, -82.67), (-81.20, -79.80)):
        x = 84.60
        points = []
        for index in range(9):
            y = start + (end - start) * index / 8
            height = roof_height(x, y)
            if not 9.15 < height < 9.39:
                raise RuntimeError(f"Construction centre railing no longer aligns at {(x, y)}")
            points.append((x, y, height + .016))
        for first, second in pairwise(points):
            rod(detail, first, second, .039, 2, sides=8)

    mesh = detail.mesh(ROOF_DETAILS, palette)
    mesh.transform(inverse)
    obj = bpy.data.objects.new(ROOF_DETAILS, mesh)
    body.users_collection[0].objects.link(obj)
    obj.parent = body


def refine_public_works(scene, *, roof_details=False):
    body = scene.objects[WORKS]
    body.material_slots[0].link = "DATA"
    for name in OLD_ROOF:
        obj = scene.objects.get(name)
        if obj is not None:
            obj.hide_render = obj.hide_viewport = True

    if not scene.objects.get(REVEALS):
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
    if roof_details:
        fit_roof_details(scene, body)
    fit_curved_railing(scene, body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    if args.output.resolve() == WORLD.resolve():
        parser.error("Choose a separate path for the public works revision")
    bpy.ops.wm.open_mainfile(filepath=str(WORLD))
    refine_public_works(bpy.context.scene, roof_details=True)
    refine_registry(bpy.context.scene)
    place_agent_center(bpy.context.scene)
    hall = bpy.context.scene.objects[GOVERNANCE_HALL]
    finishes()
    doors_revision = council_hall(True)
    fit_mesh(doors_revision, hall)
    hall.data = doors_revision
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output.resolve()))


if __name__ == "__main__":
    main()
