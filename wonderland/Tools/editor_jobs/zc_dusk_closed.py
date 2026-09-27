# DID THE HOLE ACTUALLY CLOSE? The same rungs, the same camera, against the numbers zzT2 recorded.
#
# d21c2213 made Nightfall the complement of the twilight band, so the night rig can no longer arrive after
# the day rig has left. That is one line of arithmetic and a long argument, and neither is evidence. zzT2
# measured the hole; this measures the same nine hours the same way and compares rung by rung.
#
# WHAT zzT2 RECORDED, at EYE (-320,-1900,200) looking at (0,-1460,90), span 21:
#
#     17.50  0.0955  ground 0.0702      18.50  0.0712  ground 0.0444      19.25  0.1408  ground 0.1619
#     17.75  0.0835  ground 0.0587      18.75  0.1102  ground 0.0817      19.50  0.1760  ground 0.1832
#     18.00  0.0365  ground 0.0126      19.00  0.0935  ground 0.0686
#     18.25  0.0430  ground 0.0155
#
# and zzT1 recorded noon at 0.2685 with ground 0.2828 at the same pose.
#
# FOUR THINGS HAVE TO BE TRUE AND EACH IS A SEPARATE GATE.
#
#   C_CURVE   the build actually carries the new curve. A build that predates it would reproduce zzT2
#             almost exactly and C_CLOSED would then fail for the right-looking wrong reason -- so the
#             curve is read back from the engine FIRST, and if it cannot be read the run is marked
#             evidence-only rather than allowed to pass as proof.
#   C_DAY     noon is unchanged. I claimed full day is untouched because the band saturates at +12 deg.
#             That is arithmetic, it is exactly the kind that has been wrong all day, and zzT1 left a noon
#             reading at this pose to check it against.
#   C_CLOSED  there is no interior minimum any more -- the evening falls into night instead of dipping
#             below it and climbing back out. This is the defect, stated as the shape rather than a level.
#   C_GROUND  the ground clears the same 0.030 floor zzT2's D_GROUND failed at 0.0126.
#
# AND C_NOREG catches the thing a fix like this could plausibly break: no rung may come back DARKER than
# zzT2 measured it. Lifting the trough at the cost of the hours either side would be a trade nobody asked
# for, and comparing only the bottom would hide it.
#
# Saves nothing. Restores hour. Holds exposure, span and the other lane's eye levels.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "dusk_closed")

#: zzT2's rungs exactly, plus noon as the day-untouched control.
HOURS = (12.0, 17.5, 17.75, 18.0, 18.25, 18.5, 18.75, 19.0, 19.25, 19.5)
#: What zzT2 and zzT1 measured at this pose. hour -> (luma, ground)
BEFORE = {12.00: (0.2685, 0.2828), 17.50: (0.0955, 0.0702), 17.75: (0.0835, 0.0587),
          18.00: (0.0365, 0.0126), 18.25: (0.0430, 0.0155), 18.50: (0.0712, 0.0444),
          18.75: (0.1102, 0.0817), 19.00: (0.0935, 0.0686), 19.25: (0.1408, 0.1619),
          19.50: (0.1760, 0.1832)}
#: What the NEW curve must produce at these elevations if it is running at all. smoothstep(1 - band).
EXPECT_NIGHTFALL = {18.00: 0.6064, 18.25: 0.8919, 12.00: 0.0}
SPAN = 21.0
EYE = (-320.0, -1900.0, 200.0)
AT = (0.0, -1460.0, 90.0)
AGREE = 0.010
GROUND_FLOOR = 0.030


def patch(cx, cy, hw, hh):
    got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
    if got is None:
        return None
    mean, dark, bright, sampled = got
    return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4),
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

    def read_nightfall():
        """The engine's own Nightfall, by whatever route this build offers. None if no route works.

        NOT ASSUMED. I have invented an API name in this tree before, so each route is tried and the one
        that answered is recorded beside the value. A None here does not fail the run -- it downgrades it
        from proof to evidence, which is stated rather than quietly glossed.
        """
        try:
            sub = unreal.SubsystemBlueprintLibrary.get_world_subsystem(
                live(), unreal.WonderlandDayCycleSubsystem)
            if sub is not None:
                return float(sub.get_night_amount()), "WonderlandDayCycleSubsystem.get_night_amount"
        except Exception:                                              # noqa: BLE001
            pass
        try:
            sub = unreal.SubsystemBlueprintLibrary.get_world_subsystem(
                live(), unreal.WonderlandPracticalLightsSubsystem)
            if sub is not None:
                line = str(sub.describe_practicals())
                for tok in line.split():
                    if tok.startswith("night="):
                        return float(tok.split("=", 1)[1]), "DescribePracticals night="
        except Exception:                                              # noqa: BLE001
            pass
        return None, None

    L.focus_game_viewport()
    cvar("wl.Sky.DayMinutes", 0)
    cvar("wl.Sky.TwilightSpan", "%.1f" % SPAN)
    L.pose_camera(live(), unreal.Vector(*EYE), unreal.Vector(*AT), 60.0)
    yield 3.0
    RESULT["camera_eye"] = list(EYE)
    RESULT["camera_at"] = list(AT)
    RESULT["compared_against"] = {"job": "zzT2_dusk_hole + zzT1 noon", "rows": len(BEFORE)}

    def settled():
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
    RESULT["after"] = rows
    route_seen = None
    for hour in HOURS:
        cvar("wl.Sky.Hour", "%.2f" % hour)
        for step in settled():
            yield step
        nf, route = read_nightfall()
        route_seen = route or route_seen
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
        was = BEFORE.get(round(hour, 2), (None, None))
        rows.append({
            "hour": hour,
            "luma": round((a["luma"] + b["luma"]) / 2.0, 4),
            "spread": round(abs(a["luma"] - b["luma"]), 4),
            "tails": round((a["tails"] + b["tails"]) / 2.0, 4),
            "ground_luma": round(((g1 or {}).get("luma", 0.0) + (g2 or {}).get("luma", 0.0)) / 2.0, 4)
            if g1 and g2 else None,
            "nightfall_read": (round(nf, 4) if nf is not None else None),
            "was_luma": was[0], "was_ground": was[1]})

    cvar("wl.Sky.Hour", 12)
    L.release_camera(live())

    good = [r for r in rows if not r.get("unmeasured")]
    RESULT["nightfall_route"] = route_seen

    worst_spread = max((r["spread"] for r in good), default=None)
    record("C_NOISE", "each rung agrees with itself -- two reads of the same hour",
           worst_spread is not None and worst_spread <= AGREE and len(good) == len(HOURS),
           worst_spread=worst_spread, tolerance=AGREE, measured=len(good), wanted=len(HOURS))
    if not good or len(good) != len(HOURS) or (worst_spread or 1.0) > AGREE:
        RESULT["status"] = "voided: the rungs do not agree with themselves"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    # ---- IS THE NEW CURVE EVEN RUNNING? A build without it reproduces zzT2 and would fail C_CLOSED for a
    # reason that looks like the fix not working rather than the fix not being present.
    checked = {}
    for r in good:
        want = EXPECT_NIGHTFALL.get(round(r["hour"], 2))
        if want is not None and r["nightfall_read"] is not None:
            checked["%.2f" % r["hour"]] = {"read": r["nightfall_read"], "expected_new_curve": want,
                                           "old_curve_would_be": 0.0}
    agreeing = [k for k, v in checked.items() if abs(v["read"] - v["expected_new_curve"]) <= 0.02]
    record("C_CURVE", "the running build carries the complement curve, read back from the engine",
           len(checked) > 0 and len(agreeing) == len(checked),
           readback_route=route_seen, checked=checked, agreeing=agreeing,
           note="if this could not be read at all the run is EVIDENCE, not proof, and says so in status. "
                "The old curve is exactly 0.0 at every elevation above -2, so it is trivially separable "
                "from the new one at 18:00 and 18:15")
    if not checked:
        RESULT["curve_unverified"] = True

    # ---- THE CLAIM I MADE FROM ARITHMETIC, MEASURED. Full day untouched because the band saturates.
    noon = next((r for r in good if abs(r["hour"] - 12.0) < 0.01), None)
    noon_gap = (round(abs(noon["luma"] - BEFORE[12.00][0]), 4) if noon else None)
    record("C_DAY", "noon is unchanged -- the day-untouched claim, measured rather than asserted",
           noon_gap is not None and noon_gap <= AGREE,
           now=(noon or {}).get("luma"), was=BEFORE[12.00][0], gap=noon_gap, tolerance=AGREE,
           note="at +12 deg and above the band is 1 so Nightfall is exactly 0 either way. That is the "
                "argument; this is the measurement, and zzT1 left a noon reading at this pose to check it")

    # ---- THE DEFECT, STATED AS A SHAPE. An interior minimum means the world still goes darker than night
    # and climbs back out. Noon is excluded: it is the control, not part of the evening.
    evening = [r for r in good if r["hour"] >= 17.5]
    lo = min(evening, key=lambda r: r["luma"])
    interior = evening[0] is not lo and evening[-1] is not lo
    margin = round(min(evening[0]["luma"], evening[-1]["luma"]) - lo["luma"], 4)
    record("C_CLOSED", "the evening no longer dips below night and climb back out",
           not (interior and margin > AGREE),
           lowest_hour=lo["hour"], lowest_luma=lo["luma"], is_interior=interior,
           margin_below_both_ends=margin,
           was_bottom_hour=18.0, was_bottom_luma=BEFORE[18.00][0],
           note="zzT2 had an interior minimum at 18:00 sitting 0.059 below both ends. Passing means the "
                "evening now falls into night instead of through it")

    # ---- NOTHING TRADED AWAY. Lifting the trough by darkening its neighbours would be a bad bargain that
    # looking only at the bottom would hide.
    darker = [{"hour": r["hour"], "now": r["luma"], "was": r["was_luma"],
               "delta": round(r["luma"] - r["was_luma"], 4)}
              for r in good if r["was_luma"] is not None and r["luma"] < r["was_luma"] - AGREE]
    record("C_NOREG", "no hour came back darker than zzT2 measured it",
           len(darker) == 0, rungs_darker=darker, tolerance=AGREE,
           deltas={("%.2f" % r["hour"]): (round(r["luma"] - r["was_luma"], 4)
                                          if r["was_luma"] is not None else None) for r in good})

    # ---- AND THE FOUNDER'S SENTENCE.
    with_ground = [r for r in good if r.get("ground_luma") is not None and r["hour"] >= 17.5]
    darkest = min(with_ground, key=lambda r: r["ground_luma"]) if with_ground else None
    record("C_GROUND", "the ground is readable at every hour of the crossover",
           darkest is not None and darkest["ground_luma"] >= GROUND_FLOOR,
           darkest_hour=(darkest or {}).get("hour"), darkest_ground=(darkest or {}).get("ground_luma"),
           floor=GROUND_FLOOR, was_darkest=BEFORE[18.00][1],
           ground_by_hour={("%.2f" % r["hour"]): r.get("ground_luma") for r in good},
           note="zzT2 failed this at 0.0126. The same floor and the same patch, so the two are comparable")

    RESULT["status"] = ("measured" if checked else
                        "measured (EVIDENCE ONLY: the running curve could not be read back)")
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
