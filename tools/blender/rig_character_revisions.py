"""Fit the shared game skeleton to the textured Tripo revisions of 02 and 03."""

import argparse
from hashlib import sha256
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rig_ensemble import Character, ROOT, distributions, fit, joint
from rig_researcher import components, save_motion_asset


CAST = {
    2: Character(
        "builder-02-v1", "construction worker 3d model 1.glb", "Builder_02",
        1.72, .48, 13, .129, .439, "work-belt",
        (
            (.099, .020, .704),  # shoulder
            (.173, .037, .594),  # elbow
            (.221, .038, .506),  # wrist
            (.252, .037, .425),  # fingers
            (.061, .012, .446),  # hip
            (.071, .002, .252),  # knee
            (.085, .021, .095),  # ankle
            (.093, -.079, .027),  # toe
            (0, .011, .446), (0, .005, .534), (0, .005, .631),
            (0, .015, .708), (0, .013, .749), (0, .011, .790),
        ),
    ),
    3: Character(
        "researcher-03-v1", "scientist boy 3d model (1).glb", "Researcher_03",
        1.68, .43, 15, .102, .407, "lab-coat",
        (
            (.086, .006, .707),  # shoulder
            (.166, .009, .603),  # elbow
            (.224, .009, .496),  # wrist
            (.248, -.004, .420),  # fingers
            (.052, .001, .435),  # hip
            (.057, -.008, .249),  # knee
            (.068, .012, .080),  # ankle
            (.074, -.090, .023),  # toe
            (0, .002, .435), (0, .005, .530), (0, .004, .631),
            (0, .006, .710), (0, .004, .756), (0, .002, .794),
        ),
    ),
}

SOURCE_HASHES = {
    2: "f2ffc834d6658b623f60ea13988e4b6613492fca61857a5219f78d476821c380",
    3: "851d6cad568edc3ad4e035a1c47b07e8d5590254c019072ecfe7adb75813042f",
}


def rigid_parts(character, mesh, points):
    # Tripo duplicates vertices at UV seams. Classify connected equipment from
    # coincident positions without changing the actual geometry or texture UVs.
    unique = []
    indices = {}
    remap = []
    for point in points:
        key = tuple(point)
        if key not in indices:
            indices[key] = len(unique)
            unique.append(point)
        remap.append(indices[key])
    adjacent = [set() for _ in unique]
    for edge in mesh.edges:
        a, b = (remap[i] for i in edge.vertices)
        if a != b:
            adjacent[a].add(b)
            adjacent[b].add(a)

    assignments = {}
    for part in components(adjacent, range(len(unique))):
        piece = [unique[i] for i in part]
        low, high = min(p.z for p in piece), max(p.z for p in piece)
        side = ".L" if sum(p.x for p in piece) > 0 else ".R"
        if high < (.136 if character.torso_detail == "work-belt" else .110):
            weights = joint("Foot", side)
        elif low > .783:
            weights = joint("Head")
        elif character.torso_detail == "work-belt" and .406 < low and high < .531:
            weights = joint("Hips")
        elif character.torso_detail == "lab-coat" and .694 < low and high < .785:
            weights = joint("Chest")
        else:
            continue
        assignments.update((i, weights) for i in part)
    return {index: assignments[key] for index, key in enumerate(remap) if key in assignments}


def bind_weights(character, mesh, points):
    fixed = rigid_parts(character, mesh, points)
    for index, weights in enumerate(distributions(character, points)):
        yield fixed.get(index, weights)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", type=int, choices=CAST, nargs="+", default=list(CAST))
    parser.add_argument("--output", required=True, type=Path, help="Staging directory for the two motion sets")
    options = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    for number in options.only:
        character = CAST[number]
        source = ROOT / character.folder / character.source
        if sha256(source.read_bytes()).hexdigest() != SOURCE_HASHES[number]:
            raise ValueError(f"Landmarks are calibrated for the recorded source of {character.name}")
        output = options.output.resolve() / character.folder / "motion"
        output.mkdir(parents=True, exist_ok=True)
        rig, scale = fit(character, source, mesh_weights=bind_weights)
        # Keep object IDs for scenes that link the existing motion libraries.
        library_name = character.name.replace("_", "")
        rig.name = library_name
        rig.data.name = library_name + " · skeleton"
        surface, = (child for child in rig.children if child.type == "MESH")
        surface.name = library_name + "_Surface"
        surface.data.name = library_name + " · skinned surface"
        save_motion_asset(rig, scale, output / ("CIVRUM_" + character.name),
                          arm_lower_degrees=character.arm_lower, viewport_color="TEXTURE", stride=character.stride)


if __name__ == "__main__":
    main()
