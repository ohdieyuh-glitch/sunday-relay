# PIE probe: HOW LONG CHANGED TEXT SMEARS ON A WONDER WEB WINDOW, under the temporal upscaler's settings.
#
# Editor 83's proof showed the Connections window's terminal smeared for about a second after its lines changed, even on
# the masked glass. This measures it under the default and under the shading-rejection settings TSR documents as more
# responsive, photographing the same change 0.15, 0.4 and 0.8 s after it happens. Every setting is restored at the end.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wonder_web_tsr_probe")

CONFIGS = [
    ("default", {}),
    ("flicker_off", {"r.TSR.ShadingRejection.Flickering": "0"}),
    ("mode0", {"r.TSR.ShadingRejection.Mode": "0"}),
    ("samples8", {"r.TSR.History.SampleCount": "8"}),
    ("flicker_off_mode0", {"r.TSR.ShadingRejection.Flickering": "0", "r.TSR.ShadingRejection.Mode": "0"}),
]
RESTORE = {"r.TSR.ShadingRejection.Flickering": None, "r.TSR.ShadingRejection.Mode": "1", "r.TSR.History.SampleCount": "16"}


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    shots = []
    RESULT["shots"] = shots
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        ui = L.get_ui(world)
        L.focus_game_viewport()

        def console(cmd):
            unreal.SystemLibrary.execute_console_command(world, cmd)

        flicker_default = unreal.SystemLibrary.get_console_variable_int_value("r.TSR.ShadingRejection.Flickering")
        RESTORE["r.TSR.ShadingRejection.Flickering"] = str(flicker_default)
        RESULT["aa_method"] = unreal.SystemLibrary.get_console_variable_int_value("r.AntiAliasingMethod")
        RESULT["screen_percentage"] = unreal.SystemLibrary.get_console_variable_float_value("r.ScreenPercentage")

        console("wl.WonderWeb.Open creation")
        yield 1.5
        console("wl.WonderWeb.Run")
        yield 6.0
        console("wl.WonderWeb.Open connections")
        yield 2.0

        # frames per second, over one second of real time
        start = unreal.GameplayStatics.get_real_time_seconds(world)
        frames = 0
        while unreal.GameplayStatics.get_real_time_seconds(world) - start < 1.0:
            frames += 1
            yield 0.0
        RESULT["fps"] = frames

        for name, cvars in CONFIGS:
            for key, value in RESTORE.items():
                console("%s %s" % (key, value))
            for key, value in cvars.items():
                console("%s %s" % (key, value))
            yield 1.5
            console("wl.Julius.Connect.Type help")
            start = unreal.GameplayStatics.get_real_time_seconds(world)
            for at in (0.15, 0.4, 0.8):
                while unreal.GameplayStatics.get_real_time_seconds(world) - start < at:
                    yield 0.0
                path = os.path.join(ROOT, "%s_%03d.jpg" % (name, int(at * 100)))
                H.capture_viewport_jpeg(path, 1600, 92)
                shots.append({"config": name, "at": at, "file": path})
            yield 1.0
        RESULT["workspace"] = str(ui.describe_wonder_web_workspace())
        console("wl.WonderWeb.Close")
        yield 1.0
        RESULT["status"] = "done"
    finally:
        try:
            world = ues.get_game_world()
            if world is not None:
                for key, value in RESTORE.items():
                    if value is not None:
                        unreal.SystemLibrary.execute_console_command(world, "%s %s" % (key, value))
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLTSRPROBE could not end play: %s" % exc)
