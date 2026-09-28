# IS THE NAV BAR'S WIRING BROKEN, OR IS IT THE POINTER ROUTE THAT LOSES THE CLICK?
#
# ITEM 7, MEASURED: zzAP1_hud_proof failed H05, H06, H07, H08, H09 and H11 -- six clauses, every one of them
# downstream of a nav tile click that reported clicked=false and clicks=0. On the face of it "the HUD buttons
# do not work", which is a founder-visible defect and worth being exactly right about.
#
# WHAT THE EDITOR LOG ALREADY RULES OUT, and it rules out most of the obvious answers:
#
#     WLUI pointer click on brain at (955, 1034): under the point 1, down 1, up 1
#     tile 1 928.3 1007.3 53.1 53.1 | pointing 1 | app_active 1 | strip_on_screen 1 | capture 0
#     path_len 57 | tile_in_path 1 | tile_in_own_window_path 1
#
# The strip is up, the tile has a real rect, the click lands at that rect's centre, the tile IS in the hit
# test path of its own window, and BOTH the down and the up events came back handled. So this is not the
# editor's window stacking stealing the click (the fault this code was written to survive), not a tile that
# is invisible or covered, and not a HitTestInvisible toggle. The click arrives. The counter does not move.
#
# AND IT IS NOT A GLOBAL "CLICKS DO NOT WORK IN PIE": the wallet chip was clicked through the SAME
# RouteClickToWidget in the same run, three seconds earlier, and W08 passed. Wallet and tiles both count via
# an SButton OnClicked. So something distinguishes these two buttons and the log cannot say what.
#
# THE ONE QUESTION THIS JOB ANSWERS, because it is the fork everything else hangs off:
#
#     SimulateNavTileClick calls the tile button's OWN SimulateClick and never goes near the pointer, the
#     hit test, mouse capture or the viewport. Its own header says so: "Wiring only -- says nothing about
#     whether a pointer can reach the tile."
#
#     IF SIMULATE WORKS AND THE POINTER DOES NOT, the handler, the counter, the index mapping and the
#     navigation are all sound, and the defect is in delivering a pointer click to a tile -- the live
#     suspect being the viewport taking CapturePermanently on mouse-down, which the log shows happening on
#     the same frame as every failed click, so SButton no longer holds capture when the up arrives.
#
#     IF SIMULATE ALSO FAILS, the pointer route is innocent and the fault is in HandleClicked, Clicks[] or
#     the Id-to-index mapping, and no amount of work on mouse capture would have touched it.
#
# Those two want opposite fixes, which is the whole reason to spend a run separating them rather than
# guessing. THE WALLET IS THE POSITIVE CONTROL: it is the one button already known to complete through the
# pointer route, so if it fails here the run is void and the machine, not the nav bar, is what changed.
#
# WHAT THIS DOES NOT CLAIM: whether the panels LOOK right once open is the founder's, and H07 and H09 have
# their own content assertions that will still have to be judged on their own once clicking works.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import re
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "nav_click_cause")

# (id, the subsystem predicate that says this tile's surface came up)
TILES = [
    ("brain", "is_project_brain_open"),
    ("commands", "is_command_station_open"),
    ("agent", "is_live_terminal_open"),
    ("missions", None),
    ("menu", "is_menu_open"),
]


def job():
    os.makedirs(ROOT, exist_ok=True)
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

    def opened(pred):
        if pred is None:
            return None
        try:
            return bool(getattr(ui, pred)())
        except Exception:                                           # noqa: BLE001
            return None

    def settle():
        """Back to a bare HUD: no overlay, strip up."""
        try:
            ui.close_overlay()
        except Exception:                                           # noqa: BLE001
            pass

    def app_state(tile_id="brain"):
        """app_active and pointing, read out of the subsystem's own diagnosis.

        THE PRECONDITION THIS JOB WAS MISSING, and its first run is the evidence. That run reported all five
        tiles failing AND the wallet control failing, which reads as "the pointer route is broken for
        everything" -- but the diagnosis said `app_active 0` and `pointing 0`. The editor did not have OS
        focus, because this session runs shell commands on the same machine between steps and the editor
        goes to the background. Slate will not route a pointer click into an inactive application, so that
        run measured the focus state and not the click path.

        The earlier hud proof had `app_active 1` and `pointing 1`, and THERE the wallet completed while
        every tile failed -- which is the real question and the one a focus-less run cannot answer. So this
        is read before every attempt and the run VOIDS rather than reporting a wall of failures that look
        like a product defect.
        """
        try:
            text = str(ui.diagnose_nav_click(tile_id))
        except Exception:                                           # noqa: BLE001
            return {"app_active": None, "pointing": None}
        out = {}
        for key in ("app_active", "pointing"):
            m = re.search(r"^%s (\d+)$" % key, text, re.M)
            out[key] = int(m.group(1)) if m else None
        return out

    def take_focus():
        """The editor loses focus to every shell command this session runs; take it back before each click."""
        try:
            L.focus_game_viewport()
        except Exception:                                           # noqa: BLE001
            pass

    settle()
    take_focus()
    yield 1.5
    state = app_state()
    RESULT["app_state_at_start"] = state
    record("N00b", "the editor is the active application, so a pointer click can be routed at all",
           state.get("app_active") == 1, **state,
           note="THE PRECONDITION. Slate does not route pointer events into an inactive application, so a "
                "run taken while the editor is in the background measures focus, not the click path. The "
                "first run of this job failed all five tiles AND its own wallet control with app_active 0 "
                "and would have read as a product defect.")
    if state.get("app_active") != 1:
        RESULT["status"] = ("VOID: the editor was not the active application (app_active=%s), so no pointer "
                            "click could be routed and nothing here is about the nav bar"
                            % state.get("app_active"))
        return

    record("N00", "the strip is on screen with nothing open over it",
           bool(ui.is_nav_bar_on_screen()),
           strip_on_screen=bool(ui.is_nav_bar_on_screen()),
           note="every clause below is about a tile on this strip; if it is not up, nothing under it means "
                "anything.")

    # ---- THE POSITIVE CONTROL. The one button already measured to complete through the pointer route.
    wallet_before = None
    try:
        wallet_before = bool(ui.is_wallet_open())
    except Exception:                                               # noqa: BLE001
        pass
    wallet_click = False
    take_focus()
    try:
        wallet_click = bool(ui.click_wallet_chip())
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["wallet"] = str(err)[:140]
    yield 1.0
    RESULT["wallet_control"] = {"was_open": wallet_before, "clicked": wallet_click,
                                "open_after": bool(ui.is_wallet_open())}
    record("N01", "the wallet chip still completes a pointer click",
           wallet_click and bool(ui.is_wallet_open()), **RESULT["wallet_control"],
           note="THE POSITIVE CONTROL, and it is the reason the two routes below can be compared at all. "
                "The wallet counts its clicks through an SButton OnClicked exactly as the tiles do and it "
                "passed in the same run that failed all six tile clauses. If it fails here, the pointer "
                "route is broken for everything and this run says nothing about the nav bar specifically.")
    settle()
    yield 1.2

    rows = {}
    RESULT["by_tile"] = rows
    for tile_id, pred in TILES:
        row = {}
        # ---- ROUTE A: THE POINTER. Hit test, capture, viewport and all.
        take_focus()
        row["app_state"] = app_state(tile_id)
        before = ui.get_nav_click_count(tile_id)
        try:
            ptr = bool(ui.click_nav_button(tile_id))
        except Exception as err:                                    # noqa: BLE001
            ptr = False
            RESULT.setdefault("errors", {})["%s/pointer" % tile_id] = str(err)[:140]
        yield 1.0
        row["pointer"] = {"returned": ptr,
                          "clicks_before": int(before),
                          "clicks_after": int(ui.get_nav_click_count(tile_id)),
                          "surface_open": opened(pred)}
        if not ptr:
            try:
                row["diagnosis"] = str(ui.diagnose_nav_click(tile_id))[:900]
            except Exception:                                       # noqa: BLE001
                pass
        settle()
        yield 1.2

        # ---- ROUTE B: THE BUTTON'S OWN SimulateClick. No pointer, no hit test, no capture.
        before_b = ui.get_nav_click_count(tile_id)
        try:
            sim = bool(ui.simulate_nav_tile_click(tile_id))
        except Exception as err:                                    # noqa: BLE001
            sim = False
            RESULT.setdefault("errors", {})["%s/simulate" % tile_id] = str(err)[:140]
        yield 1.0
        row["simulate"] = {"returned": sim,
                           "clicks_before": int(before_b),
                           "clicks_after": int(ui.get_nav_click_count(tile_id)),
                           "surface_open": opened(pred)}
        settle()
        yield 1.2

        shot = os.path.join(ROOT, "%s.png" % tile_id)
        try:
            L.capture_game_viewport(shot)
        except Exception:                                           # noqa: BLE001
            pass
        row["capture"] = os.path.basename(shot)
        rows[tile_id] = row
        emit("N_%s" % tile_id, "INFO", tile_id,
             {"pointer": row["pointer"], "simulate": row["simulate"]})

    settle()
    yield 1.0

    def counted(route):
        return {t: (rows[t][route]["clicks_after"] > rows[t][route]["clicks_before"]) for t in rows}

    ptr_counted, sim_counted = counted("pointer"), counted("simulate")
    RESULT["counter_moved"] = {"pointer": ptr_counted, "simulate": sim_counted}

    record("N02", "the tile button's own SimulateClick increments the counter for every tile",
           bool(sim_counted) and all(sim_counted.values()), per_tile=sim_counted,
           note="WIRING ONLY. HandleClicked, Clicks[], the Id-to-index mapping and OnNavigate, with the "
                "pointer, the hit test and mouse capture all taken out of the question.")

    record("N03", "a pointer click increments the counter for every tile",
           bool(ptr_counted) and all(ptr_counted.values()), per_tile=ptr_counted,
           note="the founder's actual route. This is the one that failed six clauses.")

    # ---- AND THE FORK, STATED PLAINLY, because either answer is a real answer and they want opposite fixes.
    if sim_counted and all(sim_counted.values()) and not all(ptr_counted.values()):
        RESULT["verdict"] = ("the wiring is sound and the POINTER ROUTE loses the click: HandleClicked, the "
                             "counter and the Id mapping all work when called directly, so the defect is in "
                             "delivering a pointer click to a tile -- mouse capture is the live suspect, the "
                             "viewport takes CapturePermanently on the same frame as every failed click")
    elif sim_counted and not any(sim_counted.values()):
        RESULT["verdict"] = ("the POINTER ROUTE IS INNOCENT: the button's own SimulateClick does not move the "
                             "counter either, so the fault is in HandleClicked, Clicks[] or the Id-to-index "
                             "mapping and no work on mouse capture would have touched it")
    else:
        RESULT["verdict"] = "mixed: see counter_moved, this needs reading before anything is changed"
    emit("N04", "INFO", "which half of the click path is at fault", {"verdict": RESULT["verdict"]})

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
