# LOOK AT THE EYES. Close-ups of every skin's face in the gameplay camera, day and night, and the eye path itself.
#
# FOUNDER, 2026-09-27, P0: "THE MASCOT EYES ARE STILL NOT GLOWING ... Do not respond with another parameter
# change, test rewrite, emissive number, knee sweep, or PASS artifact unless the actual rendered eyes visibly
# glow ... Pick ONE skin first. Relay OG is acceptable. Render it. Look at it."
#
# So this produces the pictures the founder asked for -- each skin's face, front, close, in the real world
# lighting at noon and at night -- and, for the default Dog, the thing no gate has ever written down: WHICH
# component draws the eyes, in WHICH material, with WHICH parameters. Relay OG is not a figure file at runtime;
# it is the Blueprint's own meshes, and the eye-level drive the day cycle applies to companion figures has
# never reached them. The dump below is the evidence for that, read off the live actor rather than assumed.
#
# Nothing here passes or fails. The captures are looked at.
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "eyes_look")
SKINS = ("relay_og", "celestial_light", "apollo", "arden_infernal", "skeleton_flame")
HOURS = (("day", 12.0), ("night", 22.5))
TAG = JOB_ARG if "JOB_ARG" in globals() else "look"


def job():
    os.makedirs(ROOT, exist_ok=True)
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

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
    yield 8.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    if dog is None or ui is None:
        RESULT["status"] = "FAIL: no Dog"
        return

    # ---- THE EYE PATH ON THE DEFAULT DOG, read off the live actor.
    path = []
    RESULT["relay_og_eye_path"] = path
    try:
        for comp in dog.get_components_by_class(unreal.StaticMeshComponent):
            name = comp.get_name()
            if "eye" not in name.lower() and "visor" not in name.lower():
                continue
            row = {"component": name, "visible": bool(comp.is_visible()), "materials": []}
            try:
                mesh = comp.static_mesh
                row["mesh"] = mesh.get_name() if mesh else None
                b = comp.get_local_bounds()
                row["local_bounds"] = [str(b[0]), str(b[1])] if b else None
            except Exception:                                      # noqa: BLE001
                pass
            for slot in range(comp.get_num_materials()):
                mat = comp.get_material(slot)
                entry = {"slot": slot, "material": mat.get_name() if mat else None,
                         "class": mat.get_class().get_name() if mat else None}
                try:
                    parent = mat.get_editor_property("parent") if mat else None
                    entry["parent"] = parent.get_name() if parent else None
                except Exception:                                  # noqa: BLE001
                    pass
                for pname in ("Color", "EmissiveColor", "BaseColor", "RimColor"):
                    try:
                        entry[pname] = str(mat.get_vector_parameter_value(pname))
                    except Exception:                              # noqa: BLE001
                        pass
                for pname in ("EmissiveStrength", "Emissive", "Glow"):
                    try:
                        entry[pname] = float(mat.get_scalar_parameter_value(pname))
                    except Exception:                              # noqa: BLE001
                        pass
                row["materials"].append(entry)
            path.append(row)
    except Exception as err:                                       # noqa: BLE001
        RESULT["relay_og_eye_path_error"] = str(err)[:200]
    emit("E_PATH", "INFO", "what draws the default Dog's eyes", path)

    # ---- THE WORLD'S POST PROCESS, because a halo is bloom and bloom has a threshold.
    pp = []
    RESULT["post_process"] = pp
    try:
        for vol in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.PostProcessVolume):
            s = vol.settings
            pp.append({"volume": vol.get_actor_label(),
                       "bloom_method": str(s.get_editor_property("bloom_method")),
                       "bloom_intensity": float(s.get_editor_property("bloom_intensity")),
                       "bloom_threshold": float(s.get_editor_property("bloom_threshold")),
                       "override_intensity": bool(s.get_editor_property("override_bloom_intensity")),
                       "override_threshold": bool(s.get_editor_property("override_bloom_threshold")),
                       "exposure_method": str(s.get_editor_property("auto_exposure_method")),
                       "exposure_min": float(s.get_editor_property("auto_exposure_min_brightness")),
                       "exposure_max": float(s.get_editor_property("auto_exposure_max_brightness")),
                       "exposure_bias": float(s.get_editor_property("auto_exposure_bias"))})
    except Exception as err:                                       # noqa: BLE001
        RESULT["post_process_error"] = str(err)[:200]
    emit("E_PP", "INFO", "post process", pp)

    def face_close(distance=300.0, fov=30.0):
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * distance,
                            here.y + math.sin(math.radians(yaw)) * distance, here.z + 66.0)
        L.pose_camera(world, eye, unreal.Vector(here.x, here.y, here.z + 62.0), fov)

    shots = []
    RESULT["captures"] = shots
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 6.0
        for hour_label, hour in HOURS:
            unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
            yield 4.0
            face_close()
            yield 1.5
            name = "%s_%s_%s.png" % (TAG, skin, hour_label)
            try:
                L.capture_game_viewport(os.path.join(ROOT, name))
                shots.append(name)
            except Exception as err:                               # noqa: BLE001
                RESULT.setdefault("errors", {})[name] = str(err)[:100]
            L.release_camera(world)
            yield 0.3
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.00")
    ui.wear_relay_skin("relay_og")

    tests.append({"id": "L00", "name": "a close-up of every skin's face exists at day and at night",
                  "pass": len(shots) == len(SKINS) * len(HOURS),
                  "detail": {"taken": len(shots), "where": ROOT, "tag": TAG,
                             "note": "the verdict is the pictures, looked at, not this clause."}})
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "captured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
