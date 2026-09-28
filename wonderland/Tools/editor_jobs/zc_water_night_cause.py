# WHY DOES THE WATER GO BLACK AT DUSK AND NIGHT? READ THE SURFACE, DO NOT GUESS AT IT.
#
# FOUNDER, P2 item 10: "Replace plastic-looking water/streams/ponds/fountains with believable animated water:
# reflections/refraction, normals, depth/color response, flow, sane performance."
#
# ITEM 10 IS NOT UNSTARTED, which is worth saying because the item reads as though it were. M_WL_RealWater
# exists, the level's ponds, canals, wells and basins wear it, it is translucent, it flows, and it stops when
# the world is paused -- zc_water 5/5. What is open is zzN2_water_audit's A03: at dusk and night the water
# reads as a black hole rather than as water.
#
# AND THE AUDIT'S OWN GATE IS A BAD INSTRUMENT, so the finding had to be re-established before acting on it.
# A03 fails a view whose CRUSHED FRACTION passes 0.85, and the world lane has since measured that the
# APPROVED night scores 0.9756 crushed by that same fixed-luma test. Every surface fails that ceiling at
# night, including ones the founder signed off. What rescues the finding is that the audit also recorded the
# whole frame beside the water:
#
#     day    water 0.24-0.33 luma    frame 0.26-0.32    ratio ~1.0
#     dusk   water 0.006-0.010       frame 0.032-0.036  ratio 0.18-0.27
#     night  water 0.019-0.044       frame 0.062        ratio 0.31-0.70
#
# The water tracks its surroundings in daylight and falls to a fifth of them at dusk. That is a statement
# about the WATER, not about the exposure, and it survives the better instrument.
#
# ONE HYPOTHESIS IS ALREADY DEAD, killed by reading rather than by a build: I assumed the translucency
# lighting mode would be the volumetric default, which gets no specular at all. It is already
# TLM_SURFACE_PER_PIXEL_LIGHTING. That is the correct setting and it is not the fault.
#
# WHAT THIS ASKS. A translucent surface shows three things: what is behind it, what it reflects, and its own
# lit response. In daylight the pond BED is lit, so refraction alone carries the surface even with no
# reflection whatever. At night the bed is dark, and if there is no reflection the surface has nothing left to
# show. So the question is whether reflections are enabled on this material at all -- the job that builds it
# carries a comment saying "a screen-space reflection needs to be allowed to run" and then never sets a
# property to allow it.
#
# THIS TOUCHES NOTHING. It reads the master, the instances, and the components that wear them, and writes no
# asset. Another lane is inside the day cycle right now and an item 10 fix must not arrive as a surprise in
# their lighting readings.
#
# NO PIE. Nothing here needs play, so this does not take the world from anyone.

import unreal

MASTER = "/Game/Wonderland/Materials/M_WL_RealWater.M_WL_RealWater"

# The name for "let this translucent surface reflect" has moved between engine versions, and guessing one and
# finding it absent proves nothing. Every plausible spelling is asked for and the ones that exist are reported.
REFLECTION_PROPS = (
    "screen_space_reflections",
    "b_screen_space_reflections",
    "allow_screen_space_reflection",
    "translucency_screen_space_reflections",
    "b_enable_responsive_aa",
    "dynamic_shadow_and_specular",
)
SURFACE_PROPS = (
    "blend_mode", "translucency_lighting_mode", "two_sided", "refraction_method",
    "shading_model", "translucency_pass", "b_used_with_static_lighting",
    "translucency_directional_lighting_intensity",
)
SCALARS = ("Roughness", "Specular", "Metallic", "Refraction", "Opacity", "Flow", "TexScale")


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    master = None
    try:
        master = unreal.load_asset(MASTER)
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["load"] = str(err)[:160]
    record("N00", "the water master material loads", master is not None, path=MASTER)
    if master is None:
        RESULT["status"] = "VOID: no master material"
        return

    def read_props(obj, names):
        out = {}
        for n in names:
            try:
                out[n] = str(obj.get_editor_property(n))
            except Exception:                                       # noqa: BLE001
                out[n] = None          # the property does not exist on this engine version
        return out

    surface = read_props(master, SURFACE_PROPS)
    reflect = read_props(master, REFLECTION_PROPS)
    RESULT["master_surface"] = surface
    RESULT["master_reflection_props"] = reflect

    present = {k: v for k, v in reflect.items() if v is not None}
    RESULT["reflection_properties_that_exist"] = present
    emit("N_REFLECT", "INFO", "what the engine calls the reflection switch here", present)

    # ---- THE QUESTION. Any reflection switch that exists and reads False is a surface that cannot reflect,
    # which at night leaves refraction of an unlit bed as the only thing it can show.
    off = sorted(k for k, v in present.items() if str(v).lower() in ("false", "0"))
    RESULT["reflection_switches_that_are_off"] = off or None
    record("N01", "the water surface is allowed to reflect",
           bool(present) and not off, present=present, off=off or None,
           note="A translucent surface shows what is behind it, what it reflects, and its own lit response. "
                "In daylight the pond BED is lit and refraction alone carries the surface with no reflection "
                "at all -- which is why this has never shown up by day. At night the bed is dark and a "
                "surface that cannot reflect has nothing left to show. The builder's own comment says a "
                "screen-space reflection 'needs to be allowed to run' and then sets no property.")

    record("N02", "the translucency lighting mode is the per-pixel surface one, so specular exists",
           "SURFACE_PER_PIXEL" in str(surface.get("translucency_lighting_mode", "")).upper(),
           translucency_lighting_mode=surface.get("translucency_lighting_mode"),
           note="ALREADY VERIFIED BY READING, recorded so the refuted hypothesis stays refuted. The "
                "volumetric default gets no specular whatever; this is not that, and it is not the fault.")

    # ---- AND WHAT THE LEVEL ACTUALLY WEARS, because a master nobody uses is not the subject.
    wearers = {}
    instances = set()
    try:
        ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
        world = ues.get_editor_world()
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
            for comp in actor.get_components_by_class(unreal.PrimitiveComponent):
                try:
                    count = comp.get_num_materials()
                except Exception:                                   # noqa: BLE001
                    continue
                for slot in range(count):
                    try:
                        mat = comp.get_material(slot)
                    except Exception:                               # noqa: BLE001
                        continue
                    if mat is None:
                        continue
                    name = mat.get_name()
                    if "Water" not in name and "water" not in name:
                        continue
                    instances.add(name)
                    wearers[name] = wearers.get(name, 0) + 1
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["level"] = str(err)[:160]
    RESULT["water_materials_in_the_level"] = wearers
    record("N03", "something in the level is actually wearing a water material",
           bool(wearers), materials=wearers,
           note="a master that nothing wears is not the surface the founder is looking at. zzN2's A01 "
                "already measured this; it is re-read here so the diagnosis is anchored to the drawn thing.")

    # the scalars the master ships, so a later comparison can tell a tuned instance from the master's defaults
    defaults = {}
    for s in SCALARS:
        try:
            defaults[s] = round(float(
                unreal.MaterialEditingLibrary.get_material_default_scalar_parameter_value(
                    master, unreal.Name(s))), 4)
        except Exception:                                           # noqa: BLE001
            defaults[s] = None
    RESULT["master_scalar_defaults"] = defaults
    emit("N_SCALARS", "INFO", "the master's own scalar defaults", defaults)

    RESULT["status"] = "measured"
    yield 0.1
