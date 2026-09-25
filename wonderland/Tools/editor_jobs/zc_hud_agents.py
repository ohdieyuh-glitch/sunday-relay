# DOES THE HUD SAY WHO IS RUNNING, OR ONLY WHAT KIND OF THING IS?
#
# FOUNDER, P1 item 7: the HUD's rows must read "COMPOUND AGENT: <user-created name>", "SINGLE AGENT:
# <active coding agent>", "LLM COMPANION: <active companion>".
#
# WHY IT IS NOT A SCREENSHOT. The founder's standing rule is that a visual system is not proven by a
# photograph of it, and this is the worst possible case for one: three short strings in a small font over a
# bright world. A capture can be taken of a HUD that is painting the wrong names, or the right names from a
# stale cache, and nobody reading the image would know.
#
# WHY IT IS NOT A SETTINGS READ EITHER. Asking UWonderlandCompanionPreviewSettings what the names are and
# then declaring the HUD correct would test the settings object against itself. The question is whether
# NativePaint puts those names on the screen, and only the paint can answer it.
#
# SO THE PAINT ANSWERS. NativePaint records each row it draws into PaintedAgentRows as "LABEL|Name", from
# the same strings it hands to the glyph run, in the same loop. A row that never painted cannot appear
# there; a name the HUD dropped records as "LABEL|" and is caught by H02 rather than going quietly missing.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "hud_agents")

#: The founder's three rows, in the order they were asked for.
WANT_LABELS = ["COMPOUND AGENT", "SINGLE AGENT", "LLM COMPANION"]

#: Deliberately unlike anything Wonderland ships, so a row showing one of these cannot be a default that
#: happened to match, and cannot be a string baked into the widget.
PROBE = {
    "compound_agent_name": "ZC Compound Vireo",
    "agent_name": "ZC Coding Agent Quill",
    "llm_companion_name": "ZC Companion Marrow",
}


def rows_now(world):
    """Every agent row the usage HUD painted most recently, as (label, name) pairs."""
    # THROUGH THE TEST LIBRARY, because UMG's WidgetBlueprintLibrary has no Python binding in this engine
    # and there is no other way to enumerate live widgets from a job. The rows themselves are still written
    # by NativePaint; the accessor only carries them out.
    painted = list(H.get_painted_agent_rows(world) or [])
    return [(p.split("|", 1)[0], p.split("|", 1)[1] if "|" in p else "") for p in painted]


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
    yield 1.0

    settings_class = unreal.load_class(None, "/Script/Wonderland.WonderlandCompanionPreviewSettings")
    settings = unreal.get_default_object(settings_class)
    # WHAT THE PROJECT SHIPS, kept so the probe can be undone. These are Config properties: leaving test
    # names in them would write this job's fixtures into the founder's HUD.
    shipped = {k: str(settings.get_editor_property(k)) for k in PROBE}
    RESULT["shipped_names"] = shipped

    # ---------------------------------------------------------------- as the project ships
    painted = rows_now(world)
    RESULT["rows_as_shipped"] = ["%s|%s" % (a, b) for a, b in painted]
    H.capture_viewport_jpeg(os.path.join(ROOT, "01_as_shipped.jpg"), 1600, 92)

    record("H00", "the usage HUD is up and painting agent rows", len(painted) > 0,
           rows=len(painted),
           note="read from PaintedAgentRows, which only NativePaint writes")

    labels = [a for a, _ in painted]
    record("H01", "the three rows the founder named are the three rows painted",
           labels == WANT_LABELS, painted=labels, wanted=WANT_LABELS,
           note="order included; the LLM Companion row is gated on bShowLlmCompanionMeter, True in DefaultGame.ini")

    unnamed = [a for a, b in painted if not b.strip()]
    record("H02", "every row says WHO, not only what kind of thing it is",
           len(painted) > 0 and len(unnamed) == 0,
           rows=["%s: %s" % (a, b) for a, b in painted], unnamed=unnamed,
           note="a row whose label painted without a name records as 'LABEL|' and is caught here")

    # ---------------------------------------------------------------- and that it is LIVE
    # The names above could be anything, including strings compiled into the widget. Changing them under a
    # running HUD is the only way to show the rows are actually reading the project's settings each paint.
    for key, value in PROBE.items():
        settings.set_editor_property(key, value)
    yield 1.5
    probed = rows_now(world)
    RESULT["rows_when_renamed"] = ["%s|%s" % (a, b) for a, b in probed]
    H.capture_viewport_jpeg(os.path.join(ROOT, "02_renamed.jpg"), 1600, 92)

    want_probe = [PROBE["compound_agent_name"], PROBE["agent_name"], PROBE["llm_companion_name"]]
    got_probe = [b for _, b in probed]
    record("H03", "rename the three agents and the HUD says the new names",
           got_probe == want_probe, got=got_probe, wanted=want_probe,
           note="names chosen to match nothing Wonderland ships, so a default cannot pass this by accident")

    # ---------------------------------------------------------------- and put the founder's names back
    for key, value in shipped.items():
        settings.set_editor_property(key, value)
    yield 1.5
    restored = rows_now(world)
    RESULT["rows_restored"] = ["%s|%s" % (a, b) for a, b in restored]
    H.capture_viewport_jpeg(os.path.join(ROOT, "03_restored.jpg"), 1600, 92)

    record("H04", "the project's own names come back afterwards",
           [b for _, b in restored] == [shipped["compound_agent_name"], shipped["agent_name"],
                                        shipped["llm_companion_name"]],
           restored=[b for _, b in restored], shipped=shipped,
           note="these are Config properties; a job that left its fixtures in them would edit the product")

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
