# THE ONE SEAM THAT DID NOT WALK.
#
# WORLD_BETA_LEDGER row B: "Band seams walked: ICARUS clean (gate -> seam -> band), NOCTIS clean, TARTARUS
# stuck at (73075, -42191)." And its cause: "The Dog walks the Tartarus gate area at z=228 while TQ03_Avenue
# 7.8 m away sits at z=-128 -- a ~3.5 m step... the Tartarus second band was laid over ground at a different
# height than it assumes."
#
# That point is 844 m from the origin, which is INSIDE the 800-900 m ring SF03 just floored -- so the seam fill
# may have closed it by laying a continuous surface across exactly that join. May have. This finds out.
#
# AND IT READS BACK WHERE THE PAWN ACTUALLY IS. The previous walk reported nine points that all "landed" and
# gave identical z at equal radii, which is far more likely a pawn that never moved than three seams built to
# the same height. Every step here records the position it asked for AND the position it got.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "tartarus_walk")
STUCK = (73075.0, -42191.0)


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
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    L.focus_game_viewport()
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 11.0")
    yield 1.5

    RESULT["stuck_point_radius_m"] = round(math.hypot(*STUCK) / 100.0, 1)

    # Walk the Tartarus axis THROUGH the stuck point: before it, on it, past it.
    bearing = math.degrees(math.atan2(STUCK[1], STUCK[0]))
    RESULT["bearing_deg"] = round(bearing, 1)
    rad = math.radians(bearing)
    steps = []
    RESULT["steps"] = steps
    for r in (76000.0, 80000.0, 84376.0, 88000.0, 92000.0):
        want = (math.cos(rad) * r, math.sin(rad) * r)
        pawn.set_actor_location(unreal.Vector(want[0], want[1], 2000.0), False, True)
        yield 2.5
        got = pawn.get_actor_location()
        moved = math.hypot(got.x - want[0], got.y - want[1])
        steps.append({
            "radius_m": round(r / 100.0),
            "asked_xy": [round(want[0]), round(want[1])],
            "got_xy": [round(float(got.x)), round(float(got.y))],
            "off_by_uu": round(moved, 1),
            "arrived": bool(moved < 600.0),
            "landed_z": round(float(got.z), 1),
            "fell": bool(got.z < -4000.0),
        })
        H.capture_viewport_jpeg(os.path.join(ROOT, "r%04d.jpg" % int(r / 100.0)), 1500, 90)

    RESULT["arrived_count"] = sum(1 for s in steps if s["arrived"])
    RESULT["fell_count"] = sum(1 for s in steps if s["fell"])
    zs = [s["landed_z"] for s in steps if s["arrived"]]
    RESULT["z_spread_uu"] = round(max(zs) - min(zs), 1) if len(zs) > 1 else None
    RESULT["status"] = "walked"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
