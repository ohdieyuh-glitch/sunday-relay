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


#: Nested collision this gate knows about and is NOT failing on, with the reason and the test that settles it.
#: Ground_Plaza_Medallion: its paving layers collide in IC02 and NC01 and do not in the second band. One is
#: wrong. They are 1.8-6 cm discs a player walks ON, so guessing risks a hole in a plaza floor -- it needs a
#: floor profile across a medallion, queued as zzB65 in Tools/queue_second_band.sh. Remove this entry when
#: that profile has answered it. An exception with no test named is just a silenced failure.
OPEN_NESTED = ("Ground_Plaza_Medallion",)


def mesh_records():
    """The inventory rows by mesh name -- size_cm and tris, which no pass writes."""
    if not INVENTORY.exists():
        return None
    return {r["name"]: r for r in json.loads(INVENTORY.read_text(encoding="utf-8"))}


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


#: Batch ids are "<PASS>_<Family>_<materialsuffix>". Longest suffixes first so _stone_dark beats _stone.
_SUFFIXES = ("_stone_dark", "_paving_shade", "_paving_warm", "_roof_alt", "_gold_aged", "_stone", "_glass",
             "_gold", "_roof", "_kerb", "_paving", "_leaf", "_metal", "_petal_centre", "_petal")


def _family(batch_id):
    for s in _SUFFIXES:
        if batch_id.endswith(s):
            return batch_id[: -len(s)]
    return batch_id


def nested_collision(meshes_by_name):
    """Colliding batches that sit INSIDE another colliding batch at the same transform.

    A kit module is authored as co-located parts at one transform -- a stone shell plus glass, gold, roof and
    accent sub-meshes. If two of them collide, the player meets two bodies in one place and the engine pays
    for both; and when one mesh fits entirely inside the other, the inner one can never be met first, so it is
    pure cost. On 2026-09-23 that was 279 instances across the world -- 178 in the second civilization band and
    101 in the first -- every one of them a stone_dark accent of 12 to 216 triangles nested in its own shell.

    The cause was that NO_COLLIDE_PARTS had been copied into four generators and had drifted in three. The fix
    was one definition in nations.py; THIS is the gate that makes the fix stick, because a rule in one place is
    still a rule nothing checks. Sizes come from the mesh inventory, which no pass writes.
    """
    if meshes_by_name is None:
        return None
    findings = []
    for path in sorted((ROOT / "WorldDesign").rglob("*.json")):
        try:
            spec = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(spec, dict) or "batches" not in spec:
            continue
        # delta RECORDS (bench_delta_record, kerb_delta_record, floor_reyaw_record) carry "batches" too, but theirs
        # are old/new transforms with no id or mesh; the first one raised KeyError 'id' and the gate checked nothing
        if not all(isinstance(b, dict) and "id" in b and "mesh" in b for b in spec["batches"]):
            continue
        fams = {}
        for b in spec["batches"]:
            fams.setdefault(_family(b["id"]), []).append(b)
        for batches in fams.values():
            coll = [b for b in batches if b.get("collides")]
            for i, a in enumerate(coll):
                for b in coll[i + 1:]:
                    shared = {tuple(t) for t in a["instances"]} & {tuple(t) for t in b["instances"]}
                    if not shared:
                        continue
                    sa = meshes_by_name.get(a["mesh"].rsplit("/", 1)[-1].split(".")[0])
                    sb = meshes_by_name.get(b["mesh"].rsplit("/", 1)[-1].split(".")[0])
                    if not sa or not sb:
                        continue
                    inner, si, so = (b, sb, sa) if sum(sb["size_cm"]) < sum(sa["size_cm"]) else (a, sa, sb)
                    outer = a if inner is b else b
                    if all(si["size_cm"][k] <= so["size_cm"][k] for k in range(3)):
                        findings.append((spec.get("pass"), inner["id"], outer["id"], si["tris"], len(shared)))
    return findings

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
        # ALL OF WorldDesign, NOT JUST Nations.
        #
        # This gate is called validate_layer_spec and a bare run checked 26 of 298 layer specs -- nine per
        # cent -- because the default globbed one folder of eight. 203 specs in City, 47 in Districts, 17 in
        # GoldenArrival and 5 in Skyline had never been mesh- or material-checked by anyone who ran it
        # without arguments, which is how everyone runs it. GA08 was written, committed and nearly APPLIED
        # without this gate ever seeing it, and I only noticed because I went looking for why it was absent
        # from the output.
        #
        # Same shape as the TAKE allowlist that left 388 fixtures dark: a default that silently covers a
        # fraction of its subject, where the cost of the gap is silence rather than an error.
        args = sorted(str(q) for q in (ROOT / "WorldDesign").rglob("*.json"))
    nested = nested_collision(mesh_records())
    bad_nested = []
    if nested is None:
        print("(no mesh inventory on disk -- nested collision unchecked)")
    else:
        opened = [f for f in nested if any(k in f[1] for k in OPEN_NESTED)]
        bad_nested = [f for f in nested if f not in opened]
        if bad_nested:
            print("COLLIDING BATCHES NESTED INSIDE ANOTHER COLLIDING BATCH -- the inner body is unreachable:")
            for pid, inner, outer, tris, n in sorted(bad_nested, key=lambda f: -f[4]):
                print("   %-8s %-40s (%d tris) inside %-34s x%d" % (pid, inner, tris, outer, n))
        else:
            print("no nested collision bodies")
        if opened:
            print("OPEN, not failed (%d instances) -- see OPEN_NESTED in this file for the test that settles it:"
                  % sum(f[4] for f in opened))
            for pid, inner, outer, tris, n in sorted(opened, key=lambda f: -f[4]):
                print("   %-8s %-40s inside %-34s x%d" % (pid, inner, outer, n))
    print()
    good = all([check(a, meshes, materials) for a in args])
    return 0 if (good and not dupes and not bad_nested) else 1


if __name__ == "__main__":
    sys.exit(main())
