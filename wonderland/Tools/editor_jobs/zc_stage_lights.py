# ARE THE WARDROBE'S OWN STAGE LIGHTS ACTUALLY LIGHTING THE FIGURE?
#
# The preview tracks the world's clock -- Relay OG reads 0.110 luma at noon and 0.036 in the evening -- which
# it should not, because the stage carries a key, a fill and a rim light of its own precisely so that a
# showcase looks like a showcase at any hour. I have now guessed twice at why (once rewriting them into world
# space, which changed nothing and was reverted) and it is time to read the components instead of reasoning
# about them.
#
# Every number that decides whether a point light reaches a surface, asked of the live components while the
# wardrobe is open: where each one is, how far that is from the figure, its intensity, its attenuation
# radius, whether it is visible, and -- the one that scaling breaks -- its component scale.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import unreal

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
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 6.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 0.0")   # midnight: the failing case

    ui = L.get_ui(world)
    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    ui.press_switch_skin()
    yield 4.0
    ui.wear_relay_skin("relay_og")
    yield 6.0

    stage = None
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSkinStage):
        stage = actor
        break
    RESULT["stage_found"] = stage is not None
    record("S00", "the wardrobe's stage actor is in the world", stage is not None)
    if stage is None:
        RESULT["status"] = "FAIL"
        return

    body = None
    try:
        body = stage.get_body()
    except Exception as err:                                       # noqa: BLE001
        RESULT["body_error"] = str(err)[:120]
    at = body.get_actor_location() if body is not None else stage.get_actor_location()
    RESULT["figure_at"] = [round(at.x), round(at.y), round(at.z)]
    try:
        RESULT["figure_scale"] = round(float(body.get_actor_scale3d().z), 4) if body else None
    except Exception:                                              # noqa: BLE001
        RESULT["figure_scale"] = None
    for prop in ("hidden", "actor_hidden_in_game"):
        try:
            RESULT["stage_" + prop] = bool(stage.get_editor_property(prop))
        except Exception as err:                                   # noqa: BLE001
            RESULT["stage_" + prop] = "?" + str(err)[:50]
    # AND WHETHER THE FIGURE ITSELF IS HIDDEN, which would explain everything at once.
    if body is not None:
        for prop in ("hidden", "actor_hidden_in_game"):
            try:
                RESULT["body_" + prop] = bool(body.get_editor_property(prop))
            except Exception as err:                               # noqa: BLE001
                RESULT["body_" + prop] = "?" + str(err)[:50]

    lamps = []
    RESULT["lamps"] = lamps
    for comp in stage.get_components_by_class(unreal.PointLightComponent):
        row = {"name": str(comp.get_name())}
        try:
            where = comp.get_world_location()
            row["at"] = [round(where.x), round(where.y), round(where.z)]
            row["metres_from_figure"] = round(float((where - at).length()) / 100.0, 2)
        except Exception:                                          # noqa: BLE001
            pass
        for prop, key in (("intensity", "candelas"), ("attenuation_radius", "radius_uu"),
                          ("intensity_units", "units")):
            try:
                row[key] = str(comp.get_editor_property(prop))
            except Exception as err:                               # noqa: BLE001
                row[key] = "?" + str(err)[:40]
        try:
            row["visible"] = bool(comp.is_visible())
        except Exception:                                          # noqa: BLE001
            pass
        try:
            sc = comp.get_world_scale3d()
            row["world_scale"] = [round(sc.x, 3), round(sc.y, 3), round(sc.z, 3)]
        except Exception:                                          # noqa: BLE001
            pass
        lamps.append(row)
    emit("S_LAMPS", "INFO", "the stage's three lights, live", {"figure": RESULT["figure_at"], "lamps": lamps})

    record("S01", "all three stage lights were found", len(lamps) >= 3, found=len(lamps), lamps=lamps)
    reaching = [l for l in lamps
                if isinstance(l.get("metres_from_figure"), float)
                and isinstance(l.get("radius_uu"), str)
                and l.get("visible") is True
                and l["metres_from_figure"] * 100.0 < float(l["radius_uu"])]
    RESULT["lights_whose_radius_reaches_the_figure"] = len(reaching)
    record("S02", "at least one stage light's attenuation radius actually reaches the figure",
           len(reaching) > 0, reaching=len(reaching), lamps=lamps,
           note="a point light contributes nothing past its attenuation radius, however many candelas it has. "
                "The stage is scaled to about a ninth to bring the figure to the window, and component scale "
                "scales that radius with it.")

    # ---- AND THE DECISIVE TEST: DOES THE FIGURE RESPOND TO THESE LIGHTS AT ALL?
    #
    # Everything above says they should be flooding it -- visible, 1.1 to 1.4 m away, 26,000 to 90,000
    # intensity, radii of eleven to fourteen metres -- and yet the preview tracks the world's sun. Reasoning
    # has now been wrong twice about this, so the lights are cranked by a factor of fifty at runtime and the
    # window is read before and after. If the picture does not move, these lights are not reaching the figure
    # whatever their numbers say, and the fault is in how it is lit rather than in how bright they are.
    rect = ui.get_skin_preview_rect()
    if rect is not None:
        centre, size = rect

        def middle():
            got = L.read_screen_rect(centre.x - size.x * 0.16, centre.y - size.y * 0.22,
                                     centre.x + size.x * 0.16, centre.y + size.y * 0.22)
            if got is None:
                return None
            m = got[0]
            return round(0.2126 * m.r + 0.7152 * m.g + 0.0722 * m.b, 4)

        yield 2.0
        before = middle()
        was = {}
        for comp in stage.get_components_by_class(unreal.PointLightComponent):
            try:
                was[str(comp.get_name())] = float(comp.get_editor_property("intensity"))
                comp.set_intensity(was[str(comp.get_name())] * 50.0)
            except Exception:                                      # noqa: BLE001
                pass
        yield 3.0
        after = middle()
        for comp in stage.get_components_by_class(unreal.PointLightComponent):
            try:
                comp.set_intensity(was.get(str(comp.get_name()), 90000.0))
            except Exception:                                      # noqa: BLE001
                pass
        RESULT["cranked"] = {"before": before, "after": after, "factor": 50}
        emit("S_CRANK", "INFO", "the window with the stage lights cranked fifty-fold",
             RESULT["cranked"])
        record("S03", "the figure responds to the stage's own lights",
               before is not None and after is not None and after > before * 1.25,
               before=before, after=after, factor=50,
               note="fifty times the light. If the window does not brighten, the stage lights are not lighting "
                    "the figure at all and their intensity was never the question.")

    RESULT["status"] = "measured"
    yield 1.0
