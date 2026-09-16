# PIE job: where the Mission Contract Orb should stand, and how big, measured FROM THE PLAY CAMERA.
#
# The first filming of the seventeen states proved the beats and lost the orb: at its built size and offset
# it sat behind the Dog's own back leg and a foreground prop. (The 34 px I first estimated was wrong --
# it measures 137 px. Size was never the defect; standing inside the Dog's silhouette was.) Both are
# properties of the camera the player looks through, not of an editor viewport.
#
# For each candidate placement this reports three things and decides nothing:
#   - where the orb lands on screen, and how many pixels tall it is there;
#   - a trace from the camera to the core and the spine, WHICH DOES NOT WORK HERE and says why in place;
#   - a frame, so the numbers can be checked against a picture.
#
# Rules kept: zc_ prefix, no saves, no map edits, never Escape unless a panel is open, and it ends its own PIE.
import os

SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc")
L = unreal.WonderlandUiTestLibrary

# Forward (X), right (Y), HEIGHT above the floor, and a uniform scale. The built placement is first, so the
# report always contains the thing it is being compared against.
#
# THE GROUND ANSWER DOES NOT TRANSFER. (125, 80) was measured for a dais sitting on the flagstones, where
# nothing else lives; the contract now FLOATS at 122 uu, which is the Jhinn's chest height, and the Jhinn
# stands at Y=+110. The old winner puts a crystal directly in front of a companion. These trials are about
# getting clear of BOTH companions in the air rather than clear of the Dog on the floor.
CANDIDATES = [
    ("ground_era", 125.0, 80.0, 122.0, 1.0),
    ("forward_right", 210.0, 60.0, 135.0, 1.35),
    ("forward_centre", 215.0, 0.0, 150.0, 1.35),
    ("high_right", 130.0, 85.0, 205.0, 1.3),
    ("high_left", 130.0, -85.0, 205.0, 1.3),
    ("far_forward", 280.0, 30.0, 150.0, 1.7),
    ("wide_right_high", 150.0, 175.0, 170.0, 1.5),
    ("over_the_dog", 60.0, 0.0, 230.0, 1.3),
]


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["trials"] = []

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    controller = unreal.GameplayStatics.get_player_controller(world, 0)
    live = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem)
            if m.is_mission_strip_on_screen()]
    mission = live[0] if live else None
    if mission is None:
        RESULT["status"] = "error"
        RESULT["error"] = "no mission subsystem with an orb in the world"
        return

    # A mid-progression state, so the spine is half lit and its steps can be counted in the frame.
    mission.set_beat_by_id("coding_agent")
    yield 0.6

    def to_screen(at):
        """ProjectWorldToScreen returns the position alone in Python, not (bool, position)."""
        try:
            got = unreal.GameplayStatics.project_world_to_screen(controller, at, False)
        except Exception as exc:
            RESULT.setdefault("project_error", str(exc))
            return None
        if isinstance(got, tuple):
            got = got[1] if len(got) > 1 else got[0]
        try:
            return [float(got.x), float(got.y)]
        except AttributeError:
            return None

    camera = unreal.GameplayStatics.get_player_camera_manager(world, 0)

    # A CONTRACT ONLY EXISTS WHILE A TASK RUNS, so the probe has to start one before it can measure it.
    mission.set_beat_by_id("coding_agent")
    yield 1.2

    orb_actor = next((a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandMissionOrb)), None)
    if orb_actor is None:
        RESULT["status"] = "error"
        RESULT["error"] = "no contract manifested; nothing to place"
        return

    for name, forward, right, height, scale in CANDIDATES:
        try:
            orb_actor.set_editor_property("float_height_uu", height)
        except Exception as exc:
            RESULT.setdefault("height_error", str(exc))
        mission.set_orb_follow_offset(forward, right)
        mission.set_orb_scale(scale)
        # The follow snaps on an offset change; a beat's motion still needs a moment to settle.
        yield 0.8
        foot = mission.get_orb_location()
        height = mission.get_orb_height_uu()
        top = unreal.Vector(foot.x, foot.y, foot.z + height)
        middle = unreal.Vector(foot.x, foot.y, foot.z + height * 0.55)

        foot_px = to_screen(foot)
        top_px = to_screen(top)
        pixels = abs(top_px[1] - foot_px[1]) if (foot_px and top_px) else None

        # DO NOT TRUST THIS FIELD, and it is kept only because a reader will otherwise re-derive it.
        #
        # It returned True for all nine trials on 2026-09-15, including two where the orb is plainly hidden
        # in the frame -- behind the Dog's back leg, and behind the LLM Companion. The reason is structural:
        # the things most likely to stand in front of the orb in this world are the ones built NOT TO
        # COLLIDE. The companion embodiments disable collision on the actor and on every instanced
        # component, and so does the orb; hover props are the same. A visibility trace passes straight
        # through all of them, so it can only ever report world geometry.
        #
        # Occlusion here is decided by LOOKING AT THE CAPTURES. The numbers below size the orb; the picture
        # says whether anything is in front of it.
        seen = {}
        if camera is not None:
            eye = camera.get_camera_location()
            for label, target in (("core", top), ("spine", middle)):
                hit = unreal.SystemLibrary.line_trace_single(
                    world, eye, target, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [],
                    unreal.DrawDebugTrace.NONE, True)
                # LineTraceSingle hands Python the HitResult itself, or None when nothing blocked. Note
                # that the nine trials all came back None -- the ray from the camera to the orb crossed
                # nothing collidable even where the frame plainly shows the Dog's leg in the way.
                seen[label] = hit is None

        path = os.path.join(SHOTS, "zc_orbprobe_%s.png" % name)
        ok = L.capture_game_viewport(path)
        good = ok is True or (isinstance(ok, tuple) and ok and ok[0])

        trial = {"name": name, "forward": forward, "right": right, "height": height, "scale": scale,
                 "height_uu": round(height, 1), "foot_px": foot_px, "top_px": top_px,
                 "pixels_tall": None if pixels is None else round(pixels, 1),
                 "pixels_per_step": None if pixels is None else round(pixels / 9.0, 2),
                 "seen": seen, "capture": path if good else None}
        RESULT["trials"].append(trial)
        emit(name, "TRIAL", "offset %.0f,%.0f h%.0f scale %.1f" % (forward, right, height, scale), trial)

    # Leave it as it was found, so a probe never changes what the next job sees.
    mission.set_orb_follow_offset(125.0, 80.0)
    mission.set_orb_scale(1.0)
    mission.set_beat_by_id("idle")

    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    L.set_background_throttle_suspended(False)
    RESULT["status"] = "done"
