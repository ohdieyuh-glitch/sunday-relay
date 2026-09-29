# Globals (prepend before queueing): PLAN = a json {"passes": [...], "batches": {pass: n}} of the passes and their
# expected tree-batch counts; OUT = where the dirtied package names are written (the save gate's modified_record);
# optional OLD / NEW cull (cm). First used by SECOND's window 5d (2026-09-29); the gate requires EXACTLY the recorded set.
PLAN = globals().get("PLAN")
OUT = globals().get("OUT")
# Editor job (writes the editor world, saves NOTHING -- the window's gated save does): the tree cull 260 m -> 600 m.
#
# CORE's decision (2026-09-29, after the zzW429 A/B): 14,699 of the world's tree instances culled at 260 m, so inside
# the 512 m streaming radius more than half of what is loaded was never drawn. This sets cull_distance on the EXISTING
# batch actors of SECOND's passes (the wild ring, its densify, sector fills 2 / 3, W270) -- trunk and canopy meshes only,
# and only where the cull is exactly 260 m -- and records every package it dirties, so the save gate can hold the
# window to exactly these edits. The runtime instances read cull_distance when they are built, so the saved property
# is the change; the specs are updated to match so a re-apply keeps it.
import json
from collections import Counter

OLD = globals().get("OLD", 26000.0)
NEW = globals().get("NEW", 60000.0)


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    plan = json.load(open(PLAN))
    passes = set(plan["passes"])
    world = ues.get_editor_world()
    changed, per_pass, skipped = [], Counter(), Counter()
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        tags = [str(t) for t in a.tags]
        pid = next((t[len("WL_PASS_"):] for t in tags if t.startswith("WL_PASS_")), None)
        if pid not in passes:
            continue
        # TREES ONLY, by the asset's own name: a case-insensitive "canopy" also caught WL_Market_Canopy* (market-stall
        # awnings) -- 10 W270T batches in SECOND's window 5d, reverted before the save
        name = str(a.get_editor_property("mesh_path")).split(".")[-1]
        if not name.startswith(("SM_tree_", "SM_canopy_")):
            continue
        cd = float(a.get_editor_property("cull_distance"))
        if abs(cd - OLD) > 1.0:
            skipped["cull_%d" % int(cd)] += 1
            continue
        a.modify()
        a.set_editor_property("cull_distance", NEW)
        changed.append(a.get_outermost().get_name())
        per_pass[pid] += 1
    json.dump(sorted(changed), open(OUT, "w"), indent=0)
    RESULT["changed"] = len(changed)
    RESULT["per_pass_mismatch"] = {k: (per_pass.get(k, 0), v) for k, v in plan["batches"].items() if per_pass.get(k, 0) != v}
    RESULT["skipped"] = dict(skipped)
    RESULT["dirty_after"] = len(unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages())
    RESULT["status"] = "done" if not RESULT["per_pass_mismatch"] else "mismatch"
    yield 0.0
