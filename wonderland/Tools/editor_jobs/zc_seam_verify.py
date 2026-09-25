# DID THE SEAM FILL CLOSE THE TROUGH, AND CAN THE DOG WALK IT?
#
# WORLD_BETA_LEDGER row L: "the 800-900 m ring is a density trough in all three nations at once -- ICARUS 852,
# NOCTIS 715, TARTARUS 1,060, against 1,300-2,600 in the rings either side." And blocker 5 calls that ring
# "both the likeliest traversal break and the likeliest visual break", so both halves are measured here.
#
# Density is counted from the INSTANCES IN THE LEVEL, by radius, exactly as the ledger counted it. Traversal is
# the Dog standing on the seam and not falling.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "seam")
AXES = [("ICARUS", 90.0), ("NOCTIS", 210.0), ("TARTARUS", 330.0)]


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

    # ---------------------------------------------------------------- density by ring and sector
    rings = {}
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        for comp in a.get_components_by_class(unreal.InstancedStaticMeshComponent):
            n = int(comp.get_instance_count())
            if n <= 0:
                continue
            loc = comp.get_world_location()
            r = math.hypot(loc.x, loc.y)
            if r < 60000.0 or r > 130000.0:
                continue
            bearing = math.degrees(math.atan2(loc.y, loc.x)) % 360.0
            if 30.0 <= bearing < 150.0:
                nation = "ICARUS"
            elif 150.0 <= bearing < 270.0:
                nation = "NOCTIS"
            else:
                nation = "TARTARUS"
            band = int(r // 10000.0) * 100
            rings.setdefault(nation, {}).setdefault(band, 0)
            rings[nation][band] += n
    RESULT["instances_by_ring_metres"] = {k: dict(sorted(v.items())) for k, v in sorted(rings.items())}
    RESULT["seam_ring_800_900"] = {k: v.get(800, 0) for k, v in sorted(rings.items())}

    # ---------------------------------------------------------------- and can it be walked
    walks = []
    RESULT["walks"] = walks
    for name, bearing in AXES:
        rad = math.radians(bearing)
        for r in (78000.0, 85000.0, 92000.0):
            x, y = math.cos(rad) * r, math.sin(rad) * r
            pawn.set_actor_location(unreal.Vector(x, y, 1200.0), False, False)
            yield 2.2
            at = pawn.get_actor_location()
            walks.append({"nation": name, "radius_m": round(r / 100.0),
                          "landed_z": round(float(at.z), 1),
                          "fell": bool(at.z < -5000.0)})
        H.capture_viewport_jpeg(os.path.join(ROOT, "%s_seam.jpg" % name.lower()), 1600, 90)
    RESULT["walks_that_fell"] = sum(1 for w in walks if w["fell"])
    RESULT["status"] = "verified"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
