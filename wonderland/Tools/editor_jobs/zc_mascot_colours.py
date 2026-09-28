# DOES THE FOUNDER'S PRIMARY REACH THE BODY AND THE SECONDARY REACH THE EYES?
#
# FOUNDER, P1 item 6: "Mascot colors: PRIMARY = main/full mascot colorway. SECONDARY = Relay Dog eyes.
# Persist/apply to world, Wardrobe, missions."
#
# THE FEATURE EXISTS AND HAS NEVER BEEN GATED. WonderlandMascotStyle registers wl.Mascot.Primary,
# wl.Mascot.Secondary and wl.Mascot.Reset, the settings are Config properties so they persist, and
# RelayDogCharacter::PaintCanonBody applies them. The only proof in done/ is zc_mascot_style, which recorded
# "chosen_primary" and "chosen_secondary" as facts, declared ZERO clauses, and set its own status to
# "measured; the verdict on the colours is the photographs".
#
# That is a reasonable thing to say about whether a colourway looks GOOD. It is not a reasonable thing to say
# about whether the colour ARRIVES, which is a question about pixels and is answerable.
#
# HOW: two colours are chosen that cannot be confused with each other or with anything already on the Dog --
# pure green for the body, pure magenta for the eyes. Relay OG is white with warm gold eyes, so neither
# appears on it by default. Then the Wardrobe preview is photographed, which is one of the three surfaces the
# founder named and the only one with a black ground and a rect the widget reports.
#
#   PRIMARY ARRIVED    a large region of the figure is green-dominant
#   SECONDARY ARRIVED  a small region is magenta-dominant
#   NEITHER LEAKS      the reset frame contains almost none of either
#
# THE RESET FRAME IS THE CONTROL and it is the reason this job can claim anything. Finding green on a figure
# proves nothing unless the same figure without a colourway has none: three times tonight a comparison passed
# because both sides were the same. So the preview is measured twice, once cleared and once set, and the
# clauses turn on the DIFFERENCE.
#
# WHAT IT DOES NOT COVER: "missions" as a surface, and whether the colourway persists across an editor
# restart. The config property is the persistence mechanism and this job restores it rather than restarting
# the editor to test it.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import hashlib
import os
import sys
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "mascot_colours")
REPO = os.path.dirname(os.path.dirname(CHANNEL))

# Neither appears on Relay OG, which is white with warm gold eyes, so either one found in the frame arrived
# from the colourway and not from the costume.
PRIMARY = (0.05, 0.85, 0.15)
SECONDARY = (0.95, 0.10, 0.80)
# The preview rect includes the widget's border and caption; 0.08 is the inset measured in zc_stance_preview
# as the largest that excludes the chrome and the smallest that still admits the whole figure.
RECT_INSET = 0.08
FIGURE_FLOOR = 0.06
# A pixel is "that colour" when the named channel leads the others by this much. Loose, because the figure is
# lit and shaded rather than flat, and the test is arrival rather than exactness.
LEAD = 1.35


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    sys.path.insert(0, os.path.join(REPO, "Tools"))
    from night_figure import read                                   # noqa: WPS433

    RESULT["tests"] = []
    RESULT["asked"] = {"primary": list(PRIMARY), "secondary": list(SECONDARY)}

    def record(tid, name, ok, **detail):
        RESULT["tests"].append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def fingerprint(path):
        try:
            with open(path, "rb") as fh:
                return hashlib.md5(fh.read()).hexdigest()
        except Exception:                                           # noqa: BLE001
            return None

    def settings():
        try:
            return unreal.get_default_object(unreal.WonderlandMascotStyleSettings)
        except Exception:                                           # noqa: BLE001
            return None

    def read_style():
        s = settings()
        if s is None:
            return None
        out = {}
        for key, prop in (("primary", "primary"), ("secondary", "secondary")):
            try:
                c = s.get_editor_property(prop)
                out[key] = [round(float(c.r), 4), round(float(c.g), 4), round(float(c.b), 4)]
            except Exception:                                       # noqa: BLE001
                out[key] = None
        try:
            out["chosen"] = bool(s.get_editor_property("b_chosen"))
        except Exception:                                           # noqa: BLE001
            out["chosen"] = None
        return out

    def tally(path, centre, size):
        """How much of the figure is green-dominant and how much is magenta-dominant, inside the preview."""
        w, h, chan, px = read(path)
        rx0 = max(int((centre.x - size.x * (0.5 - RECT_INSET)) * w), 0)
        ry0 = max(int((centre.y - size.y * (0.5 - RECT_INSET)) * h), 0)
        rx1 = min(int((centre.x + size.x * (0.5 - RECT_INSET)) * w), w - 1)
        ry1 = min(int((centre.y + size.y * (0.5 - RECT_INSET)) * h), h - 1)
        lit = green = magenta = 0
        for y in range(ry0, ry1 + 1):
            row = y * w * chan
            for x in range(rx0, rx1 + 1):
                i = row + x * chan
                r, g, b = float(px[i]), float(px[i + 1]), float(px[i + 2])
                if (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0 < FIGURE_FLOOR:
                    continue
                lit += 1
                # green leads BOTH others; magenta is red and blue together leading green.
                if g > r * LEAD and g > b * LEAD:
                    green += 1
                elif r > g * LEAD and b > g * LEAD:
                    magenta += 1
        if lit < 200:
            return None
        return {"lit": lit,
                "green_fraction": round(green / float(lit), 4),
                "magenta_fraction": round(magenta / float(lit), 4),
                "rect": [rx0, ry0, rx1, ry1]}

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
    if dog is None or ui is None:
        RESULT["status"] = "VOID: no pawn or no UI subsystem"
        return

    as_found = read_style()
    RESULT["style_as_found"] = as_found
    record("C00", "the mascot style settings can be read back",
           as_found is not None and as_found.get("primary") is not None, as_found=as_found,
           note="a setting that cannot be read cannot be restored, and this job changes a colourway the "
                "founder may have chosen.")
    if as_found is None or as_found.get("primary") is None:
        RESULT["status"] = "VOID: cannot read the mascot style, so it cannot be restored either"
        return

    try:
        ui.wear_relay_skin("relay_og")
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["wear"] = str(err)[:140]
    yield 5.0
    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    pressed = ui.press_switch_skin()
    yield 4.0
    record("C01", "the wardrobe is open through the founder's own button",
           bool(pressed) and ui.is_brain_skins_open(), pressed=bool(pressed))
    rect = ui.get_skin_preview_rect()
    got = rect is not None
    centre, size = rect if got else (None, None)
    record("C02", "the preview window reports where it is", got)
    if not got:
        RESULT["status"] = "FAIL: no preview rect"
        return

    def eye_colour(path, centre, size):
        """The colour of the EYES, found by saturation rather than by counting a named hue.

        WHY NOT "IS THERE MAGENTA". The channel is applied by MULTIPLICATION and Relay OG's eyes are warm
        gold (1.0, 0.78, 0.16), so a magenta SECONDARY produces PINK -- and pink fails the blue > green
        test that the magenta count uses. The old clause was looking for a colour the renderer cannot make
        from that starting hue, and read 0.0000 through every run while the eyes were plainly changing.

        AND NOT A BAND EITHER. A strip across the brightest row spans the whole head, so two small eyes sit
        in a sea of white bone and black visor and barely move its mean -- measured that way the shipped
        eye level looked dead and a level a hundred times higher looked alive, which is the exact inverse of
        what the captures show.

        The eyes are the most SATURATED thing on this figure. The top few per cent by chroma is them.
        """
        w, h, chan, px = read(path)
        x0 = max(int((centre.x - size.x * 0.30) * w), 0)
        x1 = min(int((centre.x + size.x * 0.30) * w), w - 1)
        y0 = max(int((centre.y - size.y * 0.40) * h), 0)
        y1 = min(int((centre.y - size.y * 0.02) * h), h - 1)
        picks = []
        for y in range(y0, y1):
            for x in range(x0, x1):
                i = (y * w + x) * chan
                R, G, B = px[i], px[i + 1], px[i + 2]
                mx, mn = max(R, G, B), min(R, G, B)
                if mx < 60:
                    continue
                picks.append((mx - mn, R, G, B))
        if not picks:
            return None
        picks.sort(reverse=True)
        top = picks[:max(len(picks) // 50, 50)]
        n = len(top)
        return {"rgb": [round(sum(t[1] for t in top) / n / 255.0, 4),
                        round(sum(t[2] for t in top) / n / 255.0, 4),
                        round(sum(t[3] for t in top) / n / 255.0, 4)],
                "chroma": round(sum(t[0] for t in top) / n / 255.0, 4), "px": n}

    def shoot(label):
        name = "colours_%s.png" % label
        path = os.path.join(ROOT, name)
        try:
            shot = L.capture_game_viewport(path)
            if not shot:
                raise RuntimeError("capture_game_viewport returned falsy: the editor is probably not foreground")
            RESULT.setdefault("capture_hashes", {})[name] = fingerprint(path)
            RESULT.setdefault("readings", {})[label] = tally(path, centre, size)
            RESULT.setdefault("eyes", {})[label] = eye_colour(path, centre, size)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[label] = str(err)[:160]
        emit("C_%s" % label, "INFO", label, (RESULT.get("readings") or {}).get(label))

    # ---- THE CONTROL FIRST: cleared, so neither colour is anywhere on the figure.
    unreal.SystemLibrary.execute_console_command(world, "wl.Mascot.Reset")
    yield 5.0
    RESULT["style_after_reset"] = read_style()
    shoot("reset")

    # ---- THEN THE FOUNDER'S OWN ROUTE: the console commands, not the settings object.
    unreal.SystemLibrary.execute_console_command(
        world, "wl.Mascot.Primary %.3f,%.3f,%.3f" % PRIMARY)
    unreal.SystemLibrary.execute_console_command(
        world, "wl.Mascot.Secondary %.3f,%.3f,%.3f" % SECONDARY)
    yield 5.0
    after = read_style()
    RESULT["style_after_set"] = after

    def near(got, want):
        return got is not None and all(abs(a - b) < 0.02 for a, b in zip(got, want))

    record("C03", "the console commands set the colourway the founder typed",
           near((after or {}).get("primary"), PRIMARY)
           and near((after or {}).get("secondary"), SECONDARY),
           asked=RESULT["asked"], read_back=after,
           note="read back from the settings object rather than trusting the command. The founder's route is "
                "the console; the settings object is the record.")
    shoot("set")

    # ---- AND ONE CHANNEL AT A TIME, because both at once cannot be read apart.
    #
    # THE "SET" FRAME ABOVE MOVES BOTH CHANNELS, and that makes the eyes unmeasurable in it. With PRIMARY
    # driving the whole body to saturated green, the most saturated pixels on the figure are the BODY, so an
    # eye locator built on chroma reports the body's colour and a clause built on that passes for the wrong
    # reason. Restricting the search to the visor does not save it either: the visor is black and so is the
    # backdrop around the head, so "the dark region" is most of the frame.
    #
    # The founder's requirement is that the two channels be GENUINELY INDEPENDENT, and the direct test of
    # that is to move one and check the other did not follow. So SECONDARY is set on its own here, against a
    # body left at its default white, where the eyes are unambiguously the most saturated thing on the
    # figure and the same locator is sound.
    unreal.SystemLibrary.execute_console_command(world, "wl.Mascot.Reset")
    yield 4.0
    unreal.SystemLibrary.execute_console_command(
        world, "wl.Mascot.Secondary %.3f,%.3f,%.3f" % SECONDARY)
    yield 5.0
    shoot("secondary_only")

    # ---- PUT BACK WHAT WAS FOUND, and check it went back.
    unreal.SystemLibrary.execute_console_command(world, "wl.Mascot.Reset")
    yield 2.0
    if as_found.get("chosen"):
        unreal.SystemLibrary.execute_console_command(
            world, "wl.Mascot.Primary %.3f,%.3f,%.3f" % tuple(as_found["primary"]))
        unreal.SystemLibrary.execute_console_command(
            world, "wl.Mascot.Secondary %.3f,%.3f,%.3f" % tuple(as_found["secondary"]))
    yield 3.0
    restored = read_style()
    RESULT["style_restored"] = restored
    def same_style(a, b):
        """Is this the same colourway, including the case where there is not one?

        THE BUG THIS REPLACES failed the clause on a run that restored correctly. It read

            near(restored["primary"], as_found["primary"]) if as_found["chosen"] else restored["chosen"] is False

        and `as_found["chosen"]` was None -- nothing chosen -- so the else arm ran and asked whether
        `restored["chosen"] is False`. It was None too. `None is False` is False, so a colourway that was
        put back exactly reported as a colourway left changed. Unreal folds a Blueprint bool-with-out-params
        into tuple-or-None, so "nothing chosen" reaches Python as None here and as False elsewhere in this
        same file; an identity test against one of the two spellings fails on the other.

        A restore clause that cries wolf is worse than none: this one exists so that a job leaving a
        colourway behind is caught, and a permanent red teaches the next reader to skip it.
        """
        if a is None or b is None:
            return False
        if bool(a.get("chosen")) != bool(b.get("chosen")):
            return False
        if not bool(a.get("chosen")):
            return True                                  # nothing was chosen before, nothing is chosen now
        return (near(a.get("primary"), b.get("primary"))
                and near(a.get("secondary"), b.get("secondary")))

    record("C_RESTORE", "the colourway the job found was put back",
           same_style(restored, as_found),
           as_found=as_found, restored=restored,
           note="a job that leaves a colourway changed makes every later capture in this session -- and every "
                "other lane's -- a photograph of this job.")

    r = RESULT.get("readings") or {}
    reset_row, set_row = r.get("reset"), r.get("set")
    record("C04", "both frames measured the figure", bool(reset_row) and bool(set_row),
           reset=reset_row, set=set_row)
    if not reset_row or not set_row:
        RESULT["status"] = "VOID: a frame did not contain the figure"
        return

    prints = [v for v in (RESULT.get("capture_hashes") or {}).values() if v]
    record("C05", "every frame is a different picture",
           len(prints) >= 3 and len(set(prints)) == len(prints),
           files=len(prints), distinct=len(set(prints)), wanted_at_least=3,
           note="if setting a colourway changed nothing on screen the frames are identical and every "
                "fraction below would be the same number twice. Counts ALL frames rather than a hard-coded "
                "two: this clause went red the moment a third frame was added, on a run where all three "
                "were distinct, which is a bookkeeping failure wearing the costume of a real one.")

    RESULT["primary_arrived"] = {"before": reset_row["green_fraction"], "after": set_row["green_fraction"]}
    RESULT["secondary_arrived"] = {"before": reset_row["magenta_fraction"],
                                   "after": set_row["magenta_fraction"]}
    record("C06", "PRIMARY reaches the body",
           set_row["green_fraction"] > 0.15 and set_row["green_fraction"] > reset_row["green_fraction"] + 0.10,
           green_fraction=RESULT["primary_arrived"], floor=0.15,
           note="the founder's PRIMARY is the main colourway, so it should cover a large part of the figure. "
                "Judged against the cleared frame, because finding green proves nothing unless the same "
                "figure without a colourway has none.")
    eyes = RESULT.get("eyes") or {}
    e_before, e_after = eyes.get("reset"), eyes.get("secondary_only")
    moved = (round(max(abs(e_before["rgb"][i] - e_after["rgb"][i]) for i in range(3)), 4)
             if e_before and e_after else None)
    RESULT["secondary_moved_the_eyes"] = {"reset_rgb": (e_before or {}).get("rgb"),
                                          "set_rgb": (e_after or {}).get("rgb"), "moved": moved}
    sec_row = (RESULT.get("readings") or {}).get("secondary_only") or {}
    body_followed = round(sec_row.get("green_fraction", 0.0) - reset_row.get("green_fraction", 0.0), 4)
    RESULT["body_followed_secondary"] = body_followed
    record("C07", "SECONDARY visibly changes the eye colour, and the body does not follow it",
           moved is not None and moved >= 0.15 and abs(body_followed) <= 0.02,
           body_followed=body_followed,
           **RESULT["secondary_moved_the_eyes"], floor=0.15,
           note="ASKED AS 'DID THE EYES CHANGE', not 'is there magenta'. The channel multiplies, so a "
                "magenta SECONDARY on gold eyes renders PINK -- measured at RGB 0.929, 0.430, 0.483 against "
                "0.485, 0.798, 0.467 for a cyan one, a move of 0.444. The old clause counted magenta pixels "
                "and found none through every run while the eyes were plainly changing, and its upper bound "
                "-- SECONDARY must not reach the body -- passed just as happily when SECONDARY reached "
                "nothing at all.")


    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
