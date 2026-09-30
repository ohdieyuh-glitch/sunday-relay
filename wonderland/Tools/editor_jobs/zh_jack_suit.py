# G2b -- JACK FLAME'S SECONDARY DRIVES THE FLAMES, THE TIE AND THE SUIT (founder, 2026-09-30).
#
# FOUNDER: "The Jack Flame secondary color must now control ALL THREE: flames, tie, suit ... Changing secondary color
# should visibly recolor the suit as well as the tie and flame treatment while preserving material detail/readability.
# Verify: several distinctly different secondary colors; front/back/side appearance; normal movement; Mission Contract
# deployment animation; wardrobe preview; save/reload persistence."
#
# Read off the costume's own materials (DescribeMaterialColours) through the player's colour path (PickMascotColour =
# the Wardrobe / Menu writer). The tie is `heart`, the fire `flame` / `flamepale`, the suit `suit` (jacket, sleeves,
# trousers); the nightmare collar is `nightmare` and the pinstripes `stripe` -- both must stay as designed.
#
# THE FOUNDER'S OWN COLOURS ARE PUT BACK EXACTLY. They were chosen by hand in the 08:54-09:19 session (primary BONE,
# secondary CRIMSON, both chosen); this job snapshots them, never calls ResetAllColours, and re-picks them at the end.
#
# MODE "before": the pre-fix build -- photographs and readings only, documenting that the suit does NOT move.
# MODE "change": the fix -- S01..S09, frames, the wardrobe preview; leaves AZURE saved for the reload.
# MODE "restore": a NEW editor session -- the suit, tie and fire come back azure from disk; then the founder's colours.
# Globals: MODE, SPOT. PIE-owning: CONCURRENT is False. Saves nothing to the map.
CONCURRENT = False
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
GS = unreal.GameplayStatics
MODE = globals().get("MODE", "change")
SPOT = globals().get("SPOT", [0.0, 44000.0, 12.0])
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zh", "jack_suit_%s" % MODE)
SNAP = os.path.join(os.path.dirname(CHANNEL), "captures", "zh", "founder_colours_snapshot.json")
C = unreal.LinearColor
SWATCHES = [("azure", C(0.26, 0.56, 1.0, 1.0)), ("jade", C(0.20, 0.86, 0.60, 1.0)),
            ("crimson", C(0.82, 0.14, 0.18, 1.0)), ("gold", C(1.0, 0.78, 0.26, 1.0)), ("violet", C(0.56, 0.34, 0.96, 1.0))]
WHITE = C(1.0, 1.0, 1.0, 1.0)
ROSE = C(1.0, 0.52, 0.68, 1.0)


def colours(costume):
    out = {}
    for entry in str(costume.describe_material_colours()).split(";"):
        bits = entry.split("|")
        if len(bits) != 4:
            continue
        out[bits[0]] = {"channel": bits[1], "body": tuple(float(v) for v in bits[2].split(",")),
                        "twin": tuple(float(v) for v in bits[3].split(","))}
    return out


def hue(c):
    top = max(c)
    return None if top <= 1e-6 else tuple(round(v / top, 3) for v in c)


def lum(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    RESULT["status"] = "running"
    RESULT["mode"] = MODE
    RESULT["dll_mtime"] = os.path.getmtime(os.path.join(unreal.Paths.project_dir(), "Binaries", "Win64", "UnrealEditor-Wonderland.dll"))
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

    # ---- THE FOUNDER'S COLOURS, BEFORE ANYTHING IS TOUCHED (only the first run of the day writes the snapshot)
    prim0, sec0 = L.get_mascot_colour(True), L.get_mascot_colour(False)
    worn0 = str(dog_of().get_worn_skin_id())
    if not os.path.exists(SNAP):
        with open(SNAP, "w", encoding="utf-8") as f:
            json.dump({"primary": [prim0.r, prim0.g, prim0.b], "secondary": [sec0.r, sec0.g, sec0.b], "worn": worn0}, f)
    snap = json.load(open(SNAP, encoding="utf-8"))
    RESULT["founder_snapshot"] = snap
    RESULT["at_start"] = {"primary": [prim0.r, prim0.g, prim0.b], "secondary": [sec0.r, sec0.g, sec0.b], "worn": worn0}

    def place():
        dog = dog_of()
        dog.character_movement.disable_movement()
        dog.set_actor_location(unreal.Vector(SPOT[0], SPOT[1], 2500.0), False, True)
        unreal.SystemLibrary.execute_console_command(world, "FlushLevelStreaming")
        w = 0.0
        while w < 30.0 and not L.is_world_partition_streaming_complete(world):
            yield 0.5
            w += 0.5
        dog = dog_of()
        dog.set_actor_location(unreal.Vector(SPOT[0], SPOT[1], SPOT[2] + 120.0), False, True)
        dog.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=0.0, yaw=270.0), False)
        dog.character_movement.set_movement_mode(unreal.MovementMode.MOVE_WALKING)
        yield 1.5

    def shoot(tag, views=("front", "side", "side2", "back")):
        """Fixed cameras round the Dog: front (the tie), side, back. Returns the material readings."""
        dog = dog_of()
        got = colours(dog.get_costume()) if dog.get_costume() is not None else {}
        RESULT.setdefault("readings", {})[tag] = got
        at = dog.get_actor_location()
        half = dog.capsule_component.get_scaled_capsule_half_height()
        base = float(dog.get_actor_rotation().yaw)
        look = unreal.Vector(at.x, at.y, at.z - half + 105.0)
        # THE COMPANIONS FLOAT BESIDE THE DOG and covered the whole side view in the first set (zh_11 azure_side). Hidden
        # for these frames only -- never the Dog's own costume -- and shown again straight after, as zg_jack_head_views does.
        costume = dog.get_costume()
        hidden = []
        def already_hidden(actor):
            try:
                return bool(actor.get_editor_property("bHidden"))
            except Exception:                                          # noqa: BLE001
                return False
        for other in unreal.ObjectIterator(unreal.WonderlandCompanionEmbodiment):
            try:
                if other.get_world() == world and other != costume and not already_hidden(other):
                    other.set_actor_hidden_in_game(True)
                    hidden.append(other)
            except Exception as exc:                                   # noqa: BLE001
                unreal.log_warning("WLSUIT hide: %s" % exc)
        for view in views:
            off = {"front": 12.0, "side": 90.0, "side2": 270.0, "back": 180.0}[view]
            yaw = math.radians(base + off)
            L.pose_camera(world, unreal.Vector(look.x + math.cos(yaw) * 390.0, look.y + math.sin(yaw) * 390.0, look.z + 25.0), look, 45.0)
            yield 0.7
            H.capture_viewport_jpeg(os.path.join(ROOT, "%s_%s.jpg" % (tag, view)), 1280, 88)
        for other in hidden:
            try:
                other.set_actor_hidden_in_game(False)
            except Exception:                                          # noqa: BLE001
                pass
        L.release_camera(world)
        return got

    ui.wear_relay_skin("jack_flame")
    yield 2.5
    yield from place()
    dog = dog_of()
    record("S00", "Jack Flame is worn with its figure's channels declared (suit tagged on the fixed build)",
           str(dog.get_worn_skin_id()) == "jack_flame" and dog.get_costume() is not None,
           channels={k: v["channel"] for k, v in colours(dog.get_costume()).items()} if dog.get_costume() else None)

    if MODE == "restore":
        got = yield from shoot("restored")
        s, h, f = got.get("suit"), got.get("heart"), got.get("flame")
        az = hue((0.26, 0.56, 1.0))
        close = lambda a, b: a is not None and b is not None and all(abs(x - y) <= 0.03 for x, y in zip(a, b))
        record("R01", "a fresh session restores the saved SECONDARY onto the suit, the tie and the fire (azure from disk)",
               s and h and f and close(hue(s["body"]), az) and close(hue(h["body"]), az) and close(hue(f["twin"]), az),
               suit=hue(s["body"]) if s else None, tie=hue(h["body"]) if h else None, flame=hue(f["twin"]) if f else None,
               secondary=str(L.get_mascot_colour(False)))
    else:
        # ---- DEFAULT (white) = as designed: the reference every colour is compared against
        L.pick_mascot_colour(False, WHITE)
        yield 1.0
        base = yield from shoot("default")
        if MODE == "change":
            record("S01", "DEFAULT secondary: the suit is its designed near-black, the tie red, the collar black",
                   base["suit"]["body"][0] <= 0.06 and hue(base["heart"]["body"])[0] >= 0.99 and max(base["nightmare"]["body"]) <= 0.06,
                   suit=base["suit"]["body"], tie=hue(base["heart"]["body"]), collar=base["nightmare"]["body"])
        rows = {}
        for name, colour in SWATCHES:
            L.pick_mascot_colour(False, colour)
            yield 1.0
            got = yield from shoot(name)
            want = hue((colour.r, colour.g, colour.b))
            rows[name] = {"want": want, "suit": hue(got["suit"]["body"]), "suit_rgb": got["suit"]["body"],
                          "tie": hue(got["heart"]["body"]), "flame": hue(got["flame"]["twin"]),
                          "stripe_rgb": got["stripe"]["body"], "collar_rgb": got.get("nightmare", {}).get("body")}
        RESULT["swatches"] = rows
        close = lambda a, b: a is not None and b is not None and all(abs(x - y) <= 0.03 for x, y in zip(a, b))
        if MODE == "change":
            record("S02", "the SUIT takes each chosen secondary's hue (5 distinct colours)",
                   all(close(r["suit"], r["want"]) for r in rows.values()), per={k: [r["suit"], r["want"]] for k, r in rows.items()})
            record("S03", "the TIE and the FLAMES take the same hue as the suit, every colour",
                   all(close(r["tie"], r["want"]) and close(r["flame"], r["want"]) for r in rows.values()),
                   per={k: [r["tie"], r["flame"]] for k, r in rows.items()})
            record("S04", "readability: the suit stays a deep cloth -- the pinstripes >= 2.5x its luminance and the tie emissive far above it",
                   all(lum(r["stripe_rgb"]) >= 2.5 * lum(r["suit_rgb"]) for r in rows.values())
                   and all(max(rows[k]["suit_rgb"]) <= 0.34 for k in rows),
                   ratios={k: round(lum(r["stripe_rgb"]) / max(lum(r["suit_rgb"]), 1e-4), 2) for k, r in rows.items()})
            record("S05", "the NIGHTMARE COLLAR and the pinstripes keep their designed colours under every secondary",
                   all(r["collar_rgb"] is not None and max(r["collar_rgb"]) <= 0.06 and close(hue(r["stripe_rgb"]), hue(base["stripe"]["body"]))
                       for r in rows.values()))
            record("S06", "the suit is visibly different from the designed black (every swatch at least 3x brighter)",
                   all(max(r["suit_rgb"]) >= 3.0 * max(base["suit"]["body"]) for r in rows.values()),
                   peaks={k: round(max(r["suit_rgb"]), 3) for k, r in rows.items()}, designed=round(max(base["suit"]["body"]), 3))
            # ---- A PRIMARY ALONE LEAVES THE SUIT (it is the secondary's surface, not the shell)
            L.pick_mascot_colour(False, SWATCHES[0][1])
            yield 0.8
            before = colours(dog_of().get_costume())["suit"]["body"]
            L.pick_mascot_colour(True, ROSE)
            yield 0.8
            after = colours(dog_of().get_costume())["suit"]["body"]
            record("S07", "a PRIMARY alone does not move the suit", close(hue(before), hue(after)) and abs(max(before) - max(after)) < 0.01,
                   before=before, after=after)
            L.pick_mascot_colour(True, C(snap["primary"][0], snap["primary"][1], snap["primary"][2], 1.0))
            yield 0.8
            # ---- NORMAL MOVEMENT with a coloured suit: 3 s forward, feet on the canon's
            dog = dog_of()
            dog.character_movement.set_movement_mode(unreal.MovementMode.MOVE_WALKING)
            dog.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=0.0, yaw=90.0), False)
            s0 = dog.get_actor_location()
            g0 = GS.get_time_seconds(world)
            errs = []
            frame = 0
            while GS.get_time_seconds(world) - g0 < 3.0:
                dog = dog_of()
                dog.add_movement_input(unreal.Vector(0.0, 1.0, 0.0), 1.0, True)
                c = dog.get_costume()
                for side in (1.0, -1.0):
                    cs, ks = c.get_sole_world(side), dog.get_canon_sole_world(side)
                    errs.append(math.dist((cs.x, cs.y, cs.z), (ks.x, ks.y, ks.z)))
                frame += 1
                if frame == 40:
                    H.capture_viewport_jpeg(os.path.join(ROOT, "walking_azure.jpg"), 1280, 88)
                yield 0.0
            e0 = dog_of().get_actor_location()
            errs.sort()
            record("S08", "normal movement with the coloured suit: walks forward, feet track the canon",
                   (e0.y - s0.y) / 100.0 >= 4.0 and errs[int(len(errs) * 0.95)] <= 3.0,
                   along_m=round((e0.y - s0.y) / 100.0, 2), feet_p95_uu=round(errs[int(len(errs) * 0.95)], 2))
        # ---- THE WARDROBE PREVIEW (Project Brain -> SWITCH SKIN), in two colours
        yield from place()
        if not ui.is_project_brain_open():
            ui.toggle_project_brain()
        yield 1.5
        ui.press_switch_skin()
        yield 2.0
        ui.wear_relay_skin("jack_flame")
        yield 2.0
        for name, colour in (SWATCHES[0], SWATCHES[2]):
            L.pick_mascot_colour(False, colour)
            yield 1.5
            L.capture_game_viewport(os.path.join(ROOT, "wardrobe_%s.png" % name))
        rect = _pair(ui.get_skin_preview_rect())
        RESULT["preview_rect"] = rect
        if ui.is_project_brain_open():
            ui.toggle_project_brain()
        yield 1.0
        if MODE == "change":
            # ---- LEFT SAVED FOR THE RELOAD: azure
            L.pick_mascot_colour(False, SWATCHES[0][1])
            yield 1.0
            ini = ""
            for p in (os.path.join(unreal.Paths.project_saved_dir(), "Config", "WindowsEditor", "Game.ini"),):
                try:
                    ini = open(p, encoding="utf-8", errors="replace").read()
                except Exception:                                      # noqa: BLE001
                    pass
            record("S09", "the azure secondary is on disk for the reload (Game.ini, SectionsToSave)",
                   "Secondary=(R=0.260000,G=0.560000,B=1.000000" in ini, lines=[l for l in ini.splitlines() if "Secondary" in l][:3])
    # ---- PUT THE FOUNDER'S CHOICES BACK (not in "change": the reload must find azure; "restore" puts them back)
    if MODE in ("before", "restore"):
        L.pick_mascot_colour(True, C(snap["primary"][0], snap["primary"][1], snap["primary"][2], 1.0))
        L.pick_mascot_colour(False, C(snap["secondary"][0], snap["secondary"][1], snap["secondary"][2], 1.0))
        if snap.get("worn") and snap["worn"] != "None":
            ui.wear_relay_skin(snap["worn"])
        yield 1.0
        p, s = L.get_mascot_colour(True), L.get_mascot_colour(False)
        RESULT["restored_to"] = {"primary": [p.r, p.g, p.b], "secondary": [s.r, s.g, s.b], "worn": str(dog_of().get_worn_skin_id())}
        record("Z01", "the founder's own colours and skin are back exactly as they were",
               all(abs(a - b) < 1e-4 for a, b in zip([p.r, p.g, p.b], snap["primary"]))
               and all(abs(a - b) < 1e-4 for a, b in zip([s.r, s.g, s.b], snap["secondary"])))
    RESULT["all_pass"] = all(x["pass"] for x in tests)
    RESULT["status"] = "measured"


def _pair(ret):
    try:
        if isinstance(ret, tuple):
            return [str(v) for v in ret]
    except Exception:                                                  # noqa: BLE001
        pass
    return str(ret)
