# Editor job: apply (or REVERT) a vegetation trim spec -- wonderland/WorldDesign/**/veg*.json.
#
# A trim changes GENERATOR instances (batch transforms), which authored layers otherwise never do, so it is
# held to the look rule: every change carries its exact before transform, nothing is written over a value
# that is not the recorded one, and REVERT = True puts every before back. SAVE = False previews.
# The founder may be editing the map: a save refuses when the map had unsaved changes before this job
# (MAP_WAS_DIRTY_OK = True for this session's own preview).
import json

SPEC = globals().get("SPEC")
REVERT = globals().get("REVERT", False)
SAVE = globals().get("SAVE", True)
MAP_WAS_DIRTY_OK = globals().get("MAP_WAS_DIRTY_OK", False)
MAP = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"
TOL = 0.05


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
    # By OBJECT NAME: batch labels repeat across districts (VEG01's first preview matched the wrong batch).
    batches = [a for a in eas.get_all_level_actors() if isinstance(a, unreal.WonderlandInstancedBatch)]
    by_label = {a.get_name(): a for a in batches}
    by_label.update({"label:" + a.get_actor_label(): a for a in batches})
    grouped = {}
    for t in spec["trims"]:
        grouped.setdefault(t.get("name") or ("label:" + t["label"]), []).append(t)
    changed, refused = 0, []
    for label, trims in grouped.items():
        batch = by_label.get(label)
        if batch is None:
            refused.append("%s: batch not found" % label)
            continue
        tr = list(batch.get_editor_property("transforms"))
        ok = []
        for t in trims:
            i = t["index"] * 9
            have = tr[i:i + 9]
            if len(have) != 9 or max(abs(a - b) for a, b in zip(have, t[source])) > TOL:
                refused.append("%s[%d] is %s, expected %s" % (label, t["index"], [round(v, 2) for v in have], t[source]))
                continue
            ok.append(t)
        for t in ok:
            i = t["index"] * 9
            tr[i:i + 9] = [float(v) for v in t[target]]
            changed += 1
        if ok:
            batch.modify()
            batch.set_editor_property("transforms", tr)
        yield None
    RESULT.update({"pass": spec["pass"], "mode": "revert" if REVERT else "apply", "changed": changed, "refused": refused,
                   "map_dirty_before": dirty_before})
    yield 0.5
    if SAVE and changed and not refused:
        if dirty_before and not MAP_WAS_DIRTY_OK:
            RESULT["save_refused"] = "the map had unsaved changes before this trim"
        else:
            RESULT["saved"] = bool(ELS.save_map(ues.get_editor_world(), MAP))
    RESULT["status"] = "done"
