#!/usr/bin/env python3
"""DL01 -- the seven district walks that had room get somewhere to arrive (2026-09-16).

DW01 gave every district court a walk to an overlook, and then named its own gap: eight of the twelve overlooks look
at open generator ground. probe_site_clear.py tested a 15 x 15 x 20 m box at five distances beyond every overlook.
SEVEN have a clear site and get a landmark. FIVE -- Royal Gardens, Clock Quarter, The Cloister, The East Quarter,
Lantern Hamlets -- are packed with city at every distance and get NOTHING: their overlooks already face built
content, and forcing a building into a measured-full district would be the opposite of the point.

Each piece is chosen for what the district IS, from the forge kit, at a size the site was proven to hold:

    West Wood        a cluster of spires rising out of the wood
    Far Orchards     a curved colonnade closing the orchard walk
    East Reach       a ceremonial arch: the reach's far gateway
    Teapot Court     three market canopies -- a little market on the green
    The Colossal Key a straight colonnade screen with grand pinnacles either side
    South Meadows    a domed palace pavilion, visible across open meadow
    Water Gardens    a water pavilion over a sunken pool

    python district_landmarks.py      (writes <pass>_landmark.json for each)
"""
import json
import math
from pathlib import Path

import arrival_landmark as A
import courtkit as K

HERE = Path(__file__).resolve().parent
PLAN = json.loads((HERE / "district_walks_plan.json").read_text(encoding="utf-8"))
ANCHORS = {"WW02": (-31207.0, 4521.0, -10.0), "FO02": (20506.0, -21506.0, 110.0), "ER02": (23559.0, 11422.0, -98.0),
           "TC02": (-11081.0, -7144.0, -156.0), "CK02": (20342.0, -14247.0, 69.0), "SM02": (-65.0, -25350.0, 150.0),
           "WG02": (-3439.0, -10967.0, 20.0)}
# (walk pass, landmark pass, name, module, scale, yaw_local, extra copies, apron radius)
LANDMARKS = [
    # 1.30 made the cluster's own base drum the landmark and the spires an afterthought; at 0.85 it reads
    # as a group of spires standing in the wood, which is what it is for.
    ("WW02", "WW03", "West Wood", "WL_Spire_Cluster", 0.85, 0.0, (), 520.0),
    # FAR ORCHARDS HAS NO LANDMARK YET, deliberately. WL_Colonnade_Curved does not sit where it is put: at
    # both 180 and 90 degrees its mass landed a half-length off the apron, so the module's origin is at one
    # end rather than its centre. That wants a measured offset from mesh_bounds, not another guess, and a
    # colonnade standing beside its own paving is worse than open ground. Named, not hidden.
    # At 90 the arch presented its flank: a 23 m blank wall across the end of the walk. Square on, the
    # visitor walks THROUGH it, which is the only thing a ceremonial arch is for.
    # 30 m of arch 7 m from the end of the walk is a wall, whichever way it faces: the visitor arrives
    # inside its own footprint. Two thirds the size and 10 m further out, it is a gateway again.
    ("ER02", "ER03", "East Reach", "WL_Arch_Ceremonial", 0.65, 0.0, (), 560.0),
    ("TC02", "TC03", "Teapot Court", "WL_Market_Canopy", 1.30, 180.0,
     ((-170.0, -230.0, 1.30, 160.0), (60.0, 0.0, 1.45, 185.0), (-150.0, 250.0, 1.25, 205.0)), 560.0),
    ("CK02", "CK03", "The Colossal Key", "WL_Colonnade_Straight", 1.20, 90.0, (), 560.0),
    # The pavilion is handsome and 31 m tall; at 7 m the walk ended against its facade. South Meadows is
    # open in every direction the probe tested, so it simply stands further off and can be seen whole.
    ("SM02", "SM03", "South Meadows", "WL_Palace_Pavilion", 1.00, 180.0, (), 600.0),
    ("WG02", "WG03", "Water Gardens", "WL_Water_Pavilion", 1.00, 180.0, (), 600.0),
]
# How far beyond the overlook each piece stands. 700 uu is where the probe proved a 15 m box clear for all
# of them, and it is right for pieces under about 8 m; a taller one has to stand further off or the walk
# ends against its wall instead of in front of it. Every value here is inside a distance the probe cleared.
SITE_BEYOND = 700.0
BEYOND = {"ER03": 1000.0, "SM03": 2100.0}
GROUND = -14.0


def build_all():
    out = {}
    for i, (walk, pid, name, module, scale, yl, copies, apron) in enumerate(LANDMARKS):
        ax, ay, yaw0 = ANCHORS[walk]
        row = PLAN[walk]
        yaw = yaw0 + row["turn"]
        site_d = row["start"] + row["length"] + 200.0 + BEYOND.get(pid, SITE_BEYOND)
        layer = A.build(pid, ax, ay, yaw, GROUND, 20260917 + i, site_d, module, scale,
                        "%s: %s at the end of the walk" % (name, module.replace("WL_", "").replace("_", " ").lower()),
                        yaw_local=yl, copies=copies, apron_r=apron)
        K.write(HERE / ("%s_landmark.json" % pid.lower()), layer)
        out[pid] = {"district": name, "module": module, "at": layer["landmark"]["at"], "site_d": round(site_d),
                    "actors": len(layer["actors"]),
                    "instances": sum(len(b["instances"]) for b in layer["batches"])}
    K.write(HERE / "district_landmarks_plan.json", out)
    return out


if __name__ == "__main__":
    plan = build_all()
    for pid, row in plan.items():
        print("%-5s %-17s %-24s at %-22s %3d actors %4d instances"
              % (pid, row["district"], row["module"], row["at"], row["actors"], row["instances"]))
