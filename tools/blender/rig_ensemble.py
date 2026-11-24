"""Fit the shared CIVRUM body rig to the textured character exports for 04–08."""

import argparse
import sys
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rig_researcher import blend, ramp, save_motion_asset, skeleton

ROOT = Path(__file__).resolve().parents[2] / "art-direction/tripo"

# The rest landmarks use the exported Tripo height as the unit. These keys
# are the corresponding landmarks of the shared 20-bone template.
TEMPLATE = (
    (0.091, 0.002, 0.690),
    (0.153, 0.001, 0.588),
    (0.210, -0.009, 0.495),
    (0.242, -0.020, 0.417),
    (0.058, 0, 0.435),
    (0.061, -0.014, 0.242),
    (0.066, -0.002, 0.072),
    (0.071, -0.093, 0.027),
    (0, 0, 0.435),
    (0, 0, 0.520),
    (0, 0, 0.615),
    (0, 0, 0.695),
    (0, 0, 0.735),
    (0, 0, 0.779),
)


@dataclass(frozen=True)
class Character:
    folder: str
    source: str
    name: str
    height: float
    stride: float
    arm_lower: float
    shoe: float
    hip_rest: float
    torso_detail: str
    joints: tuple


CAST = {
    4: Character(
        "creator-04-v1",
        "boy character 3d model (1).glb",
        "Creator_04",
        1.70,
        0.50,
        5,
        0.109,
        0.439,
        "hood",
        (
            (0.092, 0.026, 0.692),
            (0.148, 0.023, 0.590),
            (0.184, 0.021, 0.480),
            (0.195, 0.008, 0.409),
            (0.057, 0.009, 0.454),
            (0.058, -0.005, 0.279),
            (0.060, 0.018, 0.092),
            (0.067, -0.094, 0.029),
            (0, 0.010, 0.454),
            (0, 0.014, 0.530),
            (0, 0.016, 0.632),
            (0, 0.023, 0.704),
            (0, 0.019, 0.758),
            (0, 0.012, 0.796),
        ),
    ),
    5: Character(
        "citizen-05-v1",
        "anime girl.glb",
        "Citizen_05",
        1.65,
        0.48,
        10,
        0.098,
        0.458,
        "backpack",
        (
            (0.087, 0.017, 0.725),
            (0.147, 0.006, 0.623),
            (0.203, -0.004, 0.502),
            (0.227, -0.014, 0.438),
            (0.057, 0.010, 0.523),
            (0.053, -0.008, 0.331),
            (0.065, 0.016, 0.084),
            (0.071, -0.099, 0.029),
            (0, 0.004, 0.523),
            (0, 0.003, 0.599),
            (0, 0.008, 0.662),
            (0, 0.018, 0.731),
            (0, 0.019, 0.763),
            (0, 0.011, 0.807),
        ),
    ),
    6: Character(
        "service-06-v1",
        "waitress character.glb",
        "Service_06",
        1.66,
        0.32,
        9,
        0.091,
        0.435,
        "apron",
        (
            (0.084, 0.009, 0.714),
            (0.154, 0.010, 0.611),
            (0.218, 0.011, 0.502),
            (0.238, 0.002, 0.447),
            (0.049, 0.011, 0.495),
            (0.052, 0.001, 0.296),
            (0.057, 0.015, 0.080),
            (0.064, -0.085, 0.023),
            (0, 0.010, 0.495),
            (0, 0.006, 0.562),
            (0, 0.009, 0.643),
            (0, 0.010, 0.714),
            (0, 0.012, 0.742),
            (0, 0.009, 0.778),
        ),
    ),
    7: Character(
        "creator-07-v1",
        "girl.glb",
        "Creator_07",
        1.64,
        0.45,
        8,
        0.124,
        0.450,
        "backpack",
        (
            (0.087, -0.004, 0.708),
            (0.151, -0.005, 0.600),
            (0.199, -0.013, 0.486),
            (0.227, -0.018, 0.412),
            (0.053, -0.020, 0.514),
            (0.054, -0.033, 0.330),
            (0.071, -0.017, 0.098),
            (0.076, -0.115, 0.036),
            (0, -0.020, 0.514),
            (0, -0.012, 0.584),
            (0, -0.010, 0.654),
            (0, -0.009, 0.718),
            (0, -0.005, 0.760),
            (0, -0.001, 0.794),
        ),
    ),
    8: Character(
        "technician-08-v1",
        "worker girl 3d model.glb",
        "Technician_08",
        1.68,
        0.44,
        5,
        0.093,
        0.475,
        "tools",
        (
            (0.092, 0.023, 0.724),
            (0.143, 0.018, 0.626),
            (0.188, 0.025, 0.503),
            (0.202, 0.013, 0.431),
            (0.058, 0.012, 0.520),
            (0.064, -0.007, 0.302),
            (0.074, 0.019, 0.079),
            (0.074, -0.089, 0.028),
            (0, 0.012, 0.520),
            (0, 0.009, 0.586),
            (0, 0.012, 0.664),
            (0, 0.019, 0.729),
            (0, 0.022, 0.759),
            (0, 0.023, 0.804),
        ),
    ),
}


def joint(name, side=""):
    return {name + side: 1.0}


def distributions(character, positions):
    shoulder, elbow, wrist, _, _, knee, _, _, hips, spine, chest, _, neck, head = character.joints
    shoulder, elbow, wrist = map(Vector, (shoulder, elbow, wrist))
    upper_axis = (elbow - shoulder).normalized()
    arm_axis = (wrist - shoulder).normalized()
    forearm_axis = (wrist - elbow).normalized()
    for p in positions:
        x, y, z = p
        side = ".L" if x >= 0 else ".R"
        flat = Vector((abs(x), y, z))
        inner = shoulder[0] - 0.036 + 0.51 * max(0, shoulder[2] - z)
        distal_arm = ramp(abs(x), 0.135, 0.163)
        upper_arm = ramp(abs(x), inner, inner + 0.048)
        proximity = ramp(z, elbow.z - 0.075, elbow.z + 0.015)
        arm_mix = (distal_arm + (upper_arm - distal_arm) * proximity) * (
            1 - ramp(z, shoulder[2] + 0.023, neck[2] + 0.009)
        )
        if character.torso_detail == "backpack":
            arm_mix *= 1 - ramp(y, 0.054, 0.078)
        if z > neck[2] + 0.015:
            yield blend(joint("Neck"), joint("Head"), ramp(z, neck[2] + 0.018, head[2] - 0.004))
            continue

        leg = blend(
            joint("Foot", side), joint("Shin", side), ramp(z, character.shoe - 0.014, character.shoe + 0.025)
        )
        leg = blend(leg, joint("Thigh", side), ramp(z, knee[2] - 0.046, knee[2] + 0.047))
        # The groin is shared across the two thighs only above the separated leg shells.
        centre = blend(joint("Thigh.R"), joint("Thigh.L"), ramp(x, -0.029, 0.029))
        leg = blend(
            leg,
            centre,
            (1 - ramp(abs(x), 0.011, 0.035)) * ramp(z, knee[2] + 0.040, knee[2] + 0.095),
        )
        trunk = blend(leg, joint("Hips"), ramp(z, character.hip_rest, hips[2] + 0.041))
        trunk = blend(trunk, joint("Spine"), ramp(z, spine[2] - 0.038, spine[2] + 0.028))
        trunk = blend(trunk, joint("Chest"), ramp(z, chest[2] - 0.042, chest[2] + 0.031))
        trunk = blend(trunk, joint("Neck"), ramp(z, neck[2] - 0.028, neck[2] + 0.024))

        if character.torso_detail == "apron":
            # Share the skirt panel between the thighs with a wide centre feather.
            middle = blend(joint("Thigh.R"), joint("Thigh.L"), ramp(x, -0.047, 0.047))
            apron = blend(middle, joint("Hips"), ramp(z, 0.375, 0.490))
            strength = (
                ramp(-y, 0.041, 0.070)
                * ramp(z, 0.328, 0.347)
                * (1 - ramp(z, 0.476, 0.510))
                * (1 - ramp(abs(x), 0.125, 0.157))
            )
            trunk = blend(trunk, apron, strength)
        if character.torso_detail == "tools":
            strength = (
                (1 - ramp(abs(x), 0.100, 0.131))
                * ramp(-y, 0.025, 0.048)
                * ramp(z, 0.505, 0.539)
                * (1 - ramp(z, 0.579, 0.616))
            )
            trunk = blend(trunk, joint("Hips"), strength)
        if character.torso_detail == "backpack":
            trunk = blend(trunk, joint("Chest"), ramp(y, 0.062, 0.100) * ramp(z, 0.500, 0.550))

        # The collar can reach head height. Its back stays attached to the jacket.
        if character.torso_detail == "hood" and y > 0.055:
            trunk = blend(trunk, joint("Chest"), ramp(z, 0.665, 0.723) * (1 - ramp(z, 0.766, 0.794)))
        if arm_mix <= 0 or z < 0.38:
            yield trunk
            continue
        shoulder_distance = (flat - shoulder).dot(upper_axis)
        elbow_distance = (flat - elbow).dot(arm_axis)
        wrist_distance = (flat - wrist).dot(forearm_axis)
        arm = blend(joint("Clavicle", side), joint("UpperArm", side), ramp(shoulder_distance, -0.031, 0.031))
        arm = blend(arm, joint("Forearm", side), ramp(elbow_distance, -0.040, 0.038))
        arm = blend(arm, joint("Hand", side), ramp(wrist_distance, -0.022, 0.022))
        yield blend(trunk, arm, arm_mix)


def allow_apron_clearance(mesh, points, scale):
    # The source front panel nearly touches the trousers at rest. Taper a
    # small amount of clearance into the lower front while retaining its UVs.
    for vertex, (x, y, z) in zip(mesh.vertices, points):
        clearance = (
            ramp(-y, 0.052, 0.071)
            * ramp(z, 0.325, 0.347)
            * (1 - ramp(z, 0.399, 0.475))
            * (1 - ramp(abs(x), 0.080, 0.130))
        )
        vertex.co.y -= scale * 0.021 * clearance
    mesh.update()


def fit(character, source):
    digest = sha256(source.read_bytes()).hexdigest()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    (obj,) = (o for o in bpy.context.scene.objects if o.type == "MESH")
    assert len(obj.data.uv_layers), "Expected the textured Tripo mesh"
    transform = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = Matrix.Identity(4)
    obj.data.transform(transform)
    points = [v.co.copy() for v in obj.data.vertices]
    bottom, top = min(v.z for v in points), max(v.z for v in points)
    scale = character.height / (top - bottom)
    obj.data.transform(Matrix.Scale(scale, 4) @ Matrix.Translation((0, 0, -bottom)))
    for point in points:
        point.z -= bottom
    if character.torso_detail == "apron":
        allow_apron_clearance(obj.data, points, scale)
    for other in list(bpy.context.scene.objects):
        if other != obj:
            bpy.data.objects.remove(other, do_unlink=True)
    obj.name = character.name + " Surface"
    targets = dict(zip(TEMPLATE, character.joints))

    def fit_joint(point):
        x, y, z = point
        x2, y2, z2 = targets.get((abs(x), y, z), (abs(x), y, z))
        return (-x2 if x < 0 else x2), y2, z2

    rig = skeleton(scale, character.name, fit_joint)
    rig["source_asset"] = source.name
    rig["source_sha256"] = digest
    columns = {b.name: obj.vertex_groups.new(name=b.name) for b in rig.data.bones}
    for index, field in enumerate(distributions(character, points)):
        weights = sorted(((b, w) for b, w in field.items() if w > 1e-6), key=lambda it: -it[1])[:4]
        total = sum(weight for _, weight in weights)
        for bone, weight in weights:
            columns[bone].add([index], weight / total, "REPLACE")
    obj.parent = rig
    obj.modifiers.new("CIVRUM body skin", "ARMATURE").object = rig
    bpy.ops.file.pack_all()
    return rig, scale


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", type=int, nargs="+", choices=CAST, default=list(CAST))
    parser.add_argument("--output", type=Path, help="Optional staging directory for all characters")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    for number in args.only:
        character = CAST[number]
        source = ROOT / character.folder / character.source
        output = (args.output.resolve() / character.folder if args.output else source.parent) / "motion"
        output.mkdir(parents=True, exist_ok=True)
        rig, scale = fit(character, source)
        save_motion_asset(
            rig,
            scale,
            output / ("CIVRUM_" + character.name),
            arm_lower_degrees=character.arm_lower,
            viewport_color="TEXTURE",
            stride=character.stride,
        )
        print(f"Exported {character.name} with four actions to {output}", flush=True)


if __name__ == "__main__":
    main()
