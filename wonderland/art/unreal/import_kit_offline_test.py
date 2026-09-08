#!/usr/bin/env python3
"""Prove the kit importer's decisions without an engine.

    python3 wonderland/art/unreal/import_kit_offline_test.py

There is no Unreal in this container, so `--execute` cannot be run for real
here and this file does not pretend otherwise. What it DOES check is every
decision the importer makes before it touches the engine API -- which is where
all ninety-three assets' destinations, materials, data layers and Nanite and
collision requests are decided:

  * the plan covers the manifest exactly, asset for asset and mesh for mesh
  * every source file it names is on disk
  * every material path it names is one `materials_v2.py` actually defines
  * every data layer it names is one `v2_config.DATA_LAYERS` actually has
  * variants land in their own folder, and never beside their base
  * nothing lands outside the kit's own content root
  * Nanite is asked for by the MEASURED rule and not for everything
  * the plan says, in the file, that nothing has been imported

A stub `unreal` module then drives `--execute` far enough to prove the one
thing about execution that is checkable offline: that an import which produces
no asset paths is RECORDED as producing none, rather than passing silently.
"""

import io
import json
import os
import re
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)

PASS, FAIL = [], []


def ok(msg):
    PASS.append(msg)
    print("  ok   %s" % msg)


def bad(msg):
    FAIL.append(msg)
    print("  FAIL %s" % msg)


def check(cond, msg):
    (ok if cond else bad)(msg)
    return bool(cond)


def world_materials():
    src = os.path.join(REPO, "wonderland", "v2", "materials_v2.py")
    with io.open(src, encoding="utf8") as fh:
        return set(re.findall(r'"(MI_V2_[A-Za-z0-9_]+)"\s*:', fh.read()))


def data_layers():
    src = os.path.join(REPO, "wonderland", "v2", "v2_config.py")
    with io.open(src, encoding="utf8") as fh:
        text = fh.read()
    block = re.search(r"DATA_LAYERS\s*=\s*\(([^)]*)\)", text)
    return set(re.findall(r'"([A-Za-z0-9_]+)"', block.group(1))) if block else set()


def main():
    import import_kit as IK

    manifest = IK.read_manifest()
    plan = IK.build_plan(manifest)
    mats = world_materials()
    layers = data_layers()

    print("plan: %d assets, %d meshes" % (plan["counts"]["assets"],
                                          plan["counts"]["meshes"]))

    # ---- coverage ---------------------------------------------------------
    check(plan["counts"]["assets"] == len(manifest["assets"]),
          "the plan has one entry per manifest asset")
    want_meshes = sum(len(a.get("parts") or {}) for a in manifest["assets"])
    check(plan["counts"]["meshes"] == want_meshes,
          "the plan has one entry per manifest MESH (%d)" % want_meshes)
    check(plan["counts"]["missing_sources"] == 0,
          "every source file the plan names is on disk")

    # ---- the derivations --------------------------------------------------
    bad_mat = sorted({p["material_instance"] for a in plan["assets"]
                      for p in a["parts"]
                      if p["material_instance"] not in mats})
    check(not bad_mat,
          "every material is one materials_v2.py defines%s"
          % ("" if not bad_mat else " -- missing %s" % ", ".join(bad_mat)))

    bad_layer = sorted({a["data_layer"] for a in plan["assets"]
                        if a["data_layer"] not in layers})
    check(not bad_layer,
          "every data layer is one v2_config.DATA_LAYERS has%s"
          % ("" if not bad_layer else " -- unknown %s" % ", ".join(bad_layer)))

    outside = [a["destination_path"] for a in plan["assets"]
               if not a["destination_path"].startswith(IK.KIT_ROOT + "/")]
    check(not outside, "nothing lands outside %s" % IK.KIT_ROOT)

    variants = [a for a in plan["assets"] if a["variant_of"]]
    check(variants, "the plan contains weathered variants at all")
    check(all(a["destination_path"].endswith("/Weathered") for a in variants),
          "every variant lands in its family's Weathered folder")
    bases = {a["asset_id"]: a for a in plan["assets"] if not a["variant_of"]}
    check(all(v["variant_of"] in bases for v in variants),
          "every variant names a base that is also in the plan")
    check(all(v["destination_path"] != bases[v["variant_of"]]["destination_path"]
              for v in variants if v["variant_of"] in bases),
          "no variant lands in the same folder as its base")

    # ---- Nanite is a measurement, not a default ---------------------------
    nan = [a for a in plan["assets"] if a["nanite_requested"]]
    check(0 < len(nan) < len(plan["assets"]),
          "Nanite is asked for on SOME assets (%d of %d), not on all of them"
          % (len(nan), len(plan["assets"])))
    tris = {a["asset_id"]: sum(p["triangles"] or 0 for p in a["parts"])
            for a in plan["assets"]}
    smallest_yes = min((tris[a["asset_id"]] for a in nan), default=0)
    largest_no = max((tris[a["asset_id"]] for a in plan["assets"]
                      if not a["nanite_requested"]), default=0)
    check(smallest_yes > largest_no,
          "the Nanite line is a triangle threshold: smallest asked %d > "
          "largest not asked %d" % (smallest_yes, largest_no))

    # ---- the honesty the file is required to keep -------------------------
    check(plan["proven"]["imported_into_an_editor"] is False,
          "the plan states it has never been imported into an editor")
    check(plan["proven"]["nanite_verified"] is False
          and plan["proven"]["collision_verified"] is False,
          "the plan claims neither Nanite nor collision as verified")

    # ---- execution, against a stub that imports nothing -------------------
    calls = {"tasks": 0}

    class _Task(object):
        def __init__(self):
            self.props = {}

        def set_editor_property(self, k, v):
            self.props[k] = v

        def get_editor_property(self, k):
            return self.props.get(k)

    class _Tools(object):
        @staticmethod
        def import_asset_tasks(tasks):
            calls["tasks"] += len(tasks)

    stub = types.ModuleType("unreal")
    stub.AssetImportTask = _Task
    stub.AssetToolsHelpers = types.SimpleNamespace(get_asset_tools=lambda: _Tools)
    stub.EditorAssetLibrary = types.SimpleNamespace(
        load_asset=lambda p: None, save_asset=lambda p, **k: None)
    stub.SystemLibrary = types.SimpleNamespace(
        get_engine_version=lambda: "stub-engine")
    stub.log_warning = lambda m: None

    class _Missing(object):
        def __init__(self, *a, **k):
            raise RuntimeError("no Interchange pipeline in the stub")

    stub.InterchangeGenericAssetsPipeline = _Missing
    IK.unreal = stub

    small = dict(plan)
    small["assets"] = plan["assets"][:2]
    result = IK.execute(small)
    check(calls["tasks"] == sum(len(a["parts"]) for a in small["assets"]),
          "execute submits exactly one import task per mesh")
    check(result["counts"]["with_assets"] == 0
          and result["counts"]["empty"] == calls["tasks"],
          "an import that produced no asset paths is RECORDED as empty, not "
          "counted as a success")
    check(any("NO imported object paths" in n
              for r in result["results"] for n in r["notes"]),
          "and each empty import says so in its own notes")
    check(any("NANITE NOT APPLIED" in n
              for r in result["results"] for n in r["notes"]),
          "a refused Nanite option is written down rather than swallowed")

    print("\n%d ok, %d FAILED" % (len(PASS), len(FAIL)))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
