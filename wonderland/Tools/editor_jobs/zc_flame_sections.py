# WHAT IS THE FLAME SURFACE WEARING, ON EACH PATH?
#
# The material draws -- an engine cube wearing M_WL_Fire lifted a checkpoint pylon by 0.065 luma. The ribbons
# do not. Everything between those two facts lives in the procedural mesh section, and this reads it on both
# paths for the same skin: how many vertices it has, which material landed on it, whether it is visible, and
# what colour that material was actually given.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary
SKINS = ("arden_infernal", "skeleton_flame")


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
    L.focus_game_viewport()
    yield 7.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 22.0")
    ui = L.get_ui(world)

    def costume():
        for actor in unreal.GameplayStatics.get_all_actors_of_class(
                world, unreal.WonderlandCompanionEmbodiment):
            try:
                if str(actor.get_actor_label()) == "WL_RelayDog_Costume":
                    return actor
            except Exception:
                pass
        return None

    said = {}
    RESULT["flames"] = said
    for material_on in (0, 1):
        unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireMaterial %d" % material_on)
        for skin in SKINS:
            ui.wear_relay_skin(skin)
            yield 6.0
            unreal.SystemLibrary.execute_console_command(world, "wl.Look.Reglow")
            yield 4.0
            body = costume()
            note = body.describe_flames() if body is not None else "no costume"
            said["FireMaterial %d / %s" % (material_on, skin)] = str(note)
            emit("S", "INFO", "FireMaterial %d / %s" % (material_on, skin), {"flames": str(note)[:400]})

    unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireMaterial 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.Reglow")
    record("S00", "the flame surface reported on both paths",
           all("sections=" in v for v in said.values()), said=said)
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
