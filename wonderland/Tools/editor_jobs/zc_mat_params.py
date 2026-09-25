# WHAT PARAMETERS DOES M_WL_VoxelGlow ACTUALLY HAVE?
#
# Painting the brain chamber white through this material produced a BLACK room twice -- once setting
# "Color", once setting Color, EmissiveColor, BaseColor and EmissiveStrength together. A material instance
# accepts any name and silently ignores one it does not have, so a wrong name is indistinguishable from a
# correct one with no effect. Rather than guess a third time, the material is asked.
CONCURRENT = True

import unreal


def job():
    RESULT["status"] = "running"
    out = {}
    for path in ("/Game/Wonderland/Materials/M_WL_VoxelGlow",
                 "/Game/Wonderland/Materials/M_WLMaster",
                 "/Game/Wonderland/Materials/M_WL_RealWater"):
        try:
            mat = unreal.EditorAssetLibrary.load_asset(path)
        except Exception as err:
            out[path] = {"error": str(err)[:90]}
            continue
        if mat is None:
            out[path] = {"loaded": False}
            continue
        row = {"loaded": True, "class": str(mat.get_class().get_name())}
        for kind, fn in (("vector", "get_vector_parameter_names"),
                         ("scalar", "get_scalar_parameter_names"),
                         ("texture", "get_texture_parameter_names"),
                         ("static_switch", "get_static_switch_parameter_names")):
            try:
                names = getattr(unreal.MaterialEditingLibrary, fn)(mat)
                row[kind] = [str(n) for n in names]
            except Exception as err:
                row[kind] = "ERR: %s" % str(err)[:70]
        try:
            row["shading_model"] = str(mat.get_editor_property("shading_model"))
            row["blend_mode"] = str(mat.get_editor_property("blend_mode"))
        except Exception:
            pass
        out[path] = row
    RESULT["materials"] = out
    RESULT["status"] = "probed"
    yield 0.1
