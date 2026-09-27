# IS M_WL_Fire BROKEN, OR IS IT THE RIBBONS THAT WEAR IT?
#
# FOUNDER, P0 item 4: believable animated fire on Arden Infernal and Skeleton Flame. The material was built
# for it -- additive, unlit, two-sided, soft across the ribbon, falling off to nothing at the tip, with bands
# of flicker scrolling up it -- and moving the flame ribbons onto it took the flames off the mascots
# ENTIRELY. Cranking wl.Look.FireGain to 30 changed nothing, which rules out "too dim" and leaves "not drawn".
# The legacy path was shipped to get the founder's flames back; this is the open bug behind that.
#
# TWO CANDIDATES AND THEY HAVE OPPOSITE FIXES:
#   the material  -- its shader failed, or its emissive is not really connected, so anything wearing it is
#                    invisible however it is fed
#   the ribbons   -- the mesh, its UVs, or the material assignment onto the section is wrong, and the
#                    material is fine
#
# A SLAB SETTLES IT. An ordinary engine cube, in front of the lens, wearing the same material through the same
# kind of dynamic instance with the same parameter names the embodiment writes. If the slab glows, the
# material works and the fault is in the ribbons. If the slab is invisible, the material never drew anything
# and no amount of work on the ribbons was ever going to show a flame.
#
# The slab is given UVs by the engine's own cube, which is the one thing the ribbons might be missing -- so a
# glowing slab beside an invisible mascot points straight at the ribbon UVs.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "fire_material_probe")
FIRE = "/Game/Wonderland/Materials/M_WL_Fire.M_WL_Fire"
CUBE = "/Engine/BasicShapes/Cube.Cube"


def luma(c):
    return round(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, 4)


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    # ---- WHAT THE ASSET SAYS ABOUT ITSELF, before anything is drawn.
    mat = unreal.EditorAssetLibrary.load_asset(FIRE)
    RESULT["material_loaded"] = mat is not None
    if mat is not None:
        ME = unreal.MaterialEditingLibrary
        try:
            RESULT["vector_parameters"] = [str(n) for n in ME.get_vector_parameter_names(mat)]
            RESULT["scalar_parameters"] = [str(n) for n in ME.get_scalar_parameter_names(mat)]
        except Exception as err:                                   # noqa: BLE001
            RESULT["parameter_error"] = str(err)[:200]
        for prop in ("blend_mode", "shading_model", "two_sided"):
            try:
                RESULT.setdefault("properties", {})[prop] = str(mat.get_editor_property(prop))
            except Exception as err:                               # noqa: BLE001
                RESULT.setdefault("properties", {})[prop] = "?" + str(err)[:60]
    record("M00", "M_WL_Fire loads and declares a Color parameter",
           mat is not None and "Color" in (RESULT.get("vector_parameters") or []),
           loaded=mat is not None, vectors=RESULT.get("vector_parameters"),
           scalars=RESULT.get("scalar_parameters"), properties=RESULT.get("properties"))

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
    yield 6.0

    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 22.0")
    yield 5.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    here = dog.get_actor_location()
    yaw = dog.get_actor_rotation().yaw
    ahead = unreal.Vector(here.x + math.cos(math.radians(yaw)) * 300.0,
                          here.y + math.sin(math.radians(yaw)) * 300.0, here.z + 60.0)

    # ---- THE SLAB, wearing the fire through a dynamic instance exactly as the embodiment makes one.
    slab = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.StaticMeshActor, ahead)
    made = False
    if slab is not None:
        slab.set_actor_label("WL_FireProbeSlab")
        comp = slab.static_mesh_component
        comp.set_mobility(unreal.ComponentMobility.MOVABLE)
        comp.set_static_mesh(unreal.EditorAssetLibrary.load_asset(CUBE))
        slab.set_actor_scale3d(unreal.Vector(0.08, 1.6, 1.6))
        if mat is not None:
            mid = comp.create_dynamic_material_instance(0, mat)
            if mid is not None:
                mid.set_vector_parameter_value("Color", unreal.LinearColor(1.0, 0.45, 0.12, 1.0))
                mid.set_vector_parameter_value("EmissiveColor", unreal.LinearColor(1.0, 0.45, 0.12, 1.0))
                mid.set_scalar_parameter_value("EmissiveStrength", 4.0)
                made = True
    RESULT["slab_spawned"] = slab is not None
    RESULT["slab_dressed"] = made

    eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * 700.0,
                        here.y + math.sin(math.radians(yaw)) * 700.0, here.z + 70.0)
    L.pose_camera(world, eye, unreal.Vector(ahead.x, ahead.y, ahead.z), 45.0)
    yield 3.0

    slab_read = L.read_screen_rect(0.40, 0.32, 0.60, 0.68)
    RESULT["slab_luma"] = None if slab_read is None else luma(slab_read[0])
    RESULT["slab_bright_fraction"] = None if slab_read is None else round(float(slab_read[2]), 4)
    try:
        L.capture_game_viewport(os.path.join(ROOT, "slab.png"))
    except Exception:
        pass

    # ---- AND THE SAME PATCH WITH THE SLAB HIDDEN, so "the material draws" is a difference and not a guess.
    if slab is not None:
        slab.set_actor_hidden_in_game(True)
    yield 2.0
    bare = L.read_screen_rect(0.40, 0.32, 0.60, 0.68)
    RESULT["without_slab_luma"] = None if bare is None else luma(bare[0])
    try:
        L.capture_game_viewport(os.path.join(ROOT, "slab_hidden.png"))
    except Exception:
        pass
    if slab is not None:
        slab.set_actor_hidden_in_game(False)
    yield 1.5

    lit = (RESULT["slab_luma"] is not None and RESULT["without_slab_luma"] is not None
           and RESULT["slab_luma"] - RESULT["without_slab_luma"] > 0.02)
    record("M01", "a plain slab wearing M_WL_Fire actually draws", lit,
           with_slab=RESULT["slab_luma"], without_slab=RESULT["without_slab_luma"],
           bright_fraction=RESULT["slab_bright_fraction"], floor=0.02,
           note="the engine cube brings its own UVs. If this draws and the mascot does not, the material is "
                "sound and the fault is in the ribbons -- their UVs, or the material assigned to the section.")

    if slab is not None:
        try:
            slab.destroy_actor()
        except Exception:
            pass
    L.release_camera(world)

    # ---- NOW THE MASCOT, on the same material, at the same hour.
    ui = L.get_ui(world)
    shots = {}
    RESULT["mascot"] = shots
    for material_on in (0, 1):
        unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireMaterial %d" % material_on)
        ui.wear_relay_skin("arden_infernal")
        yield 6.0
        unreal.SystemLibrary.execute_console_command(world, "wl.Look.Reglow")
        yield 3.0
        at = dog.get_actor_location()
        face = unreal.Vector(at.x + math.cos(math.radians(yaw)) * 430.0,
                             at.y + math.sin(math.radians(yaw)) * 430.0, at.z + 70.0)
        L.pose_camera(world, face, unreal.Vector(at.x, at.y, at.z + 50.0), 42.0)
        yield 2.5
        got = L.read_screen_rect(0.40, 0.25, 0.60, 0.75)
        shots["FireMaterial %d" % material_on] = {
            "luma": None if got is None else luma(got[0]),
            "bright": None if got is None else round(float(got[2]), 4)}
        try:
            L.capture_game_viewport(os.path.join(ROOT, "arden_material_%d.png" % material_on))
        except Exception:
            pass
        L.release_camera(world)
        emit("M_%d" % material_on, "INFO", "arden on FireMaterial %d" % material_on,
             shots["FireMaterial %d" % material_on])

    unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireMaterial 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.Reglow")

    off = shots.get("FireMaterial 0", {}).get("luma")
    on = shots.get("FireMaterial 1", {}).get("luma")
    record("M02", "the mascot's flames survive being moved onto M_WL_Fire",
           off is not None and on is not None and on > off - 0.03,
           legacy_path=off, fire_material=on, tolerance=0.03,
           note="the founder's regression, stated as a measurement. A large drop means the ribbons go dark "
                "on the material even when a slab wearing it does not.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
