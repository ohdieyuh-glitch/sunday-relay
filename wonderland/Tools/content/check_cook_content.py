"""Pre-cook check: refuse to package a Wonderland tree that is missing world content.

The startup map and its World Partition actors are NOT in git (see README.md here). A clean
checkout cooks "successfully" and then fails at launch with
"Failed to enter /Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2". This check fails first.

usage: python -I check_cook_content.py [--full] [--project <dir holding Wonderland.uproject>]
  default        every map in Config/DefaultEngine.ini (GameDefaultMap, EditorStartupMap, MapsToCook)
                 has its .umap, a World Partition map has its __ExternalActors__ folder, every /Game
                 DirectoriesToAlwaysCook entry exists, and every untracked_manifest.csv file is present
                 at its recorded size
  --full         also checks every manifest file's sha256 (slower)
Exit 0 = ready to cook. Exit 1 = missing content (listed). Exit 2 = usage/config problem.
"""
import argparse
import csv
import hashlib
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, "untracked_manifest.csv")


def game_path_to_file(content_dir, game_path):
    """/Game/A/B/Map.Map or /Game/A/B/Map -> <Content>/A/B/Map (no extension)."""
    path = game_path.split(".")[0]
    if not path.startswith("/Game/"):
        return None
    return os.path.join(content_dir, *path[len("/Game/"):].split("/"))


def maps_and_dirs(engine_ini, game_ini):
    maps, dirs = [], []
    for ini in (engine_ini, game_ini):
        if not os.path.isfile(ini):
            continue
        for line in open(ini, encoding="utf-8", errors="replace"):
            line = line.strip()
            if line.startswith(";"):
                continue
            m = re.match(r"^(GameDefaultMap|EditorStartupMap)=(\S+)$", line)
            if m:
                maps.append(m.group(2))
            m = re.match(r'^\+MapsToCook=\(FilePath="([^"]+)"\)', line)
            if m:
                maps.append(m.group(1))
            m = re.match(r'^\+DirectoriesToAlwaysCook=\(Path="([^"]+)"\)', line)
            if m:
                dirs.append(m.group(1))
    return sorted(set(maps)), sorted(set(dirs))


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--project", default=os.path.normpath(os.path.join(HERE, "..", "..")))
    args = parser.parse_args()
    project = os.path.abspath(args.project)
    content = os.path.join(project, "Content")
    repo_root = os.path.dirname(project)
    if not os.path.isfile(os.path.join(project, "Wonderland.uproject")):
        print(f"COOK CONTENT CHECK USAGE: no Wonderland.uproject in {project}")
        return 2
    maps, dirs = maps_and_dirs(os.path.join(project, "Config", "DefaultEngine.ini"), os.path.join(project, "Config", "DefaultGame.ini"))
    if not maps:
        print("COOK CONTENT CHECK USAGE: no maps configured in DefaultEngine.ini/DefaultGame.ini")
        return 2
    problems = []
    for game_map in maps:
        base = game_path_to_file(content, game_map)
        if base is None:
            continue
        if not os.path.isfile(base + ".umap"):
            problems.append(f"MAP MISSING {game_map} -> {base}.umap")
            continue
        rel = os.path.relpath(base, content)
        actors = os.path.join(content, "__ExternalActors__", rel)
        ini = base + ".ini"
        world_partition = os.path.isdir(actors) or os.path.isfile(ini) or game_map.endswith("_WP2") or "_WP" in os.path.basename(base)
        if world_partition and not (os.path.isdir(actors) and any(os.scandir(actors))):
            problems.append(f"WORLD PARTITION ACTORS MISSING {game_map} -> {actors}")
    for d in dirs:
        if d.startswith("/Engine") or d.startswith("/NNE"):
            continue
        rel = d[len("/Game/"):] if d.startswith("/Game/") else d
        if not os.path.isdir(os.path.join(content, *rel.split("/"))):
            problems.append(f"ALWAYS-COOK DIRECTORY MISSING {d}")
    rows = list(csv.DictReader(open(MANIFEST, encoding="utf-8"))) if os.path.isfile(MANIFEST) else []
    if not rows:
        problems.append(f"MANIFEST MISSING {MANIFEST}")
    missing = mismatched = 0
    for row in rows:
        full = os.path.join(repo_root, *row["path"].split("/"))
        if not os.path.isfile(full):
            missing += 1
            if missing <= 20:
                problems.append(f"CONTENT MISSING {row['path']}")
            continue
        if os.path.getsize(full) != int(row["bytes"]) or (args.full and sha(full) != row["sha256"]):
            mismatched += 1
            if mismatched <= 20:
                problems.append(f"CONTENT DIFFERS {row['path']}")
    if problems:
        for p in problems:
            print(p)
        print(f"COOK CONTENT CHECK FAIL maps={len(maps)} manifest={len(rows)} missing={missing} differs={mismatched} problems={len(problems)}")
        print("Restore the world content first: see wonderland/Tools/content/README.md")
        return 1
    print(f"COOK CONTENT CHECK PASS maps={len(maps)} always_cook_dirs={len(dirs)} manifest={len(rows)} mode={'sha256' if args.full else 'size'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
