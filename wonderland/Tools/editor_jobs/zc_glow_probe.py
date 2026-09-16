# PIE job: how bright must a companion's unlit glow be to read in Wonderland's daylight?
#
# The first proof run drew every glow part black: the world is exposed for a physically based sun, and an unlit
# strength of 2 is far below it. This job loads the same figures regenerated at several glow scales
# (wonderland/Tools/companion_figures.py --glow-scale N), swaps between them live with wl.Companion.FigureDir and
# wl.Companion.Reload, and captures one close front portrait per scale. It also reads which candidate engine
# materials are flagged for instanced static meshes, since a material without that flag is replaced by the
# default material on a companion's instanced boxes. No saves, no map edits; it ends the PIE it starts.
import os

SCRATCH = "C:/Users/Kaisi/AppData/Local/Temp/claude/C--Users-Kaisi/92e62278-8c7b-402e-8938-bd7e61b380ed/scratchpad"
SCALES = [1, 30, 300, 3000]
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc")
L = unreal.WonderlandUiTestLibrary
CANDIDATES = [
    "/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial",
    "/Engine/EngineDebugMaterials/LevelColorationUnlitMaterial.LevelColorationUnlitMaterial",
    "/Engine/EngineMaterials/EmissiveMeshMaterial.EmissiveMeshMaterial",
    "/Engine/EngineDebugMaterials/M_SimpleUnlitTranslucent.M_SimpleUnlitTranslucent",
    "/Engine/EngineDebugMaterials/M_SimpleTranslucent.M_SimpleTranslucent",
    "/Engine/EngineDebugMaterials/DebugMeshMaterial.DebugMeshMaterial",
    "/Engine/ArtTools/RenderToTexture/Materials/Debug/M_Emissive_Color.M_Emissive_Color",
    "/Game/Wonderland/Materials/M_WLMaster.M_WLMaster",
    "/Game/Wonderland/Materials/M_WLRunes.M_WLRunes",
]


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["materials"] = {}
    for path in CANDIDATES:
        entry = {}
        try:
            material = unreal.load_object(None, path)
            if material is None:
                entry["missing"] = True
            else:
                base = material.get_base_material()
                for prop in ("used_with_instanced_static_meshes", "blend_mode", "shading_model", "two_sided"):
                    try:
                        entry[prop] = str(base.get_editor_property(prop))
                    except Exception as error:
                        entry[prop] = "?" + str(error)[:60]
                try:
                    entry["vector_params"] = [str(n) for n in unreal.MaterialEditingLibrary.get_vector_parameter_names(material)]
                    entry["scalar_params"] = [str(n) for n in unreal.MaterialEditingLibrary.get_scalar_parameter_names(material)]
                except Exception as error:
                    entry["params_error"] = str(error)[:120]
        except Exception as error:
            entry["error"] = str(error)[:160]
        RESULT["materials"][path] = entry
        emit(path, entry)

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    unreal.SystemLibrary.execute_console_command(None, "wl.Companion.FigureDir %s/glow_x%d" % (SCRATCH, SCALES[0]))
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    controller = unreal.GameplayStatics.get_player_controller(world, 0)
    controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-6.0, yaw=pawn.get_actor_rotation().yaw + 180.0))
    try:
        boom = pawn.get_editor_property("camera_boom")
        boom.set_editor_property("target_arm_length", 260.0, unreal.PropertyAccessChangeNotifyMode.NEVER)
    except Exception as error:
        emit("boom unchanged:", error)
    yield 2.5
    RESULT["captures"] = []
    for scale in SCALES:
        unreal.SystemLibrary.execute_console_command(world, "wl.Companion.FigureDir %s/glow_x%d" % (SCRATCH, scale))
        unreal.SystemLibrary.execute_console_command(world, "wl.Companion.Reload")
        yield 3.0
        path = os.path.join(SHOTS, "zc_glow_x%d.png" % scale)
        ok = L.capture_game_viewport(path)
        RESULT["captures"].append(path if (ok is True or (isinstance(ok, tuple) and ok and ok[0])) else None)
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    L.set_background_throttle_suspended(False)
    RESULT["status"] = "done"
