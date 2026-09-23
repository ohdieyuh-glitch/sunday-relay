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
    if not isinstance(spec, dict):
        # Sidecar data, not a layer spec -- the footprint files next to the band specs are JSON lists.
        # Until 2026-09-23 this raised, and because main() evaluates every check before all() sees one,
        # ONE sidecar aborted the whole run: the default glob dies at ic03_band_footprints.json, so
        # nc03/nc04/tq03/tq04 were never mesh- or material-checked by a no-argument gate run.
        print("== %s  -- sidecar data (%s of %d), not a layer spec; skipped"
              % (Path(path).name, type(spec).__name__, len(spec)))
        return True
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


def pass_id_collisions():
    """Every pass id on disk, and any id claimed by more than one spec.

    A pass id is a DELETE KEY: apply_layer removes everything tagged WL_PASS_<id> before it writes. Two specs
    sharing an id means each silently destroys the other, and on 2026-09-22 that is exactly what happened --
    WorldDesign/Nations/tartarus_quarter.py took TR01, which GoldenArrival/tr01_clock_plaza_steps.py had held
    since the Golden Arrival was built, and applying the quarter destroyed a stair whose two colliding treads
    were the only way back up from the Clock Plaza to the garden. Nothing reported it. This is one scan over
    every spec, so it can never be nothing-reported again.
    """
    seen = {}
    for path in sorted((ROOT / "WorldDesign").rglob("*.json")):
        try:
            spec = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(spec, dict):
            continue
        pid = spec.get("pass")
        if not pid or not ("batches" in spec or "actors" in spec):
            continue
        seen.setdefault(pid, []).append(path.relative_to(ROOT))
    return {k: v for k, v in seen.items() if len(v) > 1}, len(seen)


def main():
    meshes, materials = known_meshes(), known_materials()
    dupes, n_ids = pass_id_collisions()
    print("%d distinct pass ids on disk" % n_ids)
    if dupes:
        print("PASS ID COLLISIONS -- each of these specs DELETES the other's actors when applied:")
        for pid, paths in sorted(dupes.items()):
            print("   %s" % pid)
            for q in paths:
                print("      %s" % q)
    else:
        print("no pass id collisions")
    print()
    if meshes is None:
        print("(no mesh inventory on disk -- run the mesh_inventory editor job; mesh paths unchecked)")
    if materials is None:
        print("(no Materials/Instances folder -- material names unchecked)")
    args = sys.argv[1:]
    if not args:
        args = sorted(str(p) for p in (ROOT / "WorldDesign" / "Nations").glob("*.json"))
    good = all([check(a, meshes, materials) for a in args])
    return 0 if (good and not dupes) else 1


if __name__ == "__main__":
    sys.exit(main())
