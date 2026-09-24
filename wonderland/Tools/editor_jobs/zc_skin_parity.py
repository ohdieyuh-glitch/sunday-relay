# DOES AN ALTERNATE SKIN MOVE LIKE RELAY OG?
#
# FOUNDER: "Relay OG is the complete mission-animation authority... the skin must not own the mission state
# machine... prove only Relay OG vs Celestial Light first."
#
# THE DEFECT THIS IS THE PROOF FOR. A costume was handed THREE numbers -- stride phase, gait weight, ground
# speed -- and invented the rest itself off an internal clock: head, tail, spine, and the standing half of the
# legs. Walking, the gait weight carried enough of the truth to nearly pass. STANDING STILL, where the gait
# weight is zero, the skin was running entirely on its own invention, which is why the alternates idled nothing
# like Relay OG. And a Mission Contract act reached the costume through no channel at all.
#
# So this holds the costume's worn pose against the DOG'S OWN canonical pose, frame by frame, and asks whether
# they are the SAME NUMBERS -- not whether they look similar. Then it checks the channels that never existed:
# the idle, the jump, and the lift the performance puts the whole body on.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_parity")
FIELDS = ("stride_phase", "gait_weight", "speed_uu", "bob_uu", "sway_uu", "lift_uu",
          "body_pitch_deg", "body_yaw_deg", "body_roll_deg",
          "head_pitch_deg", "head_yaw_deg", "tail_pitch_deg", "tail_yaw_deg",
          "airborne_weight", "stillness")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["status"] = "running"
    shots = []

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def shot(name, note):
        path = os.path.join(ROOT, "%02d_%s.jpg" % (len(shots) + 1, name))
        H.capture_viewport_jpeg(path, 1700, 92)
        shots.append({"n": len(shots) + 1, "name": name, "note": note})

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    ui = L.get_ui(world)
    L.focus_game_viewport()
    yield 0.5

    dogs = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RelayDogCharacter)
    if not dogs:
        RESULT["status"] = "FAIL: no Relay Dog in the world"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    dog = dogs[0]

    def costume():
        for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandCompanionEmbodiment):
            if str(a.get_editor_property("class_label")) == "RELAY DOG SKIN":
                return a
        return None

    def read(pose):
        return dict((f, round(float(getattr(pose, f)), 4)) for f in FIELDS)

    # ---------------------------------------------------------------- RELAY OG IS THE CANON BODY
    ui.wear_relay_skin("relay_og")
    yield 1.5
    RESULT["og_costume_actors"] = 0 if costume() is None else 1
    record("A01", "Relay OG wears the canon body, with no costume actor at all",
           costume() is None, costume_actors=RESULT["og_costume_actors"])
    shot("relay_og", "Relay OG standing -- the canon body, the animation authority itself")

    # THE AUTHORITY IS RUNNING. Sampled standing still, because that is the case that was broken.
    og_idle = []
    for _ in range(14):
        yield 0.3
        og_idle.append(read(dog.get_canonical_worn_pose()))
    RESULT["relay_og_idle"] = og_idle
    og_move = max(abs(a["head_pitch_deg"] - b["head_pitch_deg"]) for a in og_idle for b in og_idle)
    og_bob = max(abs(a["bob_uu"] - b["bob_uu"]) for a in og_idle for b in og_idle)
    record("A02", "standing still, Relay OG's own canonical pose is alive",
           (og_move + og_bob) > 0.01, head_swing_deg=round(og_move, 3), bob_swing_uu=round(og_bob, 3))

    # ---------------------------------------------------------------- CELESTIAL LIGHT
    worn = bool(ui.wear_relay_skin("celestial_light"))
    yield 2.0
    skin = costume()
    RESULT["celestial_boxes"] = int(skin.get_box_count()) if skin is not None else 0
    record("A03", "Celestial Light dresses the Dog in a real figure",
           worn and skin is not None and RESULT["celestial_boxes"] > 0,
           worn=worn, boxes=RESULT["celestial_boxes"])
    shot("celestial_light", "Celestial Light standing -- it must idle as Relay OG idles")
    if skin is None:
        RESULT["status"] = "FAIL: Celestial Light did not dress the Dog; nothing below could be measured"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    # ---- THE SAME NUMBERS, not similar ones. Read in the same frame, so any difference is real.
    mismatches = []
    for _ in range(10):
        yield 0.25
        a = read(dog.get_canonical_worn_pose())
        b = read(skin.get_worn_pose())
        for f in FIELDS:
            if abs(a[f] - b[f]) > 0.001:
                mismatches.append({"field": f, "dog": a[f], "skin": b[f]})
    RESULT["field_mismatches"] = mismatches[:20]
    record("A04", "the skin wears the Dog's canonical pose field for field",
           len(mismatches) == 0, mismatched=len(mismatches), fields_checked=len(FIELDS) * 10)

    # ---- THE IDLE, which is the case that was broken: at rest the gait weight is zero and the costume
    # ---- used to be running entirely on its own clock.
    skin_idle = []
    for _ in range(14):
        yield 0.3
        skin_idle.append(read(skin.get_worn_pose()))
    RESULT["celestial_idle"] = skin_idle
    sk_move = max(abs(a["head_pitch_deg"] - b["head_pitch_deg"]) for a in skin_idle for b in skin_idle)
    sk_bob = max(abs(a["bob_uu"] - b["bob_uu"]) for a in skin_idle for b in skin_idle)
    record("A05", "standing still, Celestial Light is driven by the authority rather than frozen",
           (sk_move + sk_bob) > 0.01, head_swing_deg=round(sk_move, 3), bob_swing_uu=round(sk_bob, 3),
           relay_og_was=round(og_move + og_bob, 3))

    # ---------------------------------------------------------------- WALKING
    L.set_key_held("W", True)
    yield 2.0
    walk = read(skin.get_worn_pose())
    RESULT["celestial_walking"] = walk
    shot("celestial_walking", "Celestial Light walking on the Dog's own gait")
    record("A06", "walking, the Dog's gait reaches the skin",
           walk["gait_weight"] > 0.15 and walk["speed_uu"] > 20.0,
           gait_weight=walk["gait_weight"], speed_uu=walk["speed_uu"])

    # ---------------------------------------------------------------- JUMPING -- the channel that never existed
    # THE FIRST VERSION OF THIS PRESSED SPACEBAR AND READ ZERO. That is two different failures wearing one
    # face -- a jump channel that does not work, or a synthetic key that never reached the jump action -- so it
    # now ALSO records whether the Dog actually left the ground. A peak of zero while the movement component
    # never reported falling is a test that did not jump, and must not be reported as a broken channel.
    air = 0.0
    ground_z = float(dog.get_actor_location().z)
    peak_rise = 0.0
    how = "none"
    # DEFENSIVELY, AND MEASURED BY HEIGHT. The first version called dog.jump() and dog.get_character_movement()
    # and an AttributeError killed the whole job at A07, losing the three tests after it -- a proof that cannot
    # survive one missing binding is not a proof. Leaving the ground is read from the actor's own Z, which needs
    # no binding at all, and every way of jumping is tried in turn.
    for attempt in ("jump", "key"):
        try:
            if attempt == "jump":
                dog.call_method("Jump")
                how = "Jump()"
            else:
                L.press_key("SpaceBar", False)
                how = "SpaceBar"
        except Exception as bad:
            RESULT["jump_%s_error" % attempt] = str(bad)[:180]
            continue
        for _ in range(16):
            yield 0.1
            air = max(air, read(skin.get_worn_pose())["airborne_weight"])
            peak_rise = max(peak_rise, float(dog.get_actor_location().z) - ground_z)
        if peak_rise > 5.0:
            break
    L.set_key_held("W", False)
    yield 1.4
    RESULT["celestial_airborne_peak"] = round(air, 3)
    RESULT["dog_rose_uu"] = round(peak_rise, 2)
    RESULT["jump_driven_by"] = how
    left_ground = peak_rise > 5.0
    record("A07", "jumping, the skin is told it is off the ground",
           (air > 0.05) if left_ground else False,
           airborne_peak=round(air, 3), dog_rose_uu=round(peak_rise, 2), driven_by=how,
           note="a zero peak with no rise is a test that never jumped, not a broken channel")

    # ---------------------------------------------------------------- A MISSION ACT
    # Driven through the Dog's own console verb, so the performance is the real one and not a stand-in.
    lift, still = 0.0, 0.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Dog.Act prepare")
    for _ in range(26):
        yield 0.3
        p = read(skin.get_worn_pose())
        lift = max(lift, p["lift_uu"])
        still = max(still, p["stillness"])
    shot("celestial_meditating", "Celestial Light performing PREPARATION -- lifted off the ground, held still")
    RESULT["celestial_lift_uu"] = round(lift, 2)
    RESULT["celestial_stillness"] = round(still, 3)
    record("A08", "a Mission Contract act lifts the skin off the ground, as it lifts Relay OG",
           lift > 5.0, lift_uu=round(lift, 2), stillness=round(still, 3))

    unreal.SystemLibrary.execute_console_command(world, "wl.Dog.Act none")
    yield 1.5
    ui.wear_relay_skin("relay_og")
    yield 1.5
    record("A09", "taking the skin off returns the Dog to its canon body", costume() is None)

    RESULT["shots"] = shots
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
