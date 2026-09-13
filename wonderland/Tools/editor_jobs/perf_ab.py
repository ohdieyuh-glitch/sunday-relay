# PIE job: frame-time A/B for authored passes. In the PIE copy, measures frames over SECONDS with every
# actor of the named passes visible, then hidden, then visible again, from a named camera. Relative numbers
# only: an editor behind another window is throttled, so compare the states, not the absolute FPS.
# Globals: PASSES (list of pass ids), CAMERA (label), SECONDS.
import time

PASSES = globals().get("PASSES", ["SKY04", "SKY05"])
CAMERA = globals().get("CAMERA", "HeroCam_GoldenArrivalBible")
SECONDS = globals().get("SECONDS", 6.0)


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    unreal.SystemLibrary.execute_console_command(None, "t.IdleWhenNotForeground 0")
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    cams = {a.get_actor_label(): a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.CameraActor)}
    if CAMERA in cams:
        pc.set_view_target_with_blend(cams[CAMERA], 0.0)
    tags = [unreal.Name("WL_PASS_" + p) for p in PASSES]
    actors = [a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor) if any(t in a.tags for t in tags)]
    RESULT["pass_actors"] = len(actors)

    def measure(label):
        f0, t0 = unreal.SystemLibrary.get_frame_count(), time.time()
        return (label, f0, t0)

    samples = []
    for state in ("visible", "hidden", "visible_again"):
        for a in actors:
            a.set_actor_hidden_in_game(state == "hidden")
        yield 3.0
        label, f0, t0 = measure(state)
        yield SECONDS
        frames = unreal.SystemLibrary.get_frame_count() - f0
        secs = time.time() - t0
        samples.append({"state": state, "fps": round(frames / secs, 1), "ms": round(1000.0 * secs / max(frames, 1), 2)})
    RESULT["samples"] = samples
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    RESULT["status"] = "done"
