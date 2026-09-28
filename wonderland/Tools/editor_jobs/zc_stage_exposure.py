# THE WARDROBE'S EMISSIVE GOES FROM INVISIBLE TO CLIPPED WITH NOTHING IN BETWEEN. CAN EXPOSURE OPEN IT UP?
#
# WHERE THIS STANDS, with an instrument that can finally be trusted. SetGlowScale was discarding any value
# within 0.001 of the current one while wl.Look.PreviewGlow shipped at exactly 0.001, so every earlier sweep
# of this term was measuring a knob that refused it. With that fixed, asked and applied now agree at every
# rung including a genuine zero, and the picture is this:
#
#     glow 0.000   blue 0.032   blown 0.000   luma 0.257
#     glow 0.001   blue 0.099   blown 0.075   luma 0.438      <- shipped
#     glow 0.003   blue 0.026   blown 0.360   luma 0.412
#     glow 0.100   blue 0.132   blown 0.352   luma 0.476
#
# Between a thousandth and three thousandths the blown fraction goes 0.075 to 0.360. The spectral sections
# are absent just below that and clipped just above it, and NO VALUE OF THIS KNOB puts them in between.
# In-world the same costume measures blue 0.837 with blown 0.000, so the colour is perfectly renderable --
# it is this room that has no room for it.
#
# THAT IS A DYNAMIC RANGE PROBLEM, NOT A LEVEL ONE, and it is the first thing tonight that the glow term
# cannot be asked to solve. Scaling the emissive moves the figure up and down past a white point that is too
# close to it; what is needed is to move the WHITE POINT. In the world, ghost emits on the order of 700
# against a white near 25,000 and reads as saturated blue. In a dark box a few centimetres across at an open
# exposure, the same emissive is far over white and can only clip.
#
# WHY EXPOSURE HAS TO BE RE-TESTED RATHER THAN TRUSTED. This file's own history records a thirteen-stop bias
# sweep "changing almost nothing" and calls it a dead lever. That conclusion was reached with the glow term
# ALSO dead, which is the same evening's other mistake -- and the tell for both was identical: several rungs,
# one picture. The capture already runs AEM_Manual with min and max brightness pinned at 1.0 and the bias
# taken from wl.Look.PreviewExposure, so the bias is the only exposure control here and it deserves one
# honest measurement before it is written off a second time.
#
# THE GLOW IS HELD AT 0.003 THROUGHOUT, deliberately at the clipped end. A rung that is already blown is the
# only starting point where "did exposure make room" is answerable: from 0.001 a fall in the blown fraction
# could just as easily be the emissive dropping back out of sight.
#
# WHAT WOULD SETTLE IT: blue rising well above 0.099 while blown falls toward 0.000, with Relay OG still a
# legible figure rather than a silhouette. If instead every rung stays clipped OR the whole frame simply
# darkens together with no colour recovered, exposure is genuinely not the lever and the next candidate is
# the stage's own white point -- its lamp levels and the scene-unit scale the emissive is multiplied into.
#
# RELAY OG IS THE FLOOR CONTROL. It has no fire of its own, so it cannot be rescued by any of this; it is
# here to catch a rung that "fixes" Skeleton Flame by making the wardrobe too dark to read.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary
SL = unreal.SystemLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "stage_exposure")
SKINS = ["skeleton_flame", "relay_og"]

GLOW = "wl.Look.PreviewGlow"
EXPOSURE = "wl.Look.PreviewExposure"

HELD_GLOW = 0.003
# (name, exposure bias in stops)
RUNGS = [
    ("ev_0", 0.0),
    ("ev_minus2", -2.0),
    ("ev_minus4", -4.0),
    ("ev_minus6", -6.0),
    ("ev_minus8", -8.0),
]


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
            return round(float(SL.get_console_variable_float_value(name)), 8)
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

    as_found = {GLOW: cvar(GLOW), EXPOSURE: cvar(EXPOSURE)}
    RESULT["as_found"] = as_found
    record("X00", "both terms can be read back before anything is changed",
           all(v is not None for v in as_found.values()), as_found=as_found)
    if any(v is None for v in as_found.values()):
        RESULT["status"] = "VOID: a term is not readable"
        return

    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    pressed = ui.press_switch_skin()
    yield 4.0
    record("X01", "the wardrobe is open through the founder's own SWITCH SKIN button",
           bool(pressed) and ui.is_brain_skins_open(),
           pressed=bool(pressed), skins_open=ui.is_brain_skins_open())

    rect = ui.get_skin_preview_rect()
    got = rect is not None
    centre, size = rect if got else (None, None)
    RESULT["preview_rect"] = {"got": got,
                              "centre": [round(centre.x, 4), round(centre.y, 4)] if got else None,
                              "size": [round(size.x, 4), round(size.y, 4)] if got else None}
    record("X02", "the preview window has painted and reports where it is", got, **RESULT["preview_rect"])
    if not got:
        RESULT["status"] = "VOID: no preview rect"
        return

    def patch(cx, cy, hw, hh):
        out = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
        if out is None:
            return None
        mean, dark, bright, sampled = out
        return {"mean": [round(mean.r, 4), round(mean.g, 4), round(mean.b, 4)],
                "luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4),
                "blue_over_red": round(mean.b - mean.r, 4),
                "bright": round(bright, 4), "samples": int(sampled)}

    readings = {}
    RESULT["readings"] = readings
    for skin in SKINS:
        try:
            ui.wear_relay_skin(skin)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[skin] = str(err)[:140]
            continue
        yield 6.0
        rows = {}
        for name, ev in RUNGS:
            SL.execute_console_command(world, "%s %.8f" % (GLOW, HELD_GLOW))
            SL.execute_console_command(world, "%s %.8f" % (EXPOSURE, ev))
            yield 2.5
            back = {GLOW: cvar(GLOW), EXPOSURE: cvar(EXPOSURE)}
            try:
                applied = round(float(ui.get_preview_glow_applied()), 8)
            except Exception:                                       # noqa: BLE001
                applied = None
            whole = patch(centre.x, centre.y, size.x * 0.38, size.y * 0.38)
            shot = os.path.join(ROOT, "%s__%s.png" % (skin, name))
            try:
                L.capture_game_viewport(shot)
            except Exception:                                       # noqa: BLE001
                pass
            yield 0.6
            rows[name] = {"asked_ev": ev, "read_back": back, "glow_applied": applied,
                          "whole": whole, "capture": os.path.basename(shot)}
            emit("X_%s_%s" % (skin, name), "INFO", "%s at %s" % (skin, name),
                 {"ev": back[EXPOSURE], "glow_applied": applied,
                  "whole_luma": whole["luma"] if whole else None,
                  "blue_over_red": whole["blue_over_red"] if whole else None})
        readings[skin] = rows

    for name, value in as_found.items():
        SL.execute_console_command(world, "%s %.8f" % (name, value))
    yield 2.0
    restored = {GLOW: cvar(GLOW), EXPOSURE: cvar(EXPOSURE)}
    RESULT["restored"] = restored
    record("X_RESTORE", "the two terms this job found were put back",
           all(restored[k] == as_found[k] for k in as_found), as_found=as_found, restored=restored)

    try:
        ui.wear_relay_skin("relay_og")
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["restore_skin"] = str(err)[:140]
    yield 3.0
    try:
        worn_back = str(dog.get_worn_skin_id())
    except Exception:                                               # noqa: BLE001
        worn_back = None
    RESULT["worn_after_restore"] = worn_back
    record("X_SKIN", "Relay OG was put back on the Dog, and it went back",
           worn_back is not None and "relay_og" in worn_back.lower(), worn_after_restore=worn_back)

    # ---- THE KNOBS TOOK, INPUT AND OUTPUT BOTH. The glow is held, so its APPLIED value must not drift.
    bad = []
    for skin, rows in readings.items():
        for name, ev in RUNGS:
            row = rows.get(name)
            if row is None:
                bad.append("%s/%s missing")
                continue
            if row["read_back"][EXPOSURE] is None or abs(row["read_back"][EXPOSURE] - ev) > 1e-6:
                bad.append("%s/%s ev asked %g read %s" % (skin, name, ev, row["read_back"][EXPOSURE]))
            if row["glow_applied"] is None or abs(row["glow_applied"] - HELD_GLOW) > 1e-6:
                bad.append("%s/%s glow held %g but figure wears %s"
                           % (skin, name, HELD_GLOW, row["glow_applied"]))
    RESULT["rungs_that_did_not_take"] = bad or None
    record("X03", "every rung set the exposure it asked for, and the figure held the glow throughout",
           not bad, refused=bad or None,
           note="BOTH ENDS. The exposure is the term being swept, so its cvar is read back; the glow is the "
                "term being HELD, so what the figure WEARS is read back. Reading only the cvar is what let a "
                "whole sweep run against a knob that was refusing every value.")

    ladder = {s: {n: (rows.get(n) or {}).get("whole", {}).get("luma") for n, _ in RUNGS}
              for s, rows in readings.items()}
    RESULT["luma_ladder"] = ladder
    distinct = {s: len({v for v in row.values() if v is not None}) for s, row in ladder.items()}
    RESULT["distinct_luma_by_skin"] = distinct
    record("X04", "the exposure ladder produced more than one picture",
           bool(distinct) and all(v > 1 for v in distinct.values()),
           luma_ladder=ladder, distinct=distinct,
           note="THE CONTROL THAT WOULD HAVE CAUGHT THE GLOW TOLERANCE. Several rungs and one picture is a "
                "knob refusing its values, and it looks exactly like a term that does not matter. If this "
                "fails, nothing below is a finding about exposure.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
