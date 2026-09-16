#!/usr/bin/env python3
"""SM01 -- South Meadows: an arrival court.

THE GAP (withheld 2026-09-15, PRIVATE_BETA_GATE item 11; captures d4). The map landed a visitor at (2187, -26650) on a lawn beside the quarter's pavilion, with slab strips and a gate pier,
with nothing authored to arrive on.

WHAT THIS PASS DOES.
  TURN  the arrival from yaw 96.1 to 32.0, facing the pavilion 17 m away (LMSouthMeadows_Pavilion, bearing 32).
  COURT the arrival_court.py court, top z 0.0: plaza slabs in courses, a warm edge band, a gold rim line, a
        gold-and-rose medallion, a lamp pair, beds of forge flower runs round the rim (open ahead and behind), and a
        stone rose garden arch climbed by roses at the front edge framing the view.
MEASURED INPUTS. Footprint census (r 11 m) and the district census of 2026-09-13 for the landmark bearings.
"""
from pathlib import Path

import arrival_court
import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "SM01"
AX, AY, YAW, LAWN = 2187.0, -26650.0, 32.0, -14.0
COURT_TOP = 0.0


def build():
    return arrival_court.build(PASS, AX, AY, YAW, LAWN, COURT_TOP, 20261120,
                               title="South Meadows: an arrival court framed by a rose arch")


if __name__ == "__main__":
    layer = build()
    K.write(HERE / "sm01_south_meadows.json", layer)
    print("%s: %d actors, %d batches, %d instances" % (PASS, len(layer["actors"]), len(layer["batches"]),
                                                     sum(len(b["instances"]) for b in layer["batches"])))
