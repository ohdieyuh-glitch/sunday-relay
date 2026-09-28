# DOES EVERY SKIN STAND THE WAY RELAY OG STANDS? MEASURED WHERE THE BACKGROUND IS BLACK.
#
# FOUNDER, P0 item 3: "make every active skin copy its exact idle stance ... One canonical Relay Dog behavior
# stack; skins are cosmetic." And item 1: the Wardrobe preview is "the selected Relay Dog centered on black
# with NO Wonderland scenery".
#
# THE SECOND SENTENCE IS THE INSTRUMENT FOR THE FIRST, AND IT TOOK FIVE FAILED VERSIONS TO SEE IT.
# zc_stance_authority tried to measure this in a live viewport and failed five distinct ways:
#
#   1. a fixed band of the frame           profiled a market stall, and its own guard passed on it
#   2. the brightest row                   found street lamps
#   3. raw column lists                    could not be compared, and "could not compare" was reported as
#                                          "stands differently"
#   4. a silhouette profile                measured drapery, because 0.0 means both "absent" and "at the top"
#   5. feet found by differencing          every skin's ground row came back as the identical constant 924,
#                                          because hiding the Dog also hides UI attached to it and the box
#                                          stopped where that panel stopped. The crop is HUD buttons.
#
# So no verdict from that job stands: Apollo and Skeleton Flame are NOT shown to stand differently, and Arden
# Infernal is NOT shown to match.
#
# THE PREVIEW GIVES AWAY EVERYTHING THOSE VERSIONS FOUGHT FOR. A known rect read from the widget, a black
# ground, no world, no HUD, no attached panels, and the figure centred by the stage's own framing. A figure on
# black needs no differencing and no background estimate: a pixel is the figure when it is not black.
#
# WHAT IS COMPARED: where the figure's feet land and how wide apart they are, in units of the figure's own
# HEIGHT -- height because the body sets it and ornament sets width. A robe hides legs; it does not hide
# ground contact.
#
# WHAT THIS CANNOT SEE, stated because the founder's item 3 asks for more than idle: the preview stages a
# figure, so this measures STANCE and not walk, run, stop, turn, jump, fall or landing. Those need the live
# world and a harder instrument than five attempts have produced. This is the first of the list, not the list.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import hashlib
import os
import sys
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "stance_preview")
REPO = os.path.dirname(os.path.dirname(CHANNEL))

SKINS = ("relay_og", "celestial_light", "apollo", "arden_infernal", "skeleton_flame")
# A pixel belongs to the figure when it is this far above the preview's black ground.
FIGURE_FLOOR = 0.06
# Feet are the columns reaching within this fraction of the figure's height of its lowest point.
FOOT_BAND = 0.04
# Two stances agree when spread and offset each differ by less than this fraction of figure height.
STANCE_TOLERANCE = 0.08


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    sys.path.insert(0, os.path.join(REPO, "Tools"))
    from night_figure import read                                   # noqa: WPS433

    RESULT["tests"] = []

    def record(tid, name, ok, **detail):
        RESULT["tests"].append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def fingerprint(path):
        try:
            with open(path, "rb") as fh:
                return hashlib.md5(fh.read()).hexdigest()
        except Exception:                                           # noqa: BLE001
            return None

    def stance_of(path, centre, size):
        """Figure extent and foot placement inside the preview rect, on its black ground."""
        w, h, chan, px = read(path)
        rx0 = max(int((centre.x - size.x * 0.5) * w), 0)
        ry0 = max(int((centre.y - size.y * 0.5) * h), 0)
        rx1 = min(int((centre.x + size.x * 0.5) * w), w - 1)
        ry1 = min(int((centre.y + size.y * 0.5) * h), h - 1)
        if rx1 - rx0 < 16 or ry1 - ry0 < 16:
            return None

        def lit(x, y):
            i = (y * w + x) * chan
            return (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255.0 >= FIGURE_FLOOR

        lo_x, hi_x, lo_y, hi_y, hits = rx1, rx0, ry1, ry0, 0
        for y in range(ry0, ry1 + 1):
            for x in range(rx0, rx1 + 1):
                if lit(x, y):
                    hits += 1
                    if x < lo_x: lo_x = x
                    if x > hi_x: hi_x = x
                    if y < lo_y: lo_y = y
                    if y > hi_y: hi_y = y
        if hits < 400 or hi_x <= lo_x or hi_y <= lo_y:
            return None
        height = max(hi_y - lo_y, 1)

        # THE GROUND IS THE FIGURE'S OWN LOWEST PIXEL, not a row of the frame. The live version used a row that
        # came back as the same constant for all five skins, which is the tell that it was an edge and not a
        # foot.
        near = max(int(height * FOOT_BAND), 2)
        feet = []
        for x in range(lo_x, hi_x + 1):
            for y in range(hi_y, max(hi_y - near, lo_y) - 1, -1):
                if lit(x, y):
                    feet.append(x)
                    break
        if len(feet) < 2:
            return None
        centre_x = (lo_x + hi_x) * 0.5
        return {
            "rect": [rx0, ry0, rx1, ry1],
            "figure_box": [lo_x, lo_y, hi_x, hi_y], "lit_pixels": hits,
            "height_px": height, "width_px": hi_x - lo_x,
            "ground_row": hi_y, "foot_columns": len(feet),
            "spread_over_height": round((max(feet) - min(feet)) / float(height), 4),
            "offset_over_height": round(((min(feet) + max(feet)) * 0.5 - centre_x) / float(height), 4),
            # Reported so a reader can see the figure was actually staged and roughly the expected size.
            "fills_rect_height": round(height / float(max(ry1 - ry0, 1)), 3),
        }

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

    ui = L.get_ui(world)
    if ui is None:
        RESULT["status"] = "VOID: no UI subsystem"
        return
    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    pressed = ui.press_switch_skin()
    yield 4.0
    record("P00", "the wardrobe is open through the founder's own button",
           bool(pressed) and ui.is_brain_skins_open(), pressed=bool(pressed))
    rect = ui.get_skin_preview_rect()
    got = rect is not None
    centre, size = rect if got else (None, None)
    RESULT["preview_rect"] = {"centre": [round(centre.x, 4), round(centre.y, 4)] if got else None,
                              "size": [round(size.x, 4), round(size.y, 4)] if got else None}
    record("P01", "the preview window reports where it is", got, **RESULT["preview_rect"])
    if not got:
        RESULT["status"] = "FAIL: no preview rect"
        return

    readings = {}
    RESULT["readings"] = readings
    for skin in SKINS:
        try:
            ui.wear_relay_skin(skin)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[skin] = str(err)[:140]
            continue
        # The stage rebuilds the figure and frames a camera on it; a capture taken early photographs the
        # PREVIOUS skin, which on a comparison job reads as perfect agreement.
        yield 7.0
        name = "stance_%s.png" % skin
        path = os.path.join(ROOT, name)
        try:
            shot = L.capture_game_viewport(path)
            if not shot:
                raise RuntimeError("capture_game_viewport returned falsy: the editor is probably not foreground")
            RESULT.setdefault("capture_hashes", {})[name] = fingerprint(path)
            readings[skin] = stance_of(path, centre, size)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[skin] = str(err)[:160]
        emit("P_%s" % skin, "INFO", skin, readings.get(skin))

    RESULT["captures_dir"] = ROOT
    prints = [p for p in (RESULT.get("capture_hashes") or {}).values() if p]
    record("P02", "each skin is a different picture",
           len(prints) == len(SKINS) and len(set(prints)) == len(prints),
           files=len(prints), distinct=len(set(prints)))

    found = [s for s in SKINS if readings.get(s)]
    record("P03", "every skin was staged and measured",
           len(found) == len(SKINS), measured=sorted(found),
           heights={s: (readings.get(s) or {}).get("height_px") for s in SKINS},
           fills={s: (readings.get(s) or {}).get("fills_rect_height") for s in SKINS})
    if len(found) < len(SKINS):
        RESULT["status"] = "VOID: a skin was not staged, so no comparison is valid"
        return

    # ---- THE GROUND ROW MUST NOT BE THE SAME CONSTANT FOR EVERY SKIN.
    #
    # That is exactly what the live version produced -- 924 for all five -- and it is the signature of
    # measuring an edge rather than a figure. Five figures of different heights staged on one camera will not
    # share a ground row to the pixel unless they are all standing on the same staged floor, which in the
    # preview they are; so this asks that the HEIGHTS differ instead, which is the same question the live
    # version should have asked.
    heights = [(readings[s] or {}).get("height_px") for s in found]
    record("P04", "the five figures are not all the same size on screen",
           len(set(heights)) > 1, heights={s: (readings[s] or {}).get("height_px") for s in found},
           note="five different costumes rendering to the identical pixel height means the measurement is of "
                "the stage and not of the figures.")

    base = readings.get("relay_og") or {}
    diffs = {}
    for skin in SKINS:
        if skin == "relay_og":
            continue
        mine = readings.get(skin) or {}
        diffs[skin] = {
            "spread_delta": round(abs(mine["spread_over_height"] - base["spread_over_height"]), 4),
            "offset_delta": round(abs(mine["offset_over_height"] - base["offset_over_height"]), 4),
            "spread": mine["spread_over_height"], "offset": mine["offset_over_height"],
        }
    RESULT["vs_relay_og"] = diffs
    RESULT["relay_og_stance"] = {"spread": base.get("spread_over_height"),
                                 "offset": base.get("offset_over_height")}
    off = sorted(k for k, v in diffs.items()
                 if v["spread_delta"] > STANCE_TOLERANCE or v["offset_delta"] > STANCE_TOLERANCE)
    RESULT["skins_that_stand_differently"] = off or None
    record("P05", "every skin stands the way Relay OG stands",
           not off, relay_og=RESULT["relay_og_stance"], vs_relay_og=diffs,
           tolerance=STANCE_TOLERANCE, differing=off or None,
           note="foot spread and foot offset, in units of the figure's own height, on the preview's black "
                "ground. This is the idle stance only: the founder's item 3 also asks about walk, run, stop, "
                "turns, jump, fall and landing, and none of those are measured here.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
