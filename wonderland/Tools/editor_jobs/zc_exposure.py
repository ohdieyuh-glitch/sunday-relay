# HOW BRIGHT IS WONDERLAND, ACTUALLY?
#
# FOUNDER: "The lighting is too bright and washed out. Reduce glare, bloom, and overexposure so the mascot
# skins are clearly visible. The same applies to the AI Agent companions and LLM companions. They should not
# be blown out by bright lighting."
#
# WHAT THIS IS NOT. Earlier in this session a scene capture came back 255,255,255 at 0 EV, and it would be
# easy to call that proof of an overexposed world. It is not. That capture had its OWN manual exposure
# override on it -- the measurement was of my capture's wrong exposure, not of the world's. Quoting it as
# evidence would have been quoting my own instrument back at the founder.
#
# WHAT THIS IS. A capture that INHERITS the world's post-processing: no exposure override, no bloom override,
# nothing set on it at all. Then what clips in this picture is what clips on screen, and the numbers mean
# what they say.
#
# WHAT IS MEASURED, and why each one:
#
#   CLIPPED FRACTION -- pixels at or above 250 on any channel. This is "washed out" stated as a number:
#   detail that has been destroyed rather than merely made bright, and it cannot be graded back.
#
#   MEAN LUMINANCE -- whether the whole frame sits too high even where it has not clipped.
#
#   AND THE SAME TWO ON THE THINGS THE FOUNDER NAMED: a mascot skin close up, and a companion. A world that
#   reads fine in a wide shot can still blow out a white-and-gold figure filling the frame, and the skins are
#   the complaint.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "exposure")

RT_W, RT_H = 480, 270
GRID_X, GRID_Y = 24, 14


def read_frame(world, rt):
    """Every sample's channels, so clipping and mean can both be computed from one pass."""
    out = []
    for gy in range(GRID_Y):
        for gx in range(GRID_X):
            x = int((gx + 0.5) * RT_W / GRID_X)
            y = int((gy + 0.5) * RT_H / GRID_Y)
            c = unreal.RenderingLibrary.read_render_target_pixel(world, rt, x, y)
            out.append((int(c.r), int(c.g), int(c.b)))
    return out


def judge(frame):
    if not frame:
        return None
    n = float(len(frame))
    clipped = sum(1 for p in frame if max(p) >= 250)
    near = sum(1 for p in frame if max(p) >= 240)
    dark = sum(1 for p in frame if max(p) <= 10)
    lum = [0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] for p in frame]
    lum_sorted = sorted(lum)
    return {"samples": int(n),
            "clipped_pct": round(100.0 * clipped / n, 2),
            "near_clipped_pct": round(100.0 * near / n, 2),
            "crushed_black_pct": round(100.0 * dark / n, 2),
            "mean_luminance": round(sum(lum) / n, 1),
            "median_luminance": round(lum_sorted[len(lum_sorted) // 2], 1),
            "p95_luminance": round(lum_sorted[int(0.95 * (len(lum_sorted) - 1))], 1)}


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
    ui = L.get_ui(world)
    yield 0.5

    cap = None
    try:
        # ---- NOON, HELD. The complaint is about bright light, so it is measured at the brightest the day
        # gets, with the sky stopped so two readings an hour apart would agree.
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12")
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
        yield 2.0

        # ---- WHAT THE WORLD'S OWN GRADE IS SET TO, read rather than assumed.
        grade = {}
        for volume in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.PostProcessVolume):
            try:
                s = volume.get_editor_property("settings")
                grade[str(volume.get_actor_label())[:34]] = {
                    "auto_exposure_bias": round(float(s.get_editor_property("auto_exposure_bias")), 3),
                    "bloom_intensity": round(float(s.get_editor_property("bloom_intensity")), 3),
                    "bloom_threshold": round(float(s.get_editor_property("bloom_threshold")), 3),
                    "override_bloom_intensity": bool(s.get_editor_property("override_bloom_intensity")),
                    "override_bloom_threshold": bool(s.get_editor_property("override_bloom_threshold")),
                    "unbound": bool(volume.get_editor_property("unbound")),
                }
            except Exception as err:                           # noqa: BLE001
                grade[str(volume.get_name())] = {"unreadable": str(err)[:80]}
        RESULT["post_process_volumes"] = grade

        rt = unreal.RenderingLibrary.create_render_target2d(
            world, RT_W, RT_H, unreal.TextureRenderTargetFormat.RTF_RGBA8)
        # NOTHING IS OVERRIDDEN ON THIS CAPTURE. It inherits the world's post-processing, which is the whole
        # point: an overridden exposure would measure the override.
        cap = H.spawn_scene_capture(world, unreal.Vector(0.0, 0.0, 1200.0), unreal.Rotator(-20.0, 0.0, 0.0), rt)
        if cap is None:
            raise RuntimeError("no scene capture could be spawned")
        comp = cap.get_editor_property("capture_component2d")
        comp.set_editor_property("capture_every_frame", True)
        for _ in range(16):
            yield 0.1

        views = {}

        def look(name, eye, aim, settle=14):
            cap.set_actor_location_and_rotation(eye, aim, False, False)
            for _ in range(settle):
                yield 0.1
            views[name] = judge(read_frame(world, rt))
            H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % name), 1400, 90)

        # ---- THE WIDE WORLD, FROM THE PLAYER'S OWN EYE.
        #
        # The first version picked a fixed vantage out of the air and measured mean luminance 4.7 with 72% of
        # the frame crushed -- which looked like a catastrophically dark world and was actually a camera
        # pointed at something dark. A number from a vantage nobody looks through is not evidence about what
        # the founder sees. The player camera is the only view that is.
        mgr = unreal.GameplayStatics.get_player_camera_manager(world, 0)
        eye = mgr.get_camera_location()
        aim = mgr.get_camera_rotation()
        RESULT["player_eye"] = [round(float(eye.x)), round(float(eye.y)), round(float(eye.z)),
                                round(float(aim.pitch), 1), round(float(aim.yaw), 1)]
        for step in look("01_player_view", eye, aim):
            yield step

        # ---- A MASCOT SKIN, CLOSE. The founder's actual complaint: the skins are not clearly visible.
        dogs = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RelayDogCharacter)
        dog = dogs[0] if dogs else None
        skin_views = {}
        if dog is not None:
            for skin in ("relay_og", "arden_infernal", "celestial_light"):
                ui.wear_relay_skin(skin)
                yield 2.0
                where = dog.get_actor_location()
                eye = unreal.Vector(where.x + 320.0, where.y + 240.0, where.z + 130.0)
                aim = unreal.Rotator(-8.0, math.degrees(math.atan2(where.y - eye.y, where.x - eye.x)), 0.0)
                for step in look("02_skin_%s" % skin, eye, aim):
                    yield step
                skin_views[skin] = views["02_skin_%s" % skin]
        RESULT["skins"] = skin_views

        # ---- A COMPANION, equally named in the complaint.
        comps = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandCompanionEmbodiment)
        standalone = [c for c in comps if c.get_attach_parent_actor() is None]
        if standalone:
            c = standalone[0]
            where = c.get_actor_location()
            eye = unreal.Vector(where.x + 300.0, where.y + 220.0, where.z + 120.0)
            aim = unreal.Rotator(-8.0, math.degrees(math.atan2(where.y - eye.y, where.x - eye.x)), 0.0)
            for step in look("03_companion", eye, aim):
                yield step

        RESULT["views"] = views

        # ---- THE VERDICTS. The thresholds are about destroyed detail, not taste: a pixel at 250+ has no
        # information left in it, and a frame whose mean sits near the top of the range has nowhere to go.
        wide = views.get("01_player_view") or {}
        record("E01", "the world is not clipping large parts of the frame to white",
               wide.get("clipped_pct", 100.0) <= 2.0,
               player_view=wide,
               note="pixels at 250+ have lost their detail permanently; 2% is the bar")

        worst_skin, worst = None, None
        for k, v in skin_views.items():
            if worst is None or v["clipped_pct"] > worst["clipped_pct"]:
                worst_skin, worst = k, v
        record("E02", "a mascot skin filling the frame is not blown out",
               worst is not None and worst["clipped_pct"] <= 4.0,
               worst_skin=worst_skin, worst=worst, all_skins=skin_views,
               note="the founder's own words: the skins must be clearly visible")

        comp_view = views.get("03_companion")
        record("E03", "a companion is not blown out either",
               comp_view is None or comp_view["clipped_pct"] <= 4.0,
               companion=comp_view, measured=comp_view is not None,
               note="named in the same breath as the skins; unmeasured if no standalone companion is present")

        record("E04", "and the picture has not simply been made dark instead",
               wide.get("crushed_black_pct", 100.0) <= 12.0
               and 40.0 <= wide.get("mean_luminance", 0.0) <= 170.0,
               player_view_mean=wide.get("mean_luminance"), crushed=wide.get("crushed_black_pct"),
               note="guards the fix: reducing glare by underexposing everything would pass E01 and be worse")

        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 24")
        yield 0.5
    except Exception as err:                                   # noqa: BLE001
        RESULT["error"] = str(err)
        record("E99", "the exposure measurement ran to completion", False, error=str(err))
        try:
            unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 24")
        except Exception:
            pass

    if cap is not None:
        try:
            cap.destroy_actor()
        except Exception:
            pass
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
