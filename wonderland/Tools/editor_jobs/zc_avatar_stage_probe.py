# WHERE A 9.5-METRE AVATAR CAN ACTUALLY BE PHOTOGRAPHED. The turnaround stage at (-330, -420) was chosen for the
# RELAY DOG -- a figure about a metre across -- and Cherubim Large spans 957 uu, so its cameras stand 18 m out and
# land inside mushrooms, planters and walls. Rather than guess another spot, score candidates: ground the point,
# then trace out along the five view bearings at the distance the widest avatar needs, and keep the point with the
# most clearance. Reports only -- it moves nothing.
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "avatar_remake")
FACING = 40.0
# The widest Large form is Cherubim at 957 uu; turnaround views sit at 1.9x span, player distance at 4.2x.
SPAN = 960.0
NEED = [(0.0, SPAN * 1.9), (40.0, SPAN * 1.9), (90.0, SPAN * 1.9), (180.0, SPAN * 1.9), (25.0, SPAN * 4.2)]
EYE_Z = 560.0 * 0.55


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    RESULT["status"] = "running"
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 3.0
        world = ues.get_game_world()
        face = math.radians(FACING)
        best = []
        tested = 0
        for gx in range(-2600, 2601, 400):
            for gy in range(-2600, 2601, 400):
                down = unreal.SystemLibrary.line_trace_single(
                    world, unreal.Vector(gx, gy, 900.0), unreal.Vector(gx, gy, -400.0),
                    unreal.TraceTypeQuery.TRACE_TYPE_QUERY2, False, [], unreal.DrawDebugTrace.NONE, True,
                    unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
                if not (down and hasattr(down, "to_tuple")):
                    continue
                gz = float(down.to_tuple()[4].z)
                # FLAT GROUND ONLY, and not a rooftop or a flowerbed: the arrival plaza sits near z=17.
                if gz < -20.0 or gz > 120.0:
                    continue
                tested += 1
                eye_from = unreal.Vector(gx, gy, gz + EYE_Z)
                worst = None
                for bearing, want in NEED:
                    rad = face + math.radians(bearing)
                    out = unreal.Vector(gx + math.cos(rad) * want, gy + math.sin(rad) * want, gz + EYE_Z)
                    hit = unreal.SystemLibrary.line_trace_single(
                        world, eye_from, out, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [],
                        unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
                    if hit and hasattr(hit, "to_tuple"):
                        hp = hit.to_tuple()[4]
                        got = math.hypot(hp.x - gx, hp.y - gy)
                    else:
                        got = want
                    # SCORE HOW MUCH OF THE WANTED DISTANCE IS ACTUALLY CLEAR, not the raw distance: the player
                    # shot wants far more room than a turnaround and would otherwise dominate the score.
                    frac = got / want
                    worst = frac if worst is None else min(worst, frac)
                best.append({"x": gx, "y": gy, "z": round(gz, 1), "worst_clear_frac": round(worst, 3)})
            yield None
        best.sort(key=lambda r: -r["worst_clear_frac"])
        RESULT["tested"] = tested
        RESULT["best"] = best[:12]
        RESULT["current_stage"] = [r for r in best if abs(r["x"] + 330) <= 200 and abs(r["y"] + 420) <= 200][:3]
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "stageprobe.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLAVATAR probe could not end play: %s" % exc)
