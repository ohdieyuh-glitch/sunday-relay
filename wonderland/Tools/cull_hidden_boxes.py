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
# THE FIRST VERSION OF THIS WAS WRONG AND THE NUMBER IT PRODUCED WAS A LIE.
#
# It dropped a box when its centre and eight CORNERS lay inside other boxes, removed 19% of every figure,
# and took forty avatars from 169 ms to 109 ms. verify_cull_lossless.py then sampled the FACES of what had
# been dropped: 979 of 1,092 Cherubim boxes and 903 of 999 Seraph boxes had an exposed face. Nine points
# cannot see a hole between them -- a box can have every corner buried and its middle open, and about 90%
# of them did. Those figures would have come back moth-eaten.
#
# SO THE CRITERION IS NOW THE SURFACE, which is the thing that can actually be seen. A box is dropped only
# when a grid across all six of its faces is covered, every sample, by other boxes. A box contributing no
# visible surface contributes nothing.
#
# AND THE CHECK IS NOT THE CULL. Culling samples at CULL_GRID and verify_cull_lossless.py checks at a finer
# one, so the verifier can still catch a gap the culler stepped over. Using one grid for both would be a
# proof that cannot fail, which is the trap this whole exercise exists to avoid.
#
# AND IT IS NOT USED. KEPT AS THE RECORD OF A DEAD END.
#
# The surface criterion was the right idea and point-sampling cannot carry it. Culling at a 7x7 face grid and
# verifying at 11x11 still found 754 of 1,059 dropped TenTails boxes with an exposed face -- the two grids
# disagree about 71% of the time, which means the gaps between covering boxes are smaller than any practical
# sample spacing. A finer grid would only find more; it would not make the cull safe, it would just move the
# threshold at which I noticed.
#
# Establishing that a box is genuinely buried in this geometry needs exact solid coverage -- real CSG against
# the union of its neighbours -- not points. That is a much larger piece of work than the saving justifies,
# and until someone does it, no cull ships. Both tools stay because the second one is the reason a visible
# regression in the founder's avatars is not in the repository.
#
# WHAT IT WOULD HAVE BEEN WORTH, for whoever picks this up: 19% of every figure by the corner test (wrong),
# 7-9% by the surface test (still unproven), and forty avatars from 169 ms to 109 ms on the wrong one.
#
# The founder's Small, Medium and Large tiers were never modified by any version of this.
from pathlib import Path
import collections
import sys

BITE = 0.02

#: Samples per face edge when deciding. Deliberately COARSER than the verifier's, so the two disagree when
#: the cull is wrong instead of agreeing by construction.
CULL_GRID = 7


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

    steps = [(-1.0 + 2.0 * k / (CULL_GRID - 1.0)) for k in range(CULL_GRID)]
    drop = set()
    for i, (x, y, z, sx, sy, sz) in enumerate(boxes):
        hx, hy, hz = sx * 0.5 - BITE, sy * 0.5 - BITE, sz * 0.5 - BITE
        if hx <= 0 or hy <= 0 or hz <= 0:
            continue
        pts = []
        for a in steps:
            for b in steps:
                pts.append((x + hx, y + a * hy, z + b * hz))
                pts.append((x - hx, y + a * hy, z + b * hz))
                pts.append((x + a * hx, y + hy, z + b * hz))
                pts.append((x + a * hx, y - hy, z + b * hz))
                pts.append((x + a * hx, y + b * hy, z + hz))
                pts.append((x + a * hx, y + b * hy, z - hz))
        if all(inside(px, py, pz, i) for px, py, pz in pts):
            drop.add(where[i])

    header = [
        "# CROWD TIER -- hidden voxels removed by Tools/cull_hidden_boxes.py.",
        "# Every box dropped had its whole SURFACE covered by other boxes -- a 7x7 grid across all six faces,",
        "# every sample inside another box -- so it contributed no visible surface. An earlier version tested",
        "# the eight corners instead and removed boxes whose middles were open; see verify_cull_lossless.py.",
        "# Parts, materials, phases, amplitudes and the silhouette are untouched, and so is the source tier.",
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
