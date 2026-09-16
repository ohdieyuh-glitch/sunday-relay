"""Something to walk TO: a landmark where a district's walk ends (2026-09-16).

THE GAP (PRIVATE_BETA_GATE items 8 and 12, named by DW01 itself). Every offered district now arrives on a court and
walks on to an overlook -- and eight of the twelve overlooks look at open generator ground. The walk arrives
somewhere and then stops again. Item 8 records the same want from the other side: "giant topiary figures,
teapot/key object language at landmark scale in the districts".

WHAT A LANDMARK IS. A forge structure standing beyond the overlook, on its own paved apron:
  APRON    a disc of plaza slabs laid on the measured local ground, with a warm kerb and a gold rim line, so the
           building stands on something rather than on grass;
  APPROACH a lamp pair on the overlook side, flanking the way in;
  BEDS     flower runs round the apron's far arc, so it is planted rather than parked;
  THE PIECE itself, turned to FACE the visitor walking out from the overlook.

WHERE IT CAN STAND, measured not guessed. probe_site_clear.py tested a 15 x 15 x 20 m box at five distances beyond
every overlook (2026-09-16). Seven districts have a clear site; five -- Royal Gardens, Clock Quarter, The Cloister,
The East Quarter, Lantern Hamlets -- are packed solid with city at every distance, and those get nothing, because
their overlooks already face built content. A landmark is only laid where the ground was proven empty.
"""
import json
import math
from pathlib import Path

import courtkit as K

HERE = Path(__file__).resolve().parent
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
RUNS = {"daisy": "WL_Flower_Daisy_Run", "lavender": "WL_Flower_Lavender_Run", "rose": "WL_Flower_Rose_Run"}
BED_KINDS = (("rose", "MI_V2_RosePink"), ("lavender", "MI_V2_PetalViolet"), ("daisy", "MI_V2_PetalWhite"))
APRON_R = 560.0


def build(pass_id, ax, ay, yaw, ground, seed, site_d, module, scale, title, yaw_local=180.0, copies=(),
          apron_r=APRON_R):
    """A landmark `site_d` uu ahead of the anchor along `yaw`, on ground measured at `ground`."""
    top = ground + 14.0                       # the courts' convention over grass: the slab sits ON it
    floor = top - 13.5
    c = K.Court(pass_id, ax, ay, yaw, floor, seed)

    c.pave_disc("LandmarkApron", site_d, 0.0, -64.0, apron_r, floor)
    c.ring("LandmarkKerb", "MI_V2_PlazaWarm", site_d, 0.0, apron_r + 8.0, 56.0, ground - 1.0,
           max(6.0, top + 0.6 - (ground - 1.0)))
    c.ring("LandmarkRim", "MI_V2_Gold", site_d, 0.0, apron_r - 22.0, 10.0, top + 0.4, 1.4)
    c.medallion(site_d, 0.0, apron_r * 0.34, top + 0.4)

    # THE PIECE, turned to face the way the visitor comes. `copies` lays the same module more than once --
    # a market is several canopies, a single one is a stall.
    places = copies if copies else ((0.0, 0.0, scale, yaw_local),)
    for n, (dd, lat, sc, yl) in enumerate(places):
        for part in KIT[module]["parts"]:
            key = "%s_%s_%d" % (module, part["part"], n)
            c.mesh[key] = part["mesh"]
            c.actor("Landmark%d_%s" % (n, part["part"]), key, site_d + dd, lat, top, [part["material"]], sc,
                    yaw_local=yl, collision="block" if part["part"] in ("stone", "stone_dark") else "none")

    # the approach, on the overlook side
    c.lamp_pair("LandmarkApproach", site_d - apron_r + 90.0, apron_r * 0.62, top)

    # beds round the far arc, so the back of the apron is planted rather than bare
    k = 0
    for ang in range(-120, 121, 40):
        th = math.radians(ang)
        d = site_d + math.cos(th) * (apron_r + 120.0)
        lat = math.sin(th) * (apron_r + 120.0)
        kind, petal = BED_KINDS[k % len(BED_KINDS)]
        k += 1
        x, y = c.at(d, lat)
        for part in KIT[RUNS[kind]]["parts"]:
            material = petal if part["part"] == "petal" else ("MI_V2_LeafDark" if part["part"] == "leaf" and k % 2 else part["material"])
            key = "%s_Bed_%s_%s" % (pass_id, part["part"], material.replace("MI_V2_", ""))
            b = c.batches.setdefault(key, {"id": key, "mesh": part["mesh"], "material": material, "instances": [],
                                           "collides": False, "cast_shadow": True, "affect_df": False})
            b["instances"].append([round(x, 1), round(y, 1), top, 0.0, round((yaw + 90.0) % 360.0, 1), 0.0, 1.0, 1.0, 1.0])

    layer = c.layer(title)
    layer["landmark"] = {"module": module, "scale": scale, "site_d": site_d,
                         "at": [round(v, 1) for v in c.at(site_d, 0.0)], "ground": ground}
    return layer
