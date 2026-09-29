# THE 2026-09-29 SKIN ROSTER, PROVEN IN PLAY: Arden Infernal and Apollo replaced by Jack Flame and Baal.
#
# FOUNDER, 2026-09-29: "These are replacements, NOT additional roster slots ... old Arden Infernal ownership/selection
# should migrate to Jack Flame, and old Apollo ownership/selection should migrate to Baal rather than disappearing."
# Verify: "1. all five canonical skins appear; 2. Arden Infernal and Apollo no longer appear player-facing; 3. Jack
# Flame and Baal can each be selected and rendered; ... 5. existing ownership/selection state migrates correctly;
# 6. no regression to Relay OG, Celestial Light, or Skeleton Flame."
#
# OBSERVED, NOT ASKED. The skin registry is a GameInstance subsystem and this build's Python reaches neither
# GameInstance.get_subsystem nor SubsystemBlueprintLibrary (both tried: AttributeError). So nothing here asks the
# registry what it thinks. Every clause reads what a player would see:
#   * the roster as `wl.Skins.List` prints it -- the registry's own DescribeSkins, the list the Wardrobe and /skin draw;
#   * an equip made through the Wardrobe's own call (UiSubsystem.WearRelaySkin, "exactly as clicking its card does");
#   * WHICH FIGURE THE DOG IS DRAWN IN, identified by the costume's IN-ENGINE SIGNATURE (box count, height), measured
#     by wearing each roster skin by its own id first. NOT the .wlvox line count: the first run compared against the
#     files and read every flaming skin as UNKNOWN, because the costume turns flame boxes into real fire surfaces and
#     does not count them (Jack Flame drawn 1,565 of 1,825 file boxes, Baal 1,863 of 2,185; Celestial Light, which has
#     no fire, 1,632 of 1,632). The signatures are distinct across the roster, so one names the figure.
#
#   R01  the roster lists every roster id and no retired one.
#   R05  every roster skin draws ITS OWN, distinct figure over the Dog with a real height; Relay OG is the canon body
#        itself (no costume). The Dog survives every change. Its signatures are what R02 and R04 compare against.
#   R02  wearing a RETIRED id draws its successor's figure (arden_infernal[_v1] -> Jack Flame, apollo[_v1] -> Baal).
#   R04  a REMEMBERED retired skin migrates at start-up: the file is written with an old id, a fresh PIE session starts,
#        the Dog is drawn in the successor, and the file now names the successor. Once for Arden, once for Apollo.
# The player's own remembered skin is restored on every exit path.
# PIE-owning: CONCURRENT is False.
CONCURRENT = False
import os

L = unreal.WonderlandUiTestLibrary
ROSTER = ["relay_og", "celestial_light", "skeleton_flame", "jack_flame", "baal"]
ALSO_ACTIVE = ["skeleton_flame_v1"]            # Skeleton Flame's V1 twin (2026-09-27), deliberately left in place
RETIRED = {"arden_infernal": "jack_flame", "arden_infernal_v1": "jack_flame", "apollo": "baal", "apollo_v1": "baal"}
FIGURE = {"relay_og": None, "celestial_light": "CelestialLight", "skeleton_flame": "SkeletonFlameV2",
          "skeleton_flame_v1": "SkeletonFlameV1", "jack_flame": "JackFlame", "baal": "Baal",
          "arden_infernal": "ArdenInfernalV2", "arden_infernal_v1": "ArdenInfernalV1", "apollo": "ApolloV2", "apollo_v1": "ApolloV1"}
SKINS_DIR = os.path.join(unreal.Paths.project_dir(), "RelaySkins")
PERSIST = os.path.join(unreal.Paths.project_saved_dir(), "Wonderland", "RelaySkin.txt")
LOG = r"C:\dev\iwonder\recovery\_manifests\wl-live-editor-104.log"       # the channel editor's -ABSLOG


def boxes_in(stem):
    with open(os.path.join(SKINS_DIR, stem + ".wlvox"), encoding="utf-8") as handle:
        return sum(1 for line in handle if line.startswith("box "))


def job():
    RESULT["status"] = "running"
    RESULT["tests"] = []
    original = open(PERSIST, encoding="utf-8").read() if os.path.isfile(PERSIST) else None
    RESULT["remembered_before"] = original
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    try:
        yield from _run(les, ues)
    finally:
        if original is None:
            if os.path.isfile(PERSIST):
                os.remove(PERSIST)
        else:
            with open(PERSIST, "w", encoding="utf-8", newline="") as handle:
                handle.write(original)
        RESULT["remembered_restored"] = open(PERSIST, encoding="utf-8").read() if os.path.isfile(PERSIST) else None
        if ues.get_game_world() is not None:
            les.editor_request_end_play()


def record(tid, name, ok, **detail):
    RESULT["tests"].append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
    emit(tid, "PASS" if ok else "FAIL", name, detail)


def _session(les, ues):
    """A fresh PIE session: a new GameInstance, so the skin registry runs Initialize -> LoadPersisted again."""
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 120)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 4.0


def _costume(world):
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandCompanionEmbodiment):
        if str(a.get_editor_property("class_label")) == "RELAY DOG SKIN":
            return a
    return None


def _signature(world):
    """The figure the Dog is drawn in, as the engine holds it: (box count, height). None/None = the canon body."""
    cos = _costume(world)
    if cos is None:                       # Relay OG: WearSkin destroys the costume and shows the canon body
        return {"boxes": None, "height_uu": None}
    return {"boxes": int(cos.get_box_count()), "height_uu": round(float(cos.get_figure_height_uu()), 1)}


def _run(les, ues):
    RESULT["figure_file_boxes"] = {sid: boxes_in(stem) for sid, stem in FIGURE.items() if stem}
    yield from _session(les, ues)
    world = ues.get_game_world()
    ui = L.get_ui(world)
    # ---- R01: the roster as the registry prints it
    token = "ZZS_ROSTER_MARK_%d" % int(unreal.MathLibrary.random_integer(1000000000))
    unreal.log_warning(token)
    unreal.SystemLibrary.execute_console_command(world, "wl.Skins.List")
    yield 3.0
    ids = []
    try:
        text = open(LOG, encoding="utf-8", errors="replace").read()
        tail = text[text.rfind(token):] if token in text else ""
        for line in tail.splitlines():
            if "WLSKIN " in line and "wear" not in line:
                bits = line.split("WLSKIN ", 1)[1].split()
                if bits and bits[0] == "*":
                    bits = bits[1:]
                if bits:
                    ids.append(bits[0])
    except Exception as exc:                                           # noqa: BLE001
        RESULT["log_error"] = repr(exc)
    record("R01", "the roster lists every roster skin and no retired one (wl.Skins.List, the registry's own listing)",
           bool(ids) and all(r in ids for r in ROSTER) and not any(r in ids for r in RETIRED),
           listed=ids, missing=[r for r in ROSTER if r not in ids], retired_listed=[r for r in RETIRED if r in ids])

    # ---- R05 first: every roster skin by its own id; its in-engine signature is what R02 and R04 compare against
    worn, sig = [], {}
    for sid in ROSTER + ALSO_ACTIVE:
        ok = bool(ui.wear_relay_skin(sid))
        yield 3.0
        w = ues.get_game_world()
        drawn = _signature(w)
        dog = unreal.GameplayStatics.get_player_pawn(w, 0)
        sig[sid] = drawn
        worn.append({"skin": sid, "accepted": ok, "drawn": drawn, "dog_alive": dog is not None})
    distinct = len({(x["drawn"]["boxes"], x["drawn"]["height_uu"]) for x in worn}) == len(worn)
    RESULT["signatures"] = sig
    record("R05", "every roster skin draws its own, distinct figure over a living Dog (Relay OG = the canon body, no costume)",
           distinct and all(x["accepted"] and x["dog_alive"] and ((x["skin"] == "relay_og" and x["drawn"]["boxes"] is None)
                                                                  or (x["skin"] != "relay_og" and (x["drawn"]["height_uu"] or 0) > 50.0))
                            for x in worn), worn=worn, distinct=distinct)

    # ---- R02: a retired id, worn through the Wardrobe's own call, draws its successor
    via_old = []
    for old, new in RETIRED.items():
        ui.wear_relay_skin("relay_og")
        yield 1.5
        ok = bool(ui.wear_relay_skin(old))
        yield 3.0
        drawn = _signature(ues.get_game_world())
        via_old.append({"asked": old, "accepted": ok, "drawn": drawn, "expected": new, "matches": drawn == sig.get(new)})
    record("R02", "wearing a retired id (Wardrobe call) draws its successor's figure",
           all(v["accepted"] and v["matches"] for v in via_old), cases=via_old)
    ui.wear_relay_skin("relay_og")
    yield 1.0

    # ---- R04: a remembered retired skin, at start-up, in a fresh session each
    cases = []
    for old, new in (("arden_infernal", "jack_flame"), ("apollo", "baal")):
        os.makedirs(os.path.dirname(PERSIST), exist_ok=True)
        with open(PERSIST, "w", encoding="utf-8", newline="") as handle:
            handle.write(old)
        yield from _session(les, ues)
        drawn = _signature(ues.get_game_world())
        after = open(PERSIST, encoding="utf-8").read().strip() if os.path.isfile(PERSIST) else None
        cases.append({"stored": old, "drawn": drawn, "file_after": after, "expected": new, "matches": drawn == sig.get(new)})
    record("R04", "a remembered Arden Infernal / Apollo comes up drawn as Jack Flame / Baal, and the file is rewritten",
           all(c["matches"] and c["file_after"] == c["expected"] for c in cases), cases=cases)

    RESULT["all_pass"] = all(t["pass"] for t in RESULT["tests"])
    RESULT["status"] = "proved" if RESULT["all_pass"] else "measured (see tests)"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 120)
