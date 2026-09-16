# PIE job: the top-right mini-map and the AGENT · MISSIONS · BRAIN · COMMANDS · MENU strip, as the founder asked
# to see them (A-F), and the three things a screenshot alone cannot settle:
#
#   MAPPING      a place marker moves across the disc by exactly the Dog's own displacement divided by the map
#                scale, component by component. "The map moved" is true of a map moving the wrong way.
#   ORIENTATION  the drawn arrow and view wedge against the pawn's and the camera's actual yaw, read here in
#                Python rather than from the C++ that drew them.
#   OVERLAP      every HUD piece's laid-out rectangle against every other, in play and with the terminal suite
#                open. Zero-size rectangles are left out and counted, so an empty list cannot pass by accident.
#
# Clicks go through Slate's own hit testing (UWonderlandUiSubsystem::ClickNavButton), not through the handlers.
#
# Rules kept: zc_ prefix, no map edits, never Escape, the command layouts are reset to DEFAULT before and after,
# and it ends its own PIE on every path.
import math
import os

SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc")
L = unreal.WonderlandUiTestLibrary
CANON = "AGENT|MISSIONS|BRAIN|COMMANDS|MENU"
DEFAULT_ROWS = "Gauntlet Loop|Goal Loop|Eval Loop|Unchained"


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests

    def say(line):
        unreal.log_warning("WLHUD %s" % line)

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        say("%s %s %s" % (tid, "PASS" if ok else "FAIL", detail))
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def shot(name):
        path = os.path.join(SHOTS, name)
        ok = L.capture_game_viewport(path)
        return path if (ok is True or (isinstance(ok, tuple) and ok and ok[0])) else None

    def marker(ui, place):
        """(drawn, (x, y)) whichever shape the binding returns."""
        got = ui.get_mini_map_marker_offset(place)
        if isinstance(got, tuple):
            ok, vec = (got[0], got[1]) if len(got) > 1 else (True, got[0])
        else:
            ok, vec = ui.is_mini_map_marker_drawn(place), got
        return bool(ok), (float(vec.x), float(vec.y))

    def screen_angle(yaw):
        r = math.radians(yaw)
        return math.degrees(math.atan2(-math.sin(r), -math.cos(r)))

    def angle_gap(a, b):
        return abs((a - b + 180.0) % 360.0 - 180.0)

    def rects(ui):
        out = {}
        for line in str(ui.describe_hud_rects()).splitlines():
            parts = line.split()
            if len(parts) == 6:
                out[parts[0]] = (float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4]), parts[5] == "1")
        return out

    def overlaps(table):
        shown = [(n, r) for n, r in table.items() if n != "viewport" and r[4] and r[2] > 0 and r[3] > 0]
        hits = []
        for i in range(len(shown)):
            for j in range(i + 1, len(shown)):
                (na, a), (nb, b) = shown[i], shown[j]
                if a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]:
                    hits.append([na, nb])
        view = table.get("viewport")
        outside = []
        if view:
            for n, r in shown:
                if r[0] < -0.5 or r[1] < -0.5 or r[0] + r[2] > view[2] + 0.5 or r[1] + r[3] > view[3] + 0.5:
                    outside.append(n)
        return [n for n, _ in shown], hits, outside

    presets = None
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        controller = unreal.GameplayStatics.get_player_controller(world, 0)
        ui = L.get_ui(world)
        # NOT SubsystemBlueprintLibrary: it is not exposed to Python here, which cost the first run. The presets
        # live on the PIE game instance, so the instance whose outer is that game instance is the one.
        game = unreal.GameplayStatics.get_game_instance(world)
        found = list(unreal.ObjectIterator(unreal.WonderlandCommandPresetSubsystem))
        owned = [x for x in found if x.get_outer() == game]
        presets = owned[0] if owned else (found[-1] if found else None)
        RESULT["presets_found"] = {"instances": len(found), "owned_by_pie": len(owned)}
        live = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.is_mission_strip_on_screen()]
        mission = live[0] if live else None
        for cmd in ("t.MaxFPS 0", "Slate.bAllowThrottling 0", "r.VSync 0"):
            unreal.SystemLibrary.execute_console_command(world, cmd)
        if presets is not None:
            presets.reset_all_layouts()
        L.focus_game_viewport()
        yield 1.5

        # ------------------------------------------------------------ F: the strip reads the canon
        labels = str(ui.get_nav_bar_labels())
        record("H00", "the bottom strip reads AGENT MISSIONS BRAIN COMMANDS MENU, and INVENTORY is gone",
               labels == CANON and "INVENTORY" not in labels.upper() and ui.is_nav_bar_on_screen(),
               labels=labels, on_screen=bool(ui.is_nav_bar_on_screen()))

        # ------------------------------------------------------------ A: standing still
        paints_before = ui.get_mini_map_paint_count()
        yield 1.5
        a_shot = shot("zc_hud_A_standing.png")
        RESULT["standing"] = {
            "world": str(ui.get_mini_map_world_line()), "region": str(ui.get_mini_map_region_line()),
            "captures": ui.get_mini_map_capture_count(), "photo_drawn": bool(ui.did_mini_map_draw_photograph()),
            "camera_in_world": bool(ui.is_mini_map_capture_in_world()),
            "paints": ui.get_mini_map_paint_count() - paints_before, "uu_per_px": round(ui.get_mini_map_uu_per_pixel(), 2),
            "pawn": [round(pawn.get_actor_location().x), round(pawn.get_actor_location().y)], "capture": a_shot,
        }
        s = RESULT["standing"]
        record("H01", "standing still: the map is on screen, photographed, titled, and names a real district",
               ui.is_mini_map_on_screen() and s["world"] == "WONDERLAND" and len(s["region"]) > 0
               and s["captures"] > 0 and s["photo_drawn"] and s["camera_in_world"] and s["paints"] > 5 and a_shot, **s)

        # ------------------------------------------------------------ B: moving, measured as a mapping
        # The nearest offered place with a marker on the disc is the ruler. Its offset from the disc centre is
        # (player - place) / k, so when the Dog walks the marker must move by d_player / k on BOTH axes -- which
        # is the plan's orientation (+Y up, -X right) and its scale checked at once, not just that something moved.
        places = ["arrival", "castle_approach", "royal_gardens", "clock_quarter", "grand_clock", "tea_terraces",
                  "teapot_court", "water_gardens", "gatekeeper_fields", "east_quarter", "the_cloister", "lantern_hamlets",
                  "east_reach", "south_meadows", "west_wood", "far_orchards", "colossal_key"]
        ruler = None
        for p in places:
            drawn, _ = marker(ui, p)
            if drawn:
                ruler = p
                break
        k = ui.get_mini_map_uu_per_pixel()
        start = pawn.get_actor_location()
        _, off0 = marker(ui, ruler) if ruler else (False, (0.0, 0.0))
        caps0 = ui.get_mini_map_capture_count()
        b0 = shot("zc_hud_B_move_0.png")
        controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-12.0, yaw=controller.get_control_rotation().yaw))
        L.set_key_held("W", True)
        yield 2.2
        L.set_key_held("W", False)
        yield 0.6
        end = pawn.get_actor_location()
        drawn1, off1 = marker(ui, ruler) if ruler else (False, (0.0, 0.0))
        b1 = shot("zc_hud_B_move_1.png")
        moved = math.hypot(end.x - start.x, end.y - start.y)
        expect = ((end.x - start.x) / k, (end.y - start.y) / k) if k else (0.0, 0.0)
        got = (off1[0] - off0[0], off1[1] - off0[1])
        err = math.hypot(got[0] - expect[0], got[1] - expect[1])
        RESULT["moving"] = {"ruler": ruler, "moved_uu": round(moved, 1), "expected_px": [round(v, 2) for v in expect],
                            "marker_moved_px": [round(v, 2) for v in got], "error_px": round(err, 2),
                            "captures_during": ui.get_mini_map_capture_count() - caps0, "region_after": str(ui.get_mini_map_region_line()),
                            "frames": [b0, b1]}
        record("H02", "moving: a place marker slides by exactly the Dog's displacement over the map scale",
               ruler is not None and drawn1 and moved > 150.0 and err < 2.0 and RESULT["moving"]["captures_during"] >= 4,
               **RESULT["moving"])

        # ------------------------------------------------------------ C: direction
        turns = []
        for yaw in (0.0, 90.0, 180.0, 270.0):
            controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-12.0, yaw=yaw))
            L.set_key_held("W", True)
            yield 0.9
            L.set_key_held("W", False)
            yield 0.4
            pawn_yaw = pawn.get_actor_rotation().yaw
            cam_yaw = controller.get_control_rotation().yaw
            turns.append({
                "camera_yaw": round(cam_yaw, 1), "pawn_yaw": round(pawn_yaw, 1),
                "view_error_deg": round(angle_gap(ui.get_mini_map_view_angle(), screen_angle(cam_yaw)), 2),
                "arrow_error_deg": round(angle_gap(ui.get_mini_map_arrow_angle(), screen_angle(pawn_yaw)), 2),
                "arrow_drawn_deg": round(ui.get_mini_map_arrow_angle(), 1),
                "capture": shot("zc_hud_C_heading_%d.png" % int(yaw)),
            })
        RESULT["turning"] = turns
        record("H03", "turning: the arrow follows the Dog and the wedge follows the camera, north staying up",
               all(t["view_error_deg"] < 1.0 and t["arrow_error_deg"] < 3.0 for t in turns)
               and len({round(t["arrow_drawn_deg"] / 45.0) for t in turns}) >= 3, turns=turns)

        # ------------------------------------------------------------ overlap, in play
        table = rects(ui)
        names, hits, outside = overlaps(table)
        RESULT["overlap_play"] = {"pieces": names, "overlaps": hits, "outside": outside, "rects": {n: list(r[:4]) for n, r in table.items()}}
        record("H04", "in play the map, the strip, the usage HUD and the mission strip do not touch",
               set(["mini_map", "nav_bar", "usage_hud", "mission_strip"]).issubset(set(names)) and not hits and not outside,
               **RESULT["overlap_play"])

        # ------------------------------------------------------------ D: click BRAIN
        clicked = ui.click_nav_button("brain")
        yield 0.8
        d_shot = shot("zc_hud_D_brain.png")
        record("H05", "clicking BRAIN opens the Project Brain, and the strip steps aside",
               clicked and ui.is_project_brain_open() and not ui.is_nav_bar_on_screen() and d_shot,
               clicked=bool(clicked), brain_open=bool(ui.is_project_brain_open()), strip_on_screen=bool(ui.is_nav_bar_on_screen()),
               clicks=ui.get_nav_click_count("brain"), capture=d_shot)
        ui.close_overlay()
        yield 0.6

        # ------------------------------------------------------------ E: click COMMANDS, and customise
        clicked = ui.click_nav_button("commands")
        yield 0.8
        e_shot = shot("zc_hud_E_commands.png")
        rows_default = str(ui.get_command_station_slot_rows())
        record("H06", "clicking COMMANDS opens the command preset station on the DEFAULT layout",
               clicked and ui.is_command_station_open() and rows_default == DEFAULT_ROWS and e_shot,
               clicked=bool(clicked), open=bool(ui.is_command_station_open()), rows=rows_default, capture=e_shot)

        ui.select_command_slot(0)
        equipped = ui.equip_command_to_selected_slot("unchained")
        yield 0.5
        rows_custom = str(ui.get_command_station_slot_rows())
        e2_shot = shot("zc_hud_E_commands_custom.png")
        swapped = "Unchained|Goal Loop|Eval Loop|Gauntlet Loop"
        withheld = presets.equip_command(1, "stack_up_loop") if presets else None
        record("H07", "equipping swaps rather than duplicates, and a withheld command cannot be equipped",
               equipped and rows_custom == swapped and withheld is False and str(presets.describe_active_layout()) == "unchained|goal_loop|eval_loop|gauntlet_loop",
               rows=rows_custom, layout=str(presets.describe_active_layout()), withheld_refused=(withheld is False), capture=e2_shot)

        # The terminal draws the same layout: open AGENT from the station's own world, read its rows.
        ui.close_overlay()
        yield 0.5
        clicked = ui.click_nav_button("agent")
        yield 0.9
        term_rows = str(ui.get_terminal_command_rows())
        agent_shot = shot("zc_hud_agent_terminal.png")
        table = rects(ui)
        names, hits, outside = overlaps(table)
        RESULT["overlap_terminal"] = {"pieces": names, "overlaps": hits, "outside": outside}
        record("H08", "clicking AGENT raises the terminal suite, which lists the customised preset",
               clicked and ui.is_live_terminal_open() and term_rows == swapped and agent_shot,
               clicked=bool(clicked), terminal_open=bool(ui.is_live_terminal_open()), rows=term_rows, capture=agent_shot)
        record("H09", "with the terminal suite open the map keeps clear of the companion consoles and the strip is gone",
               "mini_map" in names and "nav_bar" not in names and not hits and not outside, **RESULT["overlap_terminal"])
        ui.close_overlay()
        yield 0.5
        if presets is not None:
            presets.restore_defaults()
        yield 0.3
        record("H10", "restore defaults puts the founder's four back, in order",
               presets is not None and str(presets.describe_active_layout()) == "gauntlet_loop|goal_loop|eval_loop|unchained",
               layout=str(presets.describe_active_layout()) if presets else None)

        # ------------------------------------------------------------ MISSIONS and MENU
        clicked_m = ui.click_nav_button("missions")
        yield 0.7
        m_idle = shot("zc_hud_missions_idle.png")
        missions_idle = bool(ui.is_missions_open())
        ui.close_overlay()
        yield 0.3
        if mission is not None:
            mission.set_beat_by_id("mission_start")
            yield 0.6
            mission.set_beat_by_id("coding_agent")
            yield 1.0
        ui.navigate_to("missions")
        yield 0.7
        m_live = shot("zc_hud_missions_running.png")
        ui.close_overlay()
        if mission is not None:
            mission.set_beat_by_id("idle")
        yield 0.5
        clicked_menu = ui.click_nav_button("menu")
        yield 0.7
        menu_shot = shot("zc_hud_menu.png")
        record("H11", "clicking MISSIONS and MENU opens each panel",
               clicked_m and missions_idle and clicked_menu and ui.is_menu_open() and m_idle and m_live and menu_shot,
               missions=bool(clicked_m), menu=bool(clicked_menu), captures=[m_idle, m_live, menu_shot])
        ui.close_overlay()
        yield 0.5

        # ------------------------------------------------------------ the keys
        keyed = {}
        for key, check in (("J", "is_missions_open"), ("C", "is_command_station_open"), ("Tab", "is_menu_open"), ("B", "is_project_brain_open")):
            L.focus_game_viewport()
            yield 0.2
            L.press_key(key, False)
            yield 0.5
            opened = bool(getattr(ui, check)())
            ui.close_overlay()
            yield 0.4
            keyed[key] = opened
        record("H12", "every shortcut key shown on a tile opens its panel", all(keyed.values()), **keyed)

        # ------------------------------------------------------------ cost
        def frame_ms(seconds):
            samples = []
            t = 0.0
            while t < seconds:
                yield 0.05
                samples.append(unreal.GameplayStatics.get_world_delta_seconds(world) * 1000.0)
                t += 0.05
            samples.sort()
            RESULT.setdefault("_ms", []).append(samples[len(samples) // 2] if samples else None)

        L.focus_game_viewport()
        yield from frame_ms(3.0)
        unreal.SystemLibrary.execute_console_command(world, "wl.MiniMap.Capture 0")
        yield 0.5
        yield from frame_ms(3.0)
        unreal.SystemLibrary.execute_console_command(world, "wl.MiniMap.Capture 1")
        on_ms, off_ms = RESULT["_ms"]
        RESULT["cost"] = {"median_frame_ms_with_capture": round(on_ms, 2), "median_frame_ms_without": round(off_ms, 2),
                          "difference_ms": round(on_ms - off_ms, 2)}
        record("H13", "the live photograph costs little", on_ms - off_ms < 2.5, **RESULT["cost"])

        RESULT["passed"] = sum(1 for t in tests if t["pass"])
        RESULT["failed"] = [t["id"] for t in tests if not t["pass"]]
        RESULT["status"] = "done"
    finally:
        try:
            if presets is not None:
                presets.reset_all_layouts()
        except Exception:
            pass
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
            unreal.log_warning("WLHUD play ended")
        except Exception as exc:
            unreal.log_warning("WLHUD could not end play: %s" % exc)
