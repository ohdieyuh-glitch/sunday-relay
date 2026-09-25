# WHAT SHAPE IS A HIT RESULT IN THIS ENGINE'S PYTHON?
#
# Two probes in a row read zero surfaces out of a world that demonstrably has ground in it -- the Dog stands
# on it. The traces were never the problem; unpacking the result was. One probe worked by reading
# hit.to_tuple()[4] and one failed by reading hit.location, so the field layout is worth establishing once
# rather than guessed at a third time.
CONCURRENT = True


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    world = ues.get_game_world() or ues.get_editor_world()
    RESULT["world"] = "game" if ues.get_game_world() is not None else "editor"
    start = unreal.Vector(73075.0, -42191.0, 2500.0)
    end = unreal.Vector(73075.0, -42191.0, -6000.0)
    out = unreal.SystemLibrary.line_trace_single(
        world, start, end, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [],
        unreal.DrawDebugTrace.NONE, True)
    RESULT["returned_type"] = type(out).__name__
    RESULT["is_sequence"] = isinstance(out, (tuple, list))
    hit = out[1] if isinstance(out, (tuple, list)) and len(out) > 1 else out
    RESULT["hit_type"] = type(hit).__name__
    if isinstance(out, (tuple, list)):
        RESULT["sequence"] = [type(x).__name__ for x in out]
    try:
        t = hit.to_tuple()
        RESULT["tuple_len"] = len(t)
        RESULT["tuple_types"] = [type(x).__name__ for x in t]
        RESULT["tuple_preview"] = [str(x)[:60] for x in t]
    except Exception as err:
        RESULT["to_tuple_error"] = str(err)
    for key in ("location", "impact_point", "blocking_hit", "component", "hit_component", "distance"):
        try:
            RESULT["attr_" + key] = str(getattr(hit, key))[:80]
        except Exception as err:
            RESULT["attr_" + key] = "ERR: %s" % str(err)[:70]
        try:
            RESULT["prop_" + key] = str(hit.get_editor_property(key))[:80]
        except Exception as err:
            RESULT["prop_" + key] = "ERR: %s" % str(err)[:70]
    RESULT["status"] = "probed"
    yield 0.1
