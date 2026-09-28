# CAN A CONTINUOUS TERM CARRY DUSK, AND WHAT DOES IT COST? The sizing pass, before the dense ladder.
#
# FOUNDER: "Move the dusk readability responsibility away from the shadowless moon" onto terms that do
# not undergo the caster discontinuity -- sky/ambient, controlled local exposure, existing practicals --
# while preserving the approved night, the nighttime practical character, midnight, exactly-one-caster,
# the existing non-moon dusk improvements, noon, territory identity and readable traversal. And: "If
# continuous dusk illumination cannot satisfy both readability and preservation of approved night,
# return with the measured tradeoff instead of forcing a solution."
#
# THIS JOB EXISTS TO ANSWER "CAN IT AT ALL" BEFORE THE DENSE LADDER SPENDS AN HOUR ASSUMING IT CAN.
# It measures four things and nothing else:
#
#   1. Do the three knobs EXIST in the running build, proven by sentinel round-trip rather than assumed.
#   2. Is the approved night bit-unchanged at the most aggressive knob setting -- acceptance criterion 4.
#   3. Is noon bit-unchanged -- acceptance criterion 5.
#   4. What sky boost, at what window width, brings dusk ground readability up to the APPROVED NIGHT'S
#      OWN readability, measured in the same run at the same camera.
#
# THE TARGET IS NOT A NUMBER I CHOSE. The founder approved the night; the night is therefore readable
# enough to traverse by definition. So the bar for dusk is the approved night's own readable-ground
# fraction at this camera, measured minutes earlier in the same PIE session at the same exposure. That
# is a paired comparison, not a comparison against a remembered figure from another run.
#
# WHY A SENTINEL ROUND-TRIP AND NOT A READBACK. get_console_variable_float_value returns 0.0 for a cvar
# that DOES NOT EXIST, and DuskMoonDamp and DuskSkyBoost both ship at 0.0. A stale editor -- one whose
# DLL predates the commit, which has already happened once today by five minutes -- would therefore read
# every knob as present and correct, and the whole run would measure an unchanged world with no visible
# reason. So each knob is SET to a value nothing else would produce and read back, and disagreement
# voids the run rather than producing a confident null result.
#
# WHAT WOULD FALSIFY WHAT.
#   D_NIGHT red   -> the structural argument is wrong and the approach is dead as designed. Report it.
#   D_LIVE_* red  -> the knob does nothing; every "no effect" below is a dead instrument, not a result.
#   D_REACH red   -> continuous terms cannot reach approved-night readability at any tested setting,
#                    which is the measured tradeoff the founder asked for instead of a forced solution.
#   D_REACH green -> the dense ladder is worth running, with the window and boost this job chose.
#
# Restores every knob to what it FOUND. Saves nothing. Ends play.
import math
import os

CONCURRENT = False

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "dusk_shape")

#: The data-chosen arrival standing spot: 36 m off the monument, open paved ground, proven before use.
SPOT = (-64.0, -5042.0)
SPAN = 21.0

#: Approved night, and the two hours that bracket its start. 18.50 is the first hour with TwilightBand
#: EXACTLY 0, so it is the tightest test of the structural claim rather than a comfortable one.
NIGHT_HOURS = (18.50, 19.00, 23.00)
DAY_HOURS = (12.00,)
#: 18.25 is just before the shipped caster flip at 18.2598, where the moon flood is at its worst.
#: 18.40 is mid-release, where the damp is letting the moon back and the sky boost is nearly spent.
SIZE_HOURS = (18.25, 18.40)

#: THE LEAK STRESS CASE. Shape = smoothstep(band / Window), so a NARROWER window makes Shape LARGER at
#: any given band -- 0.10 is the setting most likely to leak into a band that is nearly but not quite
#: zero. Paired with the largest damp and a boost well past anything the sizing will choose.
LEAK = {"window": 0.10, "damp": 1.0, "boost": 20.0}

#: NightSky is 7.0, so the night sky multiplier is 7x the daytime capture and a boost of 1.0 is worth
#: about +10 per cent of it at 18:25 -- not the doubling I first assumed when I guessed NightSky was
#: below 1. The sweep is scaled to that, not to my guess.
WINDOWS = (0.30, 0.60)
#: THE TOP OF THIS SWEEP IS ITSELF A RESULT. If the largest boost still falls short of the night bar,
#: "continuous terms cannot do it" and "I did not sweep far enough" are the same reading, and the first
#: is a claim about Wonderland while the second is a claim about this job. D_REACH reports which it is,
#: and 40 is included so the ceiling is somewhere implausible rather than somewhere arguable: at window
#: 0.30 and 18:25 it multiplies the sky term by about 4x, which is already past what could look right.
BOOSTS = (2.0, 5.0, 10.0, 20.0, 40.0)

AGREE = 0.010
CAM_UP, CAM_AHEAD, CAM_DROP, CAM_FOV = 900.0, (1400.0, -1400.0), -100.0, 70.0
GROUND_RECT = (0.5, 0.78, 0.30, 0.16)
FRAME_RECT = (0.5, 0.5, 0.46, 0.44)
#: THE GROUND BAND SPLIT INTO CELLS, because the founder ruled out mean luma as acceptance: "A brighter
#: mean with most traversal ground still crushed is not a pass." A mean cannot tell a floor that is
#: evenly dim from one that is half blown and half black. Four across by two deep over the band the
#: player would walk into.
GRID_COLS, GRID_ROWS = 4, 2
PAWN_CH = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2


def elevation_at(hour):
    return math.sin(((hour - 6.0) / 12.0) * math.pi) * 72.0


def band_at(elev):
    return max(0.0, min(1.0, (elev + 9.0) / SPAN))


def daylight_at(elev):
    return band_at(elev) ** 1.9


def nightfall_at(elev):
    s = 1.0 - band_at(elev)
    return s * s * (3.0 - 2.0 * s)


def shape_at(elev, window):
    x = max(0.0, min(1.0, band_at(elev) / max(window, 0.01)))
    return x * x * (3.0 - 2.0 * x)


def cells(rect, cols, rows):
    cx, cy, hw, hh = rect
    x0, y0, w, h = cx - hw, cy - hh, (2.0 * hw) / cols, (2.0 * hh) / rows
    out = []
    for r in range(rows):
        for c in range(cols):
            out.append((r, c, x0 + c * w, y0 + r * h, x0 + (c + 1) * w, y0 + (r + 1) * h))
    return out


def binary_stamp():
    """WHEN THE RUNNING CODE WAS BUILT, recorded beside every knob readback.

    Wonderland Core's suggestion, and it closes the other half of the sentinel guard. The sentinel
    proves a knob is absent; this says WHY. Without it a failure reads "the knob did nothing" and
    sends the next person looking at the C++; with it the failure reads "this binary predates the
    commit that added the knob", which is a different and much shorter investigation. It has already
    been the answer twice today -- an editor five minutes too old, then three and a half."""
    dll = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)),
                       "Binaries", "Win64", "UnrealEditor-Wonderland.dll")
    try:
        import datetime
        return {"path": dll, "built": datetime.datetime.fromtimestamp(
            os.path.getmtime(dll)).strftime("%Y-%m-%d %H:%M:%S")}
    except Exception:                                                  # noqa: BLE001
        return {"path": dll, "built": "unreadable"}


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

    def command(text):
        unreal.SystemLibrary.execute_console_command(live(), text)

    def cvar(name, value):
        command("%s %s" % (name, value))

    def read_f(name):
        try:
            return round(float(unreal.SystemLibrary.get_console_variable_float_value(name)), 5)
        except Exception:                                              # noqa: BLE001
            return None

    def bail(why):
        RESULT["status"] = "voided: " + why
        emit("VOID", "FAIL", why, {})

    def patch(rect):
        cx, cy, hw, hh = rect
        got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
        if got is None:
            return None
        mean, dark, bright, sampled = got
        d, b = float(dark), float(bright)
        return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4),
                "crushed": round(d, 4), "blown": round(b, 4),
                "readable": round(max(0.0, 1.0 - d - b), 4), "sampled": int(sampled)}

    def grid():
        out = []
        for r, c, x0, y0, x1, y1 in cells(GROUND_RECT, GRID_COLS, GRID_ROWS):
            got = L.read_screen_rect(x0, y0, x1, y1)
            if got is None:
                return None
            mean, dark, bright, sampled = got
            d, b = float(dark), float(bright)
            out.append({"row": r, "col": c,
                        "luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4),
                        "crushed": round(d, 4), "blown": round(b, 4),
                        "readable": round(max(0.0, 1.0 - d - b), 4)})
        return out

    def trace(a, b, ignore):
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                live(), a, b, PAWN_CH, False, [p for p in (ignore,) if p is not None],
                unreal.DrawDebugTrace.NONE, True,
                unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            if hit is None:
                return None
            t = hit.to_tuple()
            return {"dist": round(float(t[3]), 1), "z": round(float(t[4].z), 1)}
        except Exception:                                              # noqa: BLE001
            return None

    def lights():
        """Directional caster census and the sky light, read directly rather than predicted."""
        dirs, sky = [], None
        try:
            for actor in unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.DirectionalLight):
                comp = actor.get_component_by_class(unreal.DirectionalLightComponent)
                if comp is None:
                    continue
                label = (str(actor.get_actor_label()) if hasattr(actor, "get_actor_label")
                         else str(actor.get_name()))
                dirs.append({"label": label,
                             "intensity": round(float(comp.get_editor_property("intensity")), 5),
                             "casts": bool(comp.get_editor_property("cast_shadows"))})
            for actor in unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.SkyLight):
                comp = actor.get_component_by_class(unreal.SkyLightComponent)
                if comp is not None:
                    sky = round(float(comp.get_editor_property("intensity")), 4)
                    break
        except Exception:                                              # noqa: BLE001
            pass
        return dirs, sky

    def exposure():
        """AutoExposureBias off the grade volume itself. The founder's rule: do not infer a value
        from downstream behaviour when it can be read directly.

        TWO ROUTES AND A DISTINCT ANSWER FOR EACH FAILURE. A bare try/except returning None cannot
        tell "this world has no grade volume" from "the attribute is spelled differently on this
        engine", and the second is a broken instrument that would quietly drop criterion 3's
        evidence from every row at once."""
        try:
            vols = list(unreal.GameplayStatics.get_all_actors_of_class(
                live(), unreal.PostProcessVolume))
        except Exception:                                              # noqa: BLE001
            return "enumeration failed"
        if not vols:
            return "no grade volume in this world"
        settings = vols[0].get_editor_property("settings")
        try:
            return round(float(settings.auto_exposure_bias), 4)
        except Exception:                                              # noqa: BLE001
            pass
        try:
            return round(float(settings.get_editor_property("auto_exposure_bias")), 4)
        except Exception:                                              # noqa: BLE001
            return "auto_exposure_bias unreadable on this engine"

    def practicals():
        try:
            return str(H.describe_practical_lights(live()))
        except Exception:                                              # noqa: BLE001
            return None

    # ---------------------------------------------------------------- THE INSTRUMENT, BEFORE THE WORLD
    #
    # THE KNOBS MUST EXIST. A stale DLL reads every absent cvar as 0.0, which is exactly the shipped
    # default of two of these three, so "present and inert" and "not in this build at all" are the same
    # reading. Set each to a value nothing else would produce, read it back, restore.
    KNOBS = ("wl.Look.DuskWindow", "wl.Look.DuskMoonDamp", "wl.Look.DuskSkyBoost")
    SENTINEL = 0.4321
    found = {}
    probe = {}
    for name in KNOBS:
        found[name] = read_f(name)
        cvar(name, "%.4f" % SENTINEL)
    yield 0.5
    for name in KNOBS:
        probe[name] = read_f(name)
    for name in KNOBS:
        cvar(name, "%.5f" % (found[name] if found[name] is not None else 0.0))
    yield 0.5
    restored = {n: read_f(n) for n in KNOBS}
    RESULT["knobs"] = {"as_found": found, "sentinel_readback": probe, "restored": restored,
                       "sentinel": SENTINEL}
    RESULT["knobs"]["binary"] = binary_stamp()
    present = [n for n in KNOBS if probe.get(n) is not None and abs(probe[n] - SENTINEL) < 1e-4]
    record("D_CVARS", "all three dusk knobs exist in the RUNNING build, proven by sentinel round-trip",
           len(present) == len(KNOBS), knobs_wanted=list(KNOBS), knobs_answering=present,
           missing=[n for n in KNOBS if n not in present], as_found=found, binary=binary_stamp(), readback=probe,
           note="a cvar that does not exist reads 0.0, which is the shipped default of two of these "
                "three -- so a stale DLL would otherwise pass every readback and the run would measure "
                "an unchanged world for no visible reason. This editor was five minutes too old once "
                "already today")
    if len(present) != len(KNOBS):
        bail("the running build does not carry all three dusk knobs; it predates e486a0e0" + " (binary built %s)" % binary_stamp()["built"])
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    L.focus_game_viewport()
    cvar("wl.Sky.DayMinutes", 0)
    cvar("wl.Sky.TwilightSpan", "%.1f" % SPAN)

    # ---------------------------------------------------------------- STAND SOMEWHERE REAL, AND PROVE IT
    pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
    gz = None
    if pawn is not None:
        h = trace(unreal.Vector(SPOT[0], SPOT[1], 20000.0),
                  unreal.Vector(SPOT[0], SPOT[1], -5000.0), pawn)
        gz = h["z"] if h else None
        pawn.set_actor_location(
            unreal.Vector(SPOT[0], SPOT[1], (gz + 120.0) if gz is not None else 200.0), False, True)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(live(), 0) is not None, 120)
    command("FlushLevelStreaming")
    yield 3.0
    pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
    if pawn is None:
        bail("no pawn after the teleport")
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    where = pawn.get_actor_location()
    off = round(math.hypot(where.x - SPOT[0], where.y - SPOT[1]), 1)
    eye = unreal.Vector(where.x, where.y, where.z + CAM_UP)
    at = unreal.Vector(where.x + CAM_AHEAD[0], where.y + CAM_AHEAD[1], where.z + CAM_DROP)
    L.pose_camera(live(), eye, at, CAM_FOV)
    yield 2.0
    fwd = trace(eye, unreal.Vector(eye.x + (at.x - eye.x) * 0.02, eye.y + (at.y - eye.y) * 0.02,
                                   eye.z + (at.z - eye.z) * 0.02), pawn)
    down = trace(eye, unreal.Vector(eye.x, eye.y, eye.z - 4000.0), pawn)
    gx, gy = eye.x + (at.x - eye.x) * 0.9, eye.y + (at.y - eye.y) * 0.9
    gpatch = trace(unreal.Vector(gx, gy, eye.z), unreal.Vector(gx, gy, eye.z - 4000.0), pawn)

    # WHAT ELSE IS STANDING IN THE SHOT. The other lane's fire material now defaults on, so a dressed
    # mascot in frame emits flame and contributes to any brightness reading near it. Every arm here is
    # measured at the same camera in the same session, so a figure contaminates all arms equally and the
    # DIFFERENCES survive -- but the absolute readability target would not, so record the distance.
    near_figures = []
    try:
        for a in unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.Pawn):
            if a == pawn:
                continue
            p = a.get_actor_location()
            d = math.hypot(p.x - gx, p.y - gy)
            if d < 4000.0:
                label = (str(a.get_actor_label()) if hasattr(a, "get_actor_label")
                         else str(a.get_name()))
                near_figures.append({"label": label, "dist_to_patch_uu": round(d, 1)})
    except Exception:                                                  # noqa: BLE001
        near_figures = None
    RESULT["vantage"] = {"asked": list(SPOT),
                         "landed": [round(where.x, 1), round(where.y, 1), round(where.z, 1)],
                         "offset_uu": off, "forward_hit": fwd, "down_hit": down,
                         "ground_patch_hit": gpatch, "ground_patch_world": [round(gx, 1), round(gy, 1)],
                         "ground_rect_screen": list(GROUND_RECT),
                         "grid": [GRID_COLS, GRID_ROWS], "figures_within_40m": near_figures}
    ok_vantage = (off <= 500.0 and (not fwd or fwd["dist"] >= 400.0)
                  and down is not None and gpatch is not None)
    record("D_VALID", "the observation point is a real standing position with ground under the patch",
           ok_vantage, vantage=RESULT["vantage"],
           note="not on the monument, not a look-at target reused as a camera, not embedded in lit "
                "geometry -- the three ways this lane has produced a confident wrong answer before")
    if not ok_vantage:
        bail("the observation point could not be shown valid")
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    def settled(limit=24):
        window = []
        for _ in range(limit):
            yield 1.0
            now = patch(FRAME_RECT)
            if now is None:
                continue
            window.append(now["luma"])
            if len(window) > 3:
                window.pop(0)
            if len(window) == 3 and (max(window) - min(window)) < 0.004:
                return

    for step in settled(60):
        yield step

    # ---------------------------------------------------------------- THE READING
    rows = {}
    RESULT["readings"] = rows

    def take(key, hour, window, damp, boost, arm):
        cvar("wl.Look.DuskWindow", "%.4f" % window)
        cvar("wl.Look.DuskMoonDamp", "%.4f" % damp)
        cvar("wl.Look.DuskSkyBoost", "%.4f" % boost)
        cvar("wl.Sky.Hour", "%.4f" % hour)
        yield 1.0
        for step in settled():
            yield step
        pnow = unreal.GameplayStatics.get_player_pawn(live(), 0)
        drift = (None if pnow is None else
                 round(math.hypot(pnow.get_actor_location().x - SPOT[0],
                                  pnow.get_actor_location().y - SPOT[1]), 1))
        g1, f1, c1 = patch(GROUND_RECT), patch(FRAME_RECT), grid()
        yield 1.0
        g2, f2 = patch(GROUND_RECT), patch(FRAME_RECT)
        try:
            H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % key), 1200, 85)
        except Exception:                                              # noqa: BLE001
            pass
        if not (g1 and g2 and f1 and f2 and c1):
            rows[key] = {"hour": hour, "arm": arm, "unmeasured": True, "drift_uu": drift}
            return
        dirs, sky = lights()
        elev = elevation_at(hour)
        casters = [d["label"] for d in dirs if d["casts"]]
        cell_read = sorted(c["readable"] for c in c1)
        cell_crush = sorted(c["crushed"] for c in c1)
        mid = len(cell_read) // 2
        rows[key] = {
            "hour": hour, "arm": arm, "window": window, "damp": damp, "boost": boost,
            "drift_uu": drift,
            "knobs_held": {n: read_f(n) for n in KNOBS},
            "ground_luma": round((g1["luma"] + g2["luma"]) / 2.0, 4),
            "ground_luma_spread": round(abs(g1["luma"] - g2["luma"]), 4),
            "ground_readable": round((g1["readable"] + g2["readable"]) / 2.0, 4),
            "ground_crushed": round((g1["crushed"] + g2["crushed"]) / 2.0, 4),
            "ground_blown": round((g1["blown"] + g2["blown"]) / 2.0, 4),
            "frame_luma": round((f1["luma"] + f2["luma"]) / 2.0, 4),
            "frame_luma_spread": round(abs(f1["luma"] - f2["luma"]), 4),
            # THE DISTRIBUTION, not the mean. "A brighter mean with most traversal ground still
            # crushed is not a pass" is a statement about these, and a mean cannot express it.
            "cells": c1,
            "cell_readable_min": cell_read[0], "cell_readable_med": cell_read[mid],
            "cell_readable_max": cell_read[-1],
            "cell_crushed_max": cell_crush[-1],
            "cells_mostly_crushed": sum(1 for v in cell_crush if v > 0.5),
            "cells_total": len(cell_read),
            # STATE, READ AND NOT PREDICTED.
            "sky_intensity": sky, "exposure_bias": exposure(),
            "directional_lights": dirs, "shadow_casters": casters, "caster_count": len(casters),
            "practicals": practicals(),
            # PREDICTED, AND LABELLED AS SUCH so it is never mistaken for a reading.
            "pred_elevation": round(elev, 3), "pred_band": round(band_at(elev), 5),
            "pred_daylight": round(daylight_at(elev), 5),
            "pred_nightfall": round(nightfall_at(elev), 5),
            "pred_shape": round(shape_at(elev, window), 5)}

    # ---- APPROVED NIGHT AND NOON, inert versus the most aggressive setting the knobs allow.
    for hour in NIGHT_HOURS + DAY_HOURS:
        for arm, w, d, b in (("inert", 0.30, 0.0, 0.0),
                             ("leak", LEAK["window"], LEAK["damp"], LEAK["boost"])):
            for step in take("h%05.2f_%s" % (hour, arm), hour, w, d, b, arm):
                yield step

    # ---- SIZING, at the two hours that matter.
    for hour in SIZE_HOURS:
        for step in take("h%05.2f_base" % hour, hour, 0.30, 0.0, 0.0, "base"):
            yield step
        for step in take("h%05.2f_damponly" % hour, hour, 0.30, 1.0, 0.0, "damponly"):
            yield step
        for w in WINDOWS:
            for b in BOOSTS:
                key = "h%05.2f_w%.2f_b%04.1f" % (hour, w, b)
                for step in take(key, hour, w, 1.0, b, "cand"):
                    yield step

    for name in KNOBS:
        cvar(name, "%.5f" % (found[name] if found[name] is not None else 0.0))
    cvar("wl.Sky.Hour", 12)
    L.release_camera(live())

    # ---------------------------------------------------------------- GATES
    good = {k: v for k, v in rows.items() if not v.get("unmeasured")}
    wanted = (len(NIGHT_HOURS) + len(DAY_HOURS)) * 2 + len(SIZE_HOURS) * (2 + len(WINDOWS) * len(BOOSTS))
    record("D_MEASURED", "every arm the sweep asked for produced a reading",
           len(good) == wanted, measured=len(good), wanted=wanted,
           missing=[k for k in rows if rows[k].get("unmeasured")])
    drifted = [k for k, v in good.items() if v.get("drift_uu") is None or v["drift_uu"] > 500.0]
    record("D_STILL", "the pawn is at the spot at every reading, not just when it was placed",
           len(good) > 0 and not drifted, population=len(good), drifted=drifted)
    worst = max((max(v["ground_luma_spread"], v["frame_luma_spread"]) for v in good.values()),
                default=None)
    record("D_NOISE", "every reading agrees with itself on the luma it measures",
           len(good) > 0 and worst is not None and worst <= AGREE,
           population=len(good), worst_luma_spread=worst, tolerance=AGREE)
    if len(good) != wanted or drifted or worst is None or worst > AGREE:
        bail("readings missing, drifted, or disagreeing with themselves")
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    noise = max(worst, 0.002)

    # ---- CRITERION 4: NIGHT CONVERGES BACK TO THE APPROVED APPEARANCE.
    night_pairs = []
    for hour in NIGHT_HOURS:
        a, b = good["h%05.2f_inert" % hour], good["h%05.2f_leak" % hour]
        night_pairs.append({
            "hour": hour, "inert_ground": a["ground_luma"], "leak_ground": b["ground_luma"],
            "delta": round(b["ground_luma"] - a["ground_luma"], 4),
            "inert_sky": a["sky_intensity"], "leak_sky": b["sky_intensity"],
            "inert_readable": a["ground_readable"], "leak_readable": b["ground_readable"],
            "pred_band": a["pred_band"], "pred_shape_leak": b["pred_shape"],
            "inert_casters": a["shadow_casters"], "leak_casters": b["shadow_casters"]})
    RESULT["night_invariance"] = night_pairs
    worst_night = max((abs(p["delta"]) for p in night_pairs), default=None)
    record("D_NIGHT", "the approved night is unchanged at the most aggressive setting the knobs allow",
           len(night_pairs) == len(NIGHT_HOURS) and worst_night is not None and worst_night <= noise,
           population=len(night_pairs), worst_abs_delta=worst_night, noise_floor=noise,
           setting=LEAK, by_hour=night_pairs,
           note="GREEN: TwilightBand is exactly 0 from 18:50 down, so Shape is exactly 0 and neither "
                "term can reach these hours at any value -- criterion 4 holds structurally and not by "
                "tuning. RED: the structural argument is wrong and this approach is dead as designed")

    # ---- CRITERION 5: NOON AND DAY EFFECTIVELY UNCHANGED.
    day_pairs = []
    for hour in DAY_HOURS:
        a, b = good["h%05.2f_inert" % hour], good["h%05.2f_leak" % hour]
        day_pairs.append({"hour": hour, "inert_ground": a["ground_luma"], "leak_ground": b["ground_luma"],
                          "delta": round(b["ground_luma"] - a["ground_luma"], 4),
                          "inert_sky": a["sky_intensity"], "leak_sky": b["sky_intensity"]})
    RESULT["day_invariance"] = day_pairs
    worst_day = max((abs(p["delta"]) for p in day_pairs), default=None)
    record("D_NOON", "noon is unchanged at the most aggressive setting the knobs allow",
           len(day_pairs) == len(DAY_HOURS) and worst_day is not None and worst_day <= noise,
           population=len(day_pairs), worst_abs_delta=worst_day, noise_floor=noise, by_hour=day_pairs)

    # ---- CRITERION 3: NO NEW COMPENSATING BRIGHTNESS SPIKE, at the mechanism rather than the result.
    #
    # Neither knob touches AutoExposureBias -- it is Lerp(1.45, -0.9, Daylight) and nothing here
    # changes Daylight. So the two arms at a given hour MUST report the same exposure, and if they do
    # not, something is compensating and every brightness comparison in this job is between two
    # different exposures. Read off the grade volume, not inferred from how bright the picture looks.
    exp_pairs, exp_bad = [], []
    for hour in NIGHT_HOURS + DAY_HOURS:
        a, b = good["h%05.2f_inert" % hour], good["h%05.2f_leak" % hour]
        row = {"hour": hour, "inert": a["exposure_bias"], "leak": b["exposure_bias"]}
        exp_pairs.append(row)
        numeric = all(isinstance(v, float) for v in (a["exposure_bias"], b["exposure_bias"]))
        if not numeric or abs(a["exposure_bias"] - b["exposure_bias"]) > 1e-3:
            exp_bad.append(row)
    RESULT["exposure_pairs"] = exp_pairs
    readable_exposure = [r for r in exp_pairs if isinstance(r["inert"], float)]
    record("D_EXPOSURE", "the knobs move light, not exposure -- both arms grade identically at every "
                         "hour",
           len(readable_exposure) == len(exp_pairs) and len(exp_pairs) > 0 and not exp_bad,
           population=len(exp_pairs), readable=len(readable_exposure), mismatched=exp_bad,
           by_hour=exp_pairs,
           note="a non-numeric reading here is a BROKEN INSTRUMENT, not a pass: it means criterion 3 "
                "has no evidence in this run rather than that exposure held still")

    # ---- AND THE QUESTION S01 HAS NEVER BEEN IN A POSITION TO ASK.
    #
    # zc_shadows counts shadow casters once, right after begin play, which is daytime. The day cycle
    # writes only the MOON's cast_shadows; the sun's comes from the map and is never cleared. So
    # whether Wonderland has exactly one directional caster AT NIGHT has not been observed. Every row
    # here carries its own census, so this is a free answer rather than a new experiment.
    census = {}
    for key, v in sorted(good.items()):
        census[key] = {"hour": v["hour"], "arm": v["arm"], "casters": v["shadow_casters"],
                       "count": v["caster_count"],
                       "intensities": {d["label"]: d["intensity"] for d in v["directional_lights"]}}
    RESULT["caster_census"] = census
    counts = sorted(set(v["count"] for v in census.values()))
    record("S01_NIGHT", "exactly one directional light casts a shadow at EVERY hour measured here, "
                        "night included",
           len(census) > 0 and counts == [1], population=len(census),
           distinct_caster_counts=counts,
           hours_with_more_than_one=sorted(set(v["hour"] for v in census.values()
                                               if v["count"] > 1)),
           note="OBSERVATIONAL, not a new requirement. zc_shadows S01 samples only after begin play, "
                "which is daytime, so a RED here is a long-standing fact this job is the first to be "
                "in a position to see -- not a regression caused by these knobs. Reported either way")

    # ---- THE CONTROLS. A negative result below is evidence only if the positive case was reachable.
    damp_moves, boost_moves = [], []
    for hour in SIZE_HOURS:
        base = good["h%05.2f_base" % hour]
        damponly = good["h%05.2f_damponly" % hour]
        damp_moves.append({"hour": hour, "delta": round(damponly["ground_luma"] - base["ground_luma"], 4),
                           "base_sky": base["sky_intensity"], "damp_sky": damponly["sky_intensity"],
                           "base_moon": [d for d in base["directional_lights"] if "Moon" in d["label"]],
                           "damp_moon": [d for d in damponly["directional_lights"]
                                         if "Moon" in d["label"]]})
        for w in WINDOWS:
            lo = good["h%05.2f_w%.2f_b%04.1f" % (hour, w, BOOSTS[0])]
            hi = good["h%05.2f_w%.2f_b%04.1f" % (hour, w, BOOSTS[-1])]
            boost_moves.append({"hour": hour, "window": w,
                                "delta_lowest_to_highest_boost":
                                    round(hi["ground_luma"] - lo["ground_luma"], 4),
                                "sky_lowest": lo["sky_intensity"], "sky_highest": hi["sky_intensity"]})
    RESULT["controls"] = {"damp": damp_moves, "boost": boost_moves}
    big_damp = max((abs(p["delta"]) for p in damp_moves), default=0.0)
    big_boost = max((abs(p["delta_lowest_to_highest_boost"]) for p in boost_moves), default=0.0)
    floor = max(4.0 * noise, 0.005)
    record("D_LIVE_DAMP", "DuskMoonDamp actually changes the picture, so a null result below would mean "
                          "something", len(damp_moves) > 0 and big_damp > floor,
           population=len(damp_moves), largest_effect=big_damp, floor=floor, by_hour=damp_moves,
           note="this is the arm that removes the moon flood. If it moves nothing, the knob is dead and "
                "every reading in the sizing sweep is a measurement of an unchanged world")
    record("D_LIVE_BOOST", "DuskSkyBoost actually changes the picture across its swept range",
           len(boost_moves) > 0 and big_boost > floor,
           population=len(boost_moves), largest_effect=big_boost, floor=floor, by_window=boost_moves)

    # ---- CAN A CONTINUOUS TERM REACH THE APPROVED NIGHT'S OWN READABILITY?
    #
    # The bar is the approved night measured in this same run at this same camera -- the WORST of the
    # three night hours, so the target is the easiest version of "as readable as the night the founder
    # accepted" rather than a flattering one.
    night_read = min(good["h%05.2f_inert" % h]["ground_readable"] for h in NIGHT_HOURS)
    night_crush = max(good["h%05.2f_inert" % h]["ground_crushed"] for h in NIGHT_HOURS)
    night_cells_crushed = max(good["h%05.2f_inert" % h]["cells_mostly_crushed"] for h in NIGHT_HOURS)
    RESULT["night_reference"] = {"readable": night_read, "crushed": night_crush,
                                 "cells_mostly_crushed": night_cells_crushed,
                                 "cells_total": good["h%05.2f_inert" % NIGHT_HOURS[0]]["cells_total"],
                                 "from_hours": list(NIGHT_HOURS),
                                 "note": "worst of the three approved-night hours at this camera"}
    table = []
    for hour in SIZE_HOURS:
        for w in WINDOWS:
            for b in BOOSTS:
                r = good["h%05.2f_w%.2f_b%04.1f" % (hour, w, b)]
                ok = (r["ground_readable"] >= night_read
                      and r["ground_crushed"] <= night_crush
                      and r["cells_mostly_crushed"] <= night_cells_crushed)
                row = {"hour": hour, "window": w, "boost": b,
                       "ground_luma": r["ground_luma"], "readable": r["ground_readable"],
                       "crushed": r["ground_crushed"],
                       "cell_readable_med": r["cell_readable_med"],
                       "cell_readable_min": r["cell_readable_min"],
                       "cells_mostly_crushed": r["cells_mostly_crushed"],
                       "sky_intensity": r["sky_intensity"], "exposure_bias": r["exposure_bias"],
                       "casters": r["shadow_casters"], "meets_night_bar": ok}
                table.append(row)
    RESULT["sizing"] = table

    # THE CHEAPEST SETTING THAT CLEARS THE BAR AT BOTH HOURS, not the brightest one that clears it.
    by_setting = {}
    for row in table:
        by_setting.setdefault((row["window"], row["boost"]), []).append(row)
    clears_both = [k for k, v in by_setting.items()
                   if len(v) == len(SIZE_HOURS) and all(r["meets_night_bar"] for r in v)]
    choice = min(clears_both, key=lambda k: (k[1], -k[0])) if clears_both else None
    RESULT["candidate"] = ({"window": choice[0], "boost": choice[1], "damp": 1.0}
                           if choice else None)

    # IS A RED HERE A FACT ABOUT WONDERLAND OR ABOUT THIS SWEEP? If the LARGEST boost tested still
    # falls short, the sweep hit its own ceiling and the honest finding is "not within the range
    # tested" -- which is a different sentence from "continuous terms cannot carry dusk", and only one
    # of them is about the world. Reported explicitly so the distinction cannot quietly collapse.
    top = BOOSTS[-1]
    at_ceiling = {}
    for w in WINDOWS:
        rows_top = [r for r in table if r["window"] == w and r["boost"] == top]
        at_ceiling["window_%.2f" % w] = {
            "boost": top, "population": len(rows_top),
            "cleared_every_hour": bool(rows_top) and all(r["meets_night_bar"] for r in rows_top),
            "shortfall_by_hour": {("%.2f" % r["hour"]):
                                  round(night_read - r["readable"], 4) for r in rows_top}}
    ceiling_limited = (choice is None
                       and not any(v["cleared_every_hour"] for v in at_ceiling.values()))
    RESULT["sweep_ceiling"] = {"largest_boost_tested": top, "by_window": at_ceiling,
                               "limited_by_sweep_not_by_world": ceiling_limited}

    record("D_REACH", "a continuous sky term reaches the approved night's own ground readability at "
                      "both dusk hours",
           choice is not None, population=len(table),
           night_bar={"readable_at_least": night_read, "crushed_at_most": night_crush,
                      "cells_mostly_crushed_at_most": night_cells_crushed},
           settings_clearing_both=[{"window": k[0], "boost": k[1]} for k in clears_both],
           chosen=RESULT["candidate"], sweep_ceiling=RESULT["sweep_ceiling"],
           conclusion=("a setting reaches the bar" if choice else
                       ("NOT WITHIN THE RANGE TESTED -- the largest boost swept still falls short, so "
                        "this run bounds the answer rather than settling it" if ceiling_limited else
                        "no single setting clears BOTH hours, though some clear one")),
           full_table=table,
           note="GREEN: the dense ladder is worth running at the chosen setting. RED is NOT a failed "
                "job -- it is the measured tradeoff the founder asked for in place of a forced "
                "solution. But read `conclusion` before reporting it: a red because the sweep ran out "
                "of room is a fact about this job, and a red with headroom left is a fact about "
                "Wonderland. Only the second one answers the founder's question")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
