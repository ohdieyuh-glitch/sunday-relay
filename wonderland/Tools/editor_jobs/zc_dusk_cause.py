# WHAT ACTUALLY DARKENS THE GROUND AT DUSK, AND A DELIBERATE ATTEMPT TO KILL MY OWN EXPLANATION.
#
# MY CLAIM, which this job exists to disprove rather than support: the moon's pitch is +Elevation and the
# sun's is -Elevation, so the two are exactly antipodal and cross the horizon together. At 18:00 the
# elevation is zero, both are flat on the horizon, and a directional light at zero elevation delivers
# cos(90) of itself to level ground -- nothing. On that story no amount of moon BRIGHTNESS can light the
# paving at dusk, and only moving the moon UP can.
#
# THE OTHER LANE PROPOSED THE TEST AND IT IS BETTER THAN MY HYPOTHESIS DESERVED: if the dusk darkness is
# atmosphere rather than geometry, it must track the FOG and be indifferent to the moon's elevation.
#
# SO THE PREDICTIONS ARE OPPOSED AND BOTH ARE FALSIFIABLE AT ONE HOUR:
#
#                                   cosine/geometry says   atmosphere says
#   MoonGain 0 -> 4x at 18:00       ground barely moves    ground barely moves
#   fog off at 18:00                ground barely moves    ground improves a lot
#   MoonLeadHours 1.5 at 18:00      ground improves a lot  ground barely moves
#
# X_COSINE IS WRITTEN SO THAT A FAIL KILLS MY EXPLANATION. It asserts the moon's brightness does NOT
# reach the ground at dusk. If the ground brightens when the moon is made four times stronger at an hour
# when I claim the moon cannot touch it, the claim is wrong and the gate says so in red.
#
# AND THERE IS A POSITIVE CONTROL, without which a null result means nothing. At 23:00 the moon stands
# near 70 degrees and certainly does light the ground. X_CONTROL requires that turning it off there makes
# a large difference. If it does not, this instrument cannot detect the moon's contribution ANYWHERE, the
# dusk null is an artefact, and everything below it is void. A test that cannot fail on the positive
# control is not evidence about the negative one.
#
# Restores MoonGain, MoonLeadHours and r.Fog to the values it FOUND, not to the source defaults.
# wl.Sky.MoonLeadHours stays inert afterwards; this only borrows it to measure the trade.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "dusk_cause")

#: The same data-chosen standing spot the region ladder uses: 36 m from the monument, open paved ground.
SPOT = (-64.0, -5042.0)
DUSK, NIGHT = 18.00, 23.00
#: (label, hour, MoonGain or None for found, MoonLeadHours, fog on/off)
CONDITIONS = (
    ("dusk_base",        DUSK,  None,  0.0, 1),
    ("dusk_moon_off",    DUSK,  0.0,   0.0, 1),
    ("dusk_moon_4x",     DUSK,  0.200, 0.0, 1),
    ("dusk_fog_off",     DUSK,  None,  0.0, 0),
    ("dusk_moon_up",     DUSK,  None,  1.5, 1),
    ("night_base",       NIGHT, None,  0.0, 1),
    ("night_moon_off",   NIGHT, 0.0,   0.0, 1),
    ("night_moon_4x",    NIGHT, 0.200, 0.0, 1),
    ("night_fog_off",    NIGHT, None,  0.0, 0),
)
SPAN = 21.0
AGREE = 0.010
#: A change this size or larger in the readable share of the ground counts as the knob reaching it.
REACHES = 0.10
CAM_UP, CAM_AHEAD, CAM_DROP, CAM_FOV = 900.0, (1400.0, -1400.0), -100.0, 70.0
GROUND_RECT = (0.5, 0.78, 0.30, 0.16)
FRAME_RECT = (0.5, 0.5, 0.46, 0.44)
PAWN_CH = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2


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

    found = {"MoonGain": read_f("wl.Sky.MoonGain"),
             "MoonLeadHours": read_f("wl.Sky.MoonLeadHours"),
             "Fog": read_f("r.Fog"),
             "PracticalRadius": read_f("wl.Look.PracticalRadius"),
             "PracticalCount": read_f("wl.Look.PracticalCount")}
    RESULT["knobs_as_found"] = found

    # ---- IS THE LEAD KNOB EVEN IN THIS BUILD? It was committed at 16:44 and the DLL is 16:56, which is
    # an argument and not a reading. An unrecognised console command logs and carries on, so the
    # moon_up rung would silently be a second copy of the baseline and X_LEAD would report "no effect".
    cvar("wl.Sky.MoonLeadHours", "1.5")
    yield 0.5
    lead_took = read_f("wl.Sky.MoonLeadHours")
    cvar("wl.Sky.MoonLeadHours", "%.3f" % (found["MoonLeadHours"] or 0.0))
    record("X_LEADKNOB", "wl.Sky.MoonLeadHours exists in this build and takes a value",
           lead_took is not None and abs(lead_took - 1.5) < 0.01,
           asked=1.5, read_back=lead_took, as_found=found["MoonLeadHours"],
           note="a build without it accepts the command, logs 'not recognized' and carries on, and the "
                "moon_up rung would be an identical copy of the baseline reported as 'raising the moon "
                "does nothing' -- the exact false negative that would confirm the atmosphere story")

    L.focus_game_viewport()
    cvar("wl.Sky.DayMinutes", 0)
    cvar("wl.Sky.TwilightSpan", "%.1f" % SPAN)

    pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
    gz = None
    if pawn is not None:
        hit = trace(unreal.Vector(SPOT[0], SPOT[1], 20000.0), unreal.Vector(SPOT[0], SPOT[1], -5000.0), pawn)
        gz = hit["z"] if hit else None
        pawn.set_actor_location(
            unreal.Vector(SPOT[0], SPOT[1], (gz + 120.0) if gz is not None else 200.0), False, True)
    yield 2.0
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
                         "offset_uu": off, "ground_trace_z": gz, "forward_hit": fwd,
                         "down_hit": down, "ground_patch_hit": gpatch,
                         "ground_rect_screen": list(GROUND_RECT)}
    record("X_VALID", "the observation point is a real standing position with ground under the patch",
           off <= 500.0 and (not fwd or fwd["dist"] >= 400.0) and down is not None and gpatch is not None,
           vantage=RESULT["vantage"],
           note="the same five checks the region ladder uses: arrived, not embedded in geometry, floor "
                "beneath the camera, and something solid under the rectangle being measured")
    if not (off <= 500.0 and (not fwd or fwd["dist"] >= 400.0) and down is not None and gpatch is not None):
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

    rows = {}
    RESULT["conditions"] = rows
    for label, hour, gain, lead, fog in CONDITIONS:
        cvar("wl.Sky.MoonGain", "%.4f" % (found["MoonGain"] if gain is None else gain))
        cvar("wl.Sky.MoonLeadHours", "%.3f" % lead)
        cvar("r.Fog", "%d" % fog)
        cvar("wl.Sky.Hour", "%.2f" % hour)
        yield 1.0
        for step in settled():
            yield step
        held = {"MoonGain": read_f("wl.Sky.MoonGain"),
                "MoonLeadHours": read_f("wl.Sky.MoonLeadHours"), "Fog": read_f("r.Fog")}
        f1, g1 = patch(FRAME_RECT), patch(GROUND_RECT)
        yield 1.0
        f2, g2 = patch(FRAME_RECT), patch(GROUND_RECT)
        try:
            H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % label), 1200, 85)
        except Exception:                                              # noqa: BLE001
            pass
        if not (f1 and f2 and g1 and g2):
            rows[label] = {"hour": hour, "unmeasured": True, "held": held}
            continue
        rows[label] = {
            "hour": hour, "held": held,
            "asked": {"MoonGain": gain, "MoonLeadHours": lead, "Fog": fog},
            "luma": round((f1["luma"] + f2["luma"]) / 2.0, 4),
            "spread": round(abs(f1["luma"] - f2["luma"]), 4),
            "ground_luma": round((g1["luma"] + g2["luma"]) / 2.0, 4),
            "ground_crushed": round((g1["crushed"] + g2["crushed"]) / 2.0, 4),
            "ground_readable": round((g1["readable"] + g2["readable"]) / 2.0, 4),
            # GATE THE CONTINUOUS QUANTITY, REPORT THE DERIVED ONE.
            #
            # readable is a THRESHOLD statistic -- the share of pixels over luma 0.14 -- so where the
            # ground sits near that threshold a thousandth of luma moves several per cent of the
            # fraction. Holding it to the same tolerance as a mean is a category error, and it voided the
            # first run of this job at 0.0107 against 0.010 while every FRAME luma spread was under
            # 0.0010 and the effect being measured was 0.78. The luma spreads gate; the fraction spread
            # is recorded so a reader can see the amplification rather than be protected from it.
            "ground_luma_spread": round(abs(g1["luma"] - g2["luma"]), 4),
            "ground_readable_spread": round(abs(g1["readable"] - g2["readable"]), 4)}

    # ---- RESTORE WHAT WAS FOUND.
    cvar("wl.Sky.MoonGain", "%.4f" % (found["MoonGain"] or 0.05))
    cvar("wl.Sky.MoonLeadHours", "%.3f" % (found["MoonLeadHours"] or 0.0))
    cvar("r.Fog", "%d" % int(found["Fog"] if found["Fog"] is not None else 1))
    cvar("wl.Sky.Hour", 12)
    L.release_camera(live())

    got = {k: v for k, v in rows.items() if not v.get("unmeasured")}
    record("X_MEASURED", "every condition produced a reading",
           len(got) == len(CONDITIONS), measured=sorted(got), wanted=[c[0] for c in CONDITIONS])
    worst = max((max(v["spread"], v["ground_luma_spread"]) for v in got.values()), default=None)
    worst_frac = max((v["ground_readable_spread"] for v in got.values()), default=None)
    record("X_NOISE", "every condition agrees with itself on the LUMA it actually measures",
           len(got) == len(CONDITIONS) and worst is not None and worst <= AGREE,
           worst_luma_spread=worst, tolerance=AGREE,
           worst_readable_fraction_spread=worst_frac,
           note="the fraction is a threshold statistic and is amplified near the crush point: the first "
                "run held every frame-luma spread under 0.0010 while one readable fraction moved 0.0107, "
                "and voided on that. Luma is what the instrument reads and what is gated here; the "
                "fraction spread is reported beside it so the amplification is visible rather than hidden")
    if len(got) != len(CONDITIONS) or (worst or 1.0) > AGREE:
        RESULT["status"] = "voided: conditions missing or disagreeing with themselves"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    def rd(label):
        return got[label]["ground_readable"]

    def delta(a, b):
        return round(rd(a) - rd(b), 4)

    # ---- THE POSITIVE CONTROL. Without this a dusk null result is not evidence of anything.
    night_moon_effect = round(rd("night_base") - rd("night_moon_off"), 4)
    record("X_CONTROL", "turning the moon off at 23:00 clearly darkens the ground -- the test can detect it",
           night_moon_effect >= REACHES,
           night_base_readable=rd("night_base"), night_moon_off_readable=rd("night_moon_off"),
           effect=night_moon_effect, needs=REACHES,
           note="at 23:00 the moon stands near 70 degrees and certainly lights the ground. If removing "
                "it changes nothing HERE, this instrument cannot see the moon's contribution anywhere, "
                "the dusk readings below are meaningless, and no conclusion may be drawn from them")
    if night_moon_effect < REACHES:
        RESULT["status"] = "voided: the positive control failed -- the test cannot detect the moon"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    dusk_moon_span = round(rd("dusk_moon_4x") - rd("dusk_moon_off"), 4)
    night_moon_span = round(rd("night_moon_4x") - rd("night_moon_off"), 4)
    record("X_COSINE", "the moon's BRIGHTNESS does not reach the dusk ground -- my explanation, "
                       "stated so that a FAIL kills it",
           abs(dusk_moon_span) < REACHES,
           dusk_readable_moon_off=rd("dusk_moon_off"), dusk_readable_moon_4x=rd("dusk_moon_4x"),
           dusk_span=dusk_moon_span, night_span_for_scale=night_moon_span, threshold=REACHES,
           note="at 18:00 the moon sits at zero elevation and delivers cos(90) to level ground, so on my "
                "account making it four times brighter must do almost nothing. RED here means the moon "
                "does reach the dusk ground, the cosine explanation is WRONG, and I should stop "
                "repeating it")

    fog_effect = round(rd("dusk_fog_off") - rd("dusk_base"), 4)
    record("X_FOG", "turning the fog off at dusk changes the readable ground",
           abs(fog_effect) >= REACHES,
           dusk_base_readable=rd("dusk_base"), dusk_fog_off_readable=rd("dusk_fog_off"),
           effect=fog_effect, night_fog_effect=round(rd("night_fog_off") - rd("night_base"), 4),
           threshold=REACHES,
           note="the atmosphere account. The fog density term peaks at exactly elevation zero, which is "
                "18:00, so if the air is what is eating the ground this is where it shows. GREEN here "
                "supports atmosphere; it does not by itself refute geometry, since both can be true")

    lead_effect = round(rd("dusk_moon_up") - rd("dusk_base"), 4)
    record("X_LEAD", "raising the moon at dusk changes the readable ground",
           abs(lead_effect) >= REACHES,
           dusk_base_readable=rd("dusk_base"), dusk_moon_up_readable=rd("dusk_moon_up"),
           effect=lead_effect, lead_hours=1.5, threshold=REACHES,
           note="the geometry account's positive prediction: the same moon at the same brightness, "
                "18.6 degrees higher, should light ground it could not reach flat on the horizon")

    RESULT["verdict"] = {
        "moon_brightness_reaches_dusk_ground": abs(dusk_moon_span) >= REACHES,
        "fog_removal_changes_dusk_ground": abs(fog_effect) >= REACHES,
        "raising_the_moon_changes_dusk_ground": abs(lead_effect) >= REACHES,
        "moon_brightness_reaches_night_ground": abs(night_moon_span) >= REACHES,
        "effects": {"dusk_moon_span": dusk_moon_span, "dusk_fog_off": fog_effect,
                    "dusk_moon_up": lead_effect, "night_moon_span": night_moon_span,
                    "night_moon_off_control": night_moon_effect},
        "readable": {k: got[k]["ground_readable"] for k in sorted(got)},
        "crushed": {k: got[k]["ground_crushed"] for k in sorted(got)}}
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
