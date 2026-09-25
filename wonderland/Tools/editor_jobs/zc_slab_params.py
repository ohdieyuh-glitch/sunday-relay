# WHAT KNOBS DOES THE GROUND SLAB'S MATERIAL ACTUALLY HAVE?
#
# The flat green plane at 560 m is V2_GroundSlab: a Cube, scaled to cover the world, wearing MI_V2_Moss.
# A single material stretched across a slab that size gets roughly one texel per metre, which is exactly what
# "flat untextured green" looks like -- the texture is there and too big to see.
#
# Before changing anything I want the parameter names, because guessing at them is how the brain chamber
# ended up rendering black three times in a row: zc_mat_params confirmed the parameters existed and the
# material still ignored them, and I only found that out by asking.
CONCURRENT = True

import unreal

SLAB_MATERIAL = "MI_V2_Moss"
COMPARE = ("MI_V2_Lawn", "MI_V2_Cobble")


def describe(path):
    out = {"path": path}
    try:
        asset = unreal.EditorAssetLibrary.load_asset(path)
    except Exception as err:                                       # noqa: BLE001
        out["load_error"] = str(err)[:120]
        return out
    if asset is None:
        out["load_error"] = "not found"
        return out
    out["class"] = str(asset.get_class().get_name())
    try:
        parent = asset.get_editor_property("parent")
        out["parent"] = str(parent.get_name()) if parent is not None else None
    except Exception:
        pass
    for kind, getter in (("scalars", "get_scalar_parameter_names"),
                         ("vectors", "get_vector_parameter_names"),
                         ("textures", "get_texture_parameter_names")):
        try:
            names = getattr(unreal.MaterialEditingLibrary, getter)(asset)
            out[kind] = [str(n) for n in names]
        except Exception as err:                                   # noqa: BLE001
            out[kind + "_error"] = str(err)[:100]
    # And what those scalars are actually SET to, since a tiling knob at 1.0 is the whole story.
    values = {}
    for n in out.get("scalars", []):
        try:
            values[n] = round(float(unreal.MaterialEditingLibrary.get_material_instance_scalar_parameter_value(asset, n)), 4)
        except Exception:
            pass
    out["scalar_values"] = values
    return out


def job():
    RESULT["status"] = "running"
    found = {}
    RESULT["materials"] = found

    roots = ["/Game/WonderlandV2/Materials/", "/Game/WonderlandV2/Mat/", "/Game/WonderlandV2/",
             "/Game/Wonderland/Materials/"]
    names = [SLAB_MATERIAL] + list(COMPARE)

    # Find where they live rather than assuming a folder.
    located = {}
    try:
        registry = unreal.AssetRegistryHelpers.get_asset_registry()
        for data in registry.get_assets_by_path("/Game", recursive=True):
            n = str(data.asset_name)
            if n in names and n not in located:
                located[n] = str(data.package_name)
    except Exception as err:                                       # noqa: BLE001
        RESULT["registry_error"] = str(err)[:160]
    RESULT["located"] = located
    yield 0.2

    for n in names:
        path = located.get(n)
        if path is None:
            for root in roots:
                candidate = root + n
                if unreal.EditorAssetLibrary.does_asset_exist(candidate):
                    path = candidate
                    break
        if path is None:
            found[n] = {"load_error": "not located"}
            continue
        found[n] = describe(path)
        emit(n, "INFO", n, {k: v for k, v in found[n].items() if k in ("parent", "scalars", "scalar_values")})
        yield 0.1

    RESULT["status"] = "measured"
