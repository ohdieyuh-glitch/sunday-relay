# Editor job: move material instances to another parent and set parameters, reversibly (GL01 onward).
#
# Some fixes need a parameter the instance's parent does not expose -- glass on M_V2_Surface has no NormalStrength, so
# its fine noise normal glitters under low roughness and there is no way to turn it off. This moves the instance to a
# parent that does (M_V2_SurfaceHD), keeps every value and map the instance had, then applies SET.
# The FULL before state (parent, every scalar, vector and texture) goes to RECORD first; REVERT = True restores it.
# SAVE = False changes the loaded instances only.
# SET values: a number (scalar), a list (vector), or a string (a texture's asset path).
# Globals: NAMES, PARENT (asset path), SET {name: {param: value}}, RECORD, REVERT, SAVE.
import json
import os

NAMES = globals().get("NAMES", [])
PARENT = globals().get("PARENT", "/Game/WonderlandV2/Materials/M_V2_SurfaceHD.M_V2_SurfaceHD")
SET = globals().get("SET", {})
RECORD = globals().get("RECORD")
REVERT = globals().get("REVERT", False)
SAVE = globals().get("SAVE", False)
INST = "/Game/WonderlandV2/Materials/Instances"


def _snapshot(mel, mi):
    return {"parent": mi.get_editor_property("parent").get_path_name() if mi.get_editor_property("parent") else None,
            "scalars": {str(p): mel.get_material_instance_scalar_parameter_value(mi, p) for p in mel.get_scalar_parameter_names(mi)},
            "vectors": {str(p): list(mel.get_material_instance_vector_parameter_value(mi, p).to_tuple()) for p in mel.get_vector_parameter_names(mi)},
            "textures": {str(p): (mel.get_material_instance_texture_parameter_value(mi, p).get_path_name()
                                  if mel.get_material_instance_texture_parameter_value(mi, p) else None)
                         for p in mel.get_texture_parameter_names(mi)}}


def _apply_values(mel, mi, snap):
    have_s = [str(p) for p in mel.get_scalar_parameter_names(mi)]
    have_v = [str(p) for p in mel.get_vector_parameter_names(mi)]
    have_t = [str(p) for p in mel.get_texture_parameter_names(mi)]
    for k, v in snap["scalars"].items():
        if k in have_s:
            mel.set_material_instance_scalar_parameter_value(mi, k, float(v))
    for k, v in snap["vectors"].items():
        if k in have_v:
            mel.set_material_instance_vector_parameter_value(mi, k, unreal.LinearColor(*v))
    for k, v in snap["textures"].items():
        if v and k in have_t:
            mel.set_material_instance_texture_parameter_value(mi, k, unreal.load_asset(v))


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    mel, eal = unreal.MaterialEditingLibrary, unreal.EditorAssetLibrary
    record = json.load(open(RECORD)) if (RECORD and os.path.exists(RECORD)) else {}
    done = {}
    for name in NAMES:
        mi = unreal.load_asset("%s/%s.%s" % (INST, name, name))
        if mi is None:
            done[name] = "missing"
            continue
        if REVERT:
            if name not in record:
                done[name] = "no record"
                continue
            snap = record[name]
            mel.set_material_instance_parent(mi, unreal.load_asset(snap["parent"]))
            _apply_values(mel, mi, snap)
            done[name] = "restored"
        else:
            if name not in record:
                record[name] = _snapshot(mel, mi)
            snap = record[name]
            mel.set_material_instance_parent(mi, unreal.load_asset(PARENT))
            _apply_values(mel, mi, snap)
            have = [str(p) for p in mel.get_scalar_parameter_names(mi)]
            for k, v in SET.get(name, {}).items():
                if isinstance(v, str):
                    mel.set_material_instance_texture_parameter_value(mi, k, unreal.load_asset(v))   # a texture by asset path
                elif isinstance(v, (list, tuple)):
                    mel.set_material_instance_vector_parameter_value(mi, k, unreal.LinearColor(*(list(v) + [1.0] * (4 - len(v)))))
                elif k in have:
                    mel.set_material_instance_scalar_parameter_value(mi, k, float(v))
            done[name] = "reparented"
        mel.update_material_instance(mi)
        if SAVE:
            eal.save_asset("%s/%s" % (INST, name), only_if_is_dirty=False)
        yield 0.3
    if RECORD and not REVERT:
        os.makedirs(os.path.dirname(RECORD), exist_ok=True)
        with open(RECORD, "w", newline="\n") as f:
            json.dump(record, f, indent=1)
    RESULT["done"] = done
    RESULT["status"] = "done"
