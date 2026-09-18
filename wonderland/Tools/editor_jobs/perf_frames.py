# PIE job: median frame time at named cameras, changing NOTHING.
#
# WHY (GQ01, 2026-09-17). perf_remove_ab measures what a PASS costs by destroying its actors in the PIE copy. A
# MATERIAL change has no actors to destroy: the lawn moving from M_V2_Surface to M_V2_SurfaceHD changes the shader
# every lawn pixel runs, and the only way to price that is to measure the world with it and without it. So this job
# just measures, and the caller sandwiches it around the change: measure, revert, measure, re-apply, measure.
#
# Relative numbers only, and only within one editor session. The editor throttles when it is behind another window,
# so the Wonderland test library's suspend is used exactly as perf_remove_ab does. Frame time is the median of
# per-frame deltas over the window, which one hitch cannot move the way a mean can.
# Globals: CAMERAS (labels), SECONDS, WARM (a discarded pass first), LABEL (what this measurement is of).
import time

CAMERAS = globals().get("CAMERAS", ["WorldCam12"])
SECONDS = globals().get("SECONDS", 6.0)
WARM = globals().get("WARM", True)
LABEL = globals().get("LABEL", "")


def _window(seconds):
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


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    yield (lambda: ues.get_game_world() is None, 1800)
    unreal.SystemLibrary.execute_console_command(None, "t.IdleWhenNotForeground 0")
    unreal.WonderlandUiTestLibrary.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    try:
        yield (lambda: ues.get_game_world() is not None, 240)
        world = ues.get_game_world()
        yield (lambda: unreal.GameplayStatics.get_player_pawn(world, 0) is not None, 120)
        yield 6.0
        pc = unreal.GameplayStatics.get_player_controller(world, 0)
        cams = {a.get_actor_label(): a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.CameraActor)}
        out = {}
        for pass_name in (("warm", "measured") if WARM else ("measured",)):
            row = {}
            for cam in CAMERAS:
                if cam in cams:
                    pc.set_view_target_with_blend(cams[cam], 0.0)
                yield 2.5
                holder = {}

                def run():
                    holder["ms"] = yield from _window(SECONDS)
                yield from run()
                row[cam] = holder["ms"]
            out[pass_name] = row
        RESULT["label"] = LABEL
        RESULT["frames"] = out
        vals = [v for v in out["measured"].values() if v]
        RESULT["mean"] = round(sum(vals) / len(vals), 2) if vals else None
        if any(v and v > 250.0 for v in vals):
            RESULT["INVALID"] = "over 250 ms: the editor is throttled, not the scene"
    finally:
        les.editor_request_end_play()
    RESULT["status"] = "done"
