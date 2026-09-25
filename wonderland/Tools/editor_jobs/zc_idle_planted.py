# DO THE SKINS STAND STILL, OR DO THEY DRIFT?
#
# FOUNDER, 2026-09-25: "The alternate mascot skins are still not truly standing still during idle. When they
# are supposed to be standing, they slightly float/drift left and right. That is wrong. RELAY OG is the exact
# idle authority... They should remain planted exactly like Relay OG... no lateral translation, no floating,
# no sliding, no weird root movement. Then test every active skin in PIE: Relay OG, Celestial Light, Apollo,
# Arden Infernal, Skeleton Flame. Stand still for an extended period."
#
# SO RELAY OG SETS THE BAR, NOT A NUMBER I PICK. A living body is never perfectly still -- it breathes, and
# the founder explicitly allows that: "a subtle local breathing/body idle is fine ONLY if Relay OG already
# does it." Any threshold invented here would either forgive a drift Relay OG does not have, or fail Relay
# OG itself. So Relay OG is measured first and every other skin is held against what IT does.
#
# WHAT IS MEASURED, and why it is an OFFSET rather than a position. The Dog may be pushed a little by the
# world -- settling on a kerb, a companion brushing past -- and that would move a planted costume with it,
# correctly. What must not happen is the BODY wandering relative to the Dog carrying it. So every sample is
# the body pivot's world position MINUS the Dog's, and the spread of that offset over a long stand is the
# drift.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "idle_planted")

SKINS = ("relay_og", "celestial_light", "apollo", "arden_infernal", "skeleton_flame")

#: An EXTENDED period, as asked: 12 s of standing per skin at 10 Hz.
SAMPLES, INTERVAL = 120, 0.1


def spread(xs):
    return (max(xs) - min(xs)) if xs else 0.0


def find(actor, name):
    """By prefix: costume pivots are Part_root_0 and so on."""
    best = None
    for comp in actor.get_components_by_class(unreal.SceneComponent):
        got = str(comp.get_name())
        if got == name:
            return comp
        if best is None and got.startswith(name + "_"):
            best = comp
    return best


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["status"] = "running"

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 6.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    ui = L.get_ui(world)
    yield 0.5

    dogs = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RelayDogCharacter)
    if not dogs:
        RESULT["status"] = "FAIL: no Relay Dog"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    dog = dogs[0]

    def costume_of():
        for emb in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandCompanionEmbodiment):
            try:
                if emb.get_attach_parent_actor() == dog:
                    return emb
            except Exception:
                continue
        return None

    findings = {}
    RESULT["skins"] = findings

    for skin in SKINS:
        ui.wear_relay_skin(skin)
        # Long enough for any wear transition to finish before the stand begins.
        yield 3.0

        costume = costume_of()
        # RELAY OG IS THE CANON BODY ITSELF -- there is no costume, and its own Body pivot is the thing to
        # watch. Every other skin is a costume, whose root carries the whole figure.
        if skin == "relay_og" or costume is None:
            body = find(dog, "Body")
            source = "canon Body"
        else:
            body = find(costume, "Part_root")
            source = "costume Part_root"
        if body is None:
            record("I_%s" % skin, "%s: a body pivot to watch" % skin, False, source=source)
            continue

        dx, dy, dz = [], [], []
        floats = []
        for _ in range(SAMPLES):
            here = dog.get_actor_location()
            there = body.get_world_location()
            dx.append(float(there.x - here.x))
            dy.append(float(there.y - here.y))
            dz.append(float(there.z - here.z))
            if costume is not None:
                fr = find(costume, "Float")
                if fr is not None:
                    t = fr.get_relative_transform()
                    r = t.rotation.rotator()
                    floats.append((abs(float(t.translation.z)), abs(float(r.pitch)), abs(float(r.roll))))
            yield INTERVAL

        lateral = math.hypot(spread(dx), spread(dy))
        findings[skin] = {
            "source": source,
            "lateral_drift_uu": round(lateral, 4),
            "x_spread_uu": round(spread(dx), 4),
            "y_spread_uu": round(spread(dy), 4),
            "vertical_spread_uu": round(spread(dz), 4),
            "seconds": round(SAMPLES * INTERVAL, 1),
        }
        if floats:
            findings[skin]["float_root_max"] = {
                "z_uu": round(max(f[0] for f in floats), 4),
                "pitch_deg": round(max(f[1] for f in floats), 4),
                "roll_deg": round(max(f[2] for f in floats), 4),
            }
        H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % skin), 1400, 90)

    # ---- RELAY OG IS THE AUTHORITY, so it is read first and everything is measured against it.
    authority = findings.get("relay_og")
    record("I00", "Relay OG itself was measured, to set the bar",
           authority is not None, relay_og=authority,
           note="a threshold invented here would either forgive drift Relay OG does not have, or fail Relay "
                "OG itself")

    if authority is not None:
        bar = authority["lateral_drift_uu"] + 0.5
        drifters = {k: v["lateral_drift_uu"] for k, v in findings.items()
                    if k != "relay_og" and v["lateral_drift_uu"] > bar}
        record("I01", "every other skin stands as planted as Relay OG does",
               not drifters,
               relay_og_drift_uu=authority["lateral_drift_uu"], allowed_uu=round(bar, 4),
               by_skin={k: v["lateral_drift_uu"] for k, v in findings.items()},
               over_the_bar=drifters,
               note="lateral spread of the body's offset FROM THE DOG over %.0f s of standing"
                    % (SAMPLES * INTERVAL))

        floaty = {k: v["float_root_max"] for k, v in findings.items() if "float_root_max" in v
                  and (v["float_root_max"]["roll_deg"] > 0.05 or v["float_root_max"]["pitch_deg"] > 0.05
                       or v["float_root_max"]["z_uu"] > 0.05)}
        record("I02", "no worn costume is running the free-standing hover",
               not floaty, still_hovering=floaty,
               note="FloatRoot rocked every costume by 2 degrees of roll and 1.5 of pitch on the companion's "
                    "own clock; worn, it must be identity and all motion must come from the Dog")

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
