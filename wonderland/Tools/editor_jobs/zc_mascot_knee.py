# THE MASCOT-SPECIFIC RESPONSE SWEEP: does shaping the response fix the mascot eye/blowout cluster?
#
# FOUNDER / QA, 2026-09-27: "zc_glow_sweep already proves the COMPANION can retain its glow without clipping
# by using a response knee ... This does NOT prove 220 is the correct mascot value. It proves the
# RESPONSE-SHAPING STRATEGY works elsewhere. Apply the principle to mascots ... Do not blindly copy the
# Companion's 220. Sweep an appropriate range against the actual mascot materials."
#
# WHAT READING THE ASSETS FIRST CHANGED ABOUT THIS EXPERIMENT. Two facts, both from 44625f33 and the code
# path, and both of which would have made a literal 220/400/700/1100/1800 sweep measure nothing:
#
#   1. THE KNEE IS INERT ON MASCOTS AT THE NEW SCALE. WonderlandTameGlow compresses only ABOVE the knee.
#      wl.Look.GlowKnee ships at 700; after the GLOW_SCALE 4000 -> 6 re-baseline the brightest emissive on
#      any skin is 48 and the brightest BODY glow is 13.2. Every knee in the old range is above every mascot
#      value, so all five would render identically. The live range at this scale is about 2 to 48, and that
#      is what is swept here -- with 700 kept as the shipped control.
#
#   2. THE KNEE CANNOT REACH THE EYES AT ALL, by construction rather than by calibration. The eye branch is
#      `Want = (Authored / Peak) * EyeGlowScale * GlowScale * HaloShare` -- normalised to unit peak, so the
#      authored strength is discarded and only the hue direction survives -- and WonderlandTameGlow is not in
#      that path (it is applied at the body/rim sites only). So "the eyes do not read as glowing" can never be
#      a knee problem. The eye axis is EyeGlowScale, and it is swept as its own axis here.
#
#   3. AND THAT AXIS HAS A CEILING NOBODY HAS BEEN MEASURING. wl.Look.EyeGlowDay ships at 18; SetEyeGlow
#      clamps to [0.05, 12]. The daytime eye level has silently been 12, not 18, for the whole history of
#      this cluster -- so every previous "we raised the eye and nothing happened" reading was taken against a
#      value that could not move. The sweep includes 16 specifically to photograph that: 12 and 16 must come
#      back identical, or the clamp is not where the code says it is.
#
# THE INSTRUMENT, AND WHY IT IS NOT THE OLD ONE. zc_eyes_glow reads an eye patch and a face patch and
# subtracts. That is defeated by exactly the skin it most needs to measure: Celestial Light's head stands
# inside its own halo, the patch saturates, and a saturated patch cannot say whether the eye is bright. This
# sweep measures DIFFERENTIALLY -- every skin and hour is captured once with the eye driven to its floor
# (0.05) and again at each level, and the eye's own contribution is the DIFFERENCE. Whatever surrounds the
# eye is in both frames and cancels. A saturated head no longer hides the answer; it just means the face term
# is large in both frames and subtracts out.
#
#   eye_gain   = eye_luma(level) - eye_luma(floor)      the eye's own added light
#   face_gain  = face_luma(level) - face_luma(floor)    what the level did to the cheek beside it
#   isolation  = eye_gain - face_gain                   the eye reaching the render AS an eye
#
# An isolation at or near zero means the level is not arriving at the rendered eye, which is the founder's
# "if its eye emission is not reaching the rendered eye correctly, a knee alone will not fix it" stated as a
# number. Hue is measured on the ADDED light (level minus floor), not on the lit pixel, so a pale face behind
# the eye cannot launder a grey eye into looking like it kept its colour.
#
# WORLD EXPOSURE IS HELD. The founder was explicit that night-world brightness is a separate requirement and
# that mixing them confounds the experiment. This job touches no sun, sky, moon, fog, exposure or practical
# light, and it asserts the post-process exposure is the same at the end as at the start (X00).
#
# AND IT PUTS EVERY CVAR BACK. The other lane's gates run behind this one on the same PIE, and a knee left at
# 8 would be read as a rebuild result. Restored: GlowKnee 700, EyeGlowDay 18, EyeGlowNight 5, FlameDim 0.40,
# NightGlow 0.20.
import math
import os

import unreal

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "mascot_knee")

#: The five active skins and the founder's three hours, spelled as zc_eyes_glow spells them so the numbers
#: sit beside the existing corpus. Dusk is the hard one: the sun is low and the exposure is still open.
#: THE EIGHT ACTIVE IDS as of 44d6ec1c. The founder ruled the three redone skins are V2 and the previous
#: designs stay in the world as V1, so `apollo` is the new design and `apollo_v1` the old one.
SKINS = globals().get("SKINS", ("relay_og", "celestial_light", "apollo_v1", "apollo",
                                "arden_infernal_v1", "arden_infernal",
                                "skeleton_flame_v1", "skeleton_flame"))
#: ONE HOUR PER RUN. The first attempt swept all three in a single PIE session and PIE was torn down 1m43s
#: in; the job then "measured" a dead world for two more minutes. Ten-minute PIE sessions on this box are not
#: reliable, so the hour is a parameter and the sweep is queued three times.
AXIS = globals().get("AXIS", "eye")          # "eye" or "knee"
HOUR = globals().get("HOUR", 12.0)
HOUR_LABEL = globals().get("HOUR_LABEL", "day")
HOURS = ((HOUR, HOUR_LABEL),)

#: The eye levels. 0.05 is SetEyeGlow's floor and is the differential baseline -- the eye as good as off.
#: 16 is ABOVE the clamp on purpose: it must come back identical to 12.
EYE_FLOOR = 0.05
EYE_LEVELS = (0.05, 4.0, 8.0, 12.0, 16.0)

#: The knee axis, at the scale the assets are actually authored at, with the shipped 700 as the control.
#: Body glow spans 3.3 to 13.2 across the five skins, so anything at or above 16 should be indistinguishable.
KNEES = (700.0, 64.0, 32.0, 16.0, 8.0, 4.0, 2.0)

#: The authored eye colour of each skin, read out of RelaySkins/*.wlvox at 44625f33. Hue retention is measured
#: against these rather than against whatever the renderer happens to produce, because "the established eye
#: hue is preserved" is a claim about the ART, not about the render agreeing with itself.
#: A V1 AND ITS V2 SHARE AN EYE, read from the eight .wlvox and verified identical: the eye is the Dog's
#: STATUS INDICATOR and is deliberately the same instrument on every costume, so the V1/V2 split is body art
#: only. That makes the pairs a free control -- any eye difference between apollo and apollo_v1 is the BODY
#: around the eye changing what the eye reads against, never the eye itself changing.
AUTHORED_EYE = {
    "relay_og":          (1.00, 0.72, 0.16),
    "celestial_light":   (0.62, 0.88, 1.00),
    "apollo":            (1.00, 0.86, 0.26),
    "apollo_v1":         (1.00, 0.86, 0.26),
    "arden_infernal":    (1.00, 0.58, 0.10),
    "arden_infernal_v1": (1.00, 0.58, 0.10),
    "skeleton_flame":    (0.36, 0.95, 1.00),
    "skeleton_flame_v1": (0.36, 0.95, 1.00),
}

#: The shipped defaults this job restores. Named here so the restore cannot drift from the docstring.
SHIPPED = (("wl.Look.GlowKnee", 700.0), ("wl.Look.EyeGlowDay", 18.0), ("wl.Look.EyeGlowNight", 5.0),
           ("wl.Look.FlameDim", 0.40), ("wl.Look.NightGlow", 0.20))

CLIP_CEILING = 0.06       # fraction of the head shot allowed at 250+; the founder's "no white clipping"
CRUSH_CEILING = 0.60      # the guard against winning by making everything dark
ISOLATION_FLOOR = 0.02    # below this the level is not arriving at the rendered eye


def luma(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def job():
    RESULT["status"] = "running"
    tests, rows, knee_rows = [], [], []
    RESULT["tests"], RESULT["eye_axis"], RESULT["knee_axis"] = tests, rows, knee_rows
    os.makedirs(ROOT, exist_ok=True)

    def record_eye(tid, name, ok, **detail):
        """An eye-axis gate. Skipped entirely on a knee-axis run rather than failing on an empty table."""
        if AXIS != "eye":
            return
        record(tid, name, ok, **detail)

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
    world = ues.get_game_world()
    L.focus_game_viewport()
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    yield 5.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    ui = L.get_ui(world)
    RESULT["camera_failures"] = []

    def alive():
        """The world AND the pawn, or None. Every reading is gated on this.

        THE FAILURE THIS EXISTS FOR. The first run had PIE torn down underneath it at 15:08:02 and kept
        going until 15:09:56, emitting a constant 0.0187 -- the luma of a black viewport -- into 31 rows and
        nine gates, where it read as "the eye is dark on every skin". Two gates even passed. A proof that
        cannot tell "the world is gone" from "the eye is not glowing" is not a proof, and this one published
        a dead viewport as a mascot measurement. Nothing is recorded now unless both the world and the pawn
        answer, and the job ABORTS and says where it died rather than filling the table with the dark.
        """
        w = ues.get_game_world()
        if w is None:
            return None
        try:
            return w if unreal.GameplayStatics.get_player_pawn(w, 0) is not None else None
        except Exception:                                              # noqa: BLE001
            return None

    def live():
        """The world, re-fetched every time it is used.

        zc_water_audit died at its first pose_camera with "Cannot nativize 'World' as 'Object'" after holding
        a world reference across many yields. Whatever staled it, a reference captured once at the top of a
        job that runs for ten minutes is the thing that failed, so this one is never captured.
        """
        return ues.get_game_world()

    def cvar(name, value):
        w = live()
        if w is not None:
            unreal.SystemLibrary.execute_console_command(w, "%s %s" % (name, value))

    def pose(eye, aim, fov):
        """Aim the camera, and survive a failure instead of taking the whole sweep down with it."""
        try:
            L.pose_camera(live(), eye, aim, fov)
            return True
        except Exception as err:                                       # noqa: BLE001
            RESULT["camera_failures"].append(str(err)[:140])
            return False

    def exposure_now():
        """The world's own exposure, read so the experiment can prove it never moved."""
        out = []
        for v in unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.PostProcessVolume):
            try:
                s = v.get_editor_property("settings")
                out.append((str(v.get_actor_label())[:28],
                            round(float(s.get_editor_property("auto_exposure_bias")), 4),
                            round(float(s.get_editor_property("auto_exposure_min_brightness")), 4),
                            round(float(s.get_editor_property("auto_exposure_max_brightness")), 4)))
            except Exception:                                          # noqa: BLE001
                pass
        return sorted(out)

    try:
        sub = live().get_subsystem(unreal.WonderlandPracticalLightsSubsystem)
        RESULT["practicals"] = str(sub.describe_practicals()) if sub is not None else "no subsystem"
    except Exception as err:                                           # noqa: BLE001
        RESULT["practicals"] = "unreadable: %s" % str(err)[:90]

    RESULT["died_at"] = None

    def dead(where):
        """Record the death and stop. Never returns data."""
        RESULT["died_at"] = where
        RESULT["status"] = "aborted"
        emit("ABORT", "FAIL", "the world went away during the sweep", {"at": where})

    exposure_before = exposure_now()
    RESULT["exposure_before"] = exposure_before

    def frame_head():
        """Stand the camera off the Dog's head, at zc_eyes_glow's proven reach and lens."""
        d = unreal.GameplayStatics.get_player_pawn(live(), 0)
        if d is None:
            return None
        here = d.get_actor_location()
        yaw = d.get_actor_rotation().yaw
        aim = unreal.Vector(here.x, here.y, here.z + 62.0)
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * 300.0,
                            here.y + math.sin(math.radians(yaw)) * 300.0, here.z + 70.0)
        pose(eye, aim, 32.0)
        return here

    def patch(here, z_above, half_w, half_h, dx=0.0):
        try:
            got = unreal.GameplayStatics.project_world_to_screen(
                unreal.GameplayStatics.get_player_controller(live(), 0),
                unreal.Vector(here.x, here.y, here.z + z_above), False)
        except Exception:                                              # noqa: BLE001
            return None
        if got is None:
            return None
        size = unreal.GameplayStatics.get_player_controller(live(), 0).get_viewport_size()
        vw = float(size[0]) if size and size[0] else 1920.0
        vh = float(size[1]) if size and len(size) > 1 and size[1] else 1080.0
        cx, cy = float(got.x) / vw + dx, float(got.y) / vh
        if not (0.02 < cx < 0.98 and 0.02 < cy < 0.98):
            return None
        r = L.read_screen_rect(cx - half_w, cy - half_h, cx + half_w, cy + half_h)
        if r is None:
            return None
        mean, dark, bright, sampled = r
        return {"rgb": [round(mean.r, 5), round(mean.g, 5), round(mean.b, 5)],
                "luma": round(luma((mean.r, mean.g, mean.b)), 5),
                "dark": round(dark, 4), "bright": round(bright, 4), "samples": int(sampled)}

    def read_all(here):
        """The eye, the cheek beside it, and the whole head shot -- one settled reading."""
        return {"eye": patch(here, 62.0, 0.020, 0.012),
                "face": patch(here, 62.0, 0.020, 0.012, dx=0.048),
                "frame": patch(here, 62.0, 0.42, 0.40)}

    # ---------------------------------------------------------------- AXIS B: the eye level, per skin/hour
    if AXIS != "eye":
        rows_wanted = 0
    # Run first, because it is the axis the founder's complaint is actually about.
    cvar("wl.Look.GlowKnee", 700.0)                 # the shipped control while the eye axis moves
    for hour, hlabel in (HOURS if AXIS == "eye" else ()):
        if alive() is None:
            dead("before the %s pass began" % hlabel)
            return
        cvar("wl.Sky.Hour", "%.2f" % hour)
        yield 3.0
        for skin in SKINS:
            if ui is not None:
                ui.wear_relay_skin(skin)
            yield 2.5
            here = frame_head()
            yield 1.0
            base = None
            for level in EYE_LEVELS:
                if alive() is None:
                    dead("%s/%s level %.2f" % (skin, hlabel, level))
                    return
                # BOTH ends of the day-cycle lerp are set to the same value, so the level under test is the
                # level that arrives whatever the hour is -- otherwise dusk would silently read a blend.
                cvar("wl.Look.EyeGlowDay", "%.3f" % level)
                cvar("wl.Look.EyeGlowNight", "%.3f" % level)
                yield 2.0
                d2 = unreal.GameplayStatics.get_player_pawn(live(), 0)
                if d2 is None:
                    continue
                here = d2.get_actor_location()
                r = read_all(here)
                if r["eye"] is None or r["face"] is None:
                    emit("B_%s_%s_%.2f" % (skin, hlabel, level), "WARN", "eye or cheek off screen", {})
                    continue
                if level == EYE_FLOOR:
                    base = r
                row = {"skin": skin, "hour": hlabel, "level": level,
                       "eye_luma": r["eye"]["luma"], "face_luma": r["face"]["luma"],
                       "over_face": round(r["eye"]["luma"] - r["face"]["luma"], 5),
                       "clipped": r["frame"]["bright"], "crushed": r["frame"]["dark"],
                       "eye_rgb": r["eye"]["rgb"]}
                if base is not None:
                    eg = r["eye"]["luma"] - base["eye"]["luma"]
                    fg = r["face"]["luma"] - base["face"]["luma"]
                    row["eye_gain"] = round(eg, 5)
                    row["face_gain"] = round(fg, 5)
                    row["isolation"] = round(eg - fg, 5)
                    # THE ADDED LIGHT is what carries the eye's colour; the lit pixel underneath does not.
                    add = [max(r["eye"]["rgb"][i] - base["eye"]["rgb"][i], 0.0) for i in range(3)]
                    row["eye_added_rgb"] = [round(v, 5) for v in add]
                    mag = math.sqrt(sum(v * v for v in add))
                    want = AUTHORED_EYE[skin]
                    wmag = math.sqrt(sum(v * v for v in want))
                    row["hue_retention"] = (round(sum(add[i] * want[i] for i in range(3)) / (mag * wmag), 4)
                                            if mag > 1e-5 else None)
                    row["colour_separation"] = (round((max(add) - min(add)) / max(add), 4)
                                                if max(add) > 1e-5 else 0.0)
                rows.append(row)
                emit("B_%s_%s_%04.1f" % (skin, hlabel, level), "INFO", "%s %s eye=%.2f" % (skin, hlabel, level),
                     {k: row.get(k) for k in ("eye_luma", "over_face", "isolation", "clipped", "hue_retention")})
            try:
                L.capture_game_viewport(os.path.join(ROOT, "%s_%s_eye12.png" % (skin, hlabel)))
            except Exception:                                          # noqa: BLE001
                pass

    # ---------------------------------------------------------------- AXIS A: the knee, at the live range
    # Noon only: the knee is a body-glow curve and does not interact with the hour except through exposure,
    # which is held. Its whole job here is to answer whether it does ANYTHING at this asset scale.
    cvar("wl.Look.EyeGlowDay", 12.0)
    cvar("wl.Look.EyeGlowNight", 12.0)
    cvar("wl.Sky.Hour", "12.00")
    yield 3.0
    for skin in (SKINS if AXIS == "knee" else ()):
        if ui is not None:
            ui.wear_relay_skin(skin)
        yield 2.5
        here = frame_head()
        if here is None:
            continue
        yield 1.0
        for knee in KNEES:
            if alive() is None:
                dead("knee axis, %s at %.0f" % (skin, knee))
                return
            cvar("wl.Look.GlowKnee", "%.2f" % knee)
            unreal.SystemLibrary.execute_console_command(live(), "wl.Look.Reglow")
            yield 2.0
            d2 = unreal.GameplayStatics.get_player_pawn(live(), 0)
            if d2 is None:
                continue
            here = d2.get_actor_location()
            r = read_all(here)
            if r["frame"] is None:
                continue
            knee_rows.append({"skin": skin, "knee": knee, "frame_luma": r["frame"]["luma"],
                              "clipped": r["frame"]["bright"], "crushed": r["frame"]["dark"],
                              "face_luma": r["face"]["luma"] if r["face"] else None,
                              "eye_luma": r["eye"]["luma"] if r["eye"] else None})
            emit("A_%s_%05.0f" % (skin, knee), "INFO", "%s knee=%.0f" % (skin, knee),
                 {"frame_luma": r["frame"]["luma"], "clipped": r["frame"]["bright"]})

    # ---------------------------------------------------------------- put the world back
    for name, value in SHIPPED:
        cvar(name, value)
    unreal.SystemLibrary.execute_console_command(live(), "wl.Look.Reglow")
    yield 2.0
    try:
        L.release_camera(live())
    except Exception:  # noqa: BLE001
        pass
    exposure_after = exposure_now()
    RESULT["exposure_after"] = exposure_after
    RESULT["cvars_restored"] = [n for n, _ in SHIPPED]

    # ---------------------------------------------------------------- the gates
    want = len(SKINS) * len(HOURS) * len(EYE_LEVELS) if AXIS == "eye" else 0
    RESULT["axis"] = AXIS
    RESULT["hour"] = HOUR_LABEL
    record("M00", "every skin was sampled at every hour at every eye level",
           len(rows) == want, got=len(rows), wanted=want,
           skins=list(SKINS), hours=[h for _, h in HOURS], levels=list(EYE_LEVELS))

    # X00 COMPARES AT THE SAME HOUR, because the day cycle DRIVES exposure from the hour --
    # PaintTheSky sets AutoExposureBias = Lerp(1.45, -0.9, Daylight) every repaint. The first version
    # compared the bias at whatever hour the world happened to be at on entry against the bias at the hour
    # the sweep finished on, and called the day cycle doing its job a confound. What must not move is the
    # PINNED range (min/max EV100), which is a world setting; the hour-driven bias is expected.
    rng_before = [(v[0], v[2], v[3]) for v in exposure_before]
    rng_after = [(v[0], v[2], v[3]) for v in exposure_after]
    record("X00", "the world's pinned exposure range is untouched -- the experiment is not confounded",
           bool(rng_before) and rng_before == rng_after, before=rng_before, after=rng_after,
           bias_before=[v[1] for v in exposure_before], bias_after=[v[1] for v in exposure_after],
           note="min/max EV100 is the world setting and must not move; AutoExposureBias is driven by the "
                "hour by the day cycle and is expected to differ")

    # THE INSTRUMENT MUST RESPOND, or every other number below is a photograph of nothing.
    moved = [r for r in rows if r.get("isolation") is not None and abs(r["isolation"]) > 1e-4]
    record_eye("M01", "driving the eye level actually changes the rendered eye",
           len(moved) > 0, readings_that_moved=len(moved), of=len(rows),
           note="a flat response here is a broken capture, not a finding about the eyes")

    # 3. THE CLAMP, photographed rather than read off the source.
    clamp = {}
    for skin in SKINS:
        for _, hl in HOURS:
            a = next((r for r in rows if r["skin"] == skin and r["hour"] == hl and r["level"] == 12.0), None)
            b = next((r for r in rows if r["skin"] == skin and r["hour"] == hl and r["level"] == 16.0), None)
            if a and b:
                clamp["%s/%s" % (skin, hl)] = round(b["eye_luma"] - a["eye_luma"], 5)
    identical = [k for k, v in clamp.items() if abs(v) <= 0.002]
    record_eye("M02", "eye level 16 renders identically to 12 -- SetEyeGlow's clamp is real and EyeGlowDay 18 "
                  "has never been reachable",
           len(identical) == len(clamp) and len(clamp) > 0, delta_16_minus_12=clamp,
           identical=len(identical), of=len(clamp),
           note="wl.Look.EyeGlowDay ships at 18 and SetEyeGlow clamps to 12; if this passes, every 'eye "
                "level' number in the corpus was taken at 12")

    # 4. IS THE EYE REACHING THE RENDER, per skin? This is the founder's Celestial question, asked of all five.
    reach = {}
    for skin in SKINS:
        best = [r["isolation"] for r in rows
                if r["skin"] == skin and r.get("isolation") is not None and r["level"] == 12.0]
        reach[skin] = round(max(best), 5) if best else None
    arriving = [s for s, v in reach.items() if v is not None and v >= ISOLATION_FLOOR]
    record_eye("M03", "on every skin the eye level arrives at the rendered EYE and not merely at the head",
           len(arriving) == len(SKINS), isolation_at_level_12=reach, floor=ISOLATION_FLOOR,
           arriving=arriving, not_arriving=[s for s in SKINS if s not in arriving],
           note="isolation = the eye patch's gain minus the cheek's gain, so a head that glows as a whole "
                "cannot pass this; near zero means the emission is not reaching the eye and no knee will fix it")

    # 5. CONTRAST, at the shipped-equivalent level, on unclipped samples.
    contrast = {}
    for skin in SKINS:
        for _, hl in HOURS:
            r = next((x for x in rows if x["skin"] == skin and x["hour"] == hl and x["level"] == 12.0), None)
            if r:
                contrast["%s/%s" % (skin, hl)] = r["over_face"]
    positive = [k for k, v in contrast.items() if v > 0.0]
    record_eye("M04", "the eye is brighter than the face beside it, on every skin at every hour",
           len(positive) == len(contrast) and len(contrast) > 0, over_face=contrast,
           positive=len(positive), of=len(contrast),
           note="measured against a cheek patch, at eye level 12, which is what the shipped 18 actually "
                "resolves to")

    # 6. NO WHITE CLIPPING, and 7. NOT WON BY GOING DARK.
    worst_clip = max((r["clipped"] for r in rows if r["level"] == 12.0), default=1.0)
    worst_crush = max((r["crushed"] for r in rows if r["level"] == 12.0), default=1.0)
    record_eye("M05", "a mascot filling the frame is not blown out at the shipped eye level",
           worst_clip <= CLIP_CEILING, worst_clipped=worst_clip, ceiling=CLIP_CEILING,
           per_skin={s: max((r["clipped"] for r in rows if r["skin"] == s and r["level"] == 12.0), default=None)
                     for s in SKINS})
    record_eye("M06", "and that is not achieved by making the picture dark",
           worst_crush <= CRUSH_CEILING, worst_crushed=worst_crush, ceiling=CRUSH_CEILING)

    # 8. THE EYE KEPT ITS COLOUR.
    hues = {}
    seps = {}
    for skin in SKINS:
        v = [r["hue_retention"] for r in rows
             if r["skin"] == skin and r["level"] == 12.0 and r.get("hue_retention") is not None]
        s2 = [r["colour_separation"] for r in rows
              if r["skin"] == skin and r["level"] == 12.0 and r.get("colour_separation") is not None]
        hues[skin] = round(min(v), 4) if v else None
        seps[skin] = round(min(s2), 4) if s2 else None
    kept = [s for s, v in hues.items() if v is not None and v >= 0.95]
    record_eye("M07", "the added eye light still points at the skin's authored eye colour",
           len(kept) == len(SKINS), hue_retention=hues, authored=AUTHORED_EYE, floor=0.95,
           note="cosine of the ADDED light against the authored RGB; measured on the difference so a pale "
                "face behind the eye cannot launder a grey eye into looking coloured")
    record_eye("M08", "the eye is a coloured core rather than a white one",
           all(v is not None and v >= 0.25 for v in seps.values()), colour_separation=seps, floor=0.25,
           note="channel spread of the added light; a white-clipped eye reads near 0")

    # 9. THE KNEE AXIS: does it do anything at this asset scale?
    spread = {}
    for skin in SKINS:
        v = [r["frame_luma"] for r in knee_rows if r["skin"] == skin]
        spread[skin] = round(max(v) - min(v), 5) if v else None
    inert = [s for s, v in spread.items() if v is not None and v <= 0.005]
    engaged = {}
    for skin in SKINS:
        ctrl = next((r["frame_luma"] for r in knee_rows if r["skin"] == skin and r["knee"] == 700.0), None)
        for kn in sorted(k for k in KNEES if k != 700.0):
            v = next((r["frame_luma"] for r in knee_rows if r["skin"] == skin and r["knee"] == kn), None)
            if ctrl is not None and v is not None and abs(v - ctrl) > 0.005:
                engaged[skin] = kn
                break
    record("M09", "the knee's live range at this asset scale is measured, not assumed",
           len(knee_rows) == (len(SKINS) * len(KNEES) if AXIS == "knee" else 0),
           frame_luma_spread_across_knees=spread, inert_skins=inert,
           first_knee_that_changes_the_picture=engaged, knees_swept=list(KNEES),
           note="body glow spans 3.3-13.2 after the 4000->6 re-baseline, so a knee at the shipped 700 "
                "compresses nothing; this says where it starts to bite and whether it helps")

    RESULT["summary"] = {"eye_isolation_at_12": reach, "over_face_at_12": contrast,
                         "hue_retention": hues, "colour_separation": seps,
                         "knee_spread": spread, "knee_engages_at": engaged,
                         "worst_clipped": worst_clip, "worst_crushed": worst_crush}
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
