# RESIDENCY + CULL READ-BACK (CORE 2026-09-29, window 2F): proof class TELEPORT.
#
# For each pass in PASSES a stand is taken over the centroid of the pass's instances (from its spec): the Dog is held
# 25 m up with movement off, FlushLevelStreaming, and the stand waits for World Partition streaming to complete. It then
# counts, in the PIE world, the pass's WonderlandInstancedBatch actors and their BuiltInstances against the spec -- the
# pass is resident when every declared batch is there and built.
# At every stand it also reads back the tree cull of CULL_PASSES' loaded trunk / canopy batches: the actor's
# cull_distance and the runtime component's InstanceEndCullDistance. After the in-place edit none may be left at 26000.
# Globals: PASSES = {pass id: spec path}; CULL_PASSES = [pass ids]. PIE-owning: CONCURRENT is False.
CONCURRENT = False
import json
import math

L = unreal.WonderlandUiTestLibrary
PASSES = globals().get("PASSES", {})
CULL_PASSES = set(globals().get("CULL_PASSES", []))


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    RESULT["status"] = "running"
    RESULT["proof_class"] = "TELEPORT (one hovering stand per pass, streaming complete)"
    L.set_background_throttle_suspended(True)
    try:
        yield from _run(ues, les)
    finally:
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
            while ues.get_game_world() is not None:
                yield 1.0


def _run(ues, les):
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    t = 0.0
    while ues.get_game_world() is None and t < 60.0:
        yield 1.0
        t += 1.0
    world = lambda: ues.get_game_world()
    pawn = lambda: unreal.GameplayStatics.get_player_pawn(world(), 0) if world() is not None else None
    t = 0.0
    while pawn() is None and t < 30.0:
        yield 0.5
        t += 0.5
    if pawn() is None:
        RESULT["status"] = "BLOCKED: no pawn"
        return
    stands, cull = [], {"at_60000": 0, "at_26000": 0, "other": {}, "runtime_end": {}}
    RESULT["stands"] = stands
    RESULT["cull_readback"] = cull
    seen_cull = set()
    for pid, spec_path in PASSES.items():
        spec = json.load(open(spec_path, encoding="utf-8"))
        pts = [(i[0], i[1]) for b in spec["batches"] for i in b["instances"]]
        want_b = len([b for b in spec["batches"] if b["instances"]])
        want_i = len(pts)
        cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        dog = pawn()
        dog.character_movement.disable_movement()
        dog.set_actor_location(unreal.Vector(cx, cy, 2500.0), False, True)
        unreal.SystemLibrary.execute_console_command(world(), "FlushLevelStreaming")
        t, done = 0.0, False
        while t < 40.0:
            yield 0.5
            t += 0.5
            try:
                if L.is_world_partition_streaming_complete(world()):
                    done = True
                    break
            except Exception:                                          # noqa: BLE001
                break
        yield 1.0
        n_b, n_i = 0, 0
        for a in unreal.GameplayStatics.get_all_actors_of_class(world(), unreal.WonderlandInstancedBatch):
            tags = [str(x) for x in a.tags]
            pid_a = next((x[len("WL_PASS_"):] for x in tags if x.startswith("WL_PASS_")), None)
            if pid_a == pid:
                n_b += 1
                n_i += int(a.get_editor_property("built_instances"))
            if pid_a in CULL_PASSES:
                mp = str(a.get_editor_property("mesh_path")).lower()
                if ("trunk" in mp or "canopy" in mp) and a.get_actor_label() not in seen_cull:
                    seen_cull.add(a.get_actor_label())
                    cd = float(a.get_editor_property("cull_distance"))
                    if abs(cd - 60000.0) < 1.0:
                        cull["at_60000"] += 1
                    elif abs(cd - 26000.0) < 1.0:
                        cull["at_26000"] += 1
                    else:
                        cull["other"][str(int(cd))] = cull["other"].get(str(int(cd)), 0) + 1
                    try:
                        comp = a.get_editor_property("instances")
                        end = int(comp.get_editor_property("instance_end_cull_distance")) if comp is not None else -1
                    except Exception:                                  # noqa: BLE001
                        end = -2
                    cull["runtime_end"][str(end)] = cull["runtime_end"].get(str(end), 0) + 1
        row = {"pass": pid, "at": [round(cx), round(cy)], "r_m": round(math.hypot(cx, cy) / 100.0, 1),
               "streaming_complete": done, "batches": [n_b, want_b], "instances": [n_i, want_i],
               "resident": n_b == want_b and n_i == want_i}
        stands.append(row)
        emit("STAND", pid, row["batches"], row["instances"], "OK" if row["resident"] else "SHORT")
        yield 0.0
    RESULT["passes_resident"] = sum(1 for s in stands if s["resident"])
    RESULT["passes"] = len(stands)
    RESULT["cull_batches_seen"] = len(seen_cull)
    RESULT["status"] = "measured"
