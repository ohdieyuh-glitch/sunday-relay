RAISED = globals().get("RAISED", 60000.0)
# PIE job, READ-ONLY (nothing is saved, the editor world is untouched): what does raising the tree cull cost?
#
# CORE's gate (2026-09-29, before any edit): 14,699 of the world's 25,634 tree instances (trunk + canopy) cull at 260 m,
# so inside the 512 m streaming radius more than half of what is loaded is never drawn. Before the batches are edited,
# measure at three heavy views, baseline vs every loaded tree batch at 260 m raised to RAISED at RUNTIME. Accept if the
# raised mean fps stays within 15 % of baseline and no view falls under 30 fps; otherwise try 450 m.
#
# THE INSTRUMENT (perf_remove_ab.py's lessons): suspend the background throttle or every number is the throttle; median
# and 95th-percentile frame time from the engine's own frame counter; a discarded warm window first (order bias); the
# baseline measured again after the raise is undone, as the noise floor; any window above 250 ms is the editor
# throttling, not the scene. Streaming is gated on World Partition itself. Raises are applied per view AFTER streaming
# completes there -- a batch that streams in later arrives with its authored cull -- and undone before the next view.
# CONCURRENT is False: this job owns PIE.
CONCURRENT = False
import math
import time

L = unreal.WonderlandUiTestLibrary
SECONDS = globals().get("SECONDS", 10.0)
OLD = 26000.0
VIEWS = [
    # name, x, y, camera z, pitch, yaw, fov
    ("frontier_T316_outward", 75352.0, -73423.0, 350.0, -2.0, 315.7, 80.0),
    ("heartland_N227_to_ring", -60761.0, -66095.0, 300.0, 1.5, 227.41, 80.0),
    ("rr02_250_along_road", -37170.0, -101394.0, 362.0, -2.0, 339.9, 80.0),
]


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    yield (lambda: ues.get_game_world() is None, 1800)
    unreal.SystemLibrary.execute_console_command(None, "t.IdleWhenNotForeground 0")
    RESULT["throttle_suspended"] = bool(L.set_background_throttle_suspended(True))
    RESULT["raised_to_cm"] = RAISED
    les.editor_request_begin_play()
    try:
        yield from _run(ues)
    finally:
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 120)
    RESULT["status"] = RESULT.get("status", "done")


def _window(seconds):
    deltas = []
    last_f, last_t = unreal.SystemLibrary.get_frame_count(), time.perf_counter()
    t0 = last_t
    f0 = last_f
    end = last_t + seconds
    while time.perf_counter() < end:
        yield 0.0
        f, t = unreal.SystemLibrary.get_frame_count(), time.perf_counter()
        if f > last_f:
            deltas.append((t - last_t) * 1000.0 / (f - last_f))
            last_f, last_t = f, t
    if not deltas:
        return None
    deltas.sort()
    frames = unreal.SystemLibrary.get_frame_count() - f0
    return {"median_ms": round(deltas[len(deltas) // 2], 2), "p95_ms": round(deltas[min(len(deltas) - 1, int(len(deltas) * 0.95))], 2),
            "mean_fps": round(frames / max(1e-6, time.perf_counter() - t0), 1),
            "p5_fps": round(1000.0 / deltas[min(len(deltas) - 1, int(len(deltas) * 0.95))], 1), "samples": len(deltas)}


def _run(ues):
    yield (lambda: ues.get_game_world() is not None, 240)
    world = ues.get_game_world()
    yield (lambda: unreal.GameplayStatics.get_player_pawn(world, 0) is not None, 120)
    yield 6.0
    SL = unreal.SystemLibrary
    cv = {}
    for name in ("t.MaxFPS", "r.VSync", "r.ScreenPercentage"):
        try:
            cv[name] = SL.get_console_variable_float_value(name)
        except Exception as exc:                                          # noqa: BLE001
            cv[name] = repr(exc)[:80]
    RESULT["cvars"] = cv
    try:
        vp = unreal.WidgetLayoutLibrary.get_viewport_size(world)
        RESULT["viewport"] = [round(vp.x), round(vp.y)]
    except Exception as exc:                                              # noqa: BLE001
        RESULT["viewport"] = repr(exc)[:80]
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    for hud in unreal.ObjectIterator(unreal.WonderlandUsageHudWidget):
        if hud.get_world() == world:
            hud.set_visibility(unreal.SlateVisibility.HIDDEN)
    # THE GAMEPLAY CAMERA, not a level camera: zzW429's rover (a CameraActor) was itself a World Partition actor and was
    # streamed out when the Dog moved to the second view ("ObjectInstance is null"). The Dog stands at the view and the
    # controller aims its camera -- the view a player has, with the Dog in it, and the streaming source where it looks.
    views = []
    for (name, x, y, z, pitch, yaw, fov) in VIEWS:
        row = {"view": name}
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        try:
            pawn.set_actor_location(unreal.Vector(x, y, 250.0), False, True)
            pawn.character_movement.set_editor_property("velocity", unreal.Vector(0, 0, 0))
            pawn.character_movement.set_movement_mode(unreal.MovementMode.MOVE_FALLING)
        except Exception as exc:                                          # noqa: BLE001
            row["pawn_error"] = repr(exc)[:120]
        pc.set_view_target_with_blend(pawn, 0.0)
        yield 1.0
        unreal.SystemLibrary.execute_console_command(world, "FlushLevelStreaming")
        t0, done = time.time(), False
        while time.time() - t0 < 30.0:
            yield 0.25
            try:
                done = bool(L.is_world_partition_streaming_complete(world))
            except Exception:                                             # noqa: BLE001
                done = False
                break
            if done:
                break
        row["streaming_complete"] = done
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        pc.set_control_rotation(unreal.Rotator(roll=0.0, pitch=pitch - 6.0, yaw=yaw))
        yield 2.0
        try:
            cr = pc.player_camera_manager.get_camera_rotation()
            cl = pc.player_camera_manager.get_camera_location()
            row["camera"] = {"yaw": round(cr.yaw, 1), "pitch": round(cr.pitch, 1), "at": [round(cl.x), round(cl.y), round(cl.z)]}
        except Exception as exc:                                          # noqa: BLE001
            row["camera"] = repr(exc)[:80]
        # WARM long, then ALTERNATE: baseline, raised, baseline, raised -- zzW429's one view drifted +21 % over its
        # three windows (the scene still settling), which a single B-then-R order books as the raise's gain
        warm = yield from _window(8.0)
        comps = []
        n_batches = 0
        for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
            try:
                mp = str(a.get_editor_property("mesh_path")).lower()
                cd = float(a.get_editor_property("cull_distance"))
            except Exception:                                             # noqa: BLE001
                continue
            if not ("trunk" in mp or "canopy" in mp) or abs(cd - OLD) > 1.0:
                continue
            n_batches += 1
            for c in a.get_components_by_class(unreal.InstancedStaticMeshComponent):
                comps.append((c, int(c.get_editor_property("instance_start_cull_distance")),
                              int(c.get_editor_property("instance_end_cull_distance"))))
        row["tree_batches_at_260m_loaded"] = n_batches
        row["instances_raised"] = sum(int(c.get_instance_count()) for (c, s0, e0) in comps)
        wins = {}
        for label, raise_it in (("B1", False), ("R1", True), ("B2", False), ("R2", True)):
            for (c, s0, e0) in comps:
                if raise_it:
                    c.set_cull_distances(int(RAISED * 0.8), int(RAISED))
                else:
                    c.set_cull_distances(s0, e0)
            yield 2.0
            wins[label] = yield from _window(SECONDS)
        for (c, s0, e0) in comps:
            c.set_cull_distances(s0, e0)
        row.update({"warm": warm, "windows": wins})
        bs = [wins[k] for k in ("B1", "B2") if wins.get(k)]
        rs = [wins[k] for k in ("R1", "R2") if wins.get(k)]
        if bs and rs:
            bm = sum(w["mean_fps"] for w in bs) / len(bs)
            rm = sum(w["mean_fps"] for w in rs) / len(rs)
            row["baseline_mean_fps"] = round(bm, 1)
            row["raised_mean_fps"] = round(rm, 1)
            row["baseline_p5_fps"] = round(min(w["p5_fps"] for w in bs), 1)
            row["raised_p5_fps"] = round(min(w["p5_fps"] for w in rs), 1)
            row["change_pct"] = round(100.0 * (rm - bm) / max(1e-6, bm), 1)
            row["noise_pct"] = round(100.0 * abs(bs[-1]["mean_fps"] - bs[0]["mean_fps"]) / max(1e-6, bm), 1) if len(bs) == 2 else None
            if bs[0]["median_ms"] > 250.0:
                row["INVALID"] = "baseline above 250 ms: the editor is throttled, not the scene"
        views.append(row)
        RESULT["views"] = views
        yield 0.0
    ok = len(views) == len(VIEWS) and all(v.get("raised_mean_fps") and not v.get("INVALID")
             and v["raised_mean_fps"] >= 0.85 * v["baseline_mean_fps"] and v["raised_mean_fps"] >= 30.0 for v in views)
    RESULT["gate"] = "PASS" if ok else "FAIL"
    RESULT["status"] = "measured"
