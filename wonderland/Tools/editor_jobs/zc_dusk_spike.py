# ======================================================================================================
# VOID CORPUS -- DO NOT RUN, DO NOT QUOTE. Quarantined 2026-09-28 by the world lane.
#
# SPOT (-64, -5042) was proven as a STANDING position. The camera sat CAM_UP 900 uu above it, inside
# foliage, and was obstructed at all 8 yaws on the VISIBILITY channel. The clear-view gate traced on the
# PAWN channel, which foliage does not block, so it passed while every frame was the inside of a plant.
# Every framebuffer number this job produced is void, and so is every conclusion the prose below draws
# from them: the "18:25 spike", the 87x collapse, "the moon is the only discontinuity in dusk". The
# zzAG2 figures quoted in the header are void too (zc_dusk_regions, same camera).
#
# Results produced by this job: done/zwB1_dusk_spike.json, done/zwB2_dusk_spike_fine.json and
# captures/zc/dusk_spike/. Kept as a record of what went wrong, not as evidence.
#
# The dusk cliff was re-measured from an open plaza vantage proven with a visibility-channel trace,
# (-64, -5700) yaw 90 at eye height: zc_dusk_truth and zc_dusk_handover. Use those. job() refuses to
# run. Re-asking this question means a new job at a proven CAMERA position, not deleting the refusal.
# ======================================================================================================
#
# WHAT IS THE 18:25 SPIKE MADE OF? Decomposed by removing one contributor at a time.
#
# The Nightfall complement at d21c2213 closed the 18:00 hole and created an overshoot at 18:25, and the
# overshoot is in all three regions (zzAG2): readable ground 0.056 -> 0.772 -> 0.119 at the arrival,
# 0.005 -> 0.209 -> 0.122 at Noctis, 0.008 -> 0.600 -> 0.114 at Tartarus. Up and back down inside half
# an hour, and at two of the three that peak is brighter than midnight.
#
# I MADE IT: zzT2 measured 18:25 at ground luma 0.0155 before the change.
#
# AND THE OBVIOUS EXPLANATION IS WRONG, which is why this job exists instead of a fix. As a fraction of
# the noon sun, with the exposure bias beside it:
#
#     hour    sun     moon    total    exposure bias    measured ground luma
#     18:00  19.99%   3.03%   23.0%        +0.980              0.0903
#     18:25   4.89%   4.46%    9.4%        +1.335              0.1629
#     18:50   0.12%   5.00%    5.1%        +1.450              0.0997
#
# 18:00 has TWO AND A HALF TIMES the light of 18:25 and reads a fifth as readable. Sun, moon, sky
# multiplier and fog density are each monotone across this window -- nothing in the rig peaks at 18:25 --
# so "both rigs are on at once" is a description of the hour and not a mechanism for the peak.
#
# So this removes one contributor at a time at four hours and reports what each is worth, rather than
# reasoning about cosines again. The moon is the only term with a clean switch (wl.Sky.MoonGain 0), so
# base-minus-moon_off gives the moon's share and what remains is everything else: sun, sky, fog, the
# practicals and whatever Lumen carries indirectly.
#
# WHAT WOULD FALSIFY WHAT.
#   If the spike is in the MOON term, moon_off flattens 18:25 to its neighbours and the fix is the
#   crossover curve I wrote.
#   If the spike survives moon_off, it is the sun or the sky at a grazing angle and my curve only
#   exposed it -- the 18:25 reading was always going to be bright once anything lit the ground there.
#   If neither term alone accounts for it, the two are interacting and I have no candidate yet, which
#   is a result and not a failure.
#
# Saves nothing. Restores MoonGain to what it FOUND. Changes no lighting: the approved night is not
# touched and every hour here has Daylight > 0, so it lives entirely inside the twilight band.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "dusk_spike")

#: The data-chosen arrival standing spot: 36 m off the monument, open paved ground, proven before use.
SPOT = (-64.0, -5042.0)
#: STRADDLING THE CASTER FLIP, which computes to hour 18.2598 -- thirty-six seconds after the 18:25
#: sample the coarse run took. That run showed the moon's ground share collapsing 54x between 18:25 and
#: 18:50, but INFERRED it across a 25-minute gap containing the flip, so it cannot tell a step at the
#: flip from a ramp across the quarter hour. The other lane asked for the difference and it matters:
#: if part of the flood is already gone before the flip, "move the handover earlier" costs less than
#: the coarse table makes it look.
#:
#: Two rungs before the flip, four after, plus 18:00 for continuity with the coarse run.
HOURS = (18.00, 18.22, 18.25, 18.27, 18.32, 18.40, 18.50)
SPAN = 21.0
AGREE = 0.010
CAM_UP, CAM_AHEAD, CAM_DROP, CAM_FOV = 900.0, (1400.0, -1400.0), -100.0, 70.0
GROUND_RECT = (0.5, 0.78, 0.30, 0.16)
FRAME_RECT = (0.5, 0.5, 0.46, 0.44)
PAWN_CH = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2


def elevation_at(hour):
    return math.sin(((hour - 6.0) / 12.0) * math.pi) * 72.0


def nightfall_at(elev):
    x = 1.0 - max(0.0, min(1.0, (elev + 9.0) / SPAN))
    return x * x * (3.0 - 2.0 * x)


def daylight_at(elev):
    return max(0.0, min(1.0, (elev + 9.0) / SPAN)) ** 1.9


def patch(rect):
    cx, cy, hw, hh = rect
    got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
    if got is None:
        return None
    mean, dark, bright, sampled = got
    d, b = float(dark), float(bright)
    return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4),
            "crushed": round(d, 4), "blown": round(b, 4),
            "readable": round(max(0.0, 1.0 - d - b), 4)}


def job():
    # QUARANTINED: see the VOID CORPUS banner at the top of this file. The body below is unreachable and
    # kept only so a reader can see what produced the void numbers.
    RESULT["status"] = "refused: VOID corpus (camera inside foliage); use zc_dusk_truth / zc_dusk_handover"
    return
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

    def command(text):
        unreal.SystemLibrary.execute_console_command(live(), text)

    def read_f(name):
        try:
            return round(float(unreal.SystemLibrary.get_console_variable_float_value(name)), 4)
        except Exception:                                              # noqa: BLE001
            return None

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

    found = {"MoonGain": read_f("wl.Sky.MoonGain"), "Fog": read_f("r.Fog")}
    RESULT["knobs_as_found"] = found

    L.focus_game_viewport()
    cvar("wl.Sky.DayMinutes", 0)
    cvar("wl.Sky.TwilightSpan", "%.1f" % SPAN)

    # ---- STAND SOMEWHERE REAL, AND PROVE IT.
    pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
    gz = None
    if pawn is not None:
        h = trace(unreal.Vector(SPOT[0], SPOT[1], 20000.0), unreal.Vector(SPOT[0], SPOT[1], -5000.0), pawn)
        gz = h["z"] if h else None
        pawn.set_actor_location(
            unreal.Vector(SPOT[0], SPOT[1], (gz + 120.0) if gz is not None else 200.0), False, True)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(live(), 0) is not None, 120)
    command("FlushLevelStreaming")
    yield 3.0
    pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
    if pawn is None:
        RESULT["status"] = "voided: no pawn after the teleport"
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
    RESULT["vantage"] = {"asked": list(SPOT),
                         "landed": [round(where.x, 1), round(where.y, 1), round(where.z, 1)],
                         "offset_uu": off, "forward_hit": fwd, "down_hit": down,
                         "ground_patch_hit": gpatch, "ground_rect_screen": list(GROUND_RECT)}
    ok_vantage = (off <= 500.0 and (not fwd or fwd["dist"] >= 400.0)
                  and down is not None and gpatch is not None)
    record("K_VALID", "the observation point is a real standing position with ground under the patch",
           ok_vantage, vantage=RESULT["vantage"])
    if not ok_vantage:
        RESULT["status"] = "voided: the observation point could not be shown valid"
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
    for hour in HOURS:
        for label, gain in (("base", None), ("moon_off", 0.0)):
            key = "h%05.2f_%s" % (hour, label)
            cvar("wl.Sky.MoonGain", "%.4f" % (found["MoonGain"] if gain is None else gain))
            cvar("wl.Sky.Hour", "%.2f" % hour)
            yield 1.0
            for step in settled():
                yield step
            # WHERE IS THE PAWN, at the moment of reading. Assign() takes its Eye from it, and a pawn
            # that wanders makes two rungs answer questions about different districts.
            pnow = unreal.GameplayStatics.get_player_pawn(live(), 0)
            drift = (None if pnow is None else
                     round(math.hypot(pnow.get_actor_location().x - SPOT[0],
                                      pnow.get_actor_location().y - SPOT[1]), 1))
            g1, f1 = patch(GROUND_RECT), patch(FRAME_RECT)
            yield 1.0
            g2, f2 = patch(GROUND_RECT), patch(FRAME_RECT)
            try:
                H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % key), 1200, 85)
            except Exception:                                          # noqa: BLE001
                pass
            if not (g1 and g2 and f1 and f2):
                rows[key] = {"hour": hour, "arm": label, "unmeasured": True, "drift_uu": drift}
                continue
            elev = elevation_at(hour)
            rows[key] = {
                "hour": hour, "arm": label, "drift_uu": drift,
                "moon_gain_held": read_f("wl.Sky.MoonGain"),
                "ground_luma": round((g1["luma"] + g2["luma"]) / 2.0, 4),
                "ground_luma_spread": round(abs(g1["luma"] - g2["luma"]), 4),
                "ground_readable": round((g1["readable"] + g2["readable"]) / 2.0, 4),
                "ground_crushed": round((g1["crushed"] + g2["crushed"]) / 2.0, 4),
                "frame_luma": round((f1["luma"] + f2["luma"]) / 2.0, 4),
                "frame_luma_spread": round(abs(f1["luma"] - f2["luma"]), 4),
                "sun_elevation": round(elev, 2), "daylight": round(daylight_at(elev), 4),
                "moon_lux_pred": round(0.050 * nightfall_at(elev), 4),
                "sun_int_pred": round(max(daylight_at(elev),
                                          0.004 * (1 - nightfall_at(elev))
                                          + 0.0012 * nightfall_at(elev)), 4),
                "moon_casts_pred": bool(0.050 * nightfall_at(elev)
                                        > max(daylight_at(elev),
                                              0.004 * (1 - nightfall_at(elev))
                                              + 0.0012 * nightfall_at(elev)))}

    cvar("wl.Sky.MoonGain", "%.4f" % (found["MoonGain"] or 0.05))
    cvar("wl.Sky.Hour", 12)
    L.release_camera(live())

    good = {k: v for k, v in rows.items() if not v.get("unmeasured")}
    record("K_MEASURED", "every hour produced both arms",
           len(good) == len(HOURS) * 2, measured=len(good), wanted=len(HOURS) * 2,
           missing=[k for k in rows if rows[k].get("unmeasured")])
    drifted = [k for k, v in good.items() if v.get("drift_uu") is None or v["drift_uu"] > 500.0]
    record("K_STILL", "the pawn is at the spot at every reading, not just when it was placed",
           len(good) > 0 and not drifted, drifted=drifted,
           drift_by_reading={k: v.get("drift_uu") for k, v in good.items()})
    worst = max((max(v["ground_luma_spread"], v["frame_luma_spread"]) for v in good.values()),
                default=None)
    record("K_NOISE", "every reading agrees with itself on the luma it measures",
           len(good) == len(HOURS) * 2 and worst is not None and worst <= AGREE,
           worst_luma_spread=worst, tolerance=AGREE)
    if len(good) != len(HOURS) * 2 or drifted or (worst or 1.0) > AGREE:
        RESULT["status"] = "voided: readings missing, drifted or disagreeing with themselves"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    # ---- THE DECOMPOSITION. base minus moon_off is the moon's share; moon_off is everything else.
    share = {}
    for hour in HOURS:
        b = good["h%05.2f_base" % hour]
        m = good["h%05.2f_moon_off" % hour]
        share["%.2f" % hour] = {
            "base_ground": b["ground_luma"], "without_moon": m["ground_luma"],
            "moon_share": round(b["ground_luma"] - m["ground_luma"], 4),
            "everything_else": m["ground_luma"],
            "base_readable": b["ground_readable"], "readable_without_moon": m["ground_readable"]}
    RESULT["decomposition"] = share

    peak_h = max(HOURS, key=lambda h: good["h%05.2f_base" % h]["ground_luma"])
    others = [h for h in HOURS if h != peak_h]
    peak_moonless = good["h%05.2f_moon_off" % peak_h]["ground_luma"]
    others_moonless = [good["h%05.2f_moon_off" % h]["ground_luma"] for h in others]
    survives = peak_moonless > max(others_moonless) + 0.010

    record("K_PEAK", "the brightest hour is 18:25, which is the overshoot this job exists to explain",
           abs(peak_h - 18.25) < 0.01, peak_hour=peak_h,
           base_ground_by_hour={("%.2f" % h): good["h%05.2f_base" % h]["ground_luma"] for h in HOURS},
           note="if the peak has moved, the world is not in the state zzAG2 measured and the "
                "decomposition below is about a different thing")

    record("K_MOON", "the spike is the MOON arriving early -- removing it flattens 18:25 to its neighbours",
           not survives, peak_hour=peak_h, peak_without_moon=peak_moonless,
           other_hours_without_moon={("%.2f" % h): good["h%05.2f_moon_off" % h]["ground_luma"]
                                     for h in others},
           moon_share_by_hour={k: v["moon_share"] for k, v in share.items()},
           note="GREEN means the crossover curve I wrote is the cause and the fix is mine to make in "
                "it. RED means the peak survives with the moon switched off, so it is the sun or the "
                "sky at a grazing angle and my curve only revealed what was always going to be there")

    # ---- DID THE SWITCH ACTUALLY DO ANYTHING? The control is the thing to verify hardest.
    #
    # Every number below is base MINUS moon_off, so if the moon_off arm silently failed to change
    # anything the decomposition would report "the moon contributes nothing" -- a dead switch and an
    # unresponsive subject are indistinguishable from the result alone. The other lane lost an evening
    # to exactly that: a PreviewGlow sweep whose "off" rung never turned anything off, because
    # IsNearlyEqual guarded a knob with a tolerance equal to its shipped value, and the cvar readback
    # passed honestly at every rung.
    #
    # NOT "every pair must differ" -- at 18:50 the moon genuinely contributes 0.0011 and the two arms
    # SHOULD look alike. The question is whether the switch moves the picture ANYWHERE. If it never
    # does, the arm is dead and nothing here may be read.
    biggest = max((abs(v["moon_share"]) for v in share.values()), default=0.0)
    record("K_SWITCH", "the moon_off arm actually changes the picture somewhere, so the control is live",
           biggest > max(4.0 * (worst or 0.0), 0.005),
           largest_moon_share=biggest, noise=worst, floor=max(4.0 * (worst or 0.0), 0.005),
           moon_share_by_hour={k: v["moon_share"] for k, v in share.items()},
           gain_as_found=found["MoonGain"],
           note="MoonGain at 0.05 survives the tolerance guards near it by a factor of fifty, which is "
                "luck rather than design. This fails loudly the day a default is lowered or a guard "
                "tightened near it -- the scenario nobody can see coming and the one that cost the "
                "other lane a whole evening")

    # ---- STEP OR RAMP? The question the coarse run could not answer and the one that prices a branch.
    seq = sorted(h for h in HOURS if h >= 18.20)
    shares = [(h, share["%.2f" % h]["moon_share"]) for h in seq]
    before = [x for x in shares if not good["h%05.2f_base" % x[0]]["moon_casts_pred"]]
    after = [x for x in shares if good["h%05.2f_base" % x[0]]["moon_casts_pred"]]
    total_drop = (before[-1][1] - after[-1][1]) if (before and after) else None
    flip_drop = (before[-1][1] - after[0][1]) if (before and after) else None
    frac = (round(flip_drop / total_drop, 3)
            if (total_drop not in (None, 0) and flip_drop is not None) else None)
    RESULT["collapse_shape"] = {"moon_share_by_hour": dict(shares),
                                "last_before_flip": before[-1] if before else None,
                                "first_after_flip": after[0] if after else None,
                                "drop_across_the_flip": flip_drop, "total_drop": total_drop,
                                "fraction_at_the_flip": frac}
    record("K_SHAPE", "the collapse is a STEP at the caster flip, not a ramp across the quarter hour",
           frac is not None and frac >= 0.70,
           fraction_of_the_drop_at_the_flip=frac, drop_across_the_flip=flip_drop,
           total_drop=total_drop, moon_share_by_hour=dict(shares),
           flip_between=[before[-1][0] if before else None, after[0][0] if after else None],
           note="GREEN: nearly all the flood disappears in the one quarter-minute the caster flips, so "
                "moving the handover earlier buys the whole spike and costs the whole S01 clause. RED: "
                "the flood is already draining before the flip, so an earlier handover buys less than "
                "the coarse table suggested and the branch is cheaper than it looked. Either answer "
                "changes the price of a branch the founder is being asked to choose between")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
