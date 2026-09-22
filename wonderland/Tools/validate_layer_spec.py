#!/usr/bin/env python3
"""Check a WorldDesign layer spec OFFLINE, before an editor ever sees it.

WHY. Three applies were refused in the editor today, each after a wait for the world to load, and each for a
reason that was knowable on disk: a material instance that does not exist (MI_V2_GlassPale, invented), a mesh path
that does not exist (SM_topiary_ball_small, remembered), and a paving material referenced under a name the project
spells differently. The editor is the most expensive place to discover a typo -- a failed apply costs the queue
behind it, and twice today it cost a twelve-minute restart.

So this checks a spec against two things already on disk:
  * mesh_inventory.json  -- every StaticMesh the project actually has (written by the mesh_inventory editor job)
  * the Materials/Instances folder -- every material instance that actually exists

and reports anything a spec asks for that is not there. It also reports the pass's shape, because a spec that
resolves cleanly can still be wrong in a way worth seeing before it is applied: how many instances, how many
collide, and which of them are so large or so numerous that they deserve a second look.

    python validate_layer_spec.py <spec.json> [<spec.json> ...]
"""
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "Content" / "WonderlandV2"
INVENTORY = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/mesh_inventory.json")


def known_meshes():
    if not INVENTORY.exists():
        return None
    rows = json.loads(INVENTORY.read_text(encoding="utf-8"))
    out = set()
    for r in rows:
        out.add(r["path"])
        out.add("%s.%s" % (r["path"], r["name"]))
    return out


def known_materials():
    folder = CONTENT / "Materials" / "Instances"
    if not folder.is_dir():
        return None
    return {p.stem for p in folder.glob("*.uasset")}


def material_name(ref):
    """Specs carry either a bare instance name or a full /Game path."""
    if ref.startswith("/"):
        return ref.rsplit("/", 1)[-1].split(".")[0]
    return ref


def check(path, meshes, materials):
    spec = json.loads(Path(path).read_text(encoding="utf-8"))
    bad_mesh, bad_mat = Counter(), Counter()
    instances = colliding = 0
    biggest = []
    for b in spec.get("batches", []):
        n = len(b.get("instances", []))
        instances += n
        if b.get("collides"):
            colliding += n
        if meshes is not None and b["mesh"] not in meshes:
            bad_mesh[b["mesh"]] += 1
        if materials is not None and material_name(b["material"]) not in materials:
            bad_mat[b["material"]] += 1
        biggest.append((n, b["id"]))
    for a in spec.get("actors", []):
        if meshes is not None and a["mesh"] not in meshes:
            bad_mesh[a["mesh"]] += 1
        for m in a.get("materials", []):
            if materials is not None and material_name(m) not in materials:
                bad_mat[m] += 1
    biggest.sort(reverse=True)

    print("== %s  (pass %s)" % (Path(path).name, spec.get("pass")))
    print("   batches %d, instances %d (%d collide, %d do not), actors %d"
          % (len(spec.get("batches", [])), instances, colliding, instances - colliding,
             len(spec.get("actors", []))))
    print("   tags %s" % (spec.get("tags"),))
    for n, key in biggest[:4]:
        print("     largest batch %-34s %5d" % (key, n))
    ok = True
    if bad_mesh:
        ok = False
        print("   MESHES THAT DO NOT EXIST:")
        for m, n in bad_mesh.most_common():
            print("     %s  (%d batches)" % (m, n))
    if bad_mat:
        ok = False
        print("   MATERIALS THAT DO NOT EXIST:")
        for m, n in bad_mat.most_common():
            print("     %s  (%d batches)" % (m, n))
    if ok:
        print("   every mesh and material resolves")
    return ok


def main():
    meshes, materials = known_meshes(), known_materials()
    if meshes is None:
        print("(no mesh inventory on disk -- run the mesh_inventory editor job; mesh paths unchecked)")
    if materials is None:
        print("(no Materials/Instances folder -- material names unchecked)")
    args = sys.argv[1:]
    if not args:
        args = sorted(str(p) for p in (ROOT / "WorldDesign" / "Nations").glob("*.json"))
    good = all([check(a, meshes, materials) for a in args])
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main())
