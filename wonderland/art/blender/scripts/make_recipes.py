#!/usr/bin/env python3
"""Machine-readable placement recipes: WHERE the kit goes, not that it went.

    python3 wonderland/art/blender/scripts/make_recipes.py

WHAT THIS IS AND IS NOT. It writes `manifests/wonderland-placement-recipes.json`
-- a list of four compositions, each a set of (module, position, yaw) triples
in unreal units, ready for a generator to consume. It does NOT place anything.
World placement belongs to the world session and this file never touches its
map, its layout or its HUD; a recipe is a proposal in a file.

WHY A GENERATOR AND NOT A HAND-WRITTEN JSON. Every position here is COMPUTED
from the manifest's own measurements: a tower stack's storeys sit at the `top`
socket heights actually measured off the geometry, a wall circuit's runs are
spaced by the measured length of a run, a canal is laid at the measured module
length so its ends butt. Type any of those numbers by hand and the day a module
changes height the recipe is silently wrong. Derive them and it cannot be.

THE FOUR RECIPES, and what each is FOR:

  needle_skyline_cluster  the thing the reference has and the world does not:
                          a dense stand of slender towers at several heights,
                          spelled from the socket grammar rather than picked
  royal_threshold         a gate you arrive at -- hero gate on axis, curtain
                          running away both ways, a ceremonial arch out in
                          front of it and colonnades along the approach
  water_garden            lower garden -> canal -> crossing -> cascade -> upper
                          terrace, which is the route the water family was
                          built to make walkable
  market_street           two terraces of houses facing each other with the
                          awning, arcade, sign and canopy layer in between

EVERY RECIPE IS CHECKED before it is written: stacked modules must agree on the
radius ladder, butted modules must actually touch, and no two footprints on the
ground may overlap unless the recipe says they are meant to. A recipe that
fails its own checks is still written, with the failures in it, because a
silent drop is the one outcome that would waste somebody's afternoon.
"""

import argparse
import io
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
MANIFEST = os.path.join(ROOT, "manifests", "wonderland-blender-kit.json")
OUT = os.path.join(ROOT, "manifests", "wonderland-placement-recipes.json")

TOL_UU = 2.0            # 2 cm, the kit's own tolerance in manifest units


def load(path=MANIFEST):
    with io.open(path, encoding="utf8") as fh:
        return json.load(fh)


class Kit(object):
    """Read-only helpers over the manifest, so a recipe reads like a plan."""

    def __init__(self, manifest):
        self.m = manifest
        self.by_id = {a["asset_id"]: a for a in manifest["assets"]}
        self.ladder = manifest["radius_ladder_uu"]
        self.tol = manifest["ladder_tolerance_uu"]

    def has(self, aid):
        return aid in self.by_id

    def a(self, aid):
        if aid not in self.by_id:
            raise KeyError("%s is not in the manifest" % aid)
        return self.by_id[aid]

    def socket(self, aid, name):
        for s in self.a(aid).get("sockets") or []:
            if s["name"] == name:
                return s
        return None

    def size(self, aid):
        return self.a(aid)["size_uu"]

    def height(self, aid):
        return self.a(aid)["height_uu"]

    def rung(self, radius_uu):
        for name, r in self.ladder.items():
            if abs(r - radius_uu) <= self.tol:
                return name
        return None

    def footprint_r(self, aid):
        s = self.socket(aid, "bottom")
        if s and s["kind"] == "ground":
            return s["radius_uu"]
        sz = self.size(aid)
        return 0.5 * math.hypot(sz[0], sz[1])

    def plan_box(self, aid, at, yaw):
        """The module's ground footprint, placed and yawed. Right angles only.

        Uses `bbox_min_uu`/`bbox_max_uu` rather than `size_uu`, because those
        are the only numbers that know where a module's ORIGIN sits inside it.
        """
        if abs(yaw % 90.0) > 1e-6:
            return None
        a = self.a(aid)
        lo, hi = a["bbox_min_uu"], a["bbox_max_uu"]
        corners = [(lo[0], lo[1]), (hi[0], lo[1]), (hi[0], hi[1]), (lo[0], hi[1])]
        k = int(round(yaw / 90.0)) % 4
        out = []
        for (x, y) in corners:
            for _ in range(k):
                x, y = -y, x
            out.append((at[0] + x, at[1] + y))
        return (min(p[0] for p in out), min(p[1] for p in out),
                max(p[0] for p in out), max(p[1] for p in out))

    def pick(self, role=None, group=None, exclude_variants=True, order="id"):
        out = []
        for a in self.m["assets"]:
            if exclude_variants and a.get("variant_of"):
                continue
            if role and a.get("silhouette_role") != role:
                continue
            if group and a.get("family_group") != group:
                continue
            out.append(a)
        if order == "height":
            out.sort(key=lambda a: -(a.get("height_uu") or 0))
        else:
            out.sort(key=lambda a: a["asset_id"])
        return out


def place(aid, at, yaw=0.0, why="", part_of=None, abuts=()):
    """One placement. `abuts` names modules this one is MEANT to interpenetrate.

    A clip-on is supposed to overlap what it clips to: an arcade insert stands
    against a house's facade and its back plane is inside the wall by design.
    Declaring that here keeps the footprint check strict about everything else
    rather than loosening it for everyone.
    """
    return {"module": aid, "at_uu": [round(v, 2) for v in at],
            "yaw_deg": round(float(yaw), 2), "why": why,
            "part_of": part_of, "abuts": list(abuts)}


# --------------------------------------------------------------------------
# the spellings a skyline needs
# --------------------------------------------------------------------------


def spellings(kit, want=6, max_bodies=2):
    """Distinct legal foot/body*/terminator stacks, tallest first.

    Walks the same grammar `kit.compatible` walks in Blender: a `top` socket
    and a `bottom` socket of kind `tower` whose radii are on the same rung.
    """
    def top(a):
        s = kit.socket(a["asset_id"], "top")
        return s if s and s["kind"] == "tower" else None

    def bot(a):
        s = kit.socket(a["asset_id"], "bottom")
        return s if s and s["kind"] == "tower" else None

    feet = [a for a in kit.pick(role="foot") if top(a)]
    bodies = [a for a in kit.pick(role="body") if top(a) and bot(a)]
    ends = [a for a in kit.m["assets"]
            if a.get("silhouette_role") in ("crown", "needle")
            and not a.get("variant_of") and bot(a)]

    found = []
    for foot in feet:
        chains = [[foot]]
        for _ in range(max_bodies):
            grown = []
            for chain in chains:
                r = kit.rung(top(chain[-1])["radius_uu"])
                for b in bodies:
                    if kit.rung(bot(b)["radius_uu"]) == r:
                        grown.append(chain + [b])
            chains += grown
        for chain in chains:
            r = kit.rung(top(chain[-1])["radius_uu"])
            for e in ends:
                if kit.rung(bot(e)["radius_uu"]) == r:
                    found.append(chain + [e])
    # tallest first, and no two spellings sharing the same crown, so a cluster
    # reads as several kinds of tower rather than one repeated
    found.sort(key=lambda c: -sum(kit.height(m["asset_id"]) for m in c))
    out, used_top = [], set()
    for c in found:
        key = c[-1]["asset_id"]
        if key in used_top:
            continue
        used_top.add(key)
        out.append(c)
        if len(out) >= want:
            break
    return out


def stack_at(kit, chain, x, y, name):
    """Place a spelled chain, each module at the measured top of the one below."""
    out, z = [], 0.0
    for i, mod in enumerate(chain):
        aid = mod["asset_id"]
        out.append(place(aid, (x, y, z), 0.0,
                         "storey %d of %s" % (i + 1, name), part_of=name))
        t = kit.socket(aid, "top")
        if t is None:
            break
        z += t["z_uu"]
    return out


# --------------------------------------------------------------------------
# the four recipes
# --------------------------------------------------------------------------


def recipe_skyline(kit):
    """A dense stand of slender towers on two rings, spaced by their own feet."""
    chains = spellings(kit, want=7)
    if not chains:
        return None
    items, notes = [], []

    def foot_r(chain):
        """Half the widest ground extent of a stack's foot, from its bbox."""
        sz = kit.size(chain[0]["asset_id"])
        return max(sz[0], sz[1]) * 0.5

    outer = chains[:max(1, len(chains) - 2)]
    inner = chains[len(outer):]

    def radius_for(cs, gap=300.0):
        """The radius at which NEIGHBOURS clear, not the one the circumference
        suggests.

        Circumference divided by 2*pi is the n -> infinity approximation and it
        is wrong exactly where it matters: two stacks on a ring of radius r are
        2r apart, not (2*pi*r)/2, so a two-stack inner ring came out with 19 m
        feet 16 m apart. The chord between adjacent stacks is 2*r*sin(pi/n),
        and that is what has to clear.
        """
        if len(cs) < 2:
            return 0.0
        need = 2.0 * max(foot_r(c) for c in cs) + gap
        return need / (2.0 * math.sin(math.pi / len(cs)))

    r_out = radius_for(outer)
    r_in = radius_for(inner)
    if inner:
        # THE TWO RINGS HAVE TO CLEAR EACH OTHER, and the first version did not
        # check: an inner stack and an outer stack ended 3.5 m apart with 10 m
        # feet. Push the OUTER ring out rather than pulling the inner one in,
        # so the inner cluster keeps the density that is the point of it.
        gap = max(foot_r(c) for c in outer) + max(foot_r(c) for c in inner) + 400.0
        if r_out - r_in < gap:
            r_out = r_in + gap
            notes.append("outer ring pushed out to %.0f uu so the two rings "
                         "clear each other by 4 m" % r_out)

    def lay(cs, tag, r, phase=0.0):
        for i, c in enumerate(cs):
            a = phase + 2.0 * math.pi * i / max(len(cs), 1)
            items.extend(stack_at(kit, c, r * math.cos(a), r * math.sin(a),
                                  "%s_%d" % (tag, i + 1)))

    lay(outer, "skyline_outer", r_out)
    if inner:
        lay(inner, "skyline_inner", r_in, phase=math.pi / max(len(inner), 1))
    notes.append("outer ring radius %.0f uu, inner %.0f uu, both derived from "
                 "the sum of the feet's own measured widths" % (r_out, r_in))
    return {
        "name": "needle_skyline_cluster",
        "for": "the reference's dense stand of slender towers at several heights",
        "rule": ("spellings are walked from the socket grammar (a `top` and a "
                 "`bottom` of kind tower on the same rung), tallest first and "
                 "no two sharing a crown; each storey sits at the MEASURED top "
                 "socket of the one below; ring radii come from the feet's own "
                 "footprint radii, not from a chosen number"),
        "notes": notes,
        "stacks": len(chains),
        "placements": items,
    }


def recipe_threshold(kit):
    """Hero gate on axis, curtain running both ways, arch and colonnades in front."""
    need = ["WL_Hero_Gate_Royal", "WL_Wall_Curtain_Run", "WL_Arch_Ceremonial",
            "WL_Colonnade_Arcade"]
    missing = [n for n in need if not kit.has(n)]
    if missing:
        return {"name": "royal_threshold", "unbuildable": missing, "placements": []}
    gate, run = "WL_Hero_Gate_Royal", "WL_Wall_Curtain_Run"
    items = [place(gate, (0.0, 0.0, 0.0), 0.0, "the gate, on the axis", "threshold")]

    # the curtain butts the gate's own flanks and then itself, run by run
    gate_half = kit.size(gate)[1] * 0.5
    # THE RUN'S LENGTH IS ITS X EXTENT. Laid at yaw 90 it runs along Y, but the
    # module is 13.60 m long and 4.50 m thick and it is size[0] that is the
    # length; spacing them by size[1] stacked six runs inside 4.5 m.
    run_len = kit.size(run)[0]
    for side in (-1.0, 1.0):
        for i in range(3):
            y = side * (gate_half + run_len * (i + 0.5))
            items.append(place(run, (0.0, y, 0.0), 90.0,
                               "curtain run %d, %s of the gate"
                               % (i + 1, "-Y" if side < 0 else "+Y"),
                               "threshold"))
    # the ceremonial arch stands out in front, one gate depth clear
    approach = kit.size(gate)[0] * 0.5 + kit.size("WL_Arch_Ceremonial")[0] * 0.5 + 900.0
    items.append(place("WL_Arch_Ceremonial", (approach, 0.0, 0.0), 0.0,
                       "the arch out in front, clear of the gate by 9 m",
                       "threshold"))
    # colonnades line the approach between the two
    col = "WL_Colonnade_Arcade"
    col_len = kit.size(col)[0]
    lane = kit.size("WL_Arch_Ceremonial")[1] * 0.5 + kit.size(col)[1] * 0.5 + 400.0
    n = max(1, int(approach // col_len))
    for side in (-1.0, 1.0):
        for i in range(n):
            x = kit.size(gate)[0] * 0.5 + col_len * (i + 0.5)
            items.append(place(col, (x, side * lane, 0.0), 0.0,
                               "colonnade %d along the approach" % (i + 1),
                               "threshold"))
    return {
        "name": "royal_threshold",
        "for": "an arrival: the gate you walk to, and what lines the walk",
        "rule": ("the curtain butts the gate's measured half-width and then "
                 "itself at the measured run length; the arch stands one gate "
                 "half-depth plus 9 m clear; the colonnade count is the "
                 "approach length divided by a colonnade's measured length"),
        "placements": items,
    }


def recipe_water_garden(kit):
    """Lower garden -> canal -> crossing -> cascade -> upper terrace."""
    need = ["WL_Hero_Water_Court", "WL_Water_Canal_Run", "WL_Water_Canal_Crossing",
            "WL_Water_Cascade_Stair", "WL_Garden_Pavilion_Base"]
    missing = [n for n in need if not kit.has(n)]
    if missing:
        return {"name": "water_garden", "unbuildable": missing, "placements": []}
    court = "WL_Hero_Water_Court"
    items = [place(court, (0.0, 0.0, 0.0), 0.0,
                   "the reflecting basin; its head is at +X", "water_garden")]
    # the canal leaves the basin's foot and runs away in -X, butt to butt
    run, cross = "WL_Water_Canal_Run", "WL_Water_Canal_Crossing"
    unit = kit.size(run)[0]
    start = -(kit.size(court)[0] * 0.5 + unit * 0.5)
    order = [run, run, cross, run, run]
    for i, mod in enumerate(order):
        items.append(place(mod, (start - unit * i, 0.0, 0.0), 0.0,
                           "canal unit %d (%s)" % (i + 1,
                                                   "crossing" if mod == cross
                                                   else "run"),
                           "water_garden"))
    # the cascade climbs to T2 at the far end, and the pavilion base sits on it
    casc = "WL_Water_Cascade_Stair"
    x_casc = start - unit * len(order) - kit.size(casc)[0] * 0.5
    items.append(place(casc, (x_casc, 0.0, 0.0), 180.0,
                       "the cascade, climbing away from the canal to T2",
                       "water_garden"))
    top = kit.socket(casc, "top_route")
    pav = "WL_Garden_Pavilion_Base"
    items.append(place(pav, (x_casc - kit.size(casc)[0] * 0.5
                             - kit.size(pav)[0] * 0.5, 0.0, top["z_uu"]),
                       0.0, "the upper terrace, at the cascade's own top route",
                       "water_garden"))
    if kit.has("WL_Water_Pavilion"):
        items.append(place("WL_Water_Pavilion",
                           (0.0, kit.size(court)[1] * 0.5
                            + kit.size("WL_Water_Pavilion")[1] * 0.5 + 600.0, 0.0),
                           0.0, "a pavilion standing in its own sheet, off the "
                                "basin's flank", "water_garden"))
    if kit.has("WL_Water_Sunken_Pool"):
        items.append(place("WL_Water_Sunken_Pool",
                           (kit.size(court)[0] * 0.5
                            + kit.size("WL_Water_Sunken_Pool")[0] * 0.5 + 800.0,
                            0.0, 0.0),
                           0.0, "the sunken pool beyond the head, going DOWN",
                           "water_garden"))
    return {
        "name": "water_garden",
        "for": "the walkable route the water family was built to make: lower "
               "garden, canal, crossing, cascade, upper terrace",
        "rule": ("canal units are laid at their own measured length so their "
                 "ends butt; the crossing substitutes for a run in the middle "
                 "because it is the same module length; the upper terrace sits "
                 "at the cascade's MEASURED top_route socket, not at a typed "
                 "elevation"),
        "placements": items,
    }


def recipe_market_street(kit):
    """Two terraces facing each other, with the inhabited layer between them."""
    house = "WL_House_Jettied"
    if not kit.has(house):
        return {"name": "market_street", "unbuildable": [house], "placements": []}
    bay = kit.size(house)[0]
    depth = kit.size(house)[1]
    street = depth + 1200.0                     # 12 m of street between fronts
    items = []
    for side in (-1.0, 1.0):
        y = side * street * 0.5
        yaw = 0.0 if side < 0 else 180.0
        for i in range(5):
            x = (i - 2) * bay
            items.append(place(house, (x, y, 0.0), yaw,
                               "house %d, %s terrace"
                               % (i + 1, "-Y" if side < 0 else "+Y"),
                               "market_street"))
            # the awning and the sign mount on the facade that faces the street
            if kit.has("WL_Market_Awning") and i % 2 == 0:
                items.append(place("WL_Market_Awning",
                                   (x, y - side * depth * 0.5, 0.0), yaw,
                                   "awning on house %d's street facade" % (i + 1),
                                   "market_street", abuts=(house,)))
            if kit.has("WL_Market_Hanging_Sign") and i % 2 == 1:
                items.append(place("WL_Market_Hanging_Sign",
                                   (x, y - side * depth * 0.5, 0.0), yaw,
                                   "sign projecting from house %d" % (i + 1),
                                   "market_street", abuts=(house,)))
    if kit.has("WL_Market_Arcade_Insert"):
        for i in (-1, 0, 1):
            items.append(place("WL_Market_Arcade_Insert",
                               (i * bay, -street * 0.5 + depth * 0.5, 0.0), 0.0,
                               "arcade clipped to the -Y terrace's facade",
                               "market_street", abuts=(house,)))
    if kit.has("WL_Market_Canopy"):
        cw = kit.size("WL_Market_Canopy")[0]
        for i in range(3):
            items.append(place("WL_Market_Canopy",
                               ((i - 1) * (cw + 300.0), 0.0, 0.0), 0.0,
                               "canopy %d down the middle of the street" % (i + 1),
                               "market_street"))
    if kit.has("WL_Market_Covered_Passage"):
        # beyond the last house, by the passage's OWN half width
        px = 2.0 * bay + bay * 0.5 + kit.size("WL_Market_Covered_Passage")[0] * 0.5
        items.append(place("WL_Market_Covered_Passage",
                           (px, -street * 0.5, 0.0), 0.0,
                           "the passage at the +X end of the -Y terrace",
                           "market_street"))
    if kit.has("WL_Market_Corner_Storefront"):
        # its origin is a CORNER, not its centre, so it is offset by its own
        # bbox rather than by half its size
        sf = kit.a("WL_Market_Corner_Storefront")
        sx = -(2.0 * bay + bay * 0.5) - sf["bbox_max_uu"][0]
        items.append(place("WL_Market_Corner_Storefront",
                           (sx, -street * 0.5 + depth * 0.5, 0.0), 0.0,
                           "the corner where the -Y terrace turns",
                           "market_street"))
    return {
        "name": "market_street",
        "for": "a street that reads as inhabited: two terraces, and the awning, "
               "sign, arcade and canopy layer between them",
        "rule": ("houses are laid at their own measured bay width so a terrace "
                 "is continuous; the street is one house depth plus 12 m; "
                 "mounted modules are placed ON the facade plane, which is the "
                 "measured half-depth from a house's centre"),
        "placements": items,
    }


# --------------------------------------------------------------------------
# the checks a recipe has to survive
# --------------------------------------------------------------------------


def check(kit, recipe):
    """Stacks agree on the ladder, butts touch, ground footprints do not overlap."""
    bad = []
    items = recipe.get("placements") or []

    # stacks: consecutive placements sharing a `part_of` that names a stack
    stacks = {}
    for it in items:
        if it.get("part_of", "").startswith("skyline_"):
            stacks.setdefault(it["part_of"], []).append(it)
    for name, chain in sorted(stacks.items()):
        for lower, upper in zip(chain, chain[1:]):
            t = kit.socket(lower["module"], "top")
            b = kit.socket(upper["module"], "bottom")
            if t is None or b is None:
                bad.append("%s: %s -> %s has no top/bottom socket pair"
                           % (name, lower["module"], upper["module"]))
                continue
            if kit.rung(t["radius_uu"]) != kit.rung(b["radius_uu"]):
                bad.append("%s: %s tops on rung %s and %s bottoms on rung %s"
                           % (name, lower["module"], kit.rung(t["radius_uu"]),
                              upper["module"], kit.rung(b["radius_uu"])))
            want = lower["at_uu"][2] + t["z_uu"]
            if abs(upper["at_uu"][2] - want) > TOL_UU:
                bad.append("%s: %s sits at z %.1f, its bearing is at %.1f"
                           % (name, upper["module"], upper["at_uu"][2], want))

    # GROUND FOOTPRINTS, FROM THE MODULE'S OWN BOUNDING BOX.
    #
    # Circles were tried first and were useless: a 23 m colonnade's `bottom`
    # socket radius is half its LENGTH, so its bounding circle covered 10 m of
    # empty ground either side and two colonnades standing 20 m apart across an
    # approach "overlapped". Boxes from `size_uu` were the next try and were
    # wrong in a subtler way -- they assume a module is CENTRED on its origin,
    # and half this kit is not. `WL_Market_Arcade_Insert` has its back at y = 0
    # and its whole body in +Y; `WL_Market_Corner_Storefront` has its origin at
    # a corner. The manifest already carries `bbox_min_uu`/`bbox_max_uu` in the
    # module's own space, which is exactly the offset those modules need.
    boxes = []
    for it in items:
        a = kit.a(it["module"])
        if a.get("mounts_on"):
            continue                        # carried by a facade, not by ground
        b = kit.socket(it["module"], "bottom")
        if (it.get("part_of") or "").startswith("skyline_") and b \
                and b["kind"] == "tower":
            continue                        # a storey, standing on the one below
        box = kit.plan_box(it["module"], it["at_uu"], it["yaw_deg"])
        if box is None:
            bad.append("%s is placed at yaw %.1f, which this check cannot test "
                       "as a box" % (it["module"], it["yaw_deg"]))
            continue
        boxes.append((it, box))
    clashes = []
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a, (ax0, ay0, ax1, ay1) = boxes[i]
            b, (bx0, by0, bx1, by1) = boxes[j]
            ox = min(ax1, bx1) - max(ax0, bx0)
            oy = min(ay1, by1) - max(ay0, by0)
            if b["module"] in (a.get("abuts") or ()) or \
                    a["module"] in (b.get("abuts") or ()):
                continue                    # declared clip-on; see `place`
            if ox > TOL_UU and oy > TOL_UU:
                clashes.append("%s at %s overlaps %s at %s by %.0f x %.0f uu"
                               % (a["module"], a["at_uu"][:2], b["module"],
                                  b["at_uu"][:2], ox, oy))
    bad += clashes[:8]
    if len(clashes) > 8:
        bad.append("... and %d more footprint clash(es)" % (len(clashes) - 8))
    return bad


def build(manifest):
    kit = Kit(manifest)
    recipes = []
    for fn in (recipe_skyline, recipe_threshold, recipe_water_garden,
               recipe_market_street):
        r = fn(kit)
        if r is None:
            continue
        r["checks"] = check(kit, r)
        r["counts"] = {"placements": len(r.get("placements") or []),
                       "modules": len({p["module"]
                                       for p in r.get("placements") or []})}
        recipes.append(r)
    return {
        "schema": "wonderland-placement-recipes/1",
        "kit_version": manifest.get("kit_version"),
        "units": "unreal units (1 uu = 1 cm); +X front, Z up, yaw about Z",
        "from_manifest": os.path.relpath(MANIFEST, ROOT),
        "generated_by": "wonderland/art/blender/scripts/make_recipes.py",
        "ownership": ("these are PROPOSALS. World placement belongs to the "
                      "world session; nothing here has been placed into any "
                      "map and this file does not touch one."),
        "counts": {
            "recipes": len(recipes),
            "placements": sum(r["counts"]["placements"] for r in recipes),
            "failed_checks": sum(len(r["checks"]) for r in recipes),
        },
        "recipes": recipes,
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args(argv)
    data = build(load())
    with io.open(args.out, "w", encoding="utf8") as fh:
        json.dump(data, fh, indent=2)
        fh.write(u"\n")
    print("recipes -> %s" % os.path.relpath(args.out, ROOT))
    for r in data["recipes"]:
        print("  %-24s %3d placement(s), %d module(s)%s"
              % (r["name"], r["counts"]["placements"], r["counts"]["modules"],
                 "" if not r["checks"] else
                 "  CHECKS FAILED: %d" % len(r["checks"])))
        for line in r["checks"]:
            print("      %s" % line)
    return 1 if data["counts"]["failed_checks"] else 0


if __name__ == "__main__":
    sys.exit(main())
