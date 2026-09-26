# DO THE EYES READ AS LIT AT EVERY HOUR, ON EVERY SKIN?
#
# FOUNDER, 2026-09-26: "Every mascot skin eyes have to be glowing even when its day time in wonderland."
#
# WHY DAYTIME IS THE HARD CASE AND NIGHT IS NOT. An emissive surface renders the value it was given whatever
# the sky is doing, so at midnight the eyes are the brightest thing for metres. At noon a 70,000 lux sun falls
# on ivory stone beside them and the exposure closes nearly a stop to cope with it -- the eye keeps its value
# while everything around it climbs past, and it stops reading as a lamp and starts reading as a painted
# square. Nothing is "off": it is out-competed.
#
# SO THE TEST IS A COMPARISON, NOT A BRIGHTNESS. An absolute floor would pass a dull eye at midnight and fail
# a blazing one at noon. What matters is whether the eye out-reads THE FACE IT IS SET INTO, at that same hour,
# in that same frame -- which is exactly the thing the founder can see and the thing the sun can take away.
#
# The eye patch is projected from the figure rather than guessed: this project has photographed a wall and
# called it a mascot more than once today.
CONCURRENT = True

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "eyes_glow")
SKINS = ("relay_og", "arden_infernal", "apollo", "skeleton_flame", "celestial_light")
HOURS = (12.0, 16.0, 22.0)


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
    yield 7.0

    def cmd(line):
        unreal.SystemLibrary.execute_console_command(world, line)

    cmd("wl.Sky.DayMinutes 0")
    ui = L.get_ui(world)
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)

    def face_the_dog():
        """Close enough that the eyes are several pixels across, and clear of anything standing between."""
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw
        aim = unreal.Vector(here.x, here.y, here.z + 62.0)
        reach = 300.0
        for candidate in (300.0, 250.0, 200.0, 160.0):
            spot = unreal.Vector(here.x + math.cos(math.radians(yaw)) * candidate,
                                 here.y + math.sin(math.radians(yaw)) * candidate, here.z + 70.0)
            hit = unreal.SystemLibrary.line_trace_single(
                world, spot, aim, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [dog],
                unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            if hit is None:
                reach = candidate
                break
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * reach,
                            here.y + math.sin(math.radians(yaw)) * reach, here.z + 70.0)
        L.pose_camera(world, eye, aim, 32.0)
        return reach

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
        if not (0.08 < cx < 0.92 and 0.08 < cy < 0.92):
            return None
        got = L.read_screen_rect(cx - half_w, cy - half_h, cx + half_w, cy + half_h)
        if got is None:
            return None
        row = {"luma": luma(got[0]), "bright": round(float(got[2]), 4)}
        # AND WHETHER IT STILL HAS A COLOUR. A lamp's core clips -- that is what a lamp looks like -- so the
        # question is not whether any pixel is white but whether the eye is ONLY white. All five skins author
        # a coloured eye (gold, ember, pale gold, cyan, pale blue), and white has no channel separation.
        hot = L.read_screen_extremes(cx - half_w, cy - half_h, cx + half_w, cy + half_h)
        if hot is not None:
            row["colour"] = round(max(float(hot[0]), float(hot[1]), float(hot[2])), 4)
        return row

    rows = {}
    RESULT["by_hour"] = rows
    for hour in HOURS:
        cmd("wl.Sky.Hour %.2f" % hour)
        yield 6.0
        per = {}
        rows["%.1f" % hour] = per
        for skin in SKINS:
            ui.wear_relay_skin(skin)
            yield 5.0
            reach = face_the_dog()
            yield 2.0
            # THE EYES, and the face just below them, in the same frame at the same instant.
            eyes = patch(62.0, 0.020, 0.012)
            face = patch(44.0, 0.020, 0.012)
            row = {"camera_uu": reach}
            if eyes is not None:
                row["eye_luma"] = eyes["luma"]
                row["eye_blown"] = eyes["bright"]
                row["colour"] = eyes.get("colour")
            if face is not None:
                row["face_luma"] = face["luma"]
            if eyes is not None and face is not None:
                row["eye_over_face"] = round(eyes["luma"] - face["luma"], 4)
            per[skin] = row
            try:
                L.capture_game_viewport(os.path.join(ROOT, "h%04.1f_%s.png" % (hour, skin)))
            except Exception:
                pass
            L.release_camera(world)
        emit("E_%04.1f" % hour, "INFO", "hour %.1f" % hour, per)

    cmd("wl.Sky.Hour 9.50")

    wanted = len(HOURS) * len(SKINS)
    got = [v for per in rows.values() for v in per.values() if "eye_over_face" in v]
    record("E00", "the eyes and the face were both read for every skin at every hour",
           len(got) == wanted, read=len(got), wanted=wanted,
           note="a missing reading means the figure did not project into frame, not that the eyes are dark")
    if len(got) != wanted:
        RESULT["status"] = "FAIL: not every skin was read"
        return

    # ---- THE FOUNDER'S CLAUSE, and daytime is where it bites.
    worst = {}
    for hour, per in rows.items():
        worst[hour] = min(v["eye_over_face"] for v in per.values())
    RESULT["weakest_eye_over_face_by_hour"] = worst
    RESULT["table"] = {h: {s: {"eye": v.get("eye_luma"), "face": v.get("face_luma"),
                               "over": v.get("eye_over_face")}
                           for s, v in per.items()} for h, per in rows.items()}
    emit("E_TABLE", "INFO", "eye against face, by hour and skin", RESULT["table"])

    # ---- READS AS LIT, BY EITHER ROUTE.
    #
    # "Brighter than the face it is set into" is the right test for four of the five skins and is unfair to
    # the fifth: Celestial Light's head stands inside its own halo, so the reference patch reads 1.0 white and
    # the eye can never out-read it however brightly it burns -- measured at -0.14 while the eye itself was at
    # 0.86, which is plainly a lamp. So an eye passes by clearing its own face OR by being unmistakably bright
    # in its own right. Both are ways of being visibly lit; neither can be satisfied by an eye that is off.
    def lit(v):
        return v["eye_over_face"] > 0.05 or v.get("eye_luma", 0.0) >= 0.55

    day = rows["12.0"]
    record("E01", "at noon every skin's eyes read as lit",
           all(lit(v) for v in day.values()),
           at_noon={s: {"over_face": v["eye_over_face"], "eye": v.get("eye_luma")} for s, v in day.items()},
           over_face_floor=0.05, or_absolute_floor=0.55,
           note="the founder: eyes have to be glowing even when it is day time. Daylight is the hard case -- "
                "an emissive keeps its value while the sunlit stone beside it climbs past.")
    record("E02", "the eyes read as lit at every hour tested, not only after dark",
           all(lit(v) for per in rows.values() for v in per.values()),
           weakest_over_face_by_hour=worst, table=RESULT["table"])
    record("E03", "the eyes keep a colour instead of being only white",
           all(v.get("colour", 0.0) >= 0.05 for per in rows.values() for v in per.values()),
           colour_separation={h: {s: v.get("colour") for s, v in per.items()} for h, per in rows.items()},
           floor=0.05,
           note="the blown-white fraction was the first version of this clause and it was the wrong question: "
                "a lamp's core clips, and capping that would forbid the correct picture. What must survive is "
                "the HUE, because the eyes carry the founder's SECONDARY colour and show status. White has no "
                "channel separation at all.")
    RESULT["blown_fraction"] = {h: {s: v.get("eye_blown") for s, v in per.items()} for h, per in rows.items()}
    emit("E_BLOWN", "INFO", "how much of each eye patch is over white, reported and not judged",
         RESULT["blown_fraction"])

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
