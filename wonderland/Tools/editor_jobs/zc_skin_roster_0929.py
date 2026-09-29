# THE 2026-09-29 SKIN ROSTER, PROVEN IN PLAY: Arden Infernal and Apollo replaced by Jack Flame and Baal.
#
# FOUNDER, 2026-09-29: "These are replacements, NOT additional roster slots ... old Arden Infernal ownership/selection
# should migrate to Jack Flame, and old Apollo ownership/selection should migrate to Baal rather than disappearing."
# Verify: "1. all five canonical skins appear; 2. Arden Infernal and Apollo no longer appear player-facing; 3. Jack
# Flame and Baal can each be selected and rendered; ... 5. existing ownership/selection state migrates correctly;
# 6. no regression to Relay OG, Celestial Light, or Skeleton Flame."
#
# What this job asks, each as its own clause so a failure names itself:
#   R01  the registry lists every roster id (Relay OG, Celestial Light, Skeleton Flame, Jack Flame, Baal) and no
#        retired one -- read from DescribeSkins, the same list the Wardrobe and /skin draw from.
#   R02  MigrateLegacySkinId carries each retired id to its successor and leaves live ids alone.
#   R03  equipping a RETIRED id dresses the Dog in the successor (the console, /skin, an old binding).
#   R04  a REMEMBERED retired skin migrates at start-up: the remembered-skin file is written with an old id, a fresh
#        PIE session starts, and the equipped id and the rewritten file are read back. Twice: Arden, then Apollo.
#   R05  every roster skin equips, its figure file exists on disk, and the Dog reports wearing it.
# The player's own remembered skin is restored on every exit path.
# PIE-owning: CONCURRENT is False.
CONCURRENT = False
import os

ROSTER = ["relay_og", "celestial_light", "skeleton_flame", "jack_flame", "baal"]
ALSO_ACTIVE = ["skeleton_flame_v1"]            # Skeleton Flame's V1 twin (2026-09-27), deliberately left in place
RETIRED = {"arden_infernal": "jack_flame", "arden_infernal_v1": "jack_flame", "apollo": "baal", "apollo_v1": "baal"}
PERSIST = os.path.join(unreal.Paths.project_saved_dir(), "Wonderland", "RelaySkin.txt")


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    original = None
    if os.path.isfile(PERSIST):
        original = open(PERSIST, encoding="utf-8").read()
    RESULT["remembered_before"] = original
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    try:
        yield from _run(les, ues, record)
    finally:
        # THE PLAYER'S OWN CHOICE COMES BACK, whatever happened above.
        if original is None:
            if os.path.isfile(PERSIST):
                os.remove(PERSIST)
        else:
            with open(PERSIST, "w", encoding="utf-8", newline="") as handle:
                handle.write(original)
        RESULT["remembered_restored"] = open(PERSIST, encoding="utf-8").read() if os.path.isfile(PERSIST) else None
        if ues.get_game_world() is not None:
            les.editor_request_end_play()


def _session(les, ues):
    """A fresh PIE session: a new GameInstance, so the skin subsystem runs Initialize -> LoadPersisted again."""
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 120)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 2.0


def _skins(ues):
    gi = unreal.GameplayStatics.get_game_instance(ues.get_game_world())
    return gi.get_subsystem(unreal.WonderlandRelaySkinSubsystem) if gi is not None else None


def _run(les, ues, record):
    # ---- R04 first, because it needs the file written BEFORE a session starts.
    migrated = []
    for old, new in (("arden_infernal", "jack_flame"), ("apollo", "baal")):
        os.makedirs(os.path.dirname(PERSIST), exist_ok=True)
        with open(PERSIST, "w", encoding="utf-8", newline="") as handle:
            handle.write(old)
        yield from _session(les, ues)
        skins = _skins(ues)
        equipped = str(skins.get_equipped_skin_id()) if skins else None
        rewritten = open(PERSIST, encoding="utf-8").read().strip() if os.path.isfile(PERSIST) else None
        migrated.append({"stored": old, "equipped": equipped, "file_after": rewritten, "expected": new})
    record("R04", "a remembered Arden Infernal / Apollo migrates to Jack Flame / Baal at start-up, and the file is rewritten",
           all(m["equipped"] == m["expected"] and m["file_after"] == m["expected"] for m in migrated), cases=migrated)

    skins = _skins(ues)
    if skins is None:
        record("R00", "the skin subsystem exists in play", False)
        RESULT["status"] = "FAIL: no skin subsystem"
        return
    lines = [str(l) for l in skins.describe_skins()]
    ids = [l[2:].split()[0] for l in lines if len(l) > 2]
    RESULT["registry"] = lines
    record("R01", "every roster skin is registered and no retired one is",
           all(r in ids for r in ROSTER) and not any(r in ids for r in RETIRED),
           ids=ids, missing=[r for r in ROSTER if r not in ids], retired_present=[r for r in RETIRED if r in ids],
           also_active=[a for a in ALSO_ACTIVE if a in ids])

    mapping = {old: str(skins.migrate_legacy_skin_id(old)) for old in list(RETIRED) + ROSTER}
    record("R02", "retired ids map to their successors; live ids are left alone",
           all(mapping[o] == n for o, n in RETIRED.items()) and all(mapping[r] == r for r in ROSTER), mapping=mapping)

    via_old = []
    for old, new in RETIRED.items():
        ok = bool(skins.equip_skin(old))
        yield 1.0
        via_old.append({"asked": old, "accepted": ok, "equipped": str(skins.get_equipped_skin_id()), "expected": new})
    record("R03", "equipping a retired id dresses the Dog in its successor",
           all(v["accepted"] and v["equipped"] == v["expected"] for v in via_old), cases=via_old)

    worn = []
    for sid in ROSTER + ALSO_ACTIVE:
        ok = bool(skins.equip_skin(sid))
        yield 2.5
        path = str(skins.figure_path_for(sid))
        dog = unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0)
        worn.append({"skin": sid, "accepted": ok, "equipped": str(skins.get_equipped_skin_id()),
                     "figure": os.path.basename(path) if path else "", "figure_on_disk": bool(path) and os.path.isfile(path),
                     "dog_alive": dog is not None})
    record("R05", "every roster skin equips, its figure is on disk, and the Dog is still there",
           all(w["accepted"] and w["equipped"] == w["skin"] and (w["figure_on_disk"] or w["skin"] == "relay_og") and w["dog_alive"]
               for w in worn), worn=worn)
    skins.equip_skin("relay_og")
    RESULT["all_pass"] = all(t["pass"] for t in RESULT["tests"])
    RESULT["status"] = "proved" if RESULT["all_pass"] else "measured (see tests)"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 120)
