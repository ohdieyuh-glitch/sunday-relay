#!/usr/bin/env python3
"""Emit the ONE description of where a Marble world sits, for consumers that
are not Unreal.

    python3 placement_contract.py --world worlds/royal-garden-backdrop \
        --out ../web/inspector/public/placement-contract.json

WHY A CONTRACT AND NOT A SECOND IMPLEMENTATION

The browser inspector exists to catch upside-down imports, 180-degree flips,
wrong scale, wrong origin and a backdrop outside the camera frustum. It cannot
catch any of those if it computes placement its own way: two implementations of
the same chain agree right up until the moment one of them is the bug, and then
the tool that was supposed to find the bug reproduces it.

So placement.py stays the only place that composes the chain, and this writes
down its RESULT — basis, scale, origin, offset, already multiplied out — plus
the camera table read from the generator. The browser multiplies a matrix it
was handed. It does no placement arithmetic of its own, and there is nothing
for it to get independently wrong.

The one thing the browser DOES need that Unreal does not is a handedness
conversion: Unreal is left-handed Z-up, three.js is right-handed. Negating Y
turns one into the other. That conversion is emitted here too, as a matrix,
tested here, rather than written twice in JavaScript.
"""
import argparse
import io
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(os.path.dirname(HERE), "infra", "build")
sys.path.insert(0, HERE)
sys.path.insert(0, BUILD)

import placement  # noqa: E402

try:
    import hero_shots  # noqa: E402
except SystemExit:
    hero_shots = None
except ImportError:
    hero_shots = None

SCHEMA = "wonderland.marble.placement-contract/1"

# Unreal is left-handed (X forward, Y right, Z up); three.js is right-handed.
# Negating Y converts between them and is its own inverse. Applied to geometry
# AND cameras alike, so the browser frames what the engine frames.
UE_TO_THREE = ((1.0, 0.0, 0.0),
               (0.0, -1.0, 0.0),
               (0.0, 0.0, 1.0))


def rows(matrix):
    return [list(r) for r in matrix]


def build(world_dir, mode=None):
    manifest_path = os.path.join(world_dir, "manifest.json")
    with io.open(manifest_path, encoding="utf8") as handle:
        manifest = json.load(handle)

    transform = manifest.get("transform") or {}
    place = placement.placement_from(manifest, mode)
    node = placement.node_rotation(manifest)
    predicted = placement.predicted_extent(manifest, mode)
    centre = placement.predicted_centre_offset_cm(manifest, mode)
    source = manifest.get("source_mesh") or {}

    assets = {}
    for name, meaning in (("mesh_hq.glb", "visual, high-quality textured mesh"),
                          ("mesh_full_res.glb", "visual, full resolution with vertex colours"),
                          ("collider.glb", "collider reference, NOT gameplay collision")):
        path = os.path.join(world_dir, "assets", name)
        assets[name] = {
            "relative_path": os.path.join("assets", name),
            "representation": meaning,
            "present": os.path.exists(path),
            "bytes": os.path.getsize(path) if os.path.exists(path) else None,
            "is_source_mesh": source.get("file", "").endswith(name),
        }

    contract = {
        "schema": SCHEMA,
        "generated_from": os.path.relpath(manifest_path, os.path.dirname(HERE)),
        "why": (
            "placement.py composes the chain; this records its RESULT so the "
            "browser inspector can apply a matrix instead of re-deriving one. "
            "Two implementations of a placement chain agree until one of them "
            "is the bug."),
        "provenance": {
            "marble_world_id": manifest.get("marble_world_id"),
            "operation_id": manifest.get("operation_id"),
            "model": manifest.get("model"),
            "generated_at": manifest.get("generated_at"),
            "display_name": manifest.get("display_name"),
            "credits": (manifest.get("cost") or {}).get("total_credits"),
            "source_reference": (manifest.get("source_reference") or {}).get("kind"),
            "prompt_sha256": manifest.get("prompt_sha256"),
            "licence_commercial_use": (manifest.get("licence") or {}).get("commercial_use"),
        },
        "placement": {
            "mode": mode or transform.get("placement_mode"),
            "basis_rows": rows(place.basis),
            "unreal_units_per_gltf_unit": place.scale,
            "origin_cm": list(place.origin),
            "z_offset_cm": place.z_offset,
            "node_rotation_rows": rows(node),
            "axis_correction_deg": transform.get("axis_correction_deg"),
            "artistic_rotation_deg": transform.get("unreal_rotation_deg"),
            "anchor_camera": transform.get("anchor_camera"),
            "note": ("Apply node_rotation_rows to raw glTF vertices, then "
                     "basis_rows, then multiply by unreal_units_per_gltf_unit, "
                     "then add origin_cm and z_offset_cm on Z. That is the whole "
                     "chain; there is no step this omits."),
        },
        "handedness": {
            "ue_to_three_rows": rows(UE_TO_THREE),
            "note": ("Unreal is left-handed Z-up, three.js right-handed. Negate "
                     "Y. Apply to geometry AND cameras or the browser frames "
                     "something the engine does not."),
        },
        "extent": {
            "expected_unreal_extent_cm": transform.get("expected_unreal_extent_cm"),
            "predicted_extent_cm": [round(v, 3) for v in predicted],
            "centre_offset_from_origin_cm": [round(v, 3) for v in centre],
            "centre_offset_note": (
                "The signed quantity an extent check throws away, and the one "
                "that catches a flip. This shell's raw bounds run z = -0.94 .. "
                "+80.49, so it sits far ABOVE its own pivot; upside down that "
                "offset points down while every extent is unchanged."),
        },
        "source_mesh": {
            "file": source.get("file"),
            "min": source.get("min"),
            "max": source.get("max"),
            "span": source.get("span"),
            "triangles": source.get("triangles"),
            "vertices": source.get("vertices"),
            "double_sided": source.get("double_sided"),
            "texture": source.get("texture"),
            "node_rotation_quat_xyzw": source.get("node_rotation_quat_xyzw"),
            "extensions_used": source.get("extensions_used"),
            "unlit_note": source.get("unlit_note"),
        },
        "assets": assets,
        "backdrop_policy": (transform.get("backdrop_policy") or {}),
        "cameras": hero_shots.described() if hero_shots else [],
        "camera_source": (
            "hero_shots in wonderland/infra/build/generate-hub-level.py, parsed "
            "without importing it — the generator imports `unreal`."
            if hero_shots else
            "UNAVAILABLE: the generator could not be parsed, so no camera is "
            "described. The inspector must say so rather than invent one."),
        "skyline_elevation_deg": 21.3,
        "skyline_note": (
            "Median elevation of the shell's far, above-horizon, NON-SKY "
            "geometry seen from the anchor point, measured by "
            "marble/preview-offline.py. A camera whose frame tops out below "
            "this cannot see the castle city at all."),
    }
    return contract


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--world", default=os.path.join(HERE, "worlds", "royal-garden-backdrop"))
    parser.add_argument("--mode", default=None)
    parser.add_argument("--out", default=None, help="write here; default stdout")
    args = parser.parse_args(argv)

    contract = build(args.world, args.mode)
    text = json.dumps(contract, indent=2, sort_keys=True) + "\n"
    if args.out:
        directory = os.path.dirname(os.path.abspath(args.out))
        if directory and not os.path.isdir(directory):
            os.makedirs(directory)
        with io.open(args.out, "w", encoding="utf8") as handle:
            handle.write(text)
        sys.stderr.write("placement contract -> %s (%d cameras)\n"
                         % (args.out, len(contract["cameras"])))
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
