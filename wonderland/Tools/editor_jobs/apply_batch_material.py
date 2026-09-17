# Editor job: point generator instanced batches at a different material, reversibly (GR02 onward).
#
# A WonderlandInstancedBatch draws every instance with one material: its Material object property (MaterialPath is the
# human-readable record and the fallback). apply_actor_materials.py cannot reach instances, so a pass that must restyle a
# batch changes the batch's material. Same discipline as the actor swaps: by OBJECT name, the recorded before must be
# what the batch holds (both Material and MaterialPath), REVERT restores it, SAVE = False previews.
# set_editor_property notifies the actor, whose PostEditChangeProperty rebuilds its editor preview.
# Spec: {"pass": ..., "swaps": [{"name", "label", "before", "after"}]} -- instance names.
# Globals: SPEC, REVERT, SAVE.
import json

SPEC = globals().get("SPEC")
REVERT = globals().get("REVERT", False)
SAVE = globals().get("SAVE", False)
INST = "/Game/WonderlandV2/Materials/Instances"


def _path(name):
    return "%s/%s.%s" % (INST, name, name)


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    with open(SPEC, encoding="utf-8") as f:
        spec = json.load(f)
    source, target = ("after", "before") if REVERT else ("before", "after")
    world = ues.get_editor_world()
    by_name = {b.get_name(): b for b in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch)}
    changed, refused = [], []
    for s in spec["swaps"]:
        b = by_name.get(s["name"])
        if b is None:
            refused.append("%s (%s): no such batch" % (s["name"], s["label"]))
            continue
        m = b.get_editor_property("material")
        have = m.get_name() if m else None
        if have != s[source]:
            refused.append("%s (%s) holds %s, not the recorded %s" % (s["name"], s["label"], have, s[source]))
            continue
        mat = unreal.load_asset(_path(s[target]))
        if mat is None:
            refused.append("%s did not load" % s[target])
            continue
        b.modify()
        b.set_editor_property("material_path", _path(s[target]))
        b.set_editor_property("material", mat)
        changed.append(s["label"])
        yield 0.5
    RESULT["changed"] = changed
    RESULT["refused"] = refused
    if SAVE and not refused:
        RESULT["saved"] = bool(unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level())
    RESULT["status"] = "done"
