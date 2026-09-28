# WHICH MOON-CASTER HANDOVER IS CHEAPEST? Shipped, delayed, and casting from first visibility.
#
# THE FAULT, measured at plaza_e in the shipped world (zc_dusk_truth):
#     18:25  ground 0.11638  casters [V2_Sun]
#     18:26  ground 0.06604  casters [V2_Sun, WL_Moon]
# 43 per cent in a minute, 6.89x the median evening step, 45x noise, obvious by eye.
#
# THE STEP IS A DIFFERENCE OF TWO CURVES: what the shadowless moon was giving, minus what the casting
# moon gives, at the instant of handover. Both rise through the evening and the shadowless one rises
# faster, so the step only grows -- measured 0.047 at 18:16, 0.065 at 18:24, 0.087 at 18:30, 0.089 at
# 18:48. The cheapest handover is therefore the EARLIEST.
#
# DELAY WAS TRIED FIRST AND MEASURED WORSE (first run of this job):
#     MoonCastAltitude  0  ->  18.25->18.26, step 0.0487   shipped
#     MoonCastAltitude 15  ->  18.80->18.90, step 0.0736   50 per cent worse
#     MoonCastAltitude 18  ->  18.95->19.00, step 0.0762   56 per cent worse
# because a shadowless moon lights every surface regardless of occlusion, so postponing only lets more
# accumulate. The delayed arm reads 0.183 at 18:48 against the approved midnight's 0.108 -- dusk
# brighter than midnight, which is the anomaly rather than the thing to protect. delay18 is kept as
# one arm to hold that result in view, not to compete.
#
# THE CANDIDATE IS NOW wl.Sky.MoonCastAlways: the moon casts from the moment it is visible, so it
# never accumulates a flood to lose and obeys the world's geometry throughout.
#
# THE TRAP THIS JOB IS BUILT AROUND, AT BOTH ENDS. A handover outside the sampled range produces a
# perfectly flat evening and looks like a fix. A delayed candidate can fall off the back; cast_always
# hands over near 17:50 and would fall off the front. So the ladder runs 17.70 to 19.40, and H_MOVED
# fails any arm already casting at the first rung as well as any arm that did not move at all.
#
# H6 tests the WHOLE evening for a dominating step, so a relocation cannot pass as a removal.
#
# Restores every knob to what it FOUND. Saves nothing.
import math
import os

CONCURRENT = False

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "dusk_handover")

SPOT = (-64.0, -5700.0)
CAM_YAW = 90.0
SPAN = 21.0
#: STARTS BEFORE THE MOON IS VISIBLE. cast_always hands over as soon as Nightfall clears 0.002,
#: which is around 17:50, so the ladder has to begin earlier than the shipped crossover or the new
#: handover falls off the front of the range -- the same way a delayed one could fall off the back.
EVENING = (17.70, 17.80, 17.90, 18.00, 18.10, 18.20, 18.24, 18.25, 18.26, 18.27, 18.30, 18.40,
           18.50, 18.80, 18.90, 18.95, 19.00, 19.05, 19.10, 19.20, 19.40)
ANCHORS = (23.00, 12.00)
#: (label, MoonCastAltitude, MoonCastAlways). Altitude 15 and 18 were measured 50 and 56 per cent
#: WORSE than shipped -- kept as one arm rather than two, because their job now is to show the
#: direction rather than to compete.
ARMS = (("shipped", 0.0, 0.0), ("delay18", 18.0, 0.0), ("always", 0.0, 1.0))

AGREE = 0.010
CAM_UP, CAM_AHEAD, CAM_DROP, CAM_FOV = 160.0, 900.0, -250.0, 70.0
GROUND_RECT = (0.5, 0.74, 0.28, 0.16)
FRAME_RECT = (0.5, 0.5, 0.46, 0.44)
GRID_COLS, GRID_ROWS = 4, 2
CLEAR_FRACTION = 0.92
GREEN_MAX = 1.25
#: No character may stand in the patch. zc_dusk_truth's second vantage passed all three geometric
#: tests with the Apollo mascot filling the ground rect -- pale, so not green; not an occluder, so
#: reach 1.0; under open sky. An animated emissive in the measurement region is the fourth way this
#: lane has measured something other than the world.
FIGURE_CLEAR_UU = 1200.0
VIS_CH = unreal.TraceTypeQuery.TRACE_TYPE_QUERY1
PAWN_CH = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2
DOMINATES = 3.0
CLIFF_FACTOR = 4.0


def elevation_at(hour):
    return math.sin(((hour - 6.0) / 12.0) * math.pi) * 72.0


def median(xs):
    s = sorted(xs)
    if not s:
        return None
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2.0


def cells(rect, cols, rows):
    cx, cy, hw, hh = rect
    x0, y0, w, h = cx - hw, cy - hh, (2.0 * hw) / cols, (2.0 * hh) / rows
    return [(x0 + c * w, y0 + r * h, x0 + (c + 1) * w, y0 + (r + 1) * h)
            for r in range(rows) for c in range(cols)]


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests
    os.makedirs(ROOT, exist_ok=True)

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def bail(why):
        RESULT["status"] = "voided: " + why
        emit("VOID", "FAIL", why, {})

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

    def command(t):
        unreal.SystemLibrary.execute_console_command(live(), t)

    def read_f(n):
        try:
            return round(float(unreal.SystemLibrary.get_console_variable_float_value(n)), 5)
        except Exception:                                              # noqa: BLE001
            return None

    def rect(r):
        cx, cy, hw, hh = r
        got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
        if got is None:
            return None
        mean, dark, bright, _ = got
        r_, g_, b_ = float(mean.r), float(mean.g), float(mean.b)
        return {"luma": round(0.2126 * r_ + 0.7152 * g_ + 0.0722 * b_, 5),
                "green_ratio": round(g_ / max((r_ + b_) / 2.0, 1e-5), 3),
                "crushed_legacy": round(float(dark), 4)}

    def grid():
        out = []
        for x0, y0, x1, y1 in cells(GROUND_RECT, GRID_COLS, GRID_ROWS):
            got = L.read_screen_rect(x0, y0, x1, y1)
            if got is None:
                return None
            mean, _, _, _ = got
            out.append(round(0.2126 * float(mean.r) + 0.7152 * float(mean.g)
                             + 0.0722 * float(mean.b), 5))
        return out

    def trace(a, b, ignore, ch):
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                live(), a, b, ch, False, [p for p in (ignore,) if p is not None],
                unreal.DrawDebugTrace.NONE, True,
                unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            if hit is None:
                return None
            t = hit.to_tuple()
            return {"dist": round(float(t[3]), 1), "z": round(float(t[4].z), 1)}
        except Exception:                                              # noqa: BLE001
            return None

    def lights():
        dirs, sky = [], None
        try:
            for a in unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.DirectionalLight):
                c = a.get_component_by_class(unreal.DirectionalLightComponent)
                if c is None:
                    continue
                lb = str(a.get_actor_label()) if hasattr(a, "get_actor_label") else str(a.get_name())
                dirs.append({"label": lb,
                             "intensity": round(float(c.get_editor_property("intensity")), 5),
                             "casts": bool(c.get_editor_property("cast_shadows"))})
            for a in unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.SkyLight):
                c = a.get_component_by_class(unreal.SkyLightComponent)
                if c is not None:
                    sky = round(float(c.get_editor_property("intensity")), 4)
                    break
        except Exception:                                              # noqa: BLE001
            pass
        return dirs, sky

    def exposure():
        try:
            vols = list(unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.PostProcessVolume))
        except Exception:                                              # noqa: BLE001
            return "enumeration failed"
        if not vols:
            return "no grade volume"
        st = vols[0].get_editor_property("settings")
        try:
            return round(float(st.auto_exposure_bias), 4)
        except Exception:                                              # noqa: BLE001
            pass
        try:
            return round(float(st.get_editor_property("auto_exposure_bias")), 4)
        except Exception:                                              # noqa: BLE001
            return "unreadable"

    # ---- THE KNOB MUST EXIST. A missing CVar reads 0.0, which is this knob's shipped default, so
    # ---- "absent" and "inert" are the same reading without a sentinel.
    KNOBS = ("wl.Sky.MoonCastAltitude", "wl.Sky.MoonCastAlways")
    KNOB = KNOBS[0]
    dll = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)),
                       "Binaries", "Win64", "UnrealEditor-Wonderland.dll")
    try:
        import datetime
        built = datetime.datetime.fromtimestamp(os.path.getmtime(dll)).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:                                                  # noqa: BLE001
        built = "unreadable"
    found = {k: read_f(k) for k in KNOBS}
    for k in KNOBS:
        command("%s 37.25" % k)
    yield 0.5
    probe = {k: read_f(k) for k in KNOBS}
    for k in KNOBS:
        command("%s %.5f" % (k, found[k] if found[k] is not None else 0.0))
    yield 0.5
    RESULT["binary_built"] = built
    present = [k for k in KNOBS if probe[k] is not None and abs(probe[k] - 37.25) < 1e-3]
    record("H_CVAR", "both moon-caster knobs exist in the RUNNING build, by sentinel round-trip",
           len(present) == len(KNOBS), population=len(KNOBS), answering=present,
           missing=[k for k in KNOBS if k not in present],
           as_found=found, sentinel_readback=probe, binary_built=built,
           note="a CVar that does not exist reads 0.0, which is exactly the shipped default of both")
    if len(present) != len(KNOBS):
        bail("the running build does not carry both moon-caster knobs (binary built %s)" % built)
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    L.focus_game_viewport()
    command("wl.Sky.DayMinutes 0")
    command("wl.Sky.TwilightSpan %.1f" % SPAN)

    # ---- STAND, AND PROVE THE CAMERA SEES OPEN GROUND WITH NOBODY IN IT
    pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
    gh = trace(unreal.Vector(SPOT[0], SPOT[1], 20000.0),
               unreal.Vector(SPOT[0], SPOT[1], -5000.0), pawn, PAWN_CH)
    if pawn is not None:
        pawn.set_actor_location(
            unreal.Vector(SPOT[0], SPOT[1], (gh["z"] + 120.0) if gh else 200.0), False, True)
    command("FlushLevelStreaming")
    yield 3.0
    pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
    if pawn is None:
        bail("no pawn after the teleport")
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    w = pawn.get_actor_location()
    rad = math.radians(CAM_YAW)
    eye = unreal.Vector(w.x, w.y, w.z + CAM_UP)
    at = unreal.Vector(w.x + math.cos(rad) * CAM_AHEAD, w.y + math.sin(rad) * CAM_AHEAD,
                       w.z + CAM_DROP)
    L.pose_camera(live(), eye, at, CAM_FOV)
    command("wl.Sky.Hour 12")
    yield 2.5
    gx, gy = eye.x + (at.x - eye.x) * 0.75, eye.y + (at.y - eye.y) * 0.75
    gp = trace(unreal.Vector(gx, gy, eye.z + 2000.0),
               unreal.Vector(gx, gy, eye.z - 4000.0), pawn, VIS_CH)
    reach = None
    if gp is not None:
        tgt = unreal.Vector(gx, gy, gp["z"] + 2.0)
        want = math.sqrt((tgt.x - eye.x) ** 2 + (tgt.y - eye.y) ** 2 + (tgt.z - eye.z) ** 2)
        seen = trace(eye, tgt, pawn, VIS_CH)
        reach = 1.0 if seen is None else (seen["dist"] / want if want > 1.0 else None)
    overhead = (trace(unreal.Vector(gx, gy, gp["z"] + 20.0),
                      unreal.Vector(gx, gy, gp["z"] + 8000.0), pawn, VIS_CH) if gp else None)
    figures = []
    try:
        for a in unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.Pawn):
            if a == pawn:
                continue
            p = a.get_actor_location()
            dd = math.hypot(p.x - gx, p.y - gy)
            lb = str(a.get_actor_label()) if hasattr(a, "get_actor_label") else str(a.get_name())
            figures.append({"label": lb, "dist_uu": round(dd, 1)})
    except Exception:                                                  # noqa: BLE001
        figures = None
    nearest = min((f["dist_uu"] for f in figures), default=None) if figures is not None else None
    gnoon = rect(GROUND_RECT)
    try:
        H.capture_viewport_jpeg(os.path.join(ROOT, "00_vantage_noon.jpg"), 1400, 88)
    except Exception:                                                  # noqa: BLE001
        pass
    ok = bool(reach is not None and reach >= CLEAR_FRACTION and gnoon is not None
              and gnoon["green_ratio"] <= GREEN_MAX and overhead is None
              and nearest is not None and nearest >= FIGURE_CLEAR_UU)
    RESULT["vantage"] = {"spot": list(SPOT), "yaw": CAM_YAW, "view_reach": reach,
                         "green_ratio": (gnoon or {}).get("green_ratio"),
                         "overhead_hit": overhead, "nearest_figure_uu": nearest,
                         "figures": figures, "valid": ok}
    record("H_VALID", "the camera sees open ground, that ground is open to the sky, and no character "
                      "is standing in the patch", ok, **RESULT["vantage"])
    if not ok:
        bail("the observation point could not be shown valid")
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    def settled(limit=24):
        win = []
        for _ in range(limit):
            yield 1.0
            n = rect(FRAME_RECT)
            if n is None:
                continue
            win.append(n["luma"])
            if len(win) > 3:
                win.pop(0)
            if len(win) == 3 and (max(win) - min(win)) < 0.004:
                return

    for step in settled(60):
        yield step

    rows = {}
    RESULT["readings"] = rows
    for label, alt, always in ARMS:
        command("wl.Sky.MoonCastAltitude %.4f" % alt)
        command("wl.Sky.MoonCastAlways %.4f" % always)
        for hour in EVENING + ANCHORS:
            command("wl.Sky.Hour %.4f" % hour)
            yield 1.0
            for step in settled():
                yield step
            g1, f1, cg = rect(GROUND_RECT), rect(FRAME_RECT), grid()
            yield 1.0
            g2, f2 = rect(GROUND_RECT), rect(FRAME_RECT)
            key = "%s_h%05.2f" % (label, hour)
            try:
                H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % key), 1300, 86)
            except Exception:                                          # noqa: BLE001
                pass
            if not (g1 and g2 and f1 and f2 and cg):
                rows[key] = {"arm": label, "hour": hour, "unmeasured": True}
                continue
            dirs, sky = lights()
            lo, hi, mid = min(cg), max(cg), median(cg)
            rows[key] = {
                "arm": label, "hour": hour, "cast_altitude": alt, "cast_always": always,
                "ground_luma": round((g1["luma"] + g2["luma"]) / 2.0, 5),
                "ground_spread": round(abs(g1["luma"] - g2["luma"]), 5),
                "frame_spread": round(abs(f1["luma"] - f2["luma"]), 5),
                "cells": cg, "cell_spread": round(hi - lo, 5),
                "cell_contrast": round((hi - lo) / max(mid, 1e-5), 4),
                "crushed_legacy": round((g1["crushed_legacy"] + g2["crushed_legacy"]) / 2.0, 4),
                "sky_intensity": sky, "exposure_bias": exposure(),
                "shadow_casters": [d["label"] for d in dirs if d["casts"]],
                "moon_casting": any(d["casts"] and "Moon" in d["label"] for d in dirs),
                "knobs_held": {k: read_f(k) for k in KNOBS},
                "moon_altitude_deg": round(-elevation_at(hour), 3)}

    for k in KNOBS:
        command("%s %.5f" % (k, found[k] if found[k] is not None else 0.0))
    command("wl.Sky.Hour 12")
    L.release_camera(live())

    good = {k: v for k, v in rows.items() if not v.get("unmeasured")}
    wanted = len(ARMS) * (len(EVENING) + len(ANCHORS))
    record("H_MEASURED", "every arm and hour produced a reading",
           len(good) == wanted, population=len(good), wanted=wanted,
           missing=[k for k in rows if rows[k].get("unmeasured")])
    worst = max((max(v["ground_spread"], v["frame_spread"]) for v in good.values()), default=None)
    record("H_NOISE", "every reading agrees with itself",
           len(good) > 0 and worst is not None and worst <= AGREE,
           population=len(good), worst_spread=worst, tolerance=AGREE)
    if len(good) != wanted or worst is None or worst > AGREE:
        bail("readings missing or disagreeing with themselves")
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    noise = max(worst, 0.002)

    LABELS = [a[0] for a in ARMS]

    def g(arm, hour):
        return good["%s_h%05.2f" % (arm, hour)]

    # ---- WHERE EACH ARM HANDS OVER, read from the caster census rather than predicted.
    handover = {}
    for arm in LABELS:
        hv = None
        casting_at_first = g(arm, EVENING[0])["moon_casting"]
        for i in range(len(EVENING) - 1):
            a, b = g(arm, EVENING[i]), g(arm, EVENING[i + 1])
            if (not a["moon_casting"]) and b["moon_casting"]:
                hv = {"between": "%.2f->%.2f" % (EVENING[i], EVENING[i + 1]),
                      "step": round(abs(b["ground_luma"] - a["ground_luma"]), 5),
                      "moon_altitude_after": b["moon_altitude_deg"]}
                break
        handover[arm] = hv
        # ALREADY CASTING AT THE FIRST RUNG means the handover is off the front of the ladder and
        # this arm's flat evening proves nothing -- the same failure as one falling off the back.
        handover[arm + "_casting_at_first_rung"] = casting_at_first
    RESULT["handover"] = handover
    others = [a for a in LABELS if a != "shipped"]
    moved = [a for a in others if handover[a] is not None and handover["shipped"] is not None
             and handover[a]["between"] != handover["shipped"]["between"]]
    off_ladder = [a for a in LABELS if handover[a + "_casting_at_first_rung"]]
    record("H_MOVED", "every candidate actually moves the caster handover, and none of them has it "
                      "off the end of the ladder where a flat evening would prove nothing",
           len(others) > 0 and len(moved) == len(others) and not off_ladder,
           population=len(others), arms_that_moved=moved, handover_by_arm=handover,
           arms_already_casting_at_first_rung=off_ladder,
           note="a candidate whose handover falls outside the sampled range looks perfect. The ladder "
                "starts at 17.70, before the moon is visible, and runs to 19.40, past the latest "
                "crossover any arm produces")

    # ---- STEP PROFILES
    prof = {}
    for arm in LABELS:
        seq = [g(arm, h)["ground_luma"] for h in EVENING]
        steps = [round(abs(seq[i + 1] - seq[i]), 5) for i in range(len(seq) - 1)]
        pairs = ["%.2f->%.2f" % (EVENING[i], EVENING[i + 1]) for i in range(len(EVENING) - 1)]
        med = median(steps)
        prof[arm] = {"ground_luma": dict(zip(["%.2f" % h for h in EVENING], seq)),
                          "steps": dict(zip(pairs, steps)),
                          "median_step": med, "largest_step": max(steps),
                          "largest_at": pairs[steps.index(max(steps))],
                          "largest_over_median": (round(max(steps) / med, 2)
                                                  if med and med > 1e-6 else None),
                          "cell_contrast": dict(zip(["%.2f" % h for h in EVENING],
                                                    [g(arm, h)["cell_contrast"] for h in EVENING]))}
    RESULT["profiles"] = prof

    base_big = prof["shipped"]["largest_step"]
    record("H_BASE_CLIFF", "the baseline arm reproduces the cliff, so the candidates are being "
                           "compared against a world that actually has the fault",
           base_big > noise and (prof["shipped"]["largest_over_median"] or 0) >= DOMINATES,
           baseline_largest=base_big, at=prof["shipped"]["largest_at"],
           over_median=prof["shipped"]["largest_over_median"], noise=noise)

    best, verdicts = None, {}
    for arm in LABELS:
        if arm == "shipped":
            continue
        p = prof[arm]
        shrunk = (base_big / p["largest_step"]) if p["largest_step"] > 1e-6 else None
        c1 = p["largest_step"] <= noise or (shrunk is not None and shrunk >= CLIFF_FACTOR)
        c6 = (p["largest_over_median"] is not None and p["largest_over_median"] <= DOMINATES)
        verdicts[arm] = {"largest_step": p["largest_step"], "at": p["largest_at"],
                              "shrink_vs_baseline": (round(shrunk, 1) if shrunk else None),
                              "over_median": p["largest_over_median"],
                              "C1_cliff_removed": c1, "C6_no_dominating_step": c6,
                              "passes": bool(c1 and c6)}
        if c1 and c6 and best is None:
            best = arm
    RESULT["verdicts"] = verdicts
    RESULT["chosen"] = best
    record("H1_CLIFF", "at least one candidate shrinks the cliff by %.0fx or to noise" % CLIFF_FACTOR,
           len(verdicts) > 0 and any(v["C1_cliff_removed"] for v in verdicts.values()),
           population=len(verdicts), by_arm=verdicts, baseline_largest=base_big)
    record("H6_NO_SECOND", "and does it without leaving any dominating step anywhere in the evening",
           len(verdicts) > 0 and any(v["passes"] for v in verdicts.values()),
           population=len(verdicts), by_arm=verdicts, threshold=DOMINATES, chosen=best,
           note="this is the gate a relocation fails. The ladder runs to 19:40, past the 18.97 "
                "crossover the largest threshold produces, so a cliff cannot hide beyond the last rung")

    keep = []
    for hour in ANCHORS:
        b = g("shipped", hour)
        for arm in LABELS:
            if arm == "shipped":
                continue
            c = g(arm, hour)
            keep.append({"hour": hour, "arm": arm, "base": b["ground_luma"],
                         "cand": c["ground_luma"],
                         "delta": round(c["ground_luma"] - b["ground_luma"], 5),
                         "base_casters": b["shadow_casters"], "cand_casters": c["shadow_casters"]})
    RESULT["preservation"] = keep
    record("H_PRESERVED", "the approved night and noon are unchanged under every candidate",
           len(keep) > 0 and all(abs(k["delta"]) <= noise for k in keep)
           and all(k["base_casters"] == k["cand_casters"] for k in keep),
           population=len(keep), noise=noise, by_hour=keep)

    RESULT["captures"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
