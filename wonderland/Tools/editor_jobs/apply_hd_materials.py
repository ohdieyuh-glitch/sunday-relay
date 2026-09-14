# Editor job: MQ01 apply -- move the world's V2 material instances onto the HD master, reversibly.
#
# Every mesh in the world keeps its material ASSIGNMENT (MI_V2_PlazaCream stays MI_V2_PlazaCream on every batch and
# actor); what changes is the instance itself: its parent becomes M_V2_SurfaceHD and it takes the values and maps of
# its tuned twin MI_V2HD_<name>. So the whole world moves at once, and nothing in the map is edited.
#
# REVERSIBLE. Before touching an instance the job writes its parent, every scalar/vector/texture parameter value and
# the twin it copied to RECORD (json). REVERT = True puts each instance back exactly as recorded. A second apply
# refuses an instance that is already on the HD master unless the record for it exists.
# The founder may have these instances loaded in an open editor: run only when no one is using the editor.
# Globals: ONLY (list of MI_V2_ names, default every instance with a twin), REVERT, RECORD.
import json
import os

ONLY = globals().get("ONLY", None)
REVERT = globals().get("REVERT", False)
RECORD = globals().get("RECORD", r"C:/dev/iwonder/recovery/evidence/2026-09-13-MQ01/hd_apply_record.json")
INST = "/Game/WonderlandV2/Materials/Instances"
MASTER = "/Game/WonderlandV2/Materials/M_V2_SurfaceHD.M_V2_SurfaceHD"


def _snapshot(mel, mi):
    return {"parent": mi.get_editor_property("parent").get_path_name() if mi.get_editor_property("parent") else None,
            "scalars": {str(p): mel.get_material_instance_scalar_parameter_value(mi, p) for p in mel.get_scalar_parameter_names(mi)},
            "vectors": {str(p): list(mel.get_material_instance_vector_parameter_value(mi, p).to_tuple()) for p in mel.get_vector_parameter_names(mi)},
            "textures": {str(p): (mel.get_material_instance_texture_parameter_value(mi, p).get_path_name()
                                  if mel.get_material_instance_texture_parameter_value(mi, p) else None)
                         for p in mel.get_texture_parameter_names(mi)}}


def _restore(mel, mi, snap):
    mel.set_material_instance_parent(mi, unreal.load_asset(snap["parent"]))
    for k, v in snap["scalars"].items():
        mel.set_material_instance_scalar_parameter_value(mi, k, float(v))
    for k, v in snap["vectors"].items():
        mel.set_material_instance_vector_parameter_value(mi, k, unreal.LinearColor(*v))
    for k, v in snap["textures"].items():
        if v:
            mel.set_material_instance_texture_parameter_value(mi, k, unreal.load_asset(v))


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    mel = unreal.MaterialEditingLibrary
    eal = unreal.EditorAssetLibrary
    record = json.load(open(RECORD)) if os.path.exists(RECORD) else {}
    master = unreal.load_asset(MASTER)
    changed, skipped = [], []
    names = ONLY or sorted(n.replace("MI_V2HD_", "MI_V2_") for n in
                           (str(a).split(".")[-1] for a in eal.list_assets(INST, recursive=False)) if n.startswith("MI_V2HD_"))
    for name in names:
        mi = unreal.load_asset("%s/%s.%s" % (INST, name, name))
        if mi is None:
            skipped.append([name, "no instance"])
            continue
        if REVERT:
            if name not in record:
                skipped.append([name, "no record"])
                continue
            _restore(mel, mi, record[name]["before"])
            record.pop(name)
        else:
            twin_name = name.replace("MI_V2_", "MI_V2HD_")
            twin = unreal.load_asset("%s/%s.%s" % (INST, twin_name, twin_name))
            if twin is None:
                skipped.append([name, "no twin"])
                continue
            parent = mi.get_editor_property("parent")
            if parent is not None and parent.get_path_name() == master.get_path_name():
                skipped.append([name, "already on the HD master"])
                continue
            record[name] = {"before": _snapshot(mel, mi), "twin": twin_name}
            with open(RECORD, "w") as f:
                json.dump(record, f, indent=1)
            _restore(mel, mi, dict(_snapshot(mel, twin), parent=master.get_path_name()))
        mel.update_material_instance(mi)
        yield 1.0
        eal.save_asset("%s/%s" % (INST, name), only_if_is_dirty=False)
        changed.append(name)
        yield 2.0
    os.makedirs(os.path.dirname(RECORD), exist_ok=True)
    with open(RECORD, "w") as f:
        json.dump(record, f, indent=1)
    RESULT.update({"mode": "revert" if REVERT else "apply", "changed": changed, "skipped": skipped, "record": RECORD, "status": "done"})
