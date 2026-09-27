# EIGHTEEN HUNDRED IS DARKER THAN MIDNIGHT, AND THE TWILIGHT BAND IS NOT WHY.
#
# The twilight ladder (zzT1) swept TwilightSpan at 21/30/39 expecting a wider band to make the evening
# arrive gradually. It does the opposite -- worst hour-to-hour step 0.0995 -> 0.1353 -> 0.1812 -- and the
# rows say why. At EVERY span the evening is not monotone:
#
#     span 21   12:00 0.2685   16:00 0.1434   17:00 0.1360   18:00 0.0365   19:00 0.0937
#     span 39   12:00 0.2679   16:00 0.1484   17:00 0.2139   18:00 0.0327   19:00 0.0938
#
# 18:00 reads about a THIRD of 19:00 in every span. Ground at 18:00 is 0.0091-0.0126 -- black -- and
# recovers to 0.0689 an hour later, with 97 per cent of pixels in the tails. The world is darker at six in
# the evening than it is at full night, and widening the band only raises the shoulder it falls from.
#
# THE MECHANISM, read off the source rather than guessed. Two curves drive the look and they are computed
# from the elevation by DIFFERENT formulas that do not meet:
#
#     Daylight  = clamp((Elevation + 9) / SPAN)^1.9       -> sun, the three fills, sky, fog, water, AND the
#                                                            AutoExposureBias lerp. Reaches zero at -9 deg.
#     Nightfall = smoothstep(clamp((-Elevation - 2)/10))  -> moon, NightShadowLift, local exposure, glow,
#                                                            rim. Starts at -2 deg, full at -12 deg.
#
# At 18:00 the elevation is EXACTLY ZERO. Daylight has already fallen to 0.1999 -- a fifth of noon -- while
# Nightfall is still exactly 0.0, so the moon is invisible (it needs Nightfall > 0.002), the 0.62 shadow
# lift is not applied (it is lerped by Nightfall), local exposure is off (it needs Nightfall > 0.001) and
# the exposure bias is only +0.98 of its eventual +1.45. The day rig has gone and the night rig has not
# arrived. That gap is the founder's "entire regions collapsing into near-black", and it sits at the hour a
# player would actually call evening.
#
# THIS JOB PROVES THE HOLE BEFORE ANYTHING IS CHANGED, and it tests the MECHANISM rather than only the
# phenomenon. Nine rungs at quarter-hours from 17:30 to 19:30 walk the elevation from +9.3 deg down to
# -27.8, straight through the gap. If the explanation is right the minimum must land where Daylight and
# Nightfall are BOTH small -- elevation between 0 and -9 -- and the picture must recover once Nightfall
# reaches 1. If the minimum lands somewhere else the explanation is wrong and no curve gets changed.
#
# Saves nothing. Restores hour. Holds exposure and the other lane's eye levels.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "dusk_hole")

#: Quarter-hours straight through the crossover. 17:30 is still afternoon, 19:30 is committed night.
HOURS = tuple(17.5 + 0.25 * i for i in range(9))
#: The shipped band. This job is not sweeping it -- zzT1 already showed widening makes the step worse.
SPAN = 21.0
#: The same pose zzT1 used, so these readings sit on the same scale as that table.
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

    # One pose for every rung, so the practical-light pool is the same set throughout and a dip here cannot
    # be a pool difference. Recorded rather than assumed.
    RESULT["camera_eye"] = list(EYE)
    RESULT["camera_at"] = list(AT)
    RESULT["span"] = SPAN

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
    RESULT["dusk"] = rows
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

    # ---- THE INSTRUMENT FIRST. A dip smaller than the noise is not a dip.
    worst_spread = max((r["spread"] for r in good), default=None)
    record("D_NOISE", "each rung agrees with itself -- two reads of the same hour",
           worst_spread is not None and worst_spread <= AGREE and len(good) == len(HOURS),
           worst_spread=worst_spread, tolerance=AGREE, measured=len(good), wanted=len(HOURS),
           note="red here voids everything below, because every gate under it compares rungs to each other")
    if not good or len(good) != len(HOURS) or (worst_spread or 1.0) > AGREE:
        RESULT["status"] = "voided: the rungs do not agree with themselves"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    # ---- DOES THE HOLE EXIST? An INTERIOR minimum strictly darker than both ends is a dip, not a sunset.
    lo = min(good, key=lambda r: r["luma"])
    interior = good[0] is not lo and good[-1] is not lo
    margin = round(min(good[0]["luma"], good[-1]["luma"]) - lo["luma"], 4)
    record("D_HOLE", "the evening dips BELOW full night and climbs back out, rather than simply falling",
           interior and margin > AGREE,
           bottom_hour=lo["hour"], bottom_luma=lo["luma"], bottom_ground=lo.get("ground_luma"),
           first_hour_luma=good[0]["luma"], last_hour_luma=good[-1]["luma"],
           margin_below_both_ends=margin, is_interior=interior,
           note="a monotone fall into night is correct behaviour and needs no fix. A dip means the world "
                "goes darker than night and then comes back, which is a defect at one hour")

    # ---- AND IS IT WHERE THE EXPLANATION SAYS? The gap between the two curves lives between elevation 0
    # and -9: Daylight is already small there and Nightfall has barely started. If the bottom is outside
    # that window the mechanism is wrong, whatever the dip looks like, and no curve gets changed on it.
    in_window = -10.0 <= lo["sun_elevation"] <= 1.0
    record("D_PREDICT", "the bottom sits in the gap between the two curves, where the explanation puts it",
           in_window,
           bottom_elevation=lo["sun_elevation"], predicted_window="elevation +1 to -10 deg",
           daylight_at_bottom=lo["daylight"], nightfall_at_bottom=lo["nightfall"],
           note="Daylight reaches zero at -9 deg and Nightfall does not start until -2. A minimum anywhere "
                "else means the crossover gap is not the cause")

    # ---- HOW BAD, in the founder's own terms: can the ground be read?
    with_ground = [r for r in good if r.get("ground_luma") is not None]
    darkest = min(with_ground, key=lambda r: r["ground_luma"]) if with_ground else None
    record("D_GROUND", "the ground stays readable through the whole crossover",
           darkest is not None and darkest["ground_luma"] >= 0.030,
           darkest_ground_hour=(darkest or {}).get("hour"),
           darkest_ground_luma=(darkest or {}).get("ground_luma"), floor=0.030,
           ground_by_hour={("%.2f" % r["hour"]): r.get("ground_luma") for r in good},
           note="the founder's complaint is that the ground is unreadable and paths disappear. This "
                "measures that sentence rather than the whole frame")

    RESULT["bottom"] = {"hour": lo["hour"], "luma": lo["luma"], "elevation": lo["sun_elevation"],
                        "daylight": lo["daylight"], "nightfall": lo["nightfall"]}
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
