# DOES THE SUN'S SHADOW ACTUALLY SHOW AT NIGHT, OR IS THE SECOND CASTER INVISIBLE?
#
# FOUNDER, item 11: "Fix glitching shadows... conflicting lights."
#
# THE DEFECT IS CONFIRMED: from about 18:40 to dawn, V2_Sun and WL_Moon both cast. But a caster that is live
# and a caster that is SEEN are different claims, and the whole question of whether item 11 needs a risky fix
# turns on which one this is. At 23:00 the sun's intensity is 0.0012 against the moon's 0.05, and the world
# lane's own reading of it is that its shadows are "presumably too faint to read even though the caster is
# live". Presumably is not measured.
#
# WHY IT MATTERS MORE THAN THE FLAG. Clearing the sun's cast_shadows is documented in WonderlandDayCycle as
# having taken dusk from 0.103 to 0.191 and lifted the entire night by half -- the sun is the atmosphere
# light, and the approved night is on the founder's preserved list. So if the second caster contributes
# nothing a player can see, the correct action is to DOCUMENT it and leave the night alone, and any fix would
# be spending a locked approval to remove something invisible. If it does show, item 11 has a real visible
# defect and the narrow knob is worth the work.
#
# MY LAST RUN COULD NOT ANSWER THIS. Its census counted the cast_shadows BOOLEAN, which none of the narrow
# knobs touch, so it could not tell a sun that had stopped shadowing from one that had not. This measures the
# PIXELS instead: the dark fraction of a paving patch, which is what a shadow actually is.
#
# AND THE FIRST READ AFTER POSING A CAMERA IS DISCARDED. Last run's baseline came back 0.287 where every
# later read in the same session gave 0.099-0.101, and the odd one out was the one taken immediately after
# the pose. That is a settle rule this project already has written down, and I did not apply it to myself.
# Every reading here is the median of several, with the first thrown away.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import math
import unreal

L = unreal.WonderlandUiTestLibrary
SL = unreal.SystemLibrary

NIGHT_HOUR = 23.0
EYE = (-64.0, -5700.0, 160.0)
YAW = 90.0
SAMPLES = 5               # the first is discarded, the rest are taken as a median
# A shadow is a change in the DARK FRACTION of the ground, not in its mean. A mean over a patch that is
# mostly lit moves very little when a thin shadow crosses it, which is the mistake the water gate made.
MEANINGFUL = 0.02         # 2 percentage points of the patch


def job():
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
    L.focus_game_viewport()
    yield 6.0
    world = ues.get_game_world()

    SL.execute_console_command(world, "wl.Sky.DayMinutes 0")
    SL.execute_console_command(world, "wl.Sky.Hour %0.2f" % NIGHT_HOUR)
    yield 4.0

    def pose():
        L.pose_camera(world, unreal.Vector(*EYE),
                      unreal.Vector(EYE[0] + math.cos(math.radians(YAW)) * 600.0,
                                    EYE[1] + math.sin(math.radians(YAW)) * 600.0, EYE[2] - 120.0), 70.0)

    def read_once():
        try:
            got = L.read_screen_rect(0.30, 0.55, 0.70, 0.90)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})["read"] = str(err)[:140]
            return None
        if not got:
            return None
        p = list(got)
        if p and isinstance(p[0], bool):
            if not p[0]:
                return None
            p = p[1:]
        mean, dark = p[0], float(p[1])
        luma = 0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b
        return (round(luma, 5), round(dark, 5))

    def median(vs):
        s = sorted(vs)
        n = len(s)
        return None if not n else round(s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2]), 5)

    def measure(tag):
        """Median luma and dark fraction, with the FIRST read discarded."""
        pose()
        lumas, darks = [], []
        for i in range(SAMPLES):
            yield 0.8
            row = read_once()
            if row is None:
                continue
            if i == 0:
                continue                 # the settle read, thrown away on purpose
            lumas.append(row[0])
            darks.append(row[1])
        RESULT.setdefault("readings", {})[tag] = {
            "luma": median(lumas), "dark": median(darks),
            "samples_kept": len(darks), "spread_dark": (round(max(darks) - min(darks), 5) if darks else None)}
        emit("S_%s" % tag, "INFO", tag, RESULT["readings"][tag])

    def sun_component():
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DirectionalLight):
            try:
                if "sun" in str(actor.get_actor_label()).lower():
                    return actor.get_component_by_class(unreal.DirectionalLightComponent)
            except Exception:                                       # noqa: BLE001
                continue
        return None

    sun = sun_component()
    record("V00", "the sun's light component was found", sun is not None)
    if sun is None:
        RESULT["status"] = "VOID: no sun"
        return

    yield from measure("sun_shadowing")

    was = None
    try:
        was = sun.get_editor_property("shadow_amount")
        sun.set_editor_property("shadow_amount", 0.0)
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["set"] = str(err)[:140]
    yield 4.0
    yield from measure("sun_not_shadowing")

    if was is not None:
        try:
            sun.set_editor_property("shadow_amount", was)
        except Exception:                                           # noqa: BLE001
            pass
    yield 3.0
    yield from measure("restored")

    on = (RESULT.get("readings") or {}).get("sun_shadowing") or {}
    off = (RESULT.get("readings") or {}).get("sun_not_shadowing") or {}
    back = (RESULT.get("readings") or {}).get("restored") or {}

    # ---- THE CONTROL: the two readings of the SAME state must agree, or the instrument is noise and the
    # comparison between states means nothing.
    repeat = (None if on.get("dark") is None or back.get("dark") is None
              else round(abs(on["dark"] - back["dark"]), 5))
    RESULT["same_state_twice_differs_by"] = repeat
    record("V01", "the same state measured twice gives the same answer",
           repeat is not None and repeat < MEANINGFUL, on=on, restored=back, difference=repeat,
           floor=MEANINGFUL,
           note="THE CONTROL. If shadowing-on and shadowing-restored disagree by as much as the effect being "
                "looked for, the run is measuring drift rather than the sun.")

    delta = (None if on.get("dark") is None or off.get("dark") is None
             else round(on["dark"] - off["dark"], 5))
    RESULT["dark_fraction_the_suns_shadow_is_worth"] = delta
    seen = delta is not None and abs(delta) >= MEANINGFUL
    RESULT["the_suns_shadow_is_visible_at_night"] = seen

    record("V02", "the sun's shadow is INVISIBLE at night, so the second caster costs the player nothing",
           delta is not None and not seen,
           dark_with_sun_shadowing=on.get("dark"), dark_without=off.get("dark"),
           difference=delta, threshold=MEANINGFUL,
           luma_with=on.get("luma"), luma_without=off.get("luma"),
           note="THE DECISION THIS RUN EXISTS FOR. If the sun's shadow cannot be seen, item 11's second "
                "caster is a LATENT defect: real in the actor list, invisible on screen, and not worth "
                "spending a locked founder approval to remove -- the documented attempt lifted the whole "
                "night by half. If it CAN be seen, the defect is visible and the narrow knob is worth the "
                "work. Either way this is the measurement that decides, and nobody had taken it.")

    SL.execute_console_command(world, "wl.Sky.DayMinutes 24")
    try:
        L.release_camera(world)
    except Exception:                                               # noqa: BLE001
        pass
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
