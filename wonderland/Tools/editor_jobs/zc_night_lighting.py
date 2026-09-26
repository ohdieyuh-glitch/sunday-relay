# WHAT SHOULD LIGHT THE NIGHT, NOW THAT THE MASCOTS HAVE STOPPED DOING IT BY ACCIDENT?
#
# THE TWO GATES ARE A WINDOW, NOT A TARGET, and the night has to land inside it:
#   N10  night must be at most 0.38 of the brightest hour, or it is not night
#   N02  at most 0.72 of the frame may sit below luma 0.14, or it is not a night, it is an unlit scene
#
# Correcting the emissive blow-out moved the night from 0.207 luma to 0.120 in one step: N10 went from FAIL
# at 0.47 to PASS at 0.26, and N02 went from PASS to FAIL at 0.81 crushed. The brightness that left was the
# Dog and its companions spilling Lumen onto the plaza -- a light source that followed the player around and
# changed when they changed skin. It should not come back. The same brightness has to arrive from the moon,
# the fills and the sky instead.
#
# SWEPT IN ONE SESSION, because five attempts on this number have now been argued and every one of them was
# wrong: the shadow gate, the sub-horizon sun fill, the checkpoint lamps, the checkpoint glow, and the
# assumption that the reading meant what it said. The only two things that ever moved it were a photograph
# and an A/B inside a single PIE run. So all three knobs are console variables now and this walks them.
CONCURRENT = True

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "night_lighting")
HOUR = 4.0
DAY_HOUR = 9.5                      # the brightest hour, as the night proof measures it

# moon gain, night fill floor, night sky gain
RUNGS = (
    ("as it stands", 0.020, 0.15, 5.5),
    ("moon x1.8",    0.036, 0.15, 5.5),
    ("moon x1.8 + fill", 0.036, 0.26, 5.5),
    ("moon x2.6 + fill", 0.052, 0.26, 5.5),
    ("moon x2.6 + fill + sky", 0.052, 0.26, 8.0),
    ("moon x3.6 + fill + sky", 0.072, 0.34, 8.0),
)


def luma(c):
    return round(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, 5)


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

    def cmd(line):
        unreal.SystemLibrary.execute_console_command(world, line)

    cmd("wl.Sky.DayMinutes 0")
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)

    def look_at_the_world():
        """The night proof's own framing: behind the Dog, looking past it down the plaza."""
        import math
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw
        eye = unreal.Vector(here.x - math.cos(math.radians(yaw)) * 620.0,
                            here.y - math.sin(math.radians(yaw)) * 620.0, here.z + 260.0)
        L.pose_camera(world, eye, unreal.Vector(here.x + math.cos(math.radians(yaw)) * 900.0,
                                                here.y + math.sin(math.radians(yaw)) * 900.0,
                                                here.z + 60.0), 75.0)

    # ---- THE DAY IS MEASURED ONCE. It is the denominator of N10 and none of these knobs touch it -- the
    # ---- moon is off, the fill floor is under the daylight value and the sky gain lerps to 1 at noon. It is
    # ---- read anyway rather than taken from the other proof's run, so the ratio below is same-session.
    cmd("wl.Sky.Hour %.2f" % DAY_HOUR)
    yield 7.0
    look_at_the_world()
    yield 3.0
    day = L.read_screen_rect(0.04, 0.06, 0.96, 0.94)
    RESULT["day_luma"] = None if day is None else luma(day[0])
    try:
        L.capture_game_viewport(os.path.join(ROOT, "day_%.1f.png" % DAY_HOUR))
    except Exception:
        pass
    emit("L_DAY", "INFO", "the brightest hour", {"hour": DAY_HOUR, "luma": RESULT["day_luma"]})

    cmd("wl.Sky.Hour %.2f" % HOUR)
    yield 7.0
    look_at_the_world()
    yield 3.0

    rows = []
    RESULT["rungs"] = rows
    for index, (label, moon, fill, sky) in enumerate(RUNGS):
        cmd("wl.Sky.MoonGain %.4f" % moon)
        cmd("wl.Sky.NightFill %.3f" % fill)
        cmd("wl.Sky.NightSky %.2f" % sky)
        # The repaint runs on the day cycle's half-second cadence while the clock is frozen, and the sky light
        # recaptures on the same beat; three seconds is several of both.
        yield 3.5
        got = L.read_screen_rect(0.04, 0.06, 0.96, 0.94)
        row = {"label": label, "moon": moon, "fill": fill, "sky": sky}
        if got is not None:
            row["night_luma"] = luma(got[0])
            row["crushed"] = round(float(got[1]), 4)
            if RESULT["day_luma"]:
                row["ratio"] = round(row["night_luma"] / RESULT["day_luma"], 4)
                row["inside_both_gates"] = bool(row["ratio"] <= 0.38 and row["crushed"] <= 0.72)
        rows.append(row)
        try:
            L.capture_game_viewport(os.path.join(ROOT, "%02d_%s.png" % (index, label.replace(" ", "_"))))
        except Exception:
            pass
        emit("L_%02d" % index, "INFO", label, row)

    L.release_camera(world)
    cmd("wl.Sky.MoonGain 0.020")
    cmd("wl.Sky.NightFill 0.15")
    cmd("wl.Sky.NightSky 5.5")

    read = [r for r in rows if "night_luma" in r]
    record("L00", "every rung was photographed and read", len(read) == len(RUNGS),
           read=len(read), wanted=len(RUNGS), day_luma=RESULT["day_luma"],
           note="all None means the editor window was behind another one")
    if len(read) != len(RUNGS) or not RESULT["day_luma"]:
        RESULT["status"] = "FAIL: the sweep was not measured"
        return

    record("L01", "the sky knobs actually reach the night",
           read[-1]["night_luma"] > read[0]["night_luma"] + 0.01,
           darkest=read[0], brightest=read[-1],
           note="if the last rung does not out-read the first, the console variables are not being applied "
                "and every row below is the same picture measured six times")

    inside = [r for r in read if r.get("inside_both_gates")]
    RESULT["rungs_inside_both_gates"] = [r["label"] for r in inside]
    record("L02", "there is a setting where the night is both unmistakably night and actually lit",
           len(inside) > 0, inside=[{k: r[k] for k in ("label", "night_luma", "crushed", "ratio")}
                                    for r in inside],
           all_rungs=[{k: r.get(k) for k in ("label", "night_luma", "crushed", "ratio")} for r in read],
           gates={"ratio_ceiling": 0.38, "crushed_ceiling": 0.72},
           note="N10 and N02 are a window, not a target: too bright is a dim afternoon, too dark is an unlit "
                "scene. This says whether the window is reachable with the moon and fills alone, now that "
                "the mascots are no longer lighting the plaza.")

    if inside:
        # The most comfortable rung inside the window: furthest from BOTH ceilings at once.
        best = max(inside, key=lambda r: min(0.38 - r["ratio"], (0.72 - r["crushed"]) * 0.53))
        RESULT["recommended"] = best
        emit("L_BEST", "INFO", "the rung with the most room on both sides", best)

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
