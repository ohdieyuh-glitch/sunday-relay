#!/usr/bin/env python3
"""CK01 -- The Colossal Key: an arrival court.

THE GAP (withheld 2026-09-15, PRIVATE_BETA_GATE item 11; captures d5). The map landed a visitor at (20342, -14247) on the quarter's balustraded cobble terrace (top 12) looking over the city,
with nothing authored to arrive on.

WHAT THIS PASS DOES.
  KEEP  the arrival yaw 69.0: it already faces the balustraded terrace and the city beyond that it already faced (court radius 3.8 m, so the terrace's own balustrades at 4.8 m stay clear).
  COURT the arrival_court.py court, top z 12.5, radius 3.8 m: plaza slabs in courses, a warm edge band, a gold rim
        line, a gold-and-rose medallion, a lamp pair, beds of forge flower runs round the rim (open ahead and behind),
        and a stone rose garden arch climbed by roses at the front edge framing the view.
MEASURED INPUTS. Footprint census (r 11 m) and the district census of 2026-09-13 for the landmark bearings.
"""
from pathlib import Path

import arrival_court
import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "CK01"
AX, AY, YAW, LAWN = 20342.0, -14247.0, 69.0, -14.0
COURT_TOP, COURT_R = 12.5, 380.0


def build():
    return arrival_court.build(PASS, AX, AY, YAW, LAWN, COURT_TOP, 20261125, court_r=COURT_R,
                               title="The Colossal Key: an arrival court framed by a rose arch")


if __name__ == "__main__":
    layer = build()
    K.write(HERE / "ck01_colossal_key.json", layer)
    print("%s: %d actors, %d batches, %d instances" % (PASS, len(layer["actors"]), len(layer["batches"]),
                                                     sum(len(b["instances"]) for b in layer["batches"])))
