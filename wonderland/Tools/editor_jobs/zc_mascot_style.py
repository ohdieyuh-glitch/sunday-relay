# DO THE FOUNDER'S OWN COLOURS REACH THE MASCOT, AND DOES THE HUD SAY WHO IS RUNNING?
#
# FOUNDER: "Mascot colors: PRIMARY = main/full mascot colorway. SECONDARY = Relay Dog eyes. Persist/apply to
# world, Wardrobe, missions." And: "COMPOUND AGENT: <user-created name> / SINGLE AGENT: <active coding agent> /
# LLM COMPANION: <active companion>."
#
# The colour is applied where every body is BUILT, so the proof is that a skin re-worn after the colour changes
# comes back in it -- in the world and in the Wardrobe's preview, which are the two places a body is made.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "mascot_style")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    facts = {}
    RESULT["facts"] = facts
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
    ui = L.get_ui(world)
    L.focus_game_viewport()
    yield 0.5

    # ---------------------------------------------------------------- the HUD names who is running
    H.capture_viewport_jpeg(os.path.join(ROOT, "01_hud_names.jpg"), 1900, 94)

    # ---------------------------------------------------------------- before any colour is chosen
    ui.wear_relay_skin("celestial_light")
    yield 2.0
    H.capture_viewport_jpeg(os.path.join(ROOT, "02_designed_colours.jpg"), 1700, 92)

    # ---------------------------------------------------------------- choose, and re-dress
    unreal.SystemLibrary.execute_console_command(world, "wl.Mascot.Primary 0.35,0.62,1.0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Mascot.Secondary 1.0,0.25,0.15")
    yield 1.0
    # Re-worn, because the colour is applied where a body is BUILT.
    ui.wear_relay_skin("relay_og")
    yield 1.8
    ui.wear_relay_skin("celestial_light")
    yield 2.2
    facts["chosen_primary"] = "0.35,0.62,1.0"
    facts["chosen_secondary"] = "1.0,0.25,0.15"
    H.capture_viewport_jpeg(os.path.join(ROOT, "03_chosen_colours.jpg"), 1700, 92)

    # ---------------------------------------------------------------- and in the Wardrobe's preview
    ui.toggle_project_brain()
    yield 2.0
    ui.set_brain_skins_open(True)
    yield 2.5
    ui.wear_relay_skin("apollo")
    yield 2.5
    facts["brain_open"] = bool(ui.is_project_brain_open())
    H.capture_viewport_jpeg(os.path.join(ROOT, "04_wardrobe_chosen.jpg"), 1900, 94)

    # ---------------------------------------------------------------- and Relay OG's own body
    ui.wear_relay_skin("relay_og")
    yield 2.2
    H.capture_viewport_jpeg(os.path.join(ROOT, "05_wardrobe_relay_og.jpg"), 1900, 94)
    L.press_key("Escape", False)
    yield 1.2

    # ---------------------------------------------------------------- put it back as we found it
    unreal.SystemLibrary.execute_console_command(world, "wl.Mascot.Reset")
    yield 0.8
    ui.wear_relay_skin("celestial_light")
    yield 1.8
    ui.wear_relay_skin("relay_og")
    yield 1.8
    H.capture_viewport_jpeg(os.path.join(ROOT, "06_reset.jpg"), 1700, 92)

    RESULT["status"] = "measured; the verdict on the colours is the photographs"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
