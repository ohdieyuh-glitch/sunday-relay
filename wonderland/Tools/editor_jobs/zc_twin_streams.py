# DOES THE PARTITIONED TWIN ACTUALLY STREAM, AND WHAT DOES IT KEEP RESIDENT?
#
# "Adopting the partitioned map twin" has sat on the blocker list described by one number: 631 actors
# resident on open against 21,052. I have repeated that number all day. It is wrong, and the way it is wrong
# matters.
#
#     Content/__ExternalActors__/.../WL_V2_GoldenArrival        631 actors
#     Content/__ExternalActors__/.../WL_V2_GoldenArrival_WP2_WP   21,047 actors
#     Content/__ExternalActors__/.../WL_V2_GoldenArrival_WP2      no external store at all
#
# 631 is the external-actor count of a DIFFERENT map -- the container the project's own config calls "the
# EMPTY World Partition container: never develop in it". The twin holds 21,047, essentially the whole world.
# So "631 against 21,052" was never a residency comparison; it was two unrelated counts put side by side,
# and it made the twin sound like it had already solved the problem.
#
# What the twin keeps RESIDENT has never been measured. That is the number the decision actually needs, so
# this opens the twin, walks the same three stops zc_streaming used on the shipping map, counts, and puts
# the shipping map back.
#
# NOTHING IS SAVED. Opening a level to look at it is not a change; the map is reopened at the end so the
# editor is left where it was found.
CONCURRENT = True

import math
import unreal

L = unreal.WonderlandUiTestLibrary

TWIN = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2_WP"
HOME = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"
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

    opened = False
    try:
        opened = bool(les.load_level(TWIN))
    except Exception as err:                                       # noqa: BLE001
        RESULT["open_error"] = str(err)[:200]
    RESULT["twin_opened"] = opened
    yield 8.0
    if not opened:
        record("T00", "the partitioned twin can be opened", False, map=TWIN,
               error=RESULT.get("open_error"))
        RESULT["status"] = "FAIL: could not open the twin"
        try:
            les.load_level(HOME)
        except Exception:
            pass
        return

    editor_world = ues.get_editor_world()
    RESULT["twin_world"] = str(editor_world.get_name())
    RESULT["twin_actors_in_editor"] = len(
        unreal.GameplayStatics.get_all_actors_of_class(editor_world, unreal.Actor))
    record("T00", "the partitioned twin can be opened", True,
           world=RESULT["twin_world"], actors_in_editor=RESULT["twin_actors_in_editor"])

    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 8.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)

    def census():
        actors = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor)
        comps = insts = 0
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
        if dog is not None:
            dog.set_actor_location(
                unreal.Vector(math.cos(rad) * metres * 100.0, math.sin(rad) * metres * 100.0, 400.0),
                False, False)
        yield 14.0        # World Partition needs longer than a monolithic level to settle
        readings["%04.0fm" % metres] = census()
        emit("T_%04.0fm" % metres, "INFO", "twin resident at %.0f m" % metres, readings["%04.0fm" % metres])

    values = list(readings.values())
    actors = [v["actors"] for v in values]
    RESULT["actor_spread"] = max(actors) - min(actors)
    RESULT["lowest_resident"] = min(actors)
    record("T01", "the twin's residency CHANGES as the player crosses it, unlike the shipping map",
           RESULT["actor_spread"] > 50, actors_by_stop=actors,
           spread=RESULT["actor_spread"],
           shipping_map_for_comparison=[21083, 21083, 21083],
           note="the shipping map is flat at 21,083. If the twin is flat too, adopting it buys nothing and "
                "the blocker was built on a misread number")

    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)

    # ---- AND PUT THE EDITOR BACK.
    back = False
    try:
        back = bool(les.load_level(HOME))
    except Exception as err:                                       # noqa: BLE001
        RESULT["restore_error"] = str(err)[:200]
    yield 6.0
    RESULT["restored_home"] = back
    RESULT["editor_world_at_end"] = str(ues.get_editor_world().get_name())
    record("T02", "the editor is left on the shipping map, not the twin",
           str(RESULT["editor_world_at_end"]) == "WL_V2_GoldenArrival_WP2",
           world=RESULT["editor_world_at_end"], restored=back)

    RESULT["status"] = "measured"
