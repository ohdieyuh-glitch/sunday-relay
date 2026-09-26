# IS THE CULL ACTUALLY LOSSLESS, OR ONLY LOSSLESS BY ARGUMENT?
#
# cull_hidden_boxes.py drops a box when its centre and eight corners all lie inside some other box. That
# reasoning is sound for a convex cover and it is still only reasoning: a box can have its corners buried
# and a FACE exposed, if the boxes covering the corners leave a gap across the middle. Nine points cannot
# see a hole between them. A fifth of every avatar was just removed on the strength of those nine points.
#
# A photograph was the first plan and the capture framed the wrong actors, which is its own lesson: a visual
# check that depends on where the camera happened to point is not a check. This is better anyway, because it
# tests the thing directly instead of testing a picture of the thing.
#
# THE TEST. For every dropped box, sample a grid across all six FACES -- not corners, faces -- and require
# each sample to lie inside a box that SURVIVED. If one sample is uncovered, that face is exposed in the
# culled figure and the cull was not lossless. Faces are where a hole would show; interiors cannot.
from pathlib import Path
import collections
import sys

#: Samples per face edge. 5 x 5 across six faces is 150 points a box, which finds a gap far smaller than a
#: voxel. Corners alone were 8.
GRID = 5
BITE = 0.02


def read(path):
    out = []
    for ln in Path(path).read_bytes().decode("utf-8", errors="ignore").splitlines():
        f = ln.split()
        if len(f) >= 9 and f[0] == "box":
            try:
                out.append((f[1], f[2]) + tuple(float(v) for v in f[3:9]))
            except ValueError:
                pass
    return out


def key(b):
    return (b[0], b[1]) + tuple(round(v, 4) for v in b[2:])


def main(original, culled):
    src = read(original)
    kept = read(culled)
    kept_set = set(key(b) for b in kept)
    dropped = [b for b in src if key(b) not in kept_set]
    if not dropped:
        print("%-22s nothing dropped" % Path(original).stem)
        return True

    cell = max(max(b[5], b[6], b[7]) for b in kept) if kept else 1.0
    cell = max(cell, 0.5)
    index = collections.defaultdict(list)
    for i, b in enumerate(kept):
        _p, _m, x, y, z, sx, sy, sz = b
        lo = (int((x - sx * .5) // cell), int((y - sy * .5) // cell), int((z - sz * .5) // cell))
        hi = (int((x + sx * .5) // cell), int((y + sy * .5) // cell), int((z + sz * .5) // cell))
        for gx in range(lo[0], hi[0] + 1):
            for gy in range(lo[1], hi[1] + 1):
                for gz in range(lo[2], hi[2] + 1):
                    index[(gx, gy, gz)].append(i)

    def covered(px, py, pz):
        for j in index.get((int(px // cell), int(py // cell), int(pz // cell)), ()):
            _p, _m, x, y, z, sx, sy, sz = kept[j]
            if abs(px - x) <= sx * .5 and abs(py - y) <= sy * .5 and abs(pz - z) <= sz * .5:
                return True
        return False

    exposed, checked = 0, 0
    for _p, _m, x, y, z, sx, sy, sz in dropped:
        hx, hy, hz = sx * .5 - BITE, sy * .5 - BITE, sz * .5 - BITE
        steps = [(-1.0 + 2.0 * i / (GRID - 1.0)) for i in range(GRID)]
        pts = []
        for a in steps:
            for b in steps:
                pts.append((x + hx, y + a * hy, z + b * hz))
                pts.append((x - hx, y + a * hy, z + b * hz))
                pts.append((x + a * hx, y + hy, z + b * hz))
                pts.append((x + a * hx, y - hy, z + b * hz))
                pts.append((x + a * hx, y + b * hy, z + hz))
                pts.append((x + a * hx, y + b * hy, z - hz))
        checked += len(pts)
        if any(not covered(px, py, pz) for px, py, pz in pts):
            exposed += 1

    ok = exposed == 0
    print("%-22s dropped %5d | face samples %7d | boxes with an exposed face: %d  %s"
          % (Path(original).stem, len(dropped), checked, exposed, "LOSSLESS" if ok else "NOT LOSSLESS"))
    return ok


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent / "ProjectAvatars"
    pairs = [("TenTails_Small", "TenTails_Crowd"),
             ("Cherubim_Small", "Cherubim_Crowd"),
             ("Seraph_Small", "Seraph_Crowd")]
    all_ok = True
    for a, b in pairs:
        all_ok &= main(root / (a + ".wlvox"), root / (b + ".wlvox"))
    print("\n%s" % ("every dropped box is still fully covered by boxes that survived"
                    if all_ok else "SOME DROPPED BOX LEFT AN EXPOSED FACE -- the cull is not lossless"))
    sys.exit(0 if all_ok else 1)
