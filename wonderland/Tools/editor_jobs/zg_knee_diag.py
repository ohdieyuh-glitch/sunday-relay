# DIAGNOSTIC (read-only): WHEN DOES A WORN COSTUME'S KNEE READ -90 DEGREES? (zg_16 reported min knee pitch exactly -90
# on every skin while every other locomotion check passed.) An Euler reading pins at the pitch singularity, so -90.00 is
# either a real momentary full fold -- a visible glitch -- or an artefact of reading the rotator. This logs every frame a
# costume knee passes -60 degrees with the phase, the canon's own knee and hip on that side, the leg-performance share,
# the airborne share and the quaternion angle of the knee (which does not pin), so the two can be told apart.
# Globals: SKIN, SPOT, FORWARD_YAW. PIE-owning: CONCURRENT is False. Saves nothing.
CONCURRENT = False
import math
import os

L = unreal.WonderlandUiTestLibrary
GS = unreal.GameplayStatics
SKIN = globals().get("SKIN", "celestial_light")
SPOT = globals().get("SPOT", [0.0, 44000.0, 12.0])
FORWARD_YAW = globals().get("FORWARD_YAW", 90.0)


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    RESULT["status"] = "running"
    L.set_background_throttle_suspended(True)
    try:
        yield from _run(ues, les)
    finally:
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
            while ues.get_game_world() is not None:
                yield 1.0


def _run(ues, les):
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    t = 0.0
    while ues.get_game_world() is None and t < 120.0:
        yield 1.0
        t += 1.0
    world = ues.get_game_world()
    dog_of = lambda: GS.get_player_pawn(ues.get_game_world(), 0)
    while dog_of() is None:
        yield 0.5
    yield 3.0
    ui = L.get_ui(world)
    persisted = None
    try:
        persisted = open(os.path.join(unreal.Paths.project_saved_dir(), "Wonderland", "RelaySkin.txt")).read().strip()
    except Exception:
        pass
    ui.wear_relay_skin(SKIN)
    yield 2.5
    dog = dog_of()
    dog.character_movement.disable_movement()
    dog.set_actor_location(unreal.Vector(SPOT[0], SPOT[1], 2500.0), False, True)
    w = 0.0
    while w < 30.0 and not L.is_world_partition_streaming_complete(world):
        yield 0.5
        w += 0.5
    dog = dog_of()
    dog.set_actor_location(unreal.Vector(SPOT[0], SPOT[1], SPOT[2] + 120.0), False, True)
    dog.character_movement.set_movement_mode(unreal.MovementMode.MOVE_WALKING)
    ctrl = dog.get_controller()
    if ctrl is not None:
        ctrl.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-10.0, yaw=FORWARD_YAW))
    costume = dog.get_costume()
    names = [str(n) for n in costume.get_part_names()]
    knees = {}
    for entry in str(costume.describe_limbs()).split(";"):
        entry = entry.strip()
        if "=" in entry:
            name, rest = entry.split("=", 1)
            kind = rest.split(" ")[0]
            if kind.startswith("knee"):
                knees[1 if kind.endswith("+Y") else -1] = name.strip()
    comps = {}
    for c in costume.get_components_by_class(unreal.SceneComponent):
        n = c.get_name()
        if not n.startswith("Part_"):
            continue
        key = n[5:]
        if key not in names:
            base, _, tail = key.rpartition("_")      # a re-dressed costume's parts carry a _N suffix
            if tail.isdigit() and base in names:
                key = base
        if key in names and key not in comps:
            comps[key] = c
    RESULT["parts_found"] = sorted(comps.keys())
    RESULT["knees"] = knees
    events = []
    RESULT["events"] = events
    phases = [("landing", None, 1.5), ("idle", None, 1.5), ("forward", 0.0, 3.0), ("backward", 180.0, 3.0), ("strafe_left", 90.0, 2.0),
              ("strafe_right", -90.0, 2.0), ("rotate", "arc", 3.0), ("sustained", 0.0, 4.0), ("stop", None, 2.0), ("resume", 0.0, 2.0)]
    counts = {}
    worst = {}
    for name, rel, seconds in phases:
        g0 = GS.get_time_seconds(world)
        while GS.get_time_seconds(world) - g0 < seconds:
            dog = dog_of()
            el = GS.get_time_seconds(world) - g0
            if rel is not None:
                yaw = FORWARD_YAW + (180.0 * min(el / seconds, 1.0) if rel == "arc" else rel)
                dog.add_movement_input(unreal.Vector(math.cos(math.radians(yaw)), math.sin(math.radians(yaw)), 0.0), 1.0, True)
            pose = dog.get_canonical_worn_pose()
            for side, part in knees.items():
                c = comps.get(part)
                if c is None:
                    continue
                r = c.get_editor_property("relative_rotation")
                q = r.quaternion()
                ang = math.degrees(2.0 * math.acos(max(-1.0, min(1.0, abs(q.w)))))
                counts[name] = counts.get(name, 0) + 1
                if abs(r.pitch) > 60.0 or ang > 60.0:
                    shin = pose.shin_plus_y if side > 0 else pose.shin_minus_y
                    hip = pose.hip_plus_y if side > 0 else pose.hip_minus_y
                    ev = {"phase": name, "t": round(el, 3), "side": side, "pitch": round(r.pitch, 2), "yaw": round(r.yaw, 2), "roll": round(r.roll, 2),
                          "quat_angle": round(ang, 2), "canon_shin_pitch": round(shin.pitch, 2), "canon_hip_pitch": round(hip.pitch, 2),
                          "leg_perform": round(float(pose.leg_perform_weight), 3), "airborne": round(float(pose.airborne_weight), 3),
                          "speed": round(math.hypot(dog.get_velocity().x, dog.get_velocity().y), 1), "mode": str(dog.character_movement.movement_mode)}
                    if len(events) < 120:
                        events.append(ev)
                    worst[name] = max(worst.get(name, 0.0), ang)
            yield 0.0
    RESULT["frames_per_phase"] = counts
    RESULT["worst_knee_angle_by_phase"] = {k: round(v, 1) for k, v in worst.items()}
    if persisted:
        ui.wear_relay_skin(persisted)
        yield 1.5
    RESULT["status"] = "measured"
