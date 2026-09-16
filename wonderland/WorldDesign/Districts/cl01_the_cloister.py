#!/usr/bin/env python3
"""CL01 -- The Cloister: an arrival court on the terrace walk.

THE GAP (withheld 2026-09-15, PRIVATE_BETA_GATE item 11; captures d3). The map lands a visitor at (8716, 13141) on a
wide paved terrace (top 19) facing yaw 57 along a walk between columns toward the quarter's urns, balustrades and the
city beyond -- a good view standing on unauthored paving, with nothing to mark the arrival.

WHAT THIS PASS DOES. The arrival keeps its yaw and gets the arrival_court.py court flush with the terrace (top 19.5):
plaza slabs in courses, a warm edge band, a gold rim line, a gold-and-rose medallion, a lamp pair, beds of forge flower
runs round the rim (open along the walk), and a stone rose garden arch climbed by roses at the front edge, framing the
walk on.
MEASURED INPUTS. Footprint census 522 (r 12 m): terrace platform top 19 at 1.7 m, lawn -3 at 6.3 m; the nearest props
are ground flowers at 4.9 m and a signpost at 7.8 m -- nothing inside the court.
"""
from pathlib import Path

import arrival_court
import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "CL01"
AX, AY, YAW, LAWN = 8716.0, 13141.0, 57.3, -3.0
COURT_TOP = 19.5


def build():
    # the walk on (CL02) leaves the court at +50 degrees, where the district has room: its beds open there too
    return arrival_court.build(PASS, AX, AY, YAW, LAWN, COURT_TOP, 20260915 + 203, openings=((0.0, 35.0), (180.0, 35.0), (50.0, 30.0)),
                               title="The Cloister: an arrival court on the terrace walk, framed by a rose arch")


if __name__ == "__main__":
    layer = build()
    K.write(HERE / "cl01_the_cloister.json", layer)
    print("%s: %d actors, %d batches, %d instances" % (PASS, len(layer["actors"]), len(layer["batches"]),
                                                     sum(len(b["instances"]) for b in layer["batches"])))
