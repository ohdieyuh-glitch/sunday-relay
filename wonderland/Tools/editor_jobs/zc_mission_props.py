# DOES A COSTUMED DOG STILL CARRY ITS MISSION PROPS?
#
# FOUNDER, P0 item 3: "Same for Mission Contract: start, planning, implementing, verifying, completion,
# PROPS, return to idle... One canonical Relay Dog behavior stack; skins are cosmetic."
#
# THE GAP THIS FILLS. zc_mission_parity walks the whole lifecycle and proves the pose reaches the skin, but
# never counts a prop. The prop jobs -- zc_book_attach, zc_beam_check, zc_book_probe -- all run on the BARE
# Dog and never put a skin on. So the one thing "skins are cosmetic" actually claims about props has never
# been measured: that wearing a costume changes nothing about them.
#
# The runtime intends exactly that. ShowCanonBody(false) hides every body mesh EXCEPT components tagged
# WL_Prop, with the comment "because a costumed Dog still reads". This asks whether that intent survives
# contact with the mission.
#
# MEASURED AS A COMPARISON, NOT A THRESHOLD. The same lifecycle is driven twice -- once bare, once wearing
# Celestial Light -- and the prop counts are held against each other stage by stage. A number I invented for
# "how many props PREPARATION should show" would be worth nothing; the bare Dog's own behaviour is the
# authority, which is what the founder said it is.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "mission_props")

STAGES = ("PREPARATION", "RESEARCH", "IMPLEMENTATION", "VERIFICATION", "REVIEW", "COMPLETED")


def props_on(dog):
    """Visible prop components, by name, so a difference can be pointed at rather than merely counted."""
    seen = []
    for comp in dog.get_components_by_class(unreal.StaticMeshComponent):
        try:
            if not comp.component_has_tag("WL_Prop"):
                continue
        except Exception:
            continue
        if bool(comp.is_visible()):
            seen.append(str(comp.get_name()))
    return sorted(seen)


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
    tasks = L.get_mission_tasks(world)
    yield 0.5

    dogs = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RelayDogCharacter)
    if not dogs:
        RESULT["status"] = "FAIL: no Relay Dog in the world"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    dog = dogs[0]

    def run_lifecycle(label):
        """Drive one whole contract and record which props are up at each stage."""
        tasks.clear_all_tasks_for_development()
        yield 0.6
        tasks.submit_draft(tasks.add_draft(), "Survey the arrival plaza")
        yield 1.4
        seen = {}
        for stage in STAGES:
            unreal.SystemLibrary.execute_console_command(world, "wl.Tasks.Scheduler 0 %s" % stage)
            # SETTLE BEFORE SAMPLING. The first version took the largest prop set across a window that began
            # the instant the stage was requested -- so a sample landing mid-crossfade caught the OUTGOING
            # stage's props beside the incoming ones, and reported a lingering MissionBookTurningPage at
            # IMPLEMENTATION as a difference between the bare and costumed runs. It was a difference between
            # two sampling moments. "Which props belong to this stage" is only a question once the stage has
            # arrived, so the crossfade is waited out and the steady state is what gets recorded.
            for _ in range(10):
                yield 0.25
            best = []
            for _ in range(8):
                yield 0.25
                now = props_on(dog)
                if len(now) > len(best):
                    best = now
            seen[stage] = best
            H.capture_viewport_jpeg(os.path.join(ROOT, "%s_%s.jpg" % (label, stage.lower())), 1400, 86)
        RESULT["%s_props" % label] = seen
        RESULT["%s_idle_after" % label] = props_on(dog)

    # ---------------------------------------------------------------- BARE, which is the authority
    ui.wear_relay_skin("relay_og")
    yield 2.0
    # Informational only, and defensive: WornSkinId is private with a getter, so the property read raises
    # and the exact accessor is not worth risking the whole job on.
    try:
        RESULT["bare_wearing"] = str(dog.get_worn_skin_id())
    except Exception:
        RESULT["bare_wearing"] = "unreadable"
    for step in run_lifecycle("bare"):
        yield step

    # ---------------------------------------------------------------- COSTUMED, which must match it
    ui.wear_relay_skin("celestial_light")
    yield 2.5
    try:
        RESULT["skinned_wearing"] = str(dog.get_worn_skin_id())
    except Exception:
        RESULT["skinned_wearing"] = "unreadable"
    for step in run_lifecycle("skinned"):
        yield step

    bare = RESULT.get("bare_props", {})
    skinned = RESULT.get("skinned_props", {})

    ever_bare = sorted({p for v in bare.values() for p in v})
    ever_skinned = sorted({p for v in skinned.values() for p in v})
    RESULT["props_ever_bare"] = ever_bare
    RESULT["props_ever_skinned"] = ever_skinned

    record("P01", "the bare Dog raises props during its mission at all",
           len(ever_bare) > 0, props=ever_bare,
           note="if this is empty the comparison below proves nothing, so it is asked first")

    differences = []
    for stage in STAGES:
        a, b = bare.get(stage, []), skinned.get(stage, [])
        if a != b:
            differences.append({"stage": stage, "bare": a, "skinned": b})
    RESULT["stage_differences"] = differences

    record("P02", "a costumed Dog raises the same props, stage for stage, as a bare one",
           len(ever_bare) > 0 and not differences,
           differences=differences[:4], stages=len(STAGES),
           note="the bare Dog is the authority; no invented count is used")

    record("P03", "the props come down again when the contract completes",
           not RESULT.get("bare_idle_after") and not RESULT.get("skinned_idle_after"),
           bare_left_up=RESULT.get("bare_idle_after"),
           skinned_left_up=RESULT.get("skinned_idle_after"))

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
