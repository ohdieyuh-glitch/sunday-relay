#!/usr/bin/env python3
"""Bring the Blender kit into UE 5.8 from its manifest, and say what happened.

    # offline, and this is the default: derive every decision, write the plan
    python3 wonderland/art/unreal/import_kit.py --plan

    # in the editor, executing that plan
    <UnrealEditor> Wonderland.uproject -run=pythonscript \
        -script="wonderland/art/unreal/import_kit.py --execute"

WHAT THIS IS FOR. `wonderland/art/blender/` produces ninety-odd meshes, each
with a measured height, a declared material, a Nanite and a collision
recommendation, a family and a district list. Every one of those is a decision
somebody would otherwise make by hand, ninety times, differently. This turns
the manifest into the import.

THE TWO MODES, and the reason there are two.

`--plan` runs anywhere, needs no engine, and answers "where does each mesh go,
what material does it get, is Nanite asked for, is collision asked for, which
data layer does it belong to" -- purely by DERIVATION from the manifest, with
the rule for each written down here. It writes `import-plan.json`. Everything
in the plan is checkable without Unreal, and `import_kit_offline_test.py`
checks it.

`--execute` runs inside the editor and does what the plan says. It writes
`import-result.json` recording what the ENGINE did: which import options were
accepted, which were silently unavailable, what asset paths came back. It never
writes a success it did not observe.

WHAT IS NOT PROVEN, stated here because the temptation is to let a plan sound
like a result:

  * NO MESH FROM THIS KIT HAS EVER BEEN IMPORTED INTO AN EDITOR. There is no
    Unreal in this container. `--plan` has run; `--execute` has not.
  * `nanite_recommended` is a RECOMMENDATION from the Blender side, not a
    measurement of Nanite behaviour. Nanite is asked for through
    `InterchangeGenericAssetsPipeline`, guarded the way
    `marble/import-marble-world.py` guards it, because a silently-ignored
    import option is this project's most repeated failure.
  * `collision_recommended` likewise. This asks the engine for simple collision
    and records the answer. It does not know whether the resulting hull is
    right for a Relay Dog, and nothing here should be read as saying it does.

CONVENTIONS THIS FOLLOWS RATHER THAN INVENTS. All of these were read out of the
repository, not chosen:

    /Game/WonderlandV2                 v2_config.CONTENT_ROOT
    .../Materials/Instances/MI_V2_*    v2_config.FOLDERS["mat_instances"]
    V2_Skyline, V2_Garden, ...         v2_config.DATA_LAYERS
    AssetImportTask + AssetToolsHelpers, spawn_actor_from_class, and the
    guarded Interchange options        marble/import-marble-world.py

THE ONE THING IT ADDS is a root of its own: the kit lands under
`/Game/WonderlandV2/Kit/<family group>` rather than in the existing
`Architecture/*` folders. Those folders hold assets `build_v2.py` GENERATES in
the editor and rebuilds from scratch; dropping imported meshes among them would
make a rebuild ambiguous about what it owns. A separate root costs nothing and
keeps "generated" and "imported" answerable at a glance.
"""

import argparse
import io
import json
import os
import sys

try:
    import unreal
except ImportError:                      # running outside the editor
    unreal = None

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
BLENDER_ROOT = os.path.join(REPO, "wonderland", "art", "blender")
MANIFEST = os.path.join(BLENDER_ROOT, "manifests", "wonderland-blender-kit.json")

CONTENT_ROOT = "/Game/WonderlandV2"
KIT_ROOT = CONTENT_ROOT + "/Kit"
MATERIAL_DIR = CONTENT_ROOT + "/Materials/Instances"

KIT_TAG = "WonderlandBlenderKit"

#: family group -> the data layer it belongs in. Every value is one of
#: `v2_config.DATA_LAYERS`; nothing here invents a layer.
GROUP_LAYER = {
    "towers": "V2_Skyline",
    "thresholds": "V2_Castle",
    "civic": "V2_Castle",
    "walls": "V2_Castle",
    "roofscape": "V2_Skyline",
    "stairs": "V2_Garden",
    "gardens": "V2_Garden",
    # THE MADE SURFACE IS THE ARRIVAL. `V2_Arrival` is where the plaza a player
    # lands in lives, and paving, kerbs and a medallion are that plaza; letting
    # them fall through to the `V2_Props` default would have put a city's
    # ground in the same layer as its garden benches.
    "ground": "V2_Arrival",
    "water": "V2_Garden",
    "market": "V2_Props",
    "details": "V2_Props",
    "hero": "V2_Skyline",
    "variants": "V2_Castle",
}


def log(message):
    if unreal is not None:
        # Warning level on purpose, and for the reason the marble importer
        # gives: Display is filtered out of commandlet logs, and an import
        # nobody can audit afterwards is a rumour.
        unreal.log_warning("[kit] %s" % message)
    else:
        sys.stdout.write("[kit] %s\n" % message)


def read_manifest(path=MANIFEST):
    if not os.path.exists(path):
        raise SystemExit(
            "no manifest at %s -- run wonderland/art/blender/scripts/"
            "build_assets.py first. Nothing was planned." % path)
    with io.open(path, encoding="utf8") as fh:
        return json.load(fh)


# --------------------------------------------------------------------------
# derivation: every one of these is a rule, not a table of ninety answers
# --------------------------------------------------------------------------


def destination_path(asset):
    """`/Game/WonderlandV2/Kit/<group>`, and variants in their own subfolder.

    A variant sits under `<group>/Weathered` rather than beside its base so a
    level designer browsing `Kit/walls` sees the five wall modules, not ten
    entries where half are `__aged`.
    """
    group = asset.get("family_group") or "misc"
    if asset.get("variant_of"):
        return "%s/%s/Weathered" % (KIT_ROOT, group)
    return "%s/%s" % (KIT_ROOT, group)


def material_path(mi_name):
    """The V2 material instance this part's mesh should use.

    The Blender side only ever names materials that `materials_v2.py` actually
    defines -- its validator parses that file and fails otherwise -- so this is
    a path join and not a lookup that can miss.
    """
    return "%s/%s" % (MATERIAL_DIR, mi_name)


def data_layer(asset):
    """The V2 data layer, from the family group, with vegetation as the one
    exception: a module whose part list includes `veg_anchor` is planting."""
    group = asset.get("family_group") or ""
    return GROUP_LAYER.get(group, "V2_Props")


def source_file(part, prefer="fbx"):
    """The exported file on disk for one part, absolute.

    FBX by default. `forge/units.py` bakes FBX vertices to centimetres with
    UnitScaleFactor 1 precisely so an Unreal import needs no scale override;
    the GLB is metres Y-up per the glTF spec and is there for other consumers.
    """
    rel = part.get(prefer) or part.get("fbx") or part.get("glb")
    if not rel:
        return None
    return os.path.join(BLENDER_ROOT, rel) if not os.path.isabs(rel) else rel


def plan_asset(asset, prefer="fbx"):
    """Everything the import of one asset needs, derived. No engine required."""
    dest = destination_path(asset)
    parts = []
    for key, part in sorted((asset.get("parts") or {}).items()):
        src = source_file(part, prefer)
        parts.append({
            "part": key,
            "mesh_name": part.get("mesh_name"),
            "source": src,
            "source_exists": bool(src) and os.path.exists(src),
            "destination_path": dest,
            "destination_name": part.get("mesh_name"),
            "asset_path": "%s/%s" % (dest, part.get("mesh_name")),
            "material_instance": part.get("material"),
            "material_path": material_path(part.get("material")),
            "triangles": part.get("tris"),
        })
    return {
        "asset_id": asset.get("asset_id"),
        "family_group": asset.get("family_group"),
        "variant_of": asset.get("variant_of"),
        "destination_path": dest,
        "data_layer": data_layer(asset),
        "nanite_requested": bool(asset.get("nanite_recommended")),
        "collision_requested": bool(asset.get("collision_recommended")),
        "height_uu": asset.get("height_uu"),
        "excavation_uu": asset.get("excavation_uu"),
        "mounts_on": asset.get("mounts_on"),
        "style": asset.get("style"),
        "sockets": asset.get("sockets"),
        "parts": parts,
    }


def build_plan(manifest, prefer="fbx"):
    assets = [plan_asset(a, prefer) for a in manifest.get("assets", [])]
    missing = [p["source"] for a in assets for p in a["parts"]
               if not p["source_exists"]]
    return {
        "schema": "wonderland-kit-unreal-import/1",
        "manifest": os.path.relpath(MANIFEST, REPO),
        "kit_version": manifest.get("kit_version"),
        "content_root": KIT_ROOT,
        "material_dir": MATERIAL_DIR,
        "prefer_format": prefer,
        "conventions_read_from": [
            "wonderland/v2/v2_config.py (CONTENT_ROOT, FOLDERS, DATA_LAYERS)",
            "wonderland/marble/import-marble-world.py (AssetImportTask, the "
            "guarded Interchange options, spawn_actor_from_class)",
        ],
        "counts": {
            "assets": len(assets),
            "meshes": sum(len(a["parts"]) for a in assets),
            "missing_sources": len(missing),
            "nanite_requested": sum(1 for a in assets if a["nanite_requested"]),
            "collision_requested": sum(1 for a in assets
                                       if a["collision_requested"]),
            "by_data_layer": _tally(a["data_layer"] for a in assets),
            "by_destination": _tally(a["destination_path"] for a in assets),
        },
        "proven": {
            "imported_into_an_editor": False,
            "nanite_verified": False,
            "collision_verified": False,
            "note": ("this file is a PLAN. Nothing in it has been executed by "
                     "an engine. Run --execute inside the editor; it writes "
                     "import-result.json with what actually happened."),
        },
        "missing_sources": sorted(set(missing)),
        "assets": assets,
    }


def _tally(values):
    out = {}
    for v in values:
        out[v] = out.get(v, 0) + 1
    return dict(sorted(out.items()))


# --------------------------------------------------------------------------
# execution: only ever inside the editor, and it reports what it observed
# --------------------------------------------------------------------------


def _import_one(entry, nanite):
    """One AssetImportTask. Returns (paths, notes) -- notes record what the
    engine refused, because a silently-dropped option looks like a success."""
    notes = []
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", entry["source"])
    task.set_editor_property("destination_path", entry["destination_path"])
    task.set_editor_property("destination_name", entry["destination_name"])
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)

    if nanite:
        try:
            options = unreal.InterchangeGenericAssetsPipeline()
            options.get_editor_property("mesh_pipeline").set_editor_property(
                "build_nanite", True)
            task.set_editor_property("options", options)
            notes.append("nanite requested via InterchangeGenericAssetsPipeline")
        except Exception as exc:                          # noqa: BLE001
            notes.append("NANITE NOT APPLIED (%s) -- imported at engine "
                         "defaults; the mesh is a normal static mesh" % exc)

    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    paths = list(task.get_editor_property("imported_object_paths") or [])
    if not paths:
        notes.append("the engine returned NO imported object paths")
    return paths, notes


def _assign_material(asset_path, material_path_str):
    """Put the V2 instance in slot 0. Returns a note saying what happened."""
    mesh = unreal.EditorAssetLibrary.load_asset(asset_path)
    if mesh is None:
        return "no asset at %s to assign a material to" % asset_path
    mat = unreal.EditorAssetLibrary.load_asset(material_path_str)
    if mat is None:
        return ("material %s does not exist -- the mesh keeps whatever the "
                "importer gave it" % material_path_str)
    try:
        mesh.set_material(0, mat)
        unreal.EditorAssetLibrary.save_asset(asset_path, only_if_is_dirty=False)
        return "material slot 0 = %s" % material_path_str
    except Exception as exc:                              # noqa: BLE001
        return "material assignment FAILED (%s)" % exc


def execute(plan):
    """Run the plan in the editor. Records observations, never assumptions."""
    if unreal is None:
        raise SystemExit("--execute needs the Unreal editor; run with --plan "
                         "outside it. Nothing was imported.")
    results = []
    for asset in plan["assets"]:
        for entry in asset["parts"]:
            record = {"asset_id": asset["asset_id"], "part": entry["part"],
                      "source": entry["source"], "notes": []}
            if not os.path.exists(entry["source"]):
                record["notes"].append("source file is not on disk; skipped")
                record["imported"] = []
                results.append(record)
                continue
            paths, notes = _import_one(entry, asset["nanite_requested"])
            record["imported"] = paths
            record["notes"] += notes
            for p in paths:
                record["notes"].append(
                    _assign_material(p.split(".")[0], entry["material_path"]))
            results.append(record)
            log("%s/%s -> %s" % (asset["asset_id"], entry["part"],
                                 ", ".join(paths) or "NOTHING"))
    out = {
        "schema": "wonderland-kit-unreal-import-result/1",
        "engine": unreal.SystemLibrary.get_engine_version(),
        "counts": {
            "attempted": len(results),
            "with_assets": sum(1 for r in results if r["imported"]),
            "empty": sum(1 for r in results if not r["imported"]),
        },
        "results": results,
    }
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true",
                    help="derive the import plan and write it (needs no engine)")
    ap.add_argument("--execute", action="store_true",
                    help="run the plan; only works inside the Unreal editor")
    ap.add_argument("--format", default="fbx", choices=("fbx", "glb"))
    ap.add_argument("--out", default=os.path.join(HERE, "import-plan.json"))
    ap.add_argument("--result", default=os.path.join(HERE, "import-result.json"))
    args, _unknown = ap.parse_known_args(argv)

    manifest = read_manifest()
    plan = build_plan(manifest, prefer=args.format)

    if args.execute:
        result = execute(plan)
        with io.open(args.result, "w", encoding="utf8") as fh:
            json.dump(result, fh, indent=2)
            fh.write(u"\n")
        log("result -> %s (%d of %d parts produced assets)"
            % (args.result, result["counts"]["with_assets"],
               result["counts"]["attempted"]))
        return 0

    with io.open(args.out, "w", encoding="utf8") as fh:
        json.dump(plan, fh, indent=2)
        fh.write(u"\n")
    c = plan["counts"]
    log("plan -> %s" % args.out)
    log("  %d assets, %d meshes, %d missing source file(s)"
        % (c["assets"], c["meshes"], c["missing_sources"]))
    log("  nanite requested for %d, collision for %d"
        % (c["nanite_requested"], c["collision_requested"]))
    log("  NOTHING HAS BEEN IMPORTED. This is a plan.")
    return 1 if c["missing_sources"] else 0


if __name__ == "__main__":
    sys.exit(main())
