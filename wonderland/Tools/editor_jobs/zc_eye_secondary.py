# DOES SECONDARY VISIBLY COLOUR THE EYES, AND AT WHAT EYE LEVEL DOES IT BECOME VISIBLE?
#
# FOUNDER, P1 item 6: "PRIMARY = main/full mascot colorway. SECONDARY = Relay Dog eyes. These channels MUST
# be genuinely independent."
#
# WHERE THIS STANDS. zc_mascot_colours passes C06 -- PRIMARY reaches the body -- and fails C07, which looks
# for magenta pixels after setting SECONDARY to magenta and finds 0.0000 both before and after. Reading the
# source, SECONDARY does reach the eye: the eye material carries the Eye channel (its name contains "eye")
# and `Want *= Secondary` runs. So the plumbing is correct and the picture does not change, which is the
# combination that means something is swallowing it downstream.
#
# THE LIKELY REASON, and this job is built to confirm or kill it rather than assume it. The preview eye is
#
#     Want = (Authored / Peak) * EyeGlowScale * GlowScale * HaloShare
#
# so although the source calls this "driven to a level, not multiplied by one", it is still multiplied by the
# wardrobe's own glow reduction. EyeGlowScale of 14 was chosen for "14 x 0.10 = 1.4 against a stage white
# near 2". That reduction is now 0.0002, so the product is 0.0028 -- five hundred times under its design
# assumption. An emissive that faint contributes almost nothing to a lamp-lit eye surface, and a tint applied
# to almost nothing is almost nothing.
#
# WHY THE OLD CLAUSE COULD NOT HAVE CAUGHT THIS, and it is the more useful half. C07 is bounded ABOVE as well
# as below: magenta must appear, but on only a small part of the figure, because SECONDARY arriving
# everywhere would mean it had been applied to the body too. That upper bound is a clause whose PASS means
# "this term did not reach the body" -- and it passes just as happily when the term reaches NOTHING AT ALL.
# Half of C07 has been green throughout for the same reason it is now red.
#
#     A NEGATIVE RESULT IS ONLY EVIDENCE IF THE POSITIVE CASE WAS REACHABLE.
#
# So this job never asks "is there magenta". It sets SECONDARY to two strongly different colours and asks
# whether the EYES CHANGED BETWEEN THEM, which needs no assumption about what colour the result should be --
# the eye is tinted by multiplication, and gold times magenta is red, not magenta, which is its own reason
# the old clause was looking for the wrong thing. Independence is then the BODY not changing across the same
# pair, which is the founder's actual requirement rather than a proxy for it.
#
# AND IT SWEEPS THE EYE LEVEL, because if the tint is invisible at the shipped level the question "does
# SECONDARY work" has no useful answer until the level is somewhere it could show. Three things have to hold
# together at whatever level is chosen, and they pull against each other:
#   - the eyes must change with SECONDARY                     (the feature works at all)
#   - the eyes must stay BELOW clipping                       (founder: "not one blown-out light")
#   - the eyes must stay ABOVE the face                       (founder: "clear contrast against the face")
# A level that buys the first by losing the second is not a fix; directive B was explicit about that.
#
# THE SHIPPED LEVEL IS RUNG ZERO AND IS THE CONTROL. If SECONDARY is invisible at 14 and visible at a higher
# level, that is the answer. If it is invisible at EVERY level, the fault is not the level and this job says
# so rather than picking the least bad rung.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary
SL = unreal.SystemLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "eye_secondary")
EYE = "wl.Look.PreviewEyeGlow"
PRIMARY = "wl.Mascot.Primary"
SECONDARY = "wl.Mascot.Secondary"

SKIN = "relay_og"
# Two strongly separated colours. Which one is "right" does not matter; that they differ is the measurement.
COLOUR_A = (0.95, 0.10, 0.80)      # magenta
COLOUR_B = (0.10, 0.95, 0.85)      # cyan
# 14 is shipped. The design product was 1.4 against the old 0.10 reduction; at 0.0002 that needs 7000.
LEVELS = (14.0, 140.0, 1400.0, 7000.0)
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

    # ---- WHAT THE COLOURWAY WAS BEFORE THIS JOB TOUCHED IT.
    #
    # wl.Mascot.Primary and wl.Mascot.Secondary are SAVED settings -- their own help text says so -- so a job
    # that leaves them changed does not merely spoil its own next run, it repaints the mascot for the founder
    # and for every other lane's captures until somebody notices. A costume left on the Dog already reached
    # another lane's acceptance photographs once tonight.
    #
    # AND wl.Mascot.Reset IS NOT A RESTORE. If the founder has chosen a colourway, Reset discards it. What
    # goes back is what was found: the chosen pair if there was one, Reset only if there was not.
    def settings():
        try:
            return unreal.get_default_object(unreal.WonderlandMascotStyleSettings)
        except Exception:                                           # noqa: BLE001
            return None

    def read_style():
        s_obj = settings()
        if s_obj is None:
            return None
        out = {}
        for key in ("primary", "secondary"):
            try:
                c = s_obj.get_editor_property(key)
                out[key] = [round(float(c.r), 4), round(float(c.g), 4), round(float(c.b), 4)]
            except Exception:                                       # noqa: BLE001
                out[key] = None
        try:
            out["chosen"] = bool(s_obj.get_editor_property("b_chosen"))
        except Exception:                                           # noqa: BLE001
            out["chosen"] = None
        return out

    as_found_style = read_style()
    RESULT["as_found_style"] = as_found_style

    as_found_eye = cvar(EYE)
    RESULT["as_found_eye_level"] = as_found_eye
    record("E00", "the preview eye level can be read back before anything is changed",
           as_found_eye is not None, eye_level=as_found_eye)
    if as_found_eye is None:
        RESULT["status"] = "VOID: wl.Look.PreviewEyeGlow is not readable -- is this build current?"
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
    yield 5.0

    rect = ui.get_skin_preview_rect()
    if rect is None:
        RESULT["status"] = "VOID: no preview rect"
        return
    centre, size = rect
    RESULT["preview_rect"] = {"centre": [round(centre.x, 4), round(centre.y, 4)],
                              "size": [round(size.x, 4), round(size.y, 4)]}
    record("E01", "the wardrobe is open with the preview window painted", True, **RESULT["preview_rect"])

    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "Tools"))
    from night_figure import read                                   # noqa: E402

    def regions(path):
        """The eye band, and the face below it, located by brightness rather than by a fixed fraction.

        A FIXED FRACTION OF THE FRAME FINDS WHATEVER IS AT THAT FRACTION. Earlier jobs in this tree located
        an eye band by a fixed offset and profiled a market stall, and by the brightest row of the whole
        frame and found street lamps. Confined to the upper third of the PREVIEW RECT, the brightest row is
        the eyes: it is a dark box containing one figure, and nothing else in it is bright.
        """
        w, h, chan, px = read(path)
        x0 = max(int((centre.x - size.x * 0.42) * w), 0)
        x1 = min(int((centre.x + size.x * 0.42) * w), w - 1)
        y0 = max(int((centre.y - size.y * 0.42) * h), 0)
        y1 = min(int((centre.y + size.y * 0.42) * h), h - 1)
        best_y, best_s = None, -1.0
        for y in range(y0, y0 + max((y1 - y0) // 3, 2)):
            s = 0.0
            for x in range(x0, x1, STEP):
                i = (y * w + x) * chan
                s += max(px[i], px[i + 1], px[i + 2])
            if s > best_s:
                best_y, best_s = y, s
        if best_y is None:
            return None

        def band(ya, yb):
            r = g = b = 0.0
            n = 0
            peak = 0.0
            clipped = 0
            for y in range(max(ya, 0), min(yb, h)):
                for x in range(x0, x1):
                    i = (y * w + x) * chan
                    R, G, B = px[i], px[i + 1], px[i + 2]
                    lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255.0
                    if lum < 0.04:
                        continue
                    r += R; g += G; b += B; n += 1
                    peak = max(peak, lum)
                    if min(R, G, B) >= 247:
                        clipped += 1
            if n == 0:
                return None
            return {"rgb": [round(r / n / 255.0, 4), round(g / n / 255.0, 4), round(b / n / 255.0, 4)],
                    "luma": round((0.2126 * r + 0.7152 * g + 0.0722 * b) / n / 255.0, 4),
                    "peak": round(peak, 4), "clipped": round(clipped / float(n), 4), "px": n}

        return {"eye_row": best_y, "eye": band(best_y - 6, best_y + 7),
                "face": band(best_y + 22, best_y + 50),
                "body": band(best_y + 60, min(best_y + 130, y1))}

    def set_colour(name, rgb):
        SL.execute_console_command(world, "%s %.3f,%.3f,%.3f" % ((name,) + tuple(rgb)))

    def shoot(tag):
        path = os.path.join(ROOT, "%s.png" % tag)
        try:
            L.capture_game_viewport(path)
        except Exception:                                           # noqa: BLE001
            return None
        return path

    rows = {}
    RESULT["by_level"] = rows
    for level in LEVELS:
        SL.execute_console_command(world, "%s %.4f" % (EYE, level))
        yield 2.0
        back = cvar(EYE)
        pair = {"asked_level": level, "read_back": back}
        for tag, colour in (("A", COLOUR_A), ("B", COLOUR_B)):
            set_colour(SECONDARY, colour)
            yield 2.5
            path = shoot("eye_%g_%s" % (level, tag))
            pair[tag] = regions(path) if path else None
        rows["%g" % level] = pair
        eye_a = (pair.get("A") or {}).get("eye") or {}
        eye_b = (pair.get("B") or {}).get("eye") or {}
        emit("E_%g" % level, "INFO", "eye level %g" % level,
             {"read_back": back, "eye_A": eye_a.get("rgb"), "eye_B": eye_b.get("rgb"),
              "clipped_A": eye_a.get("clipped")})

    # ---- PUT EVERYTHING BACK, AND READ IT BACK.
    SL.execute_console_command(world, "%s %.4f" % (EYE, as_found_eye))
    if as_found_style and as_found_style.get("chosen"):
        set_colour(PRIMARY, as_found_style["primary"])
        set_colour(SECONDARY, as_found_style["secondary"])
    else:
        SL.execute_console_command(world, "wl.Mascot.Reset")
    yield 3.0
    RESULT["restored_eye_level"] = cvar(EYE)
    restored_style = read_style()
    RESULT["restored_style"] = restored_style

    def same_style(a, b):
        if a is None or b is None:
            return False
        if bool(a.get("chosen")) != bool(b.get("chosen")):
            return False
        if not bool(a.get("chosen")):
            return True
        return all(a.get(k) is not None and b.get(k) is not None
                   and max(abs(a[k][i] - b[k][i]) for i in range(3)) < 0.01
                   for k in ("primary", "secondary"))

    record("E_RESTORE", "the eye level AND the colourway this job found were both put back",
           RESULT["restored_eye_level"] == as_found_eye and same_style(restored_style, as_found_style),
           eye_as_found=as_found_eye, eye_restored=RESULT["restored_eye_level"],
           style_as_found=as_found_style, style_restored=restored_style,
           note="wl.Mascot.Primary and Secondary are SAVED settings, so a job that leaves them changed "
                "repaints the mascot for the founder and for every other lane until someone notices.")
    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass
    yield 2.0

    def took(row):
        return row["read_back"] is not None and abs(row["read_back"] - row["asked_level"]) < 1e-3

    refused = ["%g" % r["asked_level"] for r in rows.values() if not took(r)]
    RESULT["levels_that_did_not_take"] = refused or None
    record("E02", "every rung set the eye level it asked for", not refused, refused=refused or None,
           note="a ladder whose knob refuses its values measures one rung four times, and looks exactly like "
                "a term that does not matter. That is how this tree lost an evening to SetGlowScale.")

    def gap(a, b):
        if not a or not b:
            return None
        return round(max(abs(a["rgb"][i] - b["rgb"][i]) for i in range(3)), 4)

    summary = {}
    for key, row in rows.items():
        A, B = row.get("A") or {}, row.get("B") or {}
        summary[key] = {
            "eye_moved": gap(A.get("eye"), B.get("eye")),
            "body_moved": gap(A.get("body"), B.get("body")),
            "eye_clipped": (A.get("eye") or {}).get("clipped"),
            "eye_over_face": (round((A.get("eye") or {}).get("luma", 0) - (A.get("face") or {}).get("luma", 0), 4)
                              if A.get("eye") and A.get("face") else None),
        }
    RESULT["summary"] = summary
    emit("E03", "INFO", "what each eye level bought", summary)

    # ---- THE THREE THINGS THAT HAVE TO HOLD AT ONCE, reported per level rather than as one verdict.
    MOVED, STILL, CLIP, CONTRAST = 0.02, 0.02, 0.02, 0.01
    good = [k for k, v in summary.items()
            if (v["eye_moved"] or 0) > MOVED
            and (v["body_moved"] if v["body_moved"] is not None else 1) <= STILL
            and (v["eye_clipped"] if v["eye_clipped"] is not None else 1) <= CLIP
            and (v["eye_over_face"] or 0) >= CONTRAST]
    RESULT["levels_that_satisfy_all_three"] = good or None
    record("E04", "SECONDARY visibly changes the eyes at some level, with the body unmoved and no clipping",
           bool(good), levels_that_work=good or None, summary=summary,
           thresholds={"eye_moved_over": MOVED, "body_moved_under": STILL,
                       "eye_clipped_under": CLIP, "eye_over_face_at_least": CONTRAST},
           note="THE WHOLE QUESTION, and it is three requirements at once because they pull against each "
                "other. A level that makes SECONDARY visible by letting the eyes clip is not a fix -- the "
                "founder's Skeleton Flame correction is explicit that the eyes must stay individually "
                "readable rather than becoming one blown-out light.")

    shipped = summary.get("14")
    record("E05", "at the SHIPPED level, SECONDARY visibly changes the eyes",
           bool(shipped and (shipped["eye_moved"] or 0) > MOVED), shipped=shipped,
           note="rung zero, and the founder's actual build. If this is red while E04 is green, item 6's "
                "channel is correctly wired and invisible at the level that ships -- which is a real defect "
                "with a known fix, not a mystery.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
