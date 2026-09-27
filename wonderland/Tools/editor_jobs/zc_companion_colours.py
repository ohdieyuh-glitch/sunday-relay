# ARE THE COMPANION'S TWO COLOUR CHANNELS GENUINELY INDEPENDENT?
#
# FOUNDER: PRIMARY must control the solid white body parts and SECONDARY the glowing energy portions, and the
# two must be independently selectable -- "verify at least 5 combinations visually".
#
# WHY A PROOF RATHER THAN A CODE READING. The wiring is easy to confirm by eye in ApplyColourway and that
# confirms nothing: this project has shipped a colourway that multiplied the right channel into a material
# instance whose parameter name the shader did not have, and the picture never changed while every assertion
# passed. The only thing that settles it is the rendered pixels moving when one channel moves and NOT moving
# when the other does.
#
# SO EACH CHANNEL IS TESTED AGAINST THE OTHER HOLDING STILL. Two of the five combinations share a primary and
# differ only in secondary; two share a secondary and differ only in primary. If the body follows the
# secondary, or the glow follows the primary, that shows up as the wrong patch moving -- which a sweep of five
# unrelated colour pairs could not distinguish from both channels driving everything at once.
CONCURRENT = True

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "companion_colours")

# name, primary rgb, secondary rgb.
# Rows 1 and 2 hold PRIMARY and move SECONDARY. Rows 2 and 3 hold SECONDARY and move PRIMARY.
COMBOS = (
    ("white_on_cyan",   (1.00, 1.00, 1.00), (0.10, 0.85, 1.00)),
    ("white_on_violet", (1.00, 1.00, 1.00), (0.70, 0.20, 1.00)),
    ("black_on_violet", (0.05, 0.05, 0.06), (0.70, 0.20, 1.00)),
    ("red_on_blue",     (0.90, 0.12, 0.10), (0.15, 0.30, 1.00)),
    ("gold_on_white",   (1.00, 0.78, 0.20), (1.00, 1.00, 1.00)),
)


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
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
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 8.0
    # MIDDAY AND HELD, so the day cycle's own exposure work is not moving underneath the readings.
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.0")
    yield 3.0

    # ---- FIND A COMPANION, and specifically not the mascot: the two roles read different colour channels,
    # ---- and photographing the Dog here would prove nothing about the companion's wiring.
    companion = None
    seen = []
    for actor in unreal.GameplayStatics.get_all_actors_of_class(
            world, unreal.WonderlandCompanionEmbodiment):
        try:
            label = str(actor.get_actor_label())
        except Exception:                                          # noqa: BLE001
            continue
        seen.append(label)
        # NOT THE WARDROBE MANNEQUIN. It wears the MASCOT colourway, so photographing it here would read the
        # wrong pair of channels entirely and pass or fail for reasons that have nothing to do with companions.
        if "SkinStage" in label:
            continue
        companion = actor
        break
    RESULT["embodiments_in_world"] = seen
    if companion is None:
        record("C00", "there is an AI companion embodied in the world", False,
               note="without a companion body in the world this proof cannot photograph anything, and a pass "
                    "here would be vacuous")
        RESULT["status"] = "FAIL: no companion body"
        return
    at = companion.get_actor_location()
    record("C00", "there is an AI companion embodied in the world", True,
           label=str(companion.get_actor_label()), at=[round(at.x), round(at.y), round(at.z)])

    # ---- A CLOSE, HELD CAMERA. The readings are compared across combinations, so the framing must not move
    # ---- between them or a colour change and a camera change look identical.
    tall = 160.0
    try:
        tall = max(float(companion.get_figure_height_uu()), 60.0)
    except Exception:                                              # noqa: BLE001
        pass
    eye = unreal.Vector(at.x + tall * 2.4, at.y - tall * 0.35, at.z + tall * 0.55)
    aim = unreal.Vector(at.x, at.y, at.z + tall * 0.45)
    L.pose_camera(world, eye, aim, 34.0)
    yield 3.0

    rows = {}
    RESULT["by_combo"] = rows
    for name, pri, sec in COMBOS:
        # THROUGH THE FOUNDER'S OWN CONTROL. PickCompanionColour is what the Colors tab calls, so this
        # exercises the route a person uses rather than writing the setting behind the UI's back -- which
        # would pass even if the tab were wired to nothing.
        try:
            L.pick_companion_colour(True, unreal.LinearColor(pri[0], pri[1], pri[2], 1.0))
            L.pick_companion_colour(False, unreal.LinearColor(sec[0], sec[1], sec[2], 1.0))
        except Exception as err:                                   # noqa: BLE001
            RESULT.setdefault("errors", {})[name] = str(err)[:140]
        yield 3.0

        got = L.read_screen_extremes(0.36, 0.28, 0.64, 0.78)
        row = {"primary": list(pri), "secondary": list(sec)}
        if got is not None:
            green_over_red, blue_over_red, red_over_blue, mean, sampled = got
            row["most_blue_over_red"] = round(float(blue_over_red), 4)
            row["most_red_over_blue"] = round(float(red_over_blue), 4)
            row["most_green_over_red"] = round(float(green_over_red), 4)
            row["mean_luma"] = round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4)
            row["sampled"] = int(sampled)
        rows[name] = row
        try:
            L.capture_game_viewport(os.path.join(ROOT, "%s.png" % name))
        except Exception:                                          # noqa: BLE001
            pass
        emit("C_%s" % name, "INFO", name, row)

    try:
        L.release_camera(world)
    except Exception:                                              # noqa: BLE001
        pass
    # PUT THE DEFAULTS BACK, so a proof does not leave the founder's companions recoloured.
    try:
        L.pick_companion_colour(True, unreal.LinearColor(1.0, 1.0, 1.0, 1.0))
        L.pick_companion_colour(False, unreal.LinearColor(0.42, 0.80, 1.00, 1.0))
    except Exception:                                              # noqa: BLE001
        pass

    read = [r for r in rows.values() if "mean_luma" in r]
    record("C01", "every combination was actually read", len(read) == len(COMBOS),
           read=len(read), wanted=len(COMBOS))
    if len(read) != len(COMBOS):
        RESULT["status"] = "FAIL: not every combination was measured"
        return

    # ---- SECONDARY MOVES THE GLOW WHILE PRIMARY HOLDS STILL.
    cyan = rows["white_on_cyan"]
    violet = rows["white_on_violet"]
    glow_moved = abs(cyan["most_blue_over_red"] - violet["most_blue_over_red"]) > 0.02 \
        or abs(cyan["most_green_over_red"] - violet["most_green_over_red"]) > 0.02
    record("C02", "SECONDARY alone changes the picture", glow_moved,
           white_on_cyan=cyan, white_on_violet=violet,
           note="identical PRIMARY, different SECONDARY. If nothing moves, the secondary channel is not "
                "reaching the glow surfaces at all -- which is what a mis-named material parameter looks "
                "like, and it looks exactly like a correct one that had no effect")

    # ---- PRIMARY MOVES THE BODY WHILE SECONDARY HOLDS STILL.
    black = rows["black_on_violet"]
    body_moved = abs(violet["mean_luma"] - black["mean_luma"]) > 0.01
    record("C03", "PRIMARY alone changes the picture", body_moved,
           white_on_violet=violet, black_on_violet=black,
           note="identical SECONDARY, different PRIMARY. A near-black body against a white one must change "
                "the frame's luma; if it does not, the primary channel is not reaching the solid parts")

    # ---- AND THEY ARE NOT THE SAME KNOB. Changing only the primary must not swing the glow's hue the way
    # ---- changing only the secondary does.
    glow_swing_from_secondary = abs(cyan["most_blue_over_red"] - violet["most_blue_over_red"])
    glow_swing_from_primary = abs(violet["most_blue_over_red"] - black["most_blue_over_red"])
    record("C04", "the two channels are independent, not one knob driving everything",
           glow_swing_from_secondary > glow_swing_from_primary,
           from_secondary=round(glow_swing_from_secondary, 4),
           from_primary=round(glow_swing_from_primary, 4),
           note="the glow's hue must answer to SECONDARY more than to PRIMARY. If the primary swings it just "
                "as hard, one colour is driving both channels and the founder's two controls are decorative")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
