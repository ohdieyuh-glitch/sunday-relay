# GIVE THE NATION AVENUES THE VARIATION THE DISTRICTS ALREADY HAVE.
#
# WORLD_BETA_LEDGER blocker 4 / row E. The districts were fixed by moving variation INSIDE one material:
# MI_V2_PlazaVaried on M_V2_SurfaceHD, "whose InstVary / InstWarm / InstRoughVary hash each instance's own
# world position into brightness, warmth and roughness, so every slab still differs from its neighbours."
# Row E's open gap: "Nation avenues still use one mesh (SM_terrace_platform) and are not yet addressed."
#
# MEASURED: every paving instance in the project already sits on M_V2_SurfaceHD, and the master already
# exposes those three controls. MI_V2_PlazaVaried runs 0.20 / 0.12 / 0.16. Every other paving instance --
# including the GroundFlag pair the nation avenues actually use -- is still on the default 0.08 / 0.03 / 0.10,
# which is why an avenue reads as one continuous slab.
#
# So this raises the three controls on GROUND materials only, and changes nothing else: each nation keeps its
# own BaseColor, its own mesh and its own geometry. Only the per-instance spread moves.
#
# GROUND ONLY, DELIBERATELY. The same controls on a wall material would speckle buildings, so the match is on
# names that mean floor -- paving, plaza, groundflag, cobble, terrace, avenue -- and never on stone or obsidian
# in general, which clad walls too.
import json
import os

VARIED = {"InstVary": 0.20, "InstWarm": 0.12, "InstRoughVary": 0.16}
FLOOR_WORDS = ("paving", "plaza", "groundflag", "cobble", "terrace", "avenue", "flag")
LEDGER = os.path.join(os.path.dirname(CHANNEL), "paving_varied.json")


def job():
    RESULT["status"] = "running"
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    lib = unreal.MaterialEditingLibrary
    changed, skipped = [], 0

    for hit in reg.get_assets_by_path("/Game", recursive=True):
        name = str(hit.asset_name)
        low = name.lower()
        if not low.startswith("mi_"):
            continue
        if not any(w in low for w in FLOOR_WORDS):
            continue
        asset = unreal.load_asset(str(hit.package_name) + "." + name)
        if asset is None or asset.get_class().get_name() != "MaterialInstanceConstant":
            continue
        parent = None
        try:
            parent = asset.get_editor_property("parent")
        except Exception:
            pass
        if parent is None or parent.get_name() != "M_V2_SurfaceHD":
            skipped += 1
            continue
        before = {}
        already = True
        for p, want in VARIED.items():
            try:
                before[p] = round(float(lib.get_material_instance_scalar_parameter_value(asset, p)), 4)
            except Exception:
                before[p] = None
            if before[p] is None or abs(before[p] - want) > 0.001:
                already = False
        if already:
            skipped += 1
            continue
        for p, want in VARIED.items():
            lib.set_material_instance_scalar_parameter_value(asset, p, want)
        unreal.EditorAssetLibrary.save_loaded_asset(asset)
        changed.append({"name": name, "before": before, "after": dict(VARIED)})

    RESULT["varied_count"] = len(changed)
    RESULT["skipped"] = skipped
    RESULT["changed"] = changed[:30]
    try:
        with open(LEDGER, "w", encoding="utf-8") as out:
            json.dump(changed, out, indent=1)
        RESULT["ledger"] = LEDGER
    except Exception as bad:
        RESULT["ledger_error"] = str(bad)[:140]
    RESULT["status"] = "varied"
    yield 0.1
