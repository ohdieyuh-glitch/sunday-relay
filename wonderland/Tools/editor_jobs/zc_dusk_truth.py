# DOES THE DUSK CLIFF EXIST AT ALL? The shipped world, across the founder's hours, from valid ground.
#
# WHY THIS JOB EXISTS. Every measurement that established the dusk problem was taken from a camera
# inside a bush. zc_dusk_spike and zc_dusk_cause both use SPOT (-64, -5042) with CAM_UP 900 and the
# same look vector; zc_dusk_regions uses the same height and ground rect. Retested on a channel foliage
# actually blocks, that viewpoint is obstructed at all eight yaws. So these findings have no valid
# observation behind them:
#
#   - the moon's ground contribution collapsing 87x across the caster handover
#   - "100.1 per cent of the collapse is at the flip"
#   - the 18:25 spike, and the 18:00 dusk hole at 0.0126
#   - "with the moon removed the evening is perfectly monotone, so the moon is the ONLY
#     discontinuity in dusk"
#
# AND THE PHYSICS FITS FOLIAGE, NOT PAVING. Inside a canopy a shadowless moon lights the leaves from
# outside; the instant it becomes a shadow caster the canopy shadows its own interior and the inside
# goes dark. An 87x collapse in 1.2 minutes is what self-shadowing vegetation does. Open plaza has
# nothing to shadow itself with, so there is no mechanism there for a collapse of that size -- which
# means the headline result was probably never about dusk at all.
#
# From a valid vantage at 18:25 the shipped plaza reads fine by eye: slab joints, flower colour and
# architecture all legible. So the question is no longer "how do we fix the cliff" but "is there one".
#
# THIS JOB TURNS NO KNOB. All three dusk knobs are forced to their shipped defaults and verified held
# at every rung. It measures the world as it ships.
#
# TWO VANTAGES, BECAUSE THE FOUNDER SAID SO: "Do not call it a global transition unless multiple
# regions reproduce it." One spot answering either way is one spot.
#
# AND THE READABILITY METRIC IS REPLACED, because the old one is meaningless at night.
# read_screen_rect's `dark` counts pixels under a FIXED linear luma of 0.14. The approved 23:00 night
# -- which is plainly legible by eye, with moonlight shadows, visible slab joints, distinguishable
# flowers -- scores 97.6 per cent crushed and 0.0244 readable by that statistic. A bar built on it is
# degenerate: everything clears "be at least as readable as a 97.6 per cent crushed floor". That is my
# own README rule, "a threshold statistic is not comparable across regimes", applied across the two
# regimes it most obviously fails between.
#
# What makes ground traversable is STRUCTURE -- seeing where one slab ends and the next begins -- and
# that is spatial contrast, not absolute level. So this reports per-cell luma, the spread across cells,
# and the cell-to-cell contrast ratio, alongside the raw fractions kept only for continuity with the
# older runs. The fractions are reported; nothing is gated on them.
import math
import os

CONCURRENT = False

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "dusk_truth")

#: (x, y, yaw). First is zc_vantage_find s4_y090, proven and looked at. Second is a different bearing
#: from the same plaza, so a cliff has to survive a change of view direction to count.
VANTAGES = (("plaza_e", -64.0, -5700.0, 90.0), ("plaza_se", -64.0, -5700.0, 135.0))

#: The founder's hours, plus 23:00 as the approved-night anchor.
HOURS = (18.00, 18.10, 18.20, 18.24, 18.25, 18.26, 18.27, 18.30, 18.40, 18.50, 19.00, 23.00)

SPAN = 21.0
AGREE = 0.010
CAM_UP, CAM_AHEAD, CAM_DROP, CAM_FOV = 160.0, 900.0, -250.0, 70.0
GROUND_RECT = (0.5, 0.74, 0.28, 0.16)
GRID_COLS, GRID_ROWS = 4, 2
FRAME_RECT = (0.5, 0.5, 0.46, 0.44)
CLEAR_FRACTION = 0.92
GREEN_MAX = 1.25
VIS_CH = unreal.TraceTypeQuery.TRACE_TYPE_QUERY1
PAWN_CH = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2
#: A step dominates when it is this many times the median step of the same ladder.
DOMINATES = 3.0


def elevation_at(hour):
    return math.sin(((hour - 6.0) / 12.0) * math.pi) * 72.0


def band_at(elev):
    return max(0.0, min(1.0, (elev + 9.0) / SPAN))


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
    dll = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)),
                       "Binaries", "Win64", "UnrealEditor-Wonderland.dll")
    try:
        import datetime
        return datetime.datetime.fromtimestamp(os.path.getmtime(dll)).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:                                                  # noqa: BLE001
        return "unreadable"


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests
    RESULT["binary_built"] = binary_stamp()
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

    def command(text):
        unreal.SystemLibrary.execute_console_command(live(), text)

    def read_f(name):
        try:
            return round(float(unreal.SystemLibrary.get_console_variable_float_value(name)), 5)
        except Exception:                                              # noqa: BLE001
            return None

    def rect(r):
        cx, cy, hw, hh = r
        got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
        if got is None:
            return None
        mean, dark, bright, sampled = got
        r_, g_, b_ = float(mean.r), float(mean.g), float(mean.b)
        return {"luma": round(0.2126 * r_ + 0.7152 * g_ + 0.0722 * b_, 5),
                "green_ratio": round(g_ / max((r_ + b_) / 2.0, 1e-5), 3),
                "crushed_legacy": round(float(dark), 4), "blown_legacy": round(float(bright), 4)}

    def grid():
        out = []
        for r, c, x0, y0, x1, y1 in cells(GROUND_RECT, GRID_COLS, GRID_ROWS):
            got = L.read_screen_rect(x0, y0, x1, y1)
            if got is None:
                return None
            mean, dark, bright, sampled = got
            r_, g_, b_ = float(mean.r), float(mean.g), float(mean.b)
            out.append(round(0.2126 * r_ + 0.7152 * g_ + 0.0722 * b_, 5))
        return out

    def trace(a, b, ignore, channel):
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                live(), a, b, channel, False, [p for p in (ignore,) if p is not None],
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
                comp = a.get_component_by_class(unreal.DirectionalLightComponent)
                if comp is None:
                    continue
                label = (str(a.get_actor_label()) if hasattr(a, "get_actor_label") else str(a.get_name()))
                dirs.append({"label": label,
                             "intensity": round(float(comp.get_editor_property("intensity")), 5),
                             "casts": bool(comp.get_editor_property("cast_shadows"))})
            for a in unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.SkyLight):
                comp = a.get_component_by_class(unreal.SkyLightComponent)
                if comp is not None:
                    sky = round(float(comp.get_editor_property("intensity")), 4)
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

    # ---- THE WORLD AS IT SHIPS. Knobs forced to defaults and verified, so this cannot accidentally
    # ---- measure a state I introduced while investigating.
    SHIPPED = {"wl.Look.DuskWindow": 0.30, "wl.Look.DuskMoonDamp": 0.0, "wl.Look.DuskSkyBoost": 0.0}
    L.focus_game_viewport()
    for k, v in SHIPPED.items():
        command("%s %.4f" % (k, v))
    command("wl.Sky.DayMinutes 0")
    command("wl.Sky.TwilightSpan %.1f" % SPAN)
    yield 1.0
    held = {k: read_f(k) for k in SHIPPED}
    RESULT["shipped_knobs"] = held
    record("T_SHIPPED", "every dusk knob is at its shipped default, so this measures the world as it "
                        "ships and not a state I introduced",
           all(held.get(k) is not None and abs(held[k] - v) < 1e-3 for k, v in SHIPPED.items())
           and len(held) == len(SHIPPED),
           population=len(held), wanted=SHIPPED, held=held)

    def settled(limit=24):
        window = []
        for _ in range(limit):
            yield 1.0
            now = rect(FRAME_RECT)
            if now is None:
                continue
            window.append(now["luma"])
            if len(window) > 3:
                window.pop(0)
            if len(window) == 3 and (max(window) - min(window)) < 0.004:
                return

    rows = {}
    RESULT["readings"] = rows
    vantage_info = {}
    RESULT["vantages"] = vantage_info

    for name, sx, sy, yaw in VANTAGES:
        pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
        if pawn is None:
            continue
        gh = trace(unreal.Vector(sx, sy, 20000.0), unreal.Vector(sx, sy, -5000.0), pawn, PAWN_CH)
        pawn.set_actor_location(
            unreal.Vector(sx, sy, (gh["z"] + 120.0) if gh else 200.0), False, True)
        command("FlushLevelStreaming")
        yield 3.0
        pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
        if pawn is None:
            continue
        w = pawn.get_actor_location()
        rad = math.radians(yaw)
        eye = unreal.Vector(w.x, w.y, w.z + CAM_UP)
        at = unreal.Vector(w.x + math.cos(rad) * CAM_AHEAD, w.y + math.sin(rad) * CAM_AHEAD,
                           w.z + CAM_DROP)
        L.pose_camera(live(), eye, at, CAM_FOV)
        command("wl.Sky.Hour 12")
        yield 2.5

        gx, gy = eye.x + (at.x - eye.x) * 0.75, eye.y + (at.y - eye.y) * 0.75
        gp_hit = trace(unreal.Vector(gx, gy, eye.z + 2000.0),
                       unreal.Vector(gx, gy, eye.z - 4000.0), pawn, VIS_CH)
        reach = None
        if gp_hit is not None:
            gp = unreal.Vector(gx, gy, gp_hit["z"] + 2.0)
            want = math.sqrt((gp.x - eye.x) ** 2 + (gp.y - eye.y) ** 2 + (gp.z - eye.z) ** 2)
            seen = trace(eye, gp, pawn, VIS_CH)
            reach = 1.0 if seen is None else (seen["dist"] / want if want > 1.0 else None)
        overhead = (trace(unreal.Vector(gx, gy, gp_hit["z"] + 20.0),
                          unreal.Vector(gx, gy, gp_hit["z"] + 8000.0), pawn, VIS_CH)
                    if gp_hit is not None else None)
        gnoon = rect(GROUND_RECT)
        try:
            H.capture_viewport_jpeg(os.path.join(ROOT, "00_%s_noon.jpg" % name), 1400, 88)
        except Exception:                                              # noqa: BLE001
            pass
        ok = bool(reach is not None and reach >= CLEAR_FRACTION and gnoon is not None
                  and gnoon["green_ratio"] <= GREEN_MAX and overhead is None)
        vantage_info[name] = {"spot": [sx, sy], "yaw": yaw, "view_reach": reach,
                              "green_ratio": (gnoon or {}).get("green_ratio"),
                              "overhead_hit": overhead, "ground_open_to_sky": overhead is None,
                              "valid": ok}
        record("T_VALID_%s" % name.upper(),
               "vantage %s can see the ground it measures, and that ground is open to the sky" % name,
               ok, **vantage_info[name])
        if not ok:
            continue

        for hour in HOURS:
            command("wl.Sky.Hour %.4f" % hour)
            yield 1.0
            for step in settled():
                yield step
            g1, f1, cg = rect(GROUND_RECT), rect(FRAME_RECT), grid()
            yield 1.0
            g2, f2 = rect(GROUND_RECT), rect(FRAME_RECT)
            key = "%s_h%05.2f" % (name, hour)
            try:
                H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % key), 1400, 88)
            except Exception:                                          # noqa: BLE001
                pass
            if not (g1 and g2 and f1 and f2 and cg):
                rows[key] = {"vantage": name, "hour": hour, "unmeasured": True}
                continue
            dirs, sky = lights()
            lo, hi, mid = min(cg), max(cg), median(cg)
            rows[key] = {
                "vantage": name, "hour": hour,
                "ground_luma": round((g1["luma"] + g2["luma"]) / 2.0, 5),
                "ground_spread": round(abs(g1["luma"] - g2["luma"]), 5),
                "frame_luma": round((f1["luma"] + f2["luma"]) / 2.0, 5),
                "frame_spread": round(abs(f1["luma"] - f2["luma"]), 5),
                # STRUCTURE, which is what makes ground traversable. A flat dim floor and a legible
                # one can share a mean; they cannot share a cell spread.
                "cells": cg, "cell_min": lo, "cell_max": hi, "cell_median": mid,
                "cell_spread": round(hi - lo, 5),
                "cell_contrast": round((hi - lo) / max(mid, 1e-5), 4),
                # Kept for continuity with the older runs. NOT gated on: at night exposure this
                # statistic saturates -- the approved 23:00 night scores 0.976 crushed while being
                # plainly legible by eye.
                "crushed_legacy": round((g1["crushed_legacy"] + g2["crushed_legacy"]) / 2.0, 4),
                "sky_intensity": sky, "exposure_bias": exposure(),
                "shadow_casters": [d["label"] for d in dirs if d["casts"]],
                "caster_count": sum(1 for d in dirs if d["casts"]),
                "moon_casting": any(d["casts"] and "Moon" in d["label"] for d in dirs),
                "knobs_held": {k: read_f(k) for k in SHIPPED},
                "pred_band": round(band_at(elevation_at(hour)), 5)}

    command("wl.Sky.Hour 12")
    L.release_camera(live())

    good = {k: v for k, v in rows.items() if not v.get("unmeasured")}
    valid_v = [n for n, v in vantage_info.items() if v["valid"]]
    record("T_MEASURED", "every hour at every valid vantage produced a reading",
           len(valid_v) > 0 and len(good) == len(valid_v) * len(HOURS),
           population=len(good), valid_vantages=valid_v, wanted=len(valid_v) * len(HOURS))
    worst = max((max(v["ground_spread"], v["frame_spread"]) for v in good.values()), default=None)
    record("T_NOISE", "every reading agrees with itself",
           len(good) > 0 and worst is not None and worst <= AGREE,
           population=len(good), worst_spread=worst, tolerance=AGREE)
    if not valid_v or worst is None or worst > AGREE or len(good) != len(valid_v) * len(HOURS):
        bail("no valid vantage, or readings missing or disagreeing with themselves")
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    noise = max(worst, 0.002)

    # ---- IS THERE A CLIFF? Per vantage, over the evening only (23:00 is the anchor, not a rung).
    evening = [h for h in HOURS if h <= 19.00]
    profiles = {}
    verdict = {}
    for name in valid_v:
        seq = [good["%s_h%05.2f" % (name, h)]["ground_luma"] for h in evening]
        steps = [round(abs(seq[i + 1] - seq[i]), 5) for i in range(len(seq) - 1)]
        pairs = ["%.2f->%.2f" % (evening[i], evening[i + 1]) for i in range(len(evening) - 1)]
        med = median(steps)
        biggest = max(steps)
        ratio = (biggest / med) if med and med > 1e-6 else None
        handover = None
        for i in range(len(evening) - 1):
            a = good["%s_h%05.2f" % (name, evening[i])]
            b = good["%s_h%05.2f" % (name, evening[i + 1])]
            if (not a["moon_casting"]) and b["moon_casting"]:
                handover = {"between": pairs[i], "step": steps[i],
                            "casters_before": a["shadow_casters"], "casters_after": b["shadow_casters"]}
        profiles[name] = {"hours": evening, "ground_luma": seq, "steps": dict(zip(pairs, steps)),
                          "median_step": med, "largest_step": biggest,
                          "largest_at": pairs[steps.index(biggest)],
                          "largest_over_median": (round(ratio, 2) if ratio else None),
                          "handover": handover,
                          "cell_contrast": [good["%s_h%05.2f" % (name, h)]["cell_contrast"]
                                            for h in evening],
                          "night_anchor_23": good["%s_h23.00" % name]["ground_luma"],
                          "night_cell_contrast_23": good["%s_h23.00" % name]["cell_contrast"]}
        verdict[name] = bool(ratio is not None and ratio >= DOMINATES and biggest > noise)
    RESULT["profiles"] = profiles

    reproduced = [n for n in valid_v if verdict[n]]
    record("T_CLIFF", "a single step dominates the evening -- the visual cliff the dusk work was "
                      "built on is present at a VALID observation point",
           len(valid_v) > 0 and len(reproduced) == len(valid_v),
           population=len(valid_v), vantages_showing_a_cliff=reproduced,
           vantages_without=[n for n in valid_v if not verdict[n]],
           threshold={"largest_step_over_median_at_least": DOMINATES, "and_above_noise": noise},
           profiles=profiles,
           note="GREEN means the cliff is real and survives a valid camera, so the dusk work stands "
                "and needs only re-sizing. RED means it does not reproduce off the bush camera, and "
                "the 87x collapse, the 18:25 spike and 'the moon is the only discontinuity in dusk' "
                "were all artifacts of a lens inside a canopy that shadows its own interior the "
                "moment the moon starts casting")

    # ---- AND THE READABILITY QUESTION, ANSWERED IN THE ONE FORM THAT SURVIVES BOTH REGIMES.
    #
    # Not "is the ground above a fixed linear luma" -- the approved night fails that while being
    # plainly legible. Structure: can you tell one slab from the next. The approved 23:00 night is the
    # reference, because the founder accepted it, and it is measured at the same camera minutes apart.
    legibility = {}
    for name in valid_v:
        anchor = good["%s_h23.00" % name]["cell_contrast"]
        worst_h, worst_c = None, None
        for h in evening:
            c = good["%s_h%05.2f" % (name, h)]["cell_contrast"]
            if worst_c is None or c < worst_c:
                worst_h, worst_c = h, c
        legibility[name] = {"night_23_cell_contrast": anchor, "worst_evening_hour": worst_h,
                            "worst_evening_cell_contrast": worst_c,
                            "evening_at_least_as_structured_as_night": bool(
                                worst_c is not None and worst_c >= anchor)}
    RESULT["legibility"] = legibility
    record("T_LEGIBLE", "no evening hour has less ground structure than the approved night",
           len(legibility) > 0 and all(v["evening_at_least_as_structured_as_night"]
                                       for v in legibility.values()),
           population=len(legibility), by_vantage=legibility,
           note="cell-to-cell contrast, not a fixed-threshold crushed fraction. The old statistic "
                "scores the approved night at 0.976 crushed and 0.0244 readable while it is plainly "
                "legible by eye, so a bar built on it passes everything")

    RESULT["captures"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
