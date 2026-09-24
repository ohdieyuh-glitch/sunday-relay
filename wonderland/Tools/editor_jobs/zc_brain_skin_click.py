# DOES CLICKING A MASCOT SKIN THROW THE FOUNDER OUT OF PROJECT BRAIN?
#
# FOUNDER: "When I am inside PROJECT BRAIN and try to click/select a mascot skin, it takes me out of Project
# Brain, pushes me back toward the open world, interrupts the interface."
#
# READING THE CODE DID NOT FIND IT. The card's own handler only fires OnChooseSkin, the binding only calls
# EquipSkin, there is no backdrop-dismiss handler in the panel, and the one SetSkinsOpen(false) is Escape. So
# rather than keep guessing at call graphs, this reproduces the founder's exact sequence and records what the UI
# says about itself at every step -- brain open, wardrobe open, and which actor the camera is actually looking
# through, since "pushed back toward the open world" is a VIEW TARGET symptom before it is a widget one.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "brain_skin_click")
SKINS = ["apollo", "arden_infernal", "bee", "celestial_light"]


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".jpg", ".png")):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    steps = []
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 6.0
        world = ues.get_game_world()
        L.focus_game_viewport()
        ui = L.get_ui(world)
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        pc = unreal.GameplayStatics.get_player_controller(world, 0)

        def note(label):
            # WHAT THE VIEW IS LOOKING THROUGH is the tell. If the view target goes back to the pawn, the founder
            # is out in the world again whatever the widgets still claim.
            target = pc.get_view_target() if pc else None
            steps.append({
                "step": label,
                "brain_open": bool(ui.is_project_brain_open()),
                "skins_open": bool(ui.is_brain_skins_open()),
                "view_target": "PAWN(world)" if target == pawn else (target.get_name() if target else "none"),
                "overlays": int(ui.get_overlays_in_viewport()),
            })
            H.capture_viewport_jpeg(os.path.join(ROOT, "%02d_%s.jpg" % (len(steps), label)), 1600, 92)

        note("world_before")
        ui.toggle_project_brain()
        yield 2.0
        note("brain_open")
        ui.set_brain_skins_open(True)
        yield 2.5
        note("wardrobe_open")
        # ---- the founder's actual gesture, several times over, because a bug that fires on the SECOND click is
        # ---- still the bug he reported.
        for skin in SKINS:
            ui.wear_relay_skin(skin)
            yield 2.2
            note("clicked_%s" % skin)
        RESULT["steps"] = steps
        after = [s for s in steps if s["step"].startswith("clicked_")]
        RESULT["brain_stayed_open"] = all(s["brain_open"] for s in after)
        RESULT["wardrobe_stayed_open"] = all(s["skins_open"] for s in after)
        RESULT["never_returned_to_world_camera"] = all(s["view_target"] != "PAWN(world)" for s in after)
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "brain_skin_click.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLBRAIN could not end play: %s" % exc)
