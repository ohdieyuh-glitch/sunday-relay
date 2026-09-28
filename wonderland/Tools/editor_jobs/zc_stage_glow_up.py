# THE EMISSIVE IS NOT BLOWN OUT, IT IS ABSENT -- SO SWEEP THE GLOW UPWARD.
#
# zc_stage_terms answered its own question and the answer was not the one it was built expecting. Its two
# controls, on Skeleton Flame's whole preview window:
#
#     shipped luma 0.4941 | with the glow entirely OFF 0.4931 | with the lamps OFF 0.4251
#     so GLOW SHARE = 0.001 and LAMP SHARE = 0.069
#
# Turning the figure's whole authored fire off changes the window by one part in five hundred, and on Apollo
# it makes the window BRIGHTER (-0.0149). Across six rungs Skeleton Flame's blue-dominant fraction never rose
# above 0.108 against 0.837 in-world, and the blown fraction bounced 0.147 / 0.048 / 0.089 / 0.363 / 0.063 /
# 0.032 with no trend -- that is noise on a term that is not driving anything.
#
# AND THE THREE RUNGS LOOK IDENTICAL. Shipped, glow-zero and lamps-zero photographed side by side are the
# same white figure. So the colour is not being washed out by brightness. It is not arriving at all.
#
# WHICH INVERTS THE FIX. The blue and cyan of Skeleton Flame live in EMISSIVE materials -- ghost is
# (0.22, 0.70, 1.00) and the spectral sections are authored as glow, not as base colour. wl.Look.PreviewGlow
# multiplies exactly that, and at 0.001 it multiplies it away; what is left is whatever neutral base colour
# those surfaces carry, lit by three white-ish stage lamps, which is a white figure. The previous sweep went
# DOWNWARD from 0.001 on the assumption that the window was over-bright. That assumption was wrong and the
# band between 0.001 and 0.10 was never looked at.
#
# 0.10 IS KNOWN TO BE TOO FAR: this stage's own source records it as "a white blaze filling the preview
# (Arden a white shape, Apollo and Celestial pinned)". So there are two failure modes at the two ends --
# colourless at the bottom, pinned at the top -- and this walks the octaves between them looking for the
# rung where the authored colour is present AND nothing clips.
#
# THE ACCEPTANCE IS BLUE RECOVERED WITHOUT BLOWING OUT, judged against the in-world truth for the same
# costume: blue-dominant 0.837, blown 0.000. The preview will not reach 0.837 -- much of the figure is
# legitimately bone -- but it must move a long way from 0.041.
#
# RELAY OG IS STILL THE FLOOR CONTROL, and on this sweep it is also the CEILING control: it has no fire of
# its own, so raising the glow should barely move it. If Relay OG starts blowing out, the rung is lifting
# something other than the fire and the reading is not what it looks like.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary
SL = unreal.SystemLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "stage_glow_up")

# skeleton_flame is the subject, apollo is the item 1 failure, relay_og is the floor control.
SKINS = ["skeleton_flame", "apollo", "relay_og"]

GLOW = "wl.Look.PreviewGlow"
LIGHTS = "wl.Look.PreviewLights"
BLOOM = "wl.Look.PreviewBloom"

# (name, glow, lights). None means "put back whatever this job found".
RUNGS = [
    ("shipped", None, None),
    ("glow_x3", 0.003, None),
    ("glow_x10", 0.01, None),
    ("glow_x30", 0.03, None),
    ("glow_x100", 0.1, None),
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
