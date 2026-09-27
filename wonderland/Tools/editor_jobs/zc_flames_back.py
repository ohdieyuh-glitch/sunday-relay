# ARE THE FOUNDER'S FLAMES BACK?
#
# FOUNDER, 2026-09-26, with video: "these are the flames I need back." The footage shows Skeleton Flame with
# tall white-cyan ghostfire plumes rising about a head's height above the shoulders -- bright enough to read
# against a sunlit lawn in one shot and against a dark night plaza in the other.
#
# Two things I shipped had taken them away, and both are reverted: the ribbons had been moved onto M_WL_Fire,
# which shapes and softens them and is far dimmer per unit of colour, and wl.Look.NightGlow was cutting every
# glowing channel five-fold after dark -- the ghostfire with it.
#
# So this photographs the same skin, front and side, in daylight and at night, close enough to see the plumes
# the way the founder's own camera did. It asserts one thing only: that the fire is plainly there. The rest is
# for the founder's eye, and the captures are the report.
CONCURRENT = True

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "flames_back")
HOURS = (("day", 12.0), ("night", 22.0))
VIEWS = (("front", 0.0), ("side", 90.0))


def luma(c):
    return round(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, 4)


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

    ui = L.get_ui(world)
    ui.wear_relay_skin("skeleton_flame")
    yield 6.0
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)

    rows = {}
    RESULT["readings"] = rows
    for hour_label, hour in HOURS:
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
        yield 5.0
        for view_label, offset in VIEWS:
            here = dog.get_actor_location()
            yaw = dog.get_actor_rotation().yaw + offset
            eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * 330.0,
                                here.y + math.sin(math.radians(yaw)) * 330.0, here.z + 60.0)
            L.pose_camera(world, eye, unreal.Vector(here.x, here.y, here.z + 55.0), 50.0)
            yield 2.5
            # THE PLUME BAND: above the shoulders, where the founder's footage shows the fire. If the flames
            # are back this band is bright and blue-white; if they are not it is sky or plaza.
            size = pc.get_viewport_size()
            band = None
            if size and size[0] > 0:
                top = unreal.GameplayStatics.project_world_to_screen(
                    pc, unreal.Vector(here.x, here.y, here.z + 175.0), False)
                if top is not None:
                    cx, cy = float(top.x) / size[0], float(top.y) / size[1]
                    if 0.05 < cx < 0.95 and 0.05 < cy < 0.95:
                        band = L.read_screen_rect(cx - 0.055, cy - 0.075, cx + 0.055, cy + 0.075)
            row = {}
            if band is not None:
                row["plume_luma"] = luma(band[0])
                row["plume_bright_fraction"] = round(float(band[2]), 4)
            hot = None
            if band is not None:
                try:
                    top = unreal.GameplayStatics.project_world_to_screen(
                        pc, unreal.Vector(here.x, here.y, here.z + 175.0), False)
                    cx, cy = float(top.x) / size[0], float(top.y) / size[1]
                    hot = L.read_screen_extremes(cx - 0.055, cy - 0.075, cx + 0.055, cy + 0.075)
                except Exception:                                  # noqa: BLE001
                    hot = None
            if hot is not None:
                row["plume_blue_over_red"] = round(float(hot[1]), 4)
            rows["%s %s" % (hour_label, view_label)] = row
            try:
                L.capture_game_viewport(os.path.join(ROOT, "%s_%s.png" % (hour_label, view_label)))
            except Exception:
                pass
            L.release_camera(world)
            emit("F_%s_%s" % (hour_label, view_label), "INFO", "%s, %s" % (hour_label, view_label), row)

    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.0")

    got = [v for v in rows.values() if "plume_luma" in v]
    record("B00", "the plume band was read in daylight and at night, front and side",
           len(got) == len(HOURS) * len(VIEWS), read=len(got), wanted=len(HOURS) * len(VIEWS))
    record("B01", "there is bright ghostfire above the shoulders at every hour and angle",
           all(v.get("plume_luma", 0.0) > 0.25 for v in rows.values()),
           readings=rows, floor=0.25,
           note="the founder's footage shows the plume reading clearly against a sunlit lawn AND a dark "
                "plaza. A band that is dark in either is not the approved flame.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured; the verdict is the four captures against the founder's video"
    yield 1.0
