# WHAT THE NIGHT ACTUALLY DOES AFTER THE NIGHT RIG IS FULLY ON.
#
# zzT2 mapped 17:30 to 19:30 and found the evening hole at 18:00, where Daylight has fallen to 0.1999 and
# Nightfall is still exactly 0.0 -- no moon, no shadow lift, no local exposure, and every practical light in
# the world at zero intensity because their brightness is Candelas * GetNightAmount() * Gain. That is
# proven and it is not what this job is about.
#
# THIS JOB EXISTS BECAUSE I TOOK THE EDGE OF MY WINDOW FOR THE SHAPE OF THE THING. zzT2 ended at 19:30
# reading 0.1760 with ground at 0.1832, and I called that full night because it was where I stopped. The
# other lane then measured the ground under the mascot at 23:36 at 0.045 -- four times darker -- with
# Nightfall pinned at 1.0 for the whole intervening four hours. So the night keeps falling long after the
# curve I blamed has maxed out, and the shape between 19:30 and midnight has never been looked at once.
#
# THE HYPOTHESIS, to be measured rather than argued. Sun intensity below the horizon is pinned at
# SunFloor = 0.0012 of noon and does not fall. But the light's PITCH is -Elevation, so between -27 deg at
# 19:30 and -71 deg at 23:36 the sun swings from grazing the world to pointing almost straight up through
# it, and the ground occludes progressively more of what it casts. Constant intensity, falling
# contribution. If that is right the decline should track elevation smoothly and flatten once the sun is
# steep enough to be fully occluded. If the decline instead has a step in it, something else is switching
# and the hypothesis is wrong.
#
# IT JOINS zzT2 AT 19:30 AND THE JOIN IS A GATE. Same camera, same patch, same settle. If the two runs
# disagree at the hour they share by more than the noise, the two tables cannot be read against each other
# and the concatenation is void -- which would also mean zzT2's own numbers do not reproduce across a PIE
# session, and that is worth knowing on its own.
#
# Saves nothing. Restores hour. Holds exposure, span and the other lane's eye levels.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "night_shape")

#: 19:30 is zzT2's last rung and this job's first, deliberately. Then half-hours to midnight.
HOURS = tuple(19.5 + 0.5 * i for i in range(10))
#: What zzT2 measured at the shared hour, for the join gate. Not a target -- a cross-run calibration.
ZZT2_AT_1930 = 0.1760
ZZT2_GROUND_AT_1930 = 0.1832
SPAN = 21.0
EYE = (-320.0, -1900.0, 200.0)
AT = (0.0, -1460.0, 90.0)
AGREE = 0.010


def elevation_at(hour):
    return math.sin(((hour - 6.0) / 12.0) * math.pi) * 72.0


def daylight_at(elev, span):
    return max(0.0, min(1.0, (elev + 9.0) / max(span, 1.0))) ** 1.9


def nightfall_at(elev):
    s = max(0.0, min(1.0, (-elev - 2.0) / 10.0))
    return s * s * (3.0 - 2.0 * s)


def patch(cx, cy, hw, hh):
    got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
    if got is None:
        return None
    mean, dark, bright, sampled = got
    return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4),
            "dark": round(dark, 4), "bright": round(bright, 4),
            "tails": round(min(1.0, dark + bright), 4)}


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests
    os.makedirs(ROOT, exist_ok=True)

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

    def live():
        return ues.get_game_world()

    def cvar(name, value):
        unreal.SystemLibrary.execute_console_command(live(), "%s %s" % (name, value))

    L.focus_game_viewport()
    cvar("wl.Sky.DayMinutes", 0)
    cvar("wl.Sky.TwilightSpan", "%.1f" % SPAN)
    L.pose_camera(live(), unreal.Vector(*EYE), unreal.Vector(*AT), 60.0)
    yield 3.0

    RESULT["camera_eye"] = list(EYE)
    RESULT["camera_at"] = list(AT)
    RESULT["span"] = SPAN
    RESULT["joins"] = {"job": "zzT2_dusk_hole", "hour": 19.5,
                       "its_luma": ZZT2_AT_1930, "its_ground": ZZT2_GROUND_AT_1930}

    def settled():
        """Three consecutive reads in agreement; any movement, up or down, restarts the count."""
        # THE WINDOW'S SPREAD, NOT ITS STEPS. This asked whether three consecutive STEPS were each inside
        # the tolerance, and steps compound: three steps of 0.0039 walk the window 0.0117 downhill while
        # every pair passes, which is wider than the 0.010 these jobs call agreement. The other lane
        # demonstrated it on [200, 60, 66, 61, 50, 49, 48.5], where a step test returns on the 60 with a
        # fifth of the fall still to come -- the pair test's hole, one read wider, on exactly the
        # oscillating case the three-read version was written to catch.
        #
        # Max minus min across the last three reads asks the question actually being asked -- are these
        # three the same reading -- and carries no assumption about direction, rate or shape. That is what
        # killed the previous four versions: each fixed the last one's form and kept its assumption.
        window = []
        for _ in range(24):
            yield 1.0
            now = patch(0.5, 0.5, 0.46, 0.44)
            if now is None:
                continue
            window.append(now["luma"])
            if len(window) > 3:
                window.pop(0)
            if len(window) == 3 and (max(window) - min(window)) < 0.004:
                return
        # Fell through without settling. Said by NOT trimming anything: the rung's own two-read spread then
        # reports the damage and the noise gate voids the run, rather than a tidy number from the tail.

    rows = []
    RESULT["night"] = rows
    for hour in HOURS:
        cvar("wl.Sky.Hour", "%.2f" % hour)
        for step in settled():
            yield step
        a = patch(0.5, 0.5, 0.46, 0.44)
        g1 = patch(0.5, 0.78, 0.30, 0.16)
        yield 1.0
        b = patch(0.5, 0.5, 0.46, 0.44)
        g2 = patch(0.5, 0.78, 0.30, 0.16)
        try:
            H.capture_viewport_jpeg(os.path.join(ROOT, "h%05.2f.jpg" % hour), 1200, 85)
        except Exception:                                              # noqa: BLE001
            pass
        if a is None or b is None:
            rows.append({"hour": hour, "unmeasured": True})
            continue
        elev = elevation_at(hour)
        rows.append({
            "hour": hour,
            "luma": round((a["luma"] + b["luma"]) / 2.0, 4),
            "spread": round(abs(a["luma"] - b["luma"]), 4),
            "tails": round((a["tails"] + b["tails"]) / 2.0, 4),
            "ground_luma": round(((g1 or {}).get("luma", 0.0) + (g2 or {}).get("luma", 0.0)) / 2.0, 4)
            if g1 and g2 else None,
            "sun_elevation": round(elev, 2),
            "daylight": round(daylight_at(elev, SPAN), 4),
            "nightfall": round(nightfall_at(elev), 4)})

    cvar("wl.Sky.Hour", 12)
    L.release_camera(live())

    good = [r for r in rows if not r.get("unmeasured")]

    # ---- THE INSTRUMENT FIRST.
    worst_spread = max((r["spread"] for r in good), default=None)
    record("S_NOISE", "each rung agrees with itself -- two reads of the same hour",
           worst_spread is not None and worst_spread <= AGREE and len(good) == len(HOURS),
           worst_spread=worst_spread, tolerance=AGREE, measured=len(good), wanted=len(HOURS),
           note="red here voids everything below")
    if not good or len(good) != len(HOURS) or (worst_spread or 1.0) > AGREE:
        RESULT["status"] = "voided: the rungs do not agree with themselves"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    # ---- THE JOIN. If this run and zzT2 disagree at the hour they share, the two tables cannot be read
    # against each other -- and zzT2's numbers would not reproduce across a PIE session, which is worse.
    first = good[0]
    join_gap = round(abs(first["luma"] - ZZT2_AT_1930), 4)
    record("S_JOIN", "19:30 reads the same in this run as it did in zzT2, so the two tables concatenate",
           join_gap <= AGREE,
           this_run=first["luma"], zzT2=ZZT2_AT_1930, gap=join_gap, tolerance=AGREE,
           this_run_ground=first.get("ground_luma"), zzT2_ground=ZZT2_GROUND_AT_1930,
           note="the same camera, patch and settle in a different PIE session. A gap here means either the "
                "world does not reproduce between sessions or one of the two runs is not what it claims")

    # ---- DOES THE NIGHT KEEP FALLING after Nightfall is pinned at 1.0? The other lane measured ground at
    # 0.045 at 23:36 where this job's own 19:30 reads 0.1832, so it should -- and the fall is then driven by
    # something other than the curve that is already at its maximum.
    pinned = [r for r in good if r["nightfall"] >= 0.999]
    fall = (round(pinned[0]["luma"] - pinned[-1]["luma"], 4) if len(pinned) > 1 else None)
    record("S_FALL", "the night keeps darkening after the night rig is fully on",
           fall is not None and fall > AGREE,
           first_pinned_hour=pinned[0]["hour"] if pinned else None,
           last_pinned_hour=pinned[-1]["hour"] if pinned else None,
           luma_fall_across_pinned_night=fall, rungs_at_nightfall_1=len(pinned),
           note="INFORMATIONAL DIRECTION, not a pass/fail of the world: this being green confirms that "
                "Nightfall is not what drives the late night, so a fix to Nightfall cannot address it")

    # ---- IS THE DECLINE SMOOTH? The hypothesis is a geometric occlusion that grows with the sun's pitch,
    # which has no steps in it. A STEP means something is switching instead, and the hypothesis is wrong.
    steps = []
    for i in range(1, len(good)):
        steps.append({"from": good[i - 1]["hour"], "to": good[i]["hour"],
                      "d_luma": round(good[i]["luma"] - good[i - 1]["luma"], 4)})
    worst_step = max((abs(s["d_luma"]) for s in steps), default=None)
    typical = sorted(abs(s["d_luma"]) for s in steps)
    median_step = typical[len(typical) // 2] if typical else None
    record("S_SMOOTH", "the decline has no step in it -- consistent with occlusion, not with a switch",
           worst_step is not None and median_step is not None
           and worst_step <= max(3.0 * median_step, AGREE * 2.0),
           worst_step=worst_step, median_step=median_step, steps=steps,
           note="a pitch-driven occlusion grows smoothly. A single step much larger than the others means "
                "something turns on or off at that hour and the occlusion story is wrong")

    # ---- AND THE FOUNDER'S SENTENCE, across the whole night.
    with_ground = [r for r in good if r.get("ground_luma") is not None]
    darkest = min(with_ground, key=lambda r: r["ground_luma"]) if with_ground else None
    record("S_GROUND", "the ground stays readable across the whole night",
           darkest is not None and darkest["ground_luma"] >= 0.030,
           darkest_hour=(darkest or {}).get("hour"),
           darkest_ground=(darkest or {}).get("ground_luma"), floor=0.030,
           ground_by_hour={("%.2f" % r["hour"]): r.get("ground_luma") for r in good},
           note="the same floor zzT2 used, so the evening and the night are judged on one scale")

    RESULT["darkest"] = ({"hour": darkest["hour"], "ground": darkest["ground_luma"],
                          "luma": darkest["luma"], "elevation": darkest["sun_elevation"]}
                         if darkest else None)
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
