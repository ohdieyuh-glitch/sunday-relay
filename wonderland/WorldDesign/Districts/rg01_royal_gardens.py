#!/usr/bin/env python3
"""RG01 -- Royal Gardens: an arrival court facing the garden walk.

THE GAP (withheld 2026-09-15, PRIVATE_BETA_GATE item 11; captures rg0). The map landed a visitor at (3676, 11242) on a
kerb beside a raised garden path, turned yaw -116 -- straight at a castle tower wall six metres away, in its shadow,
on bare lawn. The district's good view is along the path the other way (yaw about -40): a garden walk under trees to a
mushroom kiosk, lantern strings and balustrades.

WHAT THIS PASS DOES.
  TURN  the arrival to yaw -40 (the anchor actor's yaw and the registry's ArrivalYawDeg), so the visitor faces the walk.
  LAYER a round ARRIVAL COURT about the visitor's feet (r 4.7 m) in the Golden Arrival's language: plaza slabs in
        courses, a gold-and-rose medallion at the heart, a low kerb rim with a gold line, lamps either side, beds of
        forge flower runs round the rim (open ahead and behind, where the path runs), and a stone rose garden arch
        climbed by roses at the court's front edge framing the walk (rose_arch.py, the Heart Garden's arch).
        The court's top sits flush with the path (z 19.5) so its slabs cover the path where it crosses; a kerb step ring
        splits the rise from the lawn into 17 and 16.5 cm.
MEASURED INPUTS. Anchor census 493 (3676, 11242, 19); district census 495 (r 26 m): nothing solid inside r 5.5 m; a tree
canopy at 5.5 m ahead (underside 8.6 m, clears the arch), its trunk at 9.6 m; an urn on a pedestal at 6.8 m ahead-left.
Top-down rg0: the path runs through the anchor at about yaw -45.
"""
from pathlib import Path

import courtkit as K
import arrival_court

HERE = Path(__file__).resolve().parent
PASS = "RG01"
AX, AY, YAW, LAWN = 3676.0, 11242.0, -40.0, -14.0
COURT_TOP = 19.5                         # flush over the raised garden path (19); rg01a at 3.5 left the path on top like a plank


def build():
    return arrival_court.build(PASS, AX, AY, YAW, LAWN, COURT_TOP, 20260915 + 201,
                               title="Royal Gardens: an arrival court facing the garden walk, framed by a rose arch")


if __name__ == "__main__":
    layer = build()
    K.write(HERE / "rg01_royal_gardens.json", layer)
    print("%s: %d actors, %d batches, %d instances" % (PASS, len(layer["actors"]), len(layer["batches"]),
                                                     sum(len(b["instances"]) for b in layer["batches"])))
