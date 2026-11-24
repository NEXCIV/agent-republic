"""Prepare editable Blender libraries from the archived Hi3D exports.

Run with Python and Pillow, passing the Blender and gltfpack executables.
The npm gltfpack cli.js can also be supplied when Node is installed.
"""

import argparse
import io
import json
import struct
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HI3D = ROOT / "art-direction/hi3d"
ASSETS = {
    "billboard-commercial-v1": ("001853", "Billboard Commercial", 4096, .22),
    "garden-roof-retail-v1": ("001959", "Garden Roof Retail", 4096, .20),
    "green-planter-tree-v1": ("002524", "Green Planter Tree", 2048, .10),
    "autumn-planter-tree-v1": ("003327", "Autumn Planter Tree", 2048, .10),
    "tower-crane-v1": ("003654", "Tower Crane", 4096, .22),
}


def texture_copy(source, destination, limit):
    """Resize the two bundled texture images without changing their UVs."""
    from PIL import Image

    data = source.read_bytes()
    json_length, = struct.unpack_from("<I", data, 12)
    doc = json.loads(data[20:20 + json_length])
    binary = memoryview(data)[28 + json_length:]
    images = {image["bufferView"]: image for image in doc["images"]}
    combined = bytearray()
    for index, view in enumerate(doc["bufferViews"]):
        start = view.get("byteOffset", 0)
        payload = binary[start:start + view["byteLength"]]
        if index in images:
            with Image.open(io.BytesIO(payload)) as tex:
                tex.thumbnail((limit, limit), Image.Resampling.LANCZOS)
                jpeg = io.BytesIO()
                tex.convert("RGB").save(jpeg, "JPEG", quality=94, subsampling=0, optimize=True)
            payload = jpeg.getvalue()
            images[index]["mimeType"] = "image/jpeg"
        view["byteOffset"] = len(combined)
        view["byteLength"] = len(payload)
        combined.extend(payload)
        combined.extend(b"\0" * (-len(combined) % 4))
    doc["buffers"][0]["byteLength"] = len(combined)
    body = json.dumps(doc, separators=(",", ":")).encode()
    body += b" " * (-len(body) % 4)
    header = struct.pack("<4sIII4s", b"glTF", 2, 28 + len(body) + len(combined), len(body), b"JSON")
    destination.write_bytes(header + body + struct.pack("<I4s", len(combined), b"BIN\0") + combined)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("blender")
    parser.add_argument("gltfpack")
    parser.add_argument("assets", nargs="*", metavar="ASSET", help="Asset folder names. Defaults to all five.")
    args = parser.parse_args()
    command = ["node", args.gltfpack] if args.gltfpack.endswith(".js") else [args.gltfpack]
    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        for key in args.assets or ASSETS:
            stamp, _, limit, ratio = ASSETS[key]
            source, = (HI3D / key).glob(f"*_{stamp}.glb")
            resized, optimized = temp / "resized.glb", temp / f"{key}.glb"
            texture_copy(source, resized, limit)
            subprocess.run([*command, "-i", str(resized), "-o", str(optimized), "-si", str(ratio),
                            "-noq"], check=True)
        subprocess.run([args.blender, "-b", "--factory-startup", "--disable-autoexec",
                        "--python-exit-code", "2", "-P", str(ROOT / "scripts/build_civrum_lakeside.py"),
                        "--", "--hi3d-imports", str(temp)], check=True)


if __name__ == "__main__":
    main()
