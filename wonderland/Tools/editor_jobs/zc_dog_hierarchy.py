# PIE probe: THE RELAY DOG'S COMPONENT TREE, TWICE. The book placed from the head joint's bind-time place in the Body's
# frame came out 74 uu ABOVE the head, so the Body and the head joint moved relative to each other after bind. This
# records every scene component's parent, relative location and world height against the capsule, a few seconds into
# play and again after reading for a while, and the Dog's own beam note.
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
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        mission = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.is_mission_strip_on_screen()][0]

        def dump():
            at = pawn.get_actor_location()
            out = {}
            for c in pawn.get_components_by_class(unreal.SceneComponent):
                name = c.get_name()
                if not (name == "Body" or name.startswith("Pivot_") or name.startswith("MissionBookRoot") or name == "CollisionCylinder"):
                    continue
                parent = c.get_attach_parent()
                out[name] = {"parent": parent.get_name() if parent else None,
                             "rel": vec(c.get_editor_property("relative_location")),
                             "world_z": round(c.get_world_location().z - at.z, 1)}
            return out

        yield 0.5
        RESULT["t0_5"] = dump()
        yield 4.0
        RESULT["t4_5"] = dump()
        mission.stop_fixture()
        mission.set_beat_by_id("researching")
        yield 3.0
        RESULT["reading_3s"] = dump()
        yield 12.0
        RESULT["reading_15s"] = dump()
        RESULT["beam_note"] = str(pawn.describe_mission_beam())
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLDOGHIER could not end play: %s" % exc)
