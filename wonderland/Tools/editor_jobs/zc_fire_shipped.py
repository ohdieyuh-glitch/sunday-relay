# DOES A FRESH PIE DRAW THE APPROVED FIRE WITHOUT ANYONE TYPING A CONSOLE COMMAND?
#
# FOUNDER, P0 item 4: "believable animated Unreal fire, not plastic voxel flames... with flicker, emissive
# falloff, softness/distortion." Then, 2026-09-28: "I approved the real fire."
#
# WHAT CHANGED AND WHY THIS IS NOT THE SAME QUESTION zc_fire_params ASKED. That job set
# `wl.Look.FireMaterial 1` itself and then checked the drawn figure was using M_WL_Fire. It passed. But the
# SHIPPED default was 0, so what it proved was "the material works when switched on", and I reported item 4 as
# implemented on that basis. A founder booting the game saw the old plume.
#
# The default is now 1. So the question is different and much simpler: with NOBODY TOUCHING THE KNOB, does the
# flame a dressed mascot draws come from M_WL_Fire? That is the difference between a feature that exists and a
# feature that ships, and it is the whole of what was outstanding on item 4.
#
# THE CONTROL IS THE POINT OF THE RUN, because the obvious reading is the one that passes for the wrong reason.
# "A material with Fire in its name was found on the figure" is worth nothing on its own: if some fire surface
# is present in both states, the clause is satisfied by a figure that ignores the knob entirely. So this reads
# the figure at the DEFAULT, then explicitly sets 0, re-dresses, and reads again. The material must be there in
# the first state and GONE in the second. A reading that is the same in both means the instrument is measuring
# something that does not depend on the setting, and the run says so instead of claiming a pass.
#
# AND IT READS THE ASSET TOO, because the founder approved a particular surface, not the name. The translucent
# blend mode and the softened EdgeSoftness/TipFalloff are what distinguishes the approved material from the
# additive one it replaced; if the asset on disk has reverted, the figure can be using "M_WL_Fire" and still be
# drawing the thing that was rejected.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "fire_shipped")
MATERIAL = "/Game/Wonderland/Materials/M_WL_Fire.M_WL_Fire"
# The values the approved surface carries. Softness and falloff are the shaping the founder compared against
# the additive plume; they are recorded here so a silent revert of the asset cannot pass as a shipped fire.
WANT_SCALARS = {"EdgeSoftness": 2.6, "TipFalloff": 2.2}
SKINS = ("arden_infernal", "skeleton_flame")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".png", ".jpg")):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    # ---- THE ASSET, before PIE. What the founder approved is a surface, not a name.
    asset = None
    try:
        asset = unreal.load_asset(MATERIAL)
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["load"] = str(err)[:140]

    on_disk = {}
    for name, want in WANT_SCALARS.items():
        try:
            on_disk[name] = round(float(
                unreal.MaterialEditingLibrary.get_material_default_scalar_parameter_value(
                    asset, unreal.Name(name))), 4)
        except Exception as err:                                    # noqa: BLE001
            on_disk[name] = None
            RESULT.setdefault("errors", {})["scalar/%s" % name] = str(err)[:140]
    blend = None
    try:
        blend = str(asset.get_editor_property("blend_mode"))
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["blend"] = str(err)[:140]
    RESULT["asset"] = {"scalars": on_disk, "blend_mode": blend}
    record("F00", "the approved flame surface is still what is on disk: translucent, softened, tapered",
           blend is not None and "TRANSLUCENT" in blend.upper()
           and all(on_disk.get(k) is not None and abs(on_disk[k] - v) < 0.01
                   for k, v in WANT_SCALARS.items()),
           blend_mode=blend, scalars=on_disk, wanted=WANT_SCALARS,
           note="the founder approved a SURFACE. Translucent rather than additive, with the noise-cut edge "
                "and the tip falloff, is what distinguishes it from the plume it replaced -- so a silent "
                "revert of the asset must not be able to pass as a shipped fire just because the name "
                "matches.")

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

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    if ui is None or dog is None:
        RESULT["status"] = "VOID: no UI subsystem or no pawn"
        return

    # ---- THE SHIPPED DEFAULT, READ AND NOT SET. Nothing above or below writes this before it is read.
    shipped = unreal.SystemLibrary.get_console_variable_int_value("wl.Look.FireMaterial")
    RESULT["shipped_default"] = shipped
    record("F01", "a fresh session already has the fire material on, with nobody typing anything",
           shipped == 1, wl_Look_FireMaterial=shipped,
           note="THE DIFFERENCE BETWEEN IMPLEMENTED AND SHIPPED. zc_fire_params set this to 1 itself and "
                "then proved the material worked, which is why item 4 was reported as done while a founder "
                "booting the game still saw the old plume.")

    def costume():
        for actor in unreal.GameplayStatics.get_all_actors_of_class(
                world, unreal.WonderlandCompanionEmbodiment):
            if actor.get_attach_parent_actor() == dog:
                return actor
        return None

    def fire_materials(worn):
        """Every material on the drawn figure whose name mentions Fire, and the scalars it carries."""
        seen, values = [], {}
        if worn is None:
            return seen, values
        for comp in worn.get_components_by_class(unreal.PrimitiveComponent):
            try:
                count = comp.get_num_materials()
            except Exception:                                       # noqa: BLE001
                continue
            for slot in range(count):
                try:
                    mat = comp.get_material(slot)
                except Exception:                                   # noqa: BLE001
                    continue
                if mat is None or "Fire" not in mat.get_name():
                    continue
                seen.append(mat.get_name())
                for pname in WANT_SCALARS:
                    try:
                        values.setdefault(pname, set()).add(
                            round(float(mat.get_scalar_parameter_value(unreal.Name(pname))), 3))
                    except Exception:                               # noqa: BLE001
                        pass
        return seen, {k: sorted(v) for k, v in values.items()}

    readings = {}
    RESULT["readings"] = readings

    def look(state):
        per = {}
        for skin in SKINS:
            try:
                ui.wear_relay_skin(skin)
            except Exception as err:                                # noqa: BLE001
                RESULT.setdefault("errors", {})["%s/%s" % (state, skin)] = str(err)[:140]
                continue
            yield 7.0
            worn = costume()
            seen, values = fire_materials(worn)
            shot = os.path.join(ROOT, "%s_%s.png" % (state, skin))
            try:
                L.capture_game_viewport(shot)
            except Exception:                                       # noqa: BLE001
                pass
            per[skin] = {"fire_materials": sorted(set(seen)), "count": len(seen),
                         "scalars_on_the_drawn_instance": values,
                         "capture": os.path.basename(shot)}
            emit("F_%s_%s" % (state, skin), "INFO", "%s / %s" % (state, skin), per[skin])
        readings[state] = per

    # AT THE DEFAULT, untouched.
    yield from look("default")

    # ---- AND NOW EXPLICITLY OFF, which is the control. The fire surface must DISAPPEAR.
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireMaterial 0")
    yield 2.0
    yield from look("forced_off")

    # put the shipped state back before anything else can read it
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireMaterial 1")
    yield 1.5
    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass
    yield 3.0
    RESULT["restored"] = {
        "skin": str(dog.get_worn_skin_id()),
        "wl_Look_FireMaterial": unreal.SystemLibrary.get_console_variable_int_value("wl.Look.FireMaterial")}
    record("F_RESTORE", "Relay OG is back on the Dog and the shipped fire setting is restored",
           "relay_og" in RESULT["restored"]["skin"].lower()
           and RESULT["restored"]["wl_Look_FireMaterial"] == 1, **RESULT["restored"])

    at_default = readings.get("default") or {}
    when_off = readings.get("forced_off") or {}

    drew = sorted(s for s in SKINS if (at_default.get(s) or {}).get("count", 0) > 0)
    RESULT["skins_drawing_the_fire_material_by_default"] = drew
    record("F02", "every flame mascot draws the approved fire material at the shipped default",
           len(drew) == len(SKINS), drew=drew, wanted=sorted(SKINS),
           per_skin={s: (at_default.get(s) or {}).get("fire_materials") for s in SKINS},
           note="read off the instance the figure is WEARING, not off the asset -- an approved material that "
                "no component references is not a shipped fire.")

    # THE CONTROL. If the reading is the same with the knob off, it does not depend on the knob and F02 is
    # satisfied by something that was always there.
    still = sorted(s for s in SKINS if (when_off.get(s) or {}).get("count", 0) > 0)
    RESULT["skins_still_showing_fire_with_the_knob_off"] = still or None
    record("F03", "with the knob forced off the fire material is gone, so the reading tracks the setting",
           not still, still_present=still or None,
           per_skin={s: (when_off.get(s) or {}).get("fire_materials") for s in SKINS},
           note="THE CONTROL, and the reason this run is worth doing. 'A material with Fire in its name was "
                "found' proves nothing if it is found in both states: the clause would be satisfied by a "
                "figure that ignores the setting entirely.")

    # And the drawn instance must carry the approved shaping, not merely the approved name.
    softened = []
    for s in SKINS:
        vals = (at_default.get(s) or {}).get("scalars_on_the_drawn_instance") or {}
        ok = all(vals.get(k) and all(abs(v - WANT_SCALARS[k]) < 0.01 for v in vals[k])
                 for k in WANT_SCALARS)
        if ok:
            softened.append(s)
    RESULT["skins_whose_drawn_instance_is_softened"] = softened
    record("F04", "the flame being DRAWN carries the approved softness and falloff, not just the right name",
           len(softened) == len(SKINS), softened=softened, wanted=sorted(SKINS), values=WANT_SCALARS,
           per_skin={s: (at_default.get(s) or {}).get("scalars_on_the_drawn_instance") for s in SKINS},
           note="a material instance can override its parent's scalars. The founder approved the shaped "
                "surface, so the shaping has to survive to the instance that renders.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
