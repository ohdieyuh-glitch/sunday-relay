# MAKE THE DOG SURVIVE LEAVING ITS OWN CELL. One property, set in the EDITOR world and saved.
#
# THE FAULT, measured (zc_dog_killz, zc_dog_cell):
#     is_spatially_loaded True, class BP_RelayDog_C, outer PersistentLevel
#     near  15.0 m -> SURVIVED (8 s standing)
#     far  606.7 m -> DESTROYED 0.7 s after landing
# The Dog lands on real ground, stands motionless, and is destroyed. It IS the streaming source, so
# teleporting it far stops it being a source where it WAS; those cells unload, and a level-placed
# spatially-loaded actor is destroyed with its cell. It goes down with the ground it LEFT.
#
# THE FIX IS THE PROPERTY THAT EXISTS FOR THIS. An actor with bIsSpatiallyLoaded false is always
# loaded regardless of streaming, which is what a player pawn has to be: a pawn that can be unloaded
# by moving is a pawn that cannot fast-travel, warp to a checkpoint, or be placed at a contract.
#
# THIS EDITS THE MAP, which is a shared resource, so it is deliberate about it:
#   - operates on the EDITOR world, never PIE, because a PIE actor is a copy and saving it saves nothing
#   - reads the value BEFORE and AFTER, and reports both, rather than assuming the set took
#   - refuses to save if the property did not actually change
#   - names the actor and its package in the result, so what was touched is on the record
#
# It does NOT verify the fix works. zc_dog_cell does that, and it has to run afterwards on a fresh PIE:
# a property changed in the editor world does not reach a PIE session already running.
import os

# NOT CONCURRENT: this ends PIE. A job that begins or ends play must own the editor for its whole
# run -- a concurrent stage job once ended PIE underneath another session's sweep.
CONCURRENT = False

PROP = "is_spatially_loaded"


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def bail(why):
        RESULT["status"] = "voided: " + why
        emit("VOID", "FAIL", why, {})

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

    # ---- THE EDITOR WORLD, NOT PIE. A PIE actor is a runtime copy; setting a property on it changes
    # ---- nothing that is ever saved, and the job would report a clean success having done nothing.
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 600)
    world = ues.get_editor_world()
    record("A_EDITOR_WORLD", "operating on the editor world, not a PIE copy",
           world is not None and ues.get_game_world() is None,
           editor_world=str(world.get_name()) if world is not None else None,
           pie_running=ues.get_game_world() is not None,
           note="a property set on a PIE actor is set on a runtime copy and saves nothing, which "
                "would look exactly like success")
    if world is None or ues.get_game_world() is not None:
        bail("no editor world, or PIE is still up")
        return

    # ---- FIND THE DOG. By class, and require exactly one, so this cannot quietly edit the wrong actor.
    dogs = []
    try:
        for a in eas.get_all_level_actors():
            if a is None:
                continue
            cls = str(a.get_class().get_name())
            if "RelayDog" in cls:
                dogs.append(a)
    except Exception as exc:                                           # noqa: BLE001
        bail("could not enumerate level actors: %s" % exc)
        return
    found = []
    for a in dogs:
        try:
            found.append({"class": str(a.get_class().get_name()),
                          "name": str(a.get_name()),
                          "path": str(a.get_path_name())})
        except Exception:                                              # noqa: BLE001
            pass
    RESULT["dog_actors"] = found
    record("A_ONE_DOG", "exactly one RelayDog actor is placed in the level",
           len(dogs) == 1, count=len(dogs), actors=found,
           note="more than one and this job would have to choose, which is not a choice a script "
                "should make silently on a shared map")
    if len(dogs) != 1:
        bail("expected exactly one RelayDog actor, found %d" % len(dogs))
        return
    dog = dogs[0]

    before = None
    try:
        before = bool(dog.get_editor_property(PROP))
    except Exception as exc:                                           # noqa: BLE001
        bail("could not read %s: %s" % (PROP, exc))
        return
    RESULT["before"] = before
    record("A_WAS_LOADABLE", "the Dog is currently spatially loaded, which is the fault",
           before is True, is_spatially_loaded=before,
           note="if this is already False the fix is in place and the destruction has another cause; "
                "nothing below should be read as having changed anything")
    if before is not True:
        RESULT["status"] = "measured"
        RESULT["note"] = "already not spatially loaded; nothing changed"
        return

    try:
        dog.set_editor_property(PROP, False)
    except Exception as exc:                                           # noqa: BLE001
        bail("could not set %s: %s" % (PROP, exc))
        return
    after = None
    try:
        after = bool(dog.get_editor_property(PROP))
    except Exception:                                                  # noqa: BLE001
        after = None
    RESULT["after"] = after
    record("A_CHANGED", "the property actually changed on the actor before anything was saved",
           before is True and after is False, before=before, after=after,
           note="a set that silently did not take, followed by a save, is how a map gets dirtied for "
                "no benefit")
    if after is not False:
        bail("the property did not change; nothing saved")
        return

    # ---- SAVE. Only now, and only because the change is proven to have taken.
    saved, how = False, None
    try:
        les.save_current_level()
        saved, how = True, "LevelEditorSubsystem.save_current_level"
    except Exception as exc:                                           # noqa: BLE001
        how = "save_current_level failed: %s" % exc
    if not saved:
        try:
            unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
            saved, how = True, "EditorLoadingAndSavingUtils.save_dirty_packages"
        except Exception as exc:                                       # noqa: BLE001
            how = how + " | save_dirty_packages failed: %s" % exc
    RESULT["saved"] = {"ok": saved, "how": how}
    record("A_SAVED", "the change was written to disk",
           saved, how=how,
           note="the actor lives in its own external package under __ExternalActors__; an unsaved "
                "change survives only until the editor closes")

    yield 2.0
    again = None
    try:
        again = bool(dog.get_editor_property(PROP))
    except Exception:                                                  # noqa: BLE001
        again = None
    RESULT["after_save"] = again
    record("A_HELD", "the property still reads False after the save",
           again is False, value=again)

    RESULT["status"] = "measured"
    RESULT["what_changed"] = {
        "actor": found[0] if found else None, "property": PROP,
        "from": before, "to": after,
        "why": "a level-placed spatially-loaded pawn is destroyed with its home cell when it "
               "teleports out of it; the player pawn must always be loaded",
        "verify_with": "zc_dog_cell on a fresh PIE -- the far arm must now SURVIVE"}
