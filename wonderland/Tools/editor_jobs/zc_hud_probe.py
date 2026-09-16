# PIE probe, two questions from the first HUD proof.
#
# 1 CLICKS. Every pointer click found its tile and sent its events at plausible desktop coordinates, and nothing
#   answered -- with or without a frame between pointing and clicking, so it is not the input-mode change landing a
#   frame late. DiagnoseNavClick now says what Slate itself locates under the tile's centre, who holds mouse capture
#   and whether the application is active; ClickNavButton logs down/up handling. The tile's own SimulateClick is
#   tried too, and reported apart, because it proves wiring and nothing about whether a pointer can reach the tile.
#
# 2 COST. The photograph measured 2.5 to 4.7 ms of median frame. wl.MiniMap.Hz overrides the rate at runtime, so
#   whether the cost scales with the rate (a render per photograph) or stays flat (the capture merely existing)
#   is measured in alternating windows, off between on, so a warming editor cannot pass for a difference.
import os

SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc")
L = unreal.WonderlandUiTestLibrary


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        ui = L.get_ui(world)
        for cmd in ("t.MaxFPS 0", "Slate.bAllowThrottling 0", "r.VSync 0"):
            unreal.SystemLibrary.execute_console_command(world, cmd)
        L.focus_game_viewport()
        yield 1.5

        # ---------------------------------------------------------------- 1 clicks, diagnosed
        clicks = []
        for tile, is_open in (("brain", "is_project_brain_open"), ("commands", "is_command_station_open"), ("menu", "is_menu_open")):
            L.focus_game_viewport()
            yield 0.3
            ui.begin_pointing()
            yield 0.3
            before = str(ui.diagnose_nav_click(tile))
            pointer = bool(ui.click_nav_button(tile))
            yield 0.4
            opened_by_pointer = bool(getattr(ui, is_open)())
            ui.close_overlay()
            ui.end_pointing()
            yield 0.4
            wired = bool(ui.simulate_nav_tile_click(tile))
            yield 0.4
            opened_by_wiring = bool(getattr(ui, is_open)())
            ui.close_overlay()
            yield 0.4
            clicks.append({"tile": tile, "pointer_clicked": pointer, "opened_by_pointer": opened_by_pointer,
                           "wired_clicked": wired, "opened_by_wiring": opened_by_wiring,
                           "diagnosis": before.splitlines()})
        RESULT["clicks"] = clicks

        # ---------------------------------------------------------------- 2 what the photograph costs, by rate
        def window(label, capture_on, hz, seconds=2.5):
            unreal.SystemLibrary.execute_console_command(world, "wl.MiniMap.Capture %d" % (1 if capture_on else 0))
            unreal.SystemLibrary.execute_console_command(world, "wl.MiniMap.Hz %s" % hz)
            yield 0.6
            before = ui.get_mini_map_capture_count()
            samples = []
            t = 0.0
            while t < seconds:
                yield 0.05
                samples.append(unreal.GameplayStatics.get_world_delta_seconds(world) * 1000.0)
                t += 0.05
            samples.sort()
            RESULT.setdefault("cost", []).append({
                "label": label, "capture": capture_on, "hz": hz,
                "median_ms": round(samples[len(samples) // 2], 2),
                "mean_ms": round(sum(samples) / len(samples), 2),
                "captures_per_s": round((ui.get_mini_map_capture_count() - before) / seconds, 1),
            })

        L.focus_game_viewport()
        for label, on, hz in (("off_a", False, 0), ("8hz_a", True, 8), ("off_b", False, 0), ("8hz_b", True, 8),
                              ("4hz_a", True, 4), ("off_c", False, 0), ("4hz_b", True, 4), ("2hz", True, 2),
                              ("off_d", False, 0), ("1hz", True, 1)):
            yield from window(label, on, hz)
        RESULT["status"] = "done"
    finally:
        try:
            if ues.get_game_world() is not None:
                unreal.SystemLibrary.execute_console_command(ues.get_game_world(), "wl.MiniMap.Capture 1")
                unreal.SystemLibrary.execute_console_command(ues.get_game_world(), "wl.MiniMap.Hz 0")
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLHUDPROBE could not end play: %s" % exc)
