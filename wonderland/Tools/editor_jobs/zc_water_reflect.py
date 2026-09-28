# LET THE WATER REFLECT AND REFRACT. IT HAS BEEN DOING NEITHER.
#
# FOUNDER, P2 item 10: "Replace plastic-looking water/streams/ponds/fountains with believable animated water:
# REFLECTIONS/REFRACTION, normals, depth/color response, flow, sane performance."
#
# M_WL_RealWater was built for that sentence and, read off the asset, does not satisfy two of its words:
#
#     screen_space_reflections   False
#     refraction_method          RM_NONE
#
# BOTH ARE THE SAME KIND OF MISS, and neither is a tuning choice. The builder sets the blend mode and the
# translucency lighting mode explicitly and correctly, then carries a comment saying "a screen-space
# reflection needs to be allowed to run" and never sets a property to allow it; and it tries THREE guessed
# spellings of the refraction enum in a try/except loop, so when none of them matched on this engine the
# material was simply left at RM_NONE and the loop reported nothing. A guarded guess that silently does
# nothing is worse than no attempt, because it leaves a comment claiming the opposite.
#
# WHY IT ONLY SHOWS AT NIGHT, which is what made it survive. A translucent surface shows three things: what
# is behind it, what it reflects, and its own lit response. By DAY the pond bed is lit, so the surface reads
# perfectly well with no reflection at all -- measured, water luma 0.24-0.33 against a frame of 0.26-0.32, a
# ratio of about 1.0. At NIGHT the bed is dark and a surface that cannot reflect has nothing left to show:
# water 0.006-0.044 against a frame of 0.032-0.062, a fifth to a third of its surroundings. The founder's
# "black hole" is a surface with no reflection, photographed after dark.
#
# THE ENUM IS ENUMERATED, NOT GUESSED. The previous attempt failed by trying three names it hoped existed.
# This reads what unreal.RefractionMode actually offers on THIS engine, reports it, and picks from what is
# there -- so a future engine that renames it fails loudly instead of quietly doing nothing.
#
# AND THE READBACK IS THE RESULT. Setting a property and saving is not evidence it took; four separate
# conclusions this week were withdrawn for exactly that. Every value is re-read from the asset after the save
# and the clauses are written against the re-read, not against the set.
#
# BACKUP TAKEN BEFORE THIS RUNS: recovery/_asset_backups/M_WL_RealWater.<stamp>.uasset, because Content is
# not under version control and there is no other way back.
#
# NO PIE. This edits and saves an asset; it does not need the world, and another lane is using it.

import unreal

MASTER = "/Game/Wonderland/Materials/M_WL_RealWater.M_WL_RealWater"


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    master = unreal.load_asset(MASTER)
    record("R00", "the water master loads", master is not None, path=MASTER)
    if master is None:
        RESULT["status"] = "VOID: no master"
        return

    def read(name):
        try:
            return str(master.get_editor_property(name))
        except Exception:                                           # noqa: BLE001
            return None

    before = {"screen_space_reflections": read("screen_space_reflections"),
              "refraction_method": read("refraction_method"),
              "blend_mode": read("blend_mode"),
              "translucency_lighting_mode": read("translucency_lighting_mode")}
    RESULT["before"] = before
    emit("R_BEFORE", "INFO", "what the surface was", before)

    # ---- WHAT THIS ENGINE ACTUALLY CALLS THE REFRACTION MODES.
    modes = [n for n in dir(unreal.RefractionMode) if n.isupper()]
    RESULT["refraction_modes_this_engine_offers"] = modes
    emit("R_MODES", "INFO", "the RefractionMode values that exist here", {"modes": modes})

    # Index of refraction is the physical one and the one water wants: it bends by a ratio rather than
    # offsetting by a normal. Pixel normal offset is the fallback -- cheaper, and still refraction.
    wanted = None
    for prefer in ("RM_INDEX_OF_REFRACTION", "REFRACTION_MODE_INDEX_OF_REFRACTION", "INDEX_OF_REFRACTION",
                   "RM_PIXEL_NORMAL_OFFSET", "REFRACTION_MODE_PIXEL_NORMAL_OFFSET", "PIXEL_NORMAL_OFFSET"):
        if prefer in modes:
            wanted = prefer
            break
    RESULT["refraction_mode_chosen"] = wanted
    record("R01", "this engine offers a refraction mode that is not NONE",
           wanted is not None, offered=modes, chosen=wanted,
           note="ENUMERATED RATHER THAN GUESSED. The previous attempt tried three hoped-for spellings inside "
                "a try/except and left the material at RM_NONE when none matched, reporting nothing. A "
                "guarded guess that silently does nothing is worse than no attempt.")

    applied = {}
    try:
        master.set_editor_property("screen_space_reflections", True)
        applied["screen_space_reflections"] = True
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["ssr"] = str(err)[:160]
    if wanted is not None:
        try:
            master.set_editor_property("refraction_method", getattr(unreal.RefractionMode, wanted))
            applied["refraction_method"] = wanted
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})["refraction"] = str(err)[:160]
    RESULT["applied"] = applied

    # recompile and save, then re-read from the asset rather than trusting the set
    try:
        unreal.MaterialEditingLibrary.recompile_material(master)
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["recompile"] = str(err)[:160]
    yield 1.0
    saved = False
    try:
        saved = bool(unreal.EditorAssetLibrary.save_asset(MASTER, only_if_is_dirty=False))
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["save"] = str(err)[:160]
    RESULT["saved"] = saved
    record("R02", "the asset was saved", saved, saved=saved)

    yield 1.0
    after = {"screen_space_reflections": read("screen_space_reflections"),
             "refraction_method": read("refraction_method"),
             "blend_mode": read("blend_mode"),
             "translucency_lighting_mode": read("translucency_lighting_mode")}
    RESULT["after"] = after
    emit("R_AFTER", "INFO", "what the surface is now", after)

    record("R03", "the water is now allowed to reflect, read back off the asset",
           str(after.get("screen_space_reflections")).lower() == "true",
           before=before.get("screen_space_reflections"), after=after.get("screen_space_reflections"),
           note="THE READBACK IS THE RESULT. Setting a property and saving is not evidence it took, and "
                "four conclusions this week were withdrawn for exactly that mistake.")

    record("R04", "the water now refracts, read back off the asset",
           after.get("refraction_method") is not None
           and "RM_NONE" not in str(after.get("refraction_method")).upper()
           and "NONE" not in str(after.get("refraction_method")).upper().replace("RM_NONE", ""),
           before=before.get("refraction_method"), after=after.get("refraction_method"), chosen=wanted)

    # ---- AND NOTHING ELSE MOVED. The two surfaces that were already correct must be untouched: this is a
    # two-property change, not a re-author of a material the founder has not asked to be re-authored.
    unchanged = (before.get("blend_mode") == after.get("blend_mode")
                 and before.get("translucency_lighting_mode") == after.get("translucency_lighting_mode"))
    record("R05", "the settings that were already right were left alone",
           unchanged, blend_before=before.get("blend_mode"), blend_after=after.get("blend_mode"),
           tlm_before=before.get("translucency_lighting_mode"),
           tlm_after=after.get("translucency_lighting_mode"),
           note="the translucency lighting mode was already the per-pixel surface one and the blend mode was "
                "already translucent. A fix that quietly rewrites the parts that were working is how a "
                "narrow change becomes an unreviewable one.")

    RESULT["status"] = "measured"
    yield 0.5
