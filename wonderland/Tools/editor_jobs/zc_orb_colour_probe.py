# WHY IS THE DRAFT ORB BLACK? A measurement, not a guess.
#
# The founder's reading of the last proof was that the new orb "needs to be grey not black", and the frames agree
# numerically: the draft orb's band measured rgb(48,46,44) where the red ones measured rgb(48,1,1). Both are far
# darker than a 4000x unlit emissive should ever render, so before any colour constant is changed this asks the
# running editor what the crystal is actually made of and photographs one orb from close enough that nothing is
# being inferred from a fifteen-pixel silhouette.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "orb_colour_probe")


def job():
    os.makedirs(ROOT, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 6.0
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        ui = L.get_ui(world)
        tasks = L.get_mission_tasks(world)
        mission = L.get_mission(world)
        if not (ui and tasks and mission):
            RESULT["status"] = "failed"
            RESULT["why"] = "no ui / task / mission subsystem"
            return
        L.focus_game_viewport()

        # ONE RED AND ONE GRAY, through the control, so the two are photographed side by side under one exposure.
        ui.press_add_task()
        yield 1.0
        rows = tasks.get_task_list()
        tasks.submit_draft(rows[0].local_id, "Probe: the red contract")
        yield 1.5
        ui.press_add_task()          # leaves a DRAFT above it
        yield 2.5
        RESULT["stack"] = [str(s) for s in mission.describe_orb_stack()]

        # ---- WHAT THE CRYSTAL IS MADE OF, asked of the actor rather than read out of the source.
        dump = []
        for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandMissionOrb):
            v = a.get_actor_location()
            entry = {"at": [round(v.x, 1), round(v.y, 1), round(v.z, 1)],
                     "scale": round(float(a.get_actor_scale3d().z), 3), "comps": []}
            for c in a.get_components_by_class(unreal.InstancedStaticMeshComponent):
                row = {"name": str(c.get_name()), "instances": int(c.get_instance_count())}
                try:
                    m = c.get_material(0)
                    row["material"] = str(m.get_name()) if m else None
                    row["class"] = str(type(m).__name__) if m else None
                    if m is not None and hasattr(m, "get_vector_parameter_value"):
                        try:
                            row["colour"] = str(m.get_vector_parameter_value("Color"))
                        except Exception as exc:
                            row["colour_err"] = str(exc)
                    if m is not None and hasattr(m, "get_base_material"):
                        try:
                            row["parent"] = str(m.get_base_material().get_name())
                        except Exception as exc:
                            row["parent_err"] = str(exc)
                except Exception as exc:
                    row["err"] = str(exc)
                entry["comps"].append(row)
            dump.append(entry)
        RESULT["orbs"] = sorted(dump, key=lambda e: e["at"][2])

        # ---- AND A CLOSE-UP, because a colour cannot be judged from a silhouette a dozen pixels wide.
        spots = sorted([(a.get_actor_location().x, a.get_actor_location().y, a.get_actor_location().z)
                        for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandMissionOrb)],
                       key=lambda p: p[2])
        RESULT["spots"] = [[round(s[0], 1), round(s[1], 1), round(s[2], 1)] for s in spots]
        if len(spots) >= 2:
            fwd = pawn.get_actor_forward_vector()
            lo, hi = spots[0], spots[-1]
            cx, cy = (lo[0] + hi[0]) * 0.5, (lo[1] + hi[1]) * 0.5
            cz = (lo[2] + hi[2]) * 0.5
            for back, tag in ((150.0, "close"), (300.0, "mid")):
                L.pose_camera(world,
                              unreal.Vector(cx - fwd.x * back, cy - fwd.y * back, cz),
                              unreal.Vector(cx, cy, cz), 55.0)
                yield 1.2
                H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % tag), 1900, 96)
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "probe.json"), "w", encoding="utf-8") as fh:
            json.dump({k: RESULT.get(k) for k in ("status", "stack", "orbs", "spots")}, fh, indent=1)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLPROBE could not end play: %s" % exc)
