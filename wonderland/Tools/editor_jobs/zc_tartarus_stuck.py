# WHAT IS THE DOG STANDING ON AT THE TARTARUS SEAM?
#
# THE LEDGER'S SYMPTOM: "The Dog walks the Tartarus gate area at z=228 while TQ03_Avenue 7.8 m away sits at
# z=-128 -- a ~3.5 m step. Nothing colliding is in any layer spec at the stuck point, so the surface it
# stands on is generator geometry (folder:V2)."
#
# WHAT THE PROFILE ALREADY RULED OUT. zc_tartarus_seam traced the whole axis from 500 m to 1,300 m and found
# the walkable ground essentially flat -- z = 12 out to 800 m and z = -14 past 850 m, a quarter of a metre
# apart. The two twenty-metre "steps" it found at 620-650 m and 800-850 m are ROOFS: the trace starts 40 m
# up and hits building tops. So there is no terrain cliff along the axis, and a fix that lifted or dropped
# the whole band would have been aimed at a defect that is not there.
#
# WHICH LEAVES THE ACTUAL QUESTION: what is under the Dog at z=228, when the ground either side is near
# zero? A 2.3 m surface in a place the specs say has nothing colliding is either a plinth, a kerb, a step
# the band authored, or generator geometry nobody meant to walk on -- and those want different fixes.
#
# So this stops guessing at heights and asks the surface what it is, by name, over a grid around the exact
# point the walk got stuck at.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "tartarus_stuck")

#: The ledger's own stuck point, 843 m out along the Tartarus axis.
STUCK = (73075.0, -42191.0)
HALF_UU, STEP_UU = 8000.0, 1000.0          # a 160 m box at 10 m spacing


#: HitResult's field order, established by zc_hit_shape rather than guessed. THIS ENGINE'S PYTHON GIVES THE
#: STRUCT NO NAMED ATTRIBUTES AT ALL -- `hit.location`, `hit.blocking_hit`, `hit.component` and
#: `get_editor_property` for each of them all raise. to_tuple() is the only way in, and it has 18 entries.
#: Two probes read zero surfaces out of a world the Dog was standing in before this was checked.
HIT_BLOCKING, HIT_DISTANCE, HIT_LOCATION, HIT_ACTOR, HIT_COMPONENT = 0, 3, 4, 9, 10


def trace_down(world, x, y, top):
    """The first blocking surface under a point, with the actor and component that own it, by name."""
    start = unreal.Vector(x, y, top)
    end = unreal.Vector(x, y, -6000.0)
    hit = unreal.SystemLibrary.line_trace_single(
        world, start, end, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [],
        unreal.DrawDebugTrace.NONE, True)
    if hit is None:
        return None
    try:
        t = hit.to_tuple()
    except Exception:
        return None
    if not bool(t[HIT_BLOCKING]):
        return None
    location = t[HIT_LOCATION]
    actor = t[HIT_ACTOR]
    component = t[HIT_COMPONENT]
    name, folder = "", ""
    if actor is not None:
        try:
            name = str(actor.get_actor_label())
        except Exception:
            name = str(actor.get_name())
        try:
            folder = str(actor.get_folder_path())
        except Exception:
            folder = ""
    return {"z": round(float(location.z), 1), "actor": name[:46], "folder": folder[:34],
            "component": (str(component.get_name())[:34] if component is not None else "")}


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

    # ---------------------------------------------------------------- THE SURFACE, NAMED
    # Traced from 2,500 uu rather than 4,000: high enough to clear a plinth or a parapet, low enough that a
    # twenty-metre roof is above the start and cannot be mistaken for ground.
    grid, owners, heights = [], {}, []
    y = -HALF_UU
    while y <= HALF_UU:
        x = -HALF_UU
        while x <= HALF_UU:
            g = trace_down(world, STUCK[0] + x, STUCK[1] + y, 2500.0)
            if g is not None:
                grid.append({"dx_m": round(x / 100.0), "dy_m": round(y / 100.0), **g})
                heights.append(g["z"])
                key = "%s | %s" % (g["actor"] or "(unnamed)", g["folder"] or "(no folder)")
                owners[key] = owners.get(key, 0) + 1
            x += STEP_UU
            yield 0.01
        y += STEP_UU
    RESULT["samples"] = len(grid)
    RESULT["surface_owners"] = dict(sorted(owners.items(), key=lambda kv: -kv[1])[:12])
    if heights:
        heights.sort()
        RESULT["ground_z"] = {"min": heights[0], "max": heights[-1],
                              "median": heights[len(heights) // 2],
                              "spread_uu": round(heights[-1] - heights[0], 1)}
    RESULT["grid"] = grid[:400]

    # ---------------------------------------------------------------- AND WHAT THE DOG DOES THERE
    dogs = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RelayDogCharacter)
    if dogs:
        dog = dogs[0]
        # DROPPED ONTO THE GROUND THE TRACE FOUND, not from a fixed 16 m. The first run dropped it from
        # 1600 uu and it rested at 1447 -- on a roof, because the stuck point has a building on it. The drop
        # height was choosing which surface the answer came from.
        floor = trace_down(world, STUCK[0], STUCK[1], 2500.0)
        RESULT["floor_under_stuck_point"] = floor
        drop_to = (floor["z"] if floor else 0.0) + 250.0
        dog.set_actor_location(unreal.Vector(STUCK[0], STUCK[1], drop_to), False, False)
        for _ in range(16):
            yield 0.25
        rest = dog.get_actor_location()
        under = trace_down(world, float(rest.x), float(rest.y), float(rest.z) + 400.0)
        RESULT["dog"] = {"rested_z": round(float(rest.z), 1), "standing_on": under}
        L.pose_camera(world,
                      unreal.Vector(STUCK[0] - 2600.0, STUCK[1] + 1800.0, float(rest.z) + 1100.0),
                      unreal.Vector(STUCK[0], STUCK[1], float(rest.z)), 62.0)
        yield 1.2
        H.capture_viewport_jpeg(os.path.join(ROOT, "01_stuck_point.jpg"), 1500, 90)
        L.release_camera(world)

    RESULT["status"] = "probed"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
