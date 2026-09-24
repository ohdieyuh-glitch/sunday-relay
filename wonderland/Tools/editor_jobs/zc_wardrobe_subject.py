# WHAT IS ACTUALLY IN THE WARDROBE WINDOW?
#
# The preview square shows a figure on garden decking instead of black, and widening the chamber and
# re-framing on the staged figure both changed almost nothing. That pattern says the thing being photographed
# is NOT the thing being framed -- most likely the player's own Dog, seen through the hole, while the stage's
# mannequin is somewhere else entirely or was never staged at all.
#
# So this asks where everything IS: the stage, its body, the player's Dog, the black chamber, and the camera.
# Whichever of them sits at the distance the framing solved for is the one in the window.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wardrobe_subject")


def job():
    os.makedirs(ROOT, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    ui = L.get_ui(world)
    L.focus_game_viewport()

    ui.toggle_project_brain()
    yield 2.0
    ui.set_brain_skins_open(True)
    yield 2.5
    ui.wear_relay_skin("apollo")
    yield 2.5

    cam = pc.player_camera_manager
    eye = cam.get_camera_location()

    def where(actor, label):
        if actor is None:
            return {"what": label, "exists": False}
        loc = actor.get_actor_location()
        d = ((loc.x - eye.x) ** 2 + (loc.y - eye.y) ** 2 + (loc.z - eye.z) ** 2) ** 0.5
        row = {"what": label, "exists": True, "name": actor.get_name(),
               "at": [round(loc.x, 1), round(loc.y, 1), round(loc.z, 1)],
               "distance_from_camera_uu": round(d, 1),
               "hidden_in_game": bool(actor.is_hidden_ed()) if hasattr(actor, "is_hidden_ed") else None}
        return row

    seen = []
    RESULT["actors"] = seen
    RESULT["camera_at"] = [round(eye.x, 1), round(eye.y, 1), round(eye.z, 1)]

    stages = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSkinStage)
    RESULT["skin_stages"] = len(stages)
    for st in stages:
        seen.append(where(st, "SkinStage"))
        body = st.get_body()
        seen.append(where(body, "SkinStage.Body"))
        if body is not None:
            seen[-1]["figure_height_uu"] = round(float(body.get_figure_height_uu()), 1)
            seen[-1]["boxes"] = int(body.get_box_count())

    seen.append(where(unreal.GameplayStatics.get_player_pawn(world, 0), "PlayerDog"))

    # Every companion body in the world, so a mannequin hiding under another name still shows up.
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandCompanionEmbodiment):
        seen.append(where(a, "Embodiment:" + str(a.get_editor_property("class_label"))))

    H.capture_viewport_jpeg(os.path.join(ROOT, "wardrobe_apollo.jpg"), 1700, 92)
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
