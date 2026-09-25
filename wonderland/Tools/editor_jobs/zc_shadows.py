# ARE THE SHADOWS STILL GLITCHING?
#
# FOUNDER, P2 item 11: "Fix glitching shadows: flicker, bias, leaking, unstable shadows, conflicting lights."
# Five named symptoms, and they are not one fault -- so they are not one check.
#
#   conflicting lights  is a question about the level: how many lights are fighting over the same shadow.
#   bias and leaking    are questions about settings: acne and peter-panning are the two ends of one dial.
#   flicker, unstable   are questions about TIME, and the only honest way to ask them is to hold the world
#                       still and see whether the picture holds still with it.
#
# WHY THERE IS A CONTROL. A still frame in this project is not actually still: TSR jitters its sample
# pattern every frame by design, so any two captures differ a little no matter what the shadows do. A
# measurement of "the image changed" would therefore read positive on a perfectly stable scene, and a
# threshold I invented to sit above it would be a number chosen to pass.
#
# So the scene is measured TWICE: once as it ships, and once with dynamic shadows switched off. The second
# pass is the same camera, the same sky, the same TSR, and no shadows -- which is exactly the floor the
# first pass should be compared against. If shadows are unstable, the first number is far above the second.
# If they are not, the two are alike, and the residue is the renderer's own dither rather than the shadows.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "shadows")

#: A vantage over built stone rather than over the Dog. Anything that animates -- the Dog, a companion, a
#: flame -- would move between captures for reasons that have nothing to do with shadows.
EYE = unreal.Vector(2600.0, 1400.0, 1500.0)
AIM = unreal.Rotator(-22.0, 155.0, 0.0)

#: Small on purpose. Every sample is a separate GPU readback, so the grid is what costs, not the target.
RT_W, RT_H = 480, 270
GRID_X, GRID_Y = 12, 9


def sample(world, rt):
    """The picture, as a list of luminances on a fixed grid."""
    out = []
    for gy in range(GRID_Y):
        for gx in range(GRID_X):
            x = int((gx + 0.5) * RT_W / GRID_X)
            y = int((gy + 0.5) * RT_H / GRID_Y)
            c = unreal.RenderingLibrary.read_render_target_pixel(world, rt, x, y)
            out.append(0.2126 * float(c.r) + 0.7152 * float(c.g) + 0.0722 * float(c.b))
    return out


def spread(a, b):
    """Mean absolute difference between two samples of the same view, in 0-255 luminance."""
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
    yield 5.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 0.5

    try:
        # ------------------------------------------------------------ CONFLICTING LIGHTS
        # The founder's own words. Two suns, or two movable lights both casting over the same ground, is the
        # one item on the list that is a level fault rather than a setting or a frame.
        suns, casters, census = [], [], []
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DirectionalLight):
            comp = actor.get_component_by_class(unreal.DirectionalLightComponent)
            if comp is None:
                continue
            row = {
                "label": str(actor.get_actor_label()) if hasattr(actor, "get_actor_label") else str(actor.get_name()),
                "intensity": round(float(comp.get_editor_property("intensity")), 1),
                "casts": bool(comp.get_editor_property("cast_shadows")),
                "sun": bool(comp.get_editor_property("atmosphere_sun_light")),
                "mobility": str(comp.get_editor_property("mobility")),
            }
            census.append(row)
            if row["sun"]:
                suns.append(row["label"])
            if row["casts"]:
                casters.append(row["label"])
        RESULT["directional_lights"] = census

        record("S01", "no two lights are fighting over the same shadow",
               len(suns) == 1 and len(casters) == 1,
               atmosphere_suns=suns, shadow_casters=casters, directional_lights=len(census),
               note="the fills light the scene without casting, so only the sun draws a shadow")

        # ------------------------------------------------------------ BIAS AND LEAKING
        # Two ends of one dial: too little bias is acne on lit surfaces, too much is a shadow that detaches
        # from its object. The ranges are the engine's own working band, not numbers invented here.
        sun = None
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DirectionalLight):
            comp = actor.get_component_by_class(unreal.DirectionalLightComponent)
            if comp is not None and bool(comp.get_editor_property("cast_shadows")):
                sun = comp
                break
        if sun is not None:
            bias = float(sun.get_editor_property("shadow_bias"))
            slope = float(sun.get_editor_property("shadow_slope_bias"))
            cascades = int(sun.get_editor_property("dynamic_shadow_cascades"))
            distance = float(sun.get_editor_property("dynamic_shadow_distance_movable_light"))
            RESULT["sun_shadow"] = {"bias": bias, "slope_bias": slope, "cascades": cascades,
                                    "dynamic_distance_uu": distance}
            record("S02", "the sun's shadow bias is in the working band, and it has cascades to spend",
                   0.0 < bias <= 1.5 and 0.0 < slope <= 2.0 and cascades >= 1 and distance > 0.0,
                   bias=bias, slope_bias=slope, cascades=cascades, dynamic_distance_uu=distance,
                   note="below the band is acne on lit surfaces; above it, a shadow that floats off its object")
        else:
            record("S02", "the sun's shadow bias is in the working band, and it has cascades to spend",
                   False, note="no shadow-casting directional light was found to read")

        # ------------------------------------------------------------ FLICKER AND INSTABILITY
        # Hold the sky, hold the camera, and see whether the picture holds too.
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
        yield 1.5

        rt = unreal.RenderingLibrary.create_render_target2d(world, RT_W, RT_H)
        # SPAWNED BY THE TEST LIBRARY. GameplayStatics' deferred spawn is not bound in this engine's Python,
        # and the editor's own spawn puts an actor in the EDITOR world rather than the running one -- which
        # would photograph a level nobody is playing.
        cap = H.spawn_scene_capture(world, EYE, AIM, rt)
        if cap is None:
            raise RuntimeError("no scene capture could be spawned into the running world")
        comp = cap.get_editor_property("capture_component2d")
        yield 1.0

        def two_frames():
            comp.capture_scene()
            first = sample(world, rt)
            for _ in range(8):
                yield 0.1
            comp.capture_scene()
            second = sample(world, rt)
            RESULT.setdefault("_frames", []).append((first, second))

        # ---- AS IT SHIPS
        for step in two_frames():
            yield step
        a, b = RESULT["_frames"][-1]
        with_shadows = spread(a, b)
        H.capture_viewport_jpeg(os.path.join(ROOT, "01_shadows_on.jpg"), 1400, 90)

        # ---- THE CONTROL: the same everything, with dynamic shadows switched off.
        unreal.SystemLibrary.execute_console_command(world, "r.ShadowQuality 0")
        yield 2.0
        for step in two_frames():
            yield step
        c, d = RESULT["_frames"][-1]
        without_shadows = spread(c, d)
        H.capture_viewport_jpeg(os.path.join(ROOT, "02_shadows_off.jpg"), 1400, 90)

        # ---- AND PUT THE PROJECT BACK. A proof that left shadow quality at 0 would have edited the product.
        unreal.SystemLibrary.execute_console_command(world, "r.ShadowQuality 5")
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 24")
        yield 1.0

        RESULT["stability"] = {"still_frames_differ_with_shadows": round(with_shadows, 4),
                               "still_frames_differ_without_shadows": round(without_shadows, 4),
                               "grid_points": GRID_X * GRID_Y, "gap_s": 0.8}
        # The floor is whatever the renderer does on its own, plus a luminance step, so that a project with
        # an unusually quiet or unusually noisy TSR is judged against ITSELF rather than against a constant.
        ceiling = without_shadows + 1.0
        record("S03", "with the sky and the camera held still, the shadows hold still too",
               0.0 <= with_shadows <= ceiling,
               with_shadows=round(with_shadows, 4), without_shadows_control=round(without_shadows, 4),
               allowed=round(ceiling, 4),
               note="mean luminance change per sample across 0.8 s; the control is the same scene with "
                    "r.ShadowQuality 0, so TSR's own jitter is subtracted rather than assumed away")

        cap.destroy_actor()
    except Exception as err:                                   # noqa: BLE001
        # LOUD, AND STILL TIDY. A job that raised before ending play once left PIE running and hung the
        # channel until the editor was restarted; that is not repeated here.
        RESULT["error"] = str(err)
        record("S99", "the shadow measurement ran to completion", False, error=str(err))
        try:
            unreal.SystemLibrary.execute_console_command(world, "r.ShadowQuality 5")
            unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 24")
        except Exception:
            pass

    RESULT.pop("_frames", None)
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
