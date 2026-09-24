# WHAT IS WONDERLAND'S WATER MADE OF?
#
# All 64 ponds, streams, wells and fountain basins share one material instance, MI_V2_Water. Whether it can be
# made believable from code depends entirely on what its master exposes, so it is asked rather than assumed --
# a new master material cannot be authored from a script, but a parameter that already exists can be driven.
import unreal


def job():
    RESULT["status"] = "running"
    lib = unreal.MaterialEditingLibrary
    found = {}
    RESULT["materials"] = found
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    paths = []
    for hit in reg.get_assets_by_path("/Game", recursive=True):
        if str(hit.asset_name) in ("MI_V2_Water", "MI_water"):
            paths.append(str(hit.package_name) + "." + str(hit.asset_name))
    RESULT["found_paths"] = paths
    for path in paths:
        asset = unreal.load_asset(path)
        if asset is None:
            continue
        row = {"path": path, "class": asset.get_class().get_name()}
        parent = None
        try:
            parent = asset.get_editor_property("parent")
        except Exception:
            pass
        row["parent"] = parent.get_path_name() if parent is not None else "none"
        if parent is not None:
            try:
                row["scalar_params"] = [str(n) for n in lib.get_scalar_parameter_names(parent)]
                row["vector_params"] = [str(n) for n in lib.get_vector_parameter_names(parent)]
                row["texture_params"] = [str(n) for n in lib.get_texture_parameter_names(parent)]
                row["static_switches"] = [str(n) for n in lib.get_static_switch_parameter_names(parent)]
            except Exception as bad:
                row["param_error"] = str(bad)[:180]
            for prop in ("blend_mode", "shading_model", "two_sided"):
                try:
                    row[prop] = str(parent.get_editor_property(prop))
                except Exception:
                    pass
        found[path] = row
    if not found:
        # Not where it was guessed: find it by name instead.
        reg = unreal.AssetRegistryHelpers.get_asset_registry()
        hits = reg.get_assets_by_path("/Game", recursive=True)
        RESULT["searched"] = len(hits)
        names = [str(h.asset_name) for h in hits if "water" in str(h.asset_name).lower()]
        RESULT["water_assets"] = names[:20]
    RESULT["status"] = "probed"
    yield 0.1
