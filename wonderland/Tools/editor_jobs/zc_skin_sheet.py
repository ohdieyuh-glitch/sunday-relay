# THE SIX VIEWS THE FOUNDER ASKED FOR, OF EVERY SKIN, OFF THE WARDROBE STAGE.
#
# FOUNDER, 2026-09-27: "For each of the three rebuilt skins create a visual comparison set: REFERENCE / CURRENT-OLD
# / FABLE 5.1 REBUILD. Then render the rebuild: FRONT, LEFT, RIGHT, BACK, 3/4 FRONT, 3/4 BACK ... The rebuild
# fails if the skin is technically functional but still only vaguely resembles the reference."
#
# So this exports exactly those six views of every active skin from the stage's own render target, at the
# wardrobe's framing, and measures each one the way zc_wardrobe_20 does -- the pixels, not the camera. The
# REFERENCE half of the comparison is the founder's own sheet (RelaySkins/_reference/*_founder_sheet.png), the
# OLD half is captures/zc/before_rebuild_2026-09-27, and this job's output is the third column. The sheets are
# composed afterwards with Tools/contact-sheet.ps1; the verdict on resemblance is the founder's, made from the
# pictures, and nothing here pretends to make it for them.
#
# WHAT IS ASSERTED, because a sheet with a hole in it is not a sheet: every view of every skin exported, every
# view holding a figure that fills the founder's band, and no view in which the figure is mostly pinned white
# -- the last being the thing the glow re-baseline of 2026-09-27 exists to fix, measured on the same pixels.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import os
import sys
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_sheet")
SKINS = ("relay_og", "celestial_light", "apollo_v1", "apollo", "arden_infernal_v1", "arden_infernal", "skeleton_flame_v1", "skeleton_flame")
VIEWS = (("front", 0.0), ("front34", 45.0), ("left", 90.0), ("back34", 225.0), ("back", 180.0), ("right", 270.0))
# The founder's opening-view band, from zc_wardrobe_20's V03; rotated views take the wider envelope of V05.
FRONT_BAND = (76.0, 94.0)
ROTATED_BAND = (66.0, 99.0)
PINNED_CEILING = 0.35
STEP = 3


def frame_stats(path):
    sys.path.insert(0, os.path.dirname(CHANNEL))
    from occupancy import read_png                                  # noqa: WPS433
    w, h, chan, px = read_png(path)
    sub_n = 0
    pinned = 0
    top = None
    bottom = None
    for y in range(0, h, STEP):
        row = y * w * chan
        for x in range(0, w, STEP):
            i = row + x * chan
            lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
            if lum > 34:
                sub_n += 1
                if top is None:
                    top = y
                bottom = y
                if lum >= 245.0:
                    pinned += 1
    height_pct = 0.0 if top is None else round((bottom - top + STEP) * 100.0 / h, 1)
    return {"height_pct": height_pct, "pinned_fraction": round(pinned / float(max(sub_n, 1)), 3),
            "subject_px": sub_n}


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
            os.remove(os.path.join(ROOT, old))
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
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.0")
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
        record("W00", "the wardrobe stage exists", False)
        RESULT["status"] = "FAIL"
        return
    target = stage.get_render_target()

    shots = {}
    RESULT["views"] = shots
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 6.0
        try:
            RESULT.setdefault("framing", {})[skin] = str(stage.describe_framing())
        except Exception:                                          # noqa: BLE001
            pass
        for view, yaw in VIEWS:
            try:
                stage.set_inspection_yaw(yaw)
            except Exception:                                      # noqa: BLE001
                pass
            yield 1.4
            name = "%s__%s.png" % (skin, view)
            try:
                unreal.RenderingLibrary.export_render_target(world, target, ROOT, name)
                shots["%s %s" % (skin, view)] = name
            except Exception as err:                               # noqa: BLE001
                RESULT.setdefault("errors", {})["%s %s" % (skin, view)] = str(err)[:100]
        try:
            stage.set_inspection_yaw(0.0)
        except Exception:                                          # noqa: BLE001
            pass
        emit("W_%s" % skin, "INFO", "six views exported", {"skin": skin})

    record("W00", "six views of every skin were exported",
           len(shots) == len(SKINS) * len(VIEWS), exported=len(shots), wanted=len(SKINS) * len(VIEWS))

    # ---- MEASURED OFF THE EXPORTED PIXELS, one frame per tick.
    measured = {}
    RESULT["measured"] = measured
    for key, name in shots.items():
        path = os.path.join(ROOT, name)
        if os.path.exists(path):
            try:
                measured[key] = frame_stats(path)
            except Exception as err:                               # noqa: BLE001
                RESULT.setdefault("errors", {})[key] = str(err)[:100]
        yield 0.0

    out_of_band = {}
    pinned = {}
    for key, got in measured.items():
        view = key.split(" ", 1)[1]
        lo, hi = FRONT_BAND if view == "front" else ROTATED_BAND
        if not (lo <= got["height_pct"] <= hi):
            out_of_band[key] = got["height_pct"]
        if got["pinned_fraction"] >= PINNED_CEILING:
            pinned[key] = got["pinned_fraction"]
    record("W01", "every view holds a figure filling the founder's band",
           len(measured) == len(shots) and not out_of_band, out_of_band=out_of_band,
           front_band=FRONT_BAND, rotated_band=ROTATED_BAND)
    record("W02", "no view is a white shape: the figure is mostly NOT pinned at white",
           len(measured) == len(shots) and not pinned, pinned=pinned, ceiling=PINNED_CEILING,
           note="the wardrobe's own picture of the glow re-baseline. Before it, Skeleton Flame's HIGH frames "
                "measured 68-80% of the figure over luma 140 from this same stage.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
