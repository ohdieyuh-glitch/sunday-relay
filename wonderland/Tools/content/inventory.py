"""Inventory the wonderland-task3 working-tree content that git does not track.

Writes, next to this script:
  untracked_manifest.csv  path,bytes,sha256 for every untracked (not ignored) file under wonderland/Content
  ignored_content.csv     same, for files under wonderland/Content that .gitignore hides
  summary.txt             totals per top-level Content folder, plus licence/third-party markers found
Read-only against the repository.
"""
import csv
import hashlib
import os
import subprocess
import sys
from collections import defaultdict

REPO = r"C:\dev\iwonder\wonderland-task3"
OUT = os.path.dirname(os.path.abspath(__file__))
SCOPE = "wonderland/Content"
LICENCE_MARKERS = ("license", "licence", "eula", "megascans", "quixel", "fab_", "marketplace", "third_party", "thirdparty", "attribution", "readme")


def ls(extra):
    raw = subprocess.run(["git", "-C", REPO, "ls-files", "-z", "--others"] + extra + ["--", SCOPE],
                         capture_output=True, check=True).stdout
    return [p for p in raw.decode("utf-8", "surrogateescape").split("\0") if p]


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def write(name, paths):
    totals = defaultdict(lambda: [0, 0])
    markers = []
    with open(os.path.join(OUT, name), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["path", "bytes", "sha256"])
        for rel in sorted(paths):
            full = os.path.join(REPO, rel)
            if not os.path.isfile(full):
                continue
            size = os.path.getsize(full)
            w.writerow([rel, size, sha(full)])
            parts = rel.split("/")
            top = "/".join(parts[:3]) if len(parts) > 3 else rel
            totals[top][0] += 1
            totals[top][1] += size
            if any(m in rel.lower() for m in LICENCE_MARKERS):
                markers.append(rel)
    return totals, markers


def main():
    untracked = ls(["--exclude-standard"])
    ignored = ls(["--ignored", "--exclude-standard"])
    t_untracked, m_untracked = write("untracked_manifest.csv", untracked)
    t_ignored, m_ignored = write("ignored_content.csv", ignored)
    head = subprocess.run(["git", "-C", REPO, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    with open(os.path.join(OUT, "summary.txt"), "w", encoding="utf-8") as f:
        f.write(f"repo {REPO} head {head}\n")
        for label, totals, markers in (("UNTRACKED", t_untracked, m_untracked), ("IGNORED", t_ignored, m_ignored)):
            files = sum(v[0] for v in totals.values())
            size = sum(v[1] for v in totals.values())
            f.write(f"\n== {label}: {files} files, {size / 1e9:.3f} GB\n")
            for top, (n, b) in sorted(totals.items(), key=lambda kv: -kv[1][1]):
                f.write(f"{top}\t{n}\t{b / 1e6:.1f} MB\n")
            f.write(f"-- licence/third-party markers ({len(markers)}):\n")
            for m in markers[:200]:
                f.write(f"   {m}\n")
    print(open(os.path.join(OUT, "summary.txt"), encoding="utf-8").read())


if __name__ == "__main__":
    sys.exit(main())
