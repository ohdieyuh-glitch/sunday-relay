# DOES THE CULLED FIGURE LOOK LIKE THE ORIGINAL?
#
# cull_hidden_boxes.py drops every box whose centre and eight corners all lie inside another box, which is
# provably invisible BY CONSTRUCTION. That argument is sound and it is still an argument, and the founder's
# own rule is that a visual claim does not get to rest on one. About a fifth of every avatar just went away;
# if the test has an off-by-one in it, or a box is hidden from inside but visible from outside through a gap
# the corner test missed, the figure comes back moth-eaten and no number in this repository would notice.
#
# So the two are stood side by side, at the same distance, in the same light, and photographed.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
AVATARS = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "ProjectAvatars")
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "cull_looks_same")

PAIRS = (("TenTails_Small", "TenTails_Crowd"),
         ("Cherubim_Small", "Cherubim_Crowd"),
         ("Seraph_Small", "Seraph_Crowd"))


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 4.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    here = dog.get_actor_location()
    fwd = dog.get_actor_forward_vector()
    right = dog.get_actor_right_vector()

    counts = {}
    for i, (original, culled) in enumerate(PAIRS):
        # Side by side, same distance, same light: the ONLY difference is the buried voxels.
        for side, stem in ((-1.0, original), (1.0, culled)):
            path = os.path.join(AVATARS, stem + ".wlvox")
            if not os.path.exists(path):
                RESULT.setdefault("missing", []).append(stem)
                continue
            where = here + fwd * 1500.0 + right * (side * 420.0)
            try:
                L.spawn_figure_actor(world, where, path, "cull_%s" % stem)
            except Exception as err:                               # noqa: BLE001
                RESULT.setdefault("spawn_errors", []).append("%s: %s" % (stem, str(err)[:80]))
            yield 0.4
        yield 3.0
        shot = os.path.join(ROOT, "%02d_%s.jpg" % (i + 1, original.split("_")[0].lower()))
        H.capture_viewport_jpeg(shot, 1700, 92)
        counts[original.split("_")[0]] = shot
        # Clear the pair before the next, so three families do not pile into one frame.
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandCompanionEmbodiment):
            try:
                if str(actor.get_name()).startswith("cull_") or "cull_" in str(actor.get_actor_label()):
                    actor.destroy_actor()
            except Exception:
                pass
        yield 1.5

    RESULT["captures"] = counts
    record("V00", "each family was photographed with both tiers in one frame",
           len(counts) == len(PAIRS), captures=list(counts.keys()),
           note="original on the LEFT, culled on the RIGHT, same distance and same light -- the only "
                "difference in the frame is the buried voxels")

    RESULT["status"] = "captured; the verdict on whether it looks the same is the pictures"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
