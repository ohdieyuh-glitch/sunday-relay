# SECOND SWEEP -- THE EXPOSURE, NOT THE LAMPS.
#
# The first sweep (zc_stage_tune) showed the lamps are not the lever: 0.016 to 0.040 moved a bone body's mean
# from 0.862 to 0.879, because a RIM surface lights itself at strength 1 and the stage's manual exposure
# (bias 0) renders that at 0.86. On the same exposure a glow of 2 pins, where the world pins near 25 -- the
# stage is about three and a half stops more open than the world. So this sweeps wl.Look.PreviewExposure,
# the manual bias in EV, at two glow levels, and the same three questions are asked of every frame.
# THE WARDROBE STAGE WAS TUNED FOR EMISSIVES EIGHT HUNDRED TIMES OVER WHITE. NOW THEY ARE UNDER IT.
#
# wl.Look.PreviewGlow is 0.0015 because that is what took a 1,242-strength glow down to about 1.9 on the stage.
# After the generator's re-baseline (GLOW_SCALE 4000 -> 6) the same materials arrive at 3 to 13, so 0.0015 puts
# every glowing surface at about 0.01 -- black. The first six-view sheet after the re-baseline shows exactly
# that: Apollo's crown of fire absent, every skin's eyes a dull square, and at the same time the cream and gold
# RIM surfaces pinned white (Apollo 56-64% of its pixels at or over 245), because wl.Look.PreviewLights 0.040
# was chosen to hold a bone body at a luma the linen and gold now exceed.
#
# Both are live console variables re-applied every tick, so they are SWEPT here rather than guessed, on the
# stage's own render target, and the defaults are baked into WonderlandSkinStage.cpp afterwards from what this
# measures. Per skin per setting: how much of the figure is pinned, its mean luma, and whether the glow is
# visible at all (the brightest tenth of the figure carrying the skin's own glow colour rather than white).
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import os
import sys
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "stage_tune2")
SKINS = (("relay_og", None), ("apollo", "warm"), ("skeleton_flame", "cyan"), ("celestial_light", "cyan"), ("arden_infernal", "warm"))
GLOWS = (0.35, 1.0)
LIGHTS = (0.0, -1.5, -3.0, -4.5)   # here: wl.Look.PreviewExposure (EV bias), lamps held at 0.026
STEP = 3


def stats(path, hue):
    sys.path.insert(0, os.path.dirname(CHANNEL))
    from occupancy import read_png                                  # noqa: WPS433
    w, h, chan, px = read_png(path)
    lum = []
    hot = []
    for y in range(0, h, STEP):
        row = y * w * chan
        for x in range(0, w, STEP):
            i = row + x * chan
            r, g, b = px[i], px[i + 1], px[i + 2]
            lv = 0.2126 * r + 0.7152 * g + 0.0722 * b
            if lv > 34:
                lum.append(lv)
                hot.append((lv, r, g, b))
    if not lum:
        return {"subject_px": 0}
    lum.sort()
    hot.sort(key=lambda t: -t[0])
    top = hot[:max(1, len(hot) // 10)]
    tr = sum(t[1] for t in top) / len(top)
    tg = sum(t[2] for t in top) / len(top)
    tb = sum(t[3] for t in top) / len(top)
    if hue == "cyan":
        colour = ((tg + tb) * 0.5 - tr) / 255.0
    elif hue == "warm":
        colour = (tr - tb) / 255.0
    else:
        colour = 0.0
    return {"subject_px": len(lum), "mean": round(sum(lum) / len(lum) / 255.0, 3),
            "pinned": round(sum(1 for v in lum if v >= 245.0) / float(len(lum)), 3),
            "top_decile_luma": round(sum(t[0] for t in top) / len(top) / 255.0, 3),
            "top_decile_colour": round(colour, 3)}


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

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
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewLights 0.026")
    ui = L.get_ui(world)
    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    ui.press_switch_skin()
    yield 4.0
    stage = None
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSkinStage):
        stage = actor
        break
    if stage is None:
        tests.append({"id": "T00", "name": "the stage exists", "pass": False, "detail": {}})
        RESULT["status"] = "FAIL"
        return
    target = stage.get_render_target()

    table = {}
    RESULT["table"] = table
    for skin, hue in SKINS:
        ui.wear_relay_skin(skin)
        yield 6.0
        try:
            stage.set_inspection_yaw(0.0)
        except Exception:                                          # noqa: BLE001
            pass
        for glow in GLOWS:
            unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewGlow %.4f" % glow)
            for lights in LIGHTS:
                unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewExposure %.2f" % lights)
                yield 1.2
                name = "%s__g%.4f_l%.3f.png" % (skin, glow, lights)
                try:
                    unreal.RenderingLibrary.export_render_target(world, target, ROOT, name)
                except Exception as err:                           # noqa: BLE001
                    RESULT.setdefault("errors", {})[name] = str(err)[:100]
                    continue
                yield 0.0
                try:
                    table["%s g%.4f l%.3f" % (skin, glow, lights)] = stats(os.path.join(ROOT, name), hue)
                except Exception as err:                           # noqa: BLE001
                    RESULT.setdefault("errors", {})[name] = str(err)[:100]
        emit("T_%s" % skin, "INFO", "swept", {k: v for k, v in table.items() if k.startswith(skin)})

    # back to the shipped defaults, so nothing downstream reads a sweep setting as a result
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewGlow 0.10")   # the shipped default since the re-baseline
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewExposure 0.00")
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewLights 0.040")

    # ---- WHICH SETTING WORKS FOR EVERY SKIN: nothing pinned, a mid-toned figure, and the glow readable in
    # the skin's own colour on the brightest tenth of the figure.
    good = []
    for glow in GLOWS:
        for lights in LIGHTS:
            rows = [table.get("%s g%.4f l%.3f" % (s, glow, lights)) for s, _ in SKINS]
            if any(r is None or r.get("subject_px", 0) == 0 for r in rows):
                continue
            ok = all(r["pinned"] < 0.05 and 0.28 <= r["mean"] <= 0.70 for r in rows)
            glowy = all(r["top_decile_colour"] > 0.04 for (s, hue), r in zip(SKINS, rows) if hue is not None)
            if ok and glowy:
                good.append({"glow": glow, "lights": lights})
    RESULT["settings_passing"] = good
    tests.append({"id": "T00", "name": "every skin was exported at every setting",
                  "pass": len(table) == len(SKINS) * len(GLOWS) * len(LIGHTS),
                  "detail": {"read": len(table), "wanted": len(SKINS) * len(GLOWS) * len(LIGHTS)}})
    tests.append({"id": "T01", "name": "there is a stage setting where no skin pins, the figure is mid-toned and the glow shows in its own colour",
                  "pass": len(good) > 0,
                  "detail": {"passing": good, "table": table,
                             "note": "PreviewGlow and PreviewLights are baked into WonderlandSkinStage.cpp from this."}})
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
