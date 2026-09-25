# THE MATERIALS THAT WERE SILENTLY NOT BEING USED.
#
# FOUND IN THE EDITOR LOG, not by any proof:
#
#   Material /Game/Wonderland/Materials/M_WL_VoxelGlow missing usage flag Nanite!
#     Default Material will be used in game.
#   Material /Game/Wonderland/Materials/M_WL_VoxelGlow missing usage flag InstancedStaticMeshes!
#     Default Material will be used in game.
#   Material /Game/Wonderland/Materials/M_WLMaster missing usage flag Nanite!
#
# "Default Material will be used in game" is the whole problem. A material without the usage flag for the
# kind of mesh it is put on does not fail loudly -- the renderer quietly substitutes the grey engine default
# and carries on. M_WL_VoxelGlow is the glow every companion figure, every Project Avatar and (as zc_fire
# just established) every tongue of flame is drawn with, and it is applied to INSTANCED meshes, which is
# exactly the flag it was missing.
#
# WHY NO PROOF CAUGHT IT. zc_fire read the material NAME off the flame surface and found MID_M_WL_VoxelGlow,
# which is true and was never the question; the substitution happens further down, at render time, and
# leaves the material assignment intact. This is the same lesson as the packaging defects and the instanced
# world count -- a proof that reads the intent agrees with the intent.
#
# ADDITIVE AND NARROW. Two flags on materials this project authored itself; nothing else is touched, and the
# assets are saved so the warning does not simply return next launch ("the material will recompile every
# editor launch until resaved").
import unreal

#: The two flags, by their Python property names, with the engine's own flag name for the record.
WANT = [("used_with_nanite", "Nanite"), ("used_with_instanced_static_meshes", "InstancedStaticMeshes")]

TARGETS = [
    "/Game/Wonderland/Materials/M_WL_VoxelGlow",
    "/Game/Wonderland/Materials/M_WLMaster",
]


def job():
    RESULT["status"] = "running"
    fixed = []
    RESULT["materials"] = fixed

    for path in TARGETS:
        row = {"asset": path, "set": [], "already": [], "refused": []}
        fixed.append(row)
        if not unreal.EditorAssetLibrary.does_asset_exist(path):
            row["refused"].append("asset does not exist")
            continue
        mat = unreal.EditorAssetLibrary.load_asset(path)
        if mat is None:
            row["refused"].append("would not load")
            continue
        changed = False
        for prop, flag in WANT:
            try:
                if bool(mat.get_editor_property(prop)):
                    row["already"].append(flag)
                    continue
                mat.set_editor_property(prop, True)
                row["set"].append(flag)
                changed = True
            except Exception as err:                           # noqa: BLE001
                row["refused"].append("%s: %s" % (flag, err))
        if changed:
            try:
                unreal.MaterialEditingLibrary.recompile_material(mat)
            except Exception as err:                           # noqa: BLE001
                row["refused"].append("recompile: %s" % err)
            # SAVED, or the flag is lost and the warning returns on the next launch.
            row["saved"] = bool(unreal.EditorAssetLibrary.save_loaded_asset(mat, False))
        else:
            row["saved"] = None
        yield 0.5

    RESULT["status"] = "done"
    RESULT["log"] = "; ".join(
        "%s set=%s already=%s" % (r["asset"].rsplit("/", 1)[-1], r["set"], r["already"]) for r in fixed)
