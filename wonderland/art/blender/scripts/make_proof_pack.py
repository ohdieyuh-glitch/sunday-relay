#!/usr/bin/env python3
"""Choose the ~20 assets that would prove the Unreal pipeline, BY RULE.

    python3 wonderland/art/blender/scripts/make_proof_pack.py

WHY A SCRIPT AND NOT A LIST. A hand-picked list of twenty asset ids is a list
that is wrong the day a family changes, and nothing says so. Every asset here
is selected by a REQUIREMENT -- "something that exercises the water material",
"the smallest mesh in the kit", "a complete legal tower stack" -- so the pack
re-derives itself from whatever the kit currently is, and each entry carries
the requirement it satisfies. If a requirement can no longer be met, the pack
says so instead of quietly shrinking.

WHAT THE PACK IS FOR. It is the FIRST import, the one nobody has done yet. It
is small enough to inspect asset by asset in the content browser and wide
enough that the failures worth finding early cannot hide:

  every material slot          a wrong MI_V2_* name shows as the wrong surface
  the tallest and the smallest a scale error shows immediately at both ends
  both sides of the Nanite line one mesh above the threshold and one below
  a complete tower stack        the socket grammar can be BUILT, not just read
  an excavating module          z = 0 as ground datum, geometry below it
  a mounted module              a module with no footing at all
  a weathered variant           the post-process survives an export round trip
  a multi-part module           several meshes sharing one origin

None of that is proof of anything yet. It is the smallest set whose import
would BE proof, and it is picked so that a single wrong assumption in the
export contract cannot slip through unrepresented.
"""

import argparse
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
MANIFEST = os.path.join(ROOT, "manifests", "wonderland-blender-kit.json")
OUT = os.path.join(ROOT, "manifests", "wonderland-first-unreal-proof.json")


def load(path=MANIFEST):
    with io.open(path, encoding="utf8") as fh:
        return json.load(fh)


def _tris(a):
    return a.get("tris_total") or 0


def _materials(a):
    return {p.get("material") for p in (a.get("parts") or {}).values()}


def _socket(a, name):
    for s in a.get("sockets") or []:
        if s.get("name") == name:
            return s
    return None


def _rung(radius_uu, ladder, tol):
    for name, r in ladder.items():
        if abs(r - radius_uu) <= tol:
            return name
    return None


def spell_a_stack(assets, ladder, tol):
    """A legal foot -> body -> crown, found by walking the sockets themselves.

    The kit's own compatibility rule, re-applied here rather than trusted from
    the manifest's `legal_tower_stacks` count: a top socket and a bottom socket
    on the same rung, both of kind `tower`, and a terminal crown to finish.
    """
    def top(a):
        s = _socket(a, "top")
        return s if s and s.get("kind") == "tower" else None

    def bottom(a):
        s = _socket(a, "bottom")
        return s if s and s.get("kind") == "tower" else None

    feet = [a for a in assets if a.get("silhouette_role") == "foot" and top(a)]
    bodies = [a for a in assets if a.get("silhouette_role") == "body"]
    crowns = [a for a in assets if a.get("silhouette_role") in ("crown", "needle")]
    for foot in sorted(feet, key=lambda a: a["asset_id"]):
        fr = _rung(top(foot)["radius_uu"], ladder, tol)
        for body in sorted(bodies, key=lambda a: a["asset_id"]):
            b_in, b_out = bottom(body), top(body)
            if not b_in or not b_out:
                continue
            if _rung(b_in["radius_uu"], ladder, tol) != fr:
                continue
            outr = _rung(b_out["radius_uu"], ladder, tol)
            for crown in sorted(crowns, key=lambda a: a["asset_id"]):
                c = bottom(crown)
                if c and _rung(c["radius_uu"], ladder, tol) == outr:
                    return [foot, body, crown]
    return []


def build(manifest):
    assets = manifest["assets"]
    ladder = manifest["radius_ladder_uu"]
    tol = manifest["ladder_tolerance_uu"]
    by_id = {a["asset_id"]: a for a in assets}

    picked = []          # [(asset_id, requirement)]
    seen = set()

    def take(asset, why):
        if asset is None:
            return False
        if asset["asset_id"] in seen:
            # already in the pack for another reason; record the second reason
            for entry in picked:
                if entry[0] == asset["asset_id"]:
                    entry[1].append(why)
            return True
        seen.add(asset["asset_id"])
        picked.append([asset["asset_id"], [why]])
        return True

    unmet = []

    # 1. every material slot the kit uses, cheapest carrier of each. Four of
    #    them arrived with the ground family and none of them had ever been in
    #    an export, which is exactly what a by-requirement pack is for.
    for mat in sorted({m for a in assets for m in _materials(a) if m}):
        carriers = [a for a in assets if mat in _materials(a)]
        if not carriers:
            unmet.append("no asset carries %s" % mat)
            continue
        take(min(carriers, key=lambda a: (_tris(a), a["asset_id"])),
             "carries %s" % mat)

    # 2. the extremes of scale, where a unit error is loudest
    take(max(assets, key=lambda a: a.get("height_uu") or 0),
         "the TALLEST module: a scale error is unmissable on it")
    take(min(assets, key=lambda a: a.get("height_uu") or 0),
         "the SHORTEST module: the other end of the same check")
    take(max(assets, key=_tris), "the heaviest mesh in the kit")

    # 3. both sides of the Nanite threshold
    above = [a for a in assets if a.get("nanite_recommended")]
    below = [a for a in assets if not a.get("nanite_recommended")]
    if above:
        take(min(above, key=_tris), "just ABOVE the Nanite threshold")
    else:
        unmet.append("nothing is above the Nanite threshold")
    if below:
        take(max(below, key=_tris), "just BELOW the Nanite threshold")
    else:
        unmet.append("nothing is below the Nanite threshold")

    # 4. a complete legal stack, spelled from the sockets
    stack = spell_a_stack(assets, ladder, tol)
    if len(stack) == 3:
        for a, role in zip(stack, ("foot", "body", "crown")):
            take(a, "the %s of a complete legal tower stack" % role)
    else:
        unmet.append("no legal foot/body/crown stack could be spelled")

    # 5. the contract's awkward cases
    dug = [a for a in assets if (a.get("excavation_uu") or 0) > 0]
    take(max(dug, key=lambda a: a["excavation_uu"]) if dug else None,
         "the deepest EXCAVATION: geometry below the ground datum")
    if not dug:
        unmet.append("no module excavates")
    mounted = [a for a in assets if a.get("mounts_on")]
    take(mounted[0] if mounted else None,
         "a MOUNTED module: carried by a facade, with no footing at all")
    if not mounted:
        unmet.append("no module mounts")
    variants = [a for a in assets if a.get("variant_of")]
    if variants:
        take(max(variants, key=_tris), "a weathered VARIANT, exported like any other")
        broken = [a for a in variants if a.get("params", {}).get("sockets_destroyed")]
        take(broken[0] if broken else None,
             "a DAMAGED variant, whose socket list is shorter than its base's")
    else:
        unmet.append("no weathered variants exist")
    multi = [a for a in assets if a.get("part_count", 0) >= 4]
    take(max(multi, key=lambda a: a["part_count"]) if multi else None,
         "the most-parted module: several meshes that must share one origin")
    if not multi:
        unmet.append("no module has four or more parts")

    entries = []
    for aid, whys in picked:
        a = by_id[aid]
        entries.append({
            "asset_id": aid,
            "why": whys,
            "family_group": a.get("family_group"),
            "height_uu": a.get("height_uu"),
            "tris_total": _tris(a),
            "part_count": a.get("part_count"),
            "materials": sorted(m for m in _materials(a) if m),
            "nanite_recommended": a.get("nanite_recommended"),
            "collision_recommended": a.get("collision_recommended"),
            "variant_of": a.get("variant_of"),
            "meshes": sorted(p.get("mesh_name")
                             for p in (a.get("parts") or {}).values()),
        })
    entries.sort(key=lambda e: e["asset_id"])
    return {
        "schema": "wonderland-first-unreal-proof/1",
        "kit_version": manifest.get("kit_version"),
        "from_manifest": os.path.relpath(MANIFEST, ROOT),
        "generated_by": "wonderland/art/blender/scripts/make_proof_pack.py",
        "purpose": ("the smallest set of this kit whose import would prove the "
                    "pipeline end to end: every material, both ends of the "
                    "scale, both sides of the Nanite line, one complete tower "
                    "stack, and each awkward case in the export contract"),
        "selection": "by requirement, re-derived from the manifest every run",
        "proven": {
            "imported_into_an_editor": False,
            "note": ("nothing in this pack has been imported. It names what to "
                     "import first and why, and that is all it claims."),
        },
        "unmet_requirements": unmet,
        "counts": {
            "assets": len(entries),
            "meshes": sum(len(e["meshes"]) for e in entries),
            "triangles": sum(e["tris_total"] for e in entries),
            "materials_covered": len(sorted({m for e in entries
                                             for m in e["materials"]})),
        },
        "assets": entries,
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args(argv)
    pack = build(load())
    with io.open(args.out, "w", encoding="utf8") as fh:
        json.dump(pack, fh, indent=2)
        fh.write(u"\n")
    c = pack["counts"]
    print("proof pack -> %s" % os.path.relpath(args.out, ROOT))
    print("  %d assets, %d meshes, %d triangles, %d material(s) covered"
          % (c["assets"], c["meshes"], c["triangles"], c["materials_covered"]))
    if pack["unmet_requirements"]:
        print("  UNMET: %s" % "; ".join(pack["unmet_requirements"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
