# DOES THE SECONDARY TERMINAL COLOUR CHANGE THE WORDS WITHOUT TOUCHING THE CHROME?
#
# FOUNDER, 2026-09-28: "Make a secondary live terminal colors option for the text colors of the words inside
# the terminal."
#
# THE SHAPE IS THE ONE THE MASCOT ALREADY HAS. Item 6 is PRIMARY = the colourway, SECONDARY = the eyes. Here
# PRIMARY is the terminal accent -- frame, rule, title, the plate's tint -- and SECONDARY is the transcript:
# what the companion and Julius actually SAY. So the thing to prove is not merely that a new colour exists,
# it is that the two are INDEPENDENT. A secondary that drags the chrome with it has not been added; it has
# been aliased onto the primary.
#
# THREE THINGS, AND THE THIRD IS THE ONE THAT CAN QUIETLY FAIL:
#
#   IT TAKES         GetTerminalTextColour returns what was picked, through the same SaveAndApply the Colors
#                    tab's own swatch calls -- not a private path a player never walks.
#
#   IT REACHES PIXELS  the terminal's own rectangle shows the new hue. A setting that is stored and never
#                    drawn is the exact failure this project has hit twice tonight: a material property never
#                    applied, and a terminal whose chrome followed nothing.
#
#   IT IS INDEPENDENT  the accent does not move when the text colour is picked, and the text does not move
#                    when the accent is picked. Checked in BOTH directions, because "I changed one and the
#                    other happened to look the same" is satisfied by a build where both are the same
#                    variable and I only ever wrote to one of them.
#
# THE WORDS ARE THERE WITHOUT TYPING. The companion's intro line -- "THE LLM COMPANION BUILT FOR WONDERLAND"
# -- is wired to the secondary colour along with the transcript, so a terminal that has never been spoken to
# still has words in it to measure. That is deliberate: a proof that had to hold a conversation first would
# fail for reasons that have nothing to do with the colour.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "terminal_text")

# ONE CHANNEL AT A TIME. The text goes green and the accent stays where it is; then the accent goes blue and
# the text stays green. Moving two channels at once produces a reading that cannot say which one it saw --
# the mistake that read the wrong mascot's body earlier this week.
TEXT_GREEN = unreal.LinearColor(0.10, 1.00, 0.25, 1.0)
ACCENT_BLUE = unreal.LinearColor(0.10, 0.22, 1.00, 1.0)


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
        RESULT["status"] = "VOID: no UI subsystem"
        return

    if not ui.is_live_terminal_open():
        ui.toggle_live_terminal()
    yield 3.0
    on = bool(ui.is_live_terminal_open()) and bool(ui.are_companion_terminals_on_screen())
    record("T00", "the terminal is open with its companion terminals on screen", on,
           open=bool(ui.is_live_terminal_open()),
           companions=bool(ui.are_companion_terminals_on_screen()),
           note="THE PRECONDITION. Every clause below reads pixels, and a shut terminal gives a beautifully "
                "consistent set of readings of the world behind it.")
    if not on:
        RESULT["status"] = "VOID: the terminal was not on screen"
        return

    def rect(getter, index):
        try:
            got = getattr(ui, getter)(index)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[getter] = str(err)[:140]
            return None
        if not got:
            return None
        parts = list(got) if isinstance(got, (tuple, list)) else [got]
        if parts and isinstance(parts[0], bool):
            if not parts[0]:
                return None
            parts = parts[1:]
        if len(parts) < 2:
            return None
        c, s = parts[0], parts[1]
        return ((float(c.x), float(c.y)), (float(s.x), float(s.y)))

    frame = rect("get_companion_terminal_rect", 0)
    record("T01", "the companion terminal reports where it is", frame is not None, rect=frame)
    if frame is None:
        RESULT["status"] = "VOID: no terminal rectangle"
        return

    def box(centre, size):
        cx, cy = centre
        w, h = size[0] * 0.5, size[1] * 0.5
        return (max(0.0, cx - w), max(0.0, cy - h), min(1.0, cx + w), min(1.0, cy + h))

    def extremes(b):
        try:
            got = L.read_screen_extremes(b[0], b[1], b[2], b[3])
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})["extremes"] = str(err)[:140]
            return None
        if not got:
            return None
        p = list(got)
        if p and isinstance(p[0], bool):
            if not p[0]:
                return None
            p = p[1:]
        if len(p) < 5:
            return None
        return {"green_over_red": round(float(p[0]), 4), "blue_over_red": round(float(p[1]), 4),
                "red_over_blue": round(float(p[2]), 4),
                "mean": (round(p[3].r, 4), round(p[3].g, 4), round(p[3].b, 4)), "sampled": int(p[4])}

    def colour(c):
        return (round(c.r, 4), round(c.g, 4), round(c.b, 4))

    area = box(frame[0], frame[1])

    was_text = L.get_terminal_text_colour(False)
    was_accent = L.get_terminal_accent(False)
    RESULT["before"] = {"text": colour(was_text), "accent": colour(was_accent)}

    steps = {}
    RESULT["steps"] = steps

    def shoot(tag):
        path = os.path.join(ROOT, "%s.png" % tag)
        try:
            L.capture_game_viewport(path)
        except Exception:                                           # noqa: BLE001
            pass
        steps[tag] = {"text_setting": colour(L.get_terminal_text_colour(False)),
                      "accent_setting": colour(L.get_terminal_accent(False)),
                      "pixels": extremes(area), "capture": os.path.basename(path)}
        emit("T_%s" % tag, "INFO", tag, steps[tag])

    shoot("baseline")

    # ---- MOVE ONLY THE SECONDARY.
    L.pick_terminal_text_colour(False, TEXT_GREEN)
    yield 2.5
    shoot("text_green")

    # ---- AND NOW ONLY THE PRIMARY, leaving the secondary where it is.
    L.pick_terminal_accent(False, ACCENT_BLUE)
    yield 2.5
    shoot("text_green_accent_blue")

    base, green, both = steps.get("baseline") or {}, steps.get("text_green") or {}, \
        steps.get("text_green_accent_blue") or {}

    record("T02", "the secondary colour is stored and read back as what was picked",
           green.get("text_setting") is not None
           and max(abs(green["text_setting"][i] - colour(TEXT_GREEN)[i]) for i in range(3)) < 0.02,
           asked=colour(TEXT_GREEN), got=green.get("text_setting"),
           note="written through the same SaveAndApply the Colors tab's swatch calls, not a private path.")

    gb = (base.get("pixels") or {}).get("green_over_red")
    gg = (green.get("pixels") or {}).get("green_over_red")
    rise = round(gg - gb, 4) if isinstance(gb, float) and isinstance(gg, float) else None
    RESULT["green_rise_from_the_text_alone"] = rise
    record("T03", "picking the secondary colour changes the terminal's own pixels",
           rise is not None and rise > 0.05, before=gb, after=gg, rise=rise, floor=0.05,
           note="THE FOUNDER'S REQUEST, asked of the pixels. A setting that is stored and never drawn is the "
                "exact failure this project hit twice tonight -- a material property never applied, and a "
                "terminal whose chrome followed nothing at all.")

    # ---- INDEPENDENCE, BOTH WAYS.
    accent_held = (base.get("accent_setting") is not None
                   and green.get("accent_setting") == base.get("accent_setting"))
    record("T04", "picking the SECONDARY left the accent alone",
           accent_held, accent_before=base.get("accent_setting"), accent_after=green.get("accent_setting"),
           note="half of independence. A secondary that drags the chrome with it has not been added, it has "
                "been aliased onto the primary.")

    text_held = (both.get("text_setting") is not None
                 and both.get("text_setting") == green.get("text_setting"))
    record("T05", "picking the PRIMARY afterwards left the words' colour alone",
           text_held, text_before=green.get("text_setting"), text_after=both.get("text_setting"),
           note="THE OTHER HALF, and the one that catches a build where both are the same variable and only "
                "one of them was ever written to. Checked in both directions for that reason.")

    bb = (green.get("pixels") or {}).get("blue_over_red")
    bo = (both.get("pixels") or {}).get("blue_over_red")
    blue_rise = round(bo - bb, 4) if isinstance(bb, float) and isinstance(bo, float) else None
    RESULT["blue_rise_from_the_accent_alone"] = blue_rise
    record("T06", "the chrome still answers its own colour while the words keep theirs",
           blue_rise is not None and blue_rise > 0.05
           and isinstance(gg, float) and (both.get("pixels") or {}).get("green_over_red", 0) > gg * 0.5,
           blue_before=bb, blue_after=bo, blue_rise=blue_rise,
           green_still=(both.get("pixels") or {}).get("green_over_red"), green_was=gg,
           note="both hues present at once is what two independent colours look like. If the accent had "
                "swallowed the text, the green would collapse when the blue arrived.")

    # ---- PUT THE FOUNDER'S OWN COLOURS BACK.
    L.pick_terminal_text_colour(False, was_text)
    L.pick_terminal_accent(False, was_accent)
    yield 2.0
    RESULT["after_restore"] = {"text": colour(L.get_terminal_text_colour(False)),
                               "accent": colour(L.get_terminal_accent(False))}
    back = RESULT["after_restore"]
    record("T_RESTORE", "the founder's own terminal colours were put back",
           back["text"] == RESULT["before"]["text"] and back["accent"] == RESULT["before"]["accent"],
           before=RESULT["before"], after=back)

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
