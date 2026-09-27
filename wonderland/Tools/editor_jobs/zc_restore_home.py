# PUT THE EDITOR BACK ON THE SHIPPING MAP
#
# zc_twin_usable opened the partitioned twin and died at a teleport -- "RelayDogCharacter: Internal Error -
# ObjectInstance is null", the pawn reference going stale when World Partition streamed out the cell holding
# it -- which is a real thing to know about the twin, and it happened BEFORE the job's restore step ran.
#
# So the editor may be sitting on WL_V2_GoldenArrival_WP2_WP. That is not a catastrophe, nothing was saved,
# but it is exactly the kind of state a job should never leave behind: the founder opening this editor should
# find the map every proof runs in, not the one I was inspecting.
#
# This reports where it is and puts it back if it is anywhere else.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import unreal

HOME = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"


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

    before = str(ues.get_editor_world().get_name())
    RESULT["found_on"] = before
    emit("R00", "INFO", "the editor was found on", {"map": before})

    if before != "WL_V2_GoldenArrival_WP2":
        try:
            les.load_level(HOME)
        except Exception as err:                                   # noqa: BLE001
            RESULT["restore_error"] = str(err)[:200]
        yield 10.0

    after = str(ues.get_editor_world().get_name())
    RESULT["now_on"] = after
    record("R01", "the editor is on the shipping map",
           after == "WL_V2_GoldenArrival_WP2", found_on=before, now_on=after,
           note="zc_twin_usable errored before its own restore step; nothing was saved in the twin")

    RESULT["status"] = "measured"
