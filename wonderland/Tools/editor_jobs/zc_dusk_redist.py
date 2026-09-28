# THE DUSK VERDICT LADDER. Baseline, redistribution and approved night, densely across the caster flip.
#
# FOUNDER, verbatim on what to measure: "Measure densely across the caster boundary, including
# approximately: 18:00 18:10 18:20 18:24 18:25 18:26 18:27 18:30 18:40 18:50 19:00. For every rung
# record: ground luminance distribution, readable-ground fraction, crushed-ground fraction, moon
# contribution, sky/ambient contribution where measurable, practical contribution where measurable,
# shadow-caster identity, exposure state." And on how to judge: "Do not choose the candidate because a
# scalar score improves. Look at the actual world."
#
# So every rung is captured to JPEG as well as measured, and the gates below are the seven acceptance
# criteria rather than a score.
#
# THE CANDIDATE IS NOT CHOSEN HERE. zc_dusk_shape sizes it against the approved night's own readability
# and this job tests the choice; CANDIDATE below is transcribed from that job's D_REACH and is stated
# as a constant so the setting under test is visible in the diff rather than inherited silently from a
# file on disk.
#
# EVERY CONTRIBUTION IS A PAIRED DIFFERENCE IN THIS RUN, not a reading of a knob:
#
#   base   - damp            what the moon flood was worth (the thing being taken away)
#   cand   - damp            what the sky boost is worth (the thing replacing it)
#   cand   - cand_moonoff    what the moon still contributes under the candidate
#   cand   - cand_pracoff    what the practicals contribute under the candidate
#
# Same camera, same session, same exposure, consecutive. Not a comparison between jobs or locations.
#
# WHAT WOULD FALSIFY THE CANDIDATE. Any of C1-C7 red. C1 and C6 are the ones that matter most and they
# pull against each other: damping the moon MOVES the caster flip rather than removing it, so a
# candidate can shrink the 18:25 cliff and pay for it with a new one at 18:33. Both are measured over
# the same ladder so neither can hide behind the other.
#
# Restores every knob to what it FOUND. Saves nothing. Ends play.
import math
import os

CONCURRENT = False

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "dusk_redist")

SPOT = (-64.0, -5042.0)
SPAN = 21.0

#: TRANSCRIBED FROM zc_dusk_shape D_REACH. Placeholder until that job has run; the run is voided if it
#: still reads the placeholder, so this cannot be measured by accident.
CANDIDATE = {"window": None, "boost": None, "damp": 1.0}

#: The founder's hours, plus midnight and noon for the preservation criteria.
DUSK_HOURS = (18.00, 18.10, 18.20, 18.24, 18.25, 18.26, 18.27, 18.30, 18.40, 18.50, 19.00)
NIGHT_HOURS = (23.00,)
DAY_HOURS = (12.00,)

AGREE = 0.010
CAM_UP, CAM_AHEAD, CAM_DROP, CAM_FOV = 900.0, (1400.0, -1400.0), -100.0, 70.0
GROUND_RECT = (0.5, 0.78, 0.30, 0.16)
FRAME_RECT = (0.5, 0.5, 0.46, 0.44)
GRID_COLS, GRID_ROWS = 4, 2
PAWN_CH = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2

#: "An ordinary natural transition" made testable: no single step across the evening may dominate the
#: others. A perfectly smooth ramp has max/median close to 1; the shipped evening has a step that is
#: the whole collapse in one rung.
ORDINARY = 2.5
#: The 18:25 -> 18:27 cliff must shrink by at least this much to count as removed rather than nudged.
CLIFF_FACTOR = 4.0


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
    x = max(0.0, min(1.0, band_at(elev) / max(window or 0.30, 0.01)))
    return x * x * (3.0 - 2.0 * x)


def cells(rect, cols, rows):
    cx, cy, hw, hh = rect
    x0, y0, w, h = cx - hw, cy - hh, (2.0 * hw) / cols, (2.0 * hh) / rows
    out = []
    for r in range(rows):
        for c in range(cols):
            out.append((r, c, x0 + c * w, y0 + r * h, x0 + (c + 1) * w, y0 + (r + 1) * h))
    return out


def median(xs):
    s = sorted(xs)
    if not s:
        return None
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2.0


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

    def bail(why):
        RESULT["status"] = "voided: " + why
        emit("VOID", "FAIL", why, {})

    # THE PLACEHOLDER GUARD, before PIE is even started. A run that measures window=None would set the
    # cvar to the string "None", which the console ignores, leaving the previous value in place -- and
    # the job would then report a confident verdict about whatever setting happened to be resident.
    if CANDIDATE.get("window") is None or CANDIDATE.get("boost") is None:
        record("C_CANDIDATE", "the candidate setting has been transcribed from zc_dusk_shape",
               False, candidate=CANDIDATE,
               note="still the placeholder. Run zc_dusk_shape first and copy its D_REACH choice into "
                    "CANDIDATE. Setting a cvar to the string None silently leaves the resident value, "
                    "so this would otherwise produce a confident verdict about an unknown setting")
        bail("CANDIDATE is still the placeholder; zc_dusk_shape has not chosen one yet")
        return
    record("C_CANDIDATE", "the candidate setting has been transcribed from zc_dusk_shape",
           True, candidate=CANDIDATE)

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

    def practical_field(line, key):
        """Pull one number out of the subsystem's own status line.

        The line is printed by DescribePracticals as
            defined=%d active=%d pool=%d night=%.3f gain=%.2f count=%d radius=%.0f file=%s problem=%s
        so `gain` read back from it is the value the SUBSYSTEM holds, not the value the console was
        told. That distinction is the whole point: it is the difference between checking an input and
        checking that the input arrived."""
        if not line:
            return None
        for part in str(line).split():
            if part.startswith(key + "="):
                try:
                    return float(part.split("=", 1)[1])
                except ValueError:
                    return None
        return None

    # ---------------------------------------------------------------- THE INSTRUMENT, FIRST
    KNOBS = ("wl.Look.DuskWindow", "wl.Look.DuskMoonDamp", "wl.Look.DuskSkyBoost",
             "wl.Sky.MoonGain", "wl.Look.PracticalGain")
    SENTINEL = 0.4321
    found, probe = {}, {}
    for name in KNOBS:
        found[name] = read_f(name)
        cvar(name, "%.4f" % SENTINEL)
    yield 0.5
    for name in KNOBS:
        probe[name] = read_f(name)
    for name in KNOBS:
        cvar(name, "%.5f" % (found[name] if found[name] is not None else 0.0))
    yield 0.5
    RESULT["knobs"] = {"as_found": found, "sentinel_readback": probe, "sentinel": SENTINEL}
    RESULT["knobs"]["binary"] = binary_stamp()
    present = [n for n in KNOBS if probe.get(n) is not None and abs(probe[n] - SENTINEL) < 1e-4]
    record("C_CVARS", "every knob this job turns exists in the RUNNING build, by sentinel round-trip",
           len(present) == len(KNOBS), knobs_wanted=list(KNOBS), knobs_answering=present,
           missing=[n for n in KNOBS if n not in present], as_found=found, binary=binary_stamp(),
           note="a cvar that does not exist reads 0.0, which is the shipped default of two of these. "
                "A stale DLL would otherwise pass every readback and this job would publish a verdict "
                "about a world where neither knob exists")
    if len(present) != len(KNOBS):
        bail("the running build does not carry every knob this job turns" + " (binary built %s)" % binary_stamp()["built"])
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    L.focus_game_viewport()
    cvar("wl.Sky.DayMinutes", 0)
    cvar("wl.Sky.TwilightSpan", "%.1f" % SPAN)

    # ---------------------------------------------------------------- STAND SOMEWHERE REAL
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
                         "ground_rect_screen": list(GROUND_RECT), "grid": [GRID_COLS, GRID_ROWS],
                         "figures_within_40m": near_figures}
    ok_vantage = (off <= 500.0 and (not fwd or fwd["dist"] >= 400.0)
                  and down is not None and gpatch is not None)
    record("C_VALID", "the observation point is a real standing position with ground under the patch",
           ok_vantage, vantage=RESULT["vantage"])
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

    rows = {}
    RESULT["readings"] = rows
    W, B, D = CANDIDATE["window"], CANDIDATE["boost"], CANDIDATE["damp"]
    MOON0 = found["wl.Sky.MoonGain"] if found["wl.Sky.MoonGain"] is not None else 0.05
    PRAC0 = found["wl.Look.PracticalGain"] if found["wl.Look.PracticalGain"] is not None else 1.0

    #: arm -> (window, damp, boost, moon_gain, practical_gain)
    ARMS = (
        ("base",         (W, 0.0, 0.0, MOON0, PRAC0)),
        ("damp",         (W, D,   0.0, MOON0, PRAC0)),
        ("cand",         (W, D,   B,   MOON0, PRAC0)),
        ("cand_moonoff", (W, D,   B,   0.0,   PRAC0)),
        ("cand_pracoff", (W, D,   B,   MOON0, 0.0)),
    )

    def take(key, hour, arm, setting):
        w, d, b, mg, pg = setting
        cvar("wl.Look.DuskWindow", "%.4f" % w)
        cvar("wl.Look.DuskMoonDamp", "%.4f" % d)
        cvar("wl.Look.DuskSkyBoost", "%.4f" % b)
        cvar("wl.Sky.MoonGain", "%.5f" % mg)
        cvar("wl.Look.PracticalGain", "%.5f" % pg)
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
            H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % key), 1400, 88)
        except Exception:                                              # noqa: BLE001
            pass
        if not (g1 and g2 and f1 and f2 and c1):
            rows[key] = {"hour": hour, "arm": arm, "unmeasured": True, "drift_uu": drift}
            return
        dirs, sky = lights()
        elev = elevation_at(hour)
        cr = sorted(c["readable"] for c in c1)
        cc = sorted(c["crushed"] for c in c1)
        rows[key] = {
            "hour": hour, "arm": arm, "drift_uu": drift,
            "knobs_held": {n: read_f(n) for n in KNOBS},
            "ground_luma": round((g1["luma"] + g2["luma"]) / 2.0, 4),
            "ground_luma_spread": round(abs(g1["luma"] - g2["luma"]), 4),
            "ground_readable": round((g1["readable"] + g2["readable"]) / 2.0, 4),
            "ground_crushed": round((g1["crushed"] + g2["crushed"]) / 2.0, 4),
            "ground_blown": round((g1["blown"] + g2["blown"]) / 2.0, 4),
            "frame_luma": round((f1["luma"] + f2["luma"]) / 2.0, 4),
            "frame_luma_spread": round(abs(f1["luma"] - f2["luma"]), 4),
            "cells": c1,
            "cell_readable_min": cr[0], "cell_readable_med": median(cr), "cell_readable_max": cr[-1],
            "cell_crushed_max": cc[-1], "cells_mostly_crushed": sum(1 for v in cc if v > 0.5),
            "cells_total": len(cr),
            "sky_intensity": sky, "exposure_bias": exposure(),
            "directional_lights": dirs,
            "shadow_casters": [d2["label"] for d2 in dirs if d2["casts"]],
            "caster_count": sum(1 for d2 in dirs if d2["casts"]),
            "moon_casting": any(d2["casts"] and "Moon" in d2["label"] for d2 in dirs),
            "practicals": practicals(),
            "pred_elevation": round(elev, 3), "pred_band": round(band_at(elev), 5),
            "pred_daylight": round(daylight_at(elev), 5),
            "pred_nightfall": round(nightfall_at(elev), 5),
            "pred_shape": round(shape_at(elev, w), 5)}

    # ---- THE LADDER.
    for hour in DUSK_HOURS:
        for arm, setting in ARMS:
            for step in take("h%05.2f_%s" % (hour, arm), hour, arm, setting):
                yield step
    # ---- PRESERVATION, inert versus the candidate.
    for hour in NIGHT_HOURS + DAY_HOURS:
        for arm, setting in (("base", (W, 0.0, 0.0, MOON0, PRAC0)),
                             ("cand", (W, D, B, MOON0, PRAC0))):
            for step in take("h%05.2f_%s" % (hour, arm), hour, arm, setting):
                yield step

    for name in KNOBS:
        cvar(name, "%.5f" % (found[name] if found[name] is not None else 0.0))
    cvar("wl.Sky.Hour", 12)
    L.release_camera(live())

    # ---------------------------------------------------------------- GATES
    good = {k: v for k, v in rows.items() if not v.get("unmeasured")}
    wanted = len(DUSK_HOURS) * len(ARMS) + (len(NIGHT_HOURS) + len(DAY_HOURS)) * 2
    record("C_MEASURED", "every arm the ladder asked for produced a reading",
           len(good) == wanted, measured=len(good), wanted=wanted,
           missing=[k for k in rows if rows[k].get("unmeasured")])
    drifted = [k for k, v in good.items() if v.get("drift_uu") is None or v["drift_uu"] > 500.0]
    record("C_STILL", "the pawn is at the spot at every reading",
           len(good) > 0 and not drifted, population=len(good), drifted=drifted)
    worst = max((max(v["ground_luma_spread"], v["frame_luma_spread"]) for v in good.values()),
                default=None)
    record("C_NOISE", "every reading agrees with itself on the luma it measures",
           len(good) > 0 and worst is not None and worst <= AGREE,
           population=len(good), worst_luma_spread=worst, tolerance=AGREE)
    if len(good) != wanted or drifted or worst is None or worst > AGREE:
        bail("readings missing, drifted, or disagreeing with themselves")
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    noise = max(worst, 0.002)

    def g(hour, arm):
        return good["h%05.2f_%s" % (hour, arm)]

    # ---- THE DECOMPOSITION THE FOUNDER ASKED FOR, every term a paired difference in this run.
    decomp = []
    for hour in DUSK_HOURS:
        base, damp, cand = g(hour, "base"), g(hour, "damp"), g(hour, "cand")
        moonoff, pracoff = g(hour, "cand_moonoff"), g(hour, "cand_pracoff")
        decomp.append({
            "hour": hour,
            "base_ground": base["ground_luma"], "cand_ground": cand["ground_luma"],
            "base_readable": base["ground_readable"], "cand_readable": cand["ground_readable"],
            "base_crushed": base["ground_crushed"], "cand_crushed": cand["ground_crushed"],
            "base_cells_mostly_crushed": base["cells_mostly_crushed"],
            "cand_cells_mostly_crushed": cand["cells_mostly_crushed"],
            "cand_cell_readable_min": cand["cell_readable_min"],
            "cand_cell_readable_med": cand["cell_readable_med"],
            "moon_flood_removed": round(base["ground_luma"] - damp["ground_luma"], 4),
            "sky_boost_gave": round(cand["ground_luma"] - damp["ground_luma"], 4),
            "moon_still_contributes": round(cand["ground_luma"] - moonoff["ground_luma"], 4),
            "practicals_contribute": round(cand["ground_luma"] - pracoff["ground_luma"], 4),
            "base_sky_intensity": base["sky_intensity"], "cand_sky_intensity": cand["sky_intensity"],
            "base_casters": base["shadow_casters"], "cand_casters": cand["shadow_casters"],
            "base_moon_casting": base["moon_casting"], "cand_moon_casting": cand["moon_casting"],
            "exposure_bias": cand["exposure_bias"]})
    RESULT["decomposition"] = decomp

    # ---- THE CONTROLS, before any negative result below may be read as evidence.
    biggest_damp = max(abs(d["moon_flood_removed"]) for d in decomp)
    biggest_sky = max(abs(d["sky_boost_gave"]) for d in decomp)
    biggest_prac = max(abs(d["practicals_contribute"]) for d in decomp)
    floor = max(4.0 * noise, 0.005)
    record("C_LIVE", "both knobs move the picture somewhere on this ladder, so a null below means "
                     "something",
           len(decomp) > 0 and biggest_damp > floor and biggest_sky > floor,
           population=len(decomp), moon_flood_largest=biggest_damp, sky_boost_largest=biggest_sky,
           practicals_largest=biggest_prac, floor=floor)

    # ---- AND THE PRACTICAL ARM CHECKED AT THE SUBJECT, not at the picture.
    #
    # "The practicals contribute nothing at this camera" and "PracticalGain never reached the
    # subsystem" produce the same 0.0000 in the decomposition, and only the first is a fact about the
    # arrival. The subsystem publishes its own gain, so this reads it back from BOTH arms instead of
    # inferring liveness from whether the ground changed -- which is the same mistake as trusting a
    # cvar readback to prove a knob shipped.
    prac_rows, prac_dead = [], []
    for hour in DUSK_HOURS:
        on = practical_field(g(hour, "cand")["practicals"], "gain")
        off = practical_field(g(hour, "cand_pracoff")["practicals"], "gain")
        row = {"hour": hour, "gain_cand": on, "gain_pracoff": off,
               "active_cand": practical_field(g(hour, "cand")["practicals"], "active"),
               "active_pracoff": practical_field(g(hour, "cand_pracoff")["practicals"], "active"),
               "ground_delta": next(d["practicals_contribute"] for d in decomp if d["hour"] == hour)}
        prac_rows.append(row)
        if on is None or off is None or not (on > 0.0 and off == 0.0):
            prac_dead.append(row)
    RESULT["practical_switch"] = prac_rows
    record("C_PRAC_SWITCH", "the practical arm actually reaches the subsystem, so a zero contribution "
                            "means the practicals are dark here and not that the switch is dead",
           len(prac_rows) > 0 and not prac_dead, population=len(prac_rows), problems=prac_dead,
           by_hour=prac_rows,
           note="gain is read back from the subsystem's OWN status line, not from the console. "
                "GREEN plus a zero practicals_contribute is a real fact about this camera. RED means "
                "every practical figure in the decomposition is uninterpretable")

    # ---- C1: THE 18:25 -> 18:27 CLIFF.
    b_cliff = abs(g(18.27, "base")["ground_luma"] - g(18.25, "base")["ground_luma"])
    c_cliff = abs(g(18.27, "cand")["ground_luma"] - g(18.25, "cand")["ground_luma"])
    shrink = (b_cliff / c_cliff) if c_cliff > 1e-6 else None
    RESULT["cliff"] = {"baseline": round(b_cliff, 4), "candidate": round(c_cliff, 4),
                       "shrink_factor": (round(shrink, 1) if shrink else "candidate step below noise"),
                       "required": CLIFF_FACTOR, "noise": noise}
    record("C1_CLIFF", "the 18:25 to 18:27 cliff is removed or reduced to an ordinary transition",
           b_cliff > noise and (c_cliff <= noise or (shrink is not None and shrink >= CLIFF_FACTOR)),
           baseline_step=round(b_cliff, 4), candidate_step=round(c_cliff, 4),
           shrink_factor=(round(shrink, 1) if shrink else None), required=CLIFF_FACTOR,
           noise_floor=noise,
           note="the baseline step must itself exceed noise or there is no cliff here to remove and "
                "this gate would pass vacuously on a world that never had the fault")

    # ---- C2: READABLE BEFORE THE MOON BECOMES THE CASTER.
    night_read = g(23.00, "base")["ground_readable"]
    night_crush = g(23.00, "base")["ground_crushed"]
    night_cells = g(23.00, "base")["cells_mostly_crushed"]
    RESULT["night_reference"] = {"readable": night_read, "crushed": night_crush,
                                 "cells_mostly_crushed": night_cells,
                                 "from_hour": 23.00, "arm": "base",
                                 "note": "the approved night at this camera in this run"}
    pre = [d for d in decomp if not d["cand_moon_casting"]]
    weak = [d for d in pre if not (d["cand_readable"] >= night_read
                                   and d["cand_cells_mostly_crushed"] <= night_cells)]
    record("C2_READABLE", "dusk traversal is at least as readable as the approved night BEFORE the "
                          "moon becomes the shadow caster",
           len(pre) > 0 and not weak, population=len(pre),
           night_bar={"readable_at_least": night_read, "cells_mostly_crushed_at_most": night_cells},
           hours_before_flip=[d["hour"] for d in pre], failing=weak,
           note="the flip is READ from the caster census per rung, not predicted from the curve, "
                "because damping the moon moves it. An empty population here would mean the moon "
                "casts at every dusk hour measured, which is a different world than the one assumed")

    # ---- C3: NO NEW COMPENSATING BRIGHTNESS SPIKE.
    base_peak = max(d["base_ground"] for d in decomp)
    cand_peak = max(d["cand_ground"] for d in decomp)
    exp_bad = [d for d in decomp if not isinstance(d["exposure_bias"], float)]
    for hour in DUSK_HOURS:
        a, b = g(hour, "base")["exposure_bias"], g(hour, "cand")["exposure_bias"]
        if isinstance(a, float) and isinstance(b, float) and abs(a - b) > 1e-3:
            exp_bad.append({"hour": hour, "base": a, "cand": b})
    record("C3_NO_SPIKE", "the candidate adds no brightness peak the baseline did not already have, "
                          "and moves light rather than exposure",
           len(decomp) > 0 and cand_peak <= base_peak + noise and not exp_bad,
           population=len(decomp), baseline_peak=round(base_peak, 4),
           candidate_peak=round(cand_peak, 4), noise_floor=noise, exposure_problems=exp_bad,
           note="a non-numeric exposure reading is a broken instrument, not a pass")

    # ---- C4 and C5: NIGHT AND NOON PRESERVED.
    keep = []
    for hour in NIGHT_HOURS + DAY_HOURS:
        a, b = g(hour, "base"), g(hour, "cand")
        keep.append({"hour": hour, "base_ground": a["ground_luma"], "cand_ground": b["ground_luma"],
                     "delta": round(b["ground_luma"] - a["ground_luma"], 4),
                     "base_sky": a["sky_intensity"], "cand_sky": b["sky_intensity"],
                     "base_readable": a["ground_readable"], "cand_readable": b["ground_readable"],
                     "pred_band": a["pred_band"]})
    RESULT["preservation"] = keep
    worst_keep = max(abs(k["delta"]) for k in keep)
    record("C4_C5_PRESERVED", "the approved night and noon are unchanged under the candidate",
           len(keep) == len(NIGHT_HOURS) + len(DAY_HOURS) and worst_keep <= noise,
           population=len(keep), worst_abs_delta=worst_keep, noise_floor=noise, by_hour=keep)

    # ---- C6: NO SECOND DISCONTINUITY ANYWHERE IN THE EVENING.
    #
    # The one that pulls against C1. Damping the moon MOVES the caster flip rather than removing it,
    # so a candidate can shrink the 18:25 cliff and pay for it with a new one at 18:33.
    def steps(arm):
        seq = [g(h, arm)["ground_luma"] for h in DUSK_HOURS]
        return [round(abs(seq[i + 1] - seq[i]), 4) for i in range(len(seq) - 1)]

    b_steps, c_steps = steps("base"), steps("cand")
    b_med, c_med = median(b_steps), median(c_steps)
    b_ratio = (max(b_steps) / b_med) if b_med and b_med > 1e-6 else None
    c_ratio = (max(c_steps) / c_med) if c_med and c_med > 1e-6 else None
    pairs = ["%.2f->%.2f" % (DUSK_HOURS[i], DUSK_HOURS[i + 1]) for i in range(len(DUSK_HOURS) - 1)]
    RESULT["step_profile"] = {
        "hours": list(DUSK_HOURS), "between": pairs,
        "baseline_steps": dict(zip(pairs, b_steps)), "candidate_steps": dict(zip(pairs, c_steps)),
        "baseline_max_over_median": (round(b_ratio, 2) if b_ratio else None),
        "candidate_max_over_median": (round(c_ratio, 2) if c_ratio else None),
        "baseline_worst_at": pairs[b_steps.index(max(b_steps))],
        "candidate_worst_at": pairs[c_steps.index(max(c_steps))],
        "ordinary_threshold": ORDINARY}
    record("C6_NO_SECOND_CLIFF", "no single step in the evening dominates the others -- the "
                                 "transition is ordinary everywhere, not just at 18:25",
           c_ratio is not None and c_ratio <= ORDINARY and max(c_steps) <= max(b_steps) + noise,
           population=len(c_steps), candidate_max_over_median=(round(c_ratio, 2) if c_ratio else None),
           baseline_max_over_median=(round(b_ratio, 2) if b_ratio else None),
           threshold=ORDINARY, candidate_worst_step=max(c_steps),
           candidate_worst_at=pairs[c_steps.index(max(c_steps))],
           baseline_worst_step=max(b_steps), baseline_worst_at=pairs[b_steps.index(max(b_steps))],
           candidate_steps=dict(zip(pairs, c_steps)),
           note="this is the gate C1 can be bought at the expense of. Damping the moon MOVES the "
                "caster flip rather than removing it, so a candidate that shrinks the 18:25 cliff and "
                "opens one at 18:33 passes C1 and must fail here")

    # ---- THE ONE S01 HAS NEVER BEEN IN A POSITION TO ASK.
    census = {k: {"hour": v["hour"], "arm": v["arm"], "casters": v["shadow_casters"],
                  "count": v["caster_count"]} for k, v in sorted(good.items())}
    RESULT["caster_census"] = census
    counts = sorted(set(v["count"] for v in census.values()))
    record("S01_NIGHT", "exactly one directional light casts at every hour measured, night included",
           len(census) > 0 and counts == [1], population=len(census), distinct_counts=counts,
           hours_with_more_than_one=sorted(set(v["hour"] for v in census.values() if v["count"] > 1)),
           note="OBSERVATIONAL. zc_shadows S01 samples only after begin play, which is daytime, so a "
                "red here is a long-standing fact this is among the first jobs in a position to see "
                "-- not a regression from these knobs. The base arm answers it for the shipped world")

    # ---- C7 IS NOT A GATE. Every rung is captured; the founder's instruction is to look at the world,
    # ---- and a job cannot green-light its own screenshots.
    RESULT["captures"] = ROOT
    RESULT["verdict_needs_eyes"] = (
        "C7 -- rendered evidence agrees with numerical evidence -- is deliberately not gated here. "
        "Every rung is in %s as base/damp/cand/cand_moonoff/cand_pracoff. The numbers above are not "
        "the verdict; they say which frames to look at first." % ROOT)
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
