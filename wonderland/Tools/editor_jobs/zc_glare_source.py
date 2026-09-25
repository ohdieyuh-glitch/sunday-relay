# WHAT IS THE BIG WHITE BLOB?
#
# FOUNDER: "the lighting is too bright and washed out... the mascot skins are not clearly visible."
#
# Closing the world's exposure and compressing every figure's glow helped and did not finish the job: a
# large, soft, circular white mass still sits in the middle of the player's view, and the companion on the
# right still wears a starburst. Soft and circular means BLOOM, and bloom that big means a source still
# emitting enormously.
#
# GUESSING WHICH OBJECT IT IS WOULD BE THE THIRD GUESS IN A ROW. So this names it two ways at once:
#
#   TURN BLOOM OFF AND LOOK. With r.BloomQuality 0 the halo collapses to whatever is actually emitting, so
#   the source appears as a small bright shape instead of a field of white. If a white disc REMAINS, it is
#   geometry rather than glare, and that is a different fix.
#
#   AND READ THE EMISSIVE COLOURS DIRECTLY. Every glowing thing in this project is a dynamic material
#   instance carrying a "Color" parameter multiplied far above white. Listing them by magnitude, with the
#   actor that owns them and how far they are from the eye, says which ones can possibly be responsible --
#   the compression applied earlier caps figure glow at about 9,100, so anything far above that is on a
#   different code path and was never touched.
CONCURRENT = False

import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "glare_source")


def brightest_emissives(world, eye, limit=16):
    """Every dynamic material whose Color is multiplied above white, loudest first."""
    found = []
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            label = str(actor.get_actor_label())
        except Exception:
            label = str(actor.get_name())
        try:
            where = actor.get_actor_location()
        except Exception:
            continue
        away = float(math.sqrt((where.x - eye.x) ** 2 + (where.y - eye.y) ** 2 + (where.z - eye.z) ** 2))
        for comp in actor.get_components_by_class(unreal.PrimitiveComponent):
            try:
                count = int(comp.get_num_materials())
            except Exception:
                continue
            for slot in range(count):
                mat = comp.get_material(slot)
                if mat is None or not isinstance(mat, unreal.MaterialInstanceDynamic):
                    continue
                try:
                    colour = mat.get_vector_parameter_value("Color")
                except Exception:
                    continue
                peak = max(float(colour.r), float(colour.g), float(colour.b))
                if peak <= 2.0:
                    continue
                found.append({"peak": round(peak, 1), "actor": label[:44],
                              "component": str(comp.get_name())[:36],
                              "material": str(mat.get_name())[:34],
                              "metres_from_eye": round(away / 100.0, 1),
                              "visible": bool(comp.was_recently_rendered(0.5))})
    found.sort(key=lambda r: -r["peak"])
    return found[:limit]


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
    yield 0.5

    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    yield 2.0

    mgr = unreal.GameplayStatics.get_player_camera_manager(world, 0)
    eye = mgr.get_camera_location()

    # ---- AS IT IS
    H.capture_viewport_jpeg(os.path.join(ROOT, "01_as_is.jpg"), 1500, 90)
    yield 0.4

    # ---- WITHOUT THE HALO
    unreal.SystemLibrary.execute_console_command(world, "r.BloomQuality 0")
    for _ in range(12):
        yield 0.1
    H.capture_viewport_jpeg(os.path.join(ROOT, "02_bloom_off.jpg"), 1500, 90)

    # ---- AND WITHOUT THE EYE ADAPTING EITHER, so the raw brightness of the emitters is visible rather than
    # whatever the auto exposure has decided to do about them.
    unreal.SystemLibrary.execute_console_command(world, "r.EyeAdaptationQuality 0")
    for _ in range(12):
        yield 0.1
    H.capture_viewport_jpeg(os.path.join(ROOT, "03_bloom_and_adapt_off.jpg"), 1500, 90)

    unreal.SystemLibrary.execute_console_command(world, "r.BloomQuality 5")
    unreal.SystemLibrary.execute_console_command(world, "r.EyeAdaptationQuality 2")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 24")
    yield 0.6

    RESULT["emitters"] = brightest_emissives(world, eye)
    RESULT["player_eye"] = [round(float(eye.x)), round(float(eye.y)), round(float(eye.z))]
    RESULT["status"] = "probed"
    RESULT["log"] = "; ".join("%s %s x%.0f" % (r["actor"], r["component"], r["peak"])
                              for r in RESULT["emitters"][:6])

    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
