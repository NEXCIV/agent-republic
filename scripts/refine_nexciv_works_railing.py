"""Fit a level handrail to the construction centre's existing curved terrace."""

import math
from bisect import bisect_right
from itertools import pairwise

import bpy
from build_civrum_lakeside import material
from build_civrum_world import Geometry, circle
from mathutils import Vector

RAILING = "Public works | curved terrace railing"
RAILING_MASK = "Public works | original railing cut"
TOP = 7.83
RADIUS = .047
# Measured along the original rail on the outside of the sail and large dome.
CURVE = (
    (95.57, -87.14), (95.75, -87.37), (96.00, -87.66), (96.25, -87.84), (96.50, -87.94),
    (96.75, -87.98), (97.25, -88.02), (97.75, -87.97), (98.25, -87.91), (98.75, -87.84),
    (99.25, -87.77), (99.75, -87.69), (100.25, -87.60), (100.75, -87.46), (101.25, -87.30),
    (101.75, -87.12), (102.25, -86.94), (102.75, -86.78), (103.25, -86.62), (103.41, -86.56),
)


def rail_y(x):
    index = min(len(CURVE) - 2, max(0, bisect_right(CURVE, (x, math.inf)) - 1))
    x0, y0 = CURVE[index]
    x1, y1 = CURVE[index + 1]
    distance = x1 - x0
    t = (x - x0) / distance
    left = CURVE[max(0, index - 1)]
    right = CURVE[min(len(CURVE) - 1, index + 2)]
    m0 = distance * (y1 - left[1]) / (x1 - left[0])
    m1 = distance * (right[1] - y0) / (right[0] - x0)
    return y0 + t * (m0 + t * (3 * (y1 - y0) - 2 * m0 - m1 + t * (2 * (y0 - y1) + m0 + m1)))


def hide_distorted_rail(body, path):
    """Mask the original rail in place while preserving the linked mesh and its UVs."""
    inverse = body.matrix_world.inverted()
    vertices = [inverse @ Vector((x, y, body.location.z)) for x, y in path]
    guide_mesh = bpy.data.meshes.new(RAILING_MASK)
    guide_mesh.from_pydata(vertices, list(pairwise(range(len(vertices)))), [])
    guide = bpy.data.objects.new(RAILING_MASK, guide_mesh)
    guide.hide_render = True
    body.users_collection[0].objects.link(guide)
    guide.hide_set(True)

    graph = bpy.data.node_groups.new(RAILING_MASK, "GeometryNodeTree")
    for direction in ("INPUT", "OUTPUT"):
        graph.interface.new_socket(name="Geometry", in_out=direction, socket_type="NodeSocketGeometry")
    nodes, link = graph.nodes, graph.links.new
    original = nodes.new("NodeGroupInput")
    result = nodes.new("NodeGroupOutput")
    components = nodes.new("ShaderNodeSeparateXYZ")
    link(nodes.new("GeometryNodeInputPosition").outputs["Position"], components.inputs[0])
    projected = nodes.new("ShaderNodeCombineXYZ")
    for axis in ("X", "Y"):
        link(components.outputs[axis], projected.inputs[axis])
    source = nodes.new("GeometryNodeObjectInfo")
    source.inputs["Object"].default_value = guide
    proximity = nodes.new("GeometryNodeProximity")
    proximity.target_element = "EDGES"
    link(source.outputs["Geometry"], proximity.inputs["Geometry"])
    link(projected.outputs[0], proximity.inputs["Sample Position"])

    conditions = [proximity.outputs["Is Valid"]]
    for data, operation, threshold in (
        (proximity.outputs["Distance"], "LESS_THAN", .125),
        (components.outputs["Z"], "GREATER_THAN", 7.415 - body.location.z),
        (components.outputs["Z"], "LESS_THAN", 7.99 - body.location.z),
    ):
        compare = nodes.new("ShaderNodeMath")
        compare.operation = operation
        link(data, compare.inputs[0])
        compare.inputs[1].default_value = threshold
        conditions.append(compare.outputs[0])
    selected = conditions[0]
    for condition in conditions[1:]:
        intersection = nodes.new("FunctionNodeBooleanMath")
        intersection.operation = "AND"
        link(selected, intersection.inputs[0])
        link(condition, intersection.inputs[1])
        selected = intersection.outputs[0]

    cut = nodes.new("GeometryNodeDeleteGeometry")
    cut.domain = "POINT"
    link(original.outputs[0], cut.inputs["Geometry"])
    link(selected, cut.inputs["Selection"])
    link(cut.outputs[0], result.inputs[0])
    body.modifiers.new(RAILING_MASK, "NODES").node_group = graph


def fit_curved_railing(scene, body):
    if scene.objects.get(RAILING):
        return
    bpy.context.view_layer.update()
    inverse = body.matrix_world.inverted()
    start, end = CURVE[0][0], CURVE[-1][0]
    samples = (start + i * (end - start) / 100 for i in range(101))
    path = [(x, rail_y(x)) for x in samples]

    alloy = "Works Terrace Champagne Bronze"
    if "MAT_" + alloy not in bpy.data.materials:
        material("MAT_" + alloy, "C6AE7B", .46, .40)
    geometry = Geometry()
    sections = 12
    for index, (x, y) in enumerate(path):
        prev = Vector(path[max(index - 1, 0)])
        following = Vector(path[min(index + 1, len(path) - 1)])
        tangent = (following - prev).normalized()
        normal = Vector((-tangent.y, tangent.x))
        for side in range(sections):
            a = side * math.tau / sections
            xy = Vector((x, y)) + normal * (RADIUS * math.cos(a))
            geometry.verts.append((*xy, TOP - RADIUS + math.sin(a) * RADIUS))
    for index in range(len(path) - 1):
        a, b = sections * index, sections * (index + 1)
        for side in range(sections):
            following = (side + 1) % sections
            geometry.face((a + side, a + following, b + following, b + side), 0)
    geometry.face(tuple(range(sections - 1, -1, -1)), 0)
    geometry.face(tuple(range((len(path) - 1) * sections, len(path) * sections)), 0)

    down = inverse.to_3x3() @ Vector((0, 0, -1))
    for x in (95.78, 96.54, 97.35, 98.25, 99.15, 100.11, 101.03, 101.96, 102.78, 103.32):
        y = rail_y(x)
        # The original planting lip is uneven. Seat each upright into its own local support.
        support = []
        for offset in (0, .043, -.043, .085):
            hit, point, *_ = body.ray_cast(inverse @ Vector((x, y + offset, 7.405)), down, distance=.95)
            if hit:
                support.append((body.matrix_world @ point).z)
        if not support:
            raise RuntimeError(f"Missing terrace support under construction railing at {x:.2f} m")
        bottom = min(support) - .035
        geometry.slab(circle(.029, 8, x, y), bottom, TOP - RADIUS + .008, 0)

    mesh = geometry.mesh(RAILING, ((alloy,),))
    mesh.transform(inverse)
    for face in list(mesh.polygons)[:(len(path) - 1) * sections]:
        face.use_smooth = True
    obj = bpy.data.objects.new(RAILING, mesh)
    body.users_collection[0].objects.link(obj)
    obj.parent = body
    hide_distorted_rail(body, path)
