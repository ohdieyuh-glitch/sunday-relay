#!/usr/bin/env python3
"""Snapshot what layer designs need to know about the Blender kit, from the forge's own files.

Designs in this repository must reproduce without the forge worktree, so they read
kit_modules.json, not the forge. Every number here is copied from the forge's MEASURED manifest
(wonderland-blender-kit.json) and its import plan -- never typed: socket heights and rungs, the
footprint radius, and one (Unreal mesh, V2 material) pair per exported part. Re-run after the forge
rebuilds the kit.
"""
import json
import sys
from pathlib import Path

FORGE = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:/dev/iwonder/wonderland-blender-forge/wonderland/art")
HERE = Path(__file__).resolve().parent

kit = json.loads((FORGE / "blender/manifests/wonderland-blender-kit.json").read_text(encoding="utf-8"))
plan = json.loads((FORGE / "unreal/import-plan.json").read_text(encoding="utf-8"))
parts_by_asset = {a["asset_id"]: a for a in plan["assets"]}

modules = {}
for asset in kit["assets"]:
    aid = asset["asset_id"]
    planned = parts_by_asset.get(aid)
    if planned is None:
        continue
    sockets = {s["name"]: {"kind": s["kind"], "z": s["z_uu"], "rung": s.get("rung"), "radius": s.get("radius_uu")} for s in asset["sockets"]}
    modules[aid] = {
        "family": asset["family"], "group": asset["family_group"], "role": asset.get("silhouette_role"),
        "height": asset["height_uu"], "radius": asset.get("radius_uu"), "size": asset["size_uu"],
        "bbox_min": asset["bbox_min_uu"], "bbox_max": asset["bbox_max_uu"], "tris": asset.get("tris_total"),
        "sockets": sockets,
        "parts": [{"part": p["part"], "mesh": "%s.%s" % (p["asset_path"], p["destination_name"]), "material": p["material_instance"]} for p in planned["parts"]],
    }

out = {"schema": "wonderland-kit-modules/1", "kit_version": kit["kit_version"], "generated_utc": kit["generated_utc"],
       "radius_ladder_uu": kit["radius_ladder_uu"], "modules": modules}
(HERE / "kit_modules.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8", newline="\n")
print("kit_modules.json: %d modules, %d parts" % (len(modules), sum(len(m["parts"]) for m in modules.values())))
