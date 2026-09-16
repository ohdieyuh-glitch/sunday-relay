#!/usr/bin/env python3
"""WW01 -- West Wood: an arrival court.

THE GAP (withheld 2026-09-15, PRIVATE_BETA_GATE item 11; captures d4). The map landed a visitor at (-31207, 4521) on the wood's cobbled edge (terrace top 12), mushroom canopies and the city ahead,
with nothing authored to arrive on.

WHAT THIS PASS DOES.
  KEEP  the arrival yaw -10.0: it already faces the mushroom canopies and the city it already faced.
  COURT the arrival_court.py court, top z 12.5: plaza slabs in courses, a warm edge band, a gold rim line, a
        gold-and-rose medallion, a lamp pair, beds of forge flower runs round the rim (open ahead and behind), and a
        stone rose garden arch climbed by roses at the front edge framing the view.
MEASURED INPUTS. Footprint census (r 11 m) and the district census of 2026-09-13 for the landmark bearings.
"""
from pathlib import Path

import arrival_court
import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "WW01"
AX, AY, YAW, LAWN = -31207.0, 4521.0, -10.0, -14.0
COURT_TOP = 12.5


def build():
    return arrival_court.build(PASS, AX, AY, YAW, LAWN, COURT_TOP, 20261121,
                               title="West Wood: an arrival court framed by a rose arch")


if __name__ == "__main__":
    layer = build()
    K.write(HERE / "ww01_west_wood.json", layer)
    print("%s: %d actors, %d batches, %d instances" % (PASS, len(layer["actors"]), len(layer["batches"]),
                                                     sum(len(b["instances"]) for b in layer["batches"])))
