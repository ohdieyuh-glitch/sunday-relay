"""Verify a copy of the untracked content against untracked_manifest.csv and scan the assets for
marketplace / third-party origin strings.

usage: python -I verify_and_scan.py <copy_root>   (copy_root holds wonderland/Content/...)
Writes verify_<label>.txt and origin_scan.txt next to this script.
"""
import csv
import hashlib
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ORIGINS = re.compile(rb"Megascans|Quixel|/Game/Fab/|FabAsset|Marketplace|KiteDemo|StarterContent|ParagonAssets|InfinityBlade|MetaHumans/", re.I)


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    root = sys.argv[1]
    label = os.path.basename(os.path.normpath(root))
    rows = list(csv.DictReader(open(os.path.join(HERE, "untracked_manifest.csv"), encoding="utf-8")))
    missing, mismatched, ok = [], [], 0
    hits = {}
    for row in rows:
        full = os.path.join(root, row["path"])
        if not os.path.isfile(full):
            missing.append(row["path"])
            continue
        if os.path.getsize(full) != int(row["bytes"]) or sha(full) != row["sha256"]:
            mismatched.append(row["path"])
            continue
        ok += 1
        if row["path"].endswith((".uasset", ".umap")):
            data = open(full, "rb").read()
            for m in set(ORIGINS.findall(data)):
                hits.setdefault(m.decode("latin-1"), []).append(row["path"])
    with open(os.path.join(HERE, f"verify_{label}.txt"), "w", encoding="utf-8") as f:
        f.write(f"root {root}\nmanifest_rows {len(rows)} ok {ok} missing {len(missing)} mismatched {len(mismatched)}\n")
        for p in missing[:50]:
            f.write(f"MISSING {p}\n")
        for p in mismatched[:50]:
            f.write(f"MISMATCH {p}\n")
    with open(os.path.join(HERE, "origin_scan.txt"), "w", encoding="utf-8") as f:
        f.write(f"origin-string hits in {ok} verified assets: {len(hits)} distinct markers\n")
        for marker, paths in sorted(hits.items()):
            f.write(f"{marker}\t{len(paths)} files\te.g. {paths[0]}\n")
    print(open(os.path.join(HERE, f"verify_{label}.txt"), encoding="utf-8").read().splitlines()[1])
    print(open(os.path.join(HERE, "origin_scan.txt"), encoding="utf-8").read())
    return 0 if not missing and not mismatched else 1


if __name__ == "__main__":
    sys.exit(main())
