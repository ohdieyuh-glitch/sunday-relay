# IS THE PLAYER'S OWN DOG BEING UNLOADED WHEN IT WALKS AWAY FROM WHERE IT WAS PLACED?
#
# The remaining explanation for a mystery that three proofs have now died on. Since the conversion the Dog is
# destroyed part-way through a tour of the world -- but not by falling: every stand traces solid ground
# beneath it, and the fall-catcher added for that never fires because there is nothing to catch.
#
# THE SHAPE OF IT POINTS SOMEWHERE ELSE. It survives the stands near the Arrival Gate and dies from about
# 700 m out. That is not a property of the destination; it is a property of the DISTANCE FROM WHERE IT
# STARTED. The Dog is a placed actor -- the engine config says BP_RelayDog auto-possesses Player 0 during
# InitInputSystem, which a runtime-spawned pawn does not do -- and World Partition pages placed actors by
# cell. If the Dog is marked spatially loaded, then walking far enough from the Arrival Gate unloads the cell
# the Dog was placed in, and takes the player's own body with it.
#
# That would be a catastrophic thing to ship: the player ceases to exist for walking too far from spawn. It is
# also invisible to every count of what the map contains. So this asks the actor directly.
CONCURRENT = True

import unreal

L = unreal.WonderlandUiTestLibrary


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    editor_world = ues.get_editor_world()

    # Asked of the EDITOR world, where the placed actor and its authored flag live.
    found = []
    RESULT["placed_dogs"] = found
    for actor in unreal.GameplayStatics.get_all_actors_of_class(editor_world, unreal.Actor):
        try:
            name = str(actor.get_actor_label())
            cls = str(actor.get_class().get_name())
        except Exception:                                          # noqa: BLE001
            continue
        if "relaydog" not in name.lower().replace("_", "") and "RelayDog" not in cls:
            continue
        row = {"label": name, "class": cls}
        try:
            row["is_spatially_loaded"] = bool(actor.get_editor_property("is_spatially_loaded"))
        except Exception as err:                                   # noqa: BLE001
            row["is_spatially_loaded"] = "?" + str(err)[:60]
        try:
            at = actor.get_actor_location()
            row["at"] = [round(at.x), round(at.y), round(at.z)]
        except Exception:                                          # noqa: BLE001
            pass
        found.append(row)
    emit("D_FOUND", "INFO", "placed Relay Dogs in the editor world", {"found": found})

    record("D00", "the placed Relay Dog was found in the editor world", len(found) > 0, found=found)
    if not found:
        RESULT["status"] = "FAIL: no placed Dog"
        return

    pinned = [f for f in found if f.get("is_spatially_loaded") is False]
    record("D01", "the player's own Dog is always loaded, not paged with a cell",
           len(pinned) == len(found), dogs=found,
           note="a placed pawn marked spatially loaded is destroyed when the cell it was placed in unloads -- "
                "which happens as soon as the player walks far enough from spawn. The player's body must be "
                "in the always-loaded set.")

    RESULT["status"] = "measured"
    yield 0.5
