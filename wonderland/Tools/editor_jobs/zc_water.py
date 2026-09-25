# IS THE WATER BELIEVABLE, OR STILL A SHINY OPAQUE SOLID?
#
# FOUNDER, P2 item 10: "Replace plastic-looking water/streams/ponds/fountains with believable animated
# water: reflections/refraction, normals, depth/color response, flow, sane performance."
#
# WHAT WAS ALREADY DONE, AND WHY IT IS NOT YET EVIDENCE. M_WL_RealWater was authored as a new master --
# translucent, two normal maps panning at unrelated rates, depth fade, refraction -- and the day-cycle
# subsystem re-dresses every surface wearing MI_V2_Water with it at runtime. All of that is intent. Whether
# 64 basins in a live world actually ended up wet is a different question, and the one a founder looking at
# a pond is asking.
#
# THIS IS THE SHADOW TEST RUN BACKWARDS. zc_shadows holds the world still and asks whether the picture
# holds still with it. Water is the one surface that MUST NOT: if the sky is frozen, the camera is fixed and
# nothing in the level is moving, then a pond that reads identical from one second to the next is not
# flowing, and a pond that reads identical is exactly what "plastic" means.
#
# So the same frame is measured twice, and a patch of ground beside the pond is measured the same way as a
# control. Water must move; the stone beside it must not; and the difference between those two numbers is
# the evidence, rather than any threshold invented here.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "water")

MASTER = "/Game/Wonderland/Materials/M_WL_RealWater"
RT_W, RT_H = 480, 270
GRID_X, GRID_Y = 12, 9


def sample(world, rt):
    out = []
    for gy in range(GRID_Y):
        for gx in range(GRID_X):
            x = int((gx + 0.5) * RT_W / GRID_X)
            y = int((gy + 0.5) * RT_H / GRID_Y)
            c = unreal.RenderingLibrary.read_render_target_pixel(world, rt, x, y)
            out.append(0.2126 * float(c.r) + 0.7152 * float(c.g) + 0.0722 * float(c.b))
    return out


def probe_pixels(world, rt):
    """Five points spread across the picture, as raw channels, for judging exposure rather than change."""
    pts = ((RT_W // 2, RT_H // 2), (RT_W // 4, RT_H // 4), (3 * RT_W // 4, 3 * RT_H // 4),
           (RT_W // 8, 7 * RT_H // 8), (7 * RT_W // 8, RT_H // 8))
    out = []
    for (x, y) in pts:
        c = unreal.RenderingLibrary.read_render_target_pixel(world, rt, x, y)
        out.append([int(c.r), int(c.g), int(c.b)])
    return out


def calibrate(comp, world, rt, out):
    """Set the capture's exposure so the picture is not clipped, and record which value was used.

    WHY THIS IS NEEDED. A scene capture does not inherit the player camera's eye adaptation, so against a
    70,000 lux sun its frames came back 255,255,255 in every channel -- fully blown. Two blown images differ
    by exactly nothing, which is how the first run measured 0.0 change with shadows and 0.0 without, and
    then passed its own comparison.

    This is calibration, not tuning until something passes: exposure is stepped down until the picture stops
    clipping, and the value that worked is recorded alongside the result. A view that cannot be brought into
    range records None, and the job fails rather than measuring a white rectangle.
    """
    for bias in (0.0, -2.0, -4.0, -6.0, -8.0, -10.0, -12.0, -14.0):
        pp = comp.get_editor_property("post_process_settings")
        pp.set_editor_property("override_auto_exposure_method", True)
        pp.set_editor_property("auto_exposure_method", unreal.AutoExposureMethod.AEM_MANUAL)
        pp.set_editor_property("override_auto_exposure_bias", True)
        pp.set_editor_property("auto_exposure_bias", bias)
        comp.set_editor_property("post_process_settings", pp)
        # Time for the change to reach the running capture and for the image to settle on it.
        for _ in range(8):
            yield 0.1
        px = probe_pixels(world, rt)
        brightest = max(max(p) for p in px)
        darkest = min(min(p) for p in px)
        out["pixels"] = px
        if brightest < 250 and brightest > darkest:
            out["bias"] = bias
            return
    out["bias"] = None


def spread(a, b):
    if not a or len(a) != len(b):
        return -1.0
    return sum(abs(x - y) for x, y in zip(a, b)) / float(len(a))


def job():
    os.makedirs(ROOT, exist_ok=True)
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
        # ------------------------------------------------------------ DID IT REACH THE PONDS
        # Matched on the material actually worn, the same way the runtime matches, so a basin's stone rim or
        # a fountain's gold finial cannot be counted as water by having a watery name.
        wet, biggest, best_size, example = 0, None, -1.0, None
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor):
            mesh = actor.static_mesh_component
            if mesh is None:
                continue
            for slot in range(int(mesh.get_num_materials())):
                worn = mesh.get_material(slot)
                if worn is None:
                    continue
                name = str(worn.get_name())
                parent = ""
                try:
                    parent = str(worn.get_editor_property("parent").get_name())
                except Exception:
                    parent = ""
                if "M_WL_RealWater" not in name and "M_WL_RealWater" not in parent:
                    continue
                wet += 1
                if example is None:
                    example = worn
                origin, extent = actor.get_actor_bounds(False)
                size = float(extent.x) * float(extent.y)
                if size > best_size:
                    best_size, biggest = size, (origin, extent)
        RESULT["surfaces_dressed"] = wet

        # ---- JUDGED ON THE MATERIAL A POND IS ACTUALLY WEARING. The first version loaded the master off
        # disk with EditorAssetLibrary, which returns null under PIE and read as "missing" -- a fault in the
        # proof that looked exactly like a missing asset. The material in the running world cannot lie about
        # this: it is the one drawing the water.
        blend = "no water found"
        if example is not None:
            probe = example
            for _ in range(4):
                try:
                    nxt = probe.get_editor_property("parent")
                except Exception:
                    break
                if nxt is None:
                    break
                probe = nxt
            try:
                blend = str(probe.get_editor_property("blend_mode"))
            except Exception as err:                           # noqa: BLE001
                blend = "unreadable: %s" % err
            RESULT["master"] = {"worn": str(example.get_name()), "root": str(probe.get_name()),
                                "blend_mode": blend}
        record("Q00", "the water a pond is wearing is translucent, not opaque",
               "TRANSLUCENT" in blend.upper(), blend_mode=blend,
               note="the old master was BLEND_OPAQUE, so no parameter value it had could ever look wet")

        record("Q01", "the ponds, wells, canals and basins are actually wearing it",
               wet > 0 and biggest is not None, surfaces=wet,
               note="counted by the material each surface wears in the live world, not by the log line")
        if biggest is None:
            record("Q02", "the water moves while the world stands still", False,
                   note="no dressed water surface was found to look at")
            les.editor_request_end_play()
            yield (lambda: ues.get_game_world() is None, 300)
            return

        # ------------------------------------------------------------ DOES IT FLOW
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
        yield 1.5

        origin, extent = biggest
        # EIGHT-BIT RGBA, NOT THE DEFAULT FLOAT TARGET. read_render_target_pixel only supports 8-bit
        # RGBA; against a float target it returns black for every pixel and mentions it only in the log.
        # The first run read 0.0 change with shadows AND 0.0 without, then PASSED on 0.0 <= 0.0 + 1.0 --
        # a vacuous pass, which is the exact failure this suite exists to prevent. The guard below now
        # refuses a reading that is flat on both sides.
        rt = unreal.RenderingLibrary.create_render_target2d(
            world, RT_W, RT_H, unreal.TextureRenderTargetFormat.RTF_RGBA8)
        down = unreal.Rotator(-90.0, 0.0, 0.0)
        # Low enough that the frame is water and nothing else. A vantage that caught the rim would dilute
        # the measurement with stone and make a still pond look like it was moving a little.
        lift = max(float(extent.z) + 120.0, 200.0)
        at_water = unreal.Vector(origin.x, origin.y, origin.z + lift)
        # SPAWNED BY THE TEST LIBRARY. GameplayStatics' deferred spawn is not bound in this engine's Python,
        # and the editor's own spawn puts an actor in the EDITOR world rather than the running one -- which
        # would photograph a level nobody is playing.
        cap = H.spawn_scene_capture(world, at_water, down, rt)
        if cap is None:
            raise RuntimeError("no scene capture could be spawned into the running world")
        comp = cap.get_editor_property("capture_component2d")
        yield 1.0

        # RENDERING EVERY FRAME, NOT ONCE ON DEMAND. A single CaptureScene gives TSR and Lumen no temporal
        # history to resolve against, and the frame came back 255 in every channel at every exposure from
        # 0 to -14 EV -- which is not a bright picture, it is an unconverged one. Running continuously costs
        # a small 480x270 render each frame and gives a settled image; the proof still controls WHEN it
        # samples, which is all the comparison actually needs.
        comp.set_editor_property("capture_every_frame", True)
        for _ in range(12):
            yield 0.1

        # THE INSTRUMENT IS SET UP BEFORE IT IS TRUSTED.
        cal = {}
        for step in calibrate(comp, world, rt, cal):
            yield step
        RESULT["exposure"] = {"bias": cal.get("bias"), "sample_pixels": cal.get("pixels")}
        if cal.get("bias") is None:
            raise RuntimeError("the capture could not be brought into exposure range: %s" % cal.get("pixels"))

        # ---- THE SAME VIEW, RUNNING AND PAUSED. Third design, and the reasoning for each discard is kept
        # because the discards are most of what was learned here.
        #
        # A CONTROL VIEW OF THE GROUND BESIDE THE POND failed: it read water 1.4689 / ground 0.2443 on one
        # run and water 0.3383 / ground 1.6191 on the next. "Beside the pond" is an arbitrary vantage and it
        # can land on foliage, which moves in the wind -- so the floor was never a floor.
        #
        # COMPARING SHORT AND LONG SAMPLE GAPS at the same view was reproducible but could not discriminate:
        # 1.89 at a tenth of a second against 2.02 at a whole one, twice over. A difference that large at a
        # tenth of a second, and barely larger at a second, means the picture is either already decorrelated
        # by 0.1 s or simply noisy -- and that measurement cannot tell those apart.
        #
        # PAUSING CAN. Pause stops the world's time, so the panning normals stop panning, while the renderer
        # keeps drawing and TSR keeps jittering exactly as before. Same camera, same pixels, same exposure,
        # same noise -- the only thing removed is the animation. Whatever the running view has that the
        # paused view does not IS the water moving.
        def watch(label, count=16):
            frames = []
            for _ in range(count):
                frames.append(sample(world, rt))
                yield 0.1
            RESULT["_" + label] = [spread(frames[i], frames[i + 1]) for i in range(len(frames) - 1)]
            RESULT["_last_" + label] = frames[-1]

        def median(xs):
            xs = sorted(xs)
            return xs[len(xs) // 2] if xs else -1.0

        for step in watch("running"):
            yield step
        H.capture_viewport_jpeg(os.path.join(ROOT, "01_water_running.jpg"), 1400, 90)

        unreal.GameplayStatics.set_game_paused(world, True)
        yield 1.0
        for step in watch("paused"):
            yield step
        frames_paused_last = RESULT.get("_last_paused")
        H.capture_viewport_jpeg(os.path.join(ROOT, "02_water_paused.jpg"), 1400, 90)
        # ---- IS THE INSTRUMENT STILL AWAKE WHILE PAUSED?
        #
        # The paused reading came back 0.0000 exactly, twice. That is the answer the control wants, and it
        # is also precisely what a FROZEN CAPTURE would report -- if the component stops ticking with the
        # game, the render target simply holds its last frame and every sample matches. Then "paused 0.0"
        # would mean the instrument stopped, not the water, and Q02 would be resting on it.
        #
        # So the capture is poked while still paused: the exposure is moved one stop and the picture must
        # change. A live capture re-renders and the luminance shifts; a frozen one cannot.
        pp = comp.get_editor_property("post_process_settings")
        pp.set_editor_property("auto_exposure_bias", float(cal.get("bias", 0.0)) - 1.5)
        comp.set_editor_property("post_process_settings", pp)
        for _ in range(8):
            yield 0.1
        poked = sample(world, rt)
        pp.set_editor_property("auto_exposure_bias", float(cal.get("bias", 0.0)))
        comp.set_editor_property("post_process_settings", pp)
        for _ in range(6):
            yield 0.1
        awake = spread(frames_paused_last, poked)

        unreal.GameplayStatics.set_game_paused(world, False)
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 24")
        yield 0.5

        running = median(RESULT.pop("_running", []))
        paused = median(RESULT.pop("_paused", []))
        RESULT["flow"] = {"change_running": round(running, 4), "change_paused": round(paused, 4),
                          "grid_points": GRID_X * GRID_Y}

        RESULT.pop("_last_running", None)
        RESULT.pop("_last_paused", None)
        RESULT["flow"]["change_when_poked_while_paused"] = round(awake, 4)

        record("Q04", "the capture was still rendering while the world was paused",
               awake > 0.5, change_when_poked=round(awake, 4),
               note="exposure moved one and a half stops with the game paused; a frozen capture would "
                    "report 0.0 here, and then the paused control under Q02 would prove nothing")

        record("Q03", "the measurement actually looked at something",
               running > 0.0 or paused > 0.0,
               running=round(running, 4), paused=round(paused, 4),
               note="both flat means the render target came back empty, and Q02 would then be decided by "
                    "blank pictures rather than by the water")

        record("Q02", "the water moves, and stops moving when the world is paused",
               running > paused * 1.5 and running > 0.0,
               change_running=round(running, 4), change_paused=round(paused, 4),
               note="same view and same renderer noise on both sides; pause removes only the animation, so "
                    "the gap between them is the flow and nothing else")

    except Exception as err:                                   # noqa: BLE001
        RESULT["error"] = str(err)
        record("Q99", "the water measurement ran to completion", False, error=str(err))
        try:
            unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 24")
        except Exception:
            pass

    if cap is not None:
        try:
            cap.destroy_actor()
        except Exception:
            pass
    RESULT.pop("_last", None)
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
