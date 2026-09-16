#!/usr/bin/env python3
"""ER01 -- East Reach: an arrival court.

THE GAP (withheld 2026-09-15, PRIVATE_BETA_GATE item 11; captures d4). The map landed a visitor at (23559, 11422) on the reach's lawn and cobble edge under bell strings,
with nothing authored to arrive on.

WHAT THIS PASS DOES.
  TURN  the arrival from yaw -154.5 to -98.0, facing the reach's balloon 15 m away (bearing -98, 71 m tall).
  COURT the arrival_court.py court, top z 0.0: plaza slabs in courses, a warm edge band, a gold rim line, a
        gold-and-rose medallion, a lamp pair, beds of forge flower runs round the rim (open ahead and behind), and a
        stone rose garden arch climbed by roses at the front edge framing the view.
MEASURED INPUTS. Footprint census (r 11 m) and the district census of 2026-09-13 for the landmark bearings.
"""
from pathlib import Path

import arrival_court
import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "ER01"
AX, AY, YAW, LAWN = 23559.0, 11422.0, -98.0, -14.0
COURT_TOP = 0.0


def build():
    return arrival_court.build(PASS, AX, AY, YAW, LAWN, COURT_TOP, 20261123,
                               title="East Reach: an arrival court framed by a rose arch")


if __name__ == "__main__":
    layer = build()
    K.write(HERE / "er01_east_reach.json", layer)
    print("%s: %d actors, %d batches, %d instances" % (PASS, len(layer["actors"]), len(layer["batches"]),
                                                     sum(len(b["instances"]) for b in layer["batches"])))
