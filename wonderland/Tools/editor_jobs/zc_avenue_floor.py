# WHAT DOES A NATION AVENUE FLOOR LOOK LIKE NOW?
#
# Blocker 4 was "the floor is one slab" -- variation computed and then discarded. The districts were fixed by
# moving it inside the material; the nation avenues were not, and their paving instances were still on the
# default 0.08/0.03/0.10 spread. They are on 0.20/0.12/0.16 now, the same numbers MI_V2_PlazaVaried proved.
# This stands on one and looks down, because a floor is judged by looking at it.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "avenue_floor")
# From the ledger's own walk: the Tartarus gate area, and a Noctis avenue bearing.
SPOTS = [(73075.0, -42191.0, "tartarus_gate"), (-52000.0, -30000.0, "noctis_avenue"),
         (0.0, 41411.0, "icarus_axis")]


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    L.focus_game_viewport()
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 11.0")
    yield 1.5

    seen = []
    RESULT["spots"] = seen
    for x, y, label in SPOTS:
        pawn.set_actor_location(unreal.Vector(x, y, 900.0), False, False)
        yield 2.5
        at = pawn.get_actor_location()
        # Look down the road rather than at the sky, so the floor fills the frame.
        pc.set_control_rotation(unreal.Rotator(0.0, -38.0, 20.0))
        yield 1.2
        seen.append({"label": label, "asked": [x, y], "landed_z": round(float(at.z), 1)})
        H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % label), 1700, 92)

    RESULT["status"] = "photographed"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
