# G5 -- THE WORLD MAP MUST NOT TANGLE (founder, 2026-09-30).
#
# FOUNDER: "The current map has too many destination labels and markers concentrated on top of each other around the
# center ... Spread destination markers/labels apart visually. Prevent labels from overlapping each other ... Preserve the
# truthful relative direction/location of destinations ... Dense areas should progressively reveal detail ... The map must
# remain usable as the destination/teleport interface. Do NOT move actual Wonderland locations ... Verify at the actual
# resolution/UI scale used in Wonderland and capture evidence at multiple zoom levels."
#
# MODE "before": the pre-fix build -- frames of the map as the founder saw it (the arrival and the Tartarus rim).
# MODE "after": the fix -- for zoom 1 (fit), 2, 4 and 8, from the arrival: the widget's OWN painted layout
#   (DescribeMapLayout), then
#   M01  no two drawn labels overlap, at any zoom;
#   M02  no label covers another drawn marker;
#   M03  every marker sits exactly on its registry arrival point projected (truthful position, < 0.5 px);
#   M04  every offered place is on the map at every zoom -- as its own marker, or counted inside a cluster;
#   M05  zooming in reveals more names: labels shown rises with zoom, all 33 named by the deepest zoom;
#   M06  the important places are named even at fit (the Arrival Gate and the three nation quarters);
#   M07  the map is still the teleport: select TW01 / TW02 / MG01 from the map, TELEPORT, arrive;
#   M08  the offscreen render at the founder's own screen, 1920x1200 at the game's DPI scale, has no overlap either.
# Globals: MODE. PIE-owning: CONCURRENT is False. Saves nothing.
CONCURRENT = False
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
GS = unreal.GameplayStatics
MODE = globals().get("MODE", "after")
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zh", "map_%s" % MODE)
IMPORTANT = ["arrival", "icarus_quarter", "noctis_quarter", "tartarus_quarter"]


def _unwrap(ret):
    if isinstance(ret, tuple):
        if len(ret) >= 2 and isinstance(ret[0], bool):
            return ret[1] if ret[0] else None
        return ret[0] if ret else None
    return ret


def overlaps(a, b, pad=0.0):
    return a[0] < b[0] + b[2] + pad and b[0] < a[0] + a[2] + pad and a[1] < b[1] + b[3] + pad and b[1] < a[1] + a[3] + pad


def rect_hits_circle(r, cx, cy, rad):
    nx = min(max(cx, r[0]), r[0] + r[2])
    ny = min(max(cy, r[1]), r[1] + r[3])
    return (nx - cx) ** 2 + (ny - cy) ** 2 < rad * rad


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
    yield 4.0
    L.focus_game_viewport()
    ui = L.get_ui(world)
    travel = next(c for c in unreal.ObjectIterator(unreal.WonderlandTravelSubsystem) if c.get_world() == world)
    RESULT["viewport_size"] = str(unreal.WidgetLayoutLibrary.get_viewport_size(world))
    RESULT["viewport_scale"] = float(unreal.WidgetLayoutLibrary.get_viewport_scale(world))
    has_api = hasattr(ui, "describe_map_layout")
    RESULT["build_has_layout_api"] = has_api
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name)

    def go(did):
        travel.request_travel(did)
        w = 0.0
        yield 0.25
        while travel.is_travelling() and w < 95.0:
            yield 0.25
            w += 0.25
        w = 0.0
        while not L.is_world_partition_streaming_complete(world) and w < 20.0:
            yield 0.5
            w += 0.5
        yield 1.0

    def open_map():
        if not ui.is_world_map_open():
            ui.toggle_world_map()
        yield 1.2

    def close_map():
        if ui.is_world_map_open():
            ui.toggle_world_map()
        yield 0.6

    offered = [str(d.get_editor_property("id")) for d in travel.get_offered_destinations()]
    RESULT["offered"] = offered

    # ---------------------------------------------------------------- BEFORE: the founder's view, as it is
    if not has_api or MODE == "before":
        for where in ("arrival", "tartarus_heartland_east"):
            yield from go(where)
            yield from open_map()
            ok = L.capture_game_viewport(os.path.join(ROOT, "map_from_%s.png" % where))
            RESULT.setdefault("frames", []).append({"from": where, "capture": str(ok)})
            yield from close_map()
        yield from go("arrival")
        RESULT["status"] = "measured"
        return

    # ---------------------------------------------------------------- AFTER
    yield from go("arrival")
    yield from open_map()
    zooms = [1.0, 2.0, 4.0, 8.0]
    per_zoom = {}
    for z in zooms:
        ui.fit_map()
        ui.set_map_zoom(z)
        yield 0.8
        lay = json.loads(str(ui.describe_map_layout()))
        per_zoom[str(z)] = lay
        L.capture_game_viewport(os.path.join(ROOT, "map_zoom_%g.png" % z))
    RESULT["layouts"] = per_zoom

    def check_zoom(lay):
        """Label-label overlaps and labels over a DRAWN HALO (not the core: the halo is what the eye reads), YOU included."""
        stops = lay["stops"]
        labels = [(s["id"], s["label"]) for s in stops if s.get("label")]
        you = lay.get("you") or {}
        if you.get("label"):
            labels.append(("YOU", you["label"]))
        pairs = [(a[0], b[0]) for i, a in enumerate(labels) for b in labels[i + 1:] if overlaps(a[1], b[1])]
        covers = [(lid, s["id"]) for lid, r in labels for s in stops
                  if s["drawn"] and s["id"] != lid and rect_hits_circle(r, s["marker"][0], s["marker"][1], s.get("halo", s["radius"]))]
        return pairs, covers

    def halo_clashes(lay):
        drawn = [s for s in lay["stops"] if s["drawn"]]
        return [(a["id"], b["id"]) for i, a in enumerate(drawn) for b in drawn[i + 1:]
                if math.hypot(a["marker"][0] - b["marker"][0], a["marker"][1] - b["marker"][1]) < a.get("halo", 0) + b.get("halo", 0)]

    def crossings(lay):
        def cross(p, q, r):
            return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
        lines = [(s["id"], s["line"]) for s in lay["stops"] if isinstance(s.get("line"), list)]
        out = []
        for i, (ia, la) in enumerate(lines):
            for ib, lb in lines[i + 1:]:
                a, b2, c, d = la[:2], la[2:], lb[:2], lb[2:]
                d1, d2, d3, d4 = cross(c, d, a), cross(c, d, b2), cross(a, b2, c), cross(a, b2, d)
                if ((d1 > 0 > d2) or (d1 < 0 < d2)) and ((d3 > 0 > d4) or (d3 < 0 < d4)):
                    out.append((ia, ib))
        return out

    ov, cov = {}, {}
    for z, lay in per_zoom.items():
        ov[z], cov[z] = check_zoom(lay)
    record("M01", "no two drawn labels overlap, at zoom 1, 2, 4 and 8", all(not v for v in ov.values()),
           overlaps={z: v[:6] for z, v in ov.items() if v})
    record("M02", "no label (the YOU tag included) covers another drawn marker's HALO", all(not v for v in cov.values()),
           covers={z: v[:6] for z, v in cov.items() if v})
    clash = {z: halo_clashes(lay) for z, lay in per_zoom.items()}
    record("M09", "no two drawn markers' halos overlap, at any zoom", all(not v for v in clash.values()), clashes={z: v for z, v in clash.items() if v})
    cr = {z: crossings(lay) for z, lay in per_zoom.items()}
    record("M10", "no two leader lines cross, at any zoom", all(not v for v in cr.values()),
           crossings={z: v for z, v in cr.items() if v}, lines={z: sum(1 for s in lay["stops"] if isinstance(s.get("line"), list)) for z, lay in per_zoom.items()})
    # TRUTHFUL POSITIONS: the marker is where the registry's arrival point projects, with the map's own transform
    worst = 0.0
    for z, lay in per_zoom.items():
        for s in lay["stops"]:
            arr = _unwrap(travel.resolve_arrival(s["id"]))
            if arr is None:
                continue
            a = arr.translation
            px = lay["size"][0] * 0.5 + (lay["centre"][0] - a.x) * lay["scale"]
            py = lay["size"][1] * 0.5 + (lay["centre"][1] - a.y) * lay["scale"]
            worst = max(worst, math.hypot(px - s["marker"][0], py - s["marker"][1]))
    record("M03", "every marker is its registry arrival point projected north-up (worst error < 0.5 px)", worst < 0.5, worst_px=round(worst, 3))
    missing = {}
    for z, lay in per_zoom.items():
        # a place off the canvas at a deep zoom is not missing -- it is outside the view; at FIT every place is on it
        on = {s["id"] for s in lay["stops"] if s["on_screen"]}
        ids = {s["id"] for s in lay["stops"] if s["on_screen"] and (s["drawn"] or s.get("in_cluster"))}
        missing[z] = [i for i in offered if (i in on and i not in ids) or (z == "1.0" and i not in on)]
    record("M04", "every offered place is on the map at FIT, and every place on the canvas is drawn or counted in a group at every zoom",
           all(not v for v in missing.values()), missing={z: v for z, v in missing.items() if v})
    share = {}
    for z, lay in per_zoom.items():
        on = [s for s in lay["stops"] if s["on_screen"]]
        share[z] = round(sum(1 for s in on if s.get("label")) / max(len(on), 1), 3)
    named = {z: sum(1 for s in lay["stops"] if s.get("label")) for z, lay in per_zoom.items()}
    record("M05", "zooming in reveals more names: the share of places on the canvas that are named rises with zoom",
           share["1.0"] <= share["2.0"] <= share["4.0"] <= share["8.0"] and share["8.0"] > share["1.0"], share=share, named=named)
    fit_named = {s["id"] for s in per_zoom["1.0"]["stops"] if s.get("label")}
    record("M06", "the important places are named at fit (Arrival Gate, the three nation quarters)",
           all(i in fit_named for i in IMPORTANT), fit_named=sorted(fit_named))
    # DEEPEST ZOOM, PANNED: every place gets its name somewhere when the view is centred on it at zoom 8
    unnamed = []
    for did in offered:
        ui.center_map_on(did)
        yield 0.15
        lay = json.loads(str(ui.describe_map_layout()))
        hit = [s for s in lay["stops"] if s["id"] == did]
        if not hit or not hit[0].get("label"):
            unnamed.append(did)
    record("M05b", "centred on it at zoom 8, every one of the offered places shows its own name", not unnamed, unnamed=unnamed)
    # ---- STILL THE TELEPORT: the three places the founder named, through the map
    teleports = {}
    for did in ("tower_rise", "tower_lane", "mushroom_grove"):
        yield from open_map()
        ui.select_map_destination(did)
        yield 0.4
        sel = str(ui.get_map_selected_id())
        L.capture_game_viewport(os.path.join(ROOT, "map_selected_%s.png" % did))
        started = bool(ui.teleport_to_selected())
        w = 0.0
        yield 0.25
        while travel.is_travelling() and w < 95.0:
            yield 0.25
            w += 0.25
        teleports[did] = {"selected": sel, "started": started, "seconds": w, "report": str(travel.get_last_travel_report()),
                          "arrived": str(travel.get_last_arrived_destination()) == did}
        yield 1.0
    record("M07", "the map is still the teleport: TW01 Tower Rise, TW02 Tower Lane, MG01 Mushroom Grove selected on the map and reached",
           all(v["selected"] == k and v["arrived"] for k, v in teleports.items()), trips=teleports)
    yield from close_map()
    # ---- THE FOUNDER'S OWN SCREEN: 1920x1200 at the game's DPI curve, rendered offscreen from the live stops
    renders = {}
    for z in zooms:
        path = os.path.join(ROOT, "offscreen_1920x1200_zoom_%g.png" % z)
        got = ui.render_map_offscreen(path, 1920, 1200, z)
        renders[str(z)] = json.loads(str(got)) if str(got).startswith("{") else {"error": str(got)}
    RESULT["offscreen"] = {z: {k: v for k, v in r.items() if k != "stops"} for z, r in renders.items()}
    off_ov = {}
    checked = {}
    for z, lay in renders.items():
        if "stops" in lay:
            off_ov[z] = check_zoom(lay) + (halo_clashes(lay), crossings(lay))
            checked[z] = {"stops": len(lay["stops"]), "labels": sum(1 for s in lay["stops"] if s.get("label"))}
    # NOT VACUOUS: every zoom must have been rendered with stops and labels to check
    record("M08", "at 1920x1200 and the game's DPI scale: no label overlap, no label over a halo, no halo clash, no crossing lines",
           len(off_ov) == len(zooms) and all(c["labels"] > 0 for c in checked.values())
           and all(not a and not b and not c and not d for a, b, c, d in off_ov.values()),
           scale={z: r.get("dpi") for z, r in renders.items()}, checked=checked,
           bad={z: v for z, v in off_ov.items() if any(v)})
    yield from go("arrival")
    RESULT["all_pass"] = all(x["pass"] for x in tests)
    RESULT["status"] = "measured"
