#!/usr/bin/env python3
"""EQ01 -- The East Quarter: an arrival court at the street corner.

THE GAP (withheld 2026-09-15, PRIVATE_BETA_GATE item 11; captures d3). The map lands a visitor at (19400, 2000) on the
quarter's cobbled street (top 12) facing yaw -173.7 down the street between tall houses with gold balconies: a real
street, but the arrival itself is unmarked cobbles with a lamp and two topiaries.

WHAT THIS PASS DOES. The arrival keeps its yaw and gets the arrival_court.py court flush with the cobbles (top 12.5),
its step ring meeting the street's lower kerb line (-21): slabs in courses, a warm edge band, a gold rim line, a
gold-and-rose medallion, a lamp pair, beds of forge flower runs round the rim (open along the street both ways), and a
stone rose garden arch climbed by roses at the front edge, framing the street on.
MEASURED INPUTS. Footprint census 523 (r 12 m): cobble terrace platforms top 12, street kerbs -21, a waymarker lamp at
4 m behind-left, a cone topiary at 4.5 m behind-right; nothing standing in the court's own circle.
"""
from pathlib import Path

import arrival_court
import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "EQ01"
AX, AY, YAW, LAWN = 19400.0, 2000.0, -173.7, -21.0
COURT_TOP = 12.5


def build():
    # the walk on (EQ02) leaves the court at -65 degrees, where the district has room: its beds open there too
    return arrival_court.build(PASS, AX, AY, YAW, LAWN, COURT_TOP, 20260915 + 204, court_r=430.0, openings=((0.0, 35.0), (180.0, 35.0), (-65.0, 30.0)),
                               title="The East Quarter: an arrival court on the cobbled street, framed by a rose arch")


if __name__ == "__main__":
    layer = build()
    K.write(HERE / "eq01_east_quarter.json", layer)
    print("%s: %d actors, %d batches, %d instances" % (PASS, len(layer["actors"]), len(layer["batches"]),
                                                     sum(len(b["instances"]) for b in layer["batches"])))
