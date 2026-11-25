"""Fit the original registry to the deep forecourt and finish its three existing roof caps."""

from collections import defaultdict
from pathlib import Path

import bpy
from build_civrum_lakeside import material, shader
from civrum_lakeside_landmarks import REGISTRY, REGISTRY_BODY
from mathutils import Vector

BADGE = Path(__file__).resolve().parents[1] / "art-direction/world-upgrade-v1/lakeside-study/assets/registry-roof-badge.png"


def roof_surfaces(mesh):
    # The imported atlas splits vertices at UV seams. Match edges by position across those seams.
    positions = [tuple(round(value, 4) for value in vert.co) for vert in mesh.vertices]
    faces_by_edge = defaultdict(list)
    edges_by_face = {}
    for face in mesh.polygons:
        if face.center.z < 5.3 or face.normal.z < .70:
            continue
        edges = [tuple(sorted((positions[a], positions[b]))) for a, b in face.edge_keys]
        edges_by_face[face.index] = edges
        for edge in edges:
            faces_by_edge[edge].append(face.index)

    def connected(seed, cosine):
        stack = [seed]
        found = {seed}
        while stack:
            current = stack.pop()
            for edge in edges_by_face[current]:
                for neighbor in faces_by_edge[edge]:
                    if neighbor not in found and mesh.polygons[current].normal.dot(mesh.polygons[neighbor].normal) > cosine:
                        found.add(neighbor)
                        stack.append(neighbor)
        return found

    return connected


def refine_registry(scene):
    body = scene.objects[REGISTRY]
    if body.get("registry_source_mesh"):
        return
    original = body.data
    if original.name != REGISTRY_BODY:
        raise ValueError(f"Unexpected registry mesh: {original.name}")
    seeds = []
    for x, y in ((.5, -2), (-1.3, 2.5), (1.85, 1.5)):
        hit, _, _, face = body.ray_cast(Vector((x, y, 17)), Vector((0, 0, -1)))
        if not hit:
            raise ValueError("Missing registry roof cap")
        seeds.append(face)

    body["registry_source_mesh"] = original
    mesh = body.data = original.copy()
    mesh.name = "NEXCIV Registry | civic roof finishes"
    connected = roof_surfaces(mesh)
    bronze = material("Registry | satin bronze coping", "B88A4C", .44, .40)
    teal = material("Registry | patinated roof", "547373", .66, .25)
    badge = material("Registry | identity roof enamel", "245759", .55, .12)
    image = badge.node_tree.nodes.new("ShaderNodeTexImage")
    image.image = bpy.data.images.load(str(BADGE), check_existing=True)
    image.image.pack()
    badge.node_tree.links.new(image.outputs["Color"], shader(badge).inputs["Base Color"])
    for finish in (bronze, teal, badge):
        mesh.materials.append(finish)
    uv = mesh.uv_layers.active
    for cap, seed in enumerate(seeds):
        rim = connected(seed, .91)
        inside = connected(seed, .95)
        if not 35 <= len(inside) <= len(rim) <= 150:
            raise ValueError(f"Unexpected registry roof topology at cap {cap}")
        for index in rim:
            poly = mesh.polygons[index]
            finish = bronze if index not in inside else teal if cap else badge
            poly.material_index = mesh.materials.find(finish.name)
            if finish == badge:
                for loop in poly.loop_indices:
                    point = mesh.vertices[mesh.loops[loop].vertex_index].co
                    uv.data[loop].uv = ((point.x - .47) / 3.3 + .5, (point.y + 1.64) / 3.2 + .5)
    # Keep the entrance steps fixed. Two planters flank the 13 m frontage.
    front = min(point[1] for point in body.bound_box)
    body.scale.y *= 1.46
    body.scale.z *= 1.45
    body.location.y -= front * .46
    mesh.update()
