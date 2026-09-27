# IS WORLD PARTITION ON, AND IS STREAMING ENABLED? ASKED IN C++, WHERE THE API IS REAL.
#
# Python cannot reach any of this in 5.8 -- World has no world_partition property, the blueprint library has
# no getter, every name tried came back "failed to find property" -- and a probe built on those reported
# "no runtime hash" for a map that may well have one. That was an unreachable API, not a finding, and the
# same trap has now cost this project three separate false conclusions in one day.
#
# DescribeWorldPartition asks UWorld::GetWorldPartition directly. Read in BOTH worlds, because they can
# disagree: the editor world holds the authored settings, and PIE gets a generated runtime copy, so "the
# editor says streaming is on and PIE says it is off" is itself a diagnosis.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import unreal

L = unreal.WonderlandUiTestLibrary


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)

    editor_world = ues.get_editor_world()
    RESULT["editor"] = str(L.describe_world_partition(editor_world)) if editor_world else "no editor world"
    emit("W_EDITOR", "INFO", "the editor world", {"partition": RESULT["editor"]})

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield 8.0
    game_world = ues.get_game_world()
    RESULT["pie"] = str(L.describe_world_partition(game_world)) if game_world else "no game world"
    emit("W_PIE", "INFO", "the PIE world", {"partition": RESULT["pie"]})

    record("W00", "both worlds answered", "partitioned=" in RESULT["editor"] and "partitioned=" in RESULT["pie"],
           editor=RESULT["editor"], pie=RESULT["pie"])
    record("W01", "the map is partitioned at all", "partitioned=1" in RESULT["pie"],
           pie=RESULT["pie"],
           note="if this is 0 the map is a plain level and nothing was ever going to stream")
    record("W02", "streaming is enabled on the running world", "streaming=1" in RESULT["pie"],
           pie=RESULT["pie"],
           note="the single switch. A partitioned map with streaming disabled loads every cell at once, "
                "which is exactly the flat residency zc_streaming measures.")
    record("W03", "there is a runtime hash to put cells in", "runtimeHash=NONE" not in RESULT["pie"],
           pie=RESULT["pie"])

    RESULT["status"] = "measured"
    yield 1.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
