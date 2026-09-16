# What is the Relay Dog actually made of? A few seconds, no captures.
#
# The founder wants Julius's yellow eyes to blink the way the LLM Companion's and the Jhinn's do. Those two
# are built here from figure files, so their eyes are named parts with a `blink` motion. The Dog is not: it
# is a Blueprint pawn from the world's Content, and nothing in this module knows how it is put together.
#
# So before writing a blink, ask: what components does the pawn have, what are they called, and is there
# anything eye-shaped to drive. This prints the lot into the editor log and the result file.
import json

L = unreal.WonderlandUiTestLibrary


def say(line):
    unreal.log_warning("WLDOGPARTS %s" % line)


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 3.0
    world = ues.get_game_world()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)

    RESULT["pawn_class"] = pawn.get_class().get_name()
    RESULT["pawn_name"] = pawn.get_name()
    say("pawn %s of class %s" % (RESULT["pawn_name"], RESULT["pawn_class"]))

    parts = []
    for comp in pawn.get_components_by_class(unreal.SceneComponent):
        # SceneComponent's transform accessors are not uniformly exposed to Python across component
        # classes -- CapsuleComponent has no get_relative_location -- so ask for the world transform,
        # which every scene component answers, and fall back to nothing rather than dying mid-report.
        entry = {"name": comp.get_name(), "class": comp.get_class().get_name()}
        try:
            at = comp.get_world_location()
            entry["world"] = [round(at.x, 1), round(at.y, 1), round(at.z, 1)]
        except Exception:
            pass
        # An instanced mesh says how many pieces it holds, which is how a voxel face is built.
        if isinstance(comp, unreal.InstancedStaticMeshComponent):
            entry["instances"] = comp.get_instance_count()
        try:
            mats = comp.get_materials() if hasattr(comp, "get_materials") else []
            entry["materials"] = [m.get_name() for m in mats if m is not None]
        except Exception:
            pass
        parts.append(entry)
    RESULT["components"] = parts
    say("%d scene components" % len(parts))
    for entry in parts:
        say("  %-38s %-34s %s" % (entry["name"], entry["class"], json.dumps(entry.get("instances", ""))))

    # Anything that smells like a face, by name.
    wanted = ("eye", "face", "visor", "pupil", "iris", "head")
    hits = [e for e in parts if any(w in e["name"].lower() for w in wanted)]
    RESULT["face_candidates"] = hits
    say("face candidates: %s" % json.dumps([h["name"] for h in hits]))

    # And what the Dog's own animation contract already exposes, if anything.
    RESULT["dog_api"] = sorted(n for n in dir(pawn) if any(w in n.lower() for w in ("eye", "blink", "face", "anim")))
    say("pawn api: %s" % json.dumps(RESULT["dog_api"]))

    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    L.set_background_throttle_suspended(False)
    RESULT["status"] = "done"
    say("done")
