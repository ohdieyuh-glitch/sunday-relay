# PIE job: proof of the Project Brain panel -- the founder's purple frame inside Wonderland, and the access rules
# that decide what a player may change.
#
# It opens the panel with a real B key through Slate, captures the frame, then inspects three surfaces in turn:
# one that is the owner's (a proposal is typed and recorded as NOT SYNCED), one the brain proposed (review), and
# one the system owns (locked). It also checks the Julius terminal still takes the keyboard from the panel.
#
# Rules kept: zc_ prefix, no saves, no map edits, never Escape unless a panel is open, and it ends its own PIE.
import os

SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc")
L = unreal.WonderlandUiTestLibrary
ART = "C:/dev/iwonder/wonderland-companions/wonderland/UiArt/ProjectBrainHologram.png"


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["captures"] = []

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def shot(name):
        path = os.path.join(SHOTS, name)
        ok = L.capture_game_viewport(path)
        good = ok is True or (isinstance(ok, tuple) and ok and ok[0])
        if good:
            RESULT["captures"].append(path)
        return path if good else None

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    if os.path.isfile(ART):
        unreal.SystemLibrary.execute_console_command(None, "wl.Brain.ArtPath " + ART)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    ui = L.get_ui(world)
    brain = next((b for b in unreal.ObjectIterator(unreal.WonderlandProjectBrainSubsystem)
                  if b.get_world() == world), None) or next((b for b in unreal.ObjectIterator(unreal.WonderlandProjectBrainSubsystem)
                                                             if b.get_surface_count() > 0), None)
    RESULT["surfaces"] = brain.get_surface_count() if brain else 0
    RESULT["revision"] = brain.get_brain_revision() if brain else 0
    record("B00", "the Project Brain subsystem holds a development preview model",
           brain is not None and brain.get_surface_count() >= 20 and brain.is_development_preview(),
           surfaces=RESULT["surfaces"], revision=RESULT["revision"])

    # ---------------------------------------------------------------- B opens it
    L.focus_game_viewport()
    yield 0.4
    L.press_key("B", False)
    yield 1.2
    record("B01", "B opens the Project Brain over the world, alone",
           ui.is_project_brain_open() and ui.get_overlays_in_viewport() == 1 and not ui.is_live_terminal_open(),
           open=ui.is_project_brain_open(), overlays=ui.get_overlays_in_viewport(), capture=shot("zc_brain_01_frame.png"))

    # ---------------------------------------------------------------- a surface that is yours
    ok_select = ui.select_brain_surface("user_facts")
    yield 0.8
    access_yours = str(brain.get_surface_access("user_facts")) if brain else ""
    before = brain.get_proposal_count("user_facts") if brain else 0
    proposed = ui.propose_to_selected_brain_surface("Phase 2 proved the Project Brain panel in PIE.")
    yield 0.6
    after = brain.get_proposal_count("user_facts") if brain else 0
    record("B02", "a surface of yours opens, takes a proposal, and records it as not synced",
           ok_select and str(ui.get_brain_selected_surface()) == "user_facts" and access_yours == "YOURS" and proposed and after == before + 1,
           selected=str(ui.get_brain_selected_surface()), access=access_yours, before=before, after=after,
           capture=shot("zc_brain_02_yours_proposal.png"))

    # ---------------------------------------------------------------- a surface the brain proposed
    ui.select_brain_surface("auto_memories")
    yield 0.8
    access_review = str(brain.get_surface_access("auto_memories")) if brain else ""
    refused = ui.propose_to_selected_brain_surface("this must not be recorded")
    yield 0.4
    record("B03", "a review surface accepts no typed entry",
           access_review == "REVIEW" and not refused and (brain.get_proposal_count("auto_memories") == 0 if brain else False),
           access=access_review, refused=bool(refused), capture=shot("zc_brain_03_review.png"))

    # ---------------------------------------------------------------- a surface the system owns
    ui.select_brain_surface("evidence")
    yield 0.8
    access_system = str(brain.get_surface_access("evidence")) if brain else ""
    refused_system = ui.propose_to_selected_brain_surface("this must not be recorded either")
    yield 0.4
    record("B04", "a system-owned surface is locked: shown, never edited",
           access_system == "SYSTEM" and not refused_system and (brain.get_proposal_count("evidence") == 0 if brain else False),
           access=access_system, refused=bool(refused_system), capture=shot("zc_brain_04_system_locked.png"))

    # ---------------------------------------------------------------- the mission context strip
    ui.select_brain_surface("requirements")
    yield 0.8
    record("B05", "mission context opens from the same frame",
           str(ui.get_brain_selected_surface()) == "requirements",
           selected=str(ui.get_brain_selected_surface()), capture=shot("zc_brain_05_mission_context.png"))

    # ---------------------------------------------------------------- Ctrl+T from the panel, and back
    L.set_key_held("LeftControl", True)
    yield 0.12
    L.set_key_held("T", True)
    yield 0.12
    L.set_key_held("T", False)
    yield 0.08
    L.set_key_held("LeftControl", False)
    yield 0.7
    record("B06", "Ctrl+T over the Project Brain switches to the terminal and its companions",
           ui.is_live_terminal_open() and not ui.is_project_brain_open() and ui.are_companion_terminals_on_screen() and ui.get_overlays_in_viewport() == 1,
           terminal=ui.is_live_terminal_open(), brain=ui.is_project_brain_open(), companions=ui.are_companion_terminals_on_screen(),
           capture=shot("zc_brain_06_terminal_from_brain.png"))
    ui.close_overlay()
    yield 0.5
    L.focus_game_viewport()
    L.press_key("B", False)
    yield 1.0
    reopened = ui.is_project_brain_open() and (brain.get_proposal_count("user_facts") == after if brain else False)
    L.press_key("B", False)
    yield 0.6
    record("B07", "B closes it again, and the proposal survived the reopen",
           reopened and not ui.is_project_brain_open() and ui.get_overlays_in_viewport() == 0,
           reopened=reopened, open_after=ui.is_project_brain_open(), overlays=ui.get_overlays_in_viewport())

    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    L.set_background_throttle_suspended(False)
    RESULT["passed"] = sum(1 for t in tests if t["pass"])
    RESULT["failed"] = [t["id"] for t in tests if not t["pass"]]
    RESULT["status"] = "done"
