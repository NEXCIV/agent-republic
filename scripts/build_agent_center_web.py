"""Build the three Agent Center GLBs with Pillow and gltfpack 0.25.

Run from any directory: python scripts/build_agent_center_web.py PATH_TO_GLTFPACK
An unpacked npm gltfpack/cli.js is also supported.
"""
import argparse
import hashlib
import io
import json
import math
import struct
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "art-direction/tripo/agent-center-v3"
SOURCE = ART / "agent center 3d model 1.glb"
SOURCE_SHA = "5f4c07b9134b0fdebb1fdfad27d9cb9a4db07d884c8d027446b5f754bb602be5"
OUTPUT = ROOT / "apps/web/public/world/district-01/v1"
TIERS = [
    ("overview", 768, 83, 0.009, 320),
    ("mobile", 2048, 87, 0.035, 768),
    ("detail", 4096, 90, 0.10, 1280),
]


def unpack(data):
    length, = struct.unpack_from("<I", data, 12)
    return json.loads(data[20:20 + length]), data[28 + length:]


def align(data, fill=b"\0"):
    return data + fill * (-len(data) % 4)


def save_glb(path, doc, binary):
    doc["buffers"][0]["byteLength"] = len(binary)
    payload = align(json.dumps(doc, separators=(",", ":")).encode(), b" ")
    binary = align(binary)
    header = struct.pack("<4sIII4s", b"glTF", 2, 28 + len(payload) + len(binary), len(payload), b"JSON")
    path.write_bytes(header + payload + struct.pack("<I4s", len(binary), b"BIN\0") + binary)


def resized_image(image, width, fmt, **opts):
    size = (width, round(image.height * width / image.width))
    output = io.BytesIO()
    image.resize(size, Image.Resampling.LANCZOS).save(output, fmt, **opts)
    return output.getvalue()


def prepare_source(source, path, size, quality):
    doc, binary = unpack(source)
    # The verified master stores its one embedded JPEG in the first buffer view.
    views = doc["bufferViews"]
    old_end = views[1]["byteOffset"]
    with Image.open(io.BytesIO(binary[:views[0]["byteLength"]])) as image:
        texture = resized_image(image, size, "JPEG", quality=quality, optimize=True)
    views[0]["byteLength"] = len(texture)
    texture = align(texture)
    for view in views[1:]:
        view["byteOffset"] += len(texture) - old_end
    node = doc["nodes"][0]
    bounds = doc["accessors"][doc["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
    low, high = bounds["min"], bounds["max"]
    scale = 7 / (high[0] - low[0])
    node["scale"] = [scale] * 3
    node["translation"] = [-(low[0] + high[0]) * scale / 2, -low[1] * scale, -(low[2] + high[2]) * scale / 2]
    save_glb(path, doc, texture + binary[old_end:])


def add_sign(packed, destination, image_width):
    # Keep the enamel plaque separate from the generated facade and its UV atlas.
    doc, binary = unpack(packed.read_bytes())
    binary = bytearray(binary)

    def view(data, target=None):
        entry = {"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)}
        if target:
            entry["target"] = target
        binary.extend(align(data))
        doc["bufferViews"].append(entry)
        return len(doc["bufferViews"]) - 1

    def attribute(values, dimensions, kind):
        flat = [v for row in values for v in row]
        index = view(struct.pack(f"<{len(flat)}f", *flat), 34962)
        accessor = {"bufferView": index, "componentType": 5126, "count": len(values), "type": dimensions}
        if kind == "POSITION":
            accessor.update(min=list(map(min, zip(*values))), max=list(map(max, zip(*values))))
        doc["accessors"].append(accessor)
        return len(doc["accessors"]) - 1

    width, height, radius = 2.4, 0.425, 0.046
    points = []
    for quadrant, (x, y) in enumerate([(1, 1), (-1, 1), (-1, -1), (1, -1)]):
        for step in range(5):
            angle = (quadrant + step / 4) * math.pi / 2
            points.append((x * (width / 2 - radius) + radius * math.cos(angle),
                           y * (height / 2 - radius) + radius * math.sin(angle)))
    vertices, normals, uv = [], [], []

    def face_vertex(i, depth, normal):
        x, y = points[i]
        vertices.append((x, y + 1.566, depth))
        normals.append(normal)
        uv.append((0.5 + x / width, 0.5 - y / height))

    front, back = 2.347, 2.285
    for i in range(1, len(points) - 1):
        for j in (0, i, i + 1):
            face_vertex(j, front, (0, 0, 1))
    for i, (x, y) in enumerate(points):
        j = (i + 1) % len(points)
        dx, dy = points[j][0] - x, points[j][1] - y
        length = math.hypot(dx, dy)
        normal = (dy / length, -dx / length, 0)
        for k, depth in [(i, front), (i, back), (j, back), (i, front), (j, back), (j, front)]:
            face_vertex(k, depth, normal)
    attrs = {k: attribute(values, dim, k) for k, dim, values in
             [("POSITION", "VEC3", vertices), ("NORMAL", "VEC3", normals), ("TEXCOORD_0", "VEC2", uv)]}
    with Image.open(ART / "web-review/agent-center-sign.png") as image:
        image_view = view(resized_image(image, image_width, "PNG", optimize=True))
    doc["images"].append({"bufferView": image_view, "mimeType": "image/png"})
    doc["textures"].append({"source": len(doc["images"]) - 1})
    doc["materials"].append({"name": "Agent Center enamel", "pbrMetallicRoughness": {
        "baseColorTexture": {"index": len(doc["textures"]) - 1}, "metallicFactor": 0.12, "roughnessFactor": 0.62}})
    doc["meshes"].append({"primitives": [{"attributes": attrs, "material": len(doc["materials"]) - 1}]})
    doc["nodes"].append({"name": "Agent_Center_Nameplate", "mesh": len(doc["meshes"]) - 1})
    doc["scenes"][doc.get("scene", 0)]["nodes"].append(len(doc["nodes"]) - 1)
    save_glb(destination, doc, bytes(binary))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gltfpack", help="Path to gltfpack or npm gltfpack's cli.js")
    executable = parser.parse_args().gltfpack
    command = ["node", executable] if executable.endswith(".js") else [executable]
    source = SOURCE.read_bytes()
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA:
        raise ValueError("This build requires the reviewed Agent Center v3 master")
    with tempfile.TemporaryDirectory() as tmp:
        prepared, packed = Path(tmp) / "prepared.glb", Path(tmp) / "packed.glb"
        for name, size, quality, ratio, sign_width in TIERS:
            prepare_source(source, prepared, size, quality)
            subprocess.run([*command, "-i", str(prepared), "-o", str(packed), "-si", str(ratio),
                            "-sa", "-sp", "-cc", "-vt", "14"], check=True)
            add_sign(packed, OUTPUT / f"agent-center-{name}.glb", sign_width)


if __name__ == "__main__":
    main()
