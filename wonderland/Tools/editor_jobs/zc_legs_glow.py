# DO THE BLACK PARTS ON SKELETON FLAME'S LEGS ACTUALLY GLOW? ASKED BY TURNING THE LAMPS OFF.
#
# FOUNDER, SKELETON FLAME: "The OTHER BLACK SECTIONS OF THE BODY are supposed to participate in the glowing
# treatment. In particular, the BLACK PARTS ON THE LEGS need to visibly GLOW. Preserve their black identity
# while giving them the intended luminous/glowing behavior."
#
# WHY THIS IS A NEW JOB RATHER THAN A FIX TO THE OLD ONE. zc_skeleton_parts has been answering this by
# comparing the legs at noon against the legs at midnight in the WORLD, and it cannot. Looking at its own
# captures:
#
#   AT ITS CLOSE VIEW (260 uu) THE LEGS ARE NOT IN FRAME AT ALL. The camera sits 30 uu above the look-at
#   point at three metres, and the picture is the tailfire and the top of the skull. There are no legs and no
#   feet anywhere in it.
#
#   AT ITS GAMEPLAY VIEW (900 uu) the whole figure is framed -- and the HUD's own nav strip is drawn across
#   the bottom centre, directly over the feet, with two AI Companions standing either side of the Dog. Any
#   band across the lower figure catches the strip, a companion, or both.
#
# So both views were measuring something, and neither was measuring legs. That is on top of the region boxes
# having been fractions of the FRAME, which is its own entry in the README.
#
# AND THE DAY-NIGHT FRAMING WAS THE WRONG QUESTION ANYWAY. "Does it hold its light at night" is a proxy for
# "does it emit", and a poor one: the exposure opens 2.35 EV between noon and midnight, so EVERYTHING holds
# more of its daylight value than intuition says -- the threshold is 19.6 per cent, not 100. That proxy is
# why the old clause needed a matte control just to establish that the sun had gone down.
#
# THE DIRECT QUESTION IS AVAILABLE AND IT IS ONE KNOB. wl.Look.PreviewLights scales the wardrobe stage's
# three lamps. At ZERO there is no incident light in that room at all, so anything still visible is emitting
# its own. That is not a proxy for "does it glow", it is the definition of it -- and it is measured on an
# isolated figure against a black backdrop, with no HUD over it and no companions beside it.
#
# THE BACKDROP MAKES LOCATING THE FIGURE TRIVIAL, which is the other reason to ask the question here. The
# wardrobe's cyclorama is an unlit 0.008 black, so "brighter than the backdrop" finds the mascot exactly,
# with none of the segmentation guesswork that a stone courtyard forces.
#
# THE CONTROL COMES FIRST. If the lamps-off frame is not actually different from the lamps-on frame, the
# switch did nothing and every reading below is one condition compared with itself -- the exact failure that
# a fixed tolerance on SetGlowScale produced earlier tonight, where four rungs photographed one picture and
# it read as a finding. So L00 asserts the two frames differ before anything else is interpreted.
#
# WHAT THIS DOES NOT CLAIM: whether the glow LOOKS right is the founder's. This answers whether the dark
# parts of the legs emit light of their own, and how that compares with the torso beside them.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary
SL = unreal.SystemLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "legs_glow")
LIGHTS = "wl.Look.PreviewLights"
SKIN = "skeleton_flame"

# Bands as fractions of the FIGURE's own measured box, top to bottom.
BANDS = {
    "torso": (0.20, 0.34, 0.80, 0.52),
    "legs": (0.25, 0.62, 0.75, 0.80),
    "feet": (0.25, 0.84, 0.75, 0.98),
}
# Above this the pixel is part of the figure rather than the cyclorama, which sits at about 0.008.
BACKDROP = 0.06
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

    as_found = cvar(LIGHTS)
    RESULT["as_found_lights"] = as_found
    record("L_READ", "the stage lamp level can be read back before anything is changed",
           as_found is not None, lights=as_found)
    if as_found is None:
        RESULT["status"] = "VOID: wl.Look.PreviewLights is not readable"
        return

    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    ui.press_switch_skin()
    yield 4.0
    try:
        ui.wear_relay_skin(SKIN)
    except Exception as err:                                        # noqa: BLE001
        RESULT["status"] = "VOID: could not wear %s (%s)" % (SKIN, str(err)[:90])
        return
    yield 6.0

    rect = ui.get_skin_preview_rect()
    if rect is None:
        RESULT["status"] = "VOID: no preview rect"
        return
    centre, size = rect
    RESULT["preview_rect"] = {"centre": [round(centre.x, 4), round(centre.y, 4)],
                              "size": [round(size.x, 4), round(size.y, 4)]}

    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "Tools"))
    from night_figure import read                                   # noqa: E402

    def figure_and_bands(path):
        """Find the mascot against the black cyclorama, then read the bands as fractions OF IT."""
        w, h, chan, px = read(path)
        x0 = max(int((centre.x - size.x * 0.45) * w), 0)
        x1 = min(int((centre.x + size.x * 0.45) * w), w - 1)
        y0 = max(int((centre.y - size.y * 0.45) * h), 0)
        y1 = min(int((centre.y + size.y * 0.45) * h), h - 1)
        xs, ys = [], []
        for y in range(y0, y1, STEP):
            for x in range(x0, x1, STEP):
                i = (y * w + x) * chan
                if (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255.0 > BACKDROP:
                    xs.append(x)
                    ys.append(y)
        if len(xs) < 300:
            return None
        xs.sort(); ys.sort()
        k = max(len(xs) // 100, 1)
        fx0, fy0, fx1, fy1 = xs[k], ys[k], xs[-k], ys[-k]
        fw, fh = max(fx1 - fx0, 1), max(fy1 - fy0, 1)
        out = {"figure_box": [fx0, fy0, fx1, fy1],
               "figure_pct_of_window": [round(100.0 * fw / max((x1 - x0), 1), 1),
                                        round(100.0 * fh / max((y1 - y0), 1), 1)]}
        for name, (a, b, c2, d2) in BANDS.items():
            bx0, by0 = int(fx0 + a * fw), int(fy0 + b * fh)
            bx1, by1 = int(fx0 + c2 * fw), int(fy0 + d2 * fh)
            lit = 0
            tot = 0.0
            cells = 0
            dark_but_lit = 0
            for y in range(max(by0, 0), min(by1, h), STEP):
                for x in range(max(bx0, 0), min(bx1, w), STEP):
                    i = (y * w + x) * chan
                    lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255.0
                    cells += 1
                    tot += lum
                    if lum > BACKDROP:
                        lit += 1
                    # THE THING THE FOUNDER ASKED FOR: still recognisably black, and not off.
                    if BACKDROP < lum < 0.30:
                        dark_but_lit += 1
            out[name] = {"mean": round(tot / max(cells, 1), 4),
                         "lit_fraction": round(lit / float(max(cells, 1)), 4),
                         "dark_but_lit_fraction": round(dark_but_lit / float(max(cells, 1)), 4),
                         "cells": cells, "box": [bx0, by0, bx1, by1]}
        return out

    # ---- THE CONTROL IS A SKIN WITH NO FIRE, NOT THE SAME SKIN TWICE.
    #
    # THE FIRST VERSION COMPARED SKELETON FLAME LAMPS-ON AGAINST LAMPS-OFF and voided itself: the torso read
    # 0.6604 lit and 0.7651 UNLIT. The figure boxes were near identical, so it was not a framing shift -- the
    # stage figure looks around and breathes, so two captures seconds apart are two different poses, and on a
    # mascot that is overwhelmingly emissive the pose moves the mean more than the lamps do.
    #
    # THAT SECOND FACT IS THE POINT AND IT MAKES THE COMPARISON THE WRONG ONE. Skeleton Flame barely dims
    # when the lamps go out, because most of it is emitting. So "did the figure get darker" is a weak
    # question to put to THIS subject, and a pose wobble is enough to reverse its sign.
    #
    # RELAY OG ANSWERS IT INSTEAD: the one skin in the lineup with no fire of its own. With the lamps off it
    # should very nearly disappear, and if it does not then the knob is not reaching the stage and nothing
    # below means anything. Same instrument as the day-night control -- put the question to a subject that
    # can actually answer it -- and it needs no second frame of the subject under test.
    #
    # AND THE MEASUREMENT ITSELF NEEDS ONLY THE LAMPS-OFF FRAME. With no incident light in the room, every
    # visible pixel is emitting. The lamps-on frame is kept only to show what the same bands look like lit.
    frames = {}
    RESULT["frames"] = frames

    SL.execute_console_command(world, "%s %.6f" % (LIGHTS, 0.0))
    yield 2.0
    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass
    yield 6.0
    control_path = os.path.join(ROOT, "control_relay_og_lamps_off.png")
    control_seen = None
    try:
        if L.capture_game_viewport(control_path):
            control_seen = figure_and_bands(control_path)
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["control"] = str(err)[:140]
    RESULT["matte_with_no_lamps"] = {
        "found_a_figure": control_seen is not None,
        "torso_mean": (control_seen or {}).get("torso", {}).get("mean"),
        "torso_lit_fraction": (control_seen or {}).get("torso", {}).get("lit_fraction"),
    }
    try:
        ui.wear_relay_skin(SKIN)
    except Exception:                                               # noqa: BLE001
        pass
    yield 6.0

    for tag, level in (("lamps_on", as_found), ("lamps_off", 0.0)):
        SL.execute_console_command(world, "%s %.6f" % (LIGHTS, level))
        yield 3.0
        back = cvar(LIGHTS)
        path = os.path.join(ROOT, "%s.png" % tag)
        got = False
        try:
            got = bool(L.capture_game_viewport(path))
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[tag] = str(err)[:140]
        yield 0.6
        frames[tag] = {"asked": level, "read_back": back,
                       "measured": figure_and_bands(path) if got else None}
        emit("L_%s" % tag, "INFO", tag,
             {"lights": back,
              "figure_pct": (frames[tag]["measured"] or {}).get("figure_pct_of_window"),
              "legs": ((frames[tag]["measured"] or {}).get("legs") or {}).get("mean")})

    # ---- PUT THE LAMPS BACK, AND READ THEM BACK.
    SL.execute_console_command(world, "%s %.6f" % (LIGHTS, as_found))
    yield 2.0
    RESULT["restored_lights"] = cvar(LIGHTS)
    record("L_RESTORE", "the lamp level this job found was put back",
           RESULT["restored_lights"] == as_found,
           as_found=as_found, restored=RESULT["restored_lights"])
    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass
    yield 3.0
    try:
        worn_back = str(dog.get_worn_skin_id())
    except Exception:                                               # noqa: BLE001
        worn_back = None
    record("L_SKIN", "Relay OG was put back on the Dog, and it went back",
           worn_back is not None and "relay_og" in worn_back.lower(), worn=worn_back)

    on = (frames.get("lamps_on") or {}).get("measured")
    off = (frames.get("lamps_off") or {}).get("measured")
    record("L_READABLE", "the figure was found against the backdrop in both frames",
           bool(on) and bool(off),
           on_box=(on or {}).get("figure_box"), off_box=(off or {}).get("figure_box"),
           on_pct=(on or {}).get("figure_pct_of_window"), off_pct=(off or {}).get("figure_pct_of_window"))
    if not on or not off:
        RESULT["status"] = "VOID: could not locate the figure in one of the two frames"
        return

    # ---- THE CONTROL, BEFORE ANY READING IS INTERPRETED.
    matte = RESULT["matte_with_no_lamps"]
    matte_dark = (matte["torso_lit_fraction"] is not None and matte["torso_lit_fraction"] <= 0.25)
    live = bool(frames["lamps_off"]["read_back"] == 0.0 and matte_dark)
    RESULT["lamp_switch"] = {"read_back_off": frames["lamps_off"]["read_back"],
                             "matte_torso_lit_fraction": matte["torso_lit_fraction"],
                             "matte_torso_mean": matte["torso_mean"],
                             "skeleton_torso_lamps_on": on["torso"]["mean"],
                             "skeleton_torso_lamps_off": off["torso"]["mean"]}
    record("L00", "with the lamps off a skin with NO fire nearly disappears -- the switch reaches the stage",
           live, **RESULT["lamp_switch"], matte_ceiling=0.25,
           note="THE CONTROL, and it is Relay OG rather than the subject. Skeleton Flame barely dims when "
                "the lamps go out because most of it is emitting -- which is the finding, not a fault -- so "
                "asking IT whether the lamps went off is asking a question it cannot answer. The first "
                "version did exactly that and voided on a pose wobble: torso 0.6604 lit against 0.7651 "
                "unlit, with the figure box unmoved.")
    if not live:
        RESULT["status"] = ("VOID: the lamp switch could not be shown to reach the stage (matte lit fraction "
                            "%s)" % matte["torso_lit_fraction"])
        return

    # ---- AND THE FOUNDER'S QUESTION, asked directly: with no incident light, what is still emitting?
    legs_emit = off["legs"]["lit_fraction"]
    torso_emit = off["torso"]["lit_fraction"]
    RESULT["emission_with_no_lamps"] = {
        "legs_lit_fraction": legs_emit, "torso_lit_fraction": torso_emit,
        "legs_dark_but_lit": off["legs"]["dark_but_lit_fraction"],
        "legs_mean": off["legs"]["mean"], "torso_mean": off["torso"]["mean"],
        "feet_lit_fraction": off["feet"]["lit_fraction"],
    }
    record("L01", "with the stage lamps off, part of the legs is still emitting light",
           legs_emit >= 0.12, **RESULT["emission_with_no_lamps"], floor=0.12,
           note="no incident light in the room, so anything above the backdrop is emitting its own. This is "
                "the founder's 'the black parts on the legs need to visibly glow', asked directly rather "
                "than through a day-night proxy.")

    record("L02", "the glowing part of the legs is still dark -- black identity preserved, not recoloured",
           off["legs"]["dark_but_lit_fraction"] >= 0.06,
           dark_but_lit=off["legs"]["dark_but_lit_fraction"], floor=0.06,
           band_meaning="brighter than the 0.06 backdrop but under 0.30 luma",
           note="the founder asked for BOTH halves: 'preserve their black identity WHILE giving them the "
                "intended luminous behaviour'. A leg that glowed by becoming pale would satisfy L01 and "
                "fail the instruction.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
