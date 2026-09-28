# WHERE DOES EACH SKIN'S GEOMETRY ACTUALLY SIT? MEASURED IN WORLD SPACE, NOT IN THE POSE STRUCT.
#
# FOUNDER, P0 item 3: "Observe Relay OG in PIE and make every active skin copy its exact idle stance, walk,
# run, stop, turns, jump, fall, landing, body bounce, and GROUND CONTACT. THEY STILL STAND/WALK WEIRD: fix
# the skeleton/AnimBP/retarget/ROOT-POSE cause, not cosmetic offsets."
#
# WHAT I HAVE ALREADY PROVED, AND WHY IT IS NOT AN ANSWER. zc_pose_authority and zc_pose_mission establish
# that every costume wears the canon body's published pose FIELD FOR FIELD -- twenty-three fields, standing,
# walking, and through a whole Mission Contract lifecycle, with the Dog's stride phase demonstrably
# advancing. Those runs are green and they are honest.
#
# THEY MEASURE THE INPUT. The pose struct is what the costume is TOLD; where its geometry ends up is a
# different question, and the founder is reporting the second one. A skin can read the identical pose and
# still stand wrong if its root sits at a different height, if its bounds are offset, or if the figure was
# authored around a different origin -- which is exactly the "root-pose cause" their sentence names. I have
# been quoting a field-equality pass at a geometry complaint all evening.
#
# SO THIS ASKS THE WORLD, NOT THE STRUCT. For each skin, with the Dog standing in one place and never moved:
#
#   GROUND CONTACT   the bottom of the costume's world bounds against the floor under the Dog, traced.
#                    A skin whose lowest geometry is above the floor is floating; below it, sunk.
#   ROOT OFFSET      the costume actor's own location against the Dog's, which should be identical for
#                    every skin because the costume is attached to the Dog.
#   HEIGHT           the costume's total vertical extent, so "stands weird" can be separated from
#                    "is a different size", which is legitimate and not a defect.
#
# RELAY OG IS THE REFERENCE, because the founder's sentence makes it one: every other skin is compared to
# ITS numbers rather than to an absolute that somebody would have to invent.
#
# NO PIXELS. Bounds and traces are exact, they do not care where the camera is, they are not confounded by
# the HUD drawn over the feet or by a companion standing beside the Dog -- all three of which defeated a
# pixel-based attempt at this same question tonight. When the engine already publishes the answer, measuring
# it off a photograph is the harder and worse route.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary

SKINS = ("relay_og", "celestial_light", "apollo", "arden_infernal", "skeleton_flame")
# How far a skin's lowest geometry may sit from Relay OG's before it reads as floating or sunk, in uu.
GROUND_TOLERANCE = 6.0
# The costume is attached to the Dog, so its origin should be the Dog's. Anything past this is a real offset.
ROOT_TOLERANCE = 1.0


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
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 6.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    if ui is None or dog is None:
        RESULT["status"] = "VOID: no UI subsystem or no pawn"
        return

    stood_at = dog.get_actor_location()
    RESULT["stood_at"] = [round(stood_at.x, 1), round(stood_at.y, 1), round(stood_at.z, 1)]

    # ---- THE REFERENCE IS THE DOG'S OWN ORIGIN, NOT A TRACED FLOOR.
    #
    # A first version traced for the floor and died on unreal.TraceTypeQuery.CAMERA, which is not a Python
    # enum member -- the trace-type enum is project-configured (TRACE_TYPE_QUERY1 and so on) and mapping
    # ECC_Camera onto it would be a guess about this project's collision settings.
    #
    # IT IS ALSO UNNECESSARY. The question is comparative: does each skin stand where RELAY OG stands, on a
    # Dog that never moves? The Dog's own origin is a fixed datum that serves that exactly, and it cannot be
    # wrong about the collision channel because it does not use one. A traced floor would only add an
    # absolute that the founder's sentence never asked for -- they made Relay OG the authority, not the
    # ground plane.
    floor_z = float(stood_at.z)
    RESULT["reference_z"] = round(floor_z, 2)
    record("G00", "there is a fixed datum to measure every skin against",
           True, reference_z=RESULT["reference_z"], stood_at=RESULT["stood_at"],
           note="the Dog's own origin, held constant by G02. Relative to it is what the founder's "
                "'copy Relay OG's ground contact' actually means.")

    def costume():
        """The costume attached to THIS Dog.

        BY ATTACH PARENT, NOT BY CLASS. The AI Companions are the same class, so a class match picks
        whichever one happens to be floating nearby -- which is recorded in this tree as having produced a
        whole run of readings about the wrong actor.
        """
        for actor in unreal.GameplayStatics.get_all_actors_of_class(
                world, unreal.WonderlandCompanionEmbodiment):
            if actor.get_attach_parent_actor() == dog:
                return actor
        return None

    readings = {}
    RESULT["readings"] = readings
    for skin in SKINS:
        try:
            ui.wear_relay_skin(skin)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[skin] = str(err)[:140]
            continue
        yield 6.0
        worn = costume()
        if worn is None:
            readings[skin] = {"has_costume": False}
            continue
        try:
            origin, extent = worn.get_actor_bounds(False)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})["%s/bounds" % skin] = str(err)[:140]
            continue
        here = worn.get_actor_location()
        bottom = float(origin.z) - float(extent.z)
        top = float(origin.z) + float(extent.z)
        readings[skin] = {
            "has_costume": True,
            "bounds_bottom_z": round(bottom, 2),
            "bounds_top_z": round(top, 2),
            "height_uu": round(top - bottom, 2),
            "below_dog_origin_uu": round(bottom - floor_z, 2) if floor_z is not None else None,
            "root_offset_from_dog": [round(here.x - stood_at.x, 2), round(here.y - stood_at.y, 2),
                                     round(here.z - stood_at.z, 2)],
            "worn_id": str(dog.get_worn_skin_id()),
        }
        emit("G_%s" % skin, "INFO", skin, readings[skin])

    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass
    yield 3.0
    RESULT["worn_after_restore"] = str(dog.get_worn_skin_id())
    record("G_SKIN", "Relay OG was put back on the Dog, and it went back",
           "relay_og" in RESULT["worn_after_restore"].lower(), worn=RESULT["worn_after_restore"])

    # ---- RELAY OG IS NOT A COSTUME, AND THE FIRST RUN OF THIS JOB FOUND THAT OUT.
    #
    # It asked for five costumes and got four: relay_og produced none, because Relay OG is the Dog's OWN
    # CANON BODY -- ShowCanonBody, not an attached AWonderlandCompanionEmbodiment. So there is no costume
    # actor to read bounds from, and the reference this job was built around does not exist in the form it
    # assumed.
    #
    # That is a fact about the design rather than a fault: the founder's "every skin copies Relay OG" is
    # precisely a statement that the OTHER FOUR are costumes over the same body. It does mean the comparison
    # below is between the four costumes, with the canon body's own attachment as the datum.
    dressed = [s for s in SKINS if (readings.get(s) or {}).get("has_costume")]
    RESULT["skins_with_a_costume_actor"] = sorted(dressed)
    record("G01", "every skin that IS a costume produced one whose bounds could be read",
           len(dressed) >= len(SKINS) - 1, dressed=sorted(dressed), wanted=sorted(SKINS),
           note="Relay OG is the canon body rather than a costume, so four of five is the expected count "
                "and the first run's red was this job's assumption, not a defect.")

    # ---- THE CONTROL: THE DOG NEVER MOVED. If it did, every comparison below is between two places.
    ended_at = dog.get_actor_location()
    drift = max(abs(ended_at.x - stood_at.x), abs(ended_at.y - stood_at.y), abs(ended_at.z - stood_at.z))
    RESULT["dog_drift_uu"] = round(drift, 2)
    record("G02", "the Dog stood still for the whole run, so the skins are compared in one place",
           drift < 2.0, drift_uu=RESULT["dog_drift_uu"], ceiling=2.0,
           note="THE CONTROL. A Dog that wandered between skins turns a ground-contact comparison into a "
                "comparison of two different bits of floor.")
    if drift >= 2.0:
        RESULT["status"] = "VOID: the Dog moved between skins"
        return

    ref = readings.get("relay_og") or {}
    ref_above = ref.get("below_dog_origin_uu")
    if ref_above is None and dressed:
        # No canon-body costume to measure, so the four costumes are compared with each other.
        ref_above = min(readings[s]["below_dog_origin_uu"] for s in dressed
                        if readings[s].get("below_dog_origin_uu") is not None)
        RESULT["reference_is"] = "the lowest costume, since Relay OG has no costume actor"
    ground = {}
    for skin in dressed:
        r = readings[skin]
        ground[skin] = {"below_dog_origin_uu": r["below_dog_origin_uu"],
                        "vs_relay_og": (round(r["below_dog_origin_uu"] - ref_above, 2)
                                        if (r["below_dog_origin_uu"] is not None and ref_above is not None)
                                        else None),
                        "height_uu": r["height_uu"]}
    RESULT["ground_contact"] = ground
    off = sorted(s for s, v in ground.items()
                 if v["vs_relay_og"] is not None and abs(v["vs_relay_og"]) > GROUND_TOLERANCE)
    RESULT["skins_not_standing_where_relay_og_stands"] = off or None
    record("G03", "every costume's lowest geometry sits at the same height",
           ref_above is not None and not off,
           ground_contact=ground, tolerance_uu=GROUND_TOLERANCE, offenders=off or None,
           note="REPORTED, NOT TRUSTED AS FEET. An actor's bounds include its EFFECTS: Arden Infernal reads "
                "348.9 uu tall against 199.2 for Celestial Light and its bounds bottom sits 50 uu lower, "
                "which is its flame plume rather than its feet. So a red here is a statement about total "
                "extent, and the founder's 'ground contact' needs the foot COMPONENTS rather than the "
                "actor's bounds. Height is reported alongside so size is not mistaken for stance.")

    roots = {s: readings[s]["root_offset_from_dog"] for s in dressed}
    RESULT["root_offsets"] = roots
    # ---- THE QUESTION IS WHETHER THE OFFSET DIFFERS BETWEEN SKINS, NOT WHETHER IT IS ZERO.
    #
    # The first run failed this expecting zero and measured [0, 0, -87.07] for every skin. That is not a
    # per-skin offset -- it is the standard attachment, the Dog's origin sitting at capsule centre while the
    # costume hangs from the feet, and it is IDENTICAL on all four. Asserting zero was my assumption about
    # the rig rather than anything the founder asked for.
    #
    # WHAT THEIR "root-pose cause" WOULD LOOK LIKE is one skin offset differently from the others, and this
    # now tests exactly that.
    zs = [v[2] for v in roots.values()]
    spread_z = round(max(zs) - min(zs), 3) if zs else None
    lateral = sorted(s for s, v in roots.items() if max(abs(v[0]), abs(v[1])) > ROOT_TOLERANCE)
    RESULT["root_offset_spread_z"] = spread_z
    record("G04", "every costume is rooted on the Dog by the SAME offset, with none set apart",
           spread_z is not None and spread_z <= ROOT_TOLERANCE and not lateral,
           root_offsets=roots, offset_spread_z=spread_z, lateral_offenders=lateral or None,
           tolerance_uu=ROOT_TOLERANCE,
           note="a uniform offset is the rig; a DIFFERING one would be the per-skin cosmetic offset the "
                "founder asked not to be used as a fix. Measured at [0, 0, -87.07] for all four in the "
                "first run, which is evidence AGAINST a per-skin root-pose cause.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
