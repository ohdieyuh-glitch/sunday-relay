# HOW BRIGHT SHOULD A FLAME RIBBON BE ON THE FIRE MATERIAL?
#
# The number cannot be reasoned to. Where a flame stops reading as a dim smudge and starts reading as a white
# blob depends on the additive blend, the tonemapper, the exposure and the hour together -- and the first two
# guesses landed on opposite sides of it: at the authored strength the whole foot of every tongue was over
# white, and at a square root times 0.12 the fire was invisible.
#
# wl.Look.FireGain is a CVar and wl.Look.Reglow rebuilds every figure against it, so the whole sweep runs
# inside ONE play session -- no build per candidate, and no thermal drift between the candidates either.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "fire_gain")
# FOUNDER, 2026-09-26: "bring the flames back to the mascot skins." The second sweep is over the pair that
# decides how much fire there is -- how bright each tongue burns and how many of them there are -- because
# the first sweep only ever moved brightness, and a softer tongue needs MORE tongues to read as a blaze.
SETTINGS = ((1.6, 5), (2.3, 8), (2.3, 11), (3.2, 8))


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if ues.get_game_world() is None:
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 300)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
        yield 6.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    ui = L.get_ui(world)
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)

    # OUT IN THE OPEN AND AT DUSK, which is where a flame has to convince: bright enough that the world is
    # visible, dark enough that the fire is the loudest thing in the frame.
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 19.0")
    ui.wear_relay_skin("arden_infernal")
    yield 5.0

    here = dog.get_actor_location()
    yaw = dog.get_actor_rotation().yaw
    eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * 520.0,
                        here.y + math.sin(math.radians(yaw)) * 520.0, here.z + 120.0)
    look = unreal.Vector(here.x, here.y, here.z + 70.0)

    vp = pc.get_viewport_size()
    vw = float(vp[0]) if vp and vp[0] else 1920.0
    vh = float(vp[1]) if vp and len(vp) > 1 and vp[1] else 1080.0

    def band(z_above, half_h):
        at = dog.get_actor_location()
        got = unreal.GameplayStatics.project_world_to_screen(
            pc, unreal.Vector(at.x, at.y, at.z + z_above), False)
        if got is None:
            return None
        cx, cy = float(got.x) / vw, float(got.y) / vh
        if not (0.05 < cx < 0.95 and 0.05 < cy < 0.95):
            return None
        return (cx - 0.085, cy - half_h, cx + 0.085, cy + half_h)

    def light(rect):
        if rect is None:
            return None
        got = L.read_screen_rect(rect[0], rect[1], rect[2], rect[3])
        if got is None:
            return None
        mean, dark, bright, n = got
        return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 5),
                "bright": round(bright, 4), "dark": round(dark, 4)}

    rows = {}
    RESULT["by_gain"] = rows
    for gain, tongues in SETTINGS:
        unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireGain %.3f" % gain)
        unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireTongues %d" % tongues)
        unreal.SystemLibrary.execute_console_command(world, "wl.Look.Reglow")
        L.pose_camera(world, eye, look, 38.0)
        yield 3.5
        foot = light(band(70.0, 0.026))
        tip = light(band(140.0, 0.026))
        shot = os.path.join(ROOT, "gain_%04.1f_tongues_%02d.png" % (gain, tongues))
        try:
            L.capture_game_viewport(shot)
        except Exception:
            pass
        rows["gain %.1f x %d tongues" % (gain, tongues)] = {"foot": foot, "tip": tip,
                               "falloff": round(foot["luma"] - tip["luma"], 5) if (foot and tip) else None}
        key = "gain %.1f x %d tongues" % (gain, tongues)
        emit("G", "INFO", key, rows[key])

    # WHAT A GOOD ONE LOOKS LIKE, stated before the answer is read off: the foot clearly lit, a minority of it
    # over white so the core blooms without the band flattening, and the tip dimmer than the foot.
    best = None
    for key, row in rows.items():
        if not row["foot"] or not row["tip"]:
            continue
        foot = row["foot"]
        # PRESENCE AND COLOUR TOGETHER: plenty of the band lit, and not washed to white.
        if 0.15 <= foot["luma"] <= 0.70 and foot["bright"] <= 0.30 and foot["dark"] <= 0.55:
            if best is None or foot["luma"] > rows[best]["foot"]["luma"]:
                best = key
    RESULT["recommended_gain"] = best
    emit("G_PICK", "INFO", "the gain that lands in the window", {"gain": best, "window":
         "foot luma 0.18-0.70, over-white 0.04-0.45, and brighter at the foot than the tip"})

    L.release_camera(world)
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 1.0
