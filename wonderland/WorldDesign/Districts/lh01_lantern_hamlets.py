#!/usr/bin/env python3
"""LH01 -- Lantern Hamlets: an arrival court.

THE GAP (withheld 2026-09-15, PRIVATE_BETA_GATE item 11; captures d5). The map landed a visitor at (-14986, 7450) on open ground between the hamlets' walls,
with nothing authored to arrive on.

WHAT THIS PASS DOES.
  TURN  the arrival from yaw -28.7 to 150.0, facing the hamlets' pavilion 14.7 m away (bearing 159, 22.7 m tall) with their lantern tree 12.8 m off at bearing 126.
  COURT the arrival_court.py court, top z 0.0, radius 4.7 m: plaza slabs in courses, a warm edge band, a gold rim
        line, a gold-and-rose medallion, a lamp pair, beds of forge flower runs round the rim (open ahead and behind),
        and a stone rose garden arch climbed by roses at the front edge framing the view.
MEASURED INPUTS. Footprint census (r 11 m) and the district census of 2026-09-13 for the landmark bearings.
"""
from pathlib import Path

import arrival_court
import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "LH01"
AX, AY, YAW, LAWN = -14986.0, 7450.0, 150.0, -14.0
COURT_TOP, COURT_R = 0.0, 470.0


def build():
    # the walk on (LH02) leaves the court at +60 degrees, where the district has room: its beds open there too
    return arrival_court.build(PASS, AX, AY, YAW, LAWN, COURT_TOP, 20261126, court_r=COURT_R, openings=((0.0, 35.0), (180.0, 35.0), (60.0, 30.0)),
                               title="Lantern Hamlets: an arrival court framed by a rose arch")


if __name__ == "__main__":
    layer = build()
    K.write(HERE / "lh01_lantern_hamlets.json", layer)
    print("%s: %d actors, %d batches, %d instances" % (PASS, len(layer["actors"]), len(layer["batches"]),
                                                     sum(len(b["instances"]) for b in layer["batches"])))
