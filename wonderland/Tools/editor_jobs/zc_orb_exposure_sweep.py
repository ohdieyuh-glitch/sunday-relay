# HOW BRIGHT DOES A DRAFT ORB HAVE TO BE DRAWN TO READ AS GREY? Filmed, not argued.
#
# FOUNDER: "the new orb that pops up on the one on top needs to be grey not black."
#
# TWO ESTIMATES DISAGREE BY TWENTY TIMES. This orb's own orbit ring reads clearly on film at an emissive of 2,200
# scene units, which says the body needs only a few thousand; a peer lane measuring lit assets against this map's
# pinned EV100 daylight puts the working range at 55,000-62,000, which would say the body needs ten times that.
# Guessing between them costs a rebuild each time, so the floors were made writeable and this sweeps them: one
# RED contract and one GRAY draft, staged through the control, photographed at every candidate exposure.
#
# NOTHING HERE TOUCHES WHAT A TASK IS. Only how brightly its orb is drawn.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "orb_exposure_sweep")

# Contract exposure, and the draft a little above it because a neutral colour has no hue to carry it.
LADDER = [0.55, 1.10, 2.20, 4.40, 8.80, 14.00]


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
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
        yield 6.0
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        ui, tasks, mission = L.get_ui(world), L.get_mission_tasks(world), L.get_mission(world)
        if not (ui and tasks and mission):
            RESULT["status"] = "failed"
            RESULT["why"] = "no ui / task / mission subsystem"
            return
        L.focus_game_viewport()

        # WHAT ELSE IS STANDING IN THIS WORLD. A peer lane and I have been trading guesses about three figures in
        # the arrival plaza; a census settles it with a list instead of two opinions.
        census = {}
        for cls in ("WonderlandCompanionEmbodiment", "WonderlandSkinStage", "WonderlandSubAgentCub",
                    "RelayDogCharacter", "WonderlandMissionOrb"):
            kind = getattr(unreal, cls, None)
            if kind is None:
                census[cls] = "class not reflected"
                continue
            rows = []
            for a in unreal.GameplayStatics.get_all_actors_of_class(world, kind):
                v = a.get_actor_location()
                rows.append({"name": str(a.get_name()), "at": [round(v.x), round(v.y), round(v.z)]})
            census[cls] = rows
        RESULT["census"] = census

        # ---- stage exactly one RED and one GRAY, through the control
        ui.press_add_task()
        yield 1.0
        tasks.submit_draft(tasks.get_task_list()[0].local_id, "Sweep: the red contract")
        yield 1.5
        ui.press_add_task()
        yield 2.5
        RESULT["stack"] = [str(s) for s in mission.describe_orb_stack()]

        spots = sorted([[a.get_actor_location().x, a.get_actor_location().y, a.get_actor_location().z]
                        for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandMissionOrb)],
                       key=lambda p: p[2])
        RESULT["spots"] = [[round(s[0], 1), round(s[1], 1), round(s[2], 1)] for s in spots]
        # THE GAP THE FOUNDER ASKED ABOUT, stated as a number rather than left to the eye.
        if len(spots) >= 2:
            RESULT["step_uu"] = round(spots[1][2] - spots[0][2], 1)

        fwd = pawn.get_actor_forward_vector()
        lo, hi = spots[0], spots[-1]
        cx, cy = (lo[0] + hi[0]) * 0.5, (lo[1] + hi[1]) * 0.5
        cz = (lo[2] + hi[2]) * 0.5
        span = max(hi[2] - lo[2], 60.0)
        back = span * 1.4 + 210.0
        L.pose_camera(world,
                      unreal.Vector(cx - fwd.x * back, cy - fwd.y * back, cz + span * 0.15),
                      unreal.Vector(cx, cy, cz), 52.0)
        yield 1.5

        shots = []
        for step in LADDER:
            for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandMissionOrb):
                a.set_editor_property("contract_body_exposure", float(step))
                a.set_editor_property("draft_body_exposure", float(step) * 1.3)
            yield 1.2
            name = "exp_%05d.jpg" % int(step * 1000)
            H.capture_viewport_jpeg(os.path.join(ROOT, name), 1900, 96)
            shots.append({"contract": step, "draft": round(step * 1.3, 3),
                          "scene_units_red_peak": round(step * 4000 * 0.78),
                          "scene_units_gray_peak": round(step * 1.3 * 4000 * 0.80),
                          "file": name})
        RESULT["ladder"] = shots
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "sweep.json"), "w", encoding="utf-8") as fh:
            json.dump({k: RESULT.get(k) for k in ("status", "stack", "spots", "step_uu", "ladder", "census")},
                      fh, indent=1)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLSWEEP could not end play: %s" % exc)
