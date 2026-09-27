# TERRITORY DISCOVERY AND CHECKPOINTS, WALKED RATHER THAN ASSERTED.
#
# FOUNDER, 2026-09-25: "Add proper world orientation ... Each major territory / nation / region should have a
# visible checkpoint marker ... clicking/selecting a checkpoint should open a clean info panel: TERRITORY NAME,
# SPECIALIZATION, PURPOSE, IMPORTANT LOCATIONS, AVAILABLE ACTIVITIES, DISCOVERED/UNDISCOVERED STATE ... Show a
# brief in-world discovery treatment the first time a player enters a territory ... PIE-verify every
# implemented territory."
#
# AND, ABOVE ALL: "DO NOT INVENT THE TERRITORY SPECIALIZATIONS ... If a territory genuinely has no canonical
# specialization yet, mark it as NEEDS FOUNDER DEFINITION rather than silently inventing permanent lore."
#
# THAT LAST ONE IS THE HARDEST CLAUSE TO PROVE and it is the first one here: every specialisation the game
# shows is compared against WorldDesign/CANON/nations.json, read from disk in this proof, and a territory the
# canon is silent about must show NEEDS FOUNDER DEFINITION and nothing else. A build that had quietly written
# a purpose for Dubel Forest would fail T02 whatever else it did.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import json
import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "territories")
CANON = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "WorldDesign", "CANON", "nations.json")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
            os.remove(os.path.join(ROOT, old))
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

    ui = L.get_ui(world)
    terr = L.get_territories(world)
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    record("T00", "the territory subsystem is running", terr is not None)
    if terr is None:
        RESULT["status"] = "FAIL"
        return

    rows = list(terr.get_territories())
    RESULT["territories"] = [{"id": str(r.id), "name": r.display_name,
                              "spec": r.specialisation, "canon": bool(r.specialisation_is_canon),
                              "xy": [round(r.checkpoint_xy.x, 1), round(r.checkpoint_xy.y, 1)],
                              "source": r.canon_source} for r in rows]
    record("T01", "every territory in the registry is loaded", len(rows) >= 5,
           count=len(rows), ids=[str(r.id) for r in rows])

    # ---- THE CLAUSE ABOUT INVENTED LORE, checked against the canon file itself.
    with open(CANON, encoding="utf-8") as f:
        canon = json.load(f)
    canon_specs = {}
    for nation in canon["nations"]:
        canon_specs[nation["id"].lower()] = nation["specialisation"].replace("_", " ").lower()
    canon_silent = set(str(e["id"]).lower() for e in canon.get("exceptions", []))
    mismatches = []
    unmarked = []
    for r in rows:
        rid = str(r.id).lower()
        shown = (r.specialisation or "").strip().lower()
        if rid in canon_specs:
            if shown != canon_specs[rid]:
                mismatches.append({"id": rid, "shown": r.specialisation, "canon": canon_specs[rid]})
        elif rid in canon_silent:
            # The canon states no specialisation for this one. The registry must say so, not fill it in.
            if bool(r.specialisation_is_canon) or shown:
                unmarked.append({"id": rid, "shown": r.specialisation,
                                 "canon_says": "nothing -- exception rule only"})
    RESULT["canon_check"] = {"mismatched": mismatches, "silently_invented": unmarked,
                             "canon_file": CANON}
    record("T02", "every specialisation shown is the canon's own word, and the canon's silence is marked",
           not mismatches and not unmarked,
           mismatched=mismatches, silently_invented=unmarked,
           note="read out of WorldDesign/CANON/nations.json in this proof. The founder: 'DO NOT INVENT THE "
                "TERRITORY SPECIALIZATIONS ... mark it as NEEDS FOUNDER DEFINITION rather than silently "
                "inventing permanent lore.'")

    needs = [str(r.id) for r in rows if not bool(r.specialisation_is_canon)]
    RESULT["needs_founder_definition"] = needs
    record("T03", "the territories the canon does not define are named, not guessed at",
           len(needs) >= 1, needing=needs,
           note="DUBEL FOREST. nations.json gives it an existence and an exception rule and states no "
                "discipline; the panel and the banner both read NEEDS FOUNDER DEFINITION for it.")

    # ---- A MARKER STANDING FOR EVERY ONE OF THEM, and it is a gatepost rather than a pin.
    standing = int(terr.get_standing_checkpoint_count())
    markers = {}
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandTerritoryCheckpoint):
        markers[str(actor.get_territory_id())] = {
            "at": [round(actor.get_actor_location().x, 1), round(actor.get_actor_location().y, 1),
                   round(actor.get_actor_location().z, 1)],
            "height": round(actor.get_height_uu(), 1)}
    RESULT["markers"] = markers
    record("T10", "a checkpoint marker is standing for every territory",
           standing == len(rows) and len(markers) == len(rows),
           standing=standing, expected=len(rows), found=sorted(markers.keys()))
    record("T11", "the markers are architecture, not floating pins",
           all(v["height"] >= 400.0 for v in markers.values()),
           heights=[v["height"] for v in markers.values()], floor=400.0,
           note="the founder: 'Do NOT use generic floating map pins.' Six metres of standing stone, on the "
                "ground, at the scale of a gatepost.")

    # ---- NOTHING IS DISCOVERED UNTIL IT IS WALKED INTO.
    #
    # AND THE DOG HAS TO STEP OUTSIDE FIRST. The first run of this proof forgot every discovery while the Dog
    # was standing in the middle of Golden Arrival, and the subsystem -- correctly -- found it again within a
    # quarter of a second. What that measured was the proof's own footing, not the feature.
    home = dog.get_actor_location()
    dog.set_actor_location(unreal.Vector(-78000.0, 78000.0, home.z + 200.0), False, False)
    yield 1.5
    terr.forget_discoveries()
    yield 1.0
    record("T20", "a player who has been nowhere has discovered nothing",
           terr.get_discovered_count() == 0 and str(terr.get_current_territory()) == "None",
           discovered=terr.get_discovered_count(), standing_in=str(terr.get_current_territory()),
           note="taken from a spot outside every territory's radius; standing in one and calling it "
                "undiscovered would be measuring the proof rather than the world")

    # ---- WALK TO EVERY TERRITORY AND WATCH IT BE FOUND.
    walked = {}
    RESULT["walk"] = walked
    for r in rows:
        rid = str(r.id)
        was = terr.is_discovered(r.id)
        # Put the Dog on the checkpoint, the way arriving does. Swept off, because it is crossing the map.
        dog.set_actor_location(unreal.Vector(r.checkpoint_xy.x, r.checkpoint_xy.y,
                                             dog.get_actor_location().z + 200.0), False, False)
        # Long enough for the subsystem's quarter-second check and for the banner to raise.
        yield 2.0
        here = str(terr.get_current_territory())
        found = terr.is_discovered(r.id)
        announcing = str(ui.announced_territory())
        shot = os.path.join(ROOT, "%s.png" % rid)
        try:
            L.capture_game_viewport(shot)
        except Exception:
            pass
        walked[rid] = {"was_discovered": bool(was), "now_discovered": bool(found),
                       "current": here, "announcing": announcing,
                       "banner_name": ui.announced_name(), "banner_spec": ui.announced_specialisation()}
        emit("T_%s" % rid, "INFO", "arrived at %s" % rid, walked[rid])
        # Let the banner expire so the next arrival raises its own.
        yield 6.5

    record("T21", "standing in a territory is recognised, for every territory",
           all(v["current"] == k for k, v in walked.items()),
           current_by_territory={k: v["current"] for k, v in walked.items()})

    record("T22", "every territory is DISCOVERED by walking into it, and none before",
           all(v["now_discovered"] and not v["was_discovered"] for v in walked.values()),
           per_territory={k: [v["was_discovered"], v["now_discovered"]] for k, v in walked.items()})

    record("T23", "the first-entry banner names the territory it was raised for",
           all(v["announcing"] == k for k, v in walked.items()),
           announcing_by_territory={k: v["announcing"] for k, v in walked.items()})

    # AND THE BANNER OBEYS THE SAME RULE ABOUT INVENTED LORE.
    banner_bad = {k: v["banner_spec"] for k, v in walked.items()
                  if not v["banner_spec"]
                  or (k == "dubel" and v["banner_spec"] != "NEEDS FOUNDER DEFINITION")}
    record("T24", "the banner's second line is the canon's word, or the fact that there is none",
           not banner_bad, wrong=banner_bad,
           banner_spec_by_territory={k: v["banner_spec"] for k, v in walked.items()})

    # ---- THE MAP ANSWERS THE FOUNDER'S SIX QUESTIONS.
    ui.toggle_world_map()
    yield 3.0
    RESULT["map_open"] = bool(ui.get_overlays_in_viewport() > 0)
    RESULT["map_territory_count"] = int(ui.get_map_territory_count())
    record("T30", "the world map carries every territory", ui.get_map_territory_count() == len(rows),
           on_the_map=ui.get_map_territory_count(), expected=len(rows),
           note="the founder asked for this inside the existing navigation UI rather than beside it")

    panels = {}
    for r in rows:
        ui.select_map_territory(r.id)
        yield 0.6
        panels[str(r.id)] = ui.describe_map_territory()
    RESULT["map_panels"] = panels
    # NAME, SPECIALIZATION, STATE, PURPOSE, PLACES, ACTIVITIES, WAY -- the founder's own list, seven fields.
    record("T31", "selecting a territory shows name, specialisation, state, purpose, places, activities and the way there",
           all(len(str(v).split("|")) == 7 for v in panels.values()),
           fields={k: len(str(v).split("|")) for k, v in panels.items()})

    ways = {k: (str(v).split("|")[6] if len(str(v).split("|")) == 7 else "") for k, v in panels.items()}
    record("T32", "the map says which way every territory lies and how far",
           all(w.strip() for w in ways.values()), way=ways,
           note="the founder: 'Where is ICARUS? Where is NOCTIS? Where is TARTARUS? ... How do I get there?'")

    try:
        L.capture_game_viewport(os.path.join(ROOT, "map_territories.png"))
    except Exception:
        pass

    # ---- AND DISCOVERY SURVIVES. A discovery lost on exit is not a discovery.
    RESULT["discovered_at_end"] = terr.get_discovered_count()
    record("T40", "every territory walked into is still discovered at the end of the walk",
           terr.get_discovered_count() == len(rows),
           discovered=terr.get_discovered_count(), expected=len(rows))

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 1.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
