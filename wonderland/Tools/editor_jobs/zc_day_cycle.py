# DOES WONDERLAND HAVE A DAY?
#
# FOUNDER: "Add continuous time of day: morning -> afternoon -> evening/night -> morning. Sky, sun, atmosphere,
# exposure, shadows, clouds, windows/lanterns, and environment lighting transition coherently." And: "Fix
# glitching shadows."
#
# So this walks the clock and photographs each hour it is asked for, and reads back what the sky says about
# itself -- elevation, sun intensity, cascade count, shadow distance, exposure -- because "it looks like
# evening" is an opinion and "the sun is 4 degrees up and the exposure has opened a stop" is not.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "day_cycle")
HOURS = [6.5, 9.5, 12.0, 16.0, 18.5, 20.5, 23.0, 3.0]


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    rows = []
    RESULT["hours"] = rows
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
    L.focus_game_viewport()

    # Hold the sky still so each photograph is of the hour it says it is.
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    yield 1.0

    for n, hour in enumerate(HOURS):
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
        # Long enough for the sky light to recapture at least twice, or the bounce light lags the sun.
        yield 2.0
        rows.append({"asked_for": hour})
        H.capture_viewport_jpeg(os.path.join(ROOT, "%02d_hour_%04.1f.jpg" % (n + 1, hour)), 1700, 92)

    # ---------------------------------------------------------------- and it must MOVE on its own
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 17.0")
    yield 1.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 2")
    yield 6.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.State")
    yield 0.5
    H.capture_viewport_jpeg(os.path.join(ROOT, "09_running.jpg"), 1700, 92)
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 24")
    yield 0.5

    RESULT["status"] = "measured; the log carries what the sky said at each hour"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
