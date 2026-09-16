# PIE probe: DOES GARBAGE COLLECTION TAKE THE DOG'S BODY? The long filmed runs reported body=0 at verification while
# short probes drew the beam. BodyRoot is a transient UPROPERTY, which collection nulls when what it points at has
# become garbage. This poses verification, reads the Dog's beam note, forces a collection, and reads it again.
import os

L = unreal.WonderlandUiTestLibrary


def job():
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
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        mission = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.is_mission_strip_on_screen()][0]
        names = [c.get_name() for c in pawn.get_components_by_class(unreal.SceneComponent)]
        RESULT["has_body_component"] = "Body" in names
        RESULT["component_count_before"] = len(names)
        mission.stop_fixture()
        mission.set_beat_by_id("verifying")
        yield 2.0
        RESULT["note_before_gc"] = str(pawn.describe_mission_beam())
        unreal.SystemLibrary.execute_console_command(world, "obj gc")
        yield 1.0
        RESULT["note_after_gc"] = str(pawn.describe_mission_beam())
        names_after = [c.get_name() for c in pawn.get_components_by_class(unreal.SceneComponent)]
        RESULT["has_body_component_after"] = "Body" in names_after
        RESULT["component_count_after"] = len(names_after)
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLBEAMGC could not end play: %s" % exc)
