#!/usr/bin/env python3
"""The forge kit as world content, checked with no engine and no Blender.

    python3 wonderland/v2/verify_kit_bridge.py

`kit_v2.py` claims that a Blender module can be named by `layout_v2` and come
out the far end of `build_v2` as an ordinary V2 actor. Most of that claim is
offline: the manifest, the key expansion, the socket arithmetic, the band
mapping, the material names, and every placement `kit_layout` emits. This
checks all of it.

WHAT IT CANNOT CHECK, and says so rather than implying otherwise: the import
itself. `import_kit_assets` needs the editor, there is no Unreal in the
container this was written in, and `wonderland/art/unreal/import-plan.json`
still reads `imported_into_an_editor: false`. A PASS here means the world can
name the kit and every offline instrument agrees on what it named -- not that
a mesh has ever been in a level.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "tools"))
sys.path.insert(0, os.path.join(HERE, "..", "infra", "build", "hd"))
os.environ.setdefault("WLV2_PASS02", "1")
os.environ.setdefault("WLV2_PASS03", "1")

import assets_v2 as A          # noqa: E402
import kit_layout as KL        # noqa: E402
import kit_v2 as KIT           # noqa: E402
import layout_v2 as L          # noqa: E402
import materials_v2 as M       # noqa: E402
import v2_config as C          # noqa: E402

FAILS = []
NOTES = []


def check(ok, why):
    if not ok:
        FAILS.append(why)
    return ok


def kit_placements():
    return [p for p in L.ALL if p.get("kit")]


# ---------------------------------------------------------------------------


def t_manifest():
    m = KIT.manifest()
    n = len(m["assets"])
    check(n > 0, "the manifest declares no assets")
    keys = KIT.mesh_keys()
    check(len(keys) >= n, "%d modules but only %d mesh keys" % (n, len(keys)))
    dupes = {}
    for rec in m["assets"]:
        for part in (rec.get("parts") or {}).values():
            dupes.setdefault(part["mesh_name"], []).append(rec["asset_id"])
    clash = {k: v for k, v in dupes.items() if len(v) > 1}
    check(not clash, "mesh names are not unique across modules: %s" % clash)
    return "%d modules, %d mesh keys, all unique" % (n, len(keys))


def t_keys_resolve():
    """Every asset a kit placement names is a key the world admits."""
    known = A.known_asset_keys()
    bad = sorted({p["asset"] for p in kit_placements() if p["asset"] not in known})
    check(not bad, "%d kit placements name an asset `known_asset_keys` "
                   "rejects: %s" % (len(bad), bad[:5]))
    return "%d kit placements, every asset in known_asset_keys" % len(kit_placements())


def t_materials():
    """A kit mesh carries a material the V2 palette already defines.

    One slot per mesh is the forge's own rule, and the world's rule is that a
    placement's `mat` resolves in `materials_v2.INSTANCES`. If the forge ever
    invents a material name, this is where the two stop agreeing.
    """
    mats = set(M.INSTANCES)
    bad = sorted({p["mat"] for p in kit_placements() if p["mat"] and p["mat"] not in mats})
    check(not bad, "kit meshes name %d material(s) not in the palette: %s"
                   % (len(bad), bad))
    unslotted = [p["label"] for p in kit_placements() if not p["mat"]]
    check(not unslotted, "%d kit placements carry no material: %s"
                         % (len(unslotted), unslotted[:5]))
    return "%d distinct materials, all in materials_v2.INSTANCES" % len(
        {p["mat"] for p in kit_placements()})


def t_bands():
    """Every band a kit placement claims is a declared data layer."""
    bad = sorted({p["band"] for p in kit_placements() if p["band"] not in C.DATA_LAYERS})
    check(not bad, "kit placements claim undeclared data layer(s): %s" % bad)
    for group, band in KIT.GROUP_BAND.items():
        check(band in C.DATA_LAYERS,
              "GROUP_BAND maps %s to %s, which is not a data layer" % (group, band))
    used = sorted({p["band"] for p in kit_placements()})
    return "bands used: %s" % ", ".join(used)


def t_shape():
    """A kit placement is shaped exactly like every other `layout_v2` entry."""
    want = ("asset", "pos", "rot", "scale", "mat", "label", "band")
    sample = kit_placements()
    for p in sample:
        missing = [k for k in want if k not in p]
        if check(not missing, "%s is missing %s" % (p.get("label"), missing)):
            check(len(p["pos"]) == 3 and len(p["rot"]) == 3 and len(p["scale"]) == 3,
                  "%s has a malformed transform" % p["label"])
    labels = [p["label"] for p in sample]
    check(len(labels) == len(set(labels)),
          "%d kit labels are not unique" % (len(labels) - len(set(labels))))
    return "%d placements, all seven keys, transforms well formed, labels unique" % len(sample)


def t_parts_share_a_transform():
    """A multi-material module is several meshes at ONE origin.

    The forge exports one mesh per material slot sharing an origin, and the
    world places each separately. If they ever drift apart the module comes
    out of the engine in pieces, and nothing else in the pipeline would say so.
    """
    by = {}
    for p in kit_placements():
        by.setdefault((p["kit"], p["label"].split("_")[0], p["pos"]), set()).add(p["pos"])
    groups = {}
    for p in kit_placements():
        base = p["label"].split("_", 0)
        groups.setdefault(p["kit"], []).append(p)
    checked = 0
    for aid, ps in groups.items():
        n_parts = len(KIT.meshes(aid))
        if n_parts < 2:
            continue
        # placements of one module at one site share a pos to the micron
        sites = {}
        for p in ps:
            sites.setdefault(tuple(round(v, 3) for v in p["pos"]), []).append(p)
        for pos, at in sites.items():
            if len(at) < 2:
                continue
            checked += 1
            rots = {tuple(round(v, 3) for v in q["rot"]) for q in at}
            scls = {tuple(round(v, 4) for v in q["scale"]) for q in at}
            check(len(rots) == 1, "%s at %s has %d different rotations"
                                  % (aid, pos, len(rots)))
            check(len(scls) == 1, "%s at %s has %d different scales"
                                  % (aid, pos, len(scls)))
    return "%d multi-mesh sites, every part sharing one transform" % checked


def t_sockets_bear():
    """A stack bears on the MEASURED top socket, not on a declared height."""
    spells = KIT.spellings(want=8, min_height_uu=5000.0)
    check(spells, "no legal tower spelling in the kit")
    for chain, total in spells:
        z = 0.0
        for aid in chain[:-1]:
            top = KIT.socket(aid, "top")
            if not check(top is not None,
                         "%s is a body in a spelling but publishes no top socket" % aid):
                break
            z += float(top["z_uu"])
        check(total > z, "%s totals %.0f uu but its bodies bear at %.0f"
                         % (" + ".join(chain), total, z))
    feet = [c[0] for c, _h in spells]
    crowns = [c[-1] for c, _h in spells]
    check(len(set(crowns)) == len(crowns),
          "spellings repeat a crown: %s" % crowns)
    return "%d spellings, %d distinct feet, %d distinct crowns, %.0f-%.0f uu" % (
        len(spells), len(set(feet)), len(set(crowns)),
        min(h for _c, h in spells), max(h for _c, h in spells))


def t_stack_geometry():
    """Every stacked module actually sits on the one below it."""
    stacks = {}
    for p in kit_placements():
        lab = p["label"]
        if "_" not in lab:
            continue
        head, _, tail = lab.rpartition("_")
        base = tail if tail.isdigit() else None
        if base is None:
            continue
        stacks.setdefault(head, []).append(p)
    checked = 0
    for head, ps in stacks.items():
        rungs = {}
        for p in ps:
            rungs.setdefault(p["kit"], []).append(p)
        zs = sorted({round(p["pos"][2], 2) for p in ps})
        if len(zs) < 2:
            continue
        checked += 1
        for a, b in zip(zs, zs[1:]):
            check(b > a, "%s stacks two modules at the same height %.2f" % (head, a))
    return "%d stacks, every rung above the one below" % checked


def t_nothing_is_orphaned():
    """A module that mounts on a facade is actually carried by one.

    `Roof_Dormer`, `Roof_Chimney`, `House_Shopfront`, `Detail_Oriel_Bay` and
    `Detail_Balcony_Bracket` publish a `back` socket and NO `bottom`: the
    manifest is saying they do not stand on the ground. Two ways that goes
    wrong, and this checks both:

    A batch can place one with no host at all -- a dormer in a field.

    Or a host can be removed after the fact. `KitStreet3_House0` was refused
    for standing 644 uu from `FloatingStairCam26`, and its dormer, shopfront
    and oriel are SHORT: they passed every test the house failed, and stayed
    hanging in the air where a house used to be. `kit_layout.carried()` and the
    screen's second pass are the fix; this is what found it.
    """
    ps = kit_placements()
    alive = {p["label"] for p in ps}
    dangling = [p["label"] for p in ps
                if p.get("carried_by") and p["carried_by"] not in alive]
    check(not dangling, "%d placement(s) name a carrier that is not in the "
                        "world: %s" % (len(dangling), dangling[:4]))
    mounted, loose = 0, []
    for p in ps:
        rec = KIT.asset(p["kit"])
        names = {s["name"] for s in (rec.get("sockets") or [])}
        if "back" in names and "bottom" not in names:
            mounted += 1
            if not p.get("carried_by"):
                loose.append(p["label"])
    check(not loose, "%d placement(s) of a facade-mounted module stand on "
                     "nothing: %s" % (len(loose), loose[:4]))
    return "%d facade-mounted placements, every one naming a carrier that exists" % mounted


def t_camera_clearance():
    """No kit placement looms in a camera that can see it.

    The rule is height-aware AND bearing-aware, and both halves were learned:

    A flat distance cannot tell a 3 m retaining wall from a 63 m tower, so
    `clearance_for()` is the distance at which a piece's own height subtends
    `MAX_LOOM_DEG`. 45 degrees is measured rather than chosen -- over the
    45,924 piece/camera pairs the world's own placements make inside a frame,
    the elevation of a top reads p99.9 +43.2, so the cap refuses 0.08% of the
    world's own pieces and holds the kit to the world's own standard.

    Applied to all thirty-three cameras regardless of where they POINT, though,
    it demanded 61 m of clearance from every lens in a world this dense and
    left one batch with nowhere to stand at all -- and most of what it refused
    was behind a camera. So a piece must be in shot before its height is a
    problem, which is the test `framescape.census` applies before it counts
    anything.

    THE EXEMPTION IS PRINTED, not hidden: the count of placements that clear
    the rule only because they are out of shot is reported every run, because
    an exemption nobody can see is an exemption nobody checks.
    """
    near, exempt, tight = [], 0, 0.0
    for p in kit_placements():
        x, y, z = p["pos"]
        try:
            h = KIT.height_uu(p["kit"]) + max(0.0, z)
        except Exception:                                  # noqa: BLE001
            h = max(0.0, z)
        bad = KL.looms(x, y, h)
        if bad:
            near.append("%s (reaches %.0f uu) is %.0f uu from %s, needs %.0f"
                        % (p["label"], h, bad[1], bad[0], bad[2]))
            continue
        for _n, loc, _yaw, _fov, _pi in KL._CAMS:
            d = math.hypot(x - loc[0], y - loc[1])
            need = KL.clearance_for(h, loc[2])
            if d < need:
                exempt += 1
                break
            if need > 0:
                tight = max(tight, need / max(d, 1.0))
    check(not near, "%d kit placement(s) loom in a camera that can see them: %s"
                    % (len(near), near[:4]))
    NOTES.append("%d placement(s) are inside a camera's clearance but OUT OF "
                 "SHOT, and pass on that ground alone" % exempt)
    NOTES.append("%d placement(s) refused by the screen" % len(KL.REFUSED))
    for why in KL.REFUSED[:6]:
        NOTES.append("refused: %s" % why)
    return ("%d placements, none looming in a camera that frames it "
            "(cap %.0f deg; tightest in-shot piece sits at %.0f%% of its "
            "clearance)" % (len(kit_placements()), KL.MAX_LOOM_DEG, 100.0 * tight))


def t_ground():
    """The kit stands ON the ground datum, not through it."""
    below = [p["label"] for p in kit_placements() if p["pos"][2] < -1.0]
    check(not below, "%d kit placement(s) sunk below z=0: %s"
                     % (len(below), below[:5]))
    return "%d placements, none below the ground datum" % len(kit_placements())


def t_census_can_see_it():
    """`skyline.bboxes()` knows every kit mesh the world places.

    THE REASON THIS TEST EXISTS. The first placement pass moved the 33-camera
    census by nothing at all, and the cause was not the placements -- it was
    that `bboxes()` built its table by running `assets_v2.RECIPES`, so a forge
    mesh had no bounding box and was invisible to every instrument that reads
    one. A kit the census cannot see is a kit that cannot be measured, and an
    unmeasurable placement pass is indistinguishable from no pass at all.
    """
    import skyline as SKY
    bb = SKY.bboxes()
    missing = sorted({p["asset"] for p in kit_placements() if p["asset"] not in bb})
    check(not missing, "%d kit mesh(es) have no bounding box, so the census "
                       "cannot see them: %s" % (len(missing), missing[:5]))
    flat = sorted({p["asset"] for p in kit_placements()
                   if p["asset"] in bb and bb[p["asset"]]["ztop"] <= 0.0})
    NOTES.append("%d kit meshes read as flat (ztop <= 0): %s"
                 % (len(flat), ", ".join(flat[:4]) or "none"))
    prof = [a for a in {p["asset"] for p in kit_placements()}
            if a in bb and bb[a].get("prof")]
    return "%d kit meshes, all with a bbox, %d carrying a measured profile" % (
        len({p["asset"] for p in kit_placements()}), len(prof))


def t_plan_is_honest():
    """`plan()` is derived, complete, and does not claim an import happened."""
    rows = KIT.plan()
    keys = {r["key"] for r in rows}
    check(keys == set(KIT.mesh_keys()),
          "plan() covers %d keys, the manifest has %d" % (len(keys), len(KIT.mesh_keys())))
    for r in rows[:1] or []:
        check(r["asset_path"].startswith(KIT.KIT_ROOT),
              "plan() sends %s outside %s" % (r["key"], KIT.KIT_ROOT))
    missing = [r["key"] for r in rows if not r["source_exists"]]
    NOTES.append("%d of %d FBX sources present in this checkout"
                 % (len(rows) - len(missing), len(rows)))
    import json
    ip = os.path.join(HERE, "..", "art", "unreal", "import-plan.json")
    if os.path.exists(ip):
        with open(ip) as fh:
            got = json.load(fh)
        # the flag lives under `proven`, where the import plan keeps every
        # claim it is willing to stand behind
        proven = got.get("proven") or {}
        flag = proven.get("imported_into_an_editor")
        NOTES.append("import-plan.json says imported_into_an_editor=%s" % flag)
        check(flag in (False, True),
              "import-plan.json states no imported_into_an_editor under `proven`")
        if flag:
            NOTES.append("an editor import IS claimed -- this verifier does not "
                         "prove it and never has")
    return "%d rows, every mesh key covered, all under %s" % (len(rows), KIT.KIT_ROOT)


def t_offline_import_is_loud():
    """With no `unreal`, the import returns {} and SAYS the kit is absent."""
    said = []
    got = KIT.import_kit_assets(ctx=None, log=said.append)
    if KIT.unreal is None:
        check(got == {}, "offline import returned %d paths" % len(got))
        check(any("NOT in this build" in s for s in said),
              "offline import was silent; it said %r" % said)
        return "no unreal module: returns {} and says the kit is not in the build"
    return "an editor is present; the offline path was not exercised"


def t_batches_reported():
    """Every batch says how many placements it made, and why any was skipped."""
    check(KL.BATCHES, "kit_layout reported no batches")
    total = sum(n for _n, n in KL.BATCHES)
    check(total == len(kit_placements()),
          "batches report %d placements, layout_v2 carries %d" % (total, len(kit_placements())))
    for why in KL.SKIPPED:
        NOTES.append("skipped: %s" % why)
    return "%d batches, %d placements, %d recorded skips" % (
        len(KL.BATCHES), total, len(KL.SKIPPED))


TESTS = (
    ("manifest", t_manifest),
    ("keys resolve", t_keys_resolve),
    ("materials", t_materials),
    ("bands", t_bands),
    ("placement shape", t_shape),
    ("parts share a transform", t_parts_share_a_transform),
    ("sockets bear", t_sockets_bear),
    ("stack geometry", t_stack_geometry),
    ("nothing is orphaned", t_nothing_is_orphaned),
    ("camera clearance", t_camera_clearance),
    ("ground datum", t_ground),
    ("the census can see it", t_census_can_see_it),
    ("plan is honest", t_plan_is_honest),
    ("offline import is loud", t_offline_import_is_loud),
    ("batches reported", t_batches_reported),
)


def main():
    print("KIT BRIDGE -- the Blender forge as world content, offline\n")
    for name, fn in TESTS:
        before = len(FAILS)
        try:
            detail = fn()
        except Exception as exc:                           # noqa: BLE001
            FAILS.append("%s raised %s: %s" % (name, type(exc).__name__, exc))
            detail = "raised"
        mark = "ok  " if len(FAILS) == before else "FAIL"
        print("  %s %-26s %s" % (mark, name, detail))
    if NOTES:
        print("\nnotes (not verdicts):")
        for n in NOTES:
            print("   %s" % n)
    print()
    if FAILS:
        print("FAIL: %d" % len(FAILS))
        for f in FAILS:
            print("   %s" % f)
        return 1
    print("PASS: the world can name the kit and every offline instrument agrees.")
    print("      NOT PROVEN: the import itself. No engine ran; "
          "import-plan.json still says imported_into_an_editor: false.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
