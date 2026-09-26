# THE MENU'S COLOUR CUSTOMISATION, ON SCREEN RATHER THAN IN A SETTING.
#
# FOUNDER, 2026-09-25, three separate requests:
#
#   "MENU -- TERMINAL COLOR CUSTOMIZATION. Provide real color customization in the MENU tab for (A) Julius Live
#   Terminal, (B) AI Companion terminals ... not only through the console. It should update live and persist
#   ... Preserve readability/contrast."
#
#   "MENU COLOR/THEME CUSTOMIZATION. Allow the player to select a Menu theme. Update the intentional accent
#   surfaces WITHOUT making text unreadable. Do not indiscriminately tint every element."
#
#   "MENU -- MASCOT COLOR CUSTOMIZATION ... user-facing, not console-only."
#
# WHAT IS ASSERTED AND WHY IT IS ASSERTED THAT WAY. "Not console-only" is a claim about a TAB existing and
# working, so the tab is opened and pressed. "Live" is a claim about PIXELS, so the terminal is photographed
# before and after. "Do not indiscriminately tint every element" is a claim about what did NOT change, so the
# body text of the Menu is measured too and required to stay where it was.
CONCURRENT = True

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "menu_colours")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
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

    def patch(cx, cy, hw, hh):
        got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
        if got is None:
            return None
        m = got[0]
        # THE DISCRIMINATORS ARE CHANNEL DIFFERENCES, chosen against the actual pair being told apart.
        #
        # The first run used green-minus-the-average, which cannot tell Wonderland's GOLD from the green it was
        # changed to: gold is (0.85, 0.70, 0.25) and scores +0.15 on that measure, so a correct change read as
        # +0.0007 and the clause failed while the photograph plainly showed green. g-r separates them -- gold
        # -0.15, green +0.74 -- and b-r separates gold from the blue the Menu theme is set to.
        return {"rgb": [round(m.r, 4), round(m.g, 4), round(m.b, 4)],
                "warm": round(m.r - m.b, 4),
                "gr": round(m.g - m.r, 4), "br": round(m.b - m.r, 4)}

    def extremes(x0, y0, x1, y1):
        """The most strongly tinted PIXEL in a rectangle, per channel pair, from one screenshot.

        THE GRID OF MEANS COULD NOT SEE THIS and two runs proved it: an accent here is a hairline border and a
        few words of small text, so averaged over any patch worth sampling it is a percent of the dark plate
        behind it. Changing the Julius terminal from gold to a green the photograph shows unmistakably moved a
        96-cell grid of means by 0.008. One screenshot and every pixel of the rectangle moves it by a third.
        """
        got = L.read_screen_extremes(x0, y0, x1, y1)
        if got is None:
            return None
        gr, br, rb, mean, n = got
        return {"most_green_over_red": round(gr, 4), "most_blue_over_red": round(br, 4),
                "most_red_over_blue": round(rb, 4),
                "mean": [round(mean.r, 4), round(mean.g, 4), round(mean.b, 4)],
                "mean_warm": round(mean.r - mean.b, 4), "pixels": int(n)}

    # ---- THE TAB EXISTS AND OPENS. "Not console-only" begins here.
    ui.toggle_menu()
    yield 3.0
    record("M00", 'the Menu has a tab called "Colors"',
           "COLORS" in str(ui.get_menu_tabs()).upper(), tabs=ui.get_menu_tabs())
    ui.show_menu_tab("COLORS")
    yield 2.0
    record("M01", "the Colors tab opens from the Menu",
           str(ui.get_open_menu_tab()).upper() == "COLORS", open_tab=ui.get_open_menu_tab())
    try:
        L.capture_game_viewport(os.path.join(ROOT, "menu_colors_tab.png"))
    except Exception:
        pass
    ui.toggle_menu()
    yield 2.0

    # ---- THE JULIUS TERMINAL, PHOTOGRAPHED BEFORE AND AFTER.
    L.pick_terminal_accent(True, unreal.LinearColor(0.85, 0.70, 0.25, 1.0))
    L.pick_terminal_accent(False, unreal.LinearColor(0.85, 0.70, 0.25, 1.0))
    yield 2.0
    ui.toggle_live_terminal() if hasattr(ui, "toggle_live_terminal") else L.press_key("T", True)
    yield 4.0
    RESULT["terminal_open"] = bool(ui.is_live_terminal_open())
    record("M10", "the Julius Live Terminal is on screen", ui.is_live_terminal_open())
    # The terminal's chrome sits along the bottom band; its accent is the loudest colour in it.
    before = extremes(0.31, 0.69, 0.70, 0.95)
    try:
        L.capture_game_viewport(os.path.join(ROOT, "terminal_gold.png"))
    except Exception:
        pass

    # A green nobody could mistake for Wonderland's gold.
    L.pick_terminal_accent(True, unreal.LinearColor(0.16, 0.90, 0.45, 1.0))
    yield 4.0
    after = extremes(0.31, 0.69, 0.70, 0.95)
    try:
        L.capture_game_viewport(os.path.join(ROOT, "terminal_green.png"))
    except Exception:
        pass
    RESULT["julius_terminal"] = {"gold": before, "green": after}
    record("M11", "choosing a Julius Terminal accent changes what is on the screen",
           before is not None and after is not None and (after["most_green_over_red"] - before["most_green_over_red"]) >= 0.10,
           gold=before, green=after,
           rise_in_green_over_red=round(after["most_green_over_red"] - before["most_green_over_red"], 4) if (before and after) else None, floor=0.10,
           note="green minus red, over the Julius terminal's own rectangle. Wonderland's gold scores "
                "-0.15 on this and the green it was set to scores +0.74, so brightness cannot fake it.")

    # ---- AND THE TWO TERMINALS ARE SEPARATE, which is the half the founder had to ask for twice.
    RESULT["accents"] = {"julius": [round(L.get_terminal_accent(True).r, 3), round(L.get_terminal_accent(True).g, 3),
                                    round(L.get_terminal_accent(True).b, 3)],
                         "companion": [round(L.get_terminal_accent(False).r, 3), round(L.get_terminal_accent(False).g, 3),
                                       round(L.get_terminal_accent(False).b, 3)]}
    record("M12", "the Julius terminal and the AI Companion terminals hold separate accents",
           abs(L.get_terminal_accent(True).g - L.get_terminal_accent(False).g) > 0.1,
           **RESULT["accents"])

    ui.toggle_live_terminal() if hasattr(ui, "toggle_live_terminal") else L.press_key("T", True)
    yield 2.0

    # ---- THE MENU THEME MOVES ACCENTS AND LEAVES THE WORDS ALONE.
    L.pick_menu_accent(unreal.LinearColor(0.85, 0.70, 0.25, 1.0))
    ui.toggle_menu()
    yield 3.0
    # The heading band -- accent -- and the row text below it -- not accent.
    head_gold = extremes(0.30, 0.16, 0.72, 0.40)
    body_gold = extremes(0.32, 0.44, 0.58, 0.72)
    try:
        L.capture_game_viewport(os.path.join(ROOT, "menu_gold.png"))
    except Exception:
        pass
    ui.toggle_menu()
    yield 1.0
    L.pick_menu_accent(unreal.LinearColor(0.35, 0.55, 1.00, 1.0))
    ui.toggle_menu()
    yield 3.0
    head_blue = extremes(0.30, 0.16, 0.72, 0.40)
    body_blue = extremes(0.32, 0.44, 0.58, 0.72)
    try:
        L.capture_game_viewport(os.path.join(ROOT, "menu_blue.png"))
    except Exception:
        pass
    RESULT["menu"] = {"heading": {"gold": head_gold, "blue": head_blue},
                      "body": {"gold": body_gold, "blue": body_blue}}
    ok_head = (head_gold is not None and head_blue is not None
               and (head_blue["most_blue_over_red"] - head_gold["most_blue_over_red"]) >= 0.10)
    record("M20", "a Menu theme moves the Menu's accent surfaces",
           ok_head, heading_gold=head_gold, heading_blue=head_blue,
           rise_in_blue_over_red=round(head_blue["most_blue_over_red"] - head_gold["most_blue_over_red"], 4) if (head_gold and head_blue) else None,
           floor=0.10)

    # THE WHOLE REGION'S MEAN, not its hottest cell: a theme is allowed to move the accents inside this area
    # and is not allowed to move the area.
    ok_body = (body_gold is not None and body_blue is not None
               and abs(body_gold["mean_warm"] - body_blue["mean_warm"]) <= 0.012)
    record("M21", "and leaves the body text where it was -- it does not tint every element",
           ok_body, body_gold=body_gold, body_blue=body_blue,
           drift=round(abs(body_gold["mean_warm"] - body_blue["mean_warm"]), 4) if (body_gold and body_blue) else None,
           note="the founder: 'Update the intentional accent surfaces WITHOUT making text unreadable. Do not "
                "indiscriminately tint every element.' This is the clause a blanket tint fails.")

    ui.toggle_menu()
    yield 1.0
    # Put everything back, so the next proof measures the shipped colours.
    L.reset_all_colours()
    unreal.SystemLibrary.execute_console_command(world, "wl.Theme.Reset")
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 1.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
