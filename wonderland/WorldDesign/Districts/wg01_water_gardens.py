#!/usr/bin/env python3
"""WG01 -- Water Gardens: the arrival moved off the bridge, and a court on the garden lawn.

THE GAP (withheld 2026-09-15, PRIVATE_BETA_GATE item 11; captures d3, footprint census 524). The map landed a visitor
at (-4849, -11480) at z 499 -- standing on the water garden's own bridge arc, with the nearest ground 4 m below and
away. A court cannot be laid on a bridge.

WHAT THIS PASS DOES.
  MOVE  the anchor 15 m along bearing 20 to (-3439, -10967), off the bridge and onto the garden's flat lawn (PIE
        probe 571: V2_GroundSlab at -14 for 5 m all round, terrace edges at 19 to the south), turned to yaw 20:
        open lawn, the garden's canopies and the city, with the water garden and its fountains to the right
        (capture WGc_b20_d1500_l20).
  COURT the arrival_court.py court on it, top z 0.0, as the other districts.
The registry's SeedXY stays where it was: the anchor is the truth about where a visitor stands.
"""
from pathlib import Path

import arrival_court
import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "WG01"
AX, AY, YAW, LAWN = -3439.0, -10967.0, 20.0, -14.0
COURT_TOP = 0.0


def build():
    return arrival_court.build(PASS, AX, AY, YAW, LAWN, COURT_TOP, 20260915 + 212,
                               title="Water Gardens: an arrival court on the garden lawn, framed by a rose arch")


if __name__ == "__main__":
    layer = build()
    K.write(HERE / "wg01_water_gardens.json", layer)
    print("%s: %d actors, %d batches, %d instances" % (PASS, len(layer["actors"]), len(layer["batches"]),
                                                     sum(len(b["instances"]) for b in layer["batches"])))
