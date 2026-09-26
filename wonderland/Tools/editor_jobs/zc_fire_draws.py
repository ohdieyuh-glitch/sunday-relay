# DOES M_WL_Fire DRAW ON ANYTHING AT ALL?
#
# The question left open by zc_fire_material_probe, whose slab never existed: EditorLevelLibrary spawns into
# the EDITOR world, so in PIE it returned None and the "slab" reading was a photograph of empty air. The
# material's emissive connection cannot be read from Python in 5.8 either -- both property names are rejected
# -- so neither of the two cheap answers is available and this has to be settled by drawing something.
#
# SO AN OBJECT THAT IS ALREADY IN THE WORLD WEARS IT. The territory checkpoints stand in the level with the
# nearest one nine metres from the spawn point, and their parts are instanced engine cubes, which carry
# proper UVs -- the one thing a flame ribbon might be missing. Their material is swapped to M_WL_Fire,
# photographed, and swapped back.
#
# WHAT EACH OUTCOME MEANS:
#   the pylon lights up  -- the material works, and the flames vanishing is about the ribbons: their UVs,
#                           their winding, or the material assigned to the section
#   the pylon disappears -- the material draws nothing on anything, and no work on the ribbons could ever
#                           have shown a flame
CONCURRENT = True

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "fire_draws")
FIRE = "/Game/Wonderland/Materials/M_WL_Fire.M_WL_Fire"


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

    mat = unreal.EditorAssetLibrary.load_asset(FIRE)
    if mat is None:
        record("D00", "M_WL_Fire loads", False)
        RESULT["status"] = "FAIL"
        return

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
    yield 7.0

    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 22.0")
    yield 5.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    here = dog.get_actor_location()

    posts = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandTerritoryCheckpoint)
    if not posts:
        record("D00", "there is a territory checkpoint in the world to dress", False)
        RESULT["status"] = "FAIL: no checkpoint"
        return
    posts = sorted(posts, key=lambda p: (p.get_actor_location() - here).length())
    post = posts[0]
    at = post.get_actor_location()
    RESULT["dressed"] = str(post.get_actor_label())
    RESULT["metres_away"] = round((at - here).length() / 100.0, 1)
    record("D00", "there is a territory checkpoint in the world to dress", True,
           label=RESULT["dressed"], metres=RESULT["metres_away"])

    # ---- LOOK AT THE PYLON, from far enough back to hold the whole 600 uu of it.
    bearing = math.atan2(at.y - here.y, at.x - here.x)
    eye = unreal.Vector(at.x - math.cos(bearing) * 720.0, at.y - math.sin(bearing) * 720.0, at.z + 330.0)
    L.pose_camera(world, eye, unreal.Vector(at.x, at.y, at.z + 260.0), 50.0)
    yield 3.0

    BOX = (0.36, 0.18, 0.64, 0.86)

    def read(tag):
        yield 2.5
        got = L.read_screen_rect(*BOX)
        globals()["_R"] = None if got is None else {"luma": luma(got[0]), "bright": round(float(got[2]), 4)}
        try:
            L.capture_game_viewport(os.path.join(ROOT, "%s.png" % tag))
        except Exception:
            pass

    meshes = []
    for comp in post.get_components_by_class(unreal.InstancedStaticMeshComponent):
        meshes.append(comp)
    RESULT["components"] = [str(c.get_name()) for c in meshes]

    yield from read("00_before")
    before = globals().get("_R")

    # ---- EVERY PART OF THE POST ONTO THE FIRE, so there is no doubt which surface is being judged.
    mids = []
    for comp in meshes:
        try:
            mid = comp.create_dynamic_material_instance(0, mat)
            if mid is not None:
                mid.set_vector_parameter_value("Color", unreal.LinearColor(1.0, 0.45, 0.12, 1.0))
                mids.append(mid)
        except Exception as err:                                   # noqa: BLE001
            RESULT.setdefault("dress_errors", []).append(str(err)[:120])
    RESULT["instances_made"] = len(mids)
    yield from read("01_wearing_the_fire")
    wearing = globals().get("_R")

    RESULT["before"] = before
    RESULT["wearing_the_fire"] = wearing
    emit("D_READ", "INFO", "the pylon before and while wearing M_WL_Fire",
         {"before": before, "wearing": wearing})

    record("D01", "the readings came back", before is not None and wearing is not None,
           before=before, wearing=wearing)
    if before is None or wearing is None:
        RESULT["status"] = "FAIL: nothing was read"
        L.release_camera(world)
        return

    record("D02", "M_WL_Fire draws something on a mesh with ordinary UVs",
           wearing["luma"] > 0.02 and wearing["bright"] > 0.0005,
           wearing=wearing, before=before, instances=len(mids),
           note="additive and unlit: this material can only ever show its emissive. If an engine cube wearing "
                "it is black, the emissive is not connected and the ribbons were never the problem.")

    L.release_camera(world)
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
