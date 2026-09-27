# WHY IS THE RELAY DOG PERFORMING THE MOMENT PLAY STARTS?
#
# zc_skin_stance read samples_performing 0 of 90 at 12:03 today and 90 of 90 this evening, on three runs in a
# row. The overlay follows the Dog ACT -- bWant = Current != EWonderlandDogAct::None -- and wl.Mission.Reset
# does not clear it; only wl.Dog.Act none does.
#
# THE REASON I NEED TO KNOW, RATHER THAN JUST RESETTING IT IN THE PROOF. Between those two readings I saved
# the level three times: the navigation bounds volume, the navmesh's runtime_generation, and the ground
# slab's material. If one of those saves also wrote a mission-in-progress into the .umap, then I have baked a
# state into the founder's map where the Dog starts every session mid-act -- which a player would see and
# which no proof would catch, because every proof drives the act itself.
#
# So this asks, on a plain PIE start with nothing else run: what act is the Dog in, and is there anything in
# the level holding one.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import unreal

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary


def job():
    RESULT["status"] = "running"
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)

    # ---- WHAT THE SAVED LEVEL CONTAINS, before anything runs.
    world = ues.get_editor_world()
    interesting = []
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            label = str(actor.get_actor_label())
        except Exception:
            continue
        low = label.lower()
        if any(w in low for w in ("mission", "contract", "task", "scheduler", "fixture", "beat")):
            interesting.append(label[:56])
    RESULT["mission_actors_in_saved_level"] = sorted(set(interesting))[:40]
    emit("A00", "INFO", "mission-ish actors saved in the level",
         {"count": len(RESULT["mission_actors_in_saved_level"]),
          "labels": RESULT["mission_actors_in_saved_level"][:12]})

    # ---- AND WHAT THE DOG IS DOING ON A PLAIN START, with nothing driven.
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    gw = ues.get_game_world()
    L.focus_game_viewport()

    dogs = unreal.GameplayStatics.get_all_actors_of_class(gw, unreal.RelayDogCharacter)
    dog = dogs[0] if dogs else None

    marks = {}
    for wait, label in ((2.0, "after_2s"), (6.0, "after_6s"), (12.0, "after_12s"), (20.0, "after_20s")):
        yield wait
        try:
            marks[label] = round(float(dog.get_mission_overlay_weight()), 3) if dog is not None else None
        except Exception as err:                                   # noqa: BLE001
            marks[label] = "unreadable: %s" % str(err)[:60]
        emit(label, "INFO", "overlay weight " + label, {"weight": marks[label]})
    RESULT["overlay_on_plain_start"] = marks

    # ---- AND WHETHER CLEARING IT STICKS, which separates "something set it once" from "something keeps
    # setting it". If it comes back, a system is driving it every frame and the level is not the culprit.
    unreal.SystemLibrary.execute_console_command(gw, "wl.Dog.Act none")
    yield 3.0
    after = {}
    for wait, label in ((0.0, "cleared"), (6.0, "six_seconds_later"), (12.0, "eighteen_seconds_later")):
        if wait:
            yield wait
        try:
            after[label] = round(float(dog.get_mission_overlay_weight()), 3) if dog is not None else None
        except Exception:
            after[label] = None
        emit(label, "INFO", "after clearing", {"weight": after[label]})
    RESULT["after_clearing"] = after

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
