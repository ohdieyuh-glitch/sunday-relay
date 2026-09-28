# CAN THE SHAPED FIRE MATERIAL REACH THE APPROVED PLUME'S HEIGHT WITHOUT GOING WHITE?
#
# FOUNDER, P0 item 4: "believable animated Unreal fire, not plastic voxel flames... with flicker, emissive
# falloff, softness/distortion". And, over a video of the Dog in the plaza, 2026-09-26: "THESE ARE THE FLAMES
# I NEED BACK" -- tall plumes rising a head's height above the shoulders, readable against a sunlit lawn and
# against a dark plaza both.
#
# THIS IS NOT A DECISION AND THE SOURCE ALREADY SAYS SO. WonderlandCompanionEmbodiment.cpp records that
# M_WL_Fire is the better surface -- "soft across the ribbon, falling off at the tip, flicker climbing it" --
# and that it was reverted to the voxel glow only because its shaping takes the PROMINENCE out of the flame,
# which is what the founder's footage is about. Its own comment sets the task: it "may yet be the right base
# ONCE IT CAN REACH THAT BRIGHTNESS WITHOUT LOSING ITS COLOUR." Nobody has tested whether it can.
#
# WHAT IS ALREADY KNOWN ABOUT THE KNOB. wl.Look.FireGain is 60. At 200 an earlier run measured the flame's
# own crop at 0.87 and 0.91 over white against a 0.45 ceiling -- washed out. So the answer, if there is one,
# is between them, and nobody has walked it.
#
# WHAT WAS NEVER MEASURED IS THE THING THE FOUNDER ACTUALLY ASKED FOR. Every previous instrument judged
# BRIGHTNESS or CLIPPING. The founder's word is a tall plume rising above the shoulders -- that is HEIGHT,
# and a flame can be bright and short or dim and tall. So this measures the plume's REACH above the figure
# and its colour retention together, because the trade between them is the whole question.
#
# MEASURED IN THE GAME VIEWPORT AT GAMEPLAY DISTANCE, not in the wardrobe and not from inside the fire. A
# first attempt stood the camera at 420 uu and the flame filled the entire frame -- 83,000 hot pixels, the
# camera inside the plume -- so "how far does it reach" had no meaning and the body swamped every reading.
#
# AT NIGHT, where a bright pixel above the Dog is flame rather than sky, with the clock STOPPED first.
#
# THE CONTROL IS MATERIAL 0, the approved look, measured in the same run at the same spot. Its plume height
# is the target the sweep is trying to reach -- an absolute anyone would have to invent otherwise.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import hashlib
import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary
SL = unreal.SystemLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "fire_reach")
FIRE = "wl.Look.FireMaterial"
GAIN = "wl.Look.FireGain"
SKIN = "arden_infernal"
HOUR = 23.6
DISTANCE = 900.0
FRAMES = 6
# (label, material, gain or None to leave it)
RUNGS = (
    ("approved_voxel_glow", 0, None),
    ("shaped_g60", 1, 60.0),
    ("shaped_g100", 1, 100.0),
    ("shaped_g140", 1, 140.0),
    ("shaped_g180", 1, 180.0),
)
HOT = 0.42
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
            return round(float(SL.get_console_variable_float_value(name)), 4)
        except Exception:                                           # noqa: BLE001
            return None

    def fingerprint(path):
        try:
            with open(path, "rb") as fh:
                return hashlib.md5(fh.read()).hexdigest()
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

    as_found = {FIRE: cvar(FIRE), GAIN: cvar(GAIN)}
    RESULT["as_found"] = as_found
    record("R_READ", "both fire knobs can be read back before anything is changed",
           all(v is not None for v in as_found.values()), as_found=as_found)
    if any(v is None for v in as_found.values()):
        RESULT["status"] = "VOID: a fire knob is not readable"
        return

    SL.execute_console_command(world, "wl.Sky.DayMinutes 0")
    yield 1.0
    SL.execute_console_command(world, "wl.Sky.Hour %.2f" % HOUR)
    yield 4.0
    RESULT["day_minutes"] = cvar("wl.Sky.DayMinutes")
    record("R_CLOCK", "the day clock is stopped", RESULT["day_minutes"] == 0.0,
           day_minutes=RESULT["day_minutes"])

    try:
        ui.wear_relay_skin(SKIN)
    except Exception as err:                                        # noqa: BLE001
        RESULT["status"] = "VOID: could not wear %s (%s)" % (SKIN, str(err)[:90])
        return
    yield 6.0

    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "Tools"))
    from night_figure import read                                   # noqa: E402

    stood_at = dog.get_actor_location()

    def look():
        yaw = dog.get_actor_rotation().yaw
        mid = stood_at.z + 70.0
        eye = unreal.Vector(stood_at.x + math.cos(math.radians(yaw)) * DISTANCE,
                            stood_at.y + math.sin(math.radians(yaw)) * DISTANCE, mid + 40.0)
        L.pose_camera(world, eye, unreal.Vector(stood_at.x, stood_at.y, mid), 42.0)

    def plume(path):
        """How high the flame reaches, and whether it kept its colour.

        THE COLUMN, NOT THE FRAME. The Dog is centred by the camera, so a narrow central column contains the
        figure and its plume and excludes the companions that stand either side of it -- which defeated a
        previous attempt at a lower band. The HUD strip along the bottom is cut off.
        """
        w, h, chan, px = read(path)
        x0, x1 = int(w * 0.42), int(w * 0.58)
        y0, y1 = int(h * 0.02), int(h * 0.80)
        top_row = None
        hot = 0
        over_white = 0
        warm = 0
        for y in range(y0, y1, STEP):
            for x in range(x0, x1, STEP):
                i = (y * w + x) * chan
                R, G, B = px[i], px[i + 1], px[i + 2]
                lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255.0
                if lum < HOT:
                    continue
                hot += 1
                if top_row is None:
                    top_row = y
                if min(R, G, B) >= 225:
                    over_white += 1
                if R > B + 25:
                    warm += 1
        if not hot:
            return {"hot_px": 0, "reach_pct": 0.0, "over_white_fraction": None, "warm_fraction": None}
        return {"hot_px": hot,
                # 1.0 means the flame reaches the top of the frame, 0.0 that it never rises above the base.
                "reach_pct": round(100.0 * (float(y1 - top_row) / float(y1 - y0)), 2),
                "over_white_fraction": round(over_white / float(hot), 4),
                "warm_fraction": round(warm / float(hot), 4)}

    rungs = {}
    RESULT["rungs"] = rungs
    for label, material, gain in RUNGS:
        SL.execute_console_command(world, "%s %d" % (FIRE, material))
        if gain is not None:
            SL.execute_console_command(world, "%s %.2f" % (GAIN, gain))
        yield 4.0
        back = {FIRE: cvar(FIRE), GAIN: cvar(GAIN)}
        shots, prints = [], []
        for k in range(FRAMES):
            look()
            yield 0.35
            path = os.path.join(ROOT, "%s_%02d.png" % (label, k))
            try:
                if not L.capture_game_viewport(path):
                    continue
            except Exception:                                       # noqa: BLE001
                continue
            shots.append(plume(path))
            prints.append(fingerprint(path))
        L.release_camera(world)

        def avg(key):
            vals = [s[key] for s in shots if s.get(key) is not None]
            return round(sum(vals) / len(vals), 4) if vals else None

        rungs[label] = {"asked": {"material": material, "gain": gain}, "read_back": back,
                        "frames": len(shots), "distinct_frames": len(set(p for p in prints if p)),
                        "reach_pct": avg("reach_pct"), "hot_px": avg("hot_px"),
                        "over_white_fraction": avg("over_white_fraction"),
                        "warm_fraction": avg("warm_fraction")}
        emit("R_%s" % label, "INFO", label, rungs[label])

    for k, v in as_found.items():
        SL.execute_console_command(world, "%s %g" % (k, v))
    yield 2.0
    RESULT["restored"] = {FIRE: cvar(FIRE), GAIN: cvar(GAIN)}
    record("R_RESTORE", "both fire knobs this job found were put back",
           all(RESULT["restored"][k] == as_found[k] for k in as_found),
           as_found=as_found, restored=RESULT["restored"])
    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass
    yield 3.0

    refused = []
    for label, material, gain in RUNGS:
        row = rungs.get(label) or {}
        b = row.get("read_back") or {}
        if b.get(FIRE) is None or abs(b[FIRE] - material) > 0.001:
            refused.append("%s material asked %s read %s" % (label, material, b.get(FIRE)))
        if gain is not None and (b.get(GAIN) is None or abs(b[GAIN] - gain) > 0.01):
            refused.append("%s gain asked %s read %s" % (label, gain, b.get(GAIN)))
    RESULT["rungs_that_did_not_take"] = refused or None
    record("R01", "every rung set the material and gain it asked for", not refused, refused=refused or None,
           note="wl.Look.FireMaterial is recorded in this tree as having refused a value once, so both knobs "
                "are asserted rather than assumed.")

    thin = [k for k, v in rungs.items() if (v.get("distinct_frames") or 0) < 3]
    record("R02", "every rung photographed several distinct frames", not thin,
           frames={k: v.get("distinct_frames") for k, v in rungs.items()}, thin=thin or None,
           note="the flame animates, so identical frames would mean the capture, not the fire, is frozen.")

    approved = rungs.get("approved_voxel_glow") or {}
    target = approved.get("reach_pct")
    RESULT["approved_reach_pct"] = target
    RESULT["approved_over_white"] = approved.get("over_white_fraction")

    table = {k: {"reach_pct": v.get("reach_pct"), "over_white": v.get("over_white_fraction"),
                 "warm": v.get("warm_fraction")} for k, v in rungs.items()}
    RESULT["reach_against_colour"] = table
    emit("R03", "INFO", "how high each fire reaches, and what it costs in colour", table)

    # A rung qualifies if it reaches at least as far as the approved plume AND keeps its colour.
    CEILING = 0.45
    good = [k for k, v in rungs.items()
            if k != "approved_voxel_glow" and v.get("reach_pct") is not None and target is not None
            and v["reach_pct"] >= target * 0.90
            and (v.get("over_white_fraction") if v.get("over_white_fraction") is not None else 1.0) <= CEILING]
    RESULT["shaped_rungs_that_match_the_approved_reach"] = good or None
    record("R04", "the shaped material can reach the approved plume's height while keeping its colour",
           bool(good), qualifying=good or None, approved_reach_pct=target,
           colour_ceiling=CEILING, table=table,
           note="THE QUESTION THE SOURCE LEFT OPEN -- M_WL_Fire 'may yet be the right base once it can reach "
                "that brightness without losing its colour'. If no rung qualifies, the answer is that gain "
                "alone cannot get there and the material itself needs work, which is a far more useful "
                "result than another side-by-side.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
