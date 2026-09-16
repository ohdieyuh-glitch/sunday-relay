# Editor job: set parameters on material instances, reversibly (MQ06 gold tuning, SC01 street colour, later tunes).
#
# Every instance's prior value of every parameter it touches is written to RECORD before the change; REVERT = True
# restores the recorded values. SAVE = False changes the loaded instances only (captures see them; nothing on disk
# changes until a SAVE = True run or an editor save).
#
# A value may be a number (a scalar parameter) or a list of three or four numbers (a vector parameter such as
# BaseColor). Colour was added for SC01, whose whole point is tint: a scalar-only tuner cannot warm a grey wall.
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

    def read(mi, p, like):
        if isinstance(like, (list, tuple)):
            c = mel.get_material_instance_vector_parameter_value(mi, p)
            return [c.r, c.g, c.b, c.a]
        return mel.get_material_instance_scalar_parameter_value(mi, p)

    def write(mi, p, v):
        if isinstance(v, (list, tuple)):
            vals = list(v) + [1.0] * (4 - len(v))
            mel.set_material_instance_vector_parameter_value(mi, p, unreal.LinearColor(*[float(x) for x in vals[:4]]))
        else:
            mel.set_material_instance_scalar_parameter_value(mi, p, float(v))

    for name in names:
        mi = unreal.load_object(None, "%s/%s.%s" % (INST, name, name))
        if mi is None:
            done[name] = "missing"
            continue
        if REVERT:
            values = record[name]
        else:
            before = record.setdefault(name, {})
            for p, v in TUNE[name].items():
                if p not in before:
                    before[p] = read(mi, p, v)
            values = TUNE[name]
        for p, v in values.items():
            write(mi, p, v)
        mel.update_material_instance(mi)
        if SAVE:
            unreal.EditorAssetLibrary.save_asset("%s/%s" % (INST, name), only_if_is_dirty=False)
        done[name] = values
        yield 0.0
    if RECORD and not REVERT:
        os.makedirs(os.path.dirname(RECORD), exist_ok=True)
        with open(RECORD, "w") as f:
            json.dump(record, f, indent=1)
    RESULT["applied"] = done
    RESULT["status"] = "done"
