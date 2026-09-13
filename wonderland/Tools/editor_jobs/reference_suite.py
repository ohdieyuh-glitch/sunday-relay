# PIE job: the reference-comparison suite. Every chosen world camera is captured twice from the
# same pose -- the AUTHORED world as a visitor sees it, and the MARBLE reference scaffold alone --
# so the gap between them can be judged image against image instead of from memory.
# Nothing is saved: visibility changes happen in the PIE copy of the world only.
import os

SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "reference")
SUITE = ["HeroCam_V2_MarbleReference", "PlayerCam01", "PathCam02", "ReverseCam03", "GardenLeft04",
         "GardenRight05", "SkylineCam06", "ScaleCam07", "FlankLeftCam08", "FlankRightCam09",
         "ClockQuarterCam13", "MushroomGroveCam14", "TeaTerraceCam16"]
SKY_WORDS = ("cloud", "sky", "balloon", "sun", "atmosphere", "fog")
TAG = globals().get("PASS_TAG", "baseline")


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 4.0
    world = ues.get_game_world()
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    pawn.set_actor_hidden_in_game(True)
    for hud in unreal.ObjectIterator(unreal.WonderlandUsageHudWidget):
        if hud.get_world() == world:
            hud.set_visibility(unreal.SlateVisibility.HIDDEN)

    cams = {a.get_actor_label(): a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.CameraActor)}
    scaffold = next((a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor)
                     if a.get_actor_label() == "V2_MarbleWorld_Scaffold"), None)
    RESULT["missing_cameras"] = [c for c in SUITE if c not in cams]
    RESULT["scaffold_found"] = scaffold is not None
    shots = []
    RESULT["shots"] = shots

    def capture_pass(mode):
        for name in SUITE:
            cam = cams.get(name)
            if cam is None:
                continue
            pc.set_view_target_with_blend(cam, 0.0)
            yield 2.2
            path = os.path.join(SHOTS, "%s__%s__%s.png" % (name, TAG, mode))
            ok = unreal.WonderlandUiTestLibrary.capture_game_viewport(path)
            shots.append({"camera": name, "mode": mode, "path": path, "ok": bool(ok is True or (isinstance(ok, tuple) and ok and ok[0]))})
            emit(name, mode)

    yield from capture_pass("authored")

    if scaffold is not None:
        hidden = []
        for cls in (unreal.StaticMeshActor, unreal.WonderlandInstancedBatch, unreal.WonderlandHoverProp):
            for a in unreal.GameplayStatics.get_all_actors_of_class(world, cls):
                if a == scaffold:
                    continue
                if any(w in a.get_actor_label().lower() for w in SKY_WORDS):
                    continue
                if not a.get_editor_property("hidden"):
                    a.set_actor_hidden_in_game(True)
                    hidden.append(a)
        smc = scaffold.get_component_by_class(unreal.StaticMeshComponent)
        smc.set_visibility(True)
        scaffold.set_actor_hidden_in_game(False)
        RESULT["hidden_for_marble"] = len(hidden)
        yield 3.0
        yield from capture_pass("marble")

    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    RESULT["status"] = "done"
