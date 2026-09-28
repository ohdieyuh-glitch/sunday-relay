# ONE TERMINAL SECONDARY, AND IT MOVES THE LETTERS IN ALL THREE TERMINALS -- two colours, measured and photographed.
#
# FOUNDER, 2026-09-28 (correction pass):
#   "The SECONDARY Live Terminal color currently does not correctly change the LETTER/TEXT COLOR ... The same
#    Secondary terminal color customization must change the LETTER COLORS of the companion terminals as well ...
#    prove behavior with at least two visibly different test colors ... Verify this on: Julius Live Terminal,
#    Claude Code companion terminal, ChatGPT companion terminal. The relevant text must change without
#    incorrectly recoloring unrelated UI. Then restore the intended/default customization state unless the
#    current user's saved customization specifies otherwise."
#
# WHY THE EARLIER 8/8 DID NOT CATCH IT. zc_terminal_text_colour picked only the COMPANION colour and measured only
# companion terminal 0. The Julius Secondary was wired to SWonderlandLiveTerminal::JuliusBody -- a widget built in
# the constructor and never placed in the window -- so the Live Terminal's letters could not move at all, and the
# companions were on a second, unconnected setting.
#
# THE PATH IS THE PLAYER'S: PickTerminalTextColour(true, ...) writes exactly what the Colors tab's "JULIUS TERMINAL
# SECONDARY" swatch writes (the shared Secondary, and it clears the companions' override), then SaveAndApply.
#
# WHAT IS READ: ReadScreenExtremes -- the most strongly tinted pixel -- inside each terminal's own rectangle. The
# Julius window's rectangle is its anchors in SWonderlandLiveTerminal (0.304-0.696 x 0.696-0.969, bottom-anchored,
# extended only while work needs it); each companion reports its own. Colour A is green (a hue nothing in the
# terminals is drawn in), colour B is blue; the PRIMARY accent stays gold throughout and is read back to prove it
# never moved. Then the founder's raw state -- colours AND chosen flags -- is put back exactly.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "terminal_secondary_0928")
COLOUR_A = unreal.LinearColor(0.10, 1.00, 0.25, 1.0)     # green
COLOUR_B = unreal.LinearColor(0.12, 0.40, 1.00, 1.0)     # blue
JULIUS_RECT = (0.310, 0.715, 0.690, 0.955)               # inside the window's anchors, clear of its frame


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

    def colour(c):
        return [round(c.r, 4), round(c.g, 4), round(c.b, 4)]

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)

    # ---- THE FOUNDER'S STATE, RAW, BEFORE ANYTHING IS TOUCHED.
    state = L.get_terminal_text_state()
    parts = list(state) if isinstance(state, (tuple, list)) else []
    if len(parts) != 4:
        RESULT["status"] = "VOID: could not read the raw Secondary state (%r)" % (state,)
        return
    j_col, j_on, c_col, c_on = parts
    RESULT["state_before"] = {"julius": colour(j_col), "julius_chosen": bool(j_on),
                              "companion": colour(c_col), "companion_chosen": bool(c_on)}
    accents_before = {"julius": colour(L.get_terminal_accent(True)), "companion": colour(L.get_terminal_accent(False))}
    RESULT["accents_before"] = accents_before

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
    record("T00", "the Julius Live Terminal is open with both companion terminals on screen", on,
           open=bool(ui.is_live_terminal_open()), companions=bool(ui.are_companion_terminals_on_screen()),
           count=int(ui.get_companion_terminal_count()))
    if not on:
        RESULT["status"] = "VOID: the terminals were not on screen"
        return

    def rect_of(index):
        got = ui.get_companion_terminal_rect(index)
        p = list(got) if isinstance(got, (tuple, list)) else [got]
        if p and isinstance(p[0], bool):
            if not p[0]:
                return None
            p = p[1:]
        if len(p) < 2:
            return None
        (cx, cy), (sx, sy) = (p[0].x, p[0].y), (p[1].x, p[1].y)
        # inset so the frame's own hairline is not what gets measured
        return (cx - sx * 0.44, cy - sy * 0.40, cx + sx * 0.44, cy + sy * 0.44)

    rects = {"julius": JULIUS_RECT}
    titles = {}
    for i in range(int(ui.get_companion_terminal_count())):
        title = str(ui.get_companion_terminal_title(i))
        r = rect_of(i)
        key = "claude_code" if "claude" in title.lower() else ("chatgpt" if ("gpt" in title.lower() or "llm" in title.lower()) else "companion_%d" % i)
        titles[key] = title
        if r is not None:
            rects[key] = r
    RESULT["rects"] = {k: [round(v, 4) for v in r] for k, r in rects.items()}
    RESULT["titles"] = titles
    record("T01", "all three terminals report where they are (Julius, Claude Code, ChatGPT)",
           all(k in rects for k in ("julius", "claude_code", "chatgpt")), rects=RESULT["rects"], titles=titles)

    def extremes(r):
        got = L.read_screen_extremes(r[0], r[1], r[2], r[3])
        p = list(got) if isinstance(got, (tuple, list)) else []
        if p and isinstance(p[0], bool):
            if not p[0]:
                return None
            p = p[1:]
        if len(p) < 5:
            return None
        return {"green_over_red": round(float(p[0]), 4), "blue_over_red": round(float(p[1]), 4),
                "red_over_blue": round(float(p[2]), 4), "sampled": int(p[4])}

    steps = {}
    RESULT["steps"] = steps

    def shoot(tag):
        path = os.path.join(ROOT, "%s.png" % tag)
        L.capture_game_viewport(path)
        steps[tag] = {k: extremes(r) for k, r in rects.items()}
        steps[tag]["_setting"] = {"julius_text": colour(L.get_terminal_text_colour(True)),
                                  "companion_text": colour(L.get_terminal_text_colour(False)),
                                  "julius_accent": colour(L.get_terminal_accent(True)),
                                  "companion_accent": colour(L.get_terminal_accent(False))}
        emit("STEP", tag, steps[tag])

    shoot("0_baseline")
    L.pick_terminal_text_colour(True, COLOUR_A)
    yield 2.5
    shoot("1_secondary_green")
    L.pick_terminal_text_colour(True, COLOUR_B)
    yield 2.5
    shoot("2_secondary_blue")

    base, a, b = steps["0_baseline"], steps["1_secondary_green"], steps["2_secondary_blue"]
    for key in ("julius", "claude_code", "chatgpt"):
        b0, ba, bb = base.get(key) or {}, a.get(key) or {}, b.get(key) or {}
        g0, ga, gb = b0.get("green_over_red"), ba.get("green_over_red"), bb.get("green_over_red")
        u0, ua, ub = b0.get("blue_over_red"), ba.get("blue_over_red"), bb.get("blue_over_red")
        record("T_%s_A" % key, "%s: Secondary GREEN turns its lettering green" % key,
               None not in (g0, ga) and ga - g0 > 0.08, baseline=b0, green=ba)
        record("T_%s_B" % key, "%s: Secondary BLUE turns the SAME lettering blue, and the green goes" % key,
               None not in (u0, ub, ga, gb) and ub - u0 > 0.08 and gb < ga - 0.05, baseline=b0, green=ba, blue=bb)

    held = all(steps[t]["_setting"]["julius_accent"] == accents_before["julius"]
               and steps[t]["_setting"]["companion_accent"] == accents_before["companion"] for t in steps)
    record("T_PRIMARY", "the PRIMARY accents never moved while the Secondary did (no unrelated recolour)",
           held, before=accents_before, during={t: steps[t]["_setting"] for t in steps})
    record("T_ONE", "one Secondary: the companions read the colour picked for the Live Terminal",
           a["_setting"]["companion_text"] == a["_setting"]["julius_text"] == colour(COLOUR_A)
           and b["_setting"]["companion_text"] == b["_setting"]["julius_text"] == colour(COLOUR_B),
           green=a["_setting"], blue=b["_setting"])

    # ---- PUT THE FOUNDER'S STATE BACK, colours and flags, exactly.
    L.set_terminal_text_state(j_col, bool(j_on), c_col, bool(c_on))
    yield 2.0
    after = list(L.get_terminal_text_state())
    RESULT["state_after"] = {"julius": colour(after[0]), "julius_chosen": bool(after[1]),
                             "companion": colour(after[2]), "companion_chosen": bool(after[3])}
    shoot("3_restored")
    record("T_RESTORE", "the founder's own Secondary state is back exactly (colours and chosen flags)",
           RESULT["state_after"] == RESULT["state_before"], before=RESULT["state_before"], after=RESULT["state_after"])
    RESULT["status"] = "measured" if all(t["pass"] for t in tests) else "FAIL"
    yield 1.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
