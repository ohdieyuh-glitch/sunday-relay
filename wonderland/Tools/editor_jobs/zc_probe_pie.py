# IS PIE ACTUALLY RUNNING, AND CAN THIS SESSION PHOTOGRAPH IT?
#
# Two jobs in a row came back with every reading None and not one capture written, which is the signature of
# a proof measuring a world that is not there rather than of a world that is wrong. This asks directly.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "probe")


def job():
    os.makedirs(ROOT, exist_ok=True)
    RESULT["status"] = "running"
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)

    RESULT["game_world_before"] = str(ues.get_game_world().get_name()) if ues.get_game_world() else None
    if ues.get_game_world() is None:
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 300)
        yield 8.0
    world = ues.get_game_world()
    RESULT["game_world"] = str(world.get_name()) if world else None
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0) if world else None
    RESULT["pawn"] = str(pawn.get_name()) if pawn else None
    pc = unreal.GameplayStatics.get_player_controller(world, 0) if world else None
    RESULT["controller"] = str(pc.get_name()) if pc else None

    L.focus_game_viewport()
    yield 2.0
    shot = os.path.join(ROOT, "probe.png")
    try:
        got = L.capture_game_viewport(shot)
        RESULT["capture_returned"] = str(got)
    except Exception as err:                                       # noqa: BLE001
        RESULT["capture_error"] = str(err)[:240]
    RESULT["capture_on_disk"] = os.path.exists(shot) and os.path.getsize(shot) > 0

    try:
        read = L.read_screen_rect(0.3, 0.3, 0.7, 0.7)
        RESULT["read_screen"] = None if read is None else [round(read[0].r, 3), round(read[1], 3)]
    except Exception as err:                                       # noqa: BLE001
        RESULT["read_error"] = str(err)[:240]

    if pawn is not None and pc is not None:
        at = pawn.get_actor_location()
        try:
            on = unreal.GameplayStatics.project_world_to_screen(pc, at, False)
            RESULT["projected"] = [round(on.x, 1), round(on.y, 1)] if on else None
        except Exception as err:                                   # noqa: BLE001
            RESULT["project_error"] = str(err)[:200]
        size = pc.get_viewport_size()
        RESULT["viewport"] = [size[0], size[1]] if size else None
    RESULT["status"] = "measured"
    yield 0.5
