# WHAT THE GARDEN COSTS BEFORE NANITE.
#
# Measured at a FIXED camera pose, so the after-shot is comparable: the founder's own spawn view, held still.
# Draw calls and primitives are deterministic where frame time on this machine is not -- the world ledger
# records frame time drifting monotonically upward across any measurement window, so it is reported but not
# leaned on.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "nanite")


def job():
    os.makedirs(ROOT, exist_ok=True)
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
    yield 6.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 11.0")
    unreal.SystemLibrary.execute_console_command(world, "stat unit")
    yield 2.0

    draws, prims, frames = [], [], []
    for _ in range(26):
        yield 0.15
        # THE RETURN SHAPES ARE THE ONES THE PROBE ACTUALLY FOUND: two values and four, out-params only,
        # with no leading success flag. Guessing this wrong is what killed the first avatar-cost run.
        d, p = H.get_draw_call_count()
        draws.append(int(d)); prims.append(int(p))
        f, g, r, gpu = H.get_frame_cost_ms()
        if float(f) > 0.01:
            frames.append((float(f), float(g), float(r), float(gpu)))
    RESULT["draw_calls"] = round(sum(draws) / max(len(draws), 1), 0) if draws else None
    RESULT["primitives"] = round(sum(prims) / max(len(prims), 1), 0) if prims else None
    if frames:
        n = float(len(frames))
        RESULT["frame_ms"] = round(sum(f[0] for f in frames) / n, 2)
        RESULT["game_ms"] = round(sum(f[1] for f in frames) / n, 2)
        RESULT["render_ms"] = round(sum(f[2] for f in frames) / n, 2)
        RESULT["gpu_ms"] = round(sum(f[3] for f in frames) / n, 2)
    RESULT["samples"] = len(draws)
    H.capture_viewport_jpeg(os.path.join(ROOT, "after.jpg"), 1700, 92)
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
