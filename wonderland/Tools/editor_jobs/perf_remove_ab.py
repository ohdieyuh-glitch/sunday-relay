# PIE job: what does a set of authored passes actually COST? Measured by REMOVING them, not hiding them.
#
# WHY NOT perf_ab.py. That job hides actors with set_actor_hidden_in_game. A hidden instanced component can still be
# registered with the scene, and a disagreement with another session's numbers is exactly the case where that
# difference matters: perf_ab put SD01 inside the noise, while a cross-session comparison put it at +6 ms. So this one
# destroys the pass actors in the PIE copy of the world -- the editor world is untouched -- and measures before and
# after in the same session, alternating ON / OFF / ON-again is impossible once destroyed, so it measures ON, OFF, and
# then a second OFF window as the noise floor, and repeats the whole thing from a fresh PIE for a second ON.
#
# Relative numbers only. Frame time is the median of per-frame deltas over the window, which a single hitch cannot
# move the way a mean can.
# Globals: PASSES (pass ids), CAMERAS (labels), SECONDS, ROUNDS.
import time

PASSES = globals().get("PASSES", [])
CAMERAS = globals().get("CAMERAS", ["WorldCam12"])
SECONDS = globals().get("SECONDS", 8.0)
ROUNDS = globals().get("ROUNDS", 2)


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["rounds"] = []
    for r in range(ROUNDS):
        yield (lambda: ues.get_game_world() is None, 1800)
        unreal.SystemLibrary.execute_console_command(None, "t.IdleWhenNotForeground 0")
        # THE THROTTLE, OR EVERY NUMBER IS THE THROTTLE. The first run read 333 ms -- exactly 3 fps -- at every camera,
        # with the passes on and off: the editor was behind other windows and capped itself. t.IdleWhenNotForeground
        # does not lift that cap; the Wonderland test library's suspend does, and every other PIE proof here uses it.
        unreal.WonderlandUiTestLibrary.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        try:
            row = {}
            yield from _round(ues, row)
            RESULT["rounds"].append(row)
        finally:
            les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 120)
    RESULT["status"] = "done"


def _window(seconds):
    """Median frame time over a window, sampled from the engine's own frame counter and clock."""
    deltas = []
    last_f, last_t = unreal.SystemLibrary.get_frame_count(), time.perf_counter()
    end = last_t + seconds
    while time.perf_counter() < end:
        yield 0.0
        f, t = unreal.SystemLibrary.get_frame_count(), time.perf_counter()
        if f > last_f:
            deltas.append((t - last_t) * 1000.0 / (f - last_f))
            last_f, last_t = f, t
    deltas.sort()
    return round(deltas[len(deltas) // 2], 2) if deltas else None


def _round(ues, row):
    yield (lambda: ues.get_game_world() is not None, 240)
    world = ues.get_game_world()
    yield (lambda: unreal.GameplayStatics.get_player_pawn(world, 0) is not None, 120)
    yield 6.0
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    cams = {a.get_actor_label(): a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.CameraActor)}
    tags = [unreal.Name("WL_PASS_" + p) for p in PASSES]
    actors = [a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor) if any(t in a.tags for t in tags)]
    row["pass_actors"] = len(actors)

    def measure(state):
        out = {}
        for cam in CAMERAS:
            if cam in cams:
                pc.set_view_target_with_blend(cams[cam], 0.0)
            yield 2.5
            holder = {}

            def run():
                holder["ms"] = yield from _window(SECONDS)
            yield from run()
            out[cam] = holder["ms"]
        row[state] = out

    yield from measure("on")
    throttled = [c for c, ms in row["on"].items() if ms is not None and ms > 250.0]
    if throttled:
        row["INVALID"] = "frame time above 250 ms at %s: the editor is throttled, not the scene" % throttled
    for a in actors:
        a.destroy_actor()
    yield 3.0
    yield from measure("off")
    yield from measure("off_again")
