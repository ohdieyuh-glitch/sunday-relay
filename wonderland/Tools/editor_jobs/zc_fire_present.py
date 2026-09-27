# ARE THE FLAME RIBBONS DRAWING AT ALL?
#
# FOUNDER, 2026-09-26: "bring the flames back to the mascot skins."
#
# Looking again at the sweep photographs, the bright shapes I read as flame licks on Arden's ring are its RUBY
# SETTINGS -- four jewels at the cardinal points, which is geometry, not fire. That leaves an open question the
# brightness sweep cannot answer: whether the ribbons are faint, or whether they are not being drawn.
#
# So this asks it directly. The flame surface is found on the Dog's costume and its sections and triangle
# counts are read off the component itself, and the fire is then cranked far past any sane value and
# photographed. Geometry with no triangles is a different bug from geometry that is too dim, and they need
# opposite fixes.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "fire_present")
SKINS = ("arden_infernal", "skeleton_flame")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if ues.get_game_world() is None:
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 300)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
        yield 6.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    ui = L.get_ui(world)
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 19.0")

    found = {}
    RESULT["flame_surface"] = found
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 6.0
        # The costume is the Dog's own worn body: the only embodiment attached to the pawn.
        costume = None
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandCompanionEmbodiment):
            try:
                if str(actor.get_actor_label()) == "WL_RelayDog_Costume":
                    costume = actor
                    break
            except Exception:
                pass
        row = {"costume": costume is not None}
        if costume is not None:
            for comp in costume.get_components_by_class(unreal.ProceduralMeshComponent):
                try:
                    sections = int(comp.get_num_sections())
                except Exception:
                    sections = -1
                verts = []
                for i in range(max(sections, 0)):
                    try:
                        verts.append(len(comp.get_section(i).procVertexBuffer))
                    except Exception:
                        pass
                row.setdefault("procedural", []).append(
                    {"name": str(comp.get_name()), "sections": sections, "verts": verts,
                     "visible": bool(comp.is_visible()),
                     "bounds_z": None})
        found[skin] = row
        emit("P_%s" % skin, "INFO", skin, row)

    # ---- AND NOW CRANKED, so "too dim" and "not there" cannot be confused.
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireGain 30.0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireTongues 12")
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.Reglow")
    yield 4.0
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 5.0
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * 480.0,
                            here.y + math.sin(math.radians(yaw)) * 480.0, here.z + 100.0)
        L.pose_camera(world, eye, unreal.Vector(here.x, here.y, here.z + 60.0), 40.0)
        yield 2.0
        try:
            L.capture_game_viewport(os.path.join(ROOT, "%s_cranked.png" % skin))
        except Exception:
            pass
    L.release_camera(world)

    unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireGain 2.3")
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireTongues 8")
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.Reglow")
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 1.0
