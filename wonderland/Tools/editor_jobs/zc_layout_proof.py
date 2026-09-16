# PIE job: THE ESTABLISHED LAYOUT, WITH THE JULIUS STREAM INSIDE IT (founder correction, 2026-09-16).
#
# Runs scenario D with the Julius terminal open and photographs the whole screen, at native resolution, at three
# moments -- research, implementation and review -- recording every HUD rectangle, so the frontend silhouette can be
# compared against the layout before the mission deck: the Julius window bottom-centre at its approved size, the LLM
# Companion's terminal on the LEFT and the Jhinn's on the RIGHT, the command lists beside the window, and the world.
import json
import os

L = unreal.WonderlandUiTestLibrary
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "layout_proof")
PACE = float(globals().get("PACE") or 10.0)
MOMENTS = ["researching", "coding_agent", "review_challenge"]


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        ui = L.get_ui(world)
        mission = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.is_mission_strip_on_screen()][0]
        L.focus_game_viewport()
        mission.stop_fixture()
        mission.set_joined_in(False, False)
        mission.set_beat_by_id("idle")
        yield 1.0
        if not ui.is_live_terminal_open():
            ui.toggle_live_terminal()
        yield 1.0
        RESULT["rects_open_idle"] = str(ui.describe_hud_rects())
        L.capture_game_viewport(os.path.join(SHOTS, "layout_open_idle.png"))
        mission.run_scenario("D", PACE)
        shots = {}
        for beat in MOMENTS:
            yield (lambda b=beat: str(mission.get_beat_id()) == b, 600)
            # Well into the stage, so the stream has written that stage's work.
            yield 0.7 * PACE
            name = "layout_%s.png" % beat
            L.capture_game_viewport(os.path.join(SHOTS, name))
            shots[beat] = {
                "path": os.path.join(SHOTS, name),
                "rects": str(ui.describe_hud_rects()),
                "stream_shown": bool(ui.is_julius_stream_shown()),
                "event": str(mission.get_last_event_type()),
                "stream_event": str(ui.get_julius_stream_event()),
                "roles": [[str(ui.get_julius_role_status(r)), int(ui.get_julius_role_written_count(r)),
                           str(ui.get_julius_role_latest_line(r))[:70]] for r in range(4)],
            }
            unreal.log_warning("WLLAYOUT %s %s" % (beat, json.dumps(shots[beat])[:500]))
        RESULT["shots"] = shots
        mission.stop_fixture()
        ui.close_overlay()
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLLAYOUT could not end play: %s" % exc)
