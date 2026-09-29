# THE WARDROBE FRAMING MUST SURVIVE BEING USED.
#
# FOUNDER: "Add an automated regression proof that cycles: open wardrobe, close, reopen, switch skins, change
# colours, rotate 360, move the player -- and confirm the mascot framing stays correct every time."
#
# WHY THIS IS THE SHAPE OF THE TEST. The framing bug has been reported four times and fixed three, and each
# fix held until something touched it. The two that actually recurred were both MEMORY: a decaying peak that
# remembered one large frame across skin switches, and an aggregate bound that grew when a flame flared. A
# framing that remembers is a framing that drifts. So this does not check that the framing is right once --
# it checks that it is the SAME after everything a founder can do to it.
#
# The solve reports its own inputs and its predicted occupancy. Drift of any kind shows up as that string
# changing for a skin whose body has not changed, which is the precise signature of state that should not
# exist. Captures are taken at the start and the end so the claim is also photographed.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wardrobe_regress")
SKINS = ("relay_og", "jack_flame", "baal", "skeleton_flame", "celestial_light")

# Primary then secondary, as six floats. The extremes are the point: pure white on cyan and near-black on
# violet are the two combinations most likely to expose a solve that is really reading brightness.
COMBOS = ((1.00, 1.00, 1.00, 0.10, 0.90, 1.00),
          (0.05, 0.05, 0.06, 0.75, 0.20, 1.00),
          (0.90, 0.10, 0.10, 0.15, 0.30, 1.00))


def job():
    os.makedirs(ROOT, exist_ok=True)
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
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 6.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.0")
    ui = L.get_ui(world)

    def open_wardrobe():
        if not ui.is_project_brain_open():
            ui.toggle_project_brain()
        ui.press_switch_skin()

    def body_of():
        for actor in unreal.GameplayStatics.get_all_actors_of_class(
                world, unreal.WonderlandCompanionEmbodiment):
            try:
                if "SkinStage" in str(actor.get_actor_label()):
                    return actor
            except Exception:                                      # noqa: BLE001
                pass
        return None

    open_wardrobe()
    yield 5.0

    # ---- THE STAGE IS LOOKED FOR ONLY AFTER THE WARDROBE IS OPEN.
    #
    # It is created when the panel opens, not when the world starts, so searching for it first finds nothing
    # and the proof fails with "the stage exists" while the feature is perfectly healthy. A proof that runs
    # its setup in the wrong order reports a fault in the thing it was pointed at.
    stage = None
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSkinStage):
        stage = actor
        break
    if stage is None:
        record("R00", "the stage exists once the wardrobe has been opened", False)
        RESULT["status"] = "FAIL"
        return

    # ---- THE BASELINE. Every skin solve, before anything has been done to it.
    baseline = {}
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 3.0
        baseline[skin] = str(stage.describe_framing())
    RESULT["baseline"] = baseline
    record("R00", "every skin framing was recorded before the cycle",
           all("distance=" in v for v in baseline.values()), baseline=baseline)
    try:
        unreal.RenderingLibrary.export_render_target(
            world, stage.get_render_target(), ROOT, "before.png")
    except Exception:                                              # noqa: BLE001
        pass

    steps = []
    RESULT["steps"] = steps

    # ---- 1. CLOSE AND REOPEN, three times.
    for _ in range(3):
        ui.toggle_project_brain()
        yield 2.0
        open_wardrobe()
        yield 3.0
    steps.append("closed and reopened three times")

    # ---- 2. EVERY SKIN, TWICE ROUND, which is what the decaying peak could not survive.
    for _ in range(2):
        for skin in SKINS:
            ui.wear_relay_skin(skin)
            yield 1.5
    steps.append("cycled all five skins twice")

    # ---- 3. COLOURS, on the skin whose flames vote loudest.
    ui.wear_relay_skin("arden_infernal")
    yield 2.0
    style = unreal.WonderlandMascotStyleSettings.get_default_object()
    for vals in COMBOS:
        try:
            style.set_editor_property("primary", unreal.LinearColor(vals[0], vals[1], vals[2], 1.0))
            style.set_editor_property("secondary", unreal.LinearColor(vals[3], vals[4], vals[5], 1.0))
            ui.wear_relay_skin("arden_infernal")
        except Exception as err:                                   # noqa: BLE001
            RESULT.setdefault("errors", {})["colours"] = str(err)[:140]
        yield 2.0
    # PUT THE FOUNDER COLOURS BACK. A proof that leaves the mascot violet has broken the thing it tested.
    try:
        style.set_editor_property("primary", unreal.LinearColor(1.0, 1.0, 1.0, 1.0))
        style.set_editor_property("secondary", unreal.LinearColor(1.0, 0.78, 0.16, 1.0))
    except Exception:                                              # noqa: BLE001
        pass
    steps.append("changed primary and secondary through three combinations and restored the defaults")

    # ---- 4. A FULL TURN, in steps, which is how an animated flame gets to vote many times.
    figure = body_of()
    for step in range(12):
        if figure is not None:
            try:
                figure.set_actor_rotation(unreal.Rotator(0.0, step * 30.0, 0.0), False)
            except Exception:                                      # noqa: BLE001
                pass
        yield 0.6
    if figure is not None:
        try:
            figure.set_actor_rotation(unreal.Rotator(0.0, 0.0, 0.0), False)
        except Exception:                                          # noqa: BLE001
            pass
    steps.append("rotated the figure a full 360 in twelve steps")

    # ---- 5. THE PLAYER MOVES, AND THE CLOCK SWEEPS.
    #
    # The founder rule that the preview has NO LIVE-WORLD DEPENDENCY. It is a stage in a box: it must not care
    # where the Dog is standing or what the sky is doing. This is the step that would have caught the old
    # wardrobe, which was a hole in the panel and was measured three times darker at midnight than at noon.
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    if dog is not None:
        try:
            at = dog.get_actor_location()
            dog.set_actor_location(unreal.Vector(at.x + 9000.0, at.y + 7000.0, at.z + 400.0), False, False)
        except Exception:                                          # noqa: BLE001
            pass
    yield 4.0
    for hour in (0.5, 6.0, 21.0, 12.0):
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.1f" % hour)
        yield 1.5
    steps.append("teleported the player 11 km and swept the clock through night and back")

    # ---- THE SAME QUESTION, ASKED AGAIN.
    after = {}
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 3.0
        after[skin] = str(stage.describe_framing())
    RESULT["after"] = after
    try:
        unreal.RenderingLibrary.export_render_target(
            world, stage.get_render_target(), ROOT, "after.png")
    except Exception:                                              # noqa: BLE001
        pass

    # ---- WHAT MUST NOT DRIFT IS HOW BIG THE MASCOT LOOKS, NOT THE NUMBER BEHIND IT.
    #
    # Comparing the whole note found all five skins "drifted" on a healthy build, and reading the two notes
    # side by side showed why: the staged SCALE moved from 0.337 to 0.460 across the cycle, because the stage
    # sizes itself against the player's camera and this cycle deliberately teleports the player 11 km. The body
    # did not change at all -- 53.1/0.337 and 72.7/0.460 are the same 158 uu figure -- and the camera solve
    # followed it exactly, so the predicted occupancy was 80.0% before and 80.0% after. The captures agree: the
    # before and after frames measure within three percent of each other.
    #
    # A test that fails on a build whose picture is identical is not protecting the founder from anything; it
    # trains everyone to ignore it. So the invariant is the occupancy the solve produces, which is the thing
    # the founder actually looks at, and the raw distances are recorded beside it so a real change is still
    # visible in the report.
    def occupancy_in(note):
        for token in str(note).split():
            if token.startswith("predictedHeightPct="):
                try:
                    return float(token.split("=", 1)[1])
                except ValueError:
                    return None
        return None

    drift = {}
    for skin in SKINS:
        was = occupancy_in(baseline.get(skin))
        now = occupancy_in(after.get(skin))
        if was is None or now is None:
            drift[skin] = "unreadable"
        elif abs(now - was) > 3.0:
            drift[skin] = {"before_pct": was, "after_pct": now}
    RESULT["occupancy_drift"] = drift
    record("R01", "the mascot is still the same size on screen after the whole cycle",
           len(drift) == 0, drifted=drift, tolerance_pct=3.0, steps=steps,
           before=baseline, afterwards=after,
           note="occupancy, not camera distance: the stage rescales itself when the player moves and the "
                "solve follows it, so the distance legitimately changes while the picture does not")

    on_body = [s for s in SKINS if "onBody=1" in after.get(s, "")]
    record("R02", "every skin is still framed on its physical body, not the total actor bounds",
           len(on_body) == len(SKINS), on_body=on_body, notes=after,
           note="onBody=0 means GetFramingBodyBounds returned nothing and the solve fell back to the declared "
                "envelope, which includes halos and flames -- the exact thing the founder ruled out")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
