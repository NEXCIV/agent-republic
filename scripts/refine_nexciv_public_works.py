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
ENTRANCE_DETAILS = "Public works | entrance detail"


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


def fit_entrance_details(scene, body):
    if scene.objects.get(ENTRANCE_DETAILS):
        return
    finishes = (
        ("Works Interior Plaster", "9B8D76", .79, 0, 0),
        ("Works Entrance Bronze", "514638", .42, .58, 0),
        ("Works Drafting Board", "204449", .55, .08, 0),
        ("Works Plan Lines", "ADD3C9", .61, 0, .22),
        ("Works Warm Strip", "F2DEB0", .48, 0, .65),
        ("Works Desk Enamel", "3C5955", .62, .14, 0),
    )
    for name, color, roughness, metallic, emission in finishes:
        if "MAT_" + name not in bpy.data.materials:
            material("MAT_" + name, color, roughness, metallic, emission)
    palette = tuple((name,) for name, *_ in finishes)
    detail = Geometry()
    # Fit a small vestibule display behind the existing glass and reception desk.
    for x in (93.23, 96.57):
        detail.box(x, -78.67, 1.23, .08, .10, 2.19, 1, .011)
    detail.box(94.90, -78.74, 1.24, 3.28, .09, 2.17, 0, .012)
    detail.box(94.90, -78.67, 1.24, 3.26, .035, .19, 1, .006)
    detail.box(94.90, -78.67, 1.93, 3.20, .047, .052, 1, .009)
    detail.box(94.90, -78.64, 2.12, 2.56, .060, 1.00, 1, .024)
    detail.box(94.90, -78.60, 2.17, 2.43, .027, .89, 2, .014)
    for x, z, w in ((94.37, 2.86, 1.25), (94.21, 2.77, .93),
                     (95.75, 2.91, .45), (95.75, 2.81, .45), (95.74, 2.71, .43)):
        detail.box(x, -78.58, z, w, .009, .016, 3)
    for x, start, width, height in (
        (94.17, 2.30, .27, .28), (94.49, 2.30, .29, .40), (94.83, 2.30, .29, .33), (95.16, 2.30, .24, .23),
    ):
        for dx in (-width * .5, width * .5):
            detail.box(x + dx, -78.58, start, .015, .009, height, 3)
        detail.box(x, -78.58, start + height, width, .009, .016, 3)
    detail.box(94.64, -78.58, 2.29, 1.40, .009, .016, 3)
    detail.box(94.90, -78.56, 3.23, 2.45, .042, .023, 4, .008)

    detail.box(96, -77.976, 1.31, .83, .035, .64, 5, .017)
    detail.box(96, -77.946, 1.38, .83, .017, .030, 1, .006)
    for x in (95.68, 95.84, 96.0, 96.16, 96.32):
        detail.box(x, -77.947, 1.48, .012, .024, .44, 1, .004)

    # Align the terminal bezels to the depth of the two original kiosk faces.
    inverse = body.matrix_world.inverted()
    front_ray = inverse.to_3x3() @ Vector((0, -1, 0))
    for x in (91.26, 98.67):
        z = 2.42
        hit, point, *_ = body.ray_cast(inverse @ Vector((x, -72.5, z)), front_ray)
        y = (body.matrix_world @ point).y if hit else 0
        if not -75.80 < y < -75.30:
            raise RuntimeError(f"Construction centre terminal no longer aligns at {x}")
        detail.box(x, y + .032, z - .17, .445, .087, .38, 1, .021)
        detail.box(x, y + .081, z - .126, .36, .025, .29, 2, .012)
        for offset, width in ((.027, .211), (-.023, .164)):
            detail.box(x, y + .095, z + offset, width, .006, .012, 3)
        detail.box(x + .119, y + .095, z - .082, .025, .006, .022, 4, .005)

    mesh = detail.mesh(ENTRANCE_DETAILS, palette)
    mesh.transform(inverse)
    obj = bpy.data.objects.new(ENTRANCE_DETAILS, mesh)
    body.users_collection[0].objects.link(obj)
    obj.parent = body


def refine_public_works(scene, *, roof_details=False, entrance_details=False):
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
    if entrance_details:
        fit_entrance_details(scene, body)
    fit_curved_railing(scene, body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    if args.output.resolve() == WORLD.resolve():
        parser.error("Choose a separate path for the public works revision")
    bpy.ops.wm.open_mainfile(filepath=str(WORLD))
    refine_public_works(bpy.context.scene, roof_details=True, entrance_details=True)
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
