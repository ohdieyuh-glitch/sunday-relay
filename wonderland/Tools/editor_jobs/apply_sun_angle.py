# Editor job: turn the world's sun, reversibly (LT02, 2026-09-17).
#
# WHY. apply_light_tune.py reaches any property on a light's COMPONENT, which is everything about a light except
# where it points: a directional light's direction is its ACTOR's rotation. The founder's material-realism list ends
# with "lighting that reveals materials", and the lever that reveals relief is the sun's elevation -- a high sun puts
# every wall in flat frontal light and drops its shadow at its own foot, while a lower one rakes across a facade and
# lengthens every shadow that says a surface has depth.
#
# Same discipline as the look jobs: the before is recorded, a write refuses if the current value is not the recorded
# before (someone moved it since), REVERT puts it back, SAVE = False previews in memory only.
# Globals: LABEL (actor label), PITCH, YAW (degrees, optional), SOURCE_ANGLE (degrees, optional), RECORD, REVERT, SAVE.
import json
import os

LABEL = globals().get("LABEL", "V2_Sun")
PITCH = globals().get("PITCH")
YAW = globals().get("YAW")
SOURCE_ANGLE = globals().get("SOURCE_ANGLE")
RECORD = globals().get("RECORD")
REVERT = globals().get("REVERT", False)
SAVE = globals().get("SAVE", False)
MAP = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"
TOL = 0.01


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    world = ues.get_editor_world()
    actor = None
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        if a.get_actor_label() == LABEL:
            actor = a
            break
    if actor is None:
        RESULT["status"] = "error"
        RESULT["error"] = "no actor labelled " + LABEL
        return
    comp = (actor.get_components_by_class(unreal.DirectionalLightComponent) or [None])[0]
    record = json.load(open(RECORD)) if (RECORD and os.path.exists(RECORD)) else {}
    r = actor.get_actor_rotation()
    now = {"pitch": round(r.pitch, 3), "yaw": round(r.yaw, 3),
           "source_angle": round(comp.get_editor_property("light_source_angle"), 4) if comp else None}
    if REVERT:
        before = record.get(LABEL)
        if not before:
            RESULT["status"] = "error"
            RESULT["error"] = "nothing recorded for " + LABEL
            return
        actor.set_actor_rotation(unreal.Rotator(roll=r.roll, pitch=before["pitch"], yaw=before["yaw"]), False)
        if comp is not None and before.get("source_angle") is not None:
            comp.set_editor_property("light_source_angle", before["source_angle"])
        # A REVERT undoes what this job wrote, so the "last written" note has to go with it. Without this, the next
        # apply reads the restored value, compares it with the note, and refuses as if someone else had moved the sun
        # (it did exactly that on 2026-09-17).
        record.pop(LABEL + "_last_written", None)
        if RECORD:
            os.makedirs(os.path.dirname(RECORD), exist_ok=True)
            with open(RECORD, "w", newline="\n") as f:
                json.dump(record, f, indent=1)
        RESULT["restored"] = before
    else:
        if LABEL in record:
            # No "last written" note means this job has not written since the last REVERT, so there is nothing to
            # disagree with: the recorded before still stands and the sun is where the world left it.
            expect = record.get(LABEL + "_last_written", {})
            for k, v in expect.items():
                if v is not None and now.get(k) is not None and abs(now[k] - v) > TOL:
                    RESULT["status"] = "error"
                    RESULT["error"] = "%s is %s, not the %s this job last wrote: someone changed it" % (k, now[k], v)
                    return
        else:
            record[LABEL] = now
        pitch = now["pitch"] if PITCH is None else float(PITCH)
        yaw = now["yaw"] if YAW is None else float(YAW)
        actor.set_actor_rotation(unreal.Rotator(roll=r.roll, pitch=pitch, yaw=yaw), False)
        if comp is not None and SOURCE_ANGLE is not None:
            comp.set_editor_property("light_source_angle", float(SOURCE_ANGLE))
        written = {"pitch": round(pitch, 3), "yaw": round(yaw, 3),
                   "source_angle": round(float(SOURCE_ANGLE), 4) if SOURCE_ANGLE is not None else now["source_angle"]}
        record[LABEL + "_last_written"] = written
        RESULT["written"] = written
        RESULT["before"] = record[LABEL]
    if RECORD and not REVERT:
        os.makedirs(os.path.dirname(RECORD), exist_ok=True)
        with open(RECORD, "w", newline="\n") as f:
            json.dump(record, f, indent=1)
    yield 0.3
    if SAVE:
        RESULT["saved"] = bool(unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level())
    RESULT["status"] = "done"
