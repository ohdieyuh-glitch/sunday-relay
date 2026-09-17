# Editor job: point material instances at a different HD texture family, reversibly (IV01 onward).
#
# The material-realism phase changes a SURFACE FAMILY at once: every instance that samples T_HD_<from>_{a,n,r} moves to
# T_HD_<to>_{a,n,r}. The instances keep their colour and tuning; only their maps change. Found by what they sample, not
# by a hand list, so a family is changed everywhere it is used.
#
# Every instance's before maps are written to RECORD before the change; REVERT = True restores them from RECORD, and
# refuses an instance whose maps are not the recorded "after" (someone changed it since). SAVE = False changes the
# loaded instances only -- captures see it, nothing on disk changes until SAVE = True.
# Optional SCALARS {param: value} applies to the swapped instances (recorded the same way).
# Globals: FROM_FAMILY, TO_FAMILY, IMPORT (import T_HD_<to>_* from TEX_DIR first), RECORD, REVERT, SAVE, SCALARS, ONLY.
import json
import os

FROM_FAMILY = globals().get("FROM_FAMILY")
TO_FAMILY = globals().get("TO_FAMILY")
IMPORT = globals().get("IMPORT", True)
RECORD = globals().get("RECORD")
REVERT = globals().get("REVERT", False)
SAVE = globals().get("SAVE", False)
SCALARS = globals().get("SCALARS", {})
ONLY = globals().get("ONLY", None)
TEX_DIR = r"C:/dev/iwonder/recovery/textures_hd"
TEX_DEST = "/Game/WonderlandV2/Textures/HD"
INST = "/Game/WonderlandV2/Materials/Instances"
SLOTS = (("Albedo", "a"), ("Normal", "n"), ("RoughnessMap", "r"))


def _import(stem):
    t = unreal.AssetImportTask()
    t.set_editor_property("filename", os.path.join(TEX_DIR, stem + ".png"))
    t.set_editor_property("destination_path", TEX_DEST)
    t.set_editor_property("destination_name", stem)
    t.set_editor_property("automated", True)
    t.set_editor_property("save", False)
    t.set_editor_property("replace_existing", True)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([t])
    tex = unreal.load_asset(TEX_DEST + "/" + stem)
    if stem.endswith("_n"):
        tex.set_editor_property("srgb", False)
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
    elif stem.endswith("_r"):
        tex.set_editor_property("srgb", False)
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_GRAYSCALE)
    else:
        tex.set_editor_property("srgb", True)
    unreal.EditorAssetLibrary.save_asset(TEX_DEST + "/" + stem, only_if_is_dirty=False)
    return tex


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    eal, mel = unreal.EditorAssetLibrary, unreal.MaterialEditingLibrary
    if REVERT:
        record = json.load(open(RECORD))
        done, refused = {}, []
        for name, rec in record["instances"].items():
            mi = unreal.load_asset("%s/%s.%s" % (INST, name, name))
            have = {slot: (mel.get_material_instance_texture_parameter_value(mi, slot).get_name()
                           if mel.get_material_instance_texture_parameter_value(mi, slot) else None) for slot, _ in SLOTS}
            if any(have[slot] != rec["after"][slot] for slot, _ in SLOTS):
                refused.append("%s maps %s are not the recorded after" % (name, have))
                continue
            for slot, _ in SLOTS:
                mel.set_material_instance_texture_parameter_value(mi, slot, unreal.load_asset(TEX_DEST + "/" + rec["before"][slot]))
            for p, v in rec.get("scalars_before", {}).items():
                mel.set_material_instance_scalar_parameter_value(mi, p, float(v))
            mel.update_material_instance(mi)
            if SAVE:
                eal.save_asset("%s/%s" % (INST, name), only_if_is_dirty=False)
            done[name] = "restored"
            yield None
        RESULT["reverted"] = done
        RESULT["refused"] = refused
        RESULT["status"] = "done"
        return
    to = {}
    for slot, suf in SLOTS:
        stem = "T_HD_%s_%s" % (TO_FAMILY, suf)
        to[slot] = _import(stem) if IMPORT or not eal.does_asset_exist(TEX_DEST + "/" + stem) else unreal.load_asset(TEX_DEST + "/" + stem)
        yield 0.5
    from_albedo = "T_HD_%s_a" % FROM_FAMILY
    record = {"from": FROM_FAMILY, "to": TO_FAMILY, "instances": {}}
    for path in eal.list_assets(INST, recursive=False, include_folder=False):
        name = path.split("/")[-1].split(".")[0]
        if ONLY and name not in ONLY:
            continue
        mi = unreal.load_asset(path)
        if not isinstance(mi, unreal.MaterialInstanceConstant):
            continue
        a = mel.get_material_instance_texture_parameter_value(mi, "Albedo")
        if not a or a.get_name() != from_albedo:
            continue
        before = {slot: (mel.get_material_instance_texture_parameter_value(mi, slot).get_name()
                         if mel.get_material_instance_texture_parameter_value(mi, slot) else None) for slot, _ in SLOTS}
        have = [str(p) for p in mel.get_scalar_parameter_names(mi)]
        sb = {p: mel.get_material_instance_scalar_parameter_value(mi, p) for p in SCALARS if p in have}
        for slot, _ in SLOTS:
            mel.set_material_instance_texture_parameter_value(mi, slot, to[slot])
        for p, v in SCALARS.items():
            if p in have:
                mel.set_material_instance_scalar_parameter_value(mi, p, float(v))
        mel.update_material_instance(mi)
        record["instances"][name] = {"before": before, "after": {slot: to[slot].get_name() for slot, _ in SLOTS},
                                     "scalars_before": sb}
        if SAVE:
            eal.save_asset("%s/%s" % (INST, name), only_if_is_dirty=False)
        yield None
    os.makedirs(os.path.dirname(RECORD), exist_ok=True)
    with open(RECORD, "w", newline="\n") as f:
        json.dump(record, f, indent=1)
    RESULT["swapped"] = sorted(record["instances"])
    RESULT["status"] = "done"
