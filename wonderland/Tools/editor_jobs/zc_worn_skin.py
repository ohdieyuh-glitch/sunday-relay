# WHAT SKIN IS THE DOG ACTUALLY WEARING RIGHT NOW?
#
# Hiding the two companions in turn removed the owl-ish figure on the left and the crowned figure on the
# right, and the haloed figure in the middle of the ring stayed. So the ring is on the PLAYER'S DOG -- the
# Julius lane's "a hoop around the Dog" was right and my "it is the fountain" was wrong.
#
# A HALO IS NOT RELAY OG. The shipped default is relay_og, which has no ring. Something has left the Dog
# wearing a skin that does, and every capture anyone has taken since has been of a Dog in the wrong costume.
#
# THE LIKELY CULPRIT IS MINE. A dozen jobs tonight wear a skin and put relay_og back at the end. Any one of
# them that failed, voided, or was interrupted between those two points leaves the Dog dressed -- and the
# world lane spent tonight fixing exactly this shape of bug in their own jobs, where a bail path skips the
# restore that sits on the success path.
#
# This reads the worn skin and puts relay_og back if it is not already on.
CONCURRENT = False

import unreal

L = unreal.WonderlandUiTestLibrary


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    yield 6.0
    world = ues.get_game_world()
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    if dog is None or ui is None:
        RESULT["status"] = "VOID: no pawn or no UI"
        return

    worn = str(dog.get_worn_skin_id())
    RESULT["worn_at_start_of_a_fresh_pie"] = worn
    emit("S_WORN", "INFO", "what the Dog is wearing", {"skin": worn})
    record("S00", "a fresh session starts with the Dog in relay_og, the shipped default",
           "relay_og" in worn.lower(), worn=worn,
           note="THE RING. relay_og has no halo. A Dog wearing something else in a FRESH PIE means the skin "
                "is persisted, not merely left in a stale session -- so every capture taken since is of a "
                "Dog in the wrong costume, and the founder's plaza has been photographed dressed.")

    if "relay_og" not in worn.lower():
        try:
            ui.wear_relay_skin("relay_og")
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})["restore"] = str(err)[:140]
        yield 5.0
        back = str(dog.get_worn_skin_id())
        RESULT["worn_after_restore"] = back
        record("S01", "Relay OG was put back on the Dog", "relay_og" in back.lower(), worn=back)

    RESULT["status"] = "measured"
    yield 1.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
