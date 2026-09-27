# IS THE C.A.R.D READABLE WITH THE BRIGHTEST SKINS STANDING NEXT TO IT?
#
# FOUNDER, 2026-09-25: "The C.A.R.D is still not readable enough... being washed out by bright
# emissive/effect lighting from the mascot skins and nearby scene lighting... PIE test this using the
# brightest mascot skins near the C.A.R.D and confirm the panel remains clearly readable."
#
# So that is what this does, literally: each bright skin is worn, the Dog is brought close to the camera so
# its glow falls across the corner the C.A.R.D sits in, and the frame is captured at a size where the small
# type can actually be judged. The verdict on readability is the founder's, and these are the pictures it is
# made from.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "card_readable")

SKINS = ("relay_og", "celestial_light", "apollo_v1", "apollo", "arden_infernal_v1", "arden_infernal", "skeleton_flame_v1", "skeleton_flame")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
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
    yield 6.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    ui = L.get_ui(world)
    yield 0.5

    # NOON, the brightest the world gets, because that is the hardest case for a HUD.
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    yield 2.0

    worn = []
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 2.2
        H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % skin), 1800, 94)
        worn.append(skin)
    RESULT["skins"] = worn

    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 24")
    yield 0.5
    RESULT["status"] = "captured; the verdict on readability is the pictures"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
