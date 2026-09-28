# WHAT IS THE PALE RING AROUND THE DOG, AND WHOSE IS IT?
#
# The Julius lane found it in every frame of recent builds and measured its shape: UPRIGHT, roughly as tall
# as it is wide (about 550 x 585 px in a 1900-wide frame), CENTRED ON THE DOG, running from above its head
# down to the paving. It was absent from the 4bf3ad6bc25da3de frames.
#
# THREE HYPOTHESES HAVE ALREADY DIED, each by evidence rather than by argument:
#
#   THE FOUNTAIN REFLECTING (mine). A basin seen from player height is a wide flat ellipse -- the pink mosaic
#   ring on the plaza floor is one, about 4:1 -- and this is square. Roughening the water from 0.035 to 0.10
#   did not move it at all.
#
#   THE FIRE DEFAULT (the Julius lane's). 78826f13 is an ANCESTOR of 9fc15a32, verified, so wl.Look.FireMaterial
#   was already 1 in the frames that have no ring.
#
#   THE PRACTICAL LIGHTS (mine, pointed at the world lane). a92b5cfb changes one Python job, 46 lines, and
#   draws nothing. A practical pool selects WHICH lights are lit; it does not draw a boundary.
#
# SO STOP GUESSING AT AUTHORS AND ASK THE WORLD THREE QUESTIONS IT CAN ANSWER IN ONE RUN.
#
#   IS THE EDITOR EVEN IN ITS SHIPPED STATE? The world lane has had five voided runs tonight and their bail
#   path does not restore the knobs it set, so a console variable may be sitting non-default in this editor
#   and every capture anyone has reasoned from is of a world somebody modified without meaning to. This reads
#   them first, because "the editor is not shipped" invalidates the whole discussion before it starts.
#
#   IS IT MY LANE? One CVar: wl.Look.FireMaterial 0 rules out every flame surface in a single frame.
#
#   IS IT ATTACHED TO THE DOG? Move the Dog several metres. If the ring follows, it belongs to the pawn; if
#   it stays, it is in the world. That distinction survives whatever it turns out to be.
#
# NO FIX HERE, AND NO ATTRIBUTION EITHER. Four frames and four knob readings, so that the next person argues
# from evidence instead of from a plausible story. I have already had one plausible story about this and it
# was wrong.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary
SL = unreal.SystemLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "ring_cause")

# The world lane's knobs. All ship at 0.0 and are arithmetically today's behaviour there.
RESIDUE = ("wl.Sky.MoonCastAlways", "wl.Sky.MoonCastAltitude",
           "wl.Look.DuskMoonDamp", "wl.Look.DuskSkyBoost", "wl.Look.DuskWindow")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".png", ".jpg")):
            os.remove(os.path.join(ROOT, old))
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
    L.focus_game_viewport()
    yield 7.0
    world = ues.get_game_world()
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    if dog is None:
        RESULT["status"] = "VOID: no pawn"
        return

    # ---- IS THIS THE SHIPPED WORLD? Read before anything is changed or photographed.
    resident = {}
    for name in RESIDUE:
        try:
            resident[name] = round(float(SL.get_console_variable_float_value(name)), 4)
        except Exception:                                           # noqa: BLE001
            resident[name] = None
    try:
        resident["wl.Look.FireMaterial"] = int(SL.get_console_variable_int_value("wl.Look.FireMaterial"))
    except Exception:                                               # noqa: BLE001
        resident["wl.Look.FireMaterial"] = None
    RESULT["console_variables_as_found"] = resident
    left_set = sorted(k for k in RESIDUE if isinstance(resident.get(k), float) and abs(resident[k]) > 1e-6)
    RESULT["world_lane_knobs_left_non_default"] = left_set or None
    record("R00", "the editor is in its shipped state, so a frame taken here is of the shipped world",
           not left_set, as_found=resident, non_default=left_set or None,
           note="THE PRECONDITION NOBODY CHECKED. The world lane's jobs do not restore their knobs when they "
                "void, and there have been five voided runs tonight. If any of these is non-zero then every "
                "capture anyone has reasoned from today is of a world that was modified without being "
                "announced -- which has to be known before the frames mean anything.")

    home = dog.get_actor_location()
    yaw = dog.get_actor_rotation().yaw

    def look_at_dog(where, tag):
        # ---- DO NOT POSE A CAMERA. THIS IS THE FOURTH ONE I WOULD HAVE LOST.
        #
        # The previous version put the eye 520 uu behind the pawn at its own yaw, and the spawn faces a wall,
        # so all four frames came back as close-ups of masonry. Before that I lost a camera to a balustrade
        # and one to a wall in zc_water_reads, and the world lane lost one inside a bush. Every one of those
        # was a hand-computed vantage that nobody checked before the shutter.
        #
        # THE GAME'S OWN CAMERA CANNOT BE INSIDE A WALL, because it is the camera a player is looking through
        # and the game keeps it clear. It is also exactly the view the acceptance frames used -- the spawn
        # view -- which is the frame this whole question was raised about. So the right move is to take no
        # view at all and photograph the one that is already correct.
        return None

    shots = {}
    RESULT["captures"] = shots

    def shoot(tag, where):
        look_at_dog(where, tag)
        return tag, where

    def capture(tag):
        # ---- FOCUS BEFORE EVERY SHOT, NOT ONCE AT STARTUP.
        #
        # The previous run took none of its four frames and said nothing about why: capture_game_viewport
        # returned false each time and raised nothing, so `errors` was empty and only the count gave it away.
        # TakeScreenshot gets no pixels from a widget that is not being drawn, and a viewport that was focused
        # seven seconds and two console commands ago -- on an unattended machine where another lane's job has
        # since had the editor -- is not reliably still being drawn.
        #
        # The Julius lane reached the same conclusion from the other end tonight: their acceptance run wrote
        # no photographs at all, with no error in the log, and the fix was to focus before each photograph
        # rather than once after begin play. Same failure, same remedy.
        #
        # THE RETURN IS A TUPLE, NOT A BOOL. The C++ is
        # CaptureGameViewport(const FString&, int32& OutWidth, int32& OutHeight), so Python hands back
        # (ok, width, height) -- and a non-empty tuple is truthy whatever `ok` says. Unpacked here, so a
        # failed capture is recorded as failed instead of counted as a success.
        path = os.path.join(ROOT, "%s.png" % tag)
        try:
            L.focus_game_viewport()
        except Exception:                                           # noqa: BLE001
            pass
        try:
            got = L.capture_game_viewport(path)
            ok = bool(got[0]) if isinstance(got, (tuple, list)) else bool(got)
            size = tuple(got[1:3]) if isinstance(got, (tuple, list)) and len(got) >= 3 else None
            RESULT.setdefault("capture_calls", {})[tag] = {"ok": ok, "size": size,
                                                           "on_disk": os.path.exists(path)}
            if ok and os.path.exists(path):
                shots[tag] = os.path.basename(path)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[tag] = str(err)[:140]

    # 1. AS FOUND
    look_at_dog(home, "as_found")
    yield 2.5
    capture("as_found")

    # 2. FLAME SURFACES OFF -- one CVar, rules out a whole lane
    SL.execute_console_command(world, "wl.Look.FireMaterial 0")
    yield 3.0
    look_at_dog(dog.get_actor_location(), "fire_material_off")
    yield 2.0
    capture("fire_material_off")
    SL.execute_console_command(world, "wl.Look.FireMaterial 1")
    yield 2.0

    # 3. MOVED -- does it follow the Dog or stay where it was
    moved = unreal.Vector(home.x + math.cos(math.radians(yaw)) * 600.0,
                          home.y + math.sin(math.radians(yaw)) * 600.0, home.z)
    try:
        dog.set_actor_location(moved, False, True)
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["move"] = str(err)[:140]
    yield 3.0
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    if dog is not None:
        now = dog.get_actor_location()
        RESULT["moved_by_uu"] = round(math.hypot(now.x - home.x, now.y - home.y), 1)
        look_at_dog(now, "after_moving_the_dog")
        yield 2.0
        capture("after_moving_the_dog")
        # and the place it LEFT, framed the same way, so "did the ring stay behind" is answerable
        look_at_dog(home, "where_the_dog_was")
        yield 2.0
        capture("where_the_dog_was")

    try:
        dog.set_actor_location(home, False, True)
    except Exception:                                               # noqa: BLE001
        pass
    yield 1.5

    record("R01", "all four frames were taken", len(shots) == 4, captures=sorted(shots), where=ROOT,
           note="as found; with every flame surface off; with the Dog moved 6 m; and of the spot it left. "
                "Between them these say whether it is a flame, whether it is attached to the pawn, and "
                "whether it is in the world -- without anyone having to guess at an author.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
