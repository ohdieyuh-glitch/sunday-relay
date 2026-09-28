# HIDE THE CANDIDATES ONE AT A TIME AND SEE WHICH ONE THE RING GOES WITH.
#
# The ring is world geometry -- solid voxel stepping, and the Dog stands outside it. Enumerating the spawn
# turned up two actors at distance 0.0: Actor0, and Scale_CanonicalDog, which is a BP_RelayDog_C. The name
# says what it is: a canonical Dog placed as a SCALE REFERENCE. A development reference object standing in
# the founder's main plaza would be a beta blocker in its own right, quite apart from the ring.
#
# A BOUNDING BOX OF 2020 IS NOT EVIDENCE OF SIZE, and that trap is worth naming because it nearly became the
# finding. Both camera actors report 2020 x 2020 x 2020 as well, so that figure is the default bound for an
# actor with nothing renderable rather than a measurement of anything. The enumeration cannot tell me which
# actor draws the ring; only hiding one and looking can.
#
# SO: photograph as found, then hide each candidate in turn and photograph again. Whichever frame loses the
# ring names it. Everything is unhidden again afterwards.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "ring_hide")
# Neither Scale_CanonicalDog nor Actor0 removed it. The frames then showed what it actually is: a grey
# voxel figure with a dark visor and a large pale HALO around it -- and the spawn enumeration lists two
# AI Companions at 102 and 124 uu. A halo is Celestial Light's, and item 4 says preserve Celestial Light.
CANDIDATES = ("WL_Companion_GPT6Astra", "WL_Companion_ClaudeCodeFable5")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".png", ".jpg")):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    yield 7.0
    world = ues.get_game_world()

    found = {}
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            label = str(actor.get_actor_label())
        except Exception:                                           # noqa: BLE001
            continue
        if label in CANDIDATES:
            found[label] = actor
    RESULT["candidates_found"] = sorted(found)

    shots = {}
    RESULT["captures"] = shots
    calls = {}
    RESULT["capture_calls"] = calls

    def capture(tag):
        path = os.path.join(ROOT, "%s.png" % tag)
        try:
            L.focus_game_viewport()
        except Exception:                                           # noqa: BLE001
            pass
        try:
            got = L.capture_game_viewport(path)
            ok = bool(got[0]) if isinstance(got, (tuple, list)) else bool(got)
            calls[tag] = {"ok": ok, "on_disk": os.path.exists(path)}
            if ok and os.path.exists(path):
                shots[tag] = os.path.basename(path)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[tag] = str(err)[:140]

    capture("as_found")
    for label in CANDIDATES:
        actor = found.get(label)
        if actor is None:
            continue
        try:
            actor.set_actor_hidden_in_game(True)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})["hide/%s" % label] = str(err)[:140]
            continue
        yield 2.5
        capture("without_%s" % label)
        try:
            actor.set_actor_hidden_in_game(False)
        except Exception:                                           # noqa: BLE001
            pass
        yield 1.5

    tests.append({"id": "Z00", "name": "every candidate was hidden and photographed",
                  "pass": len(shots) == len(CANDIDATES) + 1,
                  "detail": {"captures": sorted(shots), "candidates": sorted(found), "where": ROOT}})
    emit("Z00", "PASS" if len(shots) == len(CANDIDATES) + 1 else "FAIL",
         "every candidate was hidden and photographed", {"captures": sorted(shots)})

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
