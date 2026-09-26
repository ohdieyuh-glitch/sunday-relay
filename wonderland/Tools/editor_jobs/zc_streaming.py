# DOES THIS WORLD STREAM, OR DOES IT SIMPLY LOAD?
#
# P2 item 13 lists streaming among the things that must be working for the world to be beta-complete, and
# nothing on the beta review page has ever tested it. Every proof measures what is RESIDENT -- 174,787
# instances, 3,934 components, 109 built tiles -- and residency is the one number that cannot tell you
# whether streaming is doing anything, because a world that loads everything and never unloads it reports
# exactly the same figures as a world that streams perfectly while you stand still.
#
# The map is WL_V2_GoldenArrival_WP2, a World Partition level. The partitioned TWIN was measured at 631
# actors resident on open against this one's 21,052, which is the number behind "adopting the partitioned
# map" sitting on the blocker list. That comparison says something about the twin. It says nothing about
# whether THIS map streams as the player moves, which is the thing the founder asked to be working.
#
# So the Dog is put down at the centre and then far out at the rim, and the actor and component counts are
# read at each. If they move, the world streams. If they do not, it is fully resident and "streaming" is a
# word rather than a behaviour -- which the founder should know before beta either way.
CONCURRENT = True

import math
import unreal

L = unreal.WonderlandUiTestLibrary

#: Centre, mid, and out past the built world into the wilderness belt.
STOPS_M = (0.0, 600.0, 1250.0)
BEARING_DEG = 45.0


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
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 6.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)

    def census():
        actors = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor)
        comps = 0
        insts = 0
        for a in actors:
            try:
                for c in a.get_components_by_class(unreal.InstancedStaticMeshComponent):
                    comps += 1
                    try:
                        insts += int(c.get_instance_count())
                    except Exception:
                        pass
            except Exception:
                pass
        return {"actors": len(actors), "instanced_components": comps, "instances": insts}

    readings = {}
    RESULT["at_each_stop"] = readings
    rad = math.radians(BEARING_DEG)
    for metres in STOPS_M:
        where = unreal.Vector(math.cos(rad) * metres * 100.0, math.sin(rad) * metres * 100.0, 400.0)
        dog.set_actor_location(where, False, False)
        # Long enough for World Partition to act on the new position if it is going to.
        yield 12.0
        readings["%04.0fm" % metres] = census()
        emit("S_%04.0fm" % metres, "INFO", "resident at %.0f m" % metres, readings["%04.0fm" % metres])

    values = list(readings.values())
    actors = [v["actors"] for v in values]
    insts = [v["instances"] for v in values]
    spread_actors = max(actors) - min(actors)
    spread_insts = max(insts) - min(insts)
    RESULT["actor_spread"] = spread_actors
    RESULT["instance_spread"] = spread_insts

    record("S00", "the world was actually sampled at every stop",
           len(values) == len(STOPS_M) and all(v["actors"] > 0 for v in values),
           stops=readings)

    # THE QUESTION ITSELF, and it is reported either way rather than asserted one way. A fully resident world
    # is a legitimate shipping choice for a 1,478 m disc; it is not legitimate to call it streaming.
    streams = spread_actors > 50 or spread_insts > 5000
    record("S01", "the world's residency CHANGES as the player crosses it",
           streams, actors_by_stop=actors, instances_by_stop=insts,
           actor_spread=spread_actors, instance_spread=spread_insts,
           note="if these are flat, the level is fully resident: every actor loaded at open and none "
                "unloaded 1,250 m away. That is a real answer to P2 item 13's streaming clause and it is "
                "the number behind whether the partitioned twin is worth adopting")

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
