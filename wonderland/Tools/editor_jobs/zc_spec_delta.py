# APPLY A PROVEN SPEC DELTA IN PLACE: for each pass, the batches whose instances differ between the APPLIED spec
# (what the map holds) and the CORRECTED spec (what the fixed generator writes) get the corrected transforms.
#
# WHEN THIS IS THE RIGHT TOOL: only after the corrected generator has been shown to reproduce the applied spec with
# every batch, instance count, mesh and material identical, differing only in the transforms being fixed -- so the
# in-place edit IS the corrected world. (First use: the kerb runs, 2026-09-28: 800 along local X, local Y -62..+257
# with the stone at -Y; laid along the road and on the line each generator intended, 2,032 parts in ten passes.)
#
# GUARDS, all before the first write, all-or-nothing:
#   * every changed spec batch matches EXACTLY ONE actor: label "<pass>_<batch id>", the same mesh path, and the same
#     material (by name), at the origin, unrotated, unscaled;
#   * that actor's CURRENT transforms equal the applied spec's instances (count, and every float at float32
#     precision) -- a map that is not the one the proof was made on is not edited;
#   * the corrected batch has the same instance count.
# All floats are read back after each write. REVERSIBLE: the record holds every batch's old and new transforms.
# DRY = True changes nothing. SAVE as apply_layer: one save_map, refused if the map was dirty before this job.
CONCURRENT = False

import json

DRY = globals().get("DRY", True)
SAVE = globals().get("SAVE", False)
MAP_WAS_DIRTY_OK = globals().get("MAP_WAS_DIRTY_OK", False)
MAP = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"
#: [(pass id, applied spec path, corrected spec path)]
SPECS = globals().get("SPECS", [])
RECORD = globals().get("RECORD", r"C:\dev\iwonder\wonderland-task3\wonderland\WorldDesign\spec_delta_record.json")
N = 9


def flat(instances):
    out = []
    for i in instances:
        out.extend(float(v) for v in i[:N])
    return out


def same(a, b):
    return len(a) == len(b) and all(abs(x - y) <= 1e-3 * max(1.0, abs(y)) for x, y in zip(a, b))


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    RESULT["status"] = "running"
    RESULT["dry"] = bool(DRY)
    dirty_before = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    RESULT["map_dirty_before"] = dirty_before
    # the changed batches, from the two specs
    wanted = []
    for pas, applied_path, corrected_path in SPECS:
        old = json.load(open(applied_path, encoding="utf-8"))
        new = json.load(open(corrected_path, encoding="utf-8"))
        key = lambda b: (b["id"], b["mesh"], b["material"])                       # noqa: E731
        ob, nb = {key(b): b for b in old["batches"]}, {key(b): b for b in new["batches"]}
        if set(ob) != set(nb):
            RESULT["status"] = "aborted: %s batch sets differ between the specs -- not a transform-only delta" % pas
            return
        for k in ob:
            if ob[k]["instances"] == nb[k]["instances"]:
                continue
            if len(ob[k]["instances"]) != len(nb[k]["instances"]):
                RESULT["status"] = "aborted: %s %s instance counts differ" % (pas, k[0])
                return
            wanted.append((pas, k, flat(ob[k]["instances"]), flat(nb[k]["instances"])))
    RESULT["batches_to_change"] = len(wanted)
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    by_label = {}
    for a in eas.get_all_level_actors():
        if isinstance(a, unreal.WonderlandInstancedBatch):
            by_label.setdefault(a.get_actor_label(), []).append(a)
    plan = []
    for pas, (bid, mesh, mat), old_tf, new_tf in wanted:
        label = "%s_%s" % (pas, bid)
        cands = []
        for a in by_label.get(label, []):
            if str(a.get_editor_property("mesh_path")) != mesh:
                continue
            if str(a.get_editor_property("material_path")).split(".")[-1] != mat:
                continue
            cands.append(a)
        if len(cands) != 1:
            RESULT["status"] = "aborted: %s (%s, %s) matched %d actors, need exactly 1 -- nothing changed" % (
                label, mesh.split(".")[-1], mat, len(cands))
            return
        a = cands[0]
        loc, rot, scl = a.get_actor_location(), a.get_actor_rotation(), a.get_actor_scale3d()
        if (abs(loc.x) + abs(loc.y) + abs(loc.z) > 1.0 or abs(rot.yaw) + abs(rot.pitch) + abs(rot.roll) > 0.01
                or abs(scl.x - 1) + abs(scl.y - 1) + abs(scl.z - 1) > 1e-4):
            RESULT["status"] = "aborted: %s is not at the origin/unrotated/unscaled -- nothing changed" % label
            return
        cur = [float(v) for v in a.get_editor_property("transforms")]
        if not same(cur, old_tf):
            RESULT["status"] = "aborted: %s does not hold the applied spec's transforms -- nothing changed" % label
            return
        plan.append((pas, label, a, old_tf, new_tf))
    yield 0.0
    record = {"reason": globals().get("REASON", "a proven transform-only spec delta (see zc_spec_delta.py)"),
              "applied": not DRY, "passes": [s[0] for s in SPECS], "batches": []}
    changed = 0
    for pas, label, a, old_tf, new_tf in plan:
        try:
            package = str(a.get_outermost().get_name())
        except Exception as exc:                               # noqa: BLE001
            package = "unknown: %r" % exc
        record["batches"].append({"pass": pas, "label": label, "package": package, "instances": len(old_tf) // N,
                                  "old": old_tf, "new": new_tf})
        if not DRY:
            a.set_editor_property("transforms", new_tf)
            back = [float(v) for v in a.get_editor_property("transforms")]
            if not same(back, new_tf):
                RESULT["status"] = "FAILED: %s did not read back as written" % label
                return
        changed += len(old_tf) // N
        yield 0.0
    with open(RECORD, "w", encoding="utf-8") as f:
        json.dump(record, f)
    RESULT["record"] = RECORD
    RESULT["batches"] = len(plan)
    RESULT["instances"] = changed
    RESULT["by_pass"] = {}
    for pas, label, a, old_tf, new_tf in plan:
        RESULT["by_pass"][pas] = RESULT["by_pass"].get(pas, 0) + len(old_tf) // N
    RESULT["dirty"] = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    saved = False
    if SAVE and not DRY:
        if dirty_before and not MAP_WAS_DIRTY_OK:
            RESULT["save_refused"] = "the map had unsaved changes before this job: " + ", ".join(dirty_before)
        else:
            saved = bool(unreal.EditorLoadingAndSavingUtils.save_map(ues.get_editor_world(), MAP))
            RESULT["saved"] = saved
            RESULT["dirty_after_save"] = [p.get_name() for p in
                                          unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    RESULT["status"] = ("dry run: %d instances in %d batches would change" % (changed, len(plan)) if DRY
                        else "changed %d instances in %d batches (%s)" % (changed, len(plan),
                                                                         "saved" if saved else "unsaved"))
