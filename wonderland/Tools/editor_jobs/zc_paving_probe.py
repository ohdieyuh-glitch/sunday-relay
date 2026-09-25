# CAN THE NATIONS' OWN PAVING VARY, WITHOUT CHANGING THEIR PALETTES?
#
# WORLD_BETA_LEDGER blocker 4 / row E: the districts were fixed by moving tint variation INSIDE one material --
# MI_V2_PlazaVaried on M_V2_SurfaceHD, "whose InstVary / InstWarm / InstRoughVary hash each instance's own
# world position into brightness, warmth and roughness". Row E's remaining gap: "Nation avenues still use one
# mesh (SM_terrace_platform) and are not yet addressed."
#
# Swapping the nations onto MI_V2_PlazaVaried would flatten three distinct palettes into one, which the canon
# forbids. So the question is whether their OWN paving instances sit on the same master and can carry the same
# per-instance hash. Asked, not assumed.
import unreal

WANTED = ("MI_V2_GroundFlag_PlazaGrey", "MI_V2_GroundFlag_PlazaShade", "MI_V2_PlazaVaried",
          "MI_V2_PlazaCream", "MI_V2_PlazaWarm", "MI_V2_IcarusPaving", "MI_V2_NoctisObsidian",
          "MI_V2_TartarusPaving")


def job():
    RESULT["status"] = "running"
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    lib = unreal.MaterialEditingLibrary
    out = {}
    RESULT["materials"] = out
    for hit in reg.get_assets_by_path("/Game", recursive=True):
        name = str(hit.asset_name)
        if name not in WANTED:
            continue
        asset = unreal.load_asset(str(hit.package_name) + "." + name)
        if asset is None:
            continue
        row = {"class": asset.get_class().get_name()}
        parent = None
        try:
            parent = asset.get_editor_property("parent")
        except Exception:
            pass
        row["parent"] = parent.get_name() if parent is not None else "none"
        if parent is not None:
            try:
                row["scalars"] = [str(n) for n in lib.get_scalar_parameter_names(parent)]
            except Exception:
                pass
        # What the instance itself currently overrides for the variation controls.
        for p in ("InstVary", "InstWarm", "InstRoughVary", "MacroVary", "RoughVary"):
            try:
                row[p] = round(float(lib.get_material_instance_scalar_parameter_value(asset, p)), 4)
            except Exception:
                pass
        out[name] = row
    RESULT["status"] = "probed"
    yield 0.1
