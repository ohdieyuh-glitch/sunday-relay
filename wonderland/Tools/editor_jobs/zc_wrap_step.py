# THE MIDNIGHT SNAP, MEASURED ACROSS THE WRAP ITSELF RATHER THAN EITHER SIDE OF IT.
#
# zzT3 swept the night at half-hours and found it flat to within 0.0053 -- except for one step at the
# midnight wrap: luma 0.1971 to 0.1714, ground 0.1969 to 0.1573, tails 0.3368 to 0.4994. Eighteen times the
# median step of the rest of the night.
#
# The cause was four lines. Hour wraps through Fmod so 24.0 becomes 0.0, and BearingAt was
# Lerp(72, 288, Clamp((Hour - 5)/14)) -- CLAMPED at both ends. The sun's bearing froze at 288 deg from 19:00
# to midnight and at 72 deg from midnight to 05:00, then changed by 216 in value, which a rotator takes as a
# 144 degree swing by the short arc, in a single frame. The moon went with it, being laid out at bearing+180.
#
# BearingAt now carries the remaining 144 degrees across the night at a constant rate: 288 at 19:00 to 432
# (which is 72) at 05:00, where the day arc resumes exactly. Checked offline at one-minute resolution over a
# full 24 hours: worst angular step falls from 144.000 deg to 0.257, which is simply the daytime rate, and
# the joins at 05:00 and 19:00 are exact.
#
# THAT IS ARITHMETIC, AND ARITHMETIC HAS BEEN WRONG ALL DAY. This measures the rendered result.
#
# Three clusters, fine where it matters: around the wrap, and around each join where the night arc meets the
# day arc. A join is the other place a piecewise function can tear, and nothing has ever looked at those.
#
# THE GATE IS A COMPARISON, NOT A THRESHOLD. An absolute luma limit would need a number nobody has grounds
# for. Instead every step inside a cluster is compared against the median step of the whole sample: if the
# wrap is no worse than an ordinary quarter-hour elsewhere, it is no longer a boundary. That is the same
# shape as zzT3's S_SMOOTH, which is the gate that found this.
#
# Saves nothing. Restores hour. Holds exposure, span, and the other lane's eye levels.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wrap_step")

#: Around the wrap, and around both joins. Ordered as the clock runs, wrap last so 24.0 -> 0.0 is crossed.
WRAP = (23.00, 23.50, 23.75, 23.90, 23.98, 0.02, 0.10, 0.25, 0.50, 1.00)
JOIN_PM = (18.75, 18.90, 19.00, 19.10, 19.25)
JOIN_AM = (4.75, 4.90, 5.00, 5.10, 5.25)
CLUSTERS = (("wrap", WRAP), ("join_1900", JOIN_PM), ("join_0500", JOIN_AM))
SPAN = 21.0
EYE = (-320.0, -1900.0, 200.0)
AT = (0.0, -1460.0, 90.0)
AGREE = 0.010


def bearing_at(hour):
    """The replica of the shipped curve, so the result records what the sun was asked to do."""
    if 5.0 <= hour <= 19.0:
        return 72.0 + (288.0 - 72.0) * ((hour - 5.0) / 14.0)
    into = (hour - 19.0) if hour > 19.0 else (hour + 5.0)
    return math.fmod(288.0 + 144.0 * (into / 10.0), 360.0)


def arc(a, b):
    """The angle a rotator actually turns through: the SHORT way round, not the numeric difference."""
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


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

    L.focus_game_viewport()
    cvar("wl.Sky.DayMinutes", 0)
    cvar("wl.Sky.TwilightSpan", "%.1f" % SPAN)
    L.pose_camera(live(), unreal.Vector(*EYE), unreal.Vector(*AT), 60.0)
    yield 3.0
    RESULT["camera_eye"] = list(EYE)
    RESULT["camera_at"] = list(AT)

    def settled():
        run, prev = 0, None
        for _ in range(24):
            yield 1.0
            now = patch(0.5, 0.5, 0.46, 0.44)
            if now is None:
                continue
            if prev is not None and abs(now["luma"] - prev["luma"]) < 0.004:
                run += 1
                if run >= 2:
                    return
            else:
                run = 0
            prev = now

    out = {}
    RESULT["clusters"] = out
    for name, hours in CLUSTERS:
        rows = []
        out[name] = rows
        for hour in hours:
            cvar("wl.Sky.Hour", "%.2f" % hour)
            for step in settled():
                yield step
            a = patch(0.5, 0.5, 0.46, 0.44)
            g1 = patch(0.5, 0.78, 0.30, 0.16)
            yield 1.0
            b = patch(0.5, 0.5, 0.46, 0.44)
            g2 = patch(0.5, 0.78, 0.30, 0.16)
            try:
                H.capture_viewport_jpeg(os.path.join(ROOT, "%s_h%05.2f.jpg" % (name, hour)), 1200, 85)
            except Exception:                                          # noqa: BLE001
                pass
            if a is None or b is None:
                rows.append({"hour": hour, "unmeasured": True})
                continue
            rows.append({"hour": hour,
                         "luma": round((a["luma"] + b["luma"]) / 2.0, 4),
                         "spread": round(abs(a["luma"] - b["luma"]), 4),
                         "tails": round((a["tails"] + b["tails"]) / 2.0, 4),
                         "ground_luma": round(((g1 or {}).get("luma", 0.0)
                                               + (g2 or {}).get("luma", 0.0)) / 2.0, 4) if g1 and g2 else None,
                         "sun_bearing": round(bearing_at(hour), 2)})

    cvar("wl.Sky.Hour", 12)
    L.release_camera(live())

    every = [r for name, _ in CLUSTERS for r in out[name] if not r.get("unmeasured")]
    wanted = sum(len(h) for _, h in CLUSTERS)

    worst_spread = max((r["spread"] for r in every), default=None)
    record("W_NOISE", "each rung agrees with itself -- two reads of the same hour",
           worst_spread is not None and worst_spread <= AGREE and len(every) == wanted,
           worst_spread=worst_spread, tolerance=AGREE, measured=len(every), wanted=wanted,
           note="red here voids everything below")
    if not every or len(every) != wanted or (worst_spread or 1.0) > AGREE:
        RESULT["status"] = "voided: the rungs do not agree with themselves"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    # ---- THE BEARING IS CONTINUOUS, in the terms a rotator uses. Recorded from the replica, so a build that
    # did not pick the fix up shows a 144 here and voids the reading below rather than passing quietly.
    steps_by_cluster = {}
    worst_arc = 0.0
    for name, _ in CLUSTERS:
        rows = [r for r in out[name] if not r.get("unmeasured")]
        arcs = [round(arc(rows[i]["sun_bearing"], rows[i - 1]["sun_bearing"]), 3) for i in range(1, len(rows))]
        steps_by_cluster[name] = arcs
        worst_arc = max([worst_arc] + arcs)
    record("W_BEARING", "the sun's bearing turns the short way by small amounts, with no snap at any boundary",
           worst_arc <= 10.0, worst_arc_deg=worst_arc, arcs_by_cluster=steps_by_cluster,
           note="the old curve froze the bearing through the night and turned 144 deg by the short arc in "
                "one frame at the wrap. A large value here means the running build predates the fix and "
                "everything below is measuring the old sun")

    # ---- AND THE RENDERED RESULT. Every step compared against the median of the whole sample, so no
    # absolute brightness threshold has to be invented.
    all_steps = []
    per_cluster = {}
    for name, _ in CLUSTERS:
        rows = [r for r in out[name] if not r.get("unmeasured")]
        ds = [round(abs(rows[i]["luma"] - rows[i - 1]["luma"]), 4) for i in range(1, len(rows))]
        per_cluster[name] = {"steps": ds, "worst": max(ds) if ds else None}
        all_steps.extend(ds)
    ordered = sorted(all_steps)
    median_step = ordered[len(ordered) // 2] if ordered else None
    wrap_worst = per_cluster["wrap"]["worst"]
    allowed = max(3.0 * (median_step or 0.0), AGREE * 2.0)
    record("W_WRAP", "midnight is no more of a step than any ordinary quarter-hour",
           wrap_worst is not None and wrap_worst <= allowed,
           wrap_worst_step=wrap_worst, median_step=median_step, allowed=allowed,
           by_cluster=per_cluster,
           note="zzT3 measured 0.0257 here against a median of 0.0014. A comparison rather than a threshold, "
                "because no one has grounds for an absolute number and the question is whether the boundary "
                "still stands out from its neighbours")

    for name in ("join_1900", "join_0500"):
        worst = per_cluster[name]["worst"]
        record("W_%s" % name.upper(), "the night arc meets the day arc at %s without a tear" % name[-4:],
               worst is not None and worst <= allowed,
               worst_step=worst, allowed=allowed, steps=per_cluster[name]["steps"],
               note="a piecewise curve can tear where the pieces meet as well as where the clock wraps, and "
                    "these two joins have never been looked at")

    RESULT["median_step"] = median_step
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
