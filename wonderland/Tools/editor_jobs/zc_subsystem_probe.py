# WHY CAN PYTHON NOT REACH THE SUBSYSTEMS? Asked one step at a time instead of guessed at a fourth time.
#
# Three attempts to read Nightfall or ActiveCount through a subsystem have returned nothing. The third
# was after d9317674 added BlueprintType to both classes, which I was confident was the root cause and
# which is compiled into this build -- so the confident explanation is wrong, or incomplete, and the
# honest next step is to find out WHERE the chain breaks rather than to try a fourth spelling.
#
# My describe() helper wraps the whole chain in one try/except and returns None, which is exactly why I
# cannot tell a missing class from a missing method from a subsystem that simply is not there. A helper
# that collapses four failure modes into one None is the same defect as a gate that cannot tell a dead
# subject from an empty sample.
#
# So this reports each link separately, with the exception text where there is one:
#   1. does the Python binding know the class at all
#   2. does SubsystemBlueprintLibrary exist and does get_world_subsystem exist on it
#   3. does get_world_subsystem return an object for this world
#   4. does that object carry the methods the headers declare
#   5. what does calling them actually produce
#
# Read-only apart from needing PIE for a world subsystem to exist. Changes nothing, saves nothing.
import os

L = unreal.WonderlandUiTestLibrary


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()

    # ---- 1. DOES THE BINDING KNOW THE CLASSES?
    known = sorted(n for n in dir(unreal) if "Wonderland" in n)
    RESULT["wonderland_symbols"] = known
    have_pl = hasattr(unreal, "WonderlandPracticalLightsSubsystem")
    have_dc = hasattr(unreal, "WonderlandDayCycleSubsystem")
    record("S1_CLASS", "the Python binding knows both subsystem classes",
           have_pl and have_dc,
           practical_lights=have_pl, day_cycle=have_dc,
           wonderland_symbols_found=len(known), symbols=known[:40],
           note="BlueprintType was added at d9317674 and is in this build. If these are still missing "
                "the specifier was not the whole story and the class is excluded some other way")

    # ---- 2. WHAT ROUTES EXIST AT ALL? ENUMERATED, NOT GUESSED.
    #
    # The first version of this probe tested ONE hypothesis -- does SubsystemBlueprintLibrary have
    # get_world_subsystem -- and answered "no", which is true and tells you nothing about what to use
    # instead. Testing a guess is not the same as enumerating the space, and that is the third time
    # today I have done the narrow one. This lists every route the binding actually offers.
    mod_routes = sorted(n for n in dir(unreal) if "subsystem" in n.lower() and not n[0].isupper())
    world_routes = sorted(n for n in dir(world) if "subsystem" in n.lower())
    lib_classes = sorted(n for n in dir(unreal) if "Subsystem" in n and "Library" in n)
    have_lib = hasattr(unreal, "SubsystemBlueprintLibrary")
    record("S2_ROUTE", "the binding offers at least one way to reach a world subsystem",
           bool(mod_routes or world_routes),
           module_level_getters=mod_routes, world_object_methods=world_routes,
           subsystem_libraries=lib_classes, SubsystemBlueprintLibrary_exists=have_lib,
           note="enumerated rather than guessed. Three earlier jobs tried world.get_subsystem, "
                "unreal.get_world_subsystem and an actor iteration and all three returned None, so the "
                "answer is whichever of these names actually exists in THIS binding")

    # ---- 2b. TRY EVERY ENUMERATED ROUTE AND SAY WHICH ONE ANSWERS.
    attempts = []
    for label, fn in (
            ("unreal.get_world_subsystem",
             lambda: unreal.get_world_subsystem(unreal.WonderlandPracticalLightsSubsystem)),
            ("world.get_subsystem",
             lambda: world.get_subsystem(unreal.WonderlandPracticalLightsSubsystem)),
            ("unreal.get_engine_subsystem",
             lambda: unreal.get_engine_subsystem(unreal.WonderlandPracticalLightsSubsystem)),
            ("unreal.get_editor_subsystem",
             lambda: unreal.get_editor_subsystem(unreal.WonderlandPracticalLightsSubsystem))):
        try:
            got_it = fn()
            attempts.append({"route": label, "returned": str(got_it)[:90] if got_it else None,
                             "error": None})
        except Exception as bad:                                      # noqa: BLE001
            attempts.append({"route": label, "returned": None,
                             "error": "%s: %s" % (type(bad).__name__, str(bad)[:140])})
    worked = [a["route"] for a in attempts if a["returned"]]
    record("S2B_TRY", "at least one enumerated route returns the subsystem",
           bool(worked), attempts=attempts, worked=worked,
           note="each route reported SEPARATELY with its own exception text, because a helper that "
                "collapses four failure modes into one None is why three attempts told me nothing")

    # ---- 3. DOES IT RETURN ANYTHING FOR THIS WORLD?
    got, err = None, None
    for a, (label, fn) in zip(attempts, (
            ("unreal.get_world_subsystem",
             lambda: unreal.get_world_subsystem(unreal.WonderlandPracticalLightsSubsystem)),
            ("world.get_subsystem",
             lambda: world.get_subsystem(unreal.WonderlandPracticalLightsSubsystem)),
            ("unreal.get_engine_subsystem",
             lambda: unreal.get_engine_subsystem(unreal.WonderlandPracticalLightsSubsystem)),
            ("unreal.get_editor_subsystem",
             lambda: unreal.get_editor_subsystem(unreal.WonderlandPracticalLightsSubsystem)))):
        if not a["returned"]:
            continue
        try:
            got = fn()
            RESULT["route_used"] = label
            break
        except Exception as bad:                                       # noqa: BLE001
            err = "%s: %s" % (type(bad).__name__, str(bad)[:300])
    record("S3_FETCH", "get_world_subsystem returns the practical lights subsystem for this world",
           got is not None, returned=str(got)[:120] if got is not None else None, error=err,
           world=str(world)[:80],
           note="a None with no exception means the subsystem is not registered for this world or the "
                "class object did not match; an exception names the real problem")

    # ---- 4. WHAT DOES THE RETURNED OBJECT ACTUALLY CARRY?
    methods = sorted(n for n in (dir(got) if got is not None else []) if not n.startswith("_"))
    record("S4_METHODS", "the object carries the BlueprintPure methods the headers declare",
           got is not None and "describe_practicals" in methods,
           has_describe=("describe_practicals" in methods),
           method_count=len(methods), methods=methods[:60])

    # ---- 5. AND WHAT DOES CALLING IT PRODUCE?
    said, call_err = None, None
    if got is not None and "describe_practicals" in methods:
        try:
            said = str(got.describe_practicals())
        except Exception as bad:                                       # noqa: BLE001
            call_err = "%s: %s" % (type(bad).__name__, str(bad)[:300])
    record("S5_CALL", "describe_practicals returns the engine's own account",
           bool(said) and "active=" in (said or ""), said=said, error=call_err,
           note="this is the string the light-budget question needs: defined, ACTIVE, pool, night, gain, "
                "count and radius, none of which has to be inferred from counting actors")

    # ---- AND THE SAME FOR THE DAY CYCLE, since Nightfall has the identical history.
    dgot, derr = None, None
    for label, fn in (("unreal.get_world_subsystem",
                       lambda: unreal.get_world_subsystem(unreal.WonderlandDayCycleSubsystem)),
                      ("world.get_subsystem",
                       lambda: world.get_subsystem(unreal.WonderlandDayCycleSubsystem))):
        try:
            dgot = fn()
            if dgot is not None:
                break
        except Exception as bad:                                       # noqa: BLE001
            derr = "%s: %s" % (type(bad).__name__, str(bad)[:300])
    night = None
    if dgot is not None:
        try:
            night = float(dgot.get_night_amount())
        except Exception as bad:                                       # noqa: BLE001
            derr = "%s: %s" % (type(bad).__name__, str(bad)[:300])
    record("S6_NIGHT", "GetNightAmount is reachable and returns Nightfall",
           night is not None, nightfall=night, error=derr,
           day_cycle_methods=sorted(n for n in (dir(dgot) if dgot is not None else [])
                                    if not n.startswith("_"))[:40])

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
