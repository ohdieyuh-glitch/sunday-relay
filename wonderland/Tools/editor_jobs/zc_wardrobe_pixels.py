# WHAT IS ACTUALLY IN THE PREVIEW SQUARE, FOR EVERY SKIN, THROUGH THE BUTTON THE FOUNDER PRESSES.
#
# FOUNDER, 2026-09-25, with a photograph of the wardrobe open and the PROJECT BRAIN SCENE inside the preview
# window: "Do not treat Wardrobe as complete just because automated camera/state checks pass ... Diagnose the
# actual render/preview ownership problem rather than adding another state assertion that cannot see what the
# player sees. PIE test the visible pixels/content of the preview for every skin."
#
# THE DIAGNOSIS, and it is why every previous proof passed:
#
#   The wardrobe had TWO DOORS. UWonderlandUiSubsystem::SetBrainSkinsOpen stood the brain sculpture down and
#   framed the Dog into the window. The panel's own SWITCH SKIN button called SetSkinsOpen on the WIDGET and did
#   neither. Proofs went through the subsystem. The founder goes through the button. The preview window is a
#   HOLE in the panel, so with the brain still staged and the camera still on it, what showed through the hole
#   was the brain chamber -- white walls, red brain, black snow. Exactly the photograph.
#
# So this proof goes through the BUTTON (press_switch_skin runs the button's own line), and it judges by READING
# THE PIXELS in the preview rectangle rather than by asking the panel how it feels.
#
# WHAT THE TWO OUTCOMES LOOK LIKE IN NUMBERS:
#   broken  -- the brain chamber: mean luma near white, bright fraction high, dark fraction near zero
#   right   -- the wardrobe: a near-black backdrop filling most of the square with a lit figure standing on it
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wardrobe_pixels")
SKINS = ["relay_og", "arden_infernal", "apollo", "skeleton_flame", "celestial_light"]


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".jpg", ".png")):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

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
    yield 6.0

    ui = L.get_ui(world)
    if ui is None:
        record("W00", "the UI subsystem is reachable", False)
        RESULT["status"] = "FAIL"
        return
    record("W00", "the UI subsystem is reachable", True)

    # ---- OPEN THE PROJECT BRAIN THE WAY B DOES.
    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    record("W01", "the Project Brain is open", ui.is_project_brain_open())

    # ---- AND NOW THE BUTTON. Not SetBrainSkinsOpen. The button.
    pressed = ui.press_switch_skin()
    yield 4.0
    RESULT["press_returned"] = bool(pressed)
    record("W02", "SWITCH SKIN was pressed, and the wardrobe opened from that press alone",
           bool(pressed) and ui.is_brain_skins_open(),
           pressed=bool(pressed), skins_open=ui.is_brain_skins_open(),
           note="this is the founder's route. Every earlier proof used SetBrainSkinsOpen, which is not.")

    record("W03", "the Project Brain is STILL OPEN with the wardrobe inside it",
           ui.is_project_brain_open(), note="the founder asked that the Brain not be replaced by the wardrobe")

    # ---- WHERE THE WINDOW IS, so the pixels read are the window's and not the screen's.
    # Unreal folds a bool return with out-params into "tuple or None": None IS the false.
    rect = ui.get_skin_preview_rect()
    got = rect is not None
    centre, size = rect if got else (None, None)
    RESULT["preview_rect"] = {"got": got,
                              "centre": [round(centre.x, 4), round(centre.y, 4)] if got else None,
                              "size": [round(size.x, 4), round(size.y, 4)] if got else None}
    record("W04", "the preview window has painted and reports where it is", got, **RESULT["preview_rect"])
    if not got:
        RESULT["status"] = "FAIL: no preview rect"
        return

    # Read a little INSIDE the window so the frame's own stroke is not counted as content.
    inset = 0.12
    min_x = centre.x - size.x * (0.5 - inset)
    max_x = centre.x + size.x * (0.5 - inset)
    min_y = centre.y - size.y * (0.5 - inset)
    max_y = centre.y + size.y * (0.5 - inset)

    def patch(cx, cy, half_w, half_h):
        """Read one rectangle given as a centre and half-extents, in fractions of the viewport."""
        got = L.read_screen_rect(cx - half_w, cy - half_h, cx + half_w, cy + half_h)
        if got is None:
            return None
        mean, dark, bright, sampled = got
        return {"mean": [round(mean.r, 4), round(mean.g, 4), round(mean.b, 4)],
                "luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4),
                "dark": round(dark, 4), "bright": round(bright, 4), "samples": int(sampled)}

    # WHERE TO LOOK, AND WHY THERE.
    #
    # A single reading over the whole window cannot answer the founder's question, and the first run of this
    # proof proved it: Relay OG read 0.048 and Celestial Light read 0.491, because one is bone on black and the
    # other is a skin literally made of light with a halo standing behind it. Any single brightness threshold
    # either fails Celestial Light or would have passed the broken build.
    #
    # THE CORNERS ARE THE DISCRIMINATOR. The wardrobe's backdrop is an unlit 0.008 black cyclorama parked behind
    # the figure and scaled past the window's corners, and the figure is fitted to 0.80 of the frame -- so in a
    # WORKING wardrobe all four corners are backdrop, for every skin. In the founder's photograph the corners are
    # the Project Brain chamber: 0.97 white with black snow falling through it. That is the difference, and it
    # does not depend on how bright the mascot happens to be.
    corner_off_x = 0.5 - 0.09
    corner_off_y = 0.5 - 0.07
    corners = {"tl": (-1, -1), "tr": (1, -1), "bl": (-1, 1), "br": (1, 1)}

    readings = {}
    RESULT["per_skin"] = readings
    for skin in SKINS:
        worn = ui.wear_relay_skin(skin)
        # Long enough for the figure to load, the camera to re-solve for its height and the backdrop to resize.
        yield 6.0
        whole = patch(centre.x, centre.y, size.x * 0.38, size.y * 0.38)
        # ---- THE MIDDLE IS READ ACROSS A WHOLE BEAT, not at one instant of one.
        #
        # Skeleton Flame's chest skull is authored to go down to a twelfth of its brightness and back on a
        # 2.4 second cycle -- the founder's "glow on, soften/off, glow on" -- so a single sample of the middle
        # of the window catches it wherever the beat happens to be. Measured once it returned 0.0265 against
        # a 0.03 floor and failed; the skin was present and lit the entire time, just photographed at the
        # bottom of its own heartbeat. Every other skin holds still and is unaffected by reading a peak.
        middle = patch(centre.x, centre.y, size.x * 0.16, size.y * 0.22)
        for _ in range(9):
            yield 0.3
            again = patch(centre.x, centre.y, size.x * 0.16, size.y * 0.22)
            if again is not None and middle is not None and again["luma"] > middle["luma"]:
                middle = again
        corner_reads = {}
        for name, (sx, sy) in corners.items():
            corner_reads[name] = patch(centre.x + sx * size.x * corner_off_x,
                                       centre.y + sy * size.y * corner_off_y,
                                       size.x * 0.055, size.y * 0.045)
        shot = os.path.join(ROOT, "%s.png" % skin)
        try:
            L.capture_game_viewport(shot)
        except Exception:
            pass
        row = {"worn": bool(worn), "whole": whole, "middle": middle, "corners": corner_reads,
               "capture": os.path.basename(shot)}
        readings[skin] = row
        emit("W_%s" % skin, "INFO", "preview pixels for %s" % skin,
             {"whole_luma": whole["luma"] if whole else None,
              "middle_luma": middle["luma"] if middle else None,
              "corner_luma": {k: (v["luma"] if v else None) for k, v in corner_reads.items()}})

    read_all = all(r["whole"] and r["middle"] and all(r["corners"].values()) for r in readings.values())
    record("W10", "the preview's pixels were readable for every skin, in every place looked at", read_all)
    if not read_all:
        RESULT["status"] = "FAIL: could not read the screen"
        return

    # ---- THE CLAUSE THE FOUNDER'S SCREENSHOT FAILS.
    worst = {k: round(max(c["luma"] for c in v["corners"].values()), 4) for k, v in readings.items()}
    record("W11", "every corner of the preview window is the wardrobe's black backdrop, for every skin",
           all(v <= 0.25 for v in worst.values()),
           brightest_corner_by_skin=worst, threshold=0.25,
           note="the Project Brain chamber the founder photographed is 0.97 white in every corner. A wardrobe "
                "with its backdrop standing reads far below this however luminous the skin is.")

    # ---- AND THERE IS A MASCOT STANDING ON IT, said as a comparison rather than as an absolute so that a bone
    # ---- skin and a skin made of light are judged by the same clause.
    contrast = {k: round(v["middle"]["luma"] - max(c["luma"] for c in v["corners"].values()), 4)
                for k, v in readings.items()}
    record("W12", "the middle of the window is lit and the corners are not -- a figure is standing there",
           all(v >= 0.03 for v in contrast.values()),
           middle_minus_brightest_corner=contrast, threshold=0.03,
           middle_luma={k: v["middle"]["luma"] for k, v in readings.items()})

    # ---- NO SNOW, NO CHAMBER, NO GARDEN: the window as a whole is a dark room, not an outdoor scene. Stated
    # ---- generously enough that Celestial Light's halo is allowed to be what it is.
    whole_luma = {k: v["whole"]["luma"] for k, v in readings.items()}
    record("W13", "the preview as a whole is a dark room and not the white brain chamber",
           all(v <= 0.60 for v in whole_luma.values()),
           whole_luma_by_skin=whole_luma, threshold=0.60,
           note="the chamber fills the window edge to edge at 0.97; the brightest skin in the set reaches 0.49 "
                "and that is its own halo, standing on black")

    signature = ["%.3f/%.3f" % (readings[s]["whole"]["luma"], readings[s]["whole"]["dark"]) for s in SKINS]
    record("W14", "clicking each skin changes what the preview shows",
           len(set(signature)) >= 4, signatures=signature,
           note="five skins, at least four distinguishable pictures")

    # ---- AND IT CLOSES CLEANLY, by the same button.
    ui.press_switch_skin()
    yield 3.0
    record("W20", "pressing SWITCH SKIN again closes the wardrobe and leaves the Brain open",
           (not ui.is_brain_skins_open()) and ui.is_project_brain_open(),
           skins_open=ui.is_brain_skins_open(), brain_open=ui.is_project_brain_open())

    ui.toggle_project_brain()
    yield 2.0
    record("W21", "closing the Project Brain leaves nothing open behind it",
           (not ui.is_project_brain_open()) and (not ui.is_brain_skins_open()),
           brain_open=ui.is_project_brain_open(), skins_open=ui.is_brain_skins_open())

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
