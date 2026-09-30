# G2 QUALIFICATION -- JACK FLAME'S SECONDARY COLOUR DRIVES THE FIRE AND THE TIE (founder regression, 2026-09-29).
#
# FOUNDER: "Jack Flame selected -> change SECONDARY COLOR -> flames change -> tie changes to matching secondary color
# -> movement remains correct -> save/reload if customization persists -> selected secondary color restores
# correctly." Read off the costume's own materials (DescribeMaterialColours): the tie is the `heart` material on the
# collar, the fire is the `flame` / `flamepale` ribbons (their flame twins), through the player's own colour path
# (PickMascotColour = the Wardrobe / Menu writer: SaveAndApply).
#
# MODE "change" (first session): authored colours -> a PRIMARY alone must NOT move the fire -> SECONDARY azure moves
# fire, pale core and tie together -> the Dog still walks and its feet track -> jade -> DEFAULT (white) puts the
# designed colours back -> azure again, left saved for the reload.
# MODE "restore" (a NEW editor session): Jack Flame comes up with the azure fire and tie straight from the saved
# config; then every colour is reset to the designed ones and the player's skin is put back.
# Globals: MODE. PIE-owning: CONCURRENT is False.
CONCURRENT = False
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
GS = unreal.GameplayStatics
MODE = globals().get("MODE", "change")
SPOT = globals().get("SPOT", [0.0, 44000.0, 12.0])
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "g2_jack_flame")
AZURE = unreal.LinearColor(0.26, 0.56, 1.0, 1.0)
JADE = unreal.LinearColor(0.20, 0.86, 0.60, 1.0)
ROSE = unreal.LinearColor(1.0, 0.52, 0.68, 1.0)
WHITE = unreal.LinearColor(1.0, 1.0, 1.0, 1.0)


def colours(costume):
    out = {}
    for entry in str(costume.describe_material_colours()).split(";"):
        bits = entry.split("|")
        if len(bits) != 4:
            continue
        body = tuple(float(v) for v in bits[2].split(","))
        twin = tuple(float(v) for v in bits[3].split(","))
        out[bits[0]] = {"channel": bits[1], "body": body, "twin": twin}
    return out


def hue(c):
    r, g, b = c
    top = max(r, g, b)
    if top <= 1e-6:
        return None
    return tuple(round(v / top, 3) for v in (r, g, b))


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    RESULT["status"] = "running"
    RESULT["mode"] = MODE
    L.set_background_throttle_suspended(True)
    try:
        yield from _run(ues, les)
    finally:
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
            while ues.get_game_world() is not None:
                yield 1.0


def _run(ues, les):
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    t = 0.0
    while ues.get_game_world() is None and t < 90.0:
        yield 1.0
        t += 1.0
    world = ues.get_game_world()
    dog_of = lambda: GS.get_player_pawn(ues.get_game_world(), 0)
    t = 0.0
    while dog_of() is None and t < 30.0:
        yield 0.5
        t += 0.5
    if dog_of() is None:
        RESULT["status"] = "BLOCKED: no pawn"
        return
    yield 3.0
    L.focus_game_viewport()
    ui = L.get_ui(world)
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name)

    def face_camera():
        dog = dog_of()
        dog.character_movement.disable_movement()
        dog.set_actor_location(unreal.Vector(SPOT[0], SPOT[1], SPOT[2] + 120.0), False, True)
        dog.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=0.0, yaw=270.0), False)
        dog.character_movement.set_movement_mode(unreal.MovementMode.MOVE_WALKING)
        ctrl = dog.get_controller()
        if ctrl is not None:
            ctrl.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-8.0, yaw=90.0))
        yield 1.5

    def settle_spot():
        dog = dog_of()
        dog.character_movement.disable_movement()
        dog.set_actor_location(unreal.Vector(SPOT[0], SPOT[1], 2500.0), False, True)
        unreal.SystemLibrary.execute_console_command(world, "FlushLevelStreaming")
        w = 0.0
        while w < 30.0:
            yield 0.5
            w += 0.5
            if L.is_world_partition_streaming_complete(world):
                break
        yield from face_camera()

    def read(tag):
        dog = dog_of()
        c = dog.get_costume()
        got = colours(c) if c is not None else {}
        RESULT.setdefault("readings", {})[tag] = got
        # THE FRAME LOOKS AT THE FRONT, where the tie and the face are, whichever way the controller turned the Dog.
        at = dog.get_actor_location()
        half = dog.capsule_component.get_scaled_capsule_half_height()
        yaw = math.radians(float(dog.get_actor_rotation().yaw) + 20.0)
        look = unreal.Vector(at.x, at.y, at.z - half + 100.0)
        L.pose_camera(world, unreal.Vector(look.x + math.cos(yaw) * 380.0, look.y + math.sin(yaw) * 380.0, look.z + 20.0), look, 45.0)
        yield 0.8
        H.capture_viewport_jpeg(os.path.join(ROOT, "jack_flame_%s.jpg" % tag), 1280, 88)
        L.release_camera(world)
        return got

    if MODE == "restore":
        # a NEW session: nothing picked here -- the colour must come back from the saved config by itself
        yield from settle_spot()
        dog = dog_of()
        RESULT["worn_at_start"] = str(dog.get_worn_skin_id())
        if str(dog.get_worn_skin_id()) != "jack_flame":
            ui.wear_relay_skin("jack_flame")
            yield 2.0
            yield from face_camera()
        got = yield from read("restored")
        heart, flame, pale = got.get("heart", {}), got.get("flame", {}), got.get("flamepale", {})
        record("R01", "a fresh session restores the saved SECONDARY onto Jack Flame's tie and fire (azure, not the authored red)",
               heart and flame and pale and hue(heart["body"]) and hue(heart["body"])[2] >= 0.99 and hue(heart["body"])[0] <= 0.35
               and hue(flame["twin"])[2] >= 0.99 and hue(flame["twin"])[0] <= 0.35 and hue(pale["twin"])[2] >= 0.99,
               heart_hue=hue(heart.get("body", (0, 0, 0))), flame_hue=hue(flame.get("twin", (0, 0, 0))), pale_hue=hue(pale.get("twin", (0, 0, 0))),
               secondary=str(L.get_mascot_colour(False)))
        # AND PUT EVERYTHING BACK: the founder's install had no colour chosen before this proof
        L.reset_all_colours()
        yield 1.0
        got = yield from read("reset")
        record("R02", "after the proof every colour is back to the designed ones (the tie red again)",
               got.get("heart") and hue(got["heart"]["body"]) and hue(got["heart"]["body"])[0] >= 0.99 and hue(got["heart"]["body"])[2] <= 0.1)
        RESULT["all_pass"] = all(x["pass"] for x in tests)
        RESULT["status"] = "measured"
        return

    # ------------------------------------------------------------------ MODE "change"
    ui.wear_relay_skin("jack_flame")
    yield 2.5
    L.reset_all_colours()
    yield 1.0
    yield from settle_spot()
    dog = dog_of()
    record("C00", "Jack Flame is worn, with its figure's secondary accents declared",
           str(dog.get_worn_skin_id()) == "jack_flame" and dog.get_costume() is not None,
           channels={k: v["channel"] for k, v in colours(dog.get_costume()).items()} if dog.get_costume() else None)
    base = yield from read("authored")
    red = lambda c: hue(c) is not None and hue(c)[0] >= 0.99 and hue(c)[2] <= 0.12
    record("C01", "authored: the tie and both flames are red / orange (nothing chosen)",
           red(base["heart"]["body"]) and red(base["flame"]["twin"]) and red(base["flamepale"]["twin"]),
           heart=hue(base["heart"]["body"]), flame=hue(base["flame"]["twin"]), pale=hue(base["flamepale"]["twin"]))

    L.pick_mascot_colour(True, ROSE)
    yield 1.0
    prim = yield from read("primary_rose_only")
    record("C02", "a PRIMARY alone recolours the shell and leaves the fire and the tie as designed",
           hue(prim["heart"]["body"]) == hue(base["heart"]["body"]) and hue(prim["flame"]["twin"]) == hue(base["flame"]["twin"])
           and hue(prim["bonedeep"]["body"]) != hue(base["bonedeep"]["body"]),
           shell_before=hue(base["bonedeep"]["body"]), shell_after=hue(prim["bonedeep"]["body"]), heart_after=hue(prim["heart"]["body"]))

    L.pick_mascot_colour(False, AZURE)
    yield 1.0
    az = yield from read("secondary_azure")
    blue = lambda c: hue(c) is not None and hue(c)[2] >= 0.99 and hue(c)[0] <= 0.35
    # THE PALE CORE IS THE CHOSEN COLOUR LIFTED 40% TOWARD WHITE (WonderlandMascotStyle::AccentColour, bLight), so its
    # red and green sit above the azure's by design -- held to that exact shade, not to the outer tongue's hue (the
    # first run failed a correct core on "red <= 0.35": 0.556 is azure lifted 40%, as specified).
    lifted = tuple(round(v + 0.4 * (1.0 - v), 3) for v in hue((AZURE.r, AZURE.g, AZURE.b)))
    pale_ok = hue(az["flamepale"]["twin"]) is not None and all(abs(a - b) <= 0.02 for a, b in zip(hue(az["flamepale"]["twin"]), lifted))
    record("C03", "SECONDARY azure: the FLAMES change (outer tongue azure, pale core the lighter azure)",
           blue(az["flame"]["twin"]) and blue(az["flame"]["body"]) and pale_ok,
           flame=hue(az["flame"]["twin"]), pale=hue(az["flamepale"]["twin"]), pale_expected=lifted)
    record("C04", "SECONDARY azure: the TIE changes to the matching secondary colour",
           blue(az["heart"]["body"]) and hue(az["heart"]["body"]) == hue(az["flame"]["twin"]),
           tie=hue(az["heart"]["body"]), flame=hue(az["flame"]["twin"]))
    record("C05", "the pale core stays paler than the outer flame, in the chosen colour",
           hue(az["flamepale"]["twin"])[0] > hue(az["flame"]["twin"])[0] and hue(az["flamepale"]["twin"])[1] > hue(az["flame"]["twin"])[1],
           pale=hue(az["flamepale"]["twin"]), flame=hue(az["flame"]["twin"]))
    # brightness is the authored surface's own: the tie keeps its peak, it is not darkened by a multiply
    record("C06", "the recoloured tie and fire keep their authored brightness (peak within 25%)",
           abs(max(az["heart"]["body"]) - max(base["heart"]["body"])) <= 0.25 * max(base["heart"]["body"])
           and abs(max(az["flame"]["twin"]) - max(base["flame"]["twin"])) <= 0.25 * max(base["flame"]["twin"]),
           tie_peak=[round(max(base["heart"]["body"]), 1), round(max(az["heart"]["body"]), 1)],
           flame_peak=[round(max(base["flame"]["twin"]), 1), round(max(az["flame"]["twin"]), 1)])
    record("C07", "the visor and suit are untouched by the secondary",
           hue(az["visor"]["body"]) == hue(base["visor"]["body"]) and hue(az["suit"]["body"]) == hue(base["suit"]["body"]))

    # ---- AND IT STILL WALKS: 3 s forward with the recoloured costume, feet on the canon's
    dog = dog_of()
    dog.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=0.0, yaw=90.0), False)
    start = dog.get_actor_location()
    g0 = GS.get_time_seconds(world)
    errs = []
    while GS.get_time_seconds(world) - g0 < 3.0:
        dog = dog_of()
        dog.add_movement_input(unreal.Vector(0.0, 1.0, 0.0), 1.0, True)
        c = dog.get_costume()
        for side in (1.0, -1.0):
            cs, ks = c.get_sole_world(side), dog.get_canon_sole_world(side)
            errs.append(math.dist((cs.x, cs.y, cs.z), (ks.x, ks.y, ks.z)))
        yield 0.0
    end = dog_of().get_actor_location()
    errs.sort()
    record("C08", "movement remains correct with the new colours: walks forward and the feet track the canon",
           (end.y - start.y) / 100.0 >= 4.0 and errs[int(len(errs) * 0.95)] <= 3.0,
           along_m=round((end.y - start.y) / 100.0, 2), feet_p95_uu=round(errs[int(len(errs) * 0.95)], 2))
    yield from face_camera()

    L.pick_mascot_colour(False, JADE)
    yield 1.0
    jd = yield from read("secondary_jade")
    record("C09", "a second SECONDARY (jade) moves fire and tie together again",
           hue(jd["heart"]["body"])[1] >= 0.99 and hue(jd["flame"]["twin"])[1] >= 0.99 and hue(jd["heart"]["body"]) == hue(jd["flame"]["twin"]),
           tie=hue(jd["heart"]["body"]), flame=hue(jd["flame"]["twin"]))
    L.pick_mascot_colour(False, WHITE)
    yield 1.0
    wh = yield from read("secondary_default")
    record("C10", "DEFAULT (white) secondary puts the designed fire and tie back",
           hue(wh["heart"]["body"]) == hue(base["heart"]["body"]) and hue(wh["flame"]["twin"]) == hue(base["flame"]["twin"]))
    # ---- LEFT SAVED FOR THE RELOAD: azure secondary, and the primary back to white
    L.pick_mascot_colour(True, WHITE)
    L.pick_mascot_colour(False, AZURE)
    yield 1.0
    yield from read("left_saved_azure")
    ini = ""
    for p in (os.path.join(unreal.Paths.project_saved_dir(), "Config", "WindowsEditor", "Game.ini"),
              os.path.join(unreal.Paths.project_saved_dir(), "Config", "Windows", "Game.ini")):
        try:
            ini += open(p, encoding="utf-8", errors="replace").read()
        except Exception:                                              # noqa: BLE001
            pass
    record("C11", "the choice is saved to the config (bSecondaryChosen and the azure Secondary on disk)",
           "bSecondaryChosen=True" in ini and "Secondary=" in ini, ini_mentions=[l for l in ini.splitlines() if "Secondary" in l][:4])
    RESULT["all_pass"] = all(x["pass"] for x in tests)
    RESULT["status"] = "measured"
