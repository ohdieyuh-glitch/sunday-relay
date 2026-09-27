#!/usr/bin/env python3
"""FLOATING OBJECTS AND BURIED GEOMETRY, found on disk across the whole world at once.

The founder's world-defect list names both: "floating objects" and "buried geometry". Nothing has ever
audited for them. An in-editor pass could only look where a camera is pointed; the specs hold every placement
in Wonderland, so this reads all of them and reports the ones whose height does not agree with the ground
they stand on.

THE GROUND MODEL, AND ITS HONEST LIMIT. This world's floor is a small number of flat shelves, and four
readings taken in PIE with a downward trace on the pawn channel say where they are:

    120 m -> z =  21        880 m  -> z = -14
    520 m -> z =  12        1,050 m -> z = -14
                            1,180 m -> z = -14

So: a raised inner plaza, a +12 shelf across the marches, and the frontier at -14. That is a THREE-STEP
model of a world that certainly has more steps than three, and it is why this tool reports RANKED CANDIDATES
and a per-pass summary rather than a defect list. A candidate is a thing to look at, and the number beside it
is how far it is from where the model expects the ground; anything within a step height is not reported at
all. Where a pass appears wholesale, suspect the model before the pass -- that pass probably sits on a
terrace this model does not know about.

WHAT IS DELIBERATELY IN THE AIR. Wonderland has a cloud deck at 3.4 km, sky islands, sky bridges at 21-30 m,
hanging lanterns, banners, and flower runs that sit on top of planter walls. Every one of those is ABOVE the
ground on purpose. They are excluded by name, and the exclusion list is printed with the report so it can be
argued with instead of being invisible.

WHAT THIS TOOL IS NOT YET, STATED SO ITS OUTPUT IS NOT OVERSOLD. The FLOATING column is a lead, not a gate.
It currently reports ~2,000 candidates and they are concentrated in the four nation DETAIL passes -- TQ04,
NC04, NC02, IC04 -- which mount cornices, plinth courses and trim on WALL FACES. A wall face is exactly the
case a footprint-overlap test handles worst: the trim's own XY sits outside the wall module's footprint by
design, and its z is the wall's real height rather than the height of whatever this tool managed to find
beneath it. Raising the search margin to 200 cm took the count from 4,783 to 2,061 and the rest need the
nations' recorded building footprints, which carry the wall heights the trim was aimed at. Until then: do not
quote a floating count as a defect count.

THE BURIED COLUMN IS WORTH ACTING ON, and it has already paid for the tool twice:
  * 10 of BC01's 4,132 base-course blocks were a kilometre underground, because "is this building on the
    ground" was asked only from above. Fixed in core_base_course.py; BC01 is now 4,122 blocks, all at z = 0.
  * the remaining 84 are EQ01 kerb stones at r = 199.5 m reading 32.7 cm under a shelf this tool puts at
    z = 21 for r < 200 m. That is one metre inside a boundary the model invented, so it is a question about
    the model, and the honest answer is that the inner plaza's edge has not been traced.

    python Tools/audit_float_bury.py            # ranked candidates and a per-pass summary
    python Tools/audit_float_bury.py --all      # every candidate, not just the worst
"""
import argparse
import collections
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WD = ROOT / "WorldDesign"
KIT = json.loads((WD / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
INVENTORY = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/mesh_inventory.json")
SKIP_FILES = ("nations.json", "mesh_bounds.json", "kit_modules.json")

#: The measured shelves: (radius_cm_below_which, floor_z).
SHELVES = ((20000.0, 21.0), (85000.0, 12.0), (float("inf"), -14.0))
#: A step the Dog climbs. Nothing inside this is a defect.
STEP = 30.0
#: Report a float only past this, so kerbs, copings and the paving's own 6 cm proud sit are not defects.
FLOAT_MIN = 120.0
#: SINKING IS HOW THIS WORLD DELETES A GENERATOR INSTANCE, NOT A DEFECT. `courtkit.trim_spec` and three
#: other generators move an instance down by SINK_UU = 100,000 uu and record its exact original transform,
#: because a layer pass may not remove generator actors. So anything down there is content the world has
#: decided is not present, and reporting it as "buried geometry" is reporting a working feature.
#: The first run of this tool called seven of them buried and was right about only one thing: BC01 had laid
#: a base course around two of them, a kilometre underground, because its ground test was one-sided.
SINK_UU = 100000.0
SUNK_BELOW = -1000.0
#: A facade detail mounts on a wall FACE, so its footprint can sit just outside the wall's own. Without this
#: margin the tool called 4,783 pieces of nation trim "floating" -- cornices and plinth courses correctly
#: attached to buildings -- which is a report nobody can act on.
SUPPORT_MARGIN = 200.0
#: Things that belong in the air, by the pass that places them or the mesh family that is airborne.
AIRBORNE_PASSES = ("SKY01", "SKY02", "SKY03", "SKY04", "SKY05", "CL01", "XM01", "XM02")
AIRBORNE_MESH = ("cloud", "Sky_Island", "Bridge_Sky", "Bridge_Flying", "Lantern_Hanging", "Banner_Blade",
                 "canopy", "Detail_Balcony_Bracket", "Detail_Oriel_Bay", "Roof_Dormer", "Roof_Chimney",
                 "Market_Hanging_Sign", "Market_Awning", "Market_Canopy", "Detail_Wall_Lantern",
                 "Flower_", "Detail_Pinnacle", "Tower_Crown", "Tower_Mid", "Spire_")


def shelf(x, y):
    r = math.hypot(x, y)
    for limit, z in SHELVES:
        if r < limit:
            return z
    return SHELVES[-1][1]


def sizes():
    out = {}
    if INVENTORY.exists():
        for rec in json.loads(INVENTORY.read_text(encoding="utf-8")):
            out[rec["name"]] = rec["size_cm"]
    for mod in KIT.values():
        for part in mod["parts"]:
            out.setdefault(part["mesh"].split("/")[-1].split(".")[0], mod["size"])
    return out


def airborne(pass_id, mesh):
    if pass_id in AIRBORNE_PASSES:
        return True
    return any(tag.lower() in mesh.lower() for tag in AIRBORNE_MESH)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    size = sizes()

    # Everything that COLLIDES and has real height is a thing another object may legitimately stand on.
    supports = []
    placements = []
    unknown = collections.Counter()
    for path in sorted(WD.rglob("*.json")):
        if path.name in SKIP_FILES:
            continue
        try:
            spec = json.loads(path.read_text(encoding="utf-8"))
        except Exception:                                                     # noqa: BLE001
            continue
        if not isinstance(spec, dict) or "batches" not in spec:
            continue
        pid = spec.get("pass", path.stem)
        for b in spec["batches"]:
            mesh = (b.get("mesh") or "").split("/")[-1].split(".")[0]
            sz = size.get(mesh)
            if sz is None:
                unknown[mesh] += len(b.get("instances") or [])
                continue
            for inst in b.get("instances") or []:
                if len(inst) < 7:
                    continue
                x, y, z, s = float(inst[0]), float(inst[1]), float(inst[2]), float(inst[6])
                top = z + float(sz[2]) * s
                placements.append((x, y, z, top, pid, mesh, path.name))
                # ANY tall geometry is something a detail may be mounted on, colliding or not: a facade
                # panel does not need collision to be the wall a cornice hangs off.
                if float(sz[2]) * s >= 40.0 and z > SUNK_BELOW:
                    supports.append((x, y, top,
                                     0.5 * math.hypot(float(sz[0]), float(sz[1])) * s + SUPPORT_MARGIN))

    # Index the supports on a coarse grid so this is not 125k x 11k.
    GRID = 1000.0
    bins = collections.defaultdict(list)
    for sx, sy, stop, sr in supports:
        for gx in range(int((sx - sr) // GRID), int((sx + sr) // GRID) + 1):
            for gy in range(int((sy - sr) // GRID), int((sy + sr) // GRID) + 1):
                bins[(gx, gy)].append((sx, sy, stop, sr))

    def support_z(x, y, below):
        """The highest colliding surface under (x, y) that is at or below `below`, else the shelf."""
        best = shelf(x, y)
        for cand in bins.get((int(x // GRID), int(y // GRID)), ()):
            sx, sy, stop, sr = cand
            if stop <= below + 1.0 and (x - sx) ** 2 + (y - sy) ** 2 <= sr * sr and stop > best:
                best = stop
        return best

    floats, buried, sunk = [], [], []
    for x, y, z, top, pid, mesh, spec_name in placements:
        g = shelf(x, y)
        if z <= SUNK_BELOW:
            sunk.append((round(-z, 1), pid, mesh, round(x), round(y), round(z), round(top), spec_name))
            continue
        if top < g - STEP:
            buried.append((round(g - top, 1), pid, mesh, round(x), round(y), round(z), round(top), spec_name))
            continue
        if airborne(pid, mesh):
            continue
        base = support_z(x, y, z)
        gap = z - base
        if gap > FLOAT_MIN:
            floats.append((round(gap, 1), pid, mesh, round(x), round(y), round(z), round(base), spec_name))

    floats.sort(reverse=True)
    buried.sort(reverse=True)
    print("placements read: %d      supports indexed: %d" % (len(placements), len(supports)))
    if unknown:
        print("%d mesh names had no size on record and were skipped: %s"
              % (len(unknown), ", ".join(sorted(unknown)[:8])))
    print("ground model: %s   step %.0f cm   float threshold %.0f cm"
          % (" / ".join("r<%.0fm -> %.0f" % (l / 100 if l != float('inf') else 9999, z) for l, z in SHELVES),
             STEP, FLOAT_MIN))
    print()

    sunk.sort(reverse=True)
    for title, rows, unit in (
            ("FLOATING -- placed above any surface beneath it", floats, "gap"),
            ("BURIED -- its whole height is under the ground shelf, and it is NOT a sink", buried, "depth"),
            ("SUNK (informational, not a defect) -- removed by a trim pass, see SINK_UU", sunk, "down")):
        print("=" * 96)
        print("%s: %d candidates" % (title, len(rows)))
        if rows:
            by_pass = collections.Counter(r[1] for r in rows)
            print("  by pass: %s" % ", ".join("%s:%d" % kv for kv in by_pass.most_common(10)))
            print("  %9s %-9s %-30s %9s %9s %8s %8s" % (unit, "pass", "mesh", "x", "y", "z", "base"))
            for r in (rows if args.all else rows[:16]):
                print("  %9.1f %-9s %-30s %9d %9d %8d %8d" % (r[0], r[1], r[2][:30], r[3], r[4], r[5], r[6]))
            if not args.all and len(rows) > 16:
                print("  ... %d more (--all)" % (len(rows) - 16))
        print()

    print("EXCLUDED AS DELIBERATELY AIRBORNE: passes %s; meshes matching %s"
          % (", ".join(AIRBORNE_PASSES), ", ".join(AIRBORNE_MESH[:10]) + ", ..."))
    print()
    print("A 'buried' row is a real question; a 'sunk' row is the trim mechanism working.")
    print("READ A WHOLE PASS APPEARING HERE AS A QUESTION ABOUT THE GROUND MODEL, NOT AS 900 DEFECTS.")
    print("The model knows three shelves. A pass built on a terrace it does not know about will appear")
    print("entire, at a constant offset -- and a constant offset is the signature of a missing shelf.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
