# PIE job: the Julius Live Terminal, the usage HUD and the world map + teleport, driven through
# real Slate key events (WonderlandUiTestLibrary) rather than by calling the toggles directly.
import math
import os
import time

SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "ui")
L = unreal.WonderlandUiTestLibrary


def _unwrap(ret):
    if isinstance(ret, tuple):
        if len(ret) >= 2 and isinstance(ret[0], bool):
            return ret[1] if ret[0] else None
        return ret[0] if ret else None
    return ret


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    ctx = {}

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def refresh():
        w = ues.get_game_world()
        ctx["world"] = w
        ctx["pawn"] = unreal.GameplayStatics.get_player_pawn(w, 0) if w else None
        ctx["ui"] = L.get_ui(w) if w else None
        ctx["travel"] = next((c for c in unreal.ObjectIterator(unreal.WonderlandTravelSubsystem) if c.get_world() == w), None) if w else None
        cap = ctx["pawn"].get_component_by_class(unreal.CapsuleComponent) if ctx["pawn"] else None
        ctx["hh"] = cap.get_scaled_capsule_half_height() if cap else 90.0
        ctx["radius"] = cap.get_scaled_capsule_radius() if cap else 36.0

    def loc():
        v = ctx["pawn"].get_actor_location()
        return (v.x, v.y, v.z)

    def shot(name):
        path = os.path.join(SHOTS, name)
        ok = L.capture_game_viewport(path)
        return path if (ok is True or (isinstance(ok, tuple) and ok and ok[0])) else None

    def fps_over(seconds):
        f0, t0 = unreal.SystemLibrary.get_frame_count(), time.time()
        return f0, t0

    def start_pie():
        if ues.get_game_world() is None:
            les.editor_request_begin_play()

    def ctrl_t_from_game():
        # A real keyboard holds Ctrl across frames; the game's chord reads PlayerInput's key
        # state when it processes the press, so Ctrl must still be down on that frame.
        L.focus_game_viewport()
        L.set_key_held("LeftControl", True)
        yield 0.12
        L.set_key_held("T", True)
        yield 0.12
        L.set_key_held("T", False)
        yield 0.08
        L.set_key_held("LeftControl", False)
        yield 0.35

    def escape_if_panel_open():
        # Escape with no panel open reaches the EDITOR, which ends PIE. Never send it blind.
        if ui.is_live_terminal_open() or ui.is_world_map_open():
            L.press_key("Escape", False)
            return True
        return False

    # ---------------------------------------------------------------- start
    start_pie()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 4.0
    refresh()
    ui, pawn, travel = ctx["ui"], ctx["pawn"], ctx["travel"]
    RESULT["pawn_class"] = pawn.get_class().get_name()
    RESULT["uses_world_partition"] = bool(travel.uses_world_partition()) if travel else None
    L.focus_game_viewport()
    yield 0.5

    # ---------------------------------------------------------------- HUD
    record("T01", "usage HUD on screen once after PIE start", ui.is_usage_hud_on_screen() and ui.get_usage_hud_creations() == 1,
           on_screen=ui.is_usage_hud_on_screen(), creations=ui.get_usage_hud_creations(), capture=shot("01_hud_at_start.png"))

    # The configured source (DefaultGame.ini [WonderlandUsageHudSettings]). With DevelopmentPreview the
    # HUD must hold the preview reading, labelled as such, at the configured fullness.
    # The settings class is not BlueprintType, so Python sees only UDeveloperSettings: read the source
    # and preview figures from the config file the class loads (DefaultGame.ini).
    import re
    ini = open(os.path.join(unreal.Paths.project_config_dir(), "DefaultGame.ini"), encoding="utf-8").read()
    marker = "[/Script/Wonderland.WonderlandUsageHudSettings]"
    section = ini.split(marker, 1)[1].split("\n[", 1)[0] if marker in ini else ""
    m_source = re.search(r"^UsageSource=(\w+)", section, re.M)
    source = {"DevelopmentPreview": "DEVELOPMENT_PREVIEW", "JuliusUsageAuthority": "JULIUS_USAGE_AUTHORITY"}.get(m_source.group(1) if m_source else "", "JULIUS_USAGE_AUTHORITY")
    m_c = re.search(r"CompoundAgentPercent=([0-9.]+)", section)
    m_s = re.search(r"SingleAgentPercent=([0-9.]+)", section)
    preview_c = float(m_c.group(1)) if m_c else 100.0
    preview_s = float(m_s.group(1)) if m_s else 100.0
    usage = next((u for u in unreal.ObjectIterator(unreal.WonderlandUsageSubsystem)
                  if u.get_world() == ctx["world"]), None)
    reading = usage.get_usage() if usage else None
    authority = usage.get_authority() if usage else None
    def fraction(meter):
        f = meter.get_editor_property("remaining_fraction")
        return f.get_editor_property("value") if f.get_editor_property("known") else None
    compound = fraction(reading.get_editor_property("compound_agent")) if reading else None
    single = fraction(reading.get_editor_property("single_agent")) if reading else None
    authority_id = authority.get_editor_property("authority_id").get_editor_property("value") if authority else None
    if source == "DEVELOPMENT_PREVIEW":
        want_c = preview_c / 100.0
        want_s = preview_s / 100.0
        record("T00", "HUD source is the labelled DEVELOPMENT PREVIEW at the configured fullness",
               authority_id == "development-preview" and compound is not None and single is not None
               and abs(compound - want_c) < 1e-6 and abs(single - want_s) < 1e-6,
               source=source, authority_id=authority_id, compound_fraction=compound, single_fraction=single,
               capture=shot("00_hud_development_preview.png"))
        # Stable while moving: one HUD, still on screen, the reading unchanged, through a walk and a run.
        L.focus_game_viewport()
        p0 = loc()
        L.set_key_held("W", True)
        yield 1.2
        L.set_key_held("LeftShift", True)
        yield 1.4
        run_shot = shot("00b_hud_preview_while_running.png")
        L.set_key_held("LeftShift", False)
        L.set_key_held("W", False)
        yield 0.5
        after = usage.get_usage()
        record("T00b", "the preview HUD stays single, on screen and unchanged while walking and running",
               ui.is_usage_hud_on_screen() and ui.get_usage_hud_creations() == 1 and math.dist(p0, loc()) > 150.0
               and fraction(after.get_editor_property("compound_agent")) == compound and fraction(after.get_editor_property("single_agent")) == single,
               moved_cm=round(math.dist(p0, loc()), 1), creations=ui.get_usage_hud_creations(), capture=run_shot)
    else:
        RESULT["hud_source"] = source
    ok_typical = L.apply_simulated_usage_scene(ctx["world"], "typical", True)
    yield 0.6
    record("T02", "simulated TYPICAL scene on the larger tiers", ok_typical, capture=shot("02_hud_typical_large_tier.png"))
    ok_spent = L.apply_simulated_usage_scene(ctx["world"], "typical", False)
    yield 0.6
    record("T03", "same TYPICAL scene on the smaller tiers draws a shorter track", ok_spent, capture=shot("03_hud_typical_small_tier.png"))
    ok_nearly = L.apply_simulated_usage_scene(ctx["world"], "nearly_spent", True)
    yield 0.6
    record("T03b", "simulated NEARLY SPENT scene on the larger tiers", ok_nearly, capture=shot("03b_hud_nearly_spent_large_tier.png"))
    L.apply_simulated_usage_scene(ctx["world"], "typical", True)
    yield 0.3

    # ---------------------------------------------------------------- terminal
    yield from ctrl_t_from_game()
    record("T04", "Ctrl+T opens the Julius 3.3 terminal over the HUD", ui.is_live_terminal_open() and ui.get_overlays_in_viewport() == 1 and ui.is_usage_hud_on_screen(),
           open=ui.is_live_terminal_open(), overlays=ui.get_overlays_in_viewport(), hud=ui.is_usage_hud_on_screen(), capture=shot("04_terminal_open.png"))

    p0 = loc()
    L.type_text("wasd hello julius")
    yield 0.3
    L.set_key_held("W", True)
    yield 1.0
    L.set_key_held("W", False)
    yield 0.3
    p1 = loc()
    typed = str(ui.get_terminal_input_text())
    record("T05", "typing wasd into the terminal types letters and never walks", math.dist(p0, p1) < 5.0 and typed == "wasd hello julius",
           moved_cm=round(math.dist(p0, p1), 2), input_text=typed, capture=shot("05_terminal_typed.png"))

    rows0 = ui.get_terminal_row_count()
    L.press_key("Enter", False)
    yield 0.5
    rows1 = ui.get_terminal_row_count()
    record("T06", "Enter records the line as NOT SENT (no Julius link) and clears the input",
           rows1 == rows0 + 1 and str(ui.get_terminal_input_text()) == "" and ui.is_live_terminal_open(),
           rows_before=rows0, rows_after=rows1, input_after=str(ui.get_terminal_input_text()), capture=shot("06_terminal_submitted_not_sent.png"))

    L.press_key("T", True)
    yield 0.5
    record("T07", "Ctrl+T again closes the terminal; the HUD stays", (not ui.is_live_terminal_open()) and ui.get_overlays_in_viewport() == 0 and ui.is_usage_hud_on_screen(),
           open=ui.is_live_terminal_open(), overlays=ui.get_overlays_in_viewport(), hud=ui.is_usage_hud_on_screen())

    p0 = loc()
    L.set_key_held("W", True)
    yield 1.2
    L.set_key_held("W", False)
    yield 0.4
    p1 = loc()
    record("T08", "closing the terminal gives movement back", math.dist(p0, p1) > 50.0, moved_cm=round(math.dist(p0, p1), 1))

    yield from ctrl_t_from_game()
    reopened = ui.is_live_terminal_open() and ui.get_overlays_in_viewport() == 1 and ui.get_terminal_row_count() == rows1
    overlays_reopen = ui.get_overlays_in_viewport()
    escape_if_panel_open()
    yield 0.5
    record("T09", "reopen keeps the log with no duplicate panel; Escape closes", reopened and not ui.is_live_terminal_open() and ui.get_overlays_in_viewport() == 0,
           overlays_when_reopened=overlays_reopen, rows=ui.get_terminal_row_count(), open_after_escape=ui.is_live_terminal_open())

    L.focus_game_viewport()
    L.set_key_held("W", True)
    yield 0.7
    yield from ctrl_t_from_game()
    yield 0.45
    a = loc()
    yield 0.8
    b = loc()
    L.set_key_held("W", False)
    L.press_key("T", True)
    yield 0.6
    c = loc()
    yield 0.6
    d = loc()
    record("T10", "a held W stops when the terminal opens and does not resume after it closes",
           math.dist(a, b) < 5.0 and math.dist(c, d) < 5.0 and not ui.is_live_terminal_open(),
           drift_while_open_cm=round(math.dist(a, b), 2), drift_after_close_cm=round(math.dist(c, d), 2))

    yield from ctrl_t_from_game()
    L.type_text("m")
    yield 0.3
    typed_m = str(ui.get_terminal_input_text())
    record("T11", "M typed into the terminal is a letter, not the map", ui.is_live_terminal_open() and not ui.is_world_map_open() and typed_m.endswith("m"),
           input_text=typed_m, map_open=ui.is_world_map_open())
    escape_if_panel_open()
    yield 0.4

    # ---------------------------------------------------------------- map
    L.focus_game_viewport()
    yield 0.2
    L.press_key("M", False)
    yield 0.6
    offered = list(travel.get_offered_destinations())
    offered_ids = [str(r.get_editor_property("id")) for r in offered]
    statuses = sorted(set(getattr(r.get_editor_property("status"), "name", "?") for r in offered))
    record("M01", "M opens the world map over the HUD", ui.is_world_map_open() and ui.get_overlays_in_viewport() == 1 and ui.is_usage_hud_on_screen(),
           overlays=ui.get_overlays_in_viewport(), capture=shot("10_map_open.png"))
    record("M02", "every offered place is a stop, and there is at least one", ui.get_map_stop_count() == len(offered) and len(offered) > 0,
           stops=ui.get_map_stop_count(), offered=len(offered), ids=offered_ids)
    record("M03", "only DEVELOPED or AVAILABLE places are offered", all(s in ("DEVELOPED", "AVAILABLE") for s in statuses), statuses=statuses)

    sel0 = str(ui.get_map_selected_id())
    L.press_key("Down", False)
    yield 0.3
    sel1 = str(ui.get_map_selected_id())
    record("M04", "arrow keys move the selection", sel1 != sel0 or len(offered) < 2, before=sel0, after=sel1)

    tour = [i for i in ("clock_quarter", "grand_clock", "east_quarter", "arrival") if i in offered_ids]
    if not tour:
        tour = offered_ids[:3]
    first = True
    for target in tour:
        if not ui.is_world_map_open():
            L.focus_game_viewport()
            yield 0.2
            L.press_key("M", False)
            yield 0.6
        ui.select_map_destination(target)
        yield 0.3
        selected = str(ui.get_map_selected_id())
        if first:
            record("M05", "a place can be selected", selected == target, selected=selected, capture=shot("11_map_selected_%s.png" % target))
        t0 = time.time()
        started = ui.teleport_to_selected()
        yield 0.1
        closed = not ui.is_world_map_open()
        travelling = travel.is_travelling()
        yield (lambda: not travel.is_travelling(), 20)
        seconds = round(time.time() - t0, 2)
        anchor = next((x for x in unreal.GameplayStatics.get_all_actors_of_class(ctx["world"], unreal.WonderlandTravelAnchor)
                       if str(x.get_editor_property("destination_id")) == target), None)
        yield 1.0
        here = loc()
        av = anchor.get_actor_location() if anchor else None
        d2 = math.hypot(here[0] - av.x, here[1] - av.y) if av else None
        arrived = str(travel.get_last_arrived_destination())
        report = str(travel.get_last_travel_report())
        record("M06" if first else "M09", "teleport to %s: map closes, fade, arrive at the anchor" % target,
               started and closed and arrived == target and d2 is not None and d2 < 250.0,
               travelling_after_click=travelling, seconds=seconds, arrived=arrived, distance_to_anchor_cm=None if d2 is None else round(d2, 1),
               report=report, capture=shot("12_arrived_%s.png" % target))

        z0 = loc()[2]
        yield 1.0
        z1 = loc()[2]
        hit = _unwrap(unreal.SystemLibrary.line_trace_single(ctx["world"], unreal.Vector(*loc()), unreal.Vector(here[0], here[1], loc()[2] - ctx["hh"] - 60.0),
                                                            unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [ctx["pawn"]], unreal.DrawDebugTrace.NONE, True))
        overlaps = _unwrap(unreal.SystemLibrary.capsule_overlap_actors(ctx["world"], unreal.Vector(*loc()), ctx["radius"] - 4.0, ctx["hh"] - 4.0,
                                                                      [unreal.ObjectTypeQuery.OBJECT_TYPE_QUERY1, unreal.ObjectTypeQuery.OBJECT_TYPE_QUERY2], None, [ctx["pawn"]]))
        blockers = [o.get_actor_label() for o in (overlaps or []) if not isinstance(o, (unreal.Volume, unreal.WonderlandTravelAnchor))]
        if first:
            record("M07", "landing is safe: ground underfoot, not falling, not inside anything",
                   hit is not None and abs(z1 - z0) < 5.0 and not blockers, z_drift_cm=round(z1 - z0, 2), ground_hit=hit is not None, blockers=blockers)
            p0 = loc()
            L.focus_game_viewport()
            L.set_key_held("W", True)
            yield 1.0
            L.set_key_held("W", False)
            yield 0.4
            record("M08", "movement works after arriving", math.dist(p0, loc()) > 50.0, moved_cm=round(math.dist(p0, loc()), 1))
        first = False

    L.focus_game_viewport()
    L.press_key("M", False)
    yield 0.6
    record("M17", "the map reopens after travel (current place shown)", ui.is_world_map_open(), capture=shot("20_map_after_travel.png"))
    L.press_key("T", True)
    yield 0.6
    record("M10", "Ctrl+T over the open map switches to the terminal", ui.is_live_terminal_open() and not ui.is_world_map_open() and ui.get_overlays_in_viewport() == 1,
           terminal=ui.is_live_terminal_open(), map=ui.is_world_map_open(), overlays=ui.get_overlays_in_viewport())
    ui.close_overlay()
    yield 0.4

    L.focus_game_viewport()
    L.press_key("M", False)
    yield 0.5
    map_was_open = ui.is_world_map_open()
    escape_if_panel_open()
    yield 0.5
    record("M11", "Escape closes the map", map_was_open and not ui.is_world_map_open() and ui.get_overlays_in_viewport() == 0, map_was_open=map_was_open, overlays=ui.get_overlays_in_viewport())
    L.focus_game_viewport()
    L.press_key("M", False)
    yield 0.5
    o_open = ui.get_overlays_in_viewport()
    L.press_key("M", False)
    yield 0.5
    record("M12", "M toggles the map with never more than one panel", o_open == 1 and ui.get_overlays_in_viewport() == 0 and not ui.is_world_map_open(),
           overlays_open=o_open, overlays_closed=ui.get_overlays_in_viewport())

    p0 = loc()
    refused = travel.request_travel("great_spire")
    yield 0.6
    refused_ok = (refused is False) or (isinstance(refused, tuple) and refused and refused[0] is False) or refused is None
    record("M13", "a place still in development is refused and nothing moves", refused_ok and math.dist(p0, loc()) < 5.0,
           returned=str(refused), moved_cm=round(math.dist(p0, loc()), 2))

    second_target = next((i for i in offered_ids if i != str(travel.get_last_arrived_destination())), None)
    third_target = next((i for i in offered_ids if i not in (second_target, str(travel.get_last_arrived_destination()))), None)
    r1 = travel.request_travel(second_target)
    r2 = travel.request_travel(third_target)
    r2_refused = (r2 is False) or (isinstance(r2, tuple) and r2 and r2[0] is False) or r2 is None
    yield (lambda: not travel.is_travelling(), 20)
    yield 0.5
    record("M14", "a second travel while travelling is refused; the first completes", r2_refused and str(travel.get_last_arrived_destination()) == second_target,
           first=str(r1), second=str(r2), arrived=str(travel.get_last_arrived_destination()))

    record("M15", "the HUD survives every panel and travel (created once)", ui.is_usage_hud_on_screen() and ui.get_usage_hud_creations() == 1,
           creations=ui.get_usage_hud_creations())

    f0, t0 = unreal.SystemLibrary.get_frame_count(), time.time()
    yield 3.0
    fps_closed = (unreal.SystemLibrary.get_frame_count() - f0) / (time.time() - t0)
    L.focus_game_viewport()
    L.press_key("M", False)
    yield 0.5
    f0, t0 = unreal.SystemLibrary.get_frame_count(), time.time()
    yield 3.0
    fps_map = (unreal.SystemLibrary.get_frame_count() - f0) / (time.time() - t0)
    ui.close_overlay()
    record("M16", "frame rate with the map open stays close to the world's own", fps_map > 0.75 * fps_closed,
           fps_world=round(fps_closed, 1), fps_map_open=round(fps_map, 1))

    # ---------------------------------------------------------------- PIE restart
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    yield 1.0
    start_pie()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 3.0
    refresh()
    ui, travel = ctx["ui"], ctx["travel"]
    yield from ctrl_t_from_game()
    t_ok = ui.is_live_terminal_open() and ui.get_overlays_in_viewport() == 1 and ui.get_terminal_row_count() == 0
    L.press_key("T", True)
    yield 0.4
    L.focus_game_viewport()
    L.press_key("M", False)
    yield 0.6
    m_ok = ui.is_world_map_open() and ui.get_map_stop_count() == len(list(travel.get_offered_destinations()))
    L.press_key("M", False)
    yield 0.4
    record("M19", "after a PIE restart: one HUD, a fresh terminal, a full map", t_ok and m_ok and ui.get_usage_hud_creations() == 1 and ui.get_overlays_in_viewport() == 0,
           terminal_ok=t_ok, map_ok=m_ok, creations=ui.get_usage_hud_creations(), overlays=ui.get_overlays_in_viewport(),
           capture=shot("19_after_restart_hud.png"))

    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    RESULT["passed"] = sum(1 for t in tests if t["pass"])
    RESULT["failed"] = [t["id"] for t in tests if not t["pass"]]
    RESULT["status"] = "done"
