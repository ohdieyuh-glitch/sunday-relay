# WHERE DOES A GLOWING FIGURE STOP BEING A WHITE BLOB?
#
# FOUNDER: the mascot skins and the companions "should not be blown out by bright lighting" -- and, in the
# same message, "keep the current flame quality... do not regress them."
#
# WHAT IS ALREADY SETTLED. The glare is not the sun: with bloom switched off the plaza, the plants and the
# stone all read correctly while two figures stay pure white. They are emitting 6,400 times white over a
# large area, and an unlit emissive that far above the exposure ceiling has no detail left in it. Flames do
# the same thing and SHOULD -- white-hot is what a flame looks like -- so the two are now separate materials
# and only the body side is compressed.
#
# WHAT IS NOT SETTLED is the knee: the brightness where a glow stops reading as lit armour and starts reading
# as a hole in the picture. That depends on the tonemapper, the sun and the exposure together, and there is
# no way to reason it out. Rebuilding once per candidate would cost a full build each time.
#
# So it is swept. `wl.Look.GlowKnee` sets it, `wl.Look.Reglow` rebuilds every figure against it, and the
# clipped fraction of a companion filling the frame is read back -- the whole ladder inside ONE session. The
# value chosen is the HIGHEST that stops the blowout, because a knee lower than it needs to be throws away
# brightness the figures were designed with.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "glow_sweep")

RT_W, RT_H = 480, 270
GRID_X, GRID_Y = 24, 14

#: High to low, so the first value that passes is also the highest that passes.
KNEES = (6000.0, 3000.0, 1800.0, 1100.0, 700.0, 400.0, 220.0)


def read_frame(world, rt):
    out = []
    for gy in range(GRID_Y):
        for gx in range(GRID_X):
            x = int((gx + 0.5) * RT_W / GRID_X)
            y = int((gy + 0.5) * RT_H / GRID_Y)
            c = unreal.RenderingLibrary.read_render_target_pixel(world, rt, x, y)
            out.append((int(c.r), int(c.g), int(c.b)))
    return out


def judge(frame):
    n = float(len(frame))
    clipped = sum(1 for p in frame if max(p) >= 250)
    lum = [0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] for p in frame]
    return {"clipped_pct": round(100.0 * clipped / n, 2),
            "mean_luminance": round(sum(lum) / n, 1),
            "crushed_black_pct": round(100.0 * sum(1 for p in frame if max(p) <= 10) / n, 2)}


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
    yield 6.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 0.5

    cap = None
    try:
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12")
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
        yield 2.0

        # THE WORST CASE IN THE PROJECT: the LLM Companion, whose wings, tail, gems and body are ALL glow.
        # A knee that makes this figure read will make every quieter one read too.
        target = None
        for c in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandCompanionEmbodiment):
            label = str(c.get_actor_label())
            if "GPT" in label or "Astra" in label:
                target = c
                break
        if target is None:
            RESULT["status"] = "FAIL: no LLM companion in the world to measure"
            les.editor_request_end_play()
            yield (lambda: ues.get_game_world() is None, 300)
            return
        RESULT["measured_figure"] = str(target.get_actor_label())

        where = target.get_actor_location()
        eye = unreal.Vector(where.x + 260.0, where.y + 200.0, where.z + 110.0)
        aim = unreal.Rotator(-6.0, math.degrees(math.atan2(where.y - eye.y, where.x - eye.x)), 0.0)

        rt = unreal.RenderingLibrary.create_render_target2d(
            world, RT_W, RT_H, unreal.TextureRenderTargetFormat.RTF_RGBA8)
        cap = H.spawn_scene_capture(world, eye, aim, rt)
        if cap is None:
            raise RuntimeError("no scene capture could be spawned")
        comp = cap.get_editor_property("capture_component2d")
        comp.set_editor_property("capture_every_frame", True)
        for _ in range(16):
            yield 0.1

        ladder = {}
        chosen = None
        for knee in KNEES:
            unreal.SystemLibrary.execute_console_command(world, "wl.Look.GlowKnee %d" % int(knee))
            unreal.SystemLibrary.execute_console_command(world, "wl.Look.Reglow")
            # Reloading a figure rebuilds every component, so it needs a moment before it is worth reading.
            for _ in range(18):
                yield 0.1
            reading = judge(read_frame(world, rt))
            ladder["%d" % int(knee)] = reading
            H.capture_viewport_jpeg(os.path.join(ROOT, "knee_%05d.jpg" % int(knee)), 1400, 90)
            # HIGHEST THAT PASSES, and the ladder runs downward, so the first pass is the answer.
            if chosen is None and reading["clipped_pct"] <= 2.0 and reading["crushed_black_pct"] <= 25.0:
                chosen = knee
        RESULT["ladder"] = ladder
        RESULT["chosen_knee"] = chosen

        record("G01", "some knee stops the companion blowing out",
               chosen is not None, chosen_knee=chosen, ladder=ladder,
               note="clipped fraction of a frame the LLM Companion fills; it is the worst case in the project "
                    "because its wings, tail, gems and body are all glow")

        record("G02", "and it does not do it by turning the figure black",
               chosen is not None and ladder["%d" % int(chosen)]["crushed_black_pct"] <= 25.0,
               at_chosen=ladder.get("%d" % int(chosen)) if chosen else None,
               note="guards the fix the same way the exposure job does")

        # Leave the world on the value that was chosen, so a capture taken after this job shows it.
        if chosen is not None:
            unreal.SystemLibrary.execute_console_command(world, "wl.Look.GlowKnee %d" % int(chosen))
            unreal.SystemLibrary.execute_console_command(world, "wl.Look.Reglow")
            yield 1.5
            H.capture_viewport_jpeg(os.path.join(ROOT, "00_chosen.jpg"), 1500, 92)

        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 24")
        yield 0.5
    except Exception as err:                                   # noqa: BLE001
        RESULT["error"] = str(err)
        record("G99", "the sweep ran to completion", False, error=str(err))

    if cap is not None:
        try:
            cap.destroy_actor()
        except Exception:
            pass
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
