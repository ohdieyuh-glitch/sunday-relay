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

    # ---- 2. IS THERE A ROUTE TO A WORLD SUBSYSTEM AT ALL?
    have_lib = hasattr(unreal, "SubsystemBlueprintLibrary")
    have_get = have_lib and hasattr(unreal.SubsystemBlueprintLibrary, "get_world_subsystem")
    routes = sorted(n for n in (dir(unreal.SubsystemBlueprintLibrary) if have_lib else [])
                    if "subsystem" in n.lower())
    record("S2_ROUTE", "SubsystemBlueprintLibrary offers a world-subsystem getter",
           have_lib and have_get, library=have_lib, getter=have_get, getters_available=routes)

    # ---- 3. DOES IT RETURN ANYTHING FOR THIS WORLD?
    got, err = None, None
    if have_get and have_pl:
        try:
            got = unreal.SubsystemBlueprintLibrary.get_world_subsystem(
                world, unreal.WonderlandPracticalLightsSubsystem)
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
    if have_get and have_dc:
        try:
            dgot = unreal.SubsystemBlueprintLibrary.get_world_subsystem(
                world, unreal.WonderlandDayCycleSubsystem)
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
