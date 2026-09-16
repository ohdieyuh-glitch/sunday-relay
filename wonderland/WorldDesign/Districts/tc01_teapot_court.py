#!/usr/bin/env python3
"""TC01 -- Teapot Court: an arrival court.

THE GAP (withheld 2026-09-15, PRIVATE_BETA_GATE item 11; captures d5). The map landed a visitor at (-11081, -7144) on open ground under the quarter's lantern swags, with a waymarker 3 m off,
with nothing authored to arrive on.

WHAT THIS PASS DOES.
  KEEP  the arrival yaw -156.0: it already faces the giant teapot 33 m down the lawn (LMTeaTerraces_Teapot, bearing -156) that it already faced.
  COURT the arrival_court.py court, top z 0.0, radius 4.7 m: plaza slabs in courses, a warm edge band, a gold rim
        line, a gold-and-rose medallion, a lamp pair, beds of forge flower runs round the rim (open ahead and behind),
        and a stone rose garden arch climbed by roses at the front edge framing the view.
MEASURED INPUTS. Footprint census (r 11 m) and the district census of 2026-09-13 for the landmark bearings.
"""
from pathlib import Path

import arrival_court
import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "TC01"
AX, AY, YAW, LAWN = -11081.0, -7144.0, -156.0, -14.0
COURT_TOP, COURT_R = 0.0, 470.0


def build():
    # the walk on (TC02) leaves the court at -35 degrees, where the district has room: its beds open there too
    return arrival_court.build(PASS, AX, AY, YAW, LAWN, COURT_TOP, 20261124, court_r=COURT_R, openings=((0.0, 35.0), (180.0, 35.0), (-35.0, 30.0)),
                               title="Teapot Court: an arrival court framed by a rose arch")


if __name__ == "__main__":
    layer = build()
    K.write(HERE / "tc01_teapot_court.json", layer)
    print("%s: %d actors, %d batches, %d instances" % (PASS, len(layer["actors"]), len(layer["batches"]),
                                                     sum(len(b["instances"]) for b in layer["batches"])))
