# HOW MUCH GLOW SHOULD A MASCOT KEEP AFTER DARK?
#
# THE BUG, PHOTOGRAPHED: at 04:00 the Relay Dog renders as a featureless white starburst with the eyes just
# visible inside it. Exposure is a camera property, so the +1.45 EV that makes the dark world readable also
# multiplies emissive pixels by 2.7 -- and an emissive surface, unlike a lit one, never got darker when the
# sun went down. Every glow in the world therefore clips at night: the Dog, Celestial Light's starlight,
# Arden's fire and the Skeleton's ghostfire alike.
#
# THE CORRECTION is wl.Look.NightGlow, which scales the glowing channels down as Nightfall rises. The right
# value is a judgement about how a lantern should look, so it is swept and photographed rather than argued.
#
# WHAT IS MEASURED, AND HOW THE FIRST VERSION OF THIS JOB GOT IT WRONG. Mean luma cannot tell a blown-out
# figure from a well-lit one; what separates them is that the blown one has no detail left, because the middle
# of it is at 1.0. ReadScreenRect returns exactly that as its third out-param -- the fraction of the rectangle
# that is nearly white -- and the first version of this job read out-param [1] instead and called it
# "brightest". [1] is the DARK fraction, and [1] of ReadScreenExtremes is most-blue-over-red, a hue
# difference. Both came back near zero on a frame that was plainly bright, which is the only reason the
# mistake was caught: the numbers disagreed with the capture, so the capture won.
#
# AND THE RECTANGLE IS PROJECTED, NOT GUESSED. A fixed rect in the middle of the screen sampled a courtyard
# wall and a companion standing beside the Dog. The figure's own box comes from projecting its feet and the
# top of its head, the same discipline the night proof's N01 enforces.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "night_glow")
HOUR = 4.0
VALUES = (1.0, 0.55, 0.32, 0.20)
SKINS = ("relay_og", "celestial_light", "arden_infernal", "skeleton_flame")


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
    yield 8.0

    ui = L.get_ui(world)
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)

    def frame_the_dog():
        """Stand well off in front of the Dog so the whole figure and some ground fit in the frame."""
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * 760.0,
                            here.y + math.sin(math.radians(yaw)) * 760.0, here.z + 150.0)
        L.pose_camera(world, eye, unreal.Vector(here.x, here.y, here.z + 90.0), 45.0)

    def figure_rect():
        """The Dog's own box on screen, projected from its feet and the top of its head."""
        size = pc.get_viewport_size()
        if not size or size[0] <= 0:
            return None
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw
        low = unreal.GameplayStatics.project_world_to_screen(pc, unreal.Vector(here.x, here.y, here.z - 10.0), False)
        high = unreal.GameplayStatics.project_world_to_screen(pc, unreal.Vector(here.x, here.y, here.z + 200.0), False)
        if low is None or high is None:
            return None
        cx = (low.x + high.x) * 0.5 / float(size[0])
        y0 = min(low.y, high.y) / float(size[1])
        y1 = max(low.y, high.y) / float(size[1])
        # THE FIGURE'S OWN WIDTH, projected, not a fraction of its height. Guessing 0.34 of the vertical span
        # put the left companion AND the right bunny inside the Dog's rectangle, so "the figure is 87% blown"
        # was really "three glowing figures and a wall are 87% blown". The sideways offset is perpendicular to
        # the view in the ground plane, which is the screen's horizontal.
        wide = dog.get_actor_bounds(False)
        span = max(float(wide[1].x), float(wide[1].y)) if wide else 60.0
        side = unreal.GameplayStatics.project_world_to_screen(
            pc, unreal.Vector(here.x + math.sin(math.radians(yaw)) * span,
                              here.y - math.cos(math.radians(yaw)) * span, here.z + 90.0), False)
        mid = unreal.GameplayStatics.project_world_to_screen(
            pc, unreal.Vector(here.x, here.y, here.z + 90.0), False)
        half = 0.22 * (y1 - y0)
        if side is not None and mid is not None:
            half = abs(side.x - mid.x) / float(size[0]) * 1.35   # a little air for the halo
        box = (max(cx - half, 0.0), max(y0, 0.0), min(cx + half, 1.0), min(y1, 1.0))
        if box[2] - box[0] < 0.02 or box[3] - box[1] < 0.05:
            return None
        return box

    readings = {}
    RESULT["by_skin"] = readings
    RESULT["figure_rects"] = {}

    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 6.0
        frame_the_dog()
        yield 2.5
        box = figure_rect()
        RESULT["figure_rects"][skin] = None if box is None else [round(v, 3) for v in box]
        if box is None:
            emit("G_%s" % skin, "INFO", "%s: the Dog did not project into the frame" % skin, {})
            continue
        per = {}
        readings[skin] = per
        for keep in VALUES:
            unreal.SystemLibrary.execute_console_command(world, "wl.Look.NightGlow %.3f" % keep)
            # The push runs on the day cycle's half-second cadence, so a moment is needed for it to land.
            yield 2.0
            fig = L.read_screen_rect(box[0], box[1], box[2], box[3])
            gnd = L.read_screen_rect(0.62, 0.80, 0.92, 0.96)
            row = {}
            if fig is not None:
                row["figure_luma"] = luma(fig[0])
                row["figure_blown"] = round(float(fig[2]), 4)
                row["figure_dark"] = round(float(fig[1]), 4)
            if gnd is not None:
                row["ground_luma"] = luma(gnd[0])
            if "figure_luma" in row and "ground_luma" in row:
                row["over_ground"] = round(row["figure_luma"] - row["ground_luma"], 4)
            per["%.2f" % keep] = row
            try:
                L.capture_game_viewport(os.path.join(ROOT, "%s_keep_%.2f.png" % (skin, keep)))
            except Exception:
                pass
        emit("G_%s" % skin, "INFO", skin, per)

    unreal.SystemLibrary.execute_console_command(world, "wl.Look.NightGlow 0.20")
    L.release_camera(world)

    wanted = len(SKINS) * len(VALUES)
    got = [v for s in readings.values() for v in s.values() if "figure_luma" in v]
    record("G00", "the Dog was found in frame and read at every setting for every skin",
           len(got) == wanted, read=len(got), wanted=wanted, rects=RESULT["figure_rects"],
           note="a missing rect means the figure did not project into the frame; all-None readings mean the "
                "editor window was behind another one")
    if len(got) != wanted:
        RESULT["status"] = "FAIL: not every setting was read"
        return

    # ---- DOES THE KNOB REACH EVERY SKIN? The control: 1.00 is "no correction" and must be the brightest.
    moved = {}
    for skin, per in readings.items():
        moved[skin] = round(per["1.00"]["figure_luma"] - per["0.18"]["figure_luma"], 4)
    RESULT["figure_dimmed_from_1_00_to_0_18"] = moved
    record("G01", "the night glow control actually reaches every skin",
           all(v > 0.02 for v in moved.values()), dimmed=moved, floor=0.02,
           note="a skin that does not move is not going through ApplyColourway and the correction misses it")

    blown = {s: {k: v["figure_blown"] for k, v in per.items()} for s, per in readings.items()}
    RESULT["blown_fraction_by_setting"] = blown
    emit("G_BLOWN", "INFO", "how much of the figure is clipped to white", blown)

    shipped = {s: per["0.20"] for s, per in readings.items()}
    RESULT["at_shipped_0_20"] = shipped
    record("G02", "at the shipped setting every skin is still plainly brighter than the ground it stands on",
           all(v["over_ground"] > 0.03 for v in shipped.values()),
           at_0_20=shipped, floor=0.03,
           note="the founder asked for the flames and Celestial Light to be kept, not removed; a mascot that "
                "no longer out-reads the ground after dark has been turned off rather than corrected")
    record("G03", "at the shipped setting no skin is mostly clipped to white",
           all(v["figure_blown"] <= 0.18 for v in shipped.values()),
           blown_at_0_20={s: v["figure_blown"] for s, v in shipped.items()}, ceiling=0.18,
           note="a figure with a fifth of itself at 1.0 has lost its detail there, which is what the 04:00 "
                "capture showed: a white starburst with two eyes in it")
    record("G04", "the correction is an improvement on doing nothing",
           all(readings[s]["0.20"]["figure_blown"] < readings[s]["1.00"]["figure_blown"] - 0.01
               or readings[s]["1.00"]["figure_blown"] <= 0.02 for s in readings),
           uncorrected={s: per["1.00"]["figure_blown"] for s, per in readings.items()},
           corrected={s: per["0.20"]["figure_blown"] for s, per in readings.items()},
           note="a skin that was never blown out at 1.00 is excused; one that was must be better at 0.32 or "
                "the correction is not doing the job it was written for")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
