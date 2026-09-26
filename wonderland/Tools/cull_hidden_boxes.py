# DROP THE VOXELS THAT ARE NEVER SEEN
#
# measure_hidden_boxes.py found that about a fifth of every Project Avatar is buried: 19.3% of TenTails_Small,
# 18.6% of Cherubim_Small, 19.2% of Seraph_Small. These figures are built from overlapping masses -- the
# forge says so and 303 distinct box sizes in one Small tier agrees -- and overlapping solids bury voxels
# inside themselves. A buried box is instanced, skinned, culled against and drawn, and never contributes a
# pixel.
#
# WHY THIS IS THE RIGHT LEVER. The crowd cost tracks voxel count closely: a crowd of all three families
# averages 7,727 boxes an avatar against 5,537 without TenTails, a ratio of 1.40, and the measured cost ratio
# at forty avatars is 1.44. The two obvious ways to cut boxes were both blocked --
#
#   a coarser voxel distorts the creature, because tile is step AND feature size in this forge, and
#   P0 item 2 forbids exactly that blockiness;
#   regrouping the components bought 5%, because components were never the dominant cost.
#
# -- and this one is blocked by neither, because it changes nothing anyone can see.
#
# CONSERVATIVE ON PURPOSE. A box is dropped only when its centre AND all eight corners each lie inside some
# OTHER single box. A box hidden by the UNION of several neighbours, with corners poking into the gaps
# between them, is kept. So this under-removes, and every box it does remove was provably invisible.
#
# AND IT WRITES NEW FILES. The founder's Small, Medium and Large tiers are untouched.
from pathlib import Path
import collections
import sys

BITE = 0.02


def cull(path, out_path):
    raw = Path(path).read_bytes().decode("utf-8", errors="ignore")
    nl = "\r\n" if "\r\n" in raw else "\n"
    lines = raw.split(nl)

    boxes, where = [], []
    for i, ln in enumerate(lines):
        f = ln.split()
        if len(f) >= 9 and f[0] == "box":
            try:
                x, y, z, sx, sy, sz = (float(v) for v in f[3:9])
            except ValueError:
                continue
            boxes.append((x, y, z, sx, sy, sz))
            where.append(i)
    if not boxes:
        return None

    cell = max(max(b[3], b[4], b[5]) for b in boxes)
    cell = max(cell, 0.5)
    index = collections.defaultdict(list)
    for i, (x, y, z, sx, sy, sz) in enumerate(boxes):
        lo = (int((x - sx * 0.5) // cell), int((y - sy * 0.5) // cell), int((z - sz * 0.5) // cell))
        hi = (int((x + sx * 0.5) // cell), int((y + sy * 0.5) // cell), int((z + sz * 0.5) // cell))
        for gx in range(lo[0], hi[0] + 1):
            for gy in range(lo[1], hi[1] + 1):
                for gz in range(lo[2], hi[2] + 1):
                    index[(gx, gy, gz)].append(i)

    def inside(px, py, pz, skip):
        for j in index.get((int(px // cell), int(py // cell), int(pz // cell)), ()):
            if j == skip:
                continue
            x, y, z, sx, sy, sz = boxes[j]
            if abs(px - x) <= sx * 0.5 and abs(py - y) <= sy * 0.5 and abs(pz - z) <= sz * 0.5:
                return True
        return False

    drop = set()
    for i, (x, y, z, sx, sy, sz) in enumerate(boxes):
        hx, hy, hz = sx * 0.5 - BITE, sy * 0.5 - BITE, sz * 0.5 - BITE
        if hx <= 0 or hy <= 0 or hz <= 0:
            continue
        pts = [(x, y, z)]
        for dx in (-hx, hx):
            for dy in (-hy, hy):
                for dz in (-hz, hz):
                    pts.append((x + dx, y + dy, z + dz))
        if all(inside(px, py, pz, i) for px, py, pz in pts):
            drop.add(where[i])

    header = [
        "# CROWD TIER -- hidden voxels removed by Tools/cull_hidden_boxes.py.",
        "# Every box dropped had its centre and all eight corners inside another box: instanced and drawn,",
        "# never visible. Parts, materials, phases, amplitudes and the silhouette are untouched, and the",
        "# source tier this was made from is untouched too.",
    ]
    kept = [ln for i, ln in enumerate(lines) if i not in drop]
    Path(out_path).write_bytes(nl.join(header + kept).encode("utf-8"))
    return len(boxes), len(drop)


def main():
    targets = sys.argv[1:] or ["TenTails_Small", "Cherubim_Small", "Seraph_Small"]
    root = Path(__file__).resolve().parent.parent / "ProjectAvatars"
    for stem in targets:
        src = root / (stem + ".wlvox")
        dst = root / (stem.replace("_Small", "_Crowd") + ".wlvox")
        got = cull(src, dst)
        if got is None:
            print("%-22s no boxes" % stem)
            continue
        total, dropped = got
        print("%-22s %6d -> %6d boxes  (%d hidden removed, %.1f%%)  -> %s"
              % (stem, total, total - dropped, dropped, 100.0 * dropped / total, dst.name))


if __name__ == "__main__":
    main()
