# WHAT IS THE WATER ACTUALLY MADE OF, AND WHAT DOES IT LOOK LIKE FROM WHERE A PLAYER STANDS?
#
# FOUNDER (2026-09-27): water is a BETA requirement -- "not plastic, cartoonish, flat blue, glossy solid, or
# an artificial game-water sheet"; wanted: roughness variation, reflections, Fresnel, depth colouration,
# shallow-to-deep transition, subtle normal movement, MULTIPLE WAVE SCALES, believable highlights,
# refraction, shoreline interaction, night reflection of nearby light "without becoming a glowing blue
# sheet". "Audit and improve the existing implementation rather than replacing it blindly." "Inspect from
# shoreline distance, close range, elevated, and a moving player view, at day/dusk/night."
#
# WHAT EXISTS. UWonderlandDayCycleSubsystem dresses every MI_V2_Water surface at runtime in a dynamic
# instance of M_WL_RealWater -- translucent, two panning normals, depth fade, refraction -- and paints its
# colour by hour. zc_water proves it is translucent and moving. Nothing has ever listed what the master
# EXPOSES, so "improve the existing implementation" has had no inventory to start from. This is that
# inventory, plus the founder's nine views.
#
# IT SAVES NOTHING AND CHANGES NOTHING. It reads the material's parameters off a dressed surface, photographs
# the Water Gardens from three ranges at three hours, and reports the numbers beside the pictures. The
# judgement -- plastic or wet -- is the founder's; this gives him the evidence and a parameter list to move.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "water_audit")

#: The Water Gardens anchor (travel registry) is on the lawn beside the garden's bridge arc.
WATER = (-4849.0, -11480.0, 480.0)
#: (label, eye offset from the water point, look-at offset). Close, shoreline, elevated.
VIEWS = (
    ("close",     (350.0, 250.0, 140.0),   (0.0, 0.0, -20.0)),
    ("shoreline", (1400.0, 900.0, 220.0),  (0.0, 0.0, 0.0)),
    ("elevated",  (2200.0, 1600.0, 900.0), (0.0, 0.0, 0.0)),
)
HOURS = ((12.0, "day"), (18.5, "dusk"), (0.0, "night"))


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests
    os.makedirs(ROOT, exist_ok=True)

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

    def live():
        """The world, re-fetched at every use -- never a reference captured once and held.

        A held reference goes stale across long jobs and the failure is silent for some APIs: pose_camera
        throws "Cannot nativize 'World' as 'Object'" (which killed this job on 2026-09-27), while
        get_all_actors_with_tag simply returns an empty list that reads like an empty world.
        """
        return ues.get_game_world()

    def alive():
        """The world AND the pawn, or None. Gate every reading on this.

        When PIE is torn down mid-job the reads do not fail -- they return a constant black frame, which is
        indistinguishable from a legitimately dark scene. Any job that records a number after this returns
        None is publishing the dark as data.
        """
        w = ues.get_game_world()
        if w is None:
            return None
        try:
            return w if unreal.GameplayStatics.get_player_pawn(w, 0) is not None else None
        except Exception:                                              # noqa: BLE001
            return None
    L.focus_game_viewport()
    unreal.SystemLibrary.execute_console_command(live(), "wl.Sky.DayMinutes 0")
    dog = unreal.GameplayStatics.get_player_pawn(live(), 0)
    try:
        dog.set_actor_location(unreal.Vector(WATER[0] + 900.0, WATER[1] + 600.0, WATER[2] + 200.0), False, False)
    except Exception:                                                 # noqa: BLE001
        pass
    yield 5.0

    # ---- THE INVENTORY: the master's parameters and the live values on a dressed surface.
    master = {}
    try:
        real = unreal.load_asset("/Game/Wonderland/Materials/M_WL_RealWater.M_WL_RealWater")
        if real is not None:
            master["blend_mode"] = str(real.get_editor_property("blend_mode"))
            master["shading_model"] = str(real.get_editor_property("shading_model"))
            try:
                master["translucency_lighting"] = str(real.get_editor_property("translucency_lighting_mode"))
            except Exception:                                         # noqa: BLE001
                pass
            names = {}
            for kind, getter in (("scalar", unreal.MaterialEditingLibrary.get_scalar_parameter_names),
                                 ("vector", unreal.MaterialEditingLibrary.get_vector_parameter_names),
                                 ("texture", unreal.MaterialEditingLibrary.get_texture_parameter_names)):
                try:
                    names[kind] = [str(n) for n in getter(real)]
                except Exception as err:                              # noqa: BLE001
                    names[kind] = "unreadable: %s" % str(err)[:60]
            master["parameters"] = names
    except Exception as err:                                          # noqa: BLE001
        master["error"] = str(err)[:120]
    RESULT["master"] = master

    # RENAMED from `live`, which collided with the live() world helper the hardening pass introduced --
    # `live()` then called this dict and raised "'dict' object is not callable".
    live_values = {}
    dressed = 0
    for actor in unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.StaticMeshActor):
        comp = actor.static_mesh_component
        if comp is None:
            continue
        for slot in range(comp.get_num_materials()):
            mat = comp.get_material(slot)
            if mat is None or "RealWater" not in mat.get_name():
                continue
            dressed += 1
            if not live_values:
                live_values["surface"] = str(actor.get_actor_label())
                live_values["material"] = str(mat.get_name())
                vals = {}
                for pname in (master.get("parameters") or {}).get("scalar", []) if isinstance(master.get("parameters"), dict) else []:
                    try:
                        vals[pname] = round(float(mat.get_scalar_parameter_value(unreal.Name(pname))), 4)
                    except Exception:                                 # noqa: BLE001
                        pass
                for pname in (master.get("parameters") or {}).get("vector", []) if isinstance(master.get("parameters"), dict) else []:
                    try:
                        c = mat.get_vector_parameter_value(unreal.Name(pname))
                        vals[pname] = [round(c.r, 3), round(c.g, 3), round(c.b, 3), round(c.a, 3)]
                    except Exception:                                 # noqa: BLE001
                        pass
                live_values["values"] = vals
    live_values["surfaces_dressed"] = dressed
    RESULT["live"] = live_values

    # ---- THE NINE VIEWS, with the same luma/clip metric the exposure proofs use, on the viewport.
    def patch(cx, cy, hw, hh):
        got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
        if got is None:
            return None
        mean, dark, bright, sampled = got
        return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4),
                "dark": round(dark, 4), "bright": round(bright, 4),
                "blue_over_red": round((mean.b + 1e-4) / (mean.r + 1e-4), 3)}

    def settled(label, tries=20, step=1.0, tol=0.004):
        """Wait until the picture STOPS MOVING, not for a number of seconds.

        A fixed `yield 3.0` is not a fixed amount of settling: at 389 ms per frame it is 7.7 frames and at
        31 ms it is 95.6. The whole job tree waited in seconds through a day when a render-thread regression
        had the frame at 389 ms, so every timed settle delivered about an eighth of the frames it was
        written for -- and will silently start delivering all of them now, with nothing in either run saying
        which it got.

        This is the same test at any frame rate: two consecutive readings of the same framing within `tol`.
        Returns the seconds it took, or None if it never settled, so a run can say so rather than assume it.
        """
        prev = None
        for attempt in range(tries):
            yield step
            now = patch(0.5, 0.5, 0.46, 0.44)
            if now is None:
                continue
            if prev is not None and abs(now["luma"] - prev["luma"]) < tol:
                RESULT.setdefault("settled_s", {})[label] = round(step * (attempt + 1), 1)
                return
            prev = now
        RESULT.setdefault("settled_s", {})[label] = None

    shots = {}
    RESULT["views"] = shots
    for hour, hlabel in HOURS:
        unreal.SystemLibrary.execute_console_command(live(), "wl.Sky.Hour %.2f" % hour)
        # AN HOUR CHANGE DRIVES THE WHOLE SKY, and three seconds was 7.7 frames of it during the
        # render-thread regression. Wait for the picture instead.
        for step in settled("hour_%s" % hlabel):
            yield step
        for vlabel, eo, lo in VIEWS:
            eye = unreal.Vector(WATER[0] + eo[0], WATER[1] + eo[1], WATER[2] + eo[2])
            at = unreal.Vector(WATER[0] + lo[0], WATER[1] + lo[1], WATER[2] + lo[2])
            L.pose_camera(live(), eye, at, 60.0)
            yield 3.0
            name = "%s_%s" % (hlabel, vlabel)
            path = os.path.join(ROOT, name + ".png")
            try:
                L.capture_game_viewport(path)
            except Exception:                                         # noqa: BLE001
                pass
            # the water fills the lower-middle of these framings
            shots[name] = {"file": os.path.basename(path), "water": patch(0.5, 0.66, 0.22, 0.16),
                           "frame": patch(0.5, 0.5, 0.46, 0.44)}
    L.release_camera(live())

    record("A00", "the master material was read and exposes named parameters",
           isinstance(master.get("parameters"), dict) and any(master["parameters"].values()),
           master=master)
    record("A01", "the water in the level wears M_WL_RealWater, with live values read off a surface",
           dressed > 0 and bool(live_values.get("values")), surfaces=dressed, live=live_values)
    record("A02", "all nine founder views were photographed with the water in frame",
           len(shots) == 9 and all(v["water"] for v in shots.values()), views=sorted(shots))
    night = shots.get("night_shoreline", {}).get("water")
    day = shots.get("day_shoreline", {}).get("water")
    # THIS GATE PASSED WATER THAT WAS 99% BLACK, AND THAT IS RECORDED RATHER THAN QUIETLY RETUNED.
    #
    # The first run returned night_shoreline luma 0.0314 with dark 0.9903 -- ninety-nine per cent of the
    # water patch crushed -- and A03 went green because the MEAN squeaked over a 0.03 floor. A mean is the
    # wrong statistic for "is it black": a handful of specular pixels on an otherwise dead surface carries
    # it over the line. The founder's requirement is that water read as water at night, so the crushed
    # fraction is now the gate and the mean is only a companion.
    dusk = (shots.get("dusk_shoreline") or {}).get("water")
    dark_enough = [k for k, v in shots.items()
                   if (v.get("water") or {}).get("dark", 1.0) > 0.85]
    record("A03", "at night and dusk the water reads as water -- not a black hole, not a glowing blue sheet",
           night is not None and night["dark"] <= 0.85 and night["luma"] <= 0.35
           and night["blue_over_red"] <= 2.5 and not dark_enough,
           night=night, dusk=dusk, day=day, crushed_ceiling=0.85,
           views_over_85pct_crushed=sorted(dark_enough),
           note="gated on the CRUSHED FRACTION, because a mean of 0.03 passed a surface that was 99% "
                "black; over 0.35 luma or a blue/red ratio past 2.5 is the glowing sheet the founder named")
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
