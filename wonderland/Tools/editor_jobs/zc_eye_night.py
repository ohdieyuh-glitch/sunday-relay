# HOW BRIGHT DO THE EYES HAVE TO BE DRIVEN AFTER DARK?
#
# FOUNDER: every skin's eyes must glow, "readable in daylight and stronger at night".
#
# PHOTOGRAPHED AT 23:30, AND THE PICTURE DISAGREES WITH THE PASS. Relay OG's eyes render as two flat dull
# gold squares -- eye luma 0.119 against a face of 0.029. The eye-glow proof passes them because 0.090 of
# separation clears its 0.05 floor, which is true and useless: out-reading a near-black visor is not the same
# as glowing, and the founder is looking at a mascot whose eyes are switched off at night.
#
# THE CAUSE IS IN THE NUMBER, AND THE COMMENT BESIDE IT ALREADY CONTAINS THE REFUTATION. wl.Look.EyeGlowDay is
# 18 and wl.Look.EyeGlowNight is 5. These are absolute emissive levels, not multipliers, and the skins author
# their eyes at 7.0 (Relay OG), 7.5 (Arden, Apollo) and 8.0 (Skeleton Flame). The note explains that an
# earlier value of 6.5 "is BELOW every skin in the lineup ... so setting that level changed nothing
# measurable" -- and then sets the night level to 5.0, which is lower still. After dark the eyes are driven
# DIMMER than the art already asks for.
#
# SO IT IS SWEPT RATHER THAN GUESSED, and both failure directions are measured at once: the eye's own
# brightness, and how much of it has clipped to white. Night opens the exposure by about 1.45 EV, so the same
# level renders roughly two and a half times brighter than it would at noon -- which is exactly why this was
# pulled down in the first place, and exactly why the right answer cannot be reasoned to from the day value.
CONCURRENT = True

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "eye_night")
SKINS = ("relay_og", "arden_infernal", "apollo", "skeleton_flame", "celestial_light")
LEVELS = (5.0, 9.0, 13.0, 18.0)
HOUR = 23.5


def luma(c):
    return round(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, 4)


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
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % HOUR)
    yield 4.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    if dog is None or pc is None:
        record("N00", "there is a Dog to photograph", False)
        RESULT["status"] = "FAIL"
        return
    ui = L.get_ui(world)

    # ---- THE EYE PATCH IS PROJECTED FROM THE FIGURE, NOT GUESSED AT A FIXED SCREEN RECT.
    #
    # The first version of this sweep read a hard-coded box at the middle of the frame and produced nonsense
    # that was obvious precisely because it was nonsense: Relay OG got DIMMER as the glow level rose (0.429
    # down to 0.264), three skins sat at exactly 1.000 at every level, and the same configuration that the
    # eye-glow proof measured at 0.119 came back as 0.429. The box was sampling the black visor above the eyes
    # on one skin and glowing body on others.
    #
    # 62 uu above the actor is the eyes and 44 uu is the face below them -- the same two heights the eye-glow
    # proof uses, so these readings can be laid beside its table instead of being a second private scale.
    def patch(z_above, half_w, half_h):
        size = pc.get_viewport_size()
        if not size or size[0] <= 0:
            return None
        here = dog.get_actor_location()
        got = unreal.GameplayStatics.project_world_to_screen(
            pc, unreal.Vector(here.x, here.y, here.z + z_above), False)
        if got is None:
            return None
        cx, cy = float(got.x) / size[0], float(got.y) / size[1]
        # OFF-SCREEN IS UNMEASURED, NOT DARK. A projection outside the frame must not be recorded as a
        # reading -- that is how a proof reports the eyes are off when the camera was simply pointed wrong.
        if not (0.08 < cx < 0.92 and 0.08 < cy < 0.92):
            return None
        got = L.read_screen_rect(cx - half_w, cy - half_h, cx + half_w, cy + half_h)
        if got is None:
            return None
        return {"luma": luma(got[0]), "blown": round(float(got[2]), 4)}

    rows = {}
    RESULT["by_level"] = rows
    for level in LEVELS:
        unreal.SystemLibrary.execute_console_command(world, "wl.Look.EyeGlowNight %.2f" % level)
        per = {}
        rows["%.1f" % level] = per
        for skin in SKINS:
            ui.wear_relay_skin(skin)
            yield 3.5
            # The head, from in front and close: the same framing the eye-glow proof uses, so the two sets of
            # numbers can be read against each other.
            at = dog.get_actor_location()
            fwd = dog.get_actor_forward_vector()
            eye_at = at + fwd * 300.0 + unreal.Vector(0.0, 0.0, 70.0)
            L.pose_camera(world, eye_at, at + unreal.Vector(0.0, 0.0, 70.0), 32.0)
            yield 1.5
            eyes = patch(62.0, 0.020, 0.012)
            face = patch(44.0, 0.020, 0.012)
            if eyes is not None and face is not None:
                per[skin] = {"eye_luma": eyes["luma"], "blown": eyes["blown"],
                             "face_luma": face["luma"],
                             "eye_over_face": round(eyes["luma"] - face["luma"], 4)}
            try:
                L.capture_game_viewport(os.path.join(ROOT, "lvl%04.1f_%s.png" % (level, skin)))
            except Exception:                                      # noqa: BLE001
                pass
            L.release_camera(world)
            yield 0.5
        emit("N_%.1f" % level, "INFO", "eye level %.1f" % level, per)

    unreal.SystemLibrary.execute_console_command(world, "wl.Look.EyeGlowNight 5.00")

    read = [v for per in rows.values() for v in per.values()]
    record("N00", "every level was read for every skin",
           len(read) == len(LEVELS) * len(SKINS), read=len(read), wanted=len(LEVELS) * len(SKINS))
    if len(read) != len(LEVELS) * len(SKINS):
        RESULT["status"] = "FAIL: the sweep was not measured"
        return

    # ---- WHICH LEVELS GIVE A LAMP RATHER THAN A PAINTED SQUARE, WITHOUT CLIPPING THE WHOLE EYE TO WHITE.
    good = []
    for level in LEVELS:
        key = "%.1f" % level
        lit = all(rows[key][s]["eye_luma"] >= 0.35 for s in SKINS)
        not_blown = all(rows[key][s]["blown"] <= 0.90 for s in SKINS)
        if lit and not_blown:
            good.append(level)
    RESULT["levels_passing"] = good
    RESULT["table"] = {k: {s: (v["eye_luma"], v["blown"], v["eye_over_face"]) for s, v in per.items()}
                       for k, per in rows.items()}
    emit("N_TABLE", "INFO", "eye luma and blown fraction by level", RESULT["table"])

    record("N01", "there is a night level where every skin's eyes read as lit",
           len(good) > 0, passing=good, table=RESULT["table"],
           luma_floor=0.35, blown_ceiling=0.90,
           note="the floor is what separates a lamp from paint -- Relay OG measured 0.119 at the shipped "
                "level of 5.0, which is the picture the founder called switched off. The ceiling is the "
                "other failure: an eye entirely clipped to white carries no colour and cannot show the "
                "founder's SECONDARY.")
    if good:
        RESULT["recommended"] = min(good)
        emit("N_BEST", "INFO", "the gentlest level that works everywhere", {"eye_glow_night": min(good)})

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
