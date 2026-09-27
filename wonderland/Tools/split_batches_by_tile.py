#!/usr/bin/env python3
"""Split a world-spanning instance batch into per-tile batches, losslessly, so the world can page.

THE PROBLEM, IN THE LEDGER'S WORDS. "World Partition pages by ACTOR, using that actor's bounds, and this
world is instanced rather than actor-based -- so an actor whose instanced component spans half a kilometre
sits inside every cell it touches and can never leave residency." The named remedy is to split those
batches by tile at build time, in the world builders, rather than to edit the map by hand.

AND THE LEDGER'S FRAMING OF IT IS TOO BROAD, WHICH THIS MEASURED BEFORE IT CHANGED ANYTHING. Counted over
the 286 specs on disk at a 200 m cell: 362 batches span more than one cell and hold 41,856 instances. But
span is not cost. A batch of four distant towers spanning 2 km costs four instances of residency, and
splitting it buys nothing while cutting the horizon into cells that unload independently -- the skyline
would develop holes as the player moves. Ranked by the residency a split actually returns (instances that
leave memory when the viewer stands in the batch's own busiest tile and its eight neighbours):

    total returnable                  6,265 instances -- 4.9% of the world, not 44.5%
    BC01_BaseCourse, ONE batch        2,450   39% of the whole prize
    DF01, thirteen batches            1,777   28%    -- Dubel Forest's trunks, canopy and undergrowth
    SKY05, eighty-nine batches          519    8%    -- and this is the horizon; leave it whole
    226 of the 362 batches             <=60 instances each, 2.5% of the world between them

So the fix is two passes, not three hundred and sixty-two. That is what this tool is for, and why it takes
an explicit list of passes rather than splitting everything it can.

LOSSLESS, AND CHECKED RATHER THAN CLAIMED. Every instance row is carried across byte-identical and the
multiset of rows is compared before and after; a batch's mesh, material, collides, cast_shadow, affect_df
and cull_distance are copied to each tile. The tool refuses to write if anything differs.

    python Tools/split_batches_by_tile.py --report                 # the trade, at four grid sizes
    python Tools/split_batches_by_tile.py --apply BC01 DF01        # rewrite those passes' specs
    python Tools/split_batches_by_tile.py --revert BC01 DF01       # rejoin them
"""
import argparse
import collections
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WD = ROOT / "WorldDesign"
CELL = 20000.0                      # the runtime cell this world is measured against, 200 m
SKIP = ("nations.json", "mesh_bounds.json", "kit_modules.json")
#: The marker that says a batch id was made by this tool, so --revert can find and rejoin them.
MARK = "__t"


def specs():
    for path in sorted(WD.rglob("*.json")):
        if path.name in SKIP:
            continue
        try:
            spec = json.loads(path.read_text(encoding="utf-8"))
        except Exception:                                                      # noqa: BLE001
            continue
        if isinstance(spec, dict) and "batches" in spec and spec.get("pass"):
            yield path, spec


def span_of(instances):
    xs = [i[0] for i in instances]
    ys = [i[1] for i in instances]
    return max(max(xs) - min(xs), max(ys) - min(ys))


def freed_by(instances, grid):
    """Instances that leave residency when the viewer stands in the busiest tile and its 8 neighbours."""
    tiles = collections.Counter((int(math.floor(i[0] / grid)), int(math.floor(i[1] / grid)))
                                for i in instances)
    (bx, by), _ = tiles.most_common(1)[0]
    near = sum(n for (tx, ty), n in tiles.items() if abs(tx - bx) <= 1 and abs(ty - by) <= 1)
    return len(instances) - near, len(tiles)


def report():
    per_pass = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0, 0]))
    total = 0
    for _, spec in specs():
        pid = spec["pass"]
        for b in spec["batches"]:
            inst = b.get("instances") or []
            if not inst:
                continue
            total += len(inst)
            if span_of(inst) <= CELL:
                continue
            for grid in (20000.0, 30000.0, 40000.0, 60000.0):
                freed, tiles = freed_by(inst, grid)
                row = per_pass[pid][grid]
                row[0] += freed                 # instances returned
                row[1] += tiles - 1             # extra batches created
                row[2] += len(inst)
    ranked = sorted(per_pass, key=lambda p: -per_pass[p][20000.0][0])
    print("world instances: %d      cell: %.0f m\n" % (total, CELL / 100))
    print("%-12s %8s | %s" % ("pass", "over-cell", "  ".join("%13s" % ("grid %.0fm" % (g / 100))
                                                             for g in (20000., 30000., 40000., 60000.))))
    print("%-12s %8s | %s" % ("", "instances", "  ".join("%13s" % "freed/+batches" for _ in range(4))))
    for pid in ranked[:12]:
        cells = per_pass[pid]
        line = "  ".join("%8d/+%-4d" % (cells[g][0], cells[g][1]) for g in (20000., 30000., 40000., 60000.))
        print("%-12s %8d | %s" % (pid, cells[20000.0][2], line))
    print()
    print("THE TRADE. Every extra batch is an extra instanced component, so it is an extra draw call or")
    print("more. A coarser grid frees less and costs less. Pick per pass; this tool does not choose.")


def split_spec(spec, grid):
    out, moved, made = [], 0, 0
    for b in spec["batches"]:
        inst = b.get("instances") or []
        if not inst or MARK in b.get("id", "") or span_of(inst) <= CELL:
            out.append(b)
            continue
        tiles = collections.defaultdict(list)
        for row in inst:
            tiles[(int(math.floor(row[0] / grid)), int(math.floor(row[1] / grid)))].append(row)
        for (tx, ty) in sorted(tiles):
            nb = dict(b)
            nb["id"] = "%s%s%d_%d" % (b["id"], MARK, tx, ty)
            nb["instances"] = tiles[(tx, ty)]
            out.append(nb)
        moved += len(inst)
        made += len(tiles)
    return out, moved, made


def rejoin_spec(spec):
    groups, out = collections.OrderedDict(), []
    for b in spec["batches"]:
        if MARK not in b.get("id", ""):
            out.append(b)
            continue
        base = b["id"].split(MARK)[0]
        if base not in groups:
            first = dict(b)
            first["id"] = base
            first["instances"] = []
            groups[base] = first
            out.append(first)
        groups[base]["instances"].extend(b["instances"])
    return out


def fingerprint(batches):
    """Every instance row, keyed by the batch identity that owns it -- the thing a split must preserve."""
    got = collections.Counter()
    for b in batches:
        base = b.get("id", "").split(MARK)[0]
        key = (base, b.get("mesh"), b.get("material"), bool(b.get("collides")),
               bool(b.get("cast_shadow", True)), bool(b.get("affect_df", False)),
               b.get("cull_distance"))
        for row in b.get("instances") or []:
            got[(key, tuple(row))] += 1
    return got


def apply(passes, grid, revert=False):
    touched = 0
    for path, spec in specs():
        if spec["pass"] not in passes:
            continue
        before = fingerprint(spec["batches"])
        n_before = len(spec["batches"])
        if revert:
            new = rejoin_spec(spec)
            moved = made = 0
        else:
            new, moved, made = split_spec(spec, grid)
        after = fingerprint(new)
        if before != after:
            lost = sum((before - after).values())
            gained = sum((after - before).values())
            print("REFUSING to write %s: the rows changed (%d lost, %d appeared). Nothing written."
                  % (path.name, lost, gained))
            return 1
        spec["batches"] = new
        path.write_text(json.dumps(spec, indent=1), encoding="utf-8")
        touched += 1
        print("%-10s %-34s %4d -> %4d batches   %d instances rehoused, rows identical"
              % (spec["pass"], path.name, n_before, len(new), moved if not revert else
                 sum(len(b["instances"]) for b in new)))
    if not touched:
        print("no spec matched %s" % ", ".join(sorted(passes)))
        return 1
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--apply", nargs="+", metavar="PASS")
    ap.add_argument("--revert", nargs="+", metavar="PASS")
    ap.add_argument("--grid", type=float, default=40000.0,
                    help="tile size in cm for the split (default 40000 = 400 m)")
    args = ap.parse_args()
    if args.report or not (args.apply or args.revert):
        report()
        return 0
    return apply(set(args.revert or args.apply), args.grid, revert=bool(args.revert))


if __name__ == "__main__":
    sys.exit(main())
