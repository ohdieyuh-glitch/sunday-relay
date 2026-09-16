#!/usr/bin/env python3
"""VW01 -- view windows: the corridor stops hiding its own city (2026-09-16).

THE GAP (PRIVATE_BETA_GATE items 2 and 5; captures `city1`, `city2`). Looking FORWARD down the Golden Arrival the
world is already the Bible: spires, domes, balloons, floating islands, the rondel. Looking SIDEWAYS from the same
spot, at eye height, there is no city at all -- a continuous wall of generator hedge stands 4 to 9 m off the axis and
fills the frame with green for the whole walk. Raise the camera to 9 m (`city2`) and the city is right there:
pale spires, domes, teapot pavilions, gardens, balloons, 30 to 150 m out. So the midground is not missing, which is
what the gate assumed; it is hidden by a hedge one and a half metres above the visitor's eye.

WHAT THIS PASS DOES. It does not clear the hedge -- foliage framing is wanted. It gives the hedge a RHYTHM, which is
what a processional avenue should have had: alternate blocks are sunk so clipped hedge masses alternate with windows
about 6 m wide, and the city shows through at eye height at regular intervals along the whole corridor. Three runs:

  AVENUE      y -5867..-2533, x +/-900: six blocks a side, 7.4 m across on a 6.7 m pitch -- a solid wall. Alternate
              blocks sunk, leaving three a side with a window between each.
  PLAZA FLANK y +1100, x +/-560..+/-1700: a thicket four deep either side of the arrival plaza. The two nearest the
              axis are sunk a side; the outer two stay as midground mass.
  GARDEN PATH y +1950..+4190, x +/-390..+/-420: eight blocks a side, 2.2-2.8 m tall at 4 m out. Alternate blocks
              sunk, so the path keeps its hedge and gains windows.

It also sinks two hedge masses at (-600, 2800) and (-1250, 2760) that stand in mid air, 2.6 m clear of the ground.

REVERSIBLE. Every instance carries its exact before transform; apply_vegetation_trim.py REVERT puts them all back.

    python vw01_corridor_view_windows.py     (reads the corridor census, writes vw01_corridor_view_windows.json)
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
CENSUS = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/corridor_veg.json")
SINK_UU = 100000.0
PASS = "VW01"

# (y, |x|) of every hedge mass to sink, with the reason it goes. Both signs of x unless the x is given signed.
AVENUE = [(-5200, 900), (-3867, 900), (-2533, 900)]
PLAZA = [(1100, 560), (1100, 940)]
PATH = [(2270, 420), (2910, 420), (3550, 420), (4190, 420)]
FLOATING = [(2800, -600), (2760, -1250)]


def want(rows):
    """Pick the census instances to sink: the listed (y, x) pairs, both sides unless the x is signed."""
    picks, why = [], {}
    for (y, x) in AVENUE + PLAZA + PATH:
        for sx in (x, -x):
            picks.append((y, sx))
    for (y, x) in FLOATING:
        picks.append((y, x))
    for (y, x) in AVENUE:
        why[(y, x)] = why[(y, -x)] = "avenue: alternate block, so the hedge has windows"
    for (y, x) in PLAZA:
        why[(y, x)] = why[(y, -x)] = "plaza flank: the two nearest the axis, so the midground shows"
    for (y, x) in PATH:
        why[(y, x)] = why[(y, -x)] = "garden path: alternate block, so the path hedge has windows"
    for (y, x) in FLOATING:
        why[(y, x)] = "stands 2.6 m clear of the ground"
    out = []
    for r in rows:
        if r["mesh"] != "SM_hedge_mass" or r["kind"] != "instance":
            continue
        key = (r["y"], r["x"])
        if key in picks:
            t = r["transform"]
            out.append({"name": r["name"], "label": r["label"], "mesh": r["mesh"], "index": r["index"],
                        "why": why[key], "before": list(t), "after": t[:2] + [t[2] - SINK_UU] + list(t[3:])})
    return out


def build():
    rows = json.loads(CENSUS.read_text(encoding="utf-8"))
    rows = rows["rows"] if isinstance(rows, dict) else rows
    trims = want(rows)
    return {"pass": PASS, "title": "VW01: view windows through the corridor's hedge wall", "trims": trims}


if __name__ == "__main__":
    spec = build()
    (HERE / "vw01_corridor_view_windows.json").write_text(json.dumps(spec, indent=1), encoding="utf-8")
    print("%s: %d hedge masses sunk" % (PASS, len(spec["trims"])))
    for t in spec["trims"]:
        print("   %-28s idx %3d  (%+6.0f, %+6.0f)  %s" % (t["name"], t["index"], t["before"][0], t["before"][1], t["why"]))
