# WHICH TERM BLOWS THE WARDROBE PREVIEW OUT, AND AT WHAT VALUE DOES IT STOP?
#
# THE EVIDENCE THAT STARTED THIS, and it is the only kind that counts here. The SAME Skeleton Flame costume,
# the same build, photographed two ways on 2026-09-27:
#
#     IN-WORLD (stance_authority, differenced against its own figure-hidden control):
#         blue-dominant 0.837   fully blown 0.000   zero-chroma 0.117
#     WARDROBE PREVIEW (wardrobe_pixels):
#         blue-dominant 0.074   fully blown 0.355   zero-chroma 0.871
#
# The skin is not white. The skin is blue and cyan exactly as the founder approved it, and the WARDROBE is
# what turns it white. Founder, Skeleton Flame: "Preserve the existing approved overall Skeleton Flame
# design ... spectral blue/cyan sections", and "Do not broadly recolor the mascot." So nothing in
# relay_dog_skins.py may move to fix this. The stage is the defect and the stage is what this job measures.
#
# THE SAME CAUSE IS SITTING UNDER THREE OTHER FAILURES, which is why this is worth a run of its own:
#   item 1  W11  Apollo's preview corner reads 0.5758 against a 0.25 ceiling while every other skin reads
#                0.032 -- the ceiling was written to catch the white Project Brain chamber showing through,
#                and it cannot tell that chamber from Apollo's own blown-out crown.
#   item 1  W13  Apollo's whole window reads 0.7418 against a 0.6 ceiling, same reason.
#   item 6  C07  SECONDARY measured 0.0 magenta before AND after being set. SECONDARY drives the EYES, which
#                are a handful of pixels; a frame that blows 35% of the figure to pure white is not an
#                instrument that can see them. C07 may be a casualty of this rather than a finding.
#
# WHY A LADDER WITH TWO CONTROLS RATHER THAN A SWEEP. This file's own header records being "bitten twice" by
# a number that went stale when something near it changed, and records thirteen stops of exposure bias
# changing almost nothing because exposure was never the saturating term. So the first question is not WHAT
# VALUE but WHICH TERM, and two rungs answer it outright:
#     glow_zero    the figure keeps none of its authored fire. Still blown => the LAMPS are doing it.
#     lights_zero  the lamps are off. Still blown => the GLOW is doing it.
# Only then does the ladder sweep the term that actually binds. A sweep run before those two controls would
# find a value that works and teach nothing about why, which is how this number goes stale again.
#
# RELAY OG IS THE FLOOR CONTROL. It measured a glow share of 0.00 in zc_night_bodies -- it is the one skin
# with no fire of its own -- so it cannot be rescued by dimming and it is the first thing to go black if a
# rung goes too far. A rung that fixes Skeleton Flame by making Relay OG a silhouette is not a fix.
#
# WHAT THIS JOB DOES NOT DECIDE: it does not pick the shipping value. It captures a frame per rung per skin
# and records where the window's pixels sit; the chosen rung is read off the captures afterwards with the
# SAME blue/blown/chroma metric used on the in-world frame above, so the three contexts stay comparable.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary
SL = unreal.SystemLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "stage_terms")

# skeleton_flame is the subject, apollo is the item 1 failure, relay_og is the floor control.
SKINS = ["skeleton_flame", "apollo", "relay_og"]

GLOW = "wl.Look.PreviewGlow"
LIGHTS = "wl.Look.PreviewLights"
BLOOM = "wl.Look.PreviewBloom"

# (name, glow, lights). None means "put back whatever this job found".
RUNGS = [
    ("shipped", None, None),
    ("glow_zero", 0.0, None),
    ("lights_zero", None, 0.0),
    ("glow_third", 0.00033, None),
    ("glow_tenth", 0.0001, None),
    ("glow_thirtieth", 0.000033, None),
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

    def set_cvar(world, name, value):
        SL.execute_console_command(world, "%s %.8f" % (name, value))

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

    # ---- WHAT THE STAGE WAS SET TO BEFORE THIS JOB TOUCHED IT. Restored at the end and read back, because a
    # job that leaves the stage dimmed makes every later wardrobe capture in this session a photograph of it.
    as_found = {GLOW: cvar(GLOW), LIGHTS: cvar(LIGHTS), BLOOM: cvar(BLOOM)}
    RESULT["as_found"] = as_found
    record("S00", "the three stage terms can be read back before anything is changed",
           all(v is not None for v in as_found.values()), as_found=as_found,
           note="a knob that cannot be read is a knob that cannot be proved to have been set; "
                "wl.Look.FireMaterial and r.DistanceFields have both refused values they were given.")
    if any(v is None for v in as_found.values()):
        RESULT["status"] = "VOID: a stage term is not readable"
        return

    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    pressed = ui.press_switch_skin()
    yield 4.0
    record("S01", "the wardrobe is open through the founder's own SWITCH SKIN button",
           bool(pressed) and ui.is_brain_skins_open(),
           pressed=bool(pressed), skins_open=ui.is_brain_skins_open())

    rect = ui.get_skin_preview_rect()
    got = rect is not None
    centre, size = rect if got else (None, None)
    RESULT["preview_rect"] = {"got": got,
                              "centre": [round(centre.x, 4), round(centre.y, 4)] if got else None,
                              "size": [round(size.x, 4), round(size.y, 4)] if got else None}
    record("S02", "the preview window has painted and reports where it is", got, **RESULT["preview_rect"])
    if not got:
        RESULT["status"] = "VOID: no preview rect"
        return

    def patch(cx, cy, half_w, half_h):
        out = L.read_screen_rect(cx - half_w, cy - half_h, cx + half_w, cy + half_h)
        if out is None:
            return None
        mean, dark, bright, sampled = out
        return {"mean": [round(mean.r, 4), round(mean.g, 4), round(mean.b, 4)],
                "luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4),
                "blue_over_red": round(mean.b - mean.r, 4),
                "bright": round(bright, 4), "samples": int(sampled)}

    readings = {}
    RESULT["readings"] = readings
    corner_x, corner_y = 0.5 - 0.09, 0.5 - 0.075

    for skin in SKINS:
        try:
            ui.wear_relay_skin(skin)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[skin] = str(err)[:140]
            continue
        yield 6.0
        rows = {}
        for name, glow, lights in RUNGS:
            set_cvar(world, GLOW, as_found[GLOW] if glow is None else glow)
            set_cvar(world, LIGHTS, as_found[LIGHTS] if lights is None else lights)
            yield 2.5
            # READ THE KNOBS BACK. Setting is not the same as taking.
            back = {GLOW: cvar(GLOW), LIGHTS: cvar(LIGHTS)}
            whole = patch(centre.x, centre.y, size.x * 0.38, size.y * 0.38)
            middle = patch(centre.x, centre.y, size.x * 0.16, size.y * 0.22)
            corner = patch(centre.x + corner_x * size.x, centre.y - corner_y * size.y,
                           size.x * 0.055, size.y * 0.045)
            shot = os.path.join(ROOT, "%s__%s.png" % (skin, name))
            try:
                L.capture_game_viewport(shot)
            except Exception:                                       # noqa: BLE001
                pass
            yield 0.6
            rows[name] = {"asked": {"glow": glow, "lights": lights}, "read_back": back,
                          "whole": whole, "middle": middle, "corner_tr": corner,
                          "capture": os.path.basename(shot)}
            emit("S_%s_%s" % (skin, name), "INFO", "%s at %s" % (skin, name),
                 {"glow": back[GLOW], "lights": back[LIGHTS],
                  "whole_luma": whole["luma"] if whole else None,
                  "blue_over_red": whole["blue_over_red"] if whole else None,
                  "bright": whole["bright"] if whole else None})
        readings[skin] = rows

    # ---- PUT THE STAGE BACK, AND READ IT BACK.
    for name, value in as_found.items():
        set_cvar(world, name, value)
    yield 2.0
    restored = {GLOW: cvar(GLOW), LIGHTS: cvar(LIGHTS), BLOOM: cvar(BLOOM)}
    RESULT["restored"] = restored
    record("S_RESTORE", "the stage terms this job found were put back",
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
    record("S_SKIN", "Relay OG was put back on the Dog, and it went back",
           worn_back is not None and "relay_og" in worn_back.lower(), worn_after_restore=worn_back)

    # ---- DID EVERY RUNG ACTUALLY TAKE? A ladder whose knob refuses a value measures one rung six times.
    took = []
    for skin, rows in readings.items():
        for name, glow, lights in RUNGS:
            row = rows.get(name)
            if row is None:
                took.append("%s/%s missing" % (skin, name))
                continue
            want_g = as_found[GLOW] if glow is None else glow
            want_l = as_found[LIGHTS] if lights is None else lights
            if abs((row["read_back"][GLOW] if row["read_back"][GLOW] is not None else -1) - want_g) > 1e-7:
                took.append("%s/%s glow asked %g read %s" % (skin, name, want_g, row["read_back"][GLOW]))
            if abs((row["read_back"][LIGHTS] if row["read_back"][LIGHTS] is not None else -1) - want_l) > 1e-7:
                took.append("%s/%s lights asked %g read %s" % (skin, name, want_l, row["read_back"][LIGHTS]))
    RESULT["rungs_that_did_not_take"] = took or None
    record("S03", "every rung's knob took the value it was given", not took, refused=took or None,
           note="THE CONTROL THAT MAKES THE LADDER A LADDER. wl.Look.FireMaterial and r.DistanceFields have "
                "both silently kept their old value in this tree, and a ladder of six identical rungs looks "
                "exactly like a term that does not matter.")

    got_all = all((rows.get(n[0]) or {}).get("whole") for rows in readings.values() for n in RUNGS)
    record("S04", "every skin was photographed at every rung, and the window read back each time",
           len(readings) == len(SKINS) and got_all,
           skins=sorted(readings), rungs=[n for n, _, _ in RUNGS])

    # ---- AND THE TWO CONTROLS, stated as findings rather than as pass/fail, because WHICH TERM BINDS is
    # what this run is for and either answer is a real answer.
    verdict = {}
    for skin, rows in readings.items():
        ship = (rows.get("shipped") or {}).get("whole")
        nog = (rows.get("glow_zero") or {}).get("whole")
        nol = (rows.get("lights_zero") or {}).get("whole")
        verdict[skin] = {
            "shipped_luma": ship["luma"] if ship else None,
            "with_no_glow": nog["luma"] if nog else None,
            "with_no_lamps": nol["luma"] if nol else None,
            "glow_share": round(ship["luma"] - nog["luma"], 4) if ship and nog else None,
            "lamp_share": round(ship["luma"] - nol["luma"], 4) if ship and nol else None,
        }
    RESULT["which_term_binds"] = verdict
    emit("S05", "INFO", "how much of the shipped window each term is responsible for", verdict)

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
