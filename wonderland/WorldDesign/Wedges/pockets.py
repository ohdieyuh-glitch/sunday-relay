#!/usr/bin/env python3
"""P165N / P015T -- the two nation pockets beside the ICARUS seams: a NOCTIS quarter at 165 deg and a TARTARUS
quarter at 15 deg, each in the empty annulus between the V2 world's inner green ring and its hedge ring.

WHY HERE. Core's matrix assigns the 150 and 30 deg seams (rows R41, R42) to the World lane. The census puts the
emptiness of both on the side AWAY from Icarus -- Icarus grows out of the pale core and is already built --
and no seam way can run on either line: seam_probe.py finds the lines lined with SKY05 "distant metropolis"
towers (the 30 deg line has no clear 57.6 x 59 m site at all). Emptiness by 30 deg x 100 m cell:
    150-180 deg (Noctis):   600-700 m 88%, 700-800 m 79%, 800-900 m 65%
      0- 30 deg (Tartarus): 600-700 m 81%, 700-800 m 65%
So each pocket is a quarter of ITS nation on its own spine lane, not a seam way.

WHERE THE GROUND IS CLEAR, measured with seam_probe.py (canopies not solid, oriented rectangles):
    165 deg: hedge masses to 618 m (the inner green ring), the hedge ring from 886 m; plazas clear 700-850 m.
    15 deg:  hedges 542-595 m, a castle compound at 702-715 m, the hedge ring from 852 m; plazas clear
             630-660 m and 750-800 m.
The V2 world is concentric -- core, inner green ring (~480-610 m), an empty annulus, the hedge ring
(~850-1,050 m), a second empty annulus, the wilderness -- and these pockets sit in the first annulus.

THE SAME MACHINERY AS W270, re-pointed. w270_rear_seam.py's Occupancy / Pass / build_flank are reused by
setting its frame (BEARING, DIR, LEFT) and layout globals per pocket, so a court, a street, a garden room and
a grove mean the same thing here as on the rear seam, every footprint is cleared against the census, every
batch is tiled to a 200 m cell, and each nation builds from its own nation_band vocabulary.

    python pockets.py      (writes p165n_noctis_pocket.json, p015t_tartarus_pocket.json, a plan and new rows)
"""
import gzip
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import w270_rear_seam as W                                        # noqa: E402

POCKETS = {
    # pass, bearing, nation cfg, spine u range (cm), courts (u, inner edge), street range, half-angle (deg)
    "P165N": dict(bearing=165.0, cfg="NC03", u=(62400.0, 87000.0), courts=((73000.0, 720.0), (82000.0, 720.0)),
                  street=(64800.0, 70000.0), half=13.0, gve_from=9,
                  out="p165n_noctis_pocket.json"),
    "P015T": dict(bearing=15.0, cfg="TQ03", u=(60800.0, 84800.0), courts=((64500.0, 720.0), (77500.0, 720.0)),
                  street=(68200.0, 73600.0), half=13.0, gve_from=8,
                  out="p015t_tartarus_pocket.json"),
}


def set_frame(bearing, half_deg):
    W.BEARING = bearing
    r = math.radians(bearing)
    W.DIR = (math.cos(r), math.sin(r))
    W.LEFT = (-math.sin(r), math.cos(r))
    W.SEAM_HALF_DEG = half_deg


def build_pocket(occ, pid, P):
    set_frame(P["bearing"], P["half"])
    cfg = W.NB.NATIONS[P["cfg"]]
    # the flank builder's layout globals, for this pocket: courts open off a ONE-column spine lane (14.4 m),
    # the rings Core runs through these sectors are at 560 m and 1,000 m (their corridors kept clear)
    W.COURTS = P["courts"]
    W.STREET = P["street"]
    W.NODES = {"MARCH": 56000.0, "CLOCK": -1e9, "EXCHANGE": 100000.0}
    W.WAY_HALF = 720.0
    canon = {n["id"]: n.get("gve_spaces", []) for n in W.NB.CANON["nations"]}
    gve = canon[cfg["nation"]][P["gve_from"]:]
    halves = []
    for side in (-1.0, 1.0):
        halves.append(W.build_flank(occ, pid + ("W" if side < 0 else "E"), P["cfg"], side, gve[:1] if side < 0
                                    else gve[1:2]))
    # the spine lane itself, in the nation's own paving, laid LAST so it is tested against what the halves
    # placed only through the 'existing' layer (the census) -- the halves' courts meet it edge to edge
    spine = W.Pass(pid, ["WL_POCKET", "WL_NATION_" + cfg["nation"]], "Wonderland/Authored/%s_%sPocket"
                   % (pid, cfg["nation"].title()), dict(cfg["materials"]), occ, pid)
    u = P["u"][0]
    while u < P["u"][1]:
        spine.plate(u + W.PLATE["len_y"] * 0.5, 0.0, cfg["materials"]["paving_warm"], "Spine", layer="way")
        u += W.PLATE["len_y"]
    # merge the two halves and the spine into one pass (one tag, one removal)
    merged = W.Pass(pid, ["WL_POCKET", "WL_NATION_" + cfg["nation"], "WL_DISTRICT_%s_POCKET" % cfg["nation"]],
                    "Wonderland/Authored/%s_%sPocket" % (pid, cfg["nation"].title()), dict(cfg["materials"]), occ,
                    pid)
    for part in halves + [spine]:
        for k, b in part.batches.items():
            key = "%s_%s" % (part.id, k)
            b2 = dict(b)
            b2["id"] = "%s_%s" % (pid, key)
            merged.batches[key] = b2
        merged.actors += part.actors
        merged.footprints += part.footprints
        merged.new_rows += [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], pid) for r in part.new_rows]
        merged.stats.update(part.stats)
        merged.skipped.update(part.skipped)
        merged.skip_at += part.skip_at
    return merged


def main():
    rows = []
    n = 0
    for pid, P in POCKETS.items():
        # EACH POCKET LOADS ITS OWN SECTOR: the census is filtered by the current frame, so the frame is set
        # first (loading once, before any frame was set, loaded the rear seam's wedge for both pockets)
        set_frame(P["bearing"], P["half"])
        occ = W.Occupancy()
        n += W.load_census(occ)
        p = build_pocket(occ, pid, P)
        spec = p.spec()
        (HERE / P["out"]).write_text(json.dumps(spec, indent=1), encoding="utf-8")
        total = sum(len(b["instances"]) for b in spec["batches"])
        widest = max((max(r[0] for r in b["instances"]) - min(r[0] for r in b["instances"]),
                      max(r[1] for r in b["instances"]) - min(r[1] for r in b["instances"]))
                     for b in spec["batches"])
        print("%s -> %s  bearing %.0f  batches %d  instances %d  actors %d  widest batch %.0f m"
              % (pid, P["out"], P["bearing"], len(spec["batches"]), total, len(spec["actors"]), max(widest) / 100))
        print("   placed:  " + ", ".join("%s %d" % kv for kv in p.stats.most_common(10)))
        if p.skipped:
            print("   SKIPPED: " + ", ".join("%s %d" % kv for kv in p.skipped.most_common(8)))
        x, y = W.world(76000.0, 0.0)
        print("   centre lands in", W.nations.zone_at(x, y))
        rows += p.new_rows
    with gzip.open(HERE / "pockets_new_placements.csv.gz", "wt", encoding="utf-8", newline="") as f:
        f.write("kind,x,y,z,ex,ey,ez,yaw,mesh,owner\n")
        for (k, x, y, z, ex, ey, ez, mesh, owner) in rows:
            f.write("%s,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,0,%s,%s\n" % (k, x, y, z, ex, ey, ez, mesh, owner))
    print("census rows considered: %d; new footprint rows: %d" % (n, len(rows)))


if __name__ == "__main__":
    main()
