# Editor job: swap the material in one slot of named generator actors, reversibly (LL02 onward).
#
# A material TUNE changes every user of a shared instance -- MI_V2_Bronze is also shop and market metal, and the glass
# instances are every lit window. When only some actors should change, their slot must point at a different instance.
# Same discipline as apply_vegetation_trim.py: every swap names the actor by OBJECT name, carries its before material,
# nothing is written over a slot that does not hold the recorded before (someone changed it since), and REVERT puts
# every before back. SAVE = False previews; a save refuses when the map was dirty before the job unless
# MAP_WAS_DIRTY_OK.
# Spec: {"pass": ..., "swaps": [{"name", "label", "slot", "before", "after"}]} -- materials by instance name.
# Globals: SPEC, REVERT, SAVE, MAP_WAS_DIRTY_OK.
import json

SPEC = globals().get("SPEC")
REVERT = globals().get("REVERT", False)
SAVE = globals().get("SAVE", False)
MAP_WAS_DIRTY_OK = globals().get("MAP_WAS_DIRTY_OK", False)
INST = "/Game/WonderlandV2/Materials/Instances"


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    ELS = unreal.EditorLoadingAndSavingUtils
    dirty_before = [p.get_name() for p in ELS.get_dirty_map_packages()]
    with open(SPEC, encoding="utf-8") as f:
        spec = json.load(f)
    source, target = ("after", "before") if REVERT else ("before", "after")
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    by_name = {a.get_name(): a for a in eas.get_all_level_actors()}
    cache = {}
    changed, refused = 0, []
    for s in spec["swaps"]:
        actor = by_name.get(s["name"])
        if actor is None:
            refused.append("%s (%s): no such actor" % (s["name"], s["label"]))
            continue
        smc = actor.get_component_by_class(unreal.StaticMeshComponent)
        mats = smc.get_materials() if smc else []
        have = mats[s["slot"]].get_name() if len(mats) > s["slot"] and mats[s["slot"]] else None
        if have != s[source]:
            refused.append("%s (%s) slot %d holds %s, not the recorded %s" % (s["name"], s["label"], s["slot"], have, s[source]))
            continue
        name = s[target]
        if name not in cache:
            cache[name] = unreal.load_asset("%s/%s.%s" % (INST, name, name))
        if cache[name] is None:
            refused.append("%s did not load" % name)
            continue
        smc.set_material(s["slot"], cache[name])
        actor.modify()
        changed += 1
        if changed % 25 == 0:
            yield None
    RESULT["changed"] = changed
    RESULT["refused"] = refused
    save = SAVE and not refused and (not dirty_before or MAP_WAS_DIRTY_OK)
    if SAVE and not save:
        RESULT["save_refused"] = "refusals or a map already dirty before this job: %s" % dirty_before
    if save:
        RESULT["saved"] = bool(unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level())
    RESULT["status"] = "done"
