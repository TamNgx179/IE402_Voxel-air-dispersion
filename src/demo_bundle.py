"""Install checksum-locked demo inputs without downloads or host caches.

The bundle stores the existing EDGAR-normalized source, not a replacement
emission model. This module copies bytes; it never changes scientific fields.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
EXPECTED = {
    "voxel_grid.nc": "data/processed/voxel_grid.nc",
    "emission_source_transport.nc": "data/processed/emission_source_transport.nc",
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_destination(root: Path, relative: str) -> Path:
    path = PurePosixPath(relative)
    if path.is_absolute() or ".." in path.parts or "\\" in relative or ":" in relative:
        raise ValueError(f"Unsafe bundle destination: {relative}")
    destination = (root / relative).resolve()
    if not destination.is_relative_to(root.resolve()):
        raise ValueError(f"Bundle destination escapes root: {relative}")
    return destination


def inspect_bundle(bundle: Path, root: Path = ROOT) -> tuple[dict, dict[str, bytes]]:
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1:
        raise ValueError("Unsupported demo bundle version")
    if manifest.get("files") is None or set(manifest["files"]) != set(EXPECTED):
        raise ValueError("Demo bundle must contain exactly the two production inputs")
    archive = bundle / "inputs.zip"
    if digest(archive.read_bytes()) != manifest["archive_sha256"]:
        raise ValueError("Demo input archive checksum mismatch")
    scene = root / "db/seeds/scene/scene_manifest.json"
    if digest(scene.read_bytes()) != manifest["scene_manifest_sha256"]:
        raise ValueError("Demo input geometry differs from the packaged scene")
    contents = {}
    with zipfile.ZipFile(archive) as handle:
        members = handle.infolist()
        if len(members) != len(EXPECTED) or {m.filename for m in members} != set(EXPECTED):
            raise ValueError("Unexpected or duplicate member in demo archive")
        if sum(member.file_size for member in members) > MAX_TOTAL_BYTES:
            raise ValueError("Demo archive exceeds uncompressed size budget")
        for member in members:
            metadata = manifest["files"][member.filename]
            if metadata["destination"] != EXPECTED[member.filename]:
                raise ValueError("Unexpected demo destination")
            safe_destination(root, metadata["destination"])
            if member.file_size > MAX_FILE_BYTES:
                raise ValueError("Demo input exceeds size budget")
            data = handle.read(member)
            if len(data) != metadata["size_bytes"] or digest(data) != metadata["sha256"]:
                raise ValueError(f"Demo file checksum/size mismatch: {member.filename}")
            contents[member.filename] = data
    return manifest, contents


def install(bundle: Path, root: Path = ROOT) -> dict:
    manifest, contents = inspect_bundle(bundle, root)
    # Validate every file and destination before creating any output.
    destinations = {
        name: safe_destination(root, manifest["files"][name]["destination"])
        for name in contents
    }
    for name, destination in destinations.items():
        if destination.exists() and digest(destination.read_bytes()) != digest(contents[name]):
            raise ValueError(f"Refusing to replace different local input: {destination}")
    installed = []
    for name, destination in destinations.items():
        if destination.exists():
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".demo-", dir=destination.parent)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(contents[name])
            os.replace(temporary, destination)
        finally:
            Path(temporary).unlink(missing_ok=True)
        installed.append(manifest["files"][name]["destination"])
    return {"status": "pass", "installed": installed, "bundle_sha256": manifest["archive_sha256"]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["install", "verify"])
    parser.add_argument("--bundle", type=Path, default=ROOT / "deploy/demo-inputs")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        if args.command == "install":
            result = install(args.bundle, args.root)
        else:
            manifest, _ = inspect_bundle(args.bundle, args.root)
            result = {"status": "pass", "bundle_sha256": manifest["archive_sha256"]}
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Demo inputs refused: {error}\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
