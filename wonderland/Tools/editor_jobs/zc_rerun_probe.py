# PIE probe: DOES AN EDITOR PROPERTY WRITE REBUILD THE DOG? Every job that set the camera arm with set_editor_property
# found the book detached from the Body; the one that did not was clean. This compares the Body component object and the
# book root's parent before and after a plain set_editor_property and after one that sends no change notification.
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
        yield 3.0
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        mission = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.is_mission_strip_on_screen()][0]
        mission.stop_fixture()
        mission.set_beat_by_id("researching")
        yield 2.0

        def state(tag):
            comps = {c.get_name(): c for c in pawn.get_components_by_class(unreal.SceneComponent)}
            body = comps.get("Body")
            root = next((c for n, c in comps.items() if n.startswith("MissionBookRoot")), None)
            parent = root.get_attach_parent() if root else None
            RESULT[tag] = {"body_object": body.get_full_name() if body else None, "body_id": id(body) if body else None,
                           "components": len(comps),
                           "book_parent": parent.get_full_name() if parent else None,
                           "book_z": round(root.get_world_location().z - pawn.get_actor_location().z, 1) if root else None,
                           "beam_note": str(pawn.describe_mission_beam())}

        state("before")
        boom = pawn.get_component_by_class(unreal.SpringArmComponent)
        boom.set_editor_property("target_arm_length", float(boom.target_arm_length), unreal.PropertyAccessChangeNotifyMode.NEVER)
        yield 1.0
        state("after_no_notify")
        boom = pawn.get_component_by_class(unreal.SpringArmComponent)
        boom.set_editor_property("target_arm_length", float(boom.target_arm_length))
        yield 1.0
        state("after_default_notify")
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLRERUN could not end play: %s" % exc)
