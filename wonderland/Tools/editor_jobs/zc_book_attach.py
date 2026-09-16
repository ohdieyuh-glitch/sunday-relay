# PIE probe: WHERE IS THE BOOK ATTACHED, AND WHERE IS THE BODY? The filmed Dog read with its book at its feet (71 uu below
# the capsule centre) while tuning captures had it at head height. This reads, while the Dog reads: the book root's attach
# parent and relative location, the Body component's world location against the capsule, and the reading-pose settings.
import os

L = unreal.WonderlandUiTestLibrary


def vec(v):
    return [round(v.x, 1), round(v.y, 1), round(v.z, 1)]


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
        mission.stop_fixture()
        mission.set_beat_by_id("researching")
        rows = []
        for step in range(8):
            yield 0.75
            comps = {c.get_name(): c for c in pawn.get_components_by_class(unreal.SceneComponent)}
            root = next((c for n, c in comps.items() if n.startswith("MissionBookRoot")), None)
            body = comps.get("Body")
            at = pawn.get_actor_location()
            row = {"pawn": vec(at)}
            if root is not None:
                parent = root.get_attach_parent()
                row["root_parent"] = parent.get_name() if parent is not None else None
                row["root_rel"] = vec(root.get_editor_property("relative_location"))
                row["root_world_minus_pawn"] = vec(root.get_world_location() - at)
            if body is not None:
                row["body_world_minus_pawn"] = vec(body.get_world_location() - at)
                row["body_rel"] = vec(body.get_editor_property("relative_location"))
                bp = body.get_attach_parent()
                row["body_parent"] = bp.get_name() if bp is not None else None
            row["names_named_body"] = [n for n in comps if n.lower().startswith("body")]
            rows.append(row)
        RESULT["rows"] = rows
        RESULT["cvars"] = {n: unreal.SystemLibrary.get_console_variable_float_value(n) for n in
                           ("wl.Dog.Read.BookUp", "wl.Dog.Read.BookFwd", "wl.Dog.Read.BookScale", "wl.Dog.Read.BookTilt")}
        RESULT["beam_note"] = str(pawn.describe_mission_beam())
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLBOOKATTACH could not end play: %s" % exc)
