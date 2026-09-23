# TURNAROUNDS FOR THE FOUNDER'S SIDE-BY-SIDES: every skin, front / three-quarter / side / rear, on open paving.
#
# WHY NOT THE PREVIEW SPOT. The /skin preview stands the Dog where the player is looking, which at the arrival
# spawn is a planter bed with two companions three metres off; every close camera there photographed tulips or a
# Jhinn. The reference plates are 360-degree studies on a clear floor, so the comparison figure is spawned the way
# the emissive sweep was -- on the open paving the orb survey found clear at bearing 315 -- and photographed from
# the four bearings the plates use. Same lighting as the world; nothing hidden; the figure is destroyed after.
#
# THE STAGED FIGURE IS THE SAME .wlvox THE PREVIEW DOG WEARS. This is a photograph of the asset, not a substitute
# for the preview path, which stays the founder's way of switching skins in the world.
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_turnaround")
SKINS_DIR = "C:/dev/iwonder/wonderland-proof/wonderland/RelaySkins"
SKINS = [("apollo", "Apollo"), ("arden_infernal", "ArdenInfernal"), ("skeleton_flame", "SkeletonFlame"),
         ("hagoromo", "Hagoromo"), ("celestial_light", "CelestialLight"), ("bee", "Bee"), ("relay_og", "RelayOg")]
# OFF THE PLAZA ENTIRELY, ONTO OPEN LAWN, because the plaza cannot hold a turnaround. (-170, -346) photographed
# Apollo and Arden through the gold gate's posts; (-330, -420) fixed the front view but its SIDE camera still
# stood in a flower bed and shot Hagoromo through tulips, which is what made these skins look simpler than they
# are. A clearance probe grounded 184 candidates and traced all five bearings at the distance this turnaround
# needs: the whole plaza neighbourhood scores 0.543 of the room required, and nothing on the paving reaches 1.0.
# This spot does, and the figure stands on clean grass with its full height and its shadow visible.
STAGE_AT = (-2600.0, -600.0)
FACING = 40.0
# bearing relative to the figure's facing, distance in figure heights, look height, fov, eye height
# THE VIEWPORT IS TWICE AS WIDE AS IT IS TALL, AND UNREAL'S FOV IS THE HORIZONTAL ONE. So the vertical field is
# roughly half what the number suggests, and 2.3x height -- which frames comfortably side to side -- cut the top
# off Apollo's halo and Arden's flaming ring every time. The turnaround views stand further back; the crowns are
# the point of these plates and a crown running off the top of the frame is not a turnaround.
VIEWS = [("front", 0.0, 3.2, 0.46, 40.0, 0.60), ("three_quarter", 40.0, 3.2, 0.46, 40.0, 0.62),
         ("side", 90.0, 3.2, 0.46, 40.0, 0.58), ("rear", 180.0, 3.2, 0.46, 40.0, 0.60),
         ("medium_distance", 25.0, 5.2, 0.40, 40.0, 0.75)]


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".jpg", ".png")):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        L.focus_game_viewport()
        gx, gy = STAGE_AT
        hit = unreal.SystemLibrary.line_trace_single(
            world, unreal.Vector(gx, gy, 600.0), unreal.Vector(gx, gy, -300.0),
            unreal.TraceTypeQuery.TRACE_TYPE_QUERY2, False, [], unreal.DrawDebugTrace.NONE, True,
            unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        gz = float(hit.to_tuple()[4].z) if hit and hasattr(hit, "to_tuple") else 15.0
        RESULT["ground_z"] = round(gz, 1)
        face = math.radians(FACING)
        rows = []
        for skin_id, file_stem in SKINS:
            body = L.spawn_figure_actor(world, unreal.Vector(gx, gy, gz), "%s/%s.wlvox" % (SKINS_DIR, file_stem), file_stem)
            yield 1.2
            if body is None:
                rows.append({"skin": skin_id, "error": "did not spawn"})
                continue
            body.set_actor_rotation(unreal.Rotator(0.0, 0.0, FACING), False)
            yield 1.0
            h = max(float(body.get_figure_height_uu()), 80.0)
            at = body.get_actor_location()
            # WHAT HAS TO FIT IS NOT THE HEIGHT. These distances were multiples of the figure's height, and the
            # defining feature of half these plates is WIDER than the dog is tall -- Apollo's halo and solar crown
            # ran off the top of its own front view. Framing on the larger of height and width leaves any skin
            # that really is taller than wide exactly where it was.
            span = h
            try:
                _, extent = body.get_actor_bounds(False)
                span = max(h, 2.0 * max(float(extent.x), float(extent.y)))
            except Exception as exc:
                unreal.log_warning("WLSKIN no bounds, framing on height: %s" % exc)
            taken = []
            for view, bearing, dist_h, look_h, fov, eye_h in VIEWS:
                # the camera stands on the FRONT side for bearing 0, so it is placed along the facing direction
                rad = face + math.radians(bearing)
                dist = span * dist_h
                eye = unreal.Vector(at.x + math.cos(rad) * dist, at.y + math.sin(rad) * dist, at.z + h * eye_h)
                L.pose_camera(world, eye, unreal.Vector(at.x, at.y, at.z + h * look_h), fov)
                yield 1.1
                name = "%s_%s.jpg" % (skin_id, view)
                H.capture_viewport_jpeg(os.path.join(ROOT, name), 1900, 95)
                taken.append(name)
            rows.append({"skin": skin_id, "height_uu": round(h, 1), "span_uu": round(span, 1), "shots": taken,
                         "parts": len(body.get_components_by_class(unreal.InstancedStaticMeshComponent))})
            body.destroy_actor()
            yield 0.4
        L.release_camera(world)
        RESULT["turnarounds"] = rows
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "turnaround.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLTURN could not end play: %s" % exc)
