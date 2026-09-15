# PIE job: where the companions should float so the play camera sees them beside the Dog and clear of their own
# terminal panels (the first proof showed the LLM Companion at +-135 uu sitting behind its panel from the default
# follow camera). Offsets are set on the spawned bodies for this run only; nothing is saved.
import os

SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc")
L = unreal.WonderlandUiTestLibrary
TRIALS = (("close", (20.0, -100.0), (20.0, 105.0)),
          ("mid", (5.0, -115.0), (5.0, 120.0)))


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["captures"] = []

    def shot(name):
        path = os.path.join(SHOTS, name)
        ok = L.capture_game_viewport(path)
        if ok is True or (isinstance(ok, tuple) and ok and ok[0]):
            RESULT["captures"].append(path)

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    unreal.SystemLibrary.execute_console_command(None, "wl.Companion.FigureDir C:/dev/iwonder/wonderland-companions/wonderland/Companions")
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    controller = unreal.GameplayStatics.get_player_controller(world, 0)
    subsystems = [c for c in unreal.ObjectIterator(unreal.WonderlandCompanionSubsystem)]
    companions = next((c for c in subsystems if c.get_world() == world), None) or next((c for c in subsystems if c.get_embodiment_count() > 0), None)
    bodies = [companions.get_embodiment(i) for i in range(2)] if companions else []
    yaw = pawn.get_actor_rotation().yaw

    for label, llm, agent in TRIALS:
        for body, (ox, oy) in zip(bodies, (llm, agent)):
            if body:
                body.set_editor_property("follow_offset", unreal.Vector(ox, oy, 0.0))
                body.snap_to_target()
        controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-10.0, yaw=yaw))
        yield 2.5
        shot("zc_09_%s_behind.png" % label)
        L.focus_game_viewport()
        L.set_key_held("W", True)
        yield 1.4
        shot("zc_09_%s_walk.png" % label)
        L.set_key_held("W", False)
        yield 1.5
        yaw = pawn.get_actor_rotation().yaw
        controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-10.0, yaw=yaw + 180.0))
        yield 2.5
        shot("zc_09_%s_front.png" % label)

    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    L.set_background_throttle_suspended(False)
    RESULT["status"] = "done"
