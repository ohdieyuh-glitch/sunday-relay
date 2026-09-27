# WHY DOES NOTHING STREAM?
#
# zc_streaming's S01 has been failing with the flattest possible reading: 21,089 actors and 156,393 instances
# resident at every stop across the world, an actor spread of exactly 0. The whole world is loaded the whole
# time, so World Partition is either switched off, or on and unable to page anything.
#
# THE SUSPICION, and it follows from how this world was built. Wonderland is INSTANCED, not actor-based -- a
# few thousand actors hold a hundred and fifty thousand instances between them. World Partition pages by
# ACTOR, using each actor's bounds, so an actor whose instanced component spans half a kilometre is inside
# every cell at once and can never leave residency. A world made of a few enormous actors cannot stream
# however the grid is configured, and no amount of tuning the cell size will change it.
#
# So this measures the shape of the thing rather than arguing about it: how many actors there are, how big
# each one's bounds actually is, how many of them are larger than a plausible streaming cell, and what share
# of the world's instances live inside those. It also asks the level whether partition is enabled at all,
# because "switched off" and "on but unpageable" have completely different fixes.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary

CELL_M = 200.0          # the grid size this world's own coverage audit uses


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()
    yield 8.0

    # ---- IS PARTITION EVEN ON? Asked of the level itself rather than inferred from the map's name.
    said = {}
    RESULT["partition"] = said
    try:
        level = world.get_editor_property("persistent_level")
        said["persistent_level"] = str(level.get_name()) if level else None
    except Exception as err:                                       # noqa: BLE001
        said["persistent_level"] = "?" + str(err)[:60]
    for prop in ("world_partition",):
        try:
            got = world.get_editor_property(prop)
            said[prop] = type(got).__name__ if got is not None else None
        except Exception as err:                                   # noqa: BLE001
            said[prop] = "?" + str(err)[:70]
    emit("T_PART", "INFO", "what the level says about partition", said)

    # ---- THE SHAPE OF THE WORLD, actor by actor.
    big = []
    spans = []
    total_instances = 0
    instances_in_big = 0
    spatial = {"yes": 0, "no": 0, "unknown": 0}
    counted = 0
    cell_uu = CELL_M * 100.0

    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            origin, extent = actor.get_actor_bounds(False)
        except Exception:
            continue
        span = max(float(extent.x), float(extent.y)) * 2.0
        if span <= 0.0:
            continue
        counted += 1
        spans.append(span)
        here = 0
        try:
            for comp in actor.get_components_by_class(unreal.InstancedStaticMeshComponent):
                here += int(comp.get_instance_count())
        except Exception:
            pass
        total_instances += here
        try:
            flag = actor.get_editor_property("is_spatially_loaded")
            spatial["yes" if flag else "no"] += 1
        except Exception:
            spatial["unknown"] += 1
        if span > cell_uu:
            instances_in_big += here
            big.append({"label": str(actor.get_actor_label())[:48],
                        "span_m": round(span / 100.0, 1), "instances": here})

    # RANKED BY WHAT THEY HOLD, not by how wide they are. The widest things in this world are the cloud deck
    # and the ground slab, which carry no instances and are supposed to be everywhere; ranking by span puts
    # them at the top and hides the actors that actually matter.
    by_load = sorted([r for r in big if r["instances"] > 0], key=lambda r: -r["instances"])[:16]
    RESULT["oversized_actors_by_instances"] = by_load
    emit("T_LOAD", "INFO", "the oversized actors that actually carry the world", by_load)

    big.sort(key=lambda r: -r["span_m"])
    spans.sort()
    RESULT["actors_measured"] = counted
    RESULT["total_instances"] = total_instances
    RESULT["instances_in_oversized_actors"] = instances_in_big
    RESULT["oversized_actor_count"] = len(big)
    RESULT["widest_actors"] = big[:14]
    RESULT["spatially_loaded_flag"] = spatial
    if spans:
        def at(p):
            return round(spans[min(len(spans) - 1, int(len(spans) * p))] / 100.0, 1)
        RESULT["actor_span_m"] = {"p50": at(0.5), "p90": at(0.9), "p99": at(0.99),
                                  "max": round(spans[-1] / 100.0, 1)}
    emit("T_SHAPE", "INFO", "how big the world's actors are",
         {"actors": counted, "span_m": RESULT.get("actor_span_m"),
          "oversized": len(big), "instances_in_oversized": instances_in_big,
          "instances_total": total_instances})

    record("T00", "the world was actually enumerated", counted > 50,
           actors=counted, instances=total_instances)
    if counted <= 50:
        RESULT["status"] = "FAIL: nothing enumerated"
        return

    share = (instances_in_big / float(total_instances)) if total_instances else 0.0
    RESULT["share_of_instances_unpageable"] = round(share, 4)
    record("T01", "the world is not held in a handful of actors too big to page",
           share <= 0.25, oversized_actors=len(big), cell_metres=CELL_M,
           share_of_instances_in_them=RESULT["share_of_instances_unpageable"],
           widest=big[:8], ceiling=0.25,
           note="World Partition pages by ACTOR using its bounds. An actor whose instanced component spans "
                "more than a cell is inside every cell it touches and can never leave residency. If most of "
                "the world's instances live in such actors, no grid setting can make it stream and the fix "
                "is to split the components by tile at build time.")

    record("T02", "actors are marked as spatially loaded",
           spatial["yes"] > spatial["no"], flags=spatial,
           note="an actor with is_spatially_loaded false is pinned into the always-loaded set whatever its "
                "size, which is the other way a world ends up fully resident")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
