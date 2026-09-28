# DOES THE FIRE FLICKER, AND DOES IT STOP BEING A WHITE HOLE? MEASURED OVER TIME, IN THE WORLD.
#
# FOUNDER, P0 item 4: "Arden Infernal and Skeleton Flame need believable animated Unreal fire, not plastic
# voxel flames. Use performant Niagara/material fire with FLICKER, EMISSIVE FALLOFF, softness/distortion,
# proper attachment."
#
# I HAVE BEEN TREATING THIS AS A DECISION AND IT IS NOT ONE. There are two fire surfaces behind
# wl.Look.FireMaterial, and the founder's sentence lists the properties the shipping one must have. That is
# a measurement, not a preference: the shipped flame was recorded at luma 1.000, blown 1.000 and a temporal
# swing of 0.00024 -- a completely clipped white shape that does not move. It fails "flicker" and "emissive
# falloff" on its face. The candidate draws at 0.144, never blows out, and nobody has ever measured whether
# it FLICKERS, which is the first word in the founder's list.
#
# WHY IN THE WORLD AND NOT THE WARDROBE, even though the wardrobe is cleaner. The wardrobe preview is a
# SceneCapture refreshed on its own interval, so consecutive viewport grabs of that panel can return the same
# render target content twice -- which would alias a flickering flame into a still one and produce exactly
# the "swing 0.0002" reading that started this. The game viewport renders every frame, so time is real there.
#
# AT NIGHT, so the flame is unambiguous. The brightest pixels in a night frame around the Dog ARE the fire;
# by day they would be sky and sunlit stone. The clock is stopped first -- at the default of 24 a game hour
# passes every real minute and this job runs for several, which has silently ruined readings in this tree
# before.
#
# THE CONTROL COMES FIRST AND IT IS THE ONE THIS TREE KEEPS NEEDING. wl.Look.FireMaterial has been recorded
# as refusing the value it is given. If both arms produce the same picture, the switch did nothing and
# neither arm's numbers mean anything -- so the run VOIDS rather than reporting that the two fires are
# identical, which is what a dead switch looks like from the inside.
#
# WHAT THIS DOES NOT DECIDE: which fire looks better is the founder's. This says which one moves, which one
# clips, and which one falls off at its edges -- the three properties their sentence actually names.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary
SL = unreal.SystemLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "fire_flicker")
FIRE = "wl.Look.FireMaterial"
SKIN = "arden_infernal"
HOUR = 23.6
FRAMES = 18
GAP = 0.30
DISTANCE = 420.0
# A pixel this bright at night, near the Dog, is the fire.
HOT = 0.55
STEP = 2


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".png", ".jpg")):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def cvar(name):
        try:
            return round(float(SL.get_console_variable_float_value(name)), 6)
        except Exception:                                           # noqa: BLE001
            return None

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
    yield 6.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    if ui is None or dog is None:
        RESULT["status"] = "VOID: no UI subsystem or no pawn"
        return

    as_found_fire = cvar(FIRE)
    RESULT["as_found_fire_material"] = as_found_fire
    record("F_READ", "the fire material knob can be read back before anything is changed",
           as_found_fire is not None, fire_material=as_found_fire)
    if as_found_fire is None:
        RESULT["status"] = "VOID: wl.Look.FireMaterial is not readable"
        return

    # ---- STOP THE CLOCK BEFORE SETTING THE HOUR. At the default of 24 a game hour passes every real minute.
    SL.execute_console_command(world, "wl.Sky.DayMinutes 0")
    yield 1.0
    SL.execute_console_command(world, "wl.Sky.Hour %.2f" % HOUR)
    yield 4.0
    RESULT["day_minutes"] = cvar("wl.Sky.DayMinutes")
    record("F_CLOCK", "the day clock is stopped, so the hour stays where it was put",
           RESULT["day_minutes"] == 0.0, day_minutes=RESULT["day_minutes"],
           note="a job that runs for minutes against a running clock photographs a moving sky and blames "
                "the subject.")

    try:
        ui.wear_relay_skin(SKIN)
    except Exception as err:                                        # noqa: BLE001
        RESULT["status"] = "VOID: could not wear %s (%s)" % (SKIN, str(err)[:90])
        return
    yield 6.0

    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "Tools"))
    from night_figure import read                                   # noqa: E402

    def look():
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw
        mid = here.z + 70.0
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * DISTANCE,
                            here.y + math.sin(math.radians(yaw)) * DISTANCE, mid + 20.0)
        L.pose_camera(world, eye, unreal.Vector(here.x, here.y, mid), 42.0)

    def hot_pixels(path):
        """How much fire there is, how bright it is, and whether it is clipped -- in ONE frame."""
        w, h, chan, px = read(path)
        # The middle of the frame is the Dog; the strip along the bottom is the HUD and is excluded.
        x0, x1 = int(w * 0.28), int(w * 0.72)
        y0, y1 = int(h * 0.05), int(h * 0.80)
        n = 0
        tot = 0.0
        clipped = 0
        warm = 0
        for y in range(y0, y1, STEP):
            for x in range(x0, x1, STEP):
                i = (y * w + x) * chan
                R, G, B = px[i], px[i + 1], px[i + 2]
                lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255.0
                if lum < HOT:
                    continue
                n += 1
                tot += lum
                if min(R, G, B) >= 247:
                    clipped += 1
                if R > B + 20:
                    warm += 1
        return {"hot_px": n, "mean_luma": round(tot / n, 4) if n else 0.0,
                "clipped_fraction": round(clipped / float(n), 4) if n else 0.0,
                "warm_fraction": round(warm / float(n), 4) if n else 0.0}

    def spread(values):
        if len(values) < 2:
            return None
        m = sum(values) / len(values)
        var = sum((v - m) ** 2 for v in values) / (len(values) - 1)
        return {"mean": round(m, 4), "stddev": round(math.sqrt(var), 4),
                "swing": round(max(values) - min(values), 4),
                "relative_stddev": round(math.sqrt(var) / m, 4) if m else None}

    arms = {}
    RESULT["arms"] = arms
    for material in (0, 1):
        SL.execute_console_command(world, "%s %d" % (FIRE, material))
        yield 3.0
        back = cvar(FIRE)
        rows = []
        prints = []
        for k in range(FRAMES):
            look()
            yield GAP
            path = os.path.join(ROOT, "fire_%d_%02d.png" % (material, k))
            try:
                if not L.capture_game_viewport(path):
                    continue
            except Exception:                                       # noqa: BLE001
                continue
            rows.append(hot_pixels(path))
            prints.append(fingerprint(path))
        L.release_camera(world)
        counts = [r["hot_px"] for r in rows]
        lumas = [r["mean_luma"] for r in rows if r["hot_px"]]
        arms[str(material)] = {
            "asked": material, "read_back": back, "frames": len(rows),
            "distinct_frames": len(set(p for p in prints if p)),
            "hot_px": spread([float(c) for c in counts]) if counts else None,
            "mean_luma": spread(lumas) if lumas else None,
            "clipped_fraction": round(sum(r["clipped_fraction"] for r in rows) / len(rows), 4) if rows else None,
            "warm_fraction": round(sum(r["warm_fraction"] for r in rows) / len(rows), 4) if rows else None,
        }
        emit("F_%d" % material, "INFO", "fire material %d" % material, arms[str(material)])

    # ---- PUT IT BACK, AND READ IT BACK.
    SL.execute_console_command(world, "%s %d" % (FIRE, int(as_found_fire)))
    yield 2.0
    RESULT["restored_fire_material"] = cvar(FIRE)
    record("F_RESTORE", "the fire material this job found was put back",
           RESULT["restored_fire_material"] == as_found_fire,
           as_found=as_found_fire, restored=RESULT["restored_fire_material"])
    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass
    yield 3.0

    a0, a1 = arms.get("0") or {}, arms.get("1") or {}
    took = (a0.get("read_back") == 0 and a1.get("read_back") == 1)
    record("F_KNOB", "the fire material knob took both values it was given",
           took, arm0=a0.get("read_back"), arm1=a1.get("read_back"),
           note="this knob is recorded in this tree as having refused the value it was given, which is why "
                "it is asserted rather than assumed.")

    moved = (a0.get("mean_luma") or {}).get("mean"), (a1.get("mean_luma") or {}).get("mean")
    live = bool(took and all(v is not None for v in moved) and abs(moved[0] - moved[1]) > 0.02)
    RESULT["switch_is_live"] = {"arm0_mean_luma": moved[0], "arm1_mean_luma": moved[1]}
    record("F_LIVE", "the two fire materials are actually different pictures",
           live, **RESULT["switch_is_live"],
           note="THE CONTROL. If both arms photograph the same, the switch did nothing and neither arm's "
                "numbers mean anything -- which from the inside looks exactly like two fires that happen to "
                "be identical.")
    if not live:
        RESULT["status"] = "VOID: the fire material switch could not be shown to change the picture"
        return

    # ---- THE FOUNDER'S THREE WORDS, one clause each, reported per arm rather than as one verdict.
    verdict = {}
    for key, arm in arms.items():
        verdict[key] = {
            "flicker_relative_stddev": (arm.get("hot_px") or {}).get("relative_stddev"),
            "luma_swing": (arm.get("mean_luma") or {}).get("swing"),
            "clipped_fraction": arm.get("clipped_fraction"),
            "distinct_frames": arm.get("distinct_frames"),
            "frames": arm.get("frames"),
        }
    RESULT["verdict"] = verdict
    emit("F02", "INFO", "what each fire does over time", verdict)

    def flickers(key):
        v = verdict.get(key) or {}
        return (v.get("flicker_relative_stddev") or 0.0) >= 0.05 and (v.get("distinct_frames") or 0) >= 6

    def clips(key):
        return (verdict.get(key) or {}).get("clipped_fraction", 1.0) > 0.20

    RESULT["fires_that_flicker"] = [k for k in verdict if flickers(k)]
    RESULT["fires_that_clip"] = [k for k in verdict if clips(k)]
    record("F03", "at least one fire surface actually flickers frame to frame",
           bool(RESULT["fires_that_flicker"]), verdict=verdict,
           flickers=RESULT["fires_that_flicker"], floor_relative_stddev=0.05,
           note="the founder's first word. Measured as the frame-to-frame variation in how much of the "
                "screen is alight, over %d frames %.2fs apart in the game viewport, where time is real."
                % (FRAMES, GAP))
    record("F04", "at least one fire surface does not clip to white",
           len(RESULT["fires_that_clip"]) < len(verdict), verdict=verdict,
           clips=RESULT["fires_that_clip"], ceiling=0.20,
           note="the founder's 'emissive falloff': a shape that is 100% clipped has no falloff to see, "
                "whatever its material does.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
