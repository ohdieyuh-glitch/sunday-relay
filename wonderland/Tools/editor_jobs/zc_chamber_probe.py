# WHY DOES THE CHAMBER GO BLACK ON M_WL_VoxelGlow?
#
# The material is confirmed UNLIT with a working Color parameter -- it is the same one every figure's glow
# uses. Yet painting the five chamber panels through it produced a BLACK room, twice. Guessing a third time
# would be the third guess; this tries it live instead, where a wrong answer costs seconds rather than a
# build.
#
# Each panel is set to a DIFFERENT, unmistakable value, so the capture says which parameter carries.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "chamber_probe")

GLOW = "/Game/Wonderland/Materials/M_WL_VoxelGlow.M_WL_VoxelGlow"


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
    yield 6.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    ui = L.get_ui(world)
    yield 0.5

    ui.toggle_project_brain()
    yield 2.5
    RESULT["brain_open"] = bool(ui.is_project_brain_open())

    sculpts = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandBrainSculpture)
    RESULT["sculptures"] = len(sculpts)
    if not sculpts:
        RESULT["status"] = "FAIL: no sculpture"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    sculpt = sculpts[0]

    parent = unreal.EditorAssetLibrary.load_asset(GLOW)
    RESULT["glow_loaded"] = parent is not None

    # Every StaticMeshComponent on the sculpture is a chamber panel.
    panels = [c for c in sculpt.get_components_by_class(unreal.StaticMeshComponent)]
    RESULT["panels"] = [str(c.get_name()) for c in panels]

    # FOUR DIFFERENT WAYS OF SAYING "RED", one per panel, so the picture names the one that works.
    recipes = [
        ("Color_only", lambda m: m.set_vector_parameter_value("Color", unreal.LinearColor(60.0, 0.0, 0.0, 1.0))),
        ("EmissiveColor_only", lambda m: m.set_vector_parameter_value("EmissiveColor", unreal.LinearColor(60.0, 0.0, 0.0, 1.0))),
        ("BaseColor_only", lambda m: m.set_vector_parameter_value("BaseColor", unreal.LinearColor(60.0, 0.0, 0.0, 1.0))),
        ("EmissiveColor_plus_strength", lambda m: (
            m.set_vector_parameter_value("EmissiveColor", unreal.LinearColor(1.0, 0.0, 0.0, 1.0)),
            m.set_scalar_parameter_value("EmissiveStrength", 60.0))),
    ]
    applied = {}
    for index, comp in enumerate(panels[:len(recipes)]):
        name, recipe = recipes[index]
        try:
            mid = unreal.MaterialInstanceDynamic.create(parent, sculpt) if parent is not None else None
            if mid is None:
                applied[str(comp.get_name())] = "no MID"
                continue
            recipe(mid)
            comp.set_material(0, mid)
            applied[str(comp.get_name())] = name
        except Exception as err:                               # noqa: BLE001
            applied[str(comp.get_name())] = "ERR %s" % str(err)[:70]
    RESULT["applied"] = applied
    yield 2.0
    H.capture_viewport_jpeg(os.path.join(ROOT, "01_recipes.jpg"), 1600, 92)

    RESULT["status"] = "probed"
    RESULT["log"] = "; ".join("%s=%s" % (k, v) for k, v in applied.items())
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
