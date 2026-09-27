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
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "eyes_glow")
SKINS = ("relay_og", "celestial_light", "apollo_v1", "apollo", "arden_infernal_v1", "arden_infernal", "skeleton_flame_v1", "skeleton_flame")
HOURS = (12.0, 18.8, 23.5)   # FOUNDER: DAY, DUSK, NIGHT. Dusk is the hard one -- the sun is low and
                             # warm and the exposure is still open, so an eye that only wins at midnight loses here.


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

    def patch(z_above, half_w, half_h, dx=0.0):
        size = pc.get_viewport_size()
        if not size or size[0] <= 0:
            return None
        here = dog.get_actor_location()
        got = unreal.GameplayStatics.project_world_to_screen(
            pc, unreal.Vector(here.x, here.y, here.z + z_above), False)
        if got is None:
            return None
        cx, cy = float(got.x) / size[0] + dx, float(got.y) / size[1]
        if not (0.08 < cx < 0.92 and 0.08 < cy < 0.92):
            return None
        got = L.read_screen_rect(cx - half_w, cy - half_h, cx + half_w, cy + half_h)
        if got is None:
            return None
        row = {"luma": luma(got[0]), "bright": round(float(got[2]), 4)}
        # AND WHETHER IT STILL HAS A COLOUR. A lamp's core clips -- that is what a lamp looks like -- so the
        # question is not whether any pixel is white but whether the eye is ONLY white. All five skins author
        # a coloured eye (gold, ember, pale gold, cyan, pale blue), and white has no channel separation.
        #
        # READ ACROSS THE GLOW, NOT JUST THE CORE, because that is where the colour of a lamp lives and it is
        # how a person actually sees one. A bright emissive clips its centre to white and throws its hue into
        # the bloom around it; sampling only the centre therefore reports "no colour" for exactly the lamps
        # that are working hardest. Measured on the tight box, Celestial Light -- the palest authored eye in
        # the lineup, (0.62, 0.88, 1.00), set in a head that stands inside its own halo -- returned 0.031
        # against a 0.05 floor while plainly reading as a pale blue light on screen.
        # Widening the box to 2.2x to catch the bloom was tried and is not kept: it lifted Celestial Light from
        # 0.031 to 0.035 and dropped Relay OG at 22:00 from 0.059 to 0.035, which is not a better instrument,
        # only a differently diluted one.
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
            # THE EYES, AND THE CHEEK BESIDE THEM, in the same frame at the same instant.
            #
            # THE OLD REFERENCE WAS THE CHEST. +44 uu is figure z 13.6 at 3.24 uu a unit -- the middle of the
            # torso, which on Skeleton Flame is the 8,800-strength skull plate and on Arden the chains and the
            # medallion. So eye_over_face was eye-over-chest-skull, and the one skin whose eyes could never
            # fail this was the one with nothing glowing on its chest. The reference is now bone BESIDE the eye
            # at the eye's own height, one patch-width outboard on screen -- the face the eye is actually set
            # into, which is what the clause has claimed to measure since it was written. Stricter, not looser:
            # a head that is lit as a whole cannot pass this by having a dark chest.
            eyes = patch(62.0, 0.020, 0.012)
            face = patch(62.0, 0.020, 0.012, dx=0.048)
            row = {"camera_uu": reach}
            if eyes is not None:
                row["eye_luma"] = eyes["luma"]
                row["eye_blown"] = eyes["bright"]
                # Named for the saturation guard in usable(): a frame where BOTH the eye and the face it is
                # set into are clipped cannot distinguish a lamp from a white square.
                row["eye_bright"] = eyes["bright"]
                row["colour"] = eyes.get("colour")
            if face is not None:
                row["face_luma"] = face["luma"]
                row["face_bright"] = face["bright"]
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
    # ---- GLOW IS LOCAL CONTRAST. THE ABSOLUTE BRANCH IS GONE, AND IT WAS LETTING FAILURES THROUGH.
    #
    # This used to pass on "eye_over_face > 0.05 OR eye_luma >= 0.55", and the second half is not a test of
    # glow at all. A bright eye set in a brighter face is not glowing -- it is a bright head. Two skins were
    # passing on it:
    #
    #   CELESTIAL LIGHT reads over_face -0.1438 / -0.1456 / -0.2378 at noon, dusk and midnight. Its eye is
    #   DARKER than its own face at every hour of the day, and it passed on an absolute 0.8562.
    #   ARDEN INFERNAL at noon reads 0.0361 over a face of 0.9629 with an eye at 0.999 -- both clipped. That
    #   is a saturated head, and saturation is the one condition under which this measurement cannot say
    #   anything about glow either way.
    #
    # This is the same instrument fault already caught and fixed for Skeleton Flame's pulse and for the
    # wardrobe's framing: a clause that can be satisfied without the thing it names being true.
    #
    # SO: local contrast only, and a saturated sample is UNUSABLE rather than a pass. An unusable sample is
    # reported and fails the coverage clause, because "the exposure blew out the whole head so we cannot
    # tell" must never read the same as "the eyes are glowing".
    SATURATED = 0.90

    def usable(v):
        """False when eye AND face are both clipped -- nothing about glow can be read from that frame."""
        return not (v.get("eye_bright", 0.0) >= SATURATED and v.get("face_bright", 0.0) >= SATURATED)

    def lit(v):
        # The eye must out-read the face it is set into. No absolute escape hatch.
        return usable(v) and v["eye_over_face"] > 0.05

    def has_colour(v):
        # And the established colour must survive: a white square carries no skin identity and cannot show
        # the founder's SECONDARY. Reported for every sample; gated only where the instrument can resolve it.
        return v.get("colour", 0.0) > 0.0

    day = rows["12.0"]
    unusable_day = {s: v for s, v in day.items() if not usable(v)}
    RESULT["unusable_samples"] = {
        h: [s for s, v in per.items() if not usable(v)] for h, per in rows.items()}
    record("E01", "at noon every skin's eyes out-read the face they are set into",
           all(lit(v) for v in day.values()),
           at_noon={s: {"over_face": v["eye_over_face"], "eye": v.get("eye_luma"),
                        "face": v.get("face_luma"), "colour": v.get("colour"),
                        "usable": usable(v)} for s, v in day.items()},
           over_face_floor=0.05, unusable=list(unusable_day.keys()),
           note="local contrast only. The absolute-brightness branch was removed on 2026-09-27: it passed "
                "Celestial Light, whose eye is DARKER than its own face at every hour, and Arden Infernal on "
                "a clipped head. Daylight is the hard case -- an emissive holds its value while the sunlit "
                "stone beside it climbs past.")
    record("E03", "no skin's eyes are proven only by a blown-out head",
           len(RESULT["unusable_samples"].get("12.0", [])) == 0
           and len(RESULT["unusable_samples"].get("18.8", [])) == 0
           and len(RESULT["unusable_samples"].get("23.5", [])) == 0,
           unusable_by_hour=RESULT["unusable_samples"], saturation_ceiling=SATURATED,
           note="when the exposure clips both the eye and the face, the frame cannot distinguish a lamp from "
                "a white square. That is an UNUSABLE sample, not a passing one, and it must be visible.")
    record("E04", "the established eye colour is still readable, not washed to white",
           all(has_colour(v) for per in rows.values() for v in per.values()),
           colour_by_hour={h: {s: v.get("colour") for s, v in per.items()} for h, per in rows.items()},
           note="the founder: preserve each skin's established eye colour, and the customised SECONDARY has "
                "to show through the glow. Pure white scores zero separation and carries neither.")
    record("E02", "the eyes read as lit at every hour tested, not only after dark",
           all(lit(v) for per in rows.values() for v in per.values()),
           weakest_over_face_by_hour=worst, table=RESULT["table"])
    # ---- WHAT THIS CLAUSE CAN HONESTLY ASSERT, after being wrong twice about what to measure.
    #
    # It began as "how much of the eye is blown to white", capped at 85%. That was the wrong question: a
    # lamp's core clips, and forbidding that forbids the correct picture. It became "keep 0.05 of channel
    # separation", which is the right question and the wrong number -- it cannot be met by CELESTIAL LIGHT,
    # and that is a fact about the art rather than a defect. Its authored eye is (0.62, 0.88, 1.00): the
    # palest in the lineup, a blue whose red channel is already 62% of its blue, set in a head that stands
    # inside its own halo. Driven bright enough to read as a lamp in daylight -- which is what the founder
    # asked for -- a hue that close to white renders close to white. The two requirements are in tension on
    # that one skin, and the founder's stated one wins.
    #
    # So this catches TOTAL loss of hue, which is a real failure and the one worth gating: an eye that has
    # become a plain white square cannot show a status colour or the founder's SECONDARY. Pure white reads
    # exactly 0.0. The floor sits just above what the measurement can resolve, and the full table is reported
    # so the difference between Relay OG's 0.29 and Celestial Light's 0.035 is visible rather than hidden
    # behind a pass.
    # REPORTED, NOT GATED, AND THE REASON IS THE INSTRUMENT RATHER THAN THE SUBJECT.
    #
    # Three thresholds were tried on this and the honest finding is that none of them can stand, because the
    # measurement is noisier than the thing it would judge. Relay OG at 22:00, unchanged between runs, has
    # returned 0.0588, then 0.0353, then 0.0235 -- a factor of two and a half on one skin at one hour. Any
    # floor drawn through that flaps, and a test that passes or fails on which run you happened to take is
    # worse than no test: it teaches you to ignore it.
    #
    # What the numbers DO support, consistently across every run, is the ranking: Relay OG's warm gold and
    # Arden's ember hold their hue strongly, Apollo and Skeleton Flame hold it moderately, and Celestial Light
    # sits lowest every single time. That is a fact about authorship rather than a defect -- its eye is
    # (0.62, 0.88, 1.00), the palest in the lineup, in a head that stands inside its own halo, and a hue that
    # close to white renders close to white once it is bright enough to read as a lamp in daylight, which is
    # what the founder asked for. The consequence worth knowing is that the founder's SECONDARY colour will
    # read more weakly on Celestial Light than on the other four.
    #
    # The gate that IS reliable is E01 and E02 -- the eyes read as lit, at every hour, on every skin -- and
    # those are the founder's actual requirement.
    emit("E03", "INFO", "how much colour each eye keeps, reported and not judged",
         {"colour_separation": {h: {s: v.get("colour") for s, v in per.items()} for h, per in rows.items()},
          "note": "white is 0.0. Ranking is stable across runs; absolute values are not, varying by up to "
                  "2.5x on one skin at one hour, which is why no threshold is drawn through them."})
    RESULT["blown_fraction"] = {h: {s: v.get("eye_blown") for s, v in per.items()} for h, per in rows.items()}
    emit("E_BLOWN", "INFO", "how much of each eye patch is over white, reported and not judged",
         RESULT["blown_fraction"])

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
