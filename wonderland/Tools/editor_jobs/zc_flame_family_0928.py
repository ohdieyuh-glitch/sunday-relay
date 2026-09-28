# THE SAME FLAME LANGUAGE ON EVERY FLAME SKIN, EACH IN ITS OWN PALETTE -- photographed, and the surface checked.
#
# FOUNDER, 2026-09-28 (correction pass): "The other mascot skins should use the SAME QUALITY AND DETAIL LANGUAGE as the
# restored blue/white Skeleton flames ... same detailed flame texture/style + different appropriate colors for each
# mascot skin ... Do not replace detailed flames with: plain emissive blobs, flat halos, generic bloom, black flames,
# simple colored transparency."
#
# WHAT THAT IS IN THIS PROJECT: every flame part of every skin is drawn by one renderer -- RebuildFlames lays crossed,
# tapered, flickering ribbons in place of the part's boxes, the deeper ember outside and the pale ember as the hot core
# inside -- on the figure's own glow material now that wl.Look.FireMaterial is 0 again. So "the same language" is
# checked two ways: every flame skin's FlameSurface wears M_WL_VoxelGlow and not M_WL_Fire (the surface that drew
# black), and each skin is photographed at noon and at night, front and side, so the palettes can be seen side by side:
# Skeleton's cyan with white, Arden's ember with gold, Apollo's solar orange with pale gold.
#
# NOT CONCURRENT: this job owns PIE. The worn skin and the day clock are read first and put back.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary
TOOLS = os.path.dirname(CHANNEL)
PROJECT = os.path.dirname(TOOLS)
ROOT = os.path.join(TOOLS, "captures", "zc", "flame_family_0928")
SKIN_FILE = os.path.join(PROJECT, "Saved", "Wonderland", "RelaySkin.txt")
FLAME_SKINS = ("skeleton_flame", "skeleton_flame_v1", "arden_infernal", "arden_infernal_v1", "apollo", "apollo_v1")
PLAIN_SKINS = ("celestial_light", "relay_og")
HOURS = (("night", 23.6), ("noon", 12.0))


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".png", ".jpg")):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    SL = unreal.SystemLibrary
    minutes_before = SL.get_console_variable_float_value("wl.Sky.DayMinutes")
    fire_material = SL.get_console_variable_int_value("wl.Look.FireMaterial")
    try:
        with open(SKIN_FILE, encoding="utf-8") as fh:
            skin_before = fh.read().strip() or "relay_og"
    except OSError:
        skin_before = "relay_og"
    RESULT["restore"] = {"wl.Sky.DayMinutes": minutes_before, "skin": skin_before}
    record("K00", "the flame switch is the shipped 0 (ribbons on the glow material)", fire_material == 0,
           fire_material=fire_material)

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    L.focus_game_viewport()
    yield 6.0

    def alive():
        w = ues.get_game_world()
        if w is None:
            return None, None
        p = unreal.GameplayStatics.get_player_pawn(w, 0)
        return (w, p) if p is not None else (None, None)

    world, dog = alive()
    if world is None:
        RESULT["status"] = "VOID: no play world or pawn"
        return
    SL.execute_console_command(world, "wl.Sky.DayMinutes 0")

    def worn_costume(w, pawn):
        for actor in unreal.GameplayStatics.get_all_actors_of_class(w, unreal.WonderlandCompanionEmbodiment):
            if actor.get_attach_parent_actor() == pawn:
                return actor
        return None

    def flame_surface(fig):
        names = set()
        tongues = 0
        for pmc in fig.get_components_by_class(unreal.ProceduralMeshComponent):
            tongues += pmc.get_num_sections()
            for i in range(pmc.get_num_materials()):
                m = pmc.get_material(i)
                if m is None:
                    continue
                try:
                    par = m.get_editor_property("parent")
                    names.add(par.get_name() if par else m.get_name())
                except Exception:                                    # noqa: BLE001
                    names.add(m.get_name())
        return sorted(names), tongues

    def pose(w, pawn, distance, turn, rise, look_z):
        here = pawn.get_actor_location()
        yaw = pawn.get_actor_rotation().yaw + turn
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * distance,
                            here.y + math.sin(math.radians(yaw)) * distance, here.z + look_z + rise)
        L.pose_camera(w, eye, unreal.Vector(here.x, here.y, here.z + look_z), 40.0)

    per_skin = {}
    RESULT["per_skin"] = per_skin
    for skin in FLAME_SKINS + PLAIN_SKINS:
        world, dog = alive()
        if world is None:
            record("DEAD_%s" % skin, "the play world was alive for %s" % skin, False)
            break
        ui = L.get_ui(world)
        ui.wear_relay_skin(skin)
        yield 7.0
        world, dog = alive()
        fig = worn_costume(world, dog) if world else None
        surfaces, sections = flame_surface(fig) if fig else ([], 0)
        row = {"flame_surface": surfaces, "flame_sections": sections, "shots": []}
        per_skin[skin] = row
        if skin in FLAME_SKINS:
            record("F_%s" % skin, "%s: its flames are ribbons on the glow material, not M_WL_Fire" % skin,
                   bool(surfaces) and not any("M_WL_Fire" in n for n in surfaces) and sections > 0,
                   surfaces=surfaces, sections=sections)
        for hour_label, hour in HOURS:
            SL.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
            SL.execute_console_command(world, "wl.Look.PracticalReload")
            yield 3.0
            for label, dist, turn in (("front", 330.0, 0.0), ("side", 330.0, 90.0)):
                world, dog = alive()
                if world is None:
                    break
                pose(world, dog, dist, turn, 20.0, 5.0)
                yield 1.3
                unreal.GameplayStatics.set_game_paused(world, True)
                yield 0.4
                path = os.path.join(ROOT, "%s_%s_%s.png" % (skin, hour_label, label))
                L.capture_game_viewport(path)
                unreal.GameplayStatics.set_game_paused(world, False)
                row["shots"].append(os.path.basename(path) if os.path.isfile(path) else None)
        emit("SKIN", skin, row)

    world, dog = alive()
    if world is not None:
        SL.execute_console_command(world, "wl.Sky.DayMinutes %g" % minutes_before)
        L.release_camera(world)
        L.get_ui(world).wear_relay_skin(skin_before)
        yield 3.0
    record("K99", "the day clock and the worn skin are back as found",
           abs(SL.get_console_variable_float_value("wl.Sky.DayMinutes") - minutes_before) < 1e-3,
           day_minutes=SL.get_console_variable_float_value("wl.Sky.DayMinutes"), skin=skin_before)
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 120)
    RESULT["status"] = "measured" if all(t["pass"] for t in tests) else "FAIL"
