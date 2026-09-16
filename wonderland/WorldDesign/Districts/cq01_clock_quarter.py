#!/usr/bin/env python3
"""CQ01 -- Clock Quarter: an arrival court on the cobbles between the columns.

THE GAP (withheld 2026-09-15, PRIVATE_BETA_GATE item 11; captures cq0, beta_tour 2026-09-13 "at Clock Quarter the
camera clips into a column"). The map lands a visitor at (13162, 1870) on a cobbled street turned yaw -175, with two
7.7 m ornate columns 3.7 m away either side -- close enough for the follow camera to sit inside one -- and nothing
authored ahead: cobbles, then lawn, then the quarter's bell garden.

WHAT THIS PASS DOES. The arrival keeps its yaw: the columns flank the visitor as gateposts and the view west is the
bell garden. The court stands 4 m AHEAD of the anchor, so the columns are outside it (504 cm from its centre against a
472 cm reach) and the camera has room behind. It is the arrival_court.py court: plaza slabs flush with the cobbles
(top 12.5), a warm edge band, a gold rim line, a gold-and-rose medallion, a lamp pair, beds of forge flower runs round
the rim (open ahead and behind, along the street), and a stone rose garden arch climbed by roses at the front edge,
framing the walk on to the bell garden.
MEASURED INPUTS. Footprint census 511 (r 12 m): columns at bearings -98.3 and +98.5, 367-375 cm; garden walls at 6.4
and 8.2 m; cobble terrace platforms top 12, lawn -2; nothing else inside the court.
"""
from pathlib import Path

import arrival_court
import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "CQ01"
AX, AY, YAW, LAWN = 13162.0, 1870.0, -175.0, -2.0
COURT_TOP = 12.5                            # flush with the cobbled terrace platforms (top 12)
COURT_D, COURT_R = 400.0, 400.0


def build():
    # the walk on (CQ02) leaves the court at +15 degrees, where the district has room: its beds open there too
    return arrival_court.build(PASS, AX, AY, YAW, LAWN, COURT_TOP, 20260915 + 202, court_d=COURT_D, court_r=COURT_R, openings=((0.0, 35.0), (180.0, 35.0), (15.0, 30.0)),
                               title="Clock Quarter: an arrival court on the cobbles, the columns its gateposts")


if __name__ == "__main__":
    layer = build()
    K.write(HERE / "cq01_clock_quarter.json", layer)
    print("%s: %d actors, %d batches, %d instances" % (PASS, len(layer["actors"]), len(layer["batches"]),
                                                     sum(len(b["instances"]) for b in layer["batches"])))
