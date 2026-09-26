# HOW MANY VOXELS ARE INSTANCED, DRAWN, AND NEVER SEEN?
#
# TenTails costs 1.43x per avatar in a crowd against Cherubim's and Seraph's 1.20x, and the fit says voxel
# count: 12,105 boxes against their ~5,500, measured cost ratio 1.44x against a box ratio of 1.40x. The
# obvious cure -- a coarser voxel -- is the one thing ruled out, because tile is step AND feature size in
# this forge and coarsening distorts the creature into the blockiness P0 item 2 forbids.
#
# THERE IS A THIRD OPTION NOBODY HAS PRICED. These figures are built from overlapping masses -- the forge
# says so: "overlapping masses, curved spines, joints, tapers" -- and 303 distinct box sizes says the same.
# Overlapping solids bury voxels inside themselves. A box entirely inside other boxes is instanced, skinned,
# culled and drawn against, and never contributes a pixel.
#
# Dropping those is LOSSLESS: not a smaller sculpt, not a coarser voxel, the same silhouette to the pixel.
# If it is a large fraction it is the fix that does not need art direction. If it is small, that is worth
# knowing too, and it costs one script to find out rather than an argument.
#
# The test: a box is hidden when its centre and all eight corners each lie inside SOME OTHER box. That is
# conservative -- it can only under-report, because a box can be hidden by a union its corners escape -- so
# whatever it finds is a floor on the saving, not a hopeful estimate.
from pathlib import Path
import collections
import sys

#: Pulled in from the faces a touch, so two boxes that merely abut are not read as covering each other.
BITE = 0.02


def load(path):
    boxes = []
    for ln in Path(path).read_text(encoding="utf-8", errors="ignore").splitlines():
        f = ln.split()
        if len(f) >= 9 and f[0] == "box":
            try:
                x, y, z, sx, sy, sz = (float(v) for v in f[3:9])
            except ValueError:
                continue
            boxes.append((f[1], f[2], x, y, z, sx, sy, sz))
    return boxes


def main(path):
    boxes = load(path)
    if not boxes:
        print("no boxes in %s" % path)
        return

    # A uniform grid over the biggest box, so the point tests only look at plausible neighbours. Without it
    # this is 12,105 x 9 points against 12,105 boxes, which is a billion tests and not worth waiting for.
    cell = max(max(b[5], b[6], b[7]) for b in boxes) * 1.0
    cell = max(cell, 0.5)
    index = collections.defaultdict(list)
    for i, (_p, _m, x, y, z, sx, sy, sz) in enumerate(boxes):
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
            _p, _m, x, y, z, sx, sy, sz = boxes[j]
            if (abs(px - x) <= sx * 0.5 and abs(py - y) <= sy * 0.5 and abs(pz - z) <= sz * 0.5):
                return True
        return False

    hidden, hidden_by_part = [], collections.Counter()
    for i, (part, _m, x, y, z, sx, sy, sz) in enumerate(boxes):
        hx, hy, hz = sx * 0.5 - BITE, sy * 0.5 - BITE, sz * 0.5 - BITE
        if hx <= 0 or hy <= 0 or hz <= 0:
            continue
        points = [(x, y, z)]
        for dx in (-hx, hx):
            for dy in (-hy, hy):
                for dz in (-hz, hz):
                    points.append((x + dx, y + dy, z + dz))
        if all(inside(px, py, pz, i) for px, py, pz in points):
            hidden.append(i)
            hidden_by_part[part] += 1

    total = len(boxes)
    print("%-26s %6d boxes | %5d fully hidden (%.1f%%)" % (Path(path).stem, total, len(hidden),
                                                           100.0 * len(hidden) / total))
    for part, n in hidden_by_part.most_common(6):
        print("      %-18s %5d hidden" % (part, n))
    return len(hidden), total


if __name__ == "__main__":
    targets = sys.argv[1:] or [
        "ProjectAvatars/TenTails_Small.wlvox",
        "ProjectAvatars/Cherubim_Small.wlvox",
        "ProjectAvatars/Seraph_Small.wlvox",
    ]
    for t in targets:
        main(t)
