# PIE probe: WHY THE IN-WORLD WONDER WEB SCREEN DRAWS BLACK.
#
# Opens Wonder Web, then separates rendering from display: exports the widget component's render target to a PNG (what
# Slate actually drew), reads the component's blend mode, tint and background, and photographs the screen under a few
# live changes (masked and opaque blend, an explicit white tint). Also reports where the probed controls stand.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wonder_web_render_probe")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".jpg", ".png", ".hdr", ".exr")):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    notes = {}
    RESULT["notes"] = notes
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 4.0
        world = ues.get_game_world()
        ui = L.get_ui(world)
        L.focus_game_viewport()
        unreal.SystemLibrary.execute_console_command(world, "wl.WonderWeb.Open")
        yield 2.0
        screens = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandWonderWebScreen)
        notes["screens"] = len(screens)
        if not screens:
            RESULT["status"] = "done"
            return
        actor = screens[0]
        comps = actor.get_components_by_class(unreal.WidgetComponent)
        widget = comps[0] if comps else None
        notes["describe"] = str(ui.describe_wonder_web())
        if widget is not None:
            for prop in ("blend_mode", "widget_space", "tint_color_and_opacity", "background_color", "draw_size", "pivot", "two_sided", "manually_redraw", "redraw_time", "window_visibility"):
                try:
                    notes[prop] = str(widget.get_editor_property(prop))
                except Exception as exc:
                    notes[prop] = "n/a (%s)" % exc
            try:
                notes["current_draw_size"] = str(widget.get_current_draw_size())
            except Exception as exc:
                notes["current_draw_size"] = "n/a (%s)" % exc
            rt = None
            try:
                rt = widget.get_render_target()
            except Exception as exc:
                notes["render_target"] = "n/a (%s)" % exc
            if rt is not None:
                notes["render_target"] = "%s %dx%d format=%s" % (rt.get_name(), rt.get_editor_property("size_x"), rt.get_editor_property("size_y"), str(rt.get_editor_property("render_target_format")))
                try:
                    unreal.RenderingLibrary.export_render_target(world, rt, ROOT, "render_target")
                    notes["exported"] = sorted(os.listdir(ROOT))
                except Exception as exc:
                    notes["export"] = "failed (%s)" % exc
            H.capture_viewport_jpeg(os.path.join(ROOT, "a_as_built.jpg"), 1600, 90)
            for control in ("tab:0", "tab:1", "open-sample", "close", "terminal"):
                notes["on_screen_" + control] = str(ui.get_wonder_web_control_on_screen(control))
            for level in (globals().get("LEVELS") or (300.0, 1000.0, 2500.0, 5000.0)):
                widget.set_tint_color_and_opacity(unreal.LinearColor(level, level, level, 1.0))
                yield 0.6
                H.capture_viewport_jpeg(os.path.join(ROOT, "tint_%05d.jpg" % int(level)), 1600, 90)
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "notes.json"), "w", encoding="utf-8") as fh:
            json.dump(notes, fh, indent=1)
        try:
            unreal.SystemLibrary.execute_console_command(ues.get_game_world(), "wl.WonderWeb.Close")
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLWEBRENDER could not end play: %s" % exc)
