# THE EIGHT-HOUR DEMONSTRATION, IN THE REAL ENGINE.
#
# FOUNDER: "I need to personally test the last eight hours of work... Do not show me offline approximations."
#
# So this opens each surface in PIE and photographs it, and records what the runtime says about itself beside
# every frame. Nothing here passes because an actor spawned or a registry updated: each step names the thing
# the founder can look at and see for himself.
#
# It reports FAILURES LOUDLY. A surface that does not open, a control that is not there, a brain that does not
# spawn -- each is recorded as a fact in the result, not skipped, because the point of this run is to find out
# what is really in the engine rather than to produce a clean sheet.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "eight_hour_demo")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".jpg", ".png")):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    shots, facts = [], {}
    RESULT["shots"] = shots
    RESULT["facts"] = facts
    RESULT["status"] = "running"

    def shot(name, note):
        path = os.path.join(ROOT, "%02d_%s.jpg" % (len(shots) + 1, name))
        H.capture_viewport_jpeg(path, 1900, 92)
        shots.append({"n": len(shots) + 1, "name": name, "note": note, "file": os.path.basename(path)})

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    ui = L.get_ui(world)
    tasks = L.get_mission_tasks(world)
    L.focus_game_viewport()
    yield 0.5
    shot("world", "PIE running, the world as it opens")

    # ---------------------------------------------------------------- JULIUS LIVE TERMINAL + THE + BUTTON
    L.press_key("T", True)
    yield 1.6
    facts["live_terminal_open"] = bool(ui.is_live_terminal_open())
    facts["terminal_rows"] = int(ui.get_terminal_row_count())
    shot("julius_terminal", "Ctrl+T -- the Julius Live Terminal. The + and NEW TASK TERMINAL sit across the top.")

    # THE + IS PRESSED THROUGH THE SAME PATH THE BUTTON USES, and the contract underneath must not move.
    tasks.clear_all_tasks_for_development()
    yield 0.4
    tasks.submit_draft(tasks.add_draft(), "Survey the arrival plaza")
    yield 1.2
    facts["contracts_before_plus"] = len(tasks.get_task_list())
    shot("contract_working", "one committed Mission Contract, working")

    ui.press_add_task()
    yield 1.2
    rows = tasks.get_task_list()
    facts["tabs_after_plus"] = len(rows)
    facts["draft_states"] = [str(r.state) for r in rows]
    shot("pending_tab", "after + -- a PENDING GRAY tab above the working contract, which has not moved")

    # ---------------------------------------------------------------- ENTER IS THE COMMIT BOUNDARY
    draft = next((r.local_id for r in rows if "Draft" in str(r.state)), None)
    facts["found_draft"] = draft is not None
    if draft is not None:
        tasks.submit_draft(draft, "Inspect the garden arches")
        yield 1.4
        facts["contracts_after_enter"] = sum(1 for r in tasks.get_task_list() if "Draft" not in str(r.state))
        shot("committed", "after Enter -- the pending tab became a second active Mission Contract")

    # ---------------------------------------------------------------- GRAY ORBS
    orbs = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandMissionOrb)
    facts["orbs_in_world"] = len(orbs)
    shot("orbs", "mission orbs in the world: one per ACTIVE contract, none for a draft")

    # ---------------------------------------------------------------- AI COMPANION TERMINALS
    L.press_key("Escape", False)
    yield 0.8
    facts["companion_terminals"] = int(ui.get_companion_terminal_count()) if hasattr(ui, "get_companion_terminal_count") else -1
    L.press_key("T", True)
    yield 1.4
    shot("companions", "the AI Companion terminals -- i.Wonder logo in its own row, above the input box")
    L.press_key("Escape", False)
    yield 0.8

    # ---------------------------------------------------------------- PROJECT BRAIN + LIVING BRAIN + SNAKE
    L.press_key("B", False)
    yield 2.2
    facts["brain_open"] = bool(ui.is_project_brain_open())
    sculpt = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandBrainSculpture)
    facts["brain_sculptures"] = len(sculpt)
    if sculpt:
        art = sculpt[0]
        facts["snake_head_radius_uu"] = round(float(art.get_head_radius_uu()), 1)
        facts["closest_segment_uu"] = round(float(art.get_closest_segment_radius_uu()), 1)
        facts["body_length_uu"] = round(float(art.get_body_length_uu()), 1)
    shot("project_brain", "B -- Project Brain, with the living brain and its python framed in the brain window")
    yield 2.0
    if sculpt:
        art = sculpt[0]
        facts["snake_moved_uu"] = round(abs(float(art.get_head_radius_uu()) - facts["snake_head_radius_uu"]), 2)
        facts["bearing_spread_deg"] = round(float(art.get_bearing_rate_spread_deg()), 2)
    shot("project_brain_later", "the same brain two seconds later -- the python has moved along its own route")

    # ---------------------------------------------------------------- WARDROBE + BLACK PREVIEW + SKINS
    facts["wardrobe_opened"] = bool(ui.set_brain_skins_open(True))
    yield 2.2
    facts["brain_still_open_after_wardrobe"] = bool(ui.is_project_brain_open())
    shot("wardrobe", "the Wardrobe open inside Project Brain -- the preview window and the skin cards")

    for skin in ("celestial_light", "apollo", "bee", "skeleton_flame", "hagoromo", "arden_infernal"):
        worn = bool(ui.wear_relay_skin(skin))
        yield 1.6
        still = bool(ui.is_project_brain_open())
        facts["wear_%s" % skin] = {"worn": worn, "brain_still_open": still}
        shot("wardrobe_%s" % skin, "%s selected -- Project Brain must still be open (%s)" % (skin, still))

    facts["brain_open_after_all_skins"] = bool(ui.is_project_brain_open())
    L.press_key("Escape", False)
    yield 1.0
    facts["brain_closed_by_escape"] = not bool(ui.is_project_brain_open())
    shot("after_escape", "Escape -- and only Escape -- leaves Project Brain")

    RESULT["status"] = "done; the verdict on how it LOOKS is the photographs"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
