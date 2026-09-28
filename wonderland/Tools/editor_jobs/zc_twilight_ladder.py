# THE FOUNDER'S ITEM 12: does the day have an afternoon, and does the evening arrive gradually?
#
# Their words are morning to afternoon to evening to night with no sudden jumps. What the world does instead,
# read off the curve: Daylight = clamp((elevation + 9) / SPAN)^1.9 saturates at 12 degrees, so at the shipped
# SPAN of 21 it reads EXACTLY 1.0 from 06:38 to 17:22 -- 10.7 hours of identical daylight -- and then falls
# the whole way to zero in 67 minutes. A plateau and a cliff, not a day.
#
# wl.Sky.TwilightSpan makes the band a knob. This measures what widening it actually does, at 21 (shipped),
# 30 and 39, before the default moves.
#
# EVERY READING IS TAKEN TWICE AND ITS SPREAD REPORTED, which is the thing this job tree has been missing.
# The traversal harness measured the same route at 230, 0, 35.2 and 86.0 in one session, and every
# conclusion drawn from it came from a single draw of a distribution nobody had checked was one. A gate
# should report its own spread before anyone reads its value. If the two reads of a rung disagree by more
# than the difference between rungs, this says so and the ladder means nothing.
#
# AND IT TESTS THE SAFETY CLAIM RATHER THAN ASSERTING IT. I wrote that "noon is identical at every span,
# because at 72 degrees every band saturates". That is arithmetic and it is exactly the kind of persuasive
# reasoning that has been wrong all day -- a no-op VALUE that was not a no-op PASS, a threshold calibrated to
# the state it was judging. T00 measures noon at all three spans and fails if they differ by more than the
# instrument's own noise.
#
# Saves nothing. Restores the span it found. Holds world exposure and the other lane's eye levels.
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "twilight")

#: Shipped first so the control is taken before anything is changed.
SPANS = (21.0, 30.0, 39.0)
#: Noon as the control, then the four hours the transition actually happens in.
HOURS = (12.0, 16.0, 17.0, 18.0, 19.0)
#: The arrival: the founder's first place and the one the ladder has always used.
EYE = (-320.0, -1900.0, 200.0)
AT = (0.0, -1460.0, 90.0)
#: Two reads of the same rung should agree this closely, or the rung is noise.
AGREE = 0.010


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
    L.pose_camera(live(), unreal.Vector(*EYE), unreal.Vector(*AT), 60.0)
    yield 3.0

    # ---- WHERE THIS WAS READ FROM, RECORDED RATHER THAN ASSUMED.
    #
    # The practical-light pool is selected around the viewer and is budgeted: wl.Look.PracticalCount is 48
    # against a manifest of 1,464, and in the densest districts far more lamps compete for that budget than
    # can win it. So a reading taken at two different places can differ by how much of the pool was spent
    # there, and a ladder that moved between rungs would be partly measuring the pool rather than the span.
    #
    # This job pins one EYE and AT for all fifteen rungs, so the pool is the same set throughout and a span
    # difference cannot be a pool difference. That was luck rather than design. A constant should be VISIBLE
    # as a constant instead of trusted, so it goes in the result where a reader can check it.
    RESULT["camera_eye"] = list(EYE)
    RESULT["camera_at"] = list(AT)
    RESULT["camera_note"] = ("one fixed pose for every rung, so the practical-light pool is identical across "
                             "spans and hours; a span difference here cannot be a pool difference")

    def settled():
        """Wait for the picture to stop FALLING, not merely to stop moving between two reads.

        A duration is not a quantity when the frame rate is not fixed -- and two adjacent reads agreeing is
        not enough either. The other lane read an unchanged world at 521, 123, 64, 48, 57 ms after
        BeginPlay: a descent, not scatter. A sequence falling gently can have neighbours inside the
        tolerance while still on its way down, so a pair-agreement test can return mid-descent and hand
        back a number from a machine that has not arrived.
        """
        # THE WINDOW'S SPREAD, NOT ITS STEPS -- AND THIS IS THE FIFTH VERSION OF THIS TEST.
        #
        # It read "three in a row, not a pair", and three consecutive STEPS inside a tolerance is not
        # three reads in agreement, because steps compound: three steps of 0.0039 walk the window 0.0117
        # downhill while every adjacent pair passes, which is wider than the 0.010 this job calls
        # agreement. The other lane demonstrated it on [200, 60, 66, 61, 50, 49, 48.5], where a step test
        # returns on the 60 with a fifth of the fall still to come. That is the pair test's hole, one read
        # wider, failing on exactly the oscillating case the three-read version was written to catch.
        #
        # Timer, pair, last-drop, three-consecutive: each fixed the previous one's SHAPE and kept its
        # assumption, which was always that arrival is recognisable from the direction of the series. Max
        # minus min across the last three asks the question actually being asked -- are these three the
        # same reading -- and has no direction, rate or shape assumption left in it. A window spread is
        # still a local property, so this is not proof either; it is the first version with nothing about
        # the approach built into it.
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
        # Fell through without settling, and says so by NOT trimming anything: the rung's own two-read
        # spread then carries the damage into T_NOISE, which voids the ladder. A run whose instrument never
        # arrived should report that rather than produce a tidy number from its tail.

    # ---- DOES THE KNOB EXIST? Read it back before trusting a single rung.
    #
    # wl.Sky.TwilightSpan is new C++ and the running editor may predate it. An unrecognised console command
    # does not fail -- it logs "Command not recognized" and carries on -- so every span would silently be
    # the shipped 21 and the ladder would be three identical numbers.
    #
    # AND T00 WOULD PASS ON THAT. It asks whether noon is unchanged across spans; if the knob does nothing,
    # noon is trivially identical and the safety gate goes green on a run that measured one setting three
    # times. A false green from a gate written to prevent exactly this class of thing, so the readback
    # comes first and voids the run rather than letting the ladder publish.
    readback = {}
    for span in SPANS:
        cvar("wl.Sky.TwilightSpan", "%.1f" % span)
        yield 0.5
        try:
            readback[span] = round(float(
                unreal.SystemLibrary.get_console_variable_float_value("wl.Sky.TwilightSpan")), 2)
        except Exception as err:                                      # noqa: BLE001
            readback[span] = "unreadable: %s" % str(err)[:60]
    took = [sp for sp, got in readback.items() if isinstance(got, float) and abs(got - sp) < 0.05]
    record("T_CVAR", "wl.Sky.TwilightSpan exists in this build and every value actually took",
           len(took) == len(SPANS), asked_for=list(SPANS), read_back=readback,
           note="a console command the build does not know logs 'Command not recognized' and carries on. "
                "Every span would then be the shipped 21, the ladder would be one setting measured three "
                "times, and T00 -- which asks whether noon is unchanged across spans -- would pass on it. "
                "Red here voids everything below")
    if len(took) != len(SPANS):
        cvar("wl.Sky.TwilightSpan", "21.0")
        RESULT["status"] = "voided: the span cvar is not in this build"
        yield 2.0
        les.editor_request_end_play()
        return

    rows = []
    RESULT["ladder"] = rows
    for span in SPANS:
        cvar("wl.Sky.TwilightSpan", "%.1f" % span)
        for hour in HOURS:
            cvar("wl.Sky.Hour", "%.2f" % hour)
            for step in settled():
                yield step
            # TWICE, so the rung carries its own noise and nobody reads a single draw as a value.
            a = patch(0.5, 0.5, 0.46, 0.44)
            g1 = patch(0.5, 0.78, 0.30, 0.16)
            yield 1.0
            b = patch(0.5, 0.5, 0.46, 0.44)
            g2 = patch(0.5, 0.78, 0.30, 0.16)
            try:
                H.capture_viewport_jpeg(os.path.join(ROOT, "span%02.0f_h%02.0f.jpg" % (span, hour)), 1200, 85)
            except Exception:                                          # noqa: BLE001
                pass
            if a is None or b is None:
                rows.append({"span": span, "hour": hour, "unmeasured": True})
                continue
            elev = math.sin(((hour - 6.0) / 12.0) * math.pi) * 72.0
            dayl = max(0.0, min(1.0, (elev + 9.0) / span)) ** 1.9
            rows.append({
                "span": span, "hour": hour,
                "luma": round((a["luma"] + b["luma"]) / 2.0, 4),
                "spread": round(abs(a["luma"] - b["luma"]), 4),
                "tails": round((a["tails"] + b["tails"]) / 2.0, 4),
                "ground_luma": round(((g1 or {}).get("luma", 0) + (g2 or {}).get("luma", 0)) / 2.0, 4)
                if g1 and g2 else None,
                "sun_elevation": round(elev, 2),
                "daylight_predicted": round(dayl, 4),
                "exposure_bias_predicted": round(1.45 + (-0.9 - 1.45) * dayl, 3)})

    cvar("wl.Sky.TwilightSpan", "21.0")
    cvar("wl.Sky.Hour", 12)
    L.release_camera(live())

    good = [r for r in rows if not r.get("unmeasured")]
    worst_spread = max((r["spread"] for r in good), default=None)

    # ---- THE INSTRUMENT FIRST, ALWAYS. If two reads of one rung disagree by more than the rungs do, the
    # ladder is noise and nothing below it may be read.
    record("T_NOISE", "each rung agrees with itself -- two reads of the same setting, same hour",
           worst_spread is not None and worst_spread <= AGREE,
           worst_spread=worst_spread, tolerance=AGREE,
           note="the traversal harness measured one route at 230, 0, 35.2 and 86.0 in a single session and "
                "every conclusion from it came from one draw. A gate must report its own spread before "
                "anyone reads its value")

    # ---- THE SAFETY CLAIM, MEASURED. I asserted noon is identical at every span because the band saturates
    # at 72 degrees. Arithmetic that has not been checked is exactly what went wrong all day.
    noons = {r["span"]: r["luma"] for r in good if abs(r["hour"] - 12.0) < 0.01}
    spread_noon = (max(noons.values()) - min(noons.values())) if len(noons) > 1 else None
    record("T00", "noon is unchanged by the span -- the claim that made this safe to sweep at all",
           spread_noon is not None and spread_noon <= max(AGREE, (worst_spread or 0.0)),
           noon_by_span=noons, spread=spread_noon,
           note="asserted from the arithmetic (every band saturates at 72 degrees) and now measured. If "
                "this is red the knob is not safe to change and nothing else here matters")

    # ---- AND WHAT IT BUYS: the evening should stop being a cliff.
    def worst_step(span):
        seq = [r for r in good if r["span"] == span and r["hour"] >= 16.0]
        seq.sort(key=lambda r: r["hour"])
        return max((abs(seq[i]["luma"] - seq[i - 1]["luma"]) for i in range(1, len(seq))), default=None)

    # ---- AND CHECKED AS A RELATIVE STEP TOO, because an absolute one is not comparable across
    # ---- settings that sit at different overall levels -- the trap that made a fixed crushed
    # ---- fraction score the APPROVED night at 0.9756 and pass everything built on it.
    #
    # RE-EXAMINED 2026-09-28 against zzT1's stored ladder, and T01's verdict SURVIVES the better
    # measure. I expected the opposite: widening lowers Daylight everywhere, which raises
    # AutoExposureBias, so I assumed a wider span simply made the scene brighter and inflated the
    # absolute steps. The data refutes that outright --
    #
    #          16h      17h      18h      19h
    #   21   0.1434   0.1360   0.0365   0.0937
    #   30   0.1255   0.1693   0.0340   0.0935
    #   39   0.1484   0.2139   0.0327   0.0938
    #
    # -- because 18h and 19h are IDENTICAL across all three spans. There is no overall brightening.
    # Widening raises 17:00 specifically, from 0.136 to 0.214, and leaves dusk exactly where it was,
    # so the 17->18 drop gets bigger rather than spread. Relative steps agree: worst 1.15, 1.33, 1.47.
    #
    # The mechanism is that at 17:00 the sun is 18.6 deg up, which is INSIDE the band at 39 and
    # clamped at 21 -- so widening only moves the part of the afternoon that was already saturated,
    # and never reaches the hour where the cliff actually is.
    #
    # So TwilightSpan is not the lever for item 12. The plateau and the cliff are both real, and the
    # thing that causes them is the clamp at elevation SPAN-9 together with the 1.9 exponent, not the
    # width of the band.
    steps = {s: worst_step(s) for s in SPANS}
    rel = {}
    for sp in SPANS:
        seq = sorted((r for r in good if r["span"] == sp and r["hour"] >= 16.0),
                     key=lambda r: r["hour"])
        worst = None
        for i in range(1, len(seq)):
            mid = (seq[i]["luma"] + seq[i - 1]["luma"]) / 2.0
            if mid > 1e-6:
                v = abs(seq[i]["luma"] - seq[i - 1]["luma"]) / mid
                worst = v if worst is None else max(worst, v)
        rel[sp] = worst
    RESULT["worst_relative_step"] = rel
    base, wide = steps.get(21.0), steps.get(39.0)
    record("T01", "widening the band makes the evening arrive gradually rather than in one step",
           base is not None and wide is not None and wide < base,
           worst_hour_to_hour_step=steps, worst_relative_step=rel,
           note="the shipped 21 spends the whole evening in 67 minutes; 39 spreads it over 127. If the "
                "biggest hour-to-hour step does not fall, widening has not bought what it was for")

    RESULT["worst_spread"] = worst_spread
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
