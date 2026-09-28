# DOES THE WATER READ AS WATER AT PLAYER HEIGHT, OR AS A BRIGHT HOOP?
#
# FOUNDER, item 10: "believable animated water". The Julius lane, looking at an acceptance frame taken at
# player height in the Golden Arrival plaza, reported the fountain after my reflection change as:
#
#   "a glowing HOOP around the Dog, not water. Thick, uniformly pale grey-blue, voxel-stepped along its whole
#    length. No sky or scene detail reflected in it, no surface inside the rim -- a solid ribbon. In the
#    earlier frames the same spot was a dark rim that read as stone."
#
# THAT IS BETTER EVIDENCE THAN MY OWN AUDIT AND I AM TREATING IT AS SUCH. My audit's nine views turn out to be
# framed against close masonry with water at the edges -- one of them is almost entirely a balustrade -- so my
# day/dusk/night ratios are sound as a BEFORE-AND-AFTER (same cameras, unchanged backdrop) and weak as a
# statement about how the water reads to a person. A frame at player height in the plaza is the founder's
# actual view, and it says the change made a dark rim into a pale ribbon.
#
# THE CAUSE IS ROUGHNESS 0.035, WHICH IS GLASS. With screen-space reflections off, that never mattered: the
# surface had no reflection to be mirror-like with, and it read as a dark rim. Turning reflections on made it
# a mirror -- and a mirror at a grazing angle returns the SKY, which is a large uniform pale thing. Uniformly
# pale with no detail is precisely what a mirror reflecting an overcast dome looks like.
#
# AND I NEARLY MISDIAGNOSED IT. I read the master's scalars and found "TexScale 0.0, Flow 0.0" and briefly had
# a cause: ripples scaled to nothing, so a flat mirror. Both names belong to the OLD M_V2_Surface. This
# material has no such parameters, and get_material_default_scalar_parameter_value returns 0.0 for a parameter
# that does not exist rather than failing. A query for something absent handed me a plausible number and I
# almost built on it. The ripples are configured: RippleStrength 0.35, FlowSpeedA 0.018, FlowSpeedB -0.011.
#
# SO: ROUGHEN IT ENOUGH THAT THE REFLECTION BREAKS UP, AND THEN LOOK. Water at this scale is not glass; a
# broken reflection is what makes a surface read as liquid rather than as chrome. The values move once, by a
# stated amount, and then the run photographs the plaza from player height so the verdict is a picture rather
# than a ratio.
#
# IF IT STILL READS AS A HOOP the honest answer is to put screen-space reflections back off and report that
# item 10's reflections need more than a material switch -- a dark rim that reads as stone is a smaller defect
# than a glowing ring around the mascot in the founder's main plaza.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

MASTER = "/Game/Wonderland/Materials/M_WL_RealWater.M_WL_RealWater"
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "water_reads")

# Glass is 0.02-0.05. Still water at a distance sits nearer 0.10, and the ripple normals do the rest; past
# about 0.2 it stops reading as water and starts reading as wet stone.
WANT = {"Roughness": 0.10, "RippleStrength": 0.55}


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

    master = unreal.load_asset(MASTER)
    record("D00", "the water master loads", master is not None)
    if master is None:
        RESULT["status"] = "VOID: no master"
        return

    def scalar(name):
        try:
            return round(float(unreal.MaterialEditingLibrary
                               .get_material_default_scalar_parameter_value(master, unreal.Name(name))), 4)
        except Exception:                                           # noqa: BLE001
            return None

    # ---- THE PARAMETERS THIS MATERIAL ACTUALLY HAS, enumerated rather than assumed, because asking for a
    # name that is not there returns 0.0 and reads exactly like a real answer.
    names = []
    try:
        names = [str(n) for n in unreal.MaterialEditingLibrary
                 .get_scalar_parameter_names(master)]
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["names"] = str(err)[:140]
    RESULT["scalar_parameters_that_exist"] = names
    emit("D_NAMES", "INFO", "the scalars this material really exposes", {"names": names})
    record("D01", "the parameters about to be changed are ones this material has",
           bool(names) and all(k in names for k in WANT),
           wanted=sorted(WANT), exposed=names,
           note="THE GUARD AGAINST MY OWN LAST MISTAKE. I read 'TexScale 0.0, Flow 0.0' off this material and "
                "briefly had a cause; both names belong to the OLD M_V2_Surface and the getter returns 0.0 "
                "for a parameter that does not exist. A query for something absent is not a measurement.")

    before = {k: scalar(k) for k in WANT}
    RESULT["before"] = before
    applied = {}
    for k, v in WANT.items():
        if k not in names:
            continue
        try:
            unreal.MaterialEditingLibrary.set_material_default_scalar_parameter_value(
                master, unreal.Name(k), float(v))
            applied[k] = v
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[k] = str(err)[:140]
    RESULT["applied"] = applied
    try:
        unreal.MaterialEditingLibrary.recompile_material(master)
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["recompile"] = str(err)[:140]
    yield 1.0
    try:
        unreal.EditorAssetLibrary.save_asset(MASTER, only_if_is_dirty=False)
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["save"] = str(err)[:140]
    yield 1.0
    after = {k: scalar(k) for k in WANT}
    RESULT["after"] = after
    record("D02", "the new values are on the asset, read back",
           all(after.get(k) is not None and abs(after[k] - v) < 0.005 for k, v in WANT.items()
               if k in names),
           before=before, after=after, wanted=WANT)

    # ---- AND NOW LOOK AT IT, FROM WHERE A PLAYER STANDS.
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
    yield 8.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    if dog is None:
        RESULT["status"] = "VOID: no pawn"
        return
    here = dog.get_actor_location()
    RESULT["dog_at"] = [round(here.x, 1), round(here.y, 1), round(here.z, 1)]

    # THE SAME KIND OF VIEW THE JULIUS LANE'S FRAME HAD: player height, looking at the Dog and the basin it
    # stands beside, from a few metres back. Not a close-up of a rim and not an aerial.
    yaw = dog.get_actor_rotation().yaw
    shots = {}
    RESULT["captures"] = shots
    for tag, back, up, pitch_at in (("behind", 620.0, 150.0, -40.0), ("side", 700.0, 130.0, 10.0)):
        ang = math.radians(yaw + 180.0 + (0.0 if tag == "behind" else 75.0))
        eye = unreal.Vector(here.x + math.cos(ang) * back, here.y + math.sin(ang) * back, here.z + up)
        L.pose_camera(world, eye, unreal.Vector(here.x, here.y, here.z + pitch_at), 70.0)
        yield 2.5
        path = os.path.join(ROOT, "%s.png" % tag)
        try:
            if L.capture_game_viewport(path):
                shots[tag] = os.path.basename(path)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[tag] = str(err)[:140]
        yield 0.5
    L.release_camera(world)

    record("D03", "the plaza was photographed from player height for a human verdict",
           len(shots) == 2, captures=shots, where=ROOT,
           note="THE VERDICT IS THE PICTURE. A ratio taken against close masonry said this water was fine "
                "while a frame at player height showed a glowing hoop, so the picture is the authority here.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
