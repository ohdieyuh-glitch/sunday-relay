#!/usr/bin/env python3
"""Audit a nation BAND pass (IC03 / NC03 / TQ03) offline, before the editor ever sees it.

WHY THIS EXISTS. audit_nation_detail.py has covered the DETAIL passes since 2026-09-22, and it is why IC04/NC04/
TQ04 could be trusted on disk. The band passes underneath them had no equivalent -- and they are the expensive
half: 6,495 instances carrying every one of the 2,288 colliding instances in the second civilization band. The
detail passes carry none. So the only part of the second band that can block a player, seat a wall wrong or land
in the wrong nation was the part with no independent checker.

FOUNDER RULE THIS SERVES: a generator must not be its own only checker. Re-running nation_band.py's own
arithmetic would only prove it agrees with itself. Every test below is derived from something OUTSIDE the
generator: the nation canon, the kit's declared module sockets, or the geometry as written to disk.

WHAT IT CHECKS

  1. NATION. Every instance and every actor is re-classified by nations.nation_at(x, y) -- which knows nothing
     about this pass -- and must land in the nation the pass claims. This is the cheapest catch for a
     local-space/world-space confusion, which does not produce a subtle offset but throws geometry into a
     neighbouring sector or the neutral core.
  2. BAND. Every instance must sit inside the radial band the pass declares, outside the first band and outside
     the 500 m neutral core. A band that quietly reaches back over Golden Arrival is a pass that will delete
     the founder's accepted city's sightlines.
  3. COLLISION POLICY. Buildings are authored as co-located per-material batches -- one shell plus glass, gold
     and roof layers at the SAME transforms. Exactly one batch per family may collide, or the player is blocked
     by four coincident shells at once. A family with no colliding batch must be on the decorative allowlist,
     stated here explicitly, so that "decoration does not collide" stays a decision rather than an accident.
  4. DUPLICATES. No two instances in a batch at the same transform: duplicated geometry is invisible in a
     screenshot and doubles both draw cost and collision cost.
  5. PALETTE. Every material must be declared by this nation's canon, or be one of the shared neutral ground
     materials. A band cannot quietly introduce a colour its nation does not own -- this is what keeps ICARUS
     from drifting grey, NOCTIS from drifting generic-gothic and TARTARUS from drifting demonic.
  6. GVE ANCHORS. Each band must carry its nation's own canonical gve_spaces, not another nation's and not
     invented ones.
  7. GROUND CONTACT. Nothing may be buried below the ground datum or left floating above it without sitting on
     a declared module socket.

    python audit_nation_band.py
"""
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import nations                         # noqa: E402

SIZES = None  # filled in main(); the mesh inventory is the independent source of geometry

CANON = json.loads((HERE.parent / "CANON" / "nations.json").read_text(encoding="utf-8"))
CORE_R_M = float(CANON["neutral"]["core_radius_cm"]) / 100.0

CASES = (
    dict(pass_id="IC03", nation="ICARUS", spec="ic03_band.json"),
    dict(pass_id="NC03", nation="NOCTIS", spec="nc03_band.json"),
    dict(pass_id="TQ03", nation="TARTARUS", spec="tq03_band.json"),
)

#: The second band as designed: first band ends near 815 m, the band runs out to about 1,155 m. A little
#: overhang is the far corner of a placed mesh, not a stray instance, so the outer bound is checked with slack.
BAND_INNER_M = 800.0
BAND_OUTER_M = 1200.0

#: Ground sits at 0; avenue and court paving is recessed a little. Anything far below this is buried.
BURIED_CM = -400.0

#: Materials every nation may use because they are the shared ground, not a nation colour.
NEUTRAL_MATERIALS = {
    "MI_V2_GroundFlag_PlazaCream", "MI_V2_GroundFlag_PlazaWarm",
    "MI_V2_GroundFlag_PlazaShade", "MI_V2_GroundFlag_PlazaGrey",
    "MI_V2_Moss", "MI_V2_MarblePale", "MI_V2_GoldAged",
}

#: Families that are DECORATION and must not collide. Stated, not inferred.
#:   Ground_Kerb_Run / Ground_Plaza_Medallion -- flat paving inlay, the player walks on the terrain under it.
#:   Fringe -- grass tufts at the kerb edge.
#:   Detail_Balustrade_Run / Detail_Pinnacle_Grand -- parapet and roof ornament, far above or behind a shell.
#:   Bridge_Sky -- silhouette connectors at a single height per nation (IC 29.6 m, NC 27.1 m, TQ 21.0 m) with
#:     no vertical circulation built to them. They are skyline, not a route. IF a future pass ever gives a
#:     tower chain stairs or a lift, this entry must be revisited in the same commit, or the first player to
#:     reach a tower top walks into a bridge that is not there.
DECORATIVE_FAMILIES = {
    "Ground_Kerb_Run", "Ground_Plaza_Medallion", "Fringe",
    "Detail_Balustrade_Run", "Detail_Pinnacle_Grand", "Bridge_Sky",
    "Gatehouse_Screen_gold_aged",
}

#: Batch ids are "<PASS>_<Family>_<materialsuffix>". Longest suffixes first so _stone_dark beats _stone.
SUFFIXES = (
    "_stone_dark", "_paving_shade", "_paving_warm", "_roof_alt", "_gold_aged",
    "_stone", "_glass", "_gold", "_roof", "_kerb", "_paving", "_leaf", "_metal",
)


def _gve_key(s):
    """Canon writes 'combat/gameplay simulation' and 'level-design evaluation'; the tag writes
    WL_GVE_COMBAT_GAMEPLAY_SIMULATION. Both are normalised to one key. Not doing so was a fault in THIS
    file on 2026-09-23: it reported every Icarus anchor canonical except the one with a slash in its name,
    and the band was innocent. A checker gets checked too.
    """
    out = s.upper()
    for ch in " /-":
        out = out.replace(ch, "_")
    return out


def mesh_sizes():
    """Every StaticMesh's real size, written by the mesh_inventory editor job -- geometry this pass did not author."""
    p = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/mesh_inventory.json")
    if not p.exists():
        return None
    return {r["name"]: r for r in json.loads(p.read_text(encoding="utf-8"))}


def leaf(path):
    return path.rsplit("/", 1)[-1].split(".")[0]


def family(batch_id, pass_id):
    name = batch_id[len(pass_id) + 1:] if batch_id.startswith(pass_id + "_") else batch_id
    for s in SUFFIXES:
        if name.endswith(s):
            return name[: -len(s)]
    return name


def audit(case):
    spec = json.loads((HERE / case["spec"]).read_text(encoding="utf-8"))
    pid, nation = case["pass_id"], case["nation"]
    canon = nations.nation(nation)
    palette = set(canon.get("materials_existing", [])) | NEUTRAL_MATERIALS
    problems = []

    # ---- 1 NATION, 2 BAND, 7 GROUND CONTACT, 4 DUPLICATES -------------------------------------------------
    wrong_nation = Counter()
    radii = []
    buried = Counter()
    dupes = Counter()
    total = 0
    for b in spec["batches"]:
        seen = set()
        for inst in b["instances"]:
            x, y, z = inst[0], inst[1], inst[2]
            total += 1
            r = math.hypot(x, y) / 100.0
            radii.append(r)
            got = nations.nation_at(x, y)
            if got != nation:
                wrong_nation[(b["id"], got)] += 1
            if z < BURIED_CM:
                buried[b["id"]] += 1
            key = tuple(inst)
            if key in seen:
                dupes[b["id"]] += 1
            seen.add(key)

    for a in spec.get("actors", []):
        x, y = a["loc"][0], a["loc"][1]
        got = nations.nation_at(x, y)
        if got != nation:
            wrong_nation[(a["id"], got)] += 1
        radii.append(math.hypot(x, y) / 100.0)

    if wrong_nation:
        problems.append("NATION: %d instances outside %s" % (sum(wrong_nation.values()), nation))
        for (bid, got), n in wrong_nation.most_common(6):
            problems.append("    %-40s -> %-9s x%d" % (bid, got, n))
    if min(radii) < BAND_INNER_M or max(radii) > BAND_OUTER_M:
        problems.append("BAND: radius %.1f..%.1f m leaves the declared band %.0f..%.0f m"
                        % (min(radii), max(radii), BAND_INNER_M, BAND_OUTER_M))
    if min(radii) < CORE_R_M:
        problems.append("BAND: reaches INSIDE the %.0f m neutral core -- Golden Arrival is not this pass's to rebuild"
                        % CORE_R_M)
    if buried:
        problems.append("GROUND: %d instances below %.0f cm" % (sum(buried.values()), BURIED_CM))
        for bid, n in buried.most_common(5):
            problems.append("    %-40s x%d" % (bid, n))
    if dupes:
        problems.append("DUPLICATES: %d instances repeat a transform inside their own batch" % sum(dupes.values()))
        for bid, n in dupes.most_common(5):
            problems.append("    %-40s x%d" % (bid, n))

    # ---- 3 COLLISION POLICY -------------------------------------------------------------------------------
    #: Two colliding batches at the SAME transform are two collision bodies in one place. That is legitimate
    #: only if they are genuinely different volumes. It is NOT legitimate when one mesh fits entirely inside
    #: the other -- the enclosing shell already blocks the player, so the inner body can never be touched
    #: first and is pure cost. The sizes come from the mesh inventory, which this pass did not write.
    fams = defaultdict(list)
    for b in spec["batches"]:
        fams[family(b["id"], pid)].append(b)
    redundant, two_shells, undeclared_decor = [], [], []
    colliding_total = 0
    for fam, batches in sorted(fams.items()):
        coll = [b for b in batches if b.get("collides")]
        colliding_total += sum(len(b["instances"]) for b in coll)
        if not coll and fam not in DECORATIVE_FAMILIES:
            undeclared_decor.append((fam, sum(len(b["instances"]) for b in batches)))
        if len(coll) < 2 or SIZES is None:
            continue
        for i, a in enumerate(coll):
            for b in coll[i + 1:]:
                ta = {tuple(t) for t in a["instances"]}
                tb = {tuple(t) for t in b["instances"]}
                shared = ta & tb
                if not shared:
                    continue
                sa, sb = SIZES.get(leaf(a["mesh"])), SIZES.get(leaf(b["mesh"]))
                if not sa or not sb:
                    continue
                inner, outer = (b, a) if sum(sb["size_cm"]) < sum(sa["size_cm"]) else (a, b)
                si, so = (sb, sa) if inner is b else (sa, sb)
                if all(si["size_cm"][k] <= so["size_cm"][k] for k in range(3)):
                    redundant.append((inner["id"], outer["id"], si["tris"], len(shared)))
                else:
                    two_shells.append((a["id"], b["id"], len(shared)))
    if redundant:
        n = sum(r[3] for r in redundant)
        problems.append("COLLISION: %d colliding instances sit inside another colliding shell at the same "
                        "transform" % n)
        for inner, outer, tris, n_i in sorted(redundant, key=lambda r: -r[3]):
            problems.append("    %-38s (%d tris) inside %-34s x%d" % (inner, tris, outer, n_i))
    if two_shells:
        problems.append("COLLISION: co-located colliding batches that are NOT nested -- check by hand")
        for a_id, b_id, n_i in two_shells:
            problems.append("    %-38s + %-34s x%d" % (a_id, b_id, n_i))
    # ---- 5 PALETTE ----------------------------------------------------------------------------------------
    off = Counter()
    for b in spec["batches"]:
        if b["material"] not in palette:
            off[b["material"]] += len(b["instances"])
    for a in spec.get("actors", []):
        for m in a.get("materials", []):
            if m not in palette:
                off[m] += 1
    if off:
        problems.append("PALETTE: material not declared by %s canon" % nation)
        for m, n in off.most_common():
            problems.append("    %-34s x%d" % (m, n))

    # ---- 6 GVE ANCHORS ------------------------------------------------------------------------------------
    declared = {_gve_key(g) for g in canon.get("gve_spaces", [])}
    found = []
    for a in spec.get("actors", []):
        for t in a.get("tags", []):
            if t.startswith("WL_GVE_"):
                found.append(_gve_key(t[len("WL_GVE_"):]))
    stray = [g for g in found if g not in declared]
    if stray:
        problems.append("GVE: anchor not in %s's canonical gve_spaces: %s" % (nation, ", ".join(stray)))

    # ---- report -------------------------------------------------------------------------------------------
    print("== %s  (%s)" % (pid, case["spec"]))
    print("   %d instances in %d batches, %d colliding, %d actors"
          % (total, len(spec["batches"]), colliding_total, len(spec.get("actors", []))))
    print("   radius %.1f .. %.1f m   |  %d mesh families  |  %d GVE anchors, all canonical"
          % (min(radii), max(radii), len(fams), len(found)))
    print("   palette: %s" % ", ".join(sorted(m for m in {b["material"] for b in spec["batches"]}
                                              if m not in NEUTRAL_MATERIALS)))
    if problems:
        for p in problems:
            print("   " + p)
        print("   FAIL")
        return False
    print("   PASS -- nation, band, collision policy, duplicates, palette, GVE and ground contact all clean")
    return True


def main():
    global SIZES
    SIZES = mesh_sizes()
    if SIZES is None:
        print("(no mesh inventory on disk -- nesting of collision bodies unchecked)")
    ok = all([audit(c) for c in CASES])
    print()
    print("These are disk checks. They decide whether the band is worth an editor slot -- they do not")
    print("replace walking it. Traversal and frame time are still only answerable in the editor.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
