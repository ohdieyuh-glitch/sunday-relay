# HOW MUCH OF THESE FIGURES IS RUNS OF ADJACENT, IDENTICAL BOXES?
#
# Culling buried voxels failed twice: the corner test removed boxes whose faces were open, and the surface
# test could not be proven safe because the gaps are smaller than any practical sample spacing. Both were
# trying to remove geometry, which is why both were dangerous.
#
# MERGING IS A DIFFERENT KIND OF CHANGE. Two boxes that share a material, have the same cross-section, and
# sit exactly face to face occupy the same volume as one box of twice the length. Replacing them with that
# one box removes an instance and removes NOTHING visible -- not because a test says the result looks the
# same, but because the occupied volume is identical by construction. That is the property neither cull had.
#
# The figures are not a uniform grid: one Small tier has 303 distinct box sizes. So runs may be common or
# may barely exist, and building a merger before knowing which would be the same mistake as the last two.
# This only measures the ceiling. Nothing is written.
#
# MEASURED, AND THE CEILING IS ZERO:
#
#     TenTails_Small   12,105 boxes    0 merge candidates
#     Cherubim_Small    5,885 boxes    0
#     Seraph_Small      5,190 boxes   42   (0.8%)
#
# The forge builds tapered, curved, overlapping masses -- one Small tier has 303 distinct box sizes -- so
# almost no two boxes share a cross-section AND sit exactly face to face. There are no runs to merge. This is
# kept as the answer, so nobody builds a greedy mesher for a figure that has nothing for it to do.
from pathlib import Path
import collections
import sys

#: Positions are floats out of a generator; two faces "touch" within this.
EPS = 1e-3


def load(path):
    out = []
    for ln in Path(path).read_text(encoding="utf-8", errors="ignore").splitlines():
        f = ln.split()
        if len(f) >= 9 and f[0] == "box":
            try:
                out.append((f[1], f[2]) + tuple(float(v) for v in f[3:9]))
            except ValueError:
                pass
    return out


def q(v):
    return round(v / EPS)


def main(path):
    boxes = load(path)
    if not boxes:
        print("%-22s no boxes" % Path(path).stem)
        return

    # Index by (part, material, cross-section) per axis, so only boxes that COULD merge are compared.
    merged_away = 0
    for axis in (0, 1, 2):
        groups = collections.defaultdict(list)
        for part, mat, x, y, z, sx, sy, sz in boxes:
            pos = (x, y, z)
            siz = (sx, sy, sz)
            cross = tuple(q(siz[k]) for k in range(3) if k != axis)
            other = tuple(q(pos[k]) for k in range(3) if k != axis)
            groups[(part, mat, cross, other, q(siz[axis]))].append(pos[axis])
        for key, positions in groups.items():
            if len(positions) < 2:
                continue
            step = key[4] * EPS
            positions.sort()
            run = 1
            for i in range(1, len(positions)):
                if abs((positions[i] - positions[i - 1]) - step) < EPS * 2:
                    run += 1
                else:
                    merged_away += run - 1
                    run = 1
            merged_away += run - 1

    total = len(boxes)
    # A box can be merged along only one axis, so the axes overlap; this is an upper bound.
    print("%-22s %6d boxes | merge candidates across the three axes: %5d  (up to %.1f%%)"
          % (Path(path).stem, total, merged_away, 100.0 * min(merged_away, total) / total))


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent / "ProjectAvatars"
    targets = sys.argv[1:] or ["TenTails_Small", "Cherubim_Small", "Seraph_Small"]
    for t in targets:
        main(root / (t + ".wlvox"))
