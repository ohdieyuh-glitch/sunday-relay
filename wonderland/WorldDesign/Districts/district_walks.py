#!/usr/bin/env python3
"""The twelve arrival courts get somewhere to walk (2026-09-16).

THE GAP (PRIVATE_BETA_GATE item 12). Every offered place arrives on an authored court, and each court ends at its
rose arch with generator lawn beyond: a visitor has a good place to stand and nowhere to go.

WHAT THIS PASS DOES, per district: a walk leaving the court (arrival_walk.py) -- paved band, warm edges, a gold line
each side, flower beds down both borders, a lamp pair halfway and at the end, and a small round overlook where it
stops. The courts are regenerated with a third opening in their bed ring so the walk leaves through a gap rather than
over a bed.

WHERE EACH WALK GOES, measured not guessed. Straight ahead is blocked in most districts -- the generator packed them
(a straight walk would run 0-12 m, and Royal Gardens 0). So for each district the bearing is chosen by sweeping
+/-75 degrees off the arrival yaw, taking the longest run that no census solid stands in (district census 2026-09-13,
half width 2 m plus the obstacle's own footprint, minus the overlook's radius), with a mild preference for straight
ahead. That turns 0-12 m of walk into 7-24 m.

    python district_walks.py     (writes <pass>_walk.json for each district)
"""
import json
import math
from pathlib import Path

import arrival_walk as W
import courtkit as K

HERE = Path(__file__).resolve().parent
CENSUS = json.loads((Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/district_census.json")).read_text(encoding="utf-8")) \
    if Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/district_census.json").exists() else None
PLAN = HERE / "district_walks_plan.json"
# Ground measured under every walk (probe_ground_editor.py, 2026-09-16). Rows [d, ground z, ground actor, lowest
# z beside the walk]; arrival_walk.top_for turns each into the height its course is laid at.
GROUND = json.loads((HERE / "walk_ground.json").read_text(encoding="utf-8"))["districts"]
# (pass, destination, anchor x, y, arrival yaw, court top, court reach incl. rim, turn deg, length uu)
WALKS = [
    ("RG02", "royal_gardens", 3676.0, 11242.0, -40.0, 19.5, 576.0, -45.0, 716.0),
    ("CQ02", "clock_quarter", 13162.0, 1870.0, -175.0, 12.5, 916.0, 15.0, 2246.0),
    ("CL02", "the_cloister", 8716.0, 13141.0, 57.3, 19.5, 576.0, 50.0, 1493.0),
    ("EQ02", "east_quarter", 19400.0, 2000.0, -173.7, 12.5, 536.0, -65.0, 1871.0),
    ("WW02", "west_wood", -31207.0, 4521.0, -10.0, 12.5, 576.0, -30.0, 2400.0),
    ("FO02", "far_orchards", 20506.0, -21506.0, 110.0, 0.0, 576.0, 65.0, 2400.0),
    ("ER02", "east_reach", 23559.0, 11422.0, -98.0, 0.0, 576.0, 35.0, 2400.0),
    ("TC02", "teapot_court", -11081.0, -7144.0, -156.0, 0.0, 576.0, -35.0, 2400.0),
    ("CK02", "colossal_key", 20342.0, -14247.0, 69.0, 12.5, 486.0, 0.0, 2400.0),
    ("LH02", "lantern_hamlets", -14986.0, 7450.0, 150.0, 0.0, 576.0, 60.0, 2137.0),
    ("SM02", "south_meadows", -65.0, -25350.0, 150.0, 0.0, 576.0, -15.0, 2400.0),
    ("WG02", "water_gardens", -3439.0, -10967.0, 20.0, 0.0, 576.0, -20.0, 1102.0),
]
NAMES = {"RG02": "Royal Gardens", "CQ02": "Clock Quarter", "CL02": "The Cloister", "EQ02": "The East Quarter",
         "WW02": "West Wood", "FO02": "Far Orchards", "ER02": "East Reach", "TC02": "Teapot Court",
         "CK02": "The Colossal Key", "LH02": "Lantern Hamlets", "SM02": "South Meadows", "WG02": "Water Gardens"}


def build_all():
    out = {}
    for (p, did, ax, ay, yaw, top, reach, turn, length) in WALKS:
        # a turned walk leaves at the court's rim; a straight one has to clear the court's own arch first
        start = reach + (150.0 if abs(turn) >= 10.0 else 380.0)
        profile = [[row[0], W.top_for(row[1], row[2]), row[3]] for row in GROUND[p]]
        layer = W.build(p, ax, ay, yaw + turn, top, 20260916 + WALKS.index((p, did, ax, ay, yaw, top, reach, turn, length)),
                        start, length, "%s: a walk on from the arrival court to an overlook" % NAMES[p], profile)
        layer["turn_deg"] = turn
        layer["destination"] = did
        K.write(HERE / ("%s_walk.json" % p.lower()), layer)
        out[p] = {"destination": did, "turn": turn, "start": round(start), "length": round(length),
                  "overlook": layer["walk"]["overlook_at"], "legs": layer["walk"]["legs"],
                  "instances": sum(len(b["instances"]) for b in layer["batches"])}
    K.write(PLAN, out)
    return out


if __name__ == "__main__":
    plan = build_all()
    for p, row in plan.items():
        print("%-5s %-16s turn %+4.0f  start %4d  length %5d  overlook %s  %d instances"
              % (p, row["destination"], row["turn"], row["start"], row["length"], row["overlook"], row["instances"]))
