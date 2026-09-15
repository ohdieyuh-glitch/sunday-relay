# Editor job: set scalar parameters on material instances, reversibly (MQ06 gold tuning and later tunes).
#
# Every instance's prior value of every parameter it touches is written to RECORD before the change; REVERT = True
# restores the recorded values. SAVE = False changes the loaded instances only (captures see them; nothing on disk
# changes until a SAVE = True run or an editor save).
# Globals: TUNE ({instance name: {param: value}}), RECORD, REVERT, SAVE.
import json
import os

TUNE = globals().get("TUNE", {})
RECORD = globals().get("RECORD")
REVERT = globals().get("REVERT", False)
SAVE = globals().get("SAVE", False)
INST = "/Game/WonderlandV2/Materials/Instances"


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    mel = unreal.MaterialEditingLibrary
    record = json.load(open(RECORD)) if (RECORD and os.path.exists(RECORD)) else {}
    done = {}
    names = list(record) if REVERT else list(TUNE)
    for name in names:
        mi = unreal.load_object(None, "%s/%s.%s" % (INST, name, name))
        if mi is None:
            done[name] = "missing"
            continue
        if REVERT:
            values = record[name]
        else:
            before = record.setdefault(name, {})
            for p in TUNE[name]:
                if p not in before:
                    before[p] = mel.get_material_instance_scalar_parameter_value(mi, p)
            values = TUNE[name]
        for p, v in values.items():
            mel.set_material_instance_scalar_parameter_value(mi, p, float(v))
        mel.update_material_instance(mi)
        if SAVE:
            unreal.EditorAssetLibrary.save_asset("%s/%s" % (INST, name), only_if_is_dirty=False)
        done[name] = values
    if RECORD and not REVERT:
        os.makedirs(os.path.dirname(RECORD), exist_ok=True)
        with open(RECORD, "w") as f:
            json.dump(record, f, indent=1)
    RESULT["applied"] = done
    RESULT["status"] = "done"
