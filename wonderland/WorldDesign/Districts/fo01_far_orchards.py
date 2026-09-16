#!/usr/bin/env python3
"""FO01 -- Far Orchards: an arrival court.

THE GAP (withheld 2026-09-15, PRIVATE_BETA_GATE item 11; captures d4). The map landed a visitor at (20506, -21506) on lawn between gate piers, with the orchard's gold clock landmark off to one side,
with nothing authored to arrive on.

WHAT THIS PASS DOES.
  TURN  the arrival from yaw 135.0 to 110.0, facing the orchard clock 18.5 m away (LMFarOrchards_Clock, bearing 110, 33 m tall).
  COURT the arrival_court.py court, top z 0.0: plaza slabs in courses, a warm edge band, a gold rim line, a
        gold-and-rose medallion, a lamp pair, beds of forge flower runs round the rim (open ahead and behind), and a
        stone rose garden arch climbed by roses at the front edge framing the view.
MEASURED INPUTS. Footprint census (r 11 m) and the district census of 2026-09-13 for the landmark bearings.
"""
from pathlib import Path

import arrival_court
import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "FO01"
AX, AY, YAW, LAWN = 20506.0, -21506.0, 110.0, -14.0
COURT_TOP = 0.0


def build():
    return arrival_court.build(PASS, AX, AY, YAW, LAWN, COURT_TOP, 20261122,
                               title="Far Orchards: an arrival court framed by a rose arch")


if __name__ == "__main__":
    layer = build()
    K.write(HERE / "fo01_far_orchards.json", layer)
    print("%s: %d actors, %d batches, %d instances" % (PASS, len(layer["actors"]), len(layer["batches"]),
                                                     sum(len(b["instances"]) for b in layer["batches"])))
