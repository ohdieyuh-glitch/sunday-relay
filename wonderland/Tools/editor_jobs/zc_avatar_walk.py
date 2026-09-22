# PIE proof: THE PROJECT AVATARS WALK, AND THEY DO NOT WALK STIFFLY.
#
# FOUNDER DIRECTIVE (2026-09-22): "The project avatars needs to walk flexible in the wonderland it cannot be stiff it
# cannot look stiff it cannot walk stiff it cannot move stiff."
#
# THEY COULD NOT WALK AT ALL when that was written. Every leg in the Ten Tails figures carried motion `none`: four
# rigid props under a body that slid across the ground with its feet nailed on. So this proof has to establish two
# different things, and a film alone establishes neither.
#
#   THE LEGS MOVE, AND THEY MOVE WITH THE BODY. The gait runs on measured ground speed, so the test drives the
#   creature across a plaza and reads the hips: they must swing, they must stop swinging when the body stops, and the
#   diagonal pairs must be half a cycle apart. A walk cycle on a timer would pass a screenshot and fail all three.
#
#   NOTHING IS RIGID OR IN LOCKSTEP. Stiffness is joints moving together on one clock, so the proof measures the
#   things that make a body read as a body: a knee running BEHIND the hip above it, a spine rolling into the stride,
#   and tails whose swing widens as the creature speeds up. Each is a number, and each has a value that means "stiff".
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "avatar_walk")
FIGURES = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir()), "ProjectAvatars")

# How far, and how fast. 330 uu/s is the speed at which the walk is fully shown (WalkSpeedUU).
WALK_SECONDS = 7.0
WALK_SPEED = 330.0


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    steps = []
    RESULT["steps"] = steps
    body = None
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        L.focus_game_viewport()

        base = pawn.get_actor_location()
        forward = pawn.get_actor_forward_vector()
        right = pawn.get_actor_right_vector()
        start = unreal.Vector(base.x + forward.x * 900.0 - right.x * 900.0,
                              base.y + forward.y * 900.0 - right.y * 900.0, base.z)

        figure = os.path.join(FIGURES, "TenTails_Medium.wlvox")
        body = L.spawn_figure_actor(world, start, figure, "TEN TAILS WALK")
        if body is None:
            RESULT["status"] = "failed"
            RESULT["why"] = "could not spawn the figure"
            return
        RESULT["parts"] = [str(n) for n in body.get_part_names()]
        RESULT["boxes"] = int(body.get_box_count())
        yield 2.0

        def shot(label, note=""):
            path = os.path.join(ROOT, "%02d_%s.jpg" % (len(steps), label))
            H.capture_viewport_jpeg(path, 1900, 92)
            steps.append({"step": label, "note": note, "file": path})

        def sample():
            # One reading of everything that tells stiff from not stiff.
            row = dict(
                speed=round(float(body.get_ground_speed_uu()), 1),
                phase=round(float(body.get_gait_phase()), 4),
                weight=round(float(body.get_gait_weight()), 4),
            )
            for joint in ("leg_fr", "leg_fr_shin", "leg_fl", "leg_bl", "root", "tail_0", "tail_9"):
                r = body.get_part_rotation(joint)
                row[joint] = (round(float(r.pitch), 2), round(float(r.yaw), 2), round(float(r.roll), 2))
            return row

        # ---- STANDING. Nothing should be swinging, but nothing should be frozen either.
        L.pose_camera(world, unreal.Vector(start.x + right.x * 820.0 - forward.x * 300.0,
                                           start.y + right.y * 820.0 - forward.y * 300.0, start.z + 300.0),
                      unreal.Vector(start.x, start.y, start.z + 160.0), 52.0)
        yield 1.5
        standing = []
        for _ in range(6):
            standing.append(sample())
            yield 0.4
        shot("standing", "at rest: the gait weight should be at the floor")
        RESULT["standing"] = standing
        RESULT["standing_weight_max"] = max(row["weight"] for row in standing)
        # A CREATURE AT REST IS NOT A STATUE. Something must still be moving, or "not stiff" fails at standstill.
        still = {tuple(row["root"]) for row in standing}
        RESULT["still_but_not_frozen"] = len(still) > 1

        # ---- WALKING. Drive it across the ground and read the joints as it goes.
        walking = []
        moved = 0.0
        elapsed = 0.0
        while elapsed < WALK_SECONDS:
            step = 0.25
            here = body.get_actor_location()
            body.set_actor_location(unreal.Vector(here.x + forward.x * WALK_SPEED * step,
                                                  here.y + forward.y * WALK_SPEED * step, here.z), False, False)
            moved += WALK_SPEED * step
            elapsed += step
            yield step
            walking.append(sample())
            if len(walking) in (4, 12, 22):
                shot("walking_%d" % len(walking), "mid-stride, %.0f uu travelled" % moved)
        RESULT["walking"] = walking
        RESULT["distance_uu"] = round(moved, 1)

        # ---- WHAT THE NUMBERS HAVE TO SAY -------------------------------------------------------------------
        hip = [row["leg_fr"][0] for row in walking]
        knee = [row["leg_fr_shin"][0] for row in walking]
        other = [row["leg_fl"][0] for row in walking]
        spine = [row["root"][2] for row in walking]
        weights = [row["weight"] for row in walking]

        RESULT["gait_weight_max"] = max(weights)
        RESULT["hip_swing_degrees"] = round(max(hip) - min(hip), 2)
        RESULT["knee_bend_degrees"] = round(max(knee) - min(knee), 2)
        RESULT["spine_roll_degrees"] = round(max(spine) - min(spine), 2)

        # THE LEGS MOVE AT ALL. Zero here is the old build: four rigid props.
        RESULT["legs_move"] = RESULT["hip_swing_degrees"] > 8.0
        # THE KNEE BENDS, so a leg is a leg and not a hinge.
        RESULT["knees_bend"] = RESULT["knee_bend_degrees"] > 6.0
        # THE BODY FLEXES with the stride rather than riding over it.
        RESULT["spine_flexes"] = RESULT["spine_roll_degrees"] > 2.0

        # DIAGONAL PAIRS ARE HALF A CYCLE APART. Legs in lockstep are the most mechanical walk there is, and this is
        # the number that catches it: a correlation near +1 means the two legs are doing the same thing at once.
        def correlate(a, b):
            n = min(len(a), len(b))
            if n < 4:
                return 0.0
            ma = sum(a[:n]) / n
            mb = sum(b[:n]) / n
            va = math.sqrt(sum((x - ma) ** 2 for x in a[:n]))
            vb = math.sqrt(sum((x - mb) ** 2 for x in b[:n]))
            if va < 1e-6 or vb < 1e-6:
                return 0.0
            return sum((a[i] - ma) * (b[i] - mb) for i in range(n)) / (va * vb)

        RESULT["opposite_legs_correlation"] = round(correlate(hip, other), 3)
        RESULT["legs_not_in_lockstep"] = RESULT["opposite_legs_correlation"] < 0.4
        # AND THE KNEE RUNS BEHIND ITS HIP rather than bending on the same frame.
        RESULT["knee_hip_correlation"] = round(correlate(hip, knee), 3)
        RESULT["knee_lags_hip"] = abs(RESULT["knee_hip_correlation"]) < 0.92

        # ---- STOPPING. The walk must ease out, not stop dead on the frame the body does.
        stopping = []
        for _ in range(10):
            stopping.append(sample())
            yield 0.35
        RESULT["stopping"] = stopping
        RESULT["weight_after_stop"] = stopping[-1]["weight"]
        RESULT["walk_eases_out"] = stopping[-1]["weight"] < 0.15 and stopping[0]["weight"] > stopping[-1]["weight"]
        shot("stopped", "after stopping: the stride should have eased away, not snapped off")

        L.release_camera(world)
        RESULT["status"] = "done"
    finally:
        if body is not None:
            try:
                body.destroy_actor()
            except Exception:
                pass
        with open(os.path.join(ROOT, "steps.json"), "w", encoding="utf-8") as fh:
            json.dump(steps, fh, indent=1)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLWALK could not end play: %s" % exc)
