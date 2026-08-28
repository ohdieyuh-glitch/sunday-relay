#!/usr/bin/env python3
"""File rendered suite frames under the founder's permanent names, never
overwriting a previous founder-review render.

  python3 wonderland/v2/tools/file_suite.py PASSTAG RENDER_DIR cam=V2_PASS_nnn [cam=V2_PASS_nnn ...]

    PASSTAG     e.g. SUITE01, VEG_PASS05D -- becomes V2_GOLDENARRIVAL_<PASSTAG>_<CamName>_720p.png
    RENDER_DIR  where round.sh pulled the frames (V2_PASS_nnn.png, cam index in the history line)
    cam=...     camera INDEX (0-7) = the V2_PASS that rendered it

Camera names come from v2_config.CAM_SUITE, so a filed frame can only carry
the name of the camera the tooling addressed by that index."""
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import v2_config as C  # noqa: E402

DEST = os.path.join(HERE, "..", "reference", "renders")


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    tag, rdir, pairs = argv[0], argv[1], argv[2:]
    rc = 0
    for pair in pairs:
        idx, pas = pair.split("=", 1)
        name = C.CAM_SUITE[int(idx)]
        src = os.path.join(rdir, pas + ".png")
        dst = os.path.join(DEST, "V2_GOLDENARRIVAL_%s_%s_720p.png" % (tag, name))
        if not os.path.isfile(src):
            print("MISSING %s" % src)
            rc = 1
            continue
        if os.path.exists(dst):
            print("REFUSED %s exists -- founder-review renders are never overwritten" % os.path.basename(dst))
            rc = 1
            continue
        shutil.copyfile(src, dst)
        print("filed %s -> %s" % (pas, os.path.basename(dst)))
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
