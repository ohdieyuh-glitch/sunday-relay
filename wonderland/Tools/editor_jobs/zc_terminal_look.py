# IS THE TERMINAL COLOUR CHANGE APPARENT, AND IS THE i.WONDER MARK A YELLOW LOGO ON NOTHING?
#
# FOUNDER, P1 item 9: "Add Julius + Companion Terminal color customization; theme also recolours
# preset-command/accent UI." And on the emblem: "The emblem is the i.Wonder logo. It must be YELLOW. ONLY THE
# LOGO. Remove: gray outline, black outline, colored background plate, gray plate, black plate, border,
# decorative frame... I do NOT want yellow logo inside gray shape."
#
# THEN, 2026-09-28: "I approved the real fire and terminal colors just make the terminal color change more
# apparent."
#
# WHY THIS JOB EXISTS. Item 9 was being counted as done on two runs that BOTH close by excluding exactly this.
# zc_terminals says outright "the LOOK of the terminal -- the emblem above the rule, the colours -- stays the
# captures' job", and zc_theme_cursor's status line is "the verdict on the colours is the photographs". Between
# them the terminal was proven to OPEN, to grow a tab and to answer a question. Nobody measured the colour or
# the emblem, and I reported the item as passing anyway.
#
# WHAT WAS CHANGED, and so what this has to catch if it is wrong:
#
#   THE JULIUS WINDOW FOLLOWED NOTHING. It had no FollowTheme at all -- the Companion terminal has had one
#   since it was written. Its four brushes were built once in the constructor from GoldDim(), which is the
#   GENERAL theme accent and not JuliusAccent(), so the Julius terminal's own colour never reached its own
#   frame, sections, input box or command slots even in principle. Only text that calls JuliusGold() during
#   paint ever moved. That is a defect, not a matter of degree, and it is most of why the change looked faint.
#
#   BOTH PLATES NOW CARRY A TRACE OF THE ACCENT. The plate is the largest surface either terminal has; the
#   accent used to be a hairline border and a few words of small text. No widget moved, because a colour
#   request is not a licence to redesign a panel.
#
# THE ACCENT IS ALSO THE INSTRUMENT, which is the one pleasing thing here. The emblem's gold is hard-coded --
# that is what "it must be YELLOW" requires -- while the chrome follows the accent. So driving the accent AWAY
# from yellow leaves the emblem as the only yellow thing in the terminal: it isolates the mark for measuring
# and proves the accent reached pixels, in the same reading.
#
# MEASURED IN THE MARK'S OWN RECTANGLE, never a guessed slice of the frame. Four instruments in one night
# measured the HUD, the scenery, or the wrong mascot's green body because their region was a fraction of the
# FRAME rather than of the subject. GetCompanionTerminalMarkRect was added for this and is divided by the same
# widget ReadScreenExtremes screenshots, so the rectangle and the pixels agree.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "terminal_look")

# TWO ACCENTS, EACH MOVING A DIFFERENT CHANNEL, because a reading that moves when two channels move at once
# cannot say which one it saw. That mistake read the green body of the wrong mascot earlier this week.
BLUE = unreal.LinearColor(0.10, 0.22, 1.00, 1.0)
GREEN = unreal.LinearColor(0.12, 1.00, 0.22, 1.0)

# The gold the emblem is hard-coded to, for the record in the result.
EMBLEM_GOLD = (1.00, 0.78, 0.16)


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

    # ---- OPEN THE TERMINAL AND PROVE IT IS ON SCREEN. Everything below reads pixels, and a shut terminal
    # gives a perfectly stable set of readings of the world behind it.
    if not ui.is_live_terminal_open():
        ui.toggle_live_terminal()
    yield 3.0
    RESULT["live_terminal_open"] = bool(ui.is_live_terminal_open())
    RESULT["companions_on_screen"] = bool(ui.are_companion_terminals_on_screen())
    RESULT["companion_count"] = int(ui.get_companion_terminal_count())
    record("E00", "the Live Terminal is open with its companion terminals on screen",
           RESULT["live_terminal_open"] and RESULT["companions_on_screen"]
           and RESULT["companion_count"] > 0,
           open=RESULT["live_terminal_open"], companions=RESULT["companions_on_screen"],
           count=RESULT["companion_count"],
           note="THE PRECONDITION. Every clause below is a pixel reading, and a shut terminal returns a "
                "beautifully consistent set of readings of the world behind it.")
    if not (RESULT["live_terminal_open"] and RESULT["companions_on_screen"]):
        RESULT["status"] = "VOID: the terminal was not on screen"
        return

    def rect(getter, index):
        """(centre, size) as viewport fractions, tolerant of how UE hands back out-params."""
        try:
            got = getattr(ui, getter)(index)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[getter] = str(err)[:140]
            return None
        if not got:
            return None
        # (ok, centre, size) or (centre, size)
        parts = list(got) if isinstance(got, (tuple, list)) else [got]
        if parts and isinstance(parts[0], bool):
            if not parts[0]:
                return None
            parts = parts[1:]
        if len(parts) < 2:
            return None
        c, s = parts[0], parts[1]
        return ((float(c.x), float(c.y)), (float(s.x), float(s.y)))

    mark = rect("get_companion_terminal_mark_rect", 0)
    frame = rect("get_companion_terminal_rect", 0)
    RESULT["mark_rect"] = mark
    RESULT["terminal_rect"] = frame
    record("E01", "the i.Wonder mark reports its own rectangle, so it has painted and can be found",
           mark is not None and frame is not None, mark_rect=mark, terminal_rect=frame,
           note="the accessor returns false before the widget paints, so a caller cannot mistake an "
                "unpainted terminal for a missing emblem.")
    if mark is None or frame is None:
        RESULT["status"] = "VOID: no mark or terminal rectangle"
        return

    # ---- THE RECTANGLE MUST BE SMALL, or the plate clause below is vacuous. A 'mark rect' that is really the
    # whole terminal would be mostly dark plate whatever the emblem does, and would pass by construction.
    mark_area = mark[1][0] * mark[1][1]
    frame_area = frame[1][0] * frame[1][1]
    share = round(mark_area / frame_area, 5) if frame_area > 0 else None
    RESULT["mark_share_of_terminal"] = share
    record("E02", "the mark's rectangle is a small part of the terminal, not the whole panel",
           share is not None and 0.0 < share < 0.25, share_of_terminal=share, ceiling=0.25,
           note="THE CONTROL FOR THE PLATE CLAUSE. If this rectangle were the terminal, it would be mostly "
                "dark plate no matter what the emblem looked like, and E06 would pass by construction.")

    def box(centre, size, pad=1.0):
        cx, cy = centre
        w, h = size[0] * pad * 0.5, size[1] * pad * 0.5
        return (max(0.0, cx - w), max(0.0, cy - h), min(1.0, cx + w), min(1.0, cy + h))

    def extremes(b):
        """(green_over_red, blue_over_red, red_over_blue, mean, sampled) or None."""
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
        return (round(float(p[0]), 4), round(float(p[1]), 4), round(float(p[2]), 4),
                (round(p[3].r, 4), round(p[3].g, 4), round(p[3].b, 4)), int(p[4]))

    def plate(b):
        """(mean, dark_fraction, bright_fraction, sampled) or None."""
        try:
            got = L.read_screen_rect(b[0], b[1], b[2], b[3])
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})["rect"] = str(err)[:140]
            return None
        if not got:
            return None
        p = list(got)
        if p and isinstance(p[0], bool):
            if not p[0]:
                return None
            p = p[1:]
        if len(p) < 4:
            return None
        return ((round(p[0].r, 4), round(p[0].g, 4), round(p[0].b, 4)),
                round(float(p[1]), 4), round(float(p[2]), 4), int(p[3]))

    mark_box = box(mark[0], mark[1])
    frame_box = box(frame[0], frame[1])

    was = L.get_terminal_accent(False)
    RESULT["accent_before"] = (round(was.r, 4), round(was.g, 4), round(was.b, 4))

    runs = {}
    RESULT["runs"] = runs
    for tag, colour in (("blue", BLUE), ("green", GREEN)):
        L.pick_terminal_accent(False, colour)
        L.pick_terminal_accent(True, colour)
        # FollowTheme runs twice a second in both terminals, so give it more than one chance.
        yield 2.5
        painted = ui.get_companion_terminal_accent(0)
        shot = os.path.join(ROOT, "terminal_%s.png" % tag)
        try:
            L.capture_game_viewport(shot)
        except Exception:                                           # noqa: BLE001
            pass
        runs[tag] = {
            "asked": (round(colour.r, 4), round(colour.g, 4), round(colour.b, 4)),
            "painted_accent": (round(painted.r, 4), round(painted.g, 4), round(painted.b, 4)),
            "terminal": extremes(frame_box),
            "mark": extremes(mark_box),
            "mark_plate": plate(mark_box),
            "terminal_plate": plate(frame_box),
            "capture": os.path.basename(shot),
        }
        emit("E_%s" % tag, "INFO", "accent %s" % tag, runs[tag])
        yield 0.5

    # ---- PUT THE FOUNDER'S OWN COLOUR BACK before anything can fail and leave the UI blue.
    L.pick_terminal_accent(False, was)
    L.pick_terminal_accent(True, was)
    yield 2.0
    back = L.get_terminal_accent(False)
    RESULT["accent_after_restore"] = (round(back.r, 4), round(back.g, 4), round(back.b, 4))
    record("E_RESTORE", "the founder's own terminal accent was put back",
           abs(back.r - was.r) < 0.01 and abs(back.g - was.g) < 0.01 and abs(back.b - was.b) < 0.01,
           before=RESULT["accent_before"], after=RESULT["accent_after_restore"])

    b, g = runs.get("blue") or {}, runs.get("green") or {}

    # ---- E03: THE THEME TOOK AT ALL. What the widget is painted in, not what the settings say.
    def painted_matches(run):
        p, a = run.get("painted_accent"), run.get("asked")
        return bool(p and a) and max(abs(p[i] - a[i]) for i in range(3)) < 0.02

    record("E03", "each terminal is painted in the accent that was picked, not merely told about it",
           painted_matches(b) and painted_matches(g),
           blue=b.get("painted_accent"), green=g.get("painted_accent"),
           asked_blue=b.get("asked"), asked_green=g.get("asked"),
           note="GetPaintedAccent is the value FollowTheme last wrote into the brushes, so this separates a "
                "theme that took from one that was set and ignored.")

    # ---- E04: AND IT REACHED THE PIXELS. One channel at a time: blue's own channel against green's run.
    tb = b.get("terminal") or [None] * 5
    tg = g.get("terminal") or [None] * 5
    blue_rise = (round(tb[1] - tg[1], 4)
                 if isinstance(tb[1], float) and isinstance(tg[1], float) else None)
    green_rise = (round(tg[0] - tb[0], 4)
                  if isinstance(tg[0], float) and isinstance(tb[0], float) else None)
    RESULT["blue_over_red_rise"] = blue_rise
    RESULT["green_over_red_rise"] = green_rise
    record("E04", "the accent change is visible in the terminal's own pixels, in the channel that was moved",
           blue_rise is not None and green_rise is not None and blue_rise > 0.05 and green_rise > 0.05,
           blue_over_red_rise=blue_rise, green_over_red_rise=green_rise, floor=0.05,
           blue_run=tb, green_run=tg,
           note="THE FOUNDER'S 'more apparent', asked of the pixels. Each accent is checked in ITS OWN "
                "channel across the two runs, because a reading that moves when two channels move at once "
                "cannot say which one it saw.")

    # ---- E05: THE EMBLEM STAYED YELLOW THROUGH BOTH. This is 'it must be YELLOW' as a measurement: the mark
    # is gold whatever the chrome is doing, which is only true if it is drawn and is not swept by the theme.
    mb = b.get("mark") or [None] * 5
    mg = g.get("mark") or [None] * 5
    gold_blue, gold_green = mb[2], mg[2]
    RESULT["mark_red_over_blue"] = {"under_blue_accent": gold_blue, "under_green_accent": gold_green}
    record("E05", "the i.Wonder mark is still yellow with the chrome driven to blue and to green",
           isinstance(gold_blue, float) and isinstance(gold_green, float)
           and gold_blue > 0.12 and gold_green > 0.12,
           red_over_blue_under_blue=gold_blue, red_over_blue_under_green=gold_green, floor=0.12,
           emblem_gold=EMBLEM_GOLD,
           note="the emblem's gold is hard-coded on purpose -- 'It must be YELLOW' -- while the chrome "
                "follows the accent. So a warm mark surviving a blue terminal is the emblem being drawn AND "
                "being independent of the theme, in one reading.")

    # ---- E06: ON NOTHING. The founder's actual complaint: "I do NOT want yellow logo inside gray shape."
    #
    # The mark is strokes, not a fill. Thick is max(Radius*0.13, 1.2), so the ring alone covers roughly
    # 2*pi*R*0.13R over a (2R)^2 box, about a fifth of it; with the twin curves and the wave beneath, well
    # under half. A PLATE would fill that rectangle and leave almost none of the terminal's own dark ground.
    # So most of the mark's rectangle must still be the plate it sits on.
    mp = b.get("mark_plate") or [None] * 4
    tp = b.get("terminal_plate") or [None] * 4
    RESULT["mark_dark_fraction"] = mp[1]
    RESULT["terminal_dark_fraction"] = tp[1]
    record("E06", "the mark sits on the terminal's own ground, with no plate of its own filling its rectangle",
           isinstance(mp[1], float) and mp[1] >= 0.45,
           mark_dark_fraction=mp[1], terminal_dark_fraction=tp[1], floor=0.45,
           note="'I do NOT want yellow logo inside gray shape.' The mark is drawn as strokes -- a ring, the "
                "twin curves and a wave -- which cover well under half of their own bounding box, so most of "
                "that box has to still be the dark ground. A plate would fill it. The terminal's own figure "
                "is reported beside it for scale.")

    # ---- E07: WHERE IT SITS. Founder, 2026-09-25: "the symbol/logo at the bottom left must be ABOVE the
    # horizontal divider". The half this can measure is the bottom left, from the two rectangles.
    rel_x = round((mark[0][0] - (frame[0][0] - frame[1][0] * 0.5)) / frame[1][0], 4) if frame[1][0] else None
    rel_y = round((mark[0][1] - (frame[0][1] - frame[1][1] * 0.5)) / frame[1][1], 4) if frame[1][1] else None
    RESULT["mark_position_in_terminal"] = {"x": rel_x, "y": rel_y}
    record("E07", "the mark sits in the lower left of its terminal",
           rel_x is not None and rel_y is not None and rel_x < 0.5 and rel_y > 0.5,
           x_fraction=rel_x, y_fraction=rel_y,
           note="HALF THE FOUNDER'S SENTENCE. 'Bottom left' is measurable from the two rectangles; 'above "
                "the horizontal divider' is not, because the divider has no accessor -- so this does not "
                "claim it. The captures carry that half.")

    # ---- THE CONTROL THAT KEEPS ALL OF IT HONEST: the two runs must actually differ somewhere. If the
    # terminal were not really being repainted, every clause above that compares the runs would be comparing
    # one picture with itself, and 'the emblem did not change' would be true for the worst reason.
    differ = None
    if isinstance(tb[1], float) and isinstance(tg[1], float) and isinstance(tb[0], float) \
            and isinstance(tg[0], float):
        differ = round(max(abs(tb[0] - tg[0]), abs(tb[1] - tg[1]), abs(tb[2] - tg[2])), 4)
    RESULT["difference_between_the_two_runs"] = differ
    record("E08", "the two accent runs are actually different pictures",
           differ is not None and differ > 0.05, biggest_channel_difference=differ, floor=0.05,
           note="THE SECOND CONTROL. Flat on both sides means the instrument or the terminal is broken, not "
                "that the emblem is admirably stable -- and that is the shape of every vacuous pass this "
                "tree has produced.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
