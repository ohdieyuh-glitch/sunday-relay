# WHAT DOES A PROJECT AVATAR ACTUALLY COST?
#
# FOUNDER: "When Project Avatars spawn, Wonderland currently lags extremely badly... a private Server Avatar may
# eventually contain MANY Project Avatars... DO NOT solve this by simply reducing the number of Project Avatars.
# The system itself must become cheaper."
#
# So this measures, at 0 / 1 / 5 / 10 avatars:
#
#   SPAWN COST   wall-clock seconds for the spawn call itself -- the hitch the founder sees
#   STEADY COST  mean and worst frame delta over the seconds AFTER the spawn settles
#
# It spawns real Project Avatar figures through the same path /pa uses, so the numbers are the real ones and
# not a synthetic stand-in. Every avatar is destroyed again at the end.
import os
import time

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "avatar_perf")
# Cheapest stage first so a bad result does not lock the editor up: Small, then the Large the founder sees.
FAMILIES = ["Cherubim", "Seraph", "TenTails"]


def job():
    os.makedirs(ROOT, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    rows = []
    RESULT["measurements"] = rows

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 6.0
    world = ues.get_game_world()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    L.focus_game_viewport()
    avatars_dir = unreal.Paths.project_dir() + "ProjectAvatars"
    RESULT["avatars_dir"] = avatars_dir

    def frame_stats(seconds):
        """Mean and worst world delta across a window. The worst is what a hitch actually feels like."""
        samples = []
        deadline = time.perf_counter() + seconds
        while time.perf_counter() < deadline:
            samples.append(float(unreal.GameplayStatics.get_world_delta_seconds(world)))
            yield 0.05
        if not samples:
            samples = [0.0]
        RESULT["_last"] = {"mean_ms": round(sum(samples) / len(samples) * 1000.0, 2),
                           "worst_ms": round(max(samples) * 1000.0, 2),
                           "samples": len(samples)}

    spawned = []

    def spawn(n, stage):
        """Spawn n avatars, returning the wall-clock seconds the spawning itself took."""
        at = pawn.get_actor_location()
        fwd = pawn.get_actor_forward_vector()
        right = pawn.get_actor_right_vector()
        began = time.perf_counter()
        for i in range(n):
            fam = FAMILIES[i % len(FAMILIES)]
            path = "%s/%s_%s.wlvox" % (avatars_dir, fam, stage)
            where = unreal.Vector(at.x + fwd.x * 1100.0 + right.x * ((i - n * 0.5) * 420.0),
                                  at.y + fwd.y * 1100.0 + right.y * ((i - n * 0.5) * 420.0),
                                  at.z - 88.0)
            body = L.spawn_figure_actor(world, where, path, "%s_%s_%d" % (fam, stage, i))
            if body is not None:
                spawned.append(body)
        return time.perf_counter() - began

    # ---------------------------------------------------------------- 0 avatars: the baseline
    for step in frame_stats(3.0):
        yield step
    base = RESULT.pop("_last")
    rows.append({"avatars": 0, "stage": "-", "spawn_seconds": 0.0, **base})
    H.capture_viewport_jpeg(os.path.join(ROOT, "00_baseline.jpg"), 1600, 88)

    # ---------------------------------------------------------------- 1, 5, 10 at the stage the founder sees
    for count, stage in ((1, "Large"), (4, "Large"), (5, "Large")):
        took = spawn(count, stage)
        yield 2.5
        for step in frame_stats(3.0):
            yield step
        stats = RESULT.pop("_last")
        total = len(spawned)
        rows.append({"avatars": total, "stage": stage, "added": count,
                     "spawn_seconds": round(took, 3),
                     "spawn_ms_each": round(took / max(count, 1) * 1000.0, 1), **stats})
        H.capture_viewport_jpeg(os.path.join(ROOT, "%02d_avatars.jpg" % total), 1600, 88)

    RESULT["total_spawned"] = len(spawned)
    for a in spawned:
        if a is not None:
            a.destroy_actor()
    yield 1.0
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
