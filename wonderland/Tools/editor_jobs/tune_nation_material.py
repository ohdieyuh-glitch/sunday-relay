# Editor job: retune EXISTING material instances in place, without deleting them.
#
# WHY (2026-09-22). make_nation_materials.py with FORCE=True deletes the instance and rebuilds it. That is fine
# while a nation's materials are new and nothing references them. It is NOT fine once a quarter has been applied:
# MI_V2_TartarusCrimson was being drawn by 1,641 placed instances, and deleting a referenced material instance
# stalled the editor's tick -- the channel heartbeat froze mid-job and the job never returned.
#
# Tuning a colour is not a reason to destroy an asset. This sets scalar and vector parameters on the instance that
# is already there, which is instant, keeps every reference intact, and is reversible by running it again with the
# old numbers. Records the previous values so a revert is exact rather than remembered.
# Globals: PLAN {instance name: {"scalars": {...}, "vectors": {...}}}, RECORD, SAVE.
import json
import os

PLAN = globals().get("PLAN", {})
RECORD = globals().get("RECORD")
SAVE = globals().get("SAVE", True)
INST = "/Game/WonderlandV2/Materials/Instances"


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    before, done = {}, {}
    for name, spec in PLAN.items():
        path = "%s/%s" % (INST, name)
        mi = eal.load_asset(path)
        if mi is None:
            done[name] = "missing"
            continue
        prior = {"scalars": {}, "vectors": {}}
        for k, v in spec.get("scalars", {}).items():
            try:
                prior["scalars"][k] = float(mel.get_material_instance_scalar_parameter_value(mi, k))
            except Exception:
                pass
            mel.set_material_instance_scalar_parameter_value(mi, k, float(v))
        for k, v in spec.get("vectors", {}).items():
            try:
                c = mel.get_material_instance_vector_parameter_value(mi, k)
                prior["vectors"][k] = [round(c.r, 5), round(c.g, 5), round(c.b, 5)]
            except Exception:
                pass
            mel.set_material_instance_vector_parameter_value(
                mi, k, unreal.LinearColor(*(list(v) + [1.0] * (4 - len(v)))))
        mel.update_material_instance(mi)
        if SAVE:
            eal.save_asset(path, only_if_is_dirty=False)
        before[name] = prior
        done[name] = "tuned"
        yield 0.1
    if RECORD:
        os.makedirs(os.path.dirname(RECORD), exist_ok=True)
        with open(RECORD, "w", newline="\n") as f:
            json.dump(before, f, indent=1)
    RESULT["tuned"] = done
    RESULT["previous"] = before
    RESULT["status"] = "done"
