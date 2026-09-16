#!/usr/bin/env python3
"""SM01 -- South Meadows: the arrival moved to open meadow, and a court on it.

THE GAP (withheld 2026-09-15, PRIVATE_BETA_GATE item 11; captures d4, smyaw). The map landed a visitor at
(2187, -26650) hemmed in between the quarter's pavilion and its houses: turned any way, the view is the pavilion's
blank base or a building corner, and the first attempt at a court there (SM01a) was withdrawn for exactly that.

WHAT THIS PASS DOES.
  MOVE  the anchor 26 m along bearing 150 to (-65, -25350) -- flat ground (PIE probe 571: V2_GroundSlab at -14 for
        5 m all round, terrace edges at 12-19 to the north-east) -- and turn it to yaw 150: open meadow, the
        quarter's paved apron, its teal and pink palaces, mushroom trees and a balloon (capture SMc_b150_d2600_l150).
  COURT the arrival_court.py court on it, top z 0.0: plaza slabs in courses, a warm edge band, a gold rim line, a
        gold-and-rose medallion, a lamp pair, beds of forge flower runs round the rim, and a stone rose garden arch
        climbed by roses framing the meadow view.
The registry's SeedXY stays where it was: it only says where the anchor was first put, and the anchor is the truth.
"""
from pathlib import Path

import arrival_court
import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "SM01"
AX, AY, YAW, LAWN = -65.0, -25350.0, 150.0, -14.0
COURT_TOP = 0.0


def build():
    return arrival_court.build(PASS, AX, AY, YAW, LAWN, COURT_TOP, 20260915 + 205,
                               title="South Meadows: an arrival court on the open meadow, framed by a rose arch")


if __name__ == "__main__":
    layer = build()
    K.write(HERE / "sm01_south_meadows.json", layer)
    print("%s: %d actors, %d batches, %d instances" % (PASS, len(layer["actors"]), len(layer["batches"]),
                                                     sum(len(b["instances"]) for b in layer["batches"])))
