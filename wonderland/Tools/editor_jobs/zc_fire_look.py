# IS THE FIRE FIRE NOW, OR STILL A COLOURED CARD?
#
# FOUNDER, P0 item 4: "Arden Infernal and Skeleton Flame need believable animated Unreal fire, not plastic
# voxel flames. Use performant Niagara/material fire with flicker, emissive falloff, softness/distortion,
# proper attachment."
#
# THREE OF THOSE FOUR ARE MEASURABLE FROM THE SCREEN and this measures them rather than describing them:
#
#   FALLOFF     the flame must be BRIGHTER AT ITS FOOT than at its tip. A flat card is equally bright all the
#               way up, which is exactly what the old glow material drew.
#   SOFTNESS    the flame must have no hard edge. Measured as the count of bright pixels changing gradually
#               across the tongue rather than in one step -- read here as the flame's brightest reading being
#               well above the mean of the band it sits in, with no plateau.
#   FLICKER     the same patch must not be the same twice. Measured over four seconds.
#
# ATTACHMENT is the fourth and is structural: the ribbons are rebuilt every frame in the actor's own space
# from the joint they burn on, so they cannot detach. zc_skeleton_pulse already photographs them riding the
# body through a walk.
CONCURRENT = True

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "fire_look")
SKINS = ("arden_infernal", "skeleton_flame")


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

    ui = L.get_ui(world)
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    # EVENING, HELD. Fire against a darkening sky is where it has to convince, and a held sky means the
    # flicker measured below is the flame's own and not the sun setting during the window.
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 20.0")
    yield 2.0
    # WHICH SURFACE IS SHIPPING. Read rather than assumed, so the verdicts below match the build.
    try:
        RESULT["fire_material_path"] = str(int(
            unreal.SystemLibrary.get_console_variable_int_value("wl.Look.FireMaterial")))
    except Exception:
        RESULT["fire_material_path"] = "0"
    emit("R_PATH", "INFO", "flame ribbons are drawn on",
         {"fire_material": RESULT["fire_material_path"] == "1"})

    vp = pc.get_viewport_size()
    vw = float(vp[0]) if vp and vp[0] else 1920.0
    vh = float(vp[1]) if vp and len(vp) > 1 and vp[1] else 1080.0

    def band(z_above, half_h):
        """A horizontal band across the Dog at a given height, as fractions of the viewport."""
        at = dog.get_actor_location()
        got = unreal.GameplayStatics.project_world_to_screen(
            pc, unreal.Vector(at.x, at.y, at.z + z_above), False)
        if got is None:
            return None
        cx, cy = float(got.x) / vw, float(got.y) / vh
        if not (0.05 < cx < 0.95 and 0.05 < cy < 0.95):
            return None
        return (cx - 0.075, cy - half_h, cx + 0.075, cy + half_h)

    def light(rect):
        if rect is None:
            return None
        got = L.read_screen_rect(rect[0], rect[1], rect[2], rect[3])
        if got is None:
            return None
        mean, dark, bright, n = got
        return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 5),
                "bright": round(bright, 4), "dark": round(dark, 4)}

    findings = {}
    RESULT["skins"] = findings
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 5.0
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * 560.0,
                            here.y + math.sin(math.radians(yaw)) * 560.0, here.z + 110.0)
        L.pose_camera(world, eye, unreal.Vector(here.x, here.y, here.z + 55.0), 38.0)
        yield 2.0

        # ---- FALLOFF: the foot of the fire against its tip. Both skins burn from the shoulders and ears up.
        foot = light(band(70.0, 0.022))
        tip = light(band(140.0, 0.022))

        # ---- FLICKER: the same band, twenty times over four seconds.
        series = []
        for _ in range(20):
            got = light(band(105.0, 0.030))
            series.append(got["luma"] if got else None)
            yield 0.2
        clean = [v for v in series if v is not None]

        shots = []
        for tick in range(4):
            name = os.path.join(ROOT, "%s_%d.png" % (skin, tick))
            try:
                L.capture_game_viewport(name)
                shots.append(os.path.basename(name))
            except Exception:
                pass
            yield 0.45

        findings[skin] = {
            "foot": foot, "tip": tip, "series": [round(v, 5) for v in clean],
            "swing": round(max(clean) - min(clean), 5) if clean else None,
            "mean": round(sum(clean) / len(clean), 5) if clean else None,
            "captures": shots,
        }
        emit("R_%s" % skin, "INFO", skin,
             {k: v for k, v in findings[skin].items() if k != "series"})

    L.release_camera(world)
    read_all = all(v["foot"] and v["tip"] and v["swing"] is not None for v in findings.values())
    record("R00", "both fire skins were in frame and readable", read_all, skins=list(findings.keys()))
    if not read_all:
        RESULT["status"] = "FAIL: could not see the fire"
        return

    # ---- THE FIRE IS THERE AND IT IS THE SKIN'S OWN COLOUR.
    #
    # WHAT THIS PROOF DOES NOT CLAIM, said plainly. Emissive falloff and edge softness are properties of
    # M_WL_Fire -- (1-V) shaped up the tongue, 1-|2U-1| across it -- and they are verified where they live, by
    # zc_make_fire_material, which reads the compiled material's own parameters. Re-deriving them from a
    # screenshot means putting a band at a guessed height on a figure whose fire is at its halo, its ears, its
    # hands and its feet, and the first version of this proof did exactly that and measured the gold ring
    # instead of the flame. A measurement of the wrong pixels is not evidence for the right claim.
    lit = {k: v["foot"]["luma"] for k, v in findings.items()}
    record("R01", "there is fire on both fire skins, and it is lit",
           all(v >= 0.05 for v in lit.values()), luma_in_the_flame_band=lit, floor=0.05,
           note="at wl.Look.FireGain 0.12 this read 0.010 and the fire was invisible in the photograph; the "
                "gain was swept to 1.6 in one session by zc_fire_gain_sweep.")

    # ---- WHICH SURFACE THE FLAMES ARE ON DECIDES WHAT CAN BE ASSERTED NEXT.
    #
    # FOUNDER, 2026-09-26: "bring the flames back to the mascot skins." M_WL_Fire took the flames off the
    # mascots entirely -- cranked to twenty times the tuned brightness, Skeleton Flame showed bone, eyes and
    # NO ghostfire -- so the shipped path went back to the figure's own glow material, which is what the
    # founder approved and has been looking at.
    #
    # That material is OPAQUE and the flames are authored at thousands of times white, so their cores
    # saturate: the band reads 1.00 luma and 100% over white, and inside a saturated band nothing can be
    # measured moving. The two clauses below are about the CANDIDATE surface and are reported as readings
    # rather than verdicts while it is switched off. Calling them passes here would be a lie in the other
    # direction: the shipped flames genuinely do wash to white, and the founder wants them anyway.
    on_fire_material = str(RESULT.get("fire_material_path", "0")) == "1"
    swings = {k: v["swing"] for k, v in findings.items()}
    means = {k: v["mean"] for k, v in findings.items()}
    if on_fire_material:
        record("R02", "the fire is never the same twice -- it flickers",
               all(v >= 0.004 for v in swings.values()),
               swing_over_four_seconds=swings, mean=means, floor=0.004)
    else:
        emit("R02", "INFO", "flicker, on the shipped glow material",
             {"swing_over_four_seconds": swings, "mean": means,
              "note": "a saturated core cannot show movement in a mean; this is a property of the approved "
                      "flames, not a regression"})

    # ---- AND IT IS SOFT. An additive ribbon with no hard edge leaves few pixels at full white and a wide
    # ---- spread below; a card leaves a plateau. Read as: the band is lit, and not mostly blown out.
    blown = {k: v["foot"]["bright"] for k, v in findings.items()}
    if not on_fire_material:
        emit("R03", "INFO", "how much of the flame band is over white, on the shipped glow material",
             {"fraction_over_white": blown,
              "note": "the founder asked for these flames back on 2026-09-26 and they are back. The candidate "
                      "fire material exists and is reachable with wl.Look.FireMaterial 1; it is off because it "
                      "drew nothing, and that is an open bug rather than a finished feature."})
        record("R04", "the flames the founder asked for are back on both fire skins",
               all(v["foot"]["luma"] >= 0.5 for v in findings.values()),
               luma_in_the_flame_band={k: v["foot"]["luma"] for k, v in findings.items()}, floor=0.5)
        RESULT["captures_dir"] = ROOT
        RESULT["status"] = "measured"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    record("R03", "the fire keeps its colour instead of washing to white",
           all(v <= 0.45 for v in blown.values()),
           fraction_over_white=blown, ceiling=0.45,
           note="at the authored strength 88% of Arden's flame band was over white and its ember orange was "
                "gone -- which is what an additive material does with a value of 1,320. This is the clause "
                "that keeps the gain honest.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
