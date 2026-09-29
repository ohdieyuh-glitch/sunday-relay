# DESIGNED HEDGE GATES (founder decision 2026-09-29): apply one window's hedge_gate_plan_<w>.json -- relocate the V2
# hedge-mass instances that cross a gate corridor, or trim one by SINK_UU where no relocation clears.
#
# Generalised from zc_w270_hedge_gate.py (same guards): each instance is found by its planned current transform,
# exactly ONE match per action or the whole job aborts and changes nothing; the exact nine floats before and after
# are written to the RECORD, so putting "old" back restores the ring. x, y, yaw change for a relocation, z for a
# trim (z - 100,000: the SINK_UU convention). Nothing is deleted. DRY = True reports the matches and writes nothing.
# No save: the save comes with the window's layer applies (one save per editor session).
# Set before queueing: PLAN, RECORD (absolute paths), DRY.
CONCURRENT = False

import json
import os

DRY = globals().get("DRY", False)
PLAN = globals().get("PLAN", r"C:\dev\iwonder\wonderland-task3\wonderland\WorldDesign\Rings\hedge_gate_plan_2a.json")
RECORD = globals().get("RECORD", PLAN.replace("_plan_", "_record_"))
TOL_XY = 6.0          # cm: the census the plan came from writes whole centimetres
TOL_YAW = 1.0         # degrees: and whole degrees
N = 9


def ydiff(a, b):
    return abs(((a - b) + 180.0) % 360.0 - 180.0)


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    RESULT["status"] = "running"
    RESULT["dry"] = bool(DRY)
    with open(PLAN, encoding="utf-8") as f:
        plan = json.load(f)
    owners = set(m["batch_owner"] for m in plan["moves"])
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    batches = {}
    for a in eas.get_all_level_actors():
        if isinstance(a, unreal.WonderlandInstancedBatch) and a.get_actor_label() in owners:
            batches.setdefault(a.get_actor_label(), []).append(a)
    RESULT["batches_found"] = {k: len(v) for k, v in batches.items()}

    found = []
    for m in plan["moves"]:
        old = m["old_approx"]
        cands = []
        for actor in batches.get(m["batch_owner"], []):
            loc, rot, scl = actor.get_actor_location(), actor.get_actor_rotation(), actor.get_actor_scale3d()
            if (abs(loc.x) + abs(loc.y) + abs(loc.z) > 1.0 or abs(rot.yaw) + abs(rot.pitch) + abs(rot.roll) > 0.01
                    or abs(scl.x - 1) + abs(scl.y - 1) + abs(scl.z - 1) > 1e-4):
                RESULT["status"] = "aborted: batch %s is not at the origin/unrotated/unscaled -- local is not world" \
                                   % actor.get_actor_label()
                return
            tf = list(actor.get_editor_property("transforms"))
            for i in range(len(tf) // N):
                b = i * N
                if abs(tf[b] - old["x"]) <= TOL_XY and abs(tf[b + 1] - old["y"]) <= TOL_XY \
                        and ydiff(tf[b + 4], old["yaw"]) <= TOL_YAW:
                    cands.append((actor, i, [float(v) for v in tf[b:b + N]]))
        if len(cands) != 1:
            RESULT["status"] = "aborted: %s matched %d instances (need exactly 1) -- nothing moved" % (m["which"], len(cands))
            RESULT["candidates"] = [(c[0].get_actor_label(), c[1], c[2]) for c in cands]
            return
        found.append((m, cands[0]))

    record = {"reason": plan["reason"], "approved_by": "founder decision 2026-09-29 (designed hedge gates)",
              "applied": not DRY, "moves": []}
    for m, (actor, i, old9) in found:
        new9 = list(old9)
        # yaw = the hedge's OWN exact yaw plus the planned turn (0 or 90): the plan rounded yaws to 0.1 deg, and
        # taking its value would have twisted each hedge by a fraction of a degree nobody asked for
        new9[0], new9[1] = float(m["new"]["x"]), float(m["new"]["y"])
        if m.get("action", "relocate") != "relocate":
            new9[0], new9[1] = old9[0], old9[1]     # TRIM keeps the hedge's own exact x, y (the plan rounds to 1 cm)
            new9[2] = old9[2] - 100000.0           # and sinks it by SINK_UU from its own exact height
        new9[4] = (old9[4] + float(m.get("turned_deg", 0.0))) % 360.0
        record["moves"].append({"which": m["which"], "action": m.get("action", "relocate"), "batch": actor.get_actor_label(), "index": i,
                                "old": old9, "new": new9})
        if not DRY:
            tf = list(actor.get_editor_property("transforms"))
            if [float(v) for v in tf[i * N:(i + 1) * N]] != old9:
                RESULT["status"] = "aborted: %s changed between read and write" % m["which"]
                return
            tf[i * N:(i + 1) * N] = new9
            actor.set_editor_property("transforms", tf)
            back = [float(v) for v in list(actor.get_editor_property("transforms"))[i * N:(i + 1) * N]]
            # Transforms is TArray<float>: compare at float32 precision. The first run compared 64-bit values
            # exactly, failed B's yaw (167.9419 + 90 is 257.94189453125 as float32) AFTER both writes had
            # succeeded, and stopped before writing the reversible record.
            if any(abs(b_ - n_) > 1e-3 * max(1.0, abs(n_)) for b_, n_ in zip(back, new9)):
                RESULT["status"] = "FAILED: %s did not read back as written" % m["which"]
                return
        yield 0.1
    with open(RECORD, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=1)
    RESULT["record"] = RECORD
    RESULT["moves"] = record["moves"]
    RESULT["status"] = "dry run: exactly one match per move" if DRY else "moved (unsaved)"
