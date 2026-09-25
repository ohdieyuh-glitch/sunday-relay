# DO THE MASCOT COLOURS ACTUALLY REACH ALL THREE PLACES THE FOUNDER NAMED?
#
# FOUNDER, P1 item 6: "Mascot colors: PRIMARY = main/full mascot colorway. SECONDARY = Relay Dog eyes.
# Persist/apply to world, Wardrobe, missions."
#
# THREE SURFACES, AND THE EXISTING PROOF PHOTOGRAPHS TWO. zc_mascot_style sets a colourway, opens the
# Wardrobe and takes pictures, which is a fair verdict on how it LOOKS but says nothing about whether the
# colour is on the world Dog, or whether it survives a mission. A photograph of a blue dog cannot tell you
# that the eyes took the secondary, because the eyes are four pixels.
#
# So this READS THE COLOUR BACK off the material instances the runtime actually painted.
# ARelayDogCharacter::PaintCanonBody walks every StaticMeshComponent that is not tagged WL_Prop, decides
# eye-or-body by name (eye / visor / pupil), and writes the colour into the MID under five parameter names.
# Reading any one of them back is reading what the renderer will use.
#
# THE COLOURS ARE DELIBERATELY UGLY. A primary of pure magenta and a secondary of pure green are values no
# palette in Wonderland contains, so a component that reads back as either of them got there from the
# setting rather than from a material that happened to look right.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "mascot_persist")

PRIMARY = (1.0, 0.0, 1.0)      # magenta
SECONDARY = (0.0, 1.0, 0.0)    # green
NEAR = 0.08                    # a channel is "the chosen colour" within this


def close_enough(got, want):
    return all(abs(float(got[i]) - float(want[i])) <= NEAR for i in range(3))


def read_dog(world):
    """Every painted component on the Dog, bucketed into eyes and body by the runtime's own rule."""
    out = {"body_on_primary": 0, "body_off": 0, "eyes_on_secondary": 0, "eyes_off": 0,
           "components": 0, "samples": []}
    dogs = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RelayDogCharacter)
    if not dogs:
        return out
    dog = dogs[0]
    for comp in dog.get_components_by_class(unreal.StaticMeshComponent):
        name = str(comp.get_name())
        if comp.component_has_tag("WL_Prop"):
            continue
        is_eye = any(w in name.lower() for w in ("eye", "visor", "pupil"))
        for slot in range(comp.get_num_materials()):
            mat = comp.get_material(slot)
            if mat is None or not isinstance(mat, unreal.MaterialInstanceDynamic):
                continue
            out["components"] += 1
            try:
                got = mat.get_vector_parameter_value("Color")
            except Exception:
                continue
            rgb = (got.r, got.g, got.b)
            want = SECONDARY if is_eye else PRIMARY
            ok = close_enough(rgb, want)
            if is_eye:
                out["eyes_on_secondary" if ok else "eyes_off"] += 1
            else:
                out["body_on_primary" if ok else "body_off"] += 1
            if len(out["samples"]) < 8:
                out["samples"].append({"comp": name, "eye": is_eye,
                                       "rgb": [round(rgb[0], 3), round(rgb[1], 3), round(rgb[2], 3)],
                                       "matches": ok})
    return out


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

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    ui = L.get_ui(world)
    yield 0.5

    # ---- CHOOSE THE COLOURWAY through the founder's own console commands, not a back door.
    unreal.SystemLibrary.execute_console_command(world, "wl.Mascot.Primary 1,0,1")
    yield 1.2
    unreal.SystemLibrary.execute_console_command(world, "wl.Mascot.Secondary 0,1,0")
    yield 2.0

    # ---- 1. THE WORLD.
    world_read = read_dog(world)
    RESULT["in_world"] = world_read
    H.capture_viewport_jpeg(os.path.join(ROOT, "01_world.jpg"), 1600, 90)
    record("M01", "the world Dog wears the chosen PRIMARY on its body",
           world_read["body_on_primary"] > 0 and world_read["body_off"] == 0,
           on=world_read["body_on_primary"], off=world_read["body_off"])
    record("M02", "the world Dog wears the chosen SECONDARY on its eyes",
           world_read["eyes_on_secondary"] > 0 and world_read["eyes_off"] == 0,
           on=world_read["eyes_on_secondary"], off=world_read["eyes_off"],
           note="eyes are matched by the runtime's own rule: eye / visor / pupil")

    # ---- 2. THE WARDROBE. Project Brain open, wardrobe open, and the colour still on.
    L.press_key("B", False)
    waited = 0.0
    while waited < 6.0 and not bool(ui.is_project_brain_open()):
        yield 0.25
        waited += 0.25
    ui.set_brain_skins_open(True)
    yield 2.0
    RESULT["wardrobe_open"] = bool(ui.is_project_brain_open())
    wardrobe_read = read_dog(world)
    RESULT["in_wardrobe"] = wardrobe_read
    H.capture_viewport_jpeg(os.path.join(ROOT, "02_wardrobe.jpg"), 1600, 90)
    record("M03", "the colourway is still on while the Wardrobe is open",
           wardrobe_read["body_on_primary"] > 0 and wardrobe_read["body_off"] == 0,
           on=wardrobe_read["body_on_primary"], off=wardrobe_read["body_off"])
    L.press_key("Escape", False)
    yield 1.0
    L.press_key("Escape", False)
    yield 1.5

    # ---- 3. A MISSION. The Dog acts; the colourway must not be repainted away by the act system.
    # Driven the way zc_mission_parity drives one, because nothing in the engine advances a contract on its
    # own and a terminal line would only queue it.
    tasks = L.get_mission_tasks(world)
    tasks.clear_all_tasks_for_development()
    yield 0.5
    tasks.submit_draft(tasks.add_draft(), "Survey the arrival plaza")
    yield 1.5
    RESULT["contracts"] = len(tasks.get_task_list())
    # wl.Tasks.Scheduler is the console verb zc_mission_parity uses: ApplySchedulerState is the only path
    # that advances a contract, and the code refuses on purpose to pretend Julius said so.
    for stage in ("PREPARATION", "RESEARCH", "IMPLEMENTATION", "VERIFICATION"):
        unreal.SystemLibrary.execute_console_command(world, "wl.Tasks.Scheduler 0 %s" % stage)
        yield 1.4
    yield 1.5
    mission_read = read_dog(world)
    RESULT["in_mission"] = mission_read
    H.capture_viewport_jpeg(os.path.join(ROOT, "03_mission.jpg"), 1600, 90)
    record("M04", "the colourway survives a Mission Contract",
           mission_read["body_on_primary"] > 0 and mission_read["body_off"] == 0,
           on=mission_read["body_on_primary"], off=mission_read["body_off"])

    # ---- 4. AND RESET, so the map is left as it was found.
    unreal.SystemLibrary.execute_console_command(world, "wl.Mascot.Reset")
    yield 2.0
    after = read_dog(world)
    RESULT["after_reset"] = after
    H.capture_viewport_jpeg(os.path.join(ROOT, "04_reset.jpg"), 1600, 90)
    record("M05", "reset takes the chosen colourway off again",
           after["body_on_primary"] == 0,
           still_on=after["body_on_primary"], components=after["components"])

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
