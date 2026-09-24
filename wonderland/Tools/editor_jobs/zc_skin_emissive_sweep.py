# WHAT EMISSIVE STRENGTH MAKES A FLAME READ AS FIRE ON A RELAY SKIN? Filmed, side by side, in one frame.
#
# In-engine every flame on the rebuilt skins washes to white: Apollo's solar crown is a white cone, Arden's halo
# fire is a scatter of pink specks. That is the shape of the orb's exposure failure -- an unlit emissive driven an
# order of magnitude past the band where its colour survives -- but a figure's "glow" material is its own path
# and the founder's rule is that a constant measured on one path is never carried to another.
#
# So four copies of Arden differing ONLY in the strength of ember / emberpale / ruby are stood in a row in the
# open plaza and photographed together under the same light. The one whose fire is orange with visible tongues
# names the number; the rest are the argument for it.
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_emissive_sweep")
SWEEP = "C:/dev/iwonder/wonderland-proof/wonderland/RelaySkins/_sweep"
VARIANTS = ["Arden_k006.wlvox", "Arden_k012.wlvox", "Arden_k025.wlvox", "Arden_k060.wlvox", "Arden_k120.wlvox", "Arden_k240.wlvox"]
# the open paving the orb hero survey found clear from azimuth 315
STAGE_AT = (-170.0, -346.0)


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

        # ground under the staging line, found the way the clearance bubble finds it
        gx, gy = STAGE_AT
        hit = unreal.SystemLibrary.line_trace_single(
            world, unreal.Vector(gx, gy, 600.0), unreal.Vector(gx, gy, -300.0),
            unreal.TraceTypeQuery.TRACE_TYPE_QUERY2, False, [], unreal.DrawDebugTrace.NONE, True,
            unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        gz = float(hit.to_tuple()[4].z) if hit and hasattr(hit, "to_tuple") else 21.0
        RESULT["ground_z"] = round(gz, 1)

        # four in a row, facing azimuth 315, 190 uu apart, so the frame holds all of them at portrait size
        face = math.radians(315.0)
        fdir = (math.cos(face), math.sin(face))
        rdir = (-fdir[1], fdir[0])
        bodies = []
        for i, name in enumerate(VARIANTS):
            off = (i - (len(VARIANTS) - 1) * 0.5) * 175.0
            x, y = gx + rdir[0] * off, gy + rdir[1] * off
            body = L.spawn_figure_actor(world, unreal.Vector(x, y, gz), SWEEP + "/" + name, name.replace(".wlvox", ""))
            yield 0.8
            if body is None:
                RESULT.setdefault("failed", []).append(name)
                continue
            # unreal.Rotator is (ROLL, PITCH, YAW). Rotator(0, 315, 0) pitched every figure over onto its back,
            # which is how the first row came out lying on the paving with its halo flat on the ground.
            body.set_actor_rotation(unreal.Rotator(0.0, 0.0, 315.0), False)
            bodies.append((name, body))
        RESULT["spawned"] = [n for n, _ in bodies]
        yield 2.0

        # camera on the 315 bearing, looking back at the row
        # 760 uu out on this bearing is behind a gold gate; the orb survey found the bearing clear at ~480.
        back = 520.0
        eye = unreal.Vector(gx + fdir[0] * back, gy + fdir[1] * back, gz + 190.0)
        L.pose_camera(world, eye, unreal.Vector(gx, gy, gz + 100.0), 78.0)
        yield 1.5
        H.capture_viewport_jpeg(os.path.join(ROOT, "row.jpg"), 1900, 95)
        # and one close on each, same bearing
        for name, body in bodies:
            at = body.get_actor_location()
            L.pose_camera(world, unreal.Vector(at.x + fdir[0] * 420.0, at.y + fdir[1] * 420.0, at.z + 150.0),
                          unreal.Vector(at.x, at.y, at.z + 100.0), 42.0)
            yield 1.0
            H.capture_viewport_jpeg(os.path.join(ROOT, name.replace(".wlvox", "") + ".jpg"), 1900, 95)
        L.release_camera(world)
        for _, body in bodies:
            body.destroy_actor()
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "sweep.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLEMIS could not end play: %s" % exc)
