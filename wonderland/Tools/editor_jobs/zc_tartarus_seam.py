# THE TARTARUS BAND SEAM: WHERE DOES THE GROUND STEP, AND BY HOW MUCH?
#
# LEDGER, gate B, recorded 2026-09-23 and never fixed: "TARTARUS elevation mismatch. The Dog walks the
# Tartarus gate area at z=228 while TQ03_Avenue 7.8 m away sits at z=-128 -- a ~3.5 m step. Nothing
# colliding is in any layer spec at the stuck point, so the surface it stands on is generator geometry
# (folder:V2), meaning the Tartarus second band was laid over it."
#
# That is a symptom written down by a walk, not a diagnosis. Two things could produce it and they need
# opposite fixes:
#
#   THE BAND IS AT THE WRONG HEIGHT -- authored at a z that suited the terrain somewhere else, so the whole
#   pass needs lifting or dropping to meet the ground it was laid on.
#
#   THE GROUND ITSELF STEPS -- generator geometry with a real cliff in it, in which case moving the band
#   would only move the problem, and what is needed is a ramp or a different seam line.
#
# So this measures the ground PROFILE along the Tartarus axis before anything is changed. The profile says
# which of the two it is, and a fix chosen before that is a guess.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "tartarus_seam")

#: TARTARUS runs at 330 degrees; the ledger's stuck point (73075, -42191) sits 843 m out along it.
BEARING = math.radians(330.0)
FROM_M, TO_M, STEP_M = 500.0, 1300.0, 10.0

#: Traced from 40 m up, 60 m down -- far enough above any parapet and below any basement floor.
UP_UU, DOWN_UU = 4000.0, 6000.0


def ground_at(world, x, y):
    """The first solid surface under a point, and what owns it."""
    start = unreal.Vector(x, y, UP_UU)
    end = unreal.Vector(x, y, -DOWN_UU)
    hit = unreal.SystemLibrary.line_trace_single(
        world, start, end, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [], unreal.DrawDebugTrace.NONE, True)
    if hit is None:
        return None
    try:
        loc = hit.to_tuple()[4] if hasattr(hit, "to_tuple") else hit.location
    except Exception:
        loc = hit.location
    actor = None
    try:
        actor = hit.get_editor_property("hit_actor")
    except Exception:
        actor = None
    label = ""
    if actor is not None:
        try:
            label = str(actor.get_actor_label())
        except Exception:
            label = str(actor.get_name())
    return {"z": round(float(loc.z), 1), "on": label[:44]}


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
    yield 5.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 0.5

    # ---------------------------------------------------------------- THE PROFILE
    profile = []
    metres = FROM_M
    while metres <= TO_M:
        x = math.cos(BEARING) * metres * 100.0
        y = math.sin(BEARING) * metres * 100.0
        g = ground_at(world, x, y)
        profile.append({"m": round(metres, 1), "x": round(x), "y": round(y),
                        "z": None if g is None else g["z"], "on": "" if g is None else g["on"]})
        metres += STEP_M
        yield 0.02
    RESULT["profile"] = profile

    # ---------------------------------------------------------------- WHERE IT STEPS
    steps = []
    for a, b in zip(profile, profile[1:]):
        if a["z"] is None or b["z"] is None:
            steps.append({"from_m": a["m"], "to_m": b["m"], "drop_uu": None,
                          "note": "no ground under one of these"})
            continue
        drop = b["z"] - a["z"]
        if abs(drop) >= 60.0:                                  # 0.6 m, about a tall kerb
            steps.append({"from_m": a["m"], "to_m": b["m"], "drop_uu": round(drop, 1),
                          "from_z": a["z"], "to_z": b["z"], "from_on": a["on"], "to_on": b["on"]})
    RESULT["steps"] = steps
    RESULT["biggest_step_uu"] = max((abs(s["drop_uu"]) for s in steps if s["drop_uu"] is not None), default=0.0)

    # ---------------------------------------------------------------- WHAT IS AUTHORED THERE
    # The band's own instances, so the authored height can be held against the ground the trace found.
    tq_heights = {}
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        label = ""
        try:
            label = str(actor.get_actor_label())
        except Exception:
            continue
        if "TQ0" not in label:
            continue
        for comp in actor.get_components_by_class(unreal.InstancedStaticMeshComponent):
            n = int(comp.get_instance_count())
            zs = []
            for i in range(0, n, max(1, n // 40)):
                t = comp.get_instance_transform(i, world_space=True)
                loc = t.translation
                r = math.hypot(float(loc.x), float(loc.y)) / 100.0
                if FROM_M <= r <= TO_M:
                    zs.append(round(float(loc.z), 1))
            if zs:
                key = "%s/%s" % (label[:28], str(comp.get_name())[:28])
                tq_heights[key] = {"n": len(zs), "min_z": min(zs), "max_z": max(zs)}
    RESULT["authored_band_heights"] = dict(sorted(tq_heights.items())[:24])

    # ---------------------------------------------------------------- AND A LOOK AT IT
    worst = max(steps, key=lambda s: abs(s["drop_uu"]) if s["drop_uu"] is not None else 0, default=None)
    if worst is not None:
        m = worst["from_m"]
        x = math.cos(BEARING) * m * 100.0
        y = math.sin(BEARING) * m * 100.0
        L.pose_camera(world, unreal.Vector(x - 2200.0, y + 1400.0, (worst.get("from_z") or 0) + 900.0),
                      unreal.Vector(x, y, worst.get("to_z") or 0), 62.0)
        yield 1.2
        H.capture_viewport_jpeg(os.path.join(ROOT, "01_worst_step.jpg"), 1500, 90)
        L.release_camera(world)
        RESULT["worst_step"] = worst

    RESULT["status"] = "probed"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
