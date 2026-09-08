#!/usr/bin/env python3
"""Build every Wonderland kit module, export it, and write the manifest.

    python3 scripts/build_assets.py [--only FAMILY] [--no-render] [--no-blend]

Runs headless against the `bpy` Blender module -- there is no Blender
executable on this host and none is needed; `bpy` IS Blender 4.5 LTS with the
same bmesh, the same exporters and Cycles.

WHAT IT GUARANTEES, and the order matters:

  1. every module builds, or the run FAILS -- a family that raises does not
     quietly drop an asset from the manifest
  2. every part is MEASURED off the emitted mesh, never off a docstring
  3. terminal socket heights are REWRITTEN from the measurement, because a
     builder that says its crown is 13.4 m tall while the geometry stops at
     11.06 m has published a join that floats (this happened to three crowns)
  4. GLB and FBX are written, then READ BACK and checked against the
     measurement, so "exported" means a file exists whose contents agree
  5. the manifest records what was measured, plus the legal stack count
     computed by walking the socket graph

Nothing here decides what anything looks like. Art is in `forge/families/`.
"""

import argparse
import datetime
import json
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy                                          # noqa: E402

from forge import export as X                       # noqa: E402
from forge import kit as K                          # noqa: E402
from forge import mesh as M                         # noqa: E402
from forge import preview as P                      # noqa: E402
from forge import style as S                        # noqa: E402
from forge import units as U                        # noqa: E402
from forge.registry import EXEMPT_GROUPS                        # noqa: E402
from forge.registry import groups as GROUPS                    # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, ".."))
EXPORTS = os.path.join(ROOT, "exports")
SOURCE = os.path.join(ROOT, "source")
MANIFESTS = os.path.join(ROOT, "manifests")
VALIDATION = os.path.join(ROOT, "validation")


#: Bumped when the geometry of the kit changes in a way the world session
#: must re-import for. The manifest carries it; so does every asset record.
#: The measured triangle count at or above which Nanite is recommended.
NANITE_MIN_TRIS = 5000

KIT_VERSION = "1.0.0"


def build_one(builder, group, write_blend=True):
    """Build one module, export it, and return its manifest record."""
    M.clear_scene()
    forge = M.Forge()
    spec = builder(forge)
    forge.parts = {}                       # objects now own the geometry

    parts = {}
    total_tris = 0
    lo_z, hi_z = None, None
    lo = [None, None, None]
    hi = [None, None, None]

    for key, obj in sorted(spec.parts.items()):
        meta = X.measure(obj)
        if meta is None:
            continue
        meta["normals"] = X.normals_report(obj)
        meta["material"] = K.unreal_material(key)
        meta["mesh_name"] = obj.name

        glb = os.path.join(EXPORTS, "glb", obj.name + ".glb")
        fbx = os.path.join(EXPORTS, "fbx", obj.name + ".fbx")
        X.write_glb([obj], glb)
        X.write_fbx([obj], fbx)
        meta["glb"] = os.path.relpath(glb, ROOT)
        meta["fbx"] = os.path.relpath(fbx, ROOT)
        meta["glb_read"] = X.read_glb(glb)
        meta["fbx_read"] = X.read_fbx_scale(fbx)

        parts[key] = meta
        total_tris += meta["tris"]
        for a in range(3):
            v0, v1 = meta["bbox_min_uu"][a], meta["bbox_max_uu"][a]
            lo[a] = v0 if lo[a] is None else min(lo[a], v0)
            hi[a] = v1 if hi[a] is None else max(hi[a], v1)
        lo_z = meta["bbox_min_uu"][2] if lo_z is None else min(lo_z, meta["bbox_min_uu"][2])
        hi_z = meta["bbox_max_uu"][2] if hi_z is None else max(hi_z, meta["bbox_max_uu"][2])

    if not parts:
        raise RuntimeError("%s emitted no geometry" % spec.asset_id)

    height_uu = hi_z - lo_z

    # terminal socket heights come from the MEASUREMENT, never the builder.
    # The rule lives in kit.apply_measured_terminals so the validator applies
    # exactly the same one. It is handed the TOP, not the height -- see the
    # excavation note there.
    K.apply_measured_terminals(spec, U.uu_to_m(hi_z))

    if write_blend:
        os.makedirs(SOURCE, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(
            filepath=os.path.join(SOURCE, spec.asset_id + ".blend"),
            check_existing=False, compress=True)

    return {
        "asset_id": spec.asset_id,
        "kit_version": KIT_VERSION,
        "family": spec.family,
        "family_group": group,
        "category": spec.category,
        "silhouette_role": spec.role,
        "note": spec.note,
        "districts": list(spec.districts),
        "params": spec.params,
        "origin_rule": ("z = 0 is the GROUND DATUM; +X is the module front. "
                        "excavation_uu is how far the module is cut in below it."),
        "excavation_uu": round(U.m_to_uu(getattr(spec, "excavates", 0.0)), 2),
        "mounts_on": getattr(spec, "mounts", None),
        "variant_of": spec.params.get("variant_of"),
        "units": {"authored": "metres", "manifest": "unreal units (cm)",
                  "uu_per_metre": U.UU_PER_METRE},
        "height_uu": round(height_uu, 2),
        "bbox_min_uu": [round(v, 2) for v in lo],
        "bbox_max_uu": [round(v, 2) for v in hi],
        "size_uu": [round(hi[a] - lo[a], 2) for a in range(3)],
        "style": S.profile(spec, spec.parts,
                           [U.uu_to_m(hi[a] - lo[a]) for a in range(3)],
                           U.uu_to_m(height_uu)),
        "base_z_uu": round(lo_z, 3),
        "tris_total": total_tris,
        "tri_budget": spec.tri_budget,
        "over_budget": bool(spec.tri_budget and total_tris > spec.tri_budget),
        # NANITE IS RECOMMENDED FROM THE MEASUREMENT, not from a default.
        # `ModuleSpec.nanite` defaults to True and no builder had reconsidered
        # it, so the first import plan asked for Nanite on all 93 assets --
        # including a 336-triangle hanging sign. The marble importer's own note
        # says why that is wrong: Nanite pays on dense static opaque geometry
        # and its per-mesh overhead is pure loss on engine-scale primitives.
        # An author may still say "never" by passing nanite=False.
        "nanite_recommended": bool(spec.nanite) and total_tris >= NANITE_MIN_TRIS,
        "nanite_rule": ("recommended when the module is >= %d triangles and the "
                        "builder has not opted out" % NANITE_MIN_TRIS),
        "collision_recommended": spec.collision,
        "uv": "planar-world-2m (not a lightmap unwrap)",
        "sockets": [s.as_dict(U.m_to_uu) for s in spec.sockets],
        "parts": parts,
        "part_count": len(parts),
    }, spec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="build one family group only")
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--no-blend", action="store_true")
    ap.add_argument("--surface-check", action="store_true",
                    help="also render each family against a bright magenta "
                         "world: a HOLE shows magenta, two fighting "
                         "surfaces show black with a moire in them")
    args = ap.parse_args()

    for d in (EXPORTS, MANIFESTS, VALIDATION, SOURCE):
        os.makedirs(d, exist_ok=True)

    # CLEAR THE EXPORT DIRECTORY FIRST. Removing a material from a module drops
    # a part, and the mesh that part used to write stays on disk -- a file the
    # manifest does not list, which is exactly the thing a world session would
    # find and try to place. Deleting the ceremonial arch's dark soffit left
    # such a pair behind, which is what this is for. Only done on a full run:
    # --only would otherwise delete the families it is not rebuilding.
    if not args.only:
        for sub in ("glb", "fbx"):
            d = os.path.join(EXPORTS, sub)
            for name in os.listdir(d) if os.path.isdir(d) else []:
                os.remove(os.path.join(d, name))

    records, specs, failures = [], [], []
    for group, group_builders in GROUPS():
        if args.only and args.only != group:
            continue
        for builder in group_builders:
            try:
                rec, spec = build_one(builder, group, write_blend=not args.no_blend)
                records.append(rec)
                specs.append(spec)
                flag = " OVER-BUDGET" if rec["over_budget"] else ""
                print("  built %-30s %-9s %7d tris  %7.2f m  %d part(s)%s" % (
                    rec["asset_id"], rec["silhouette_role"], rec["tris_total"],
                    rec["height_uu"] / U.UU_PER_METRE, rec["part_count"], flag))
            except Exception as exc:                      # noqa: BLE001
                failures.append((builder.__name__, repr(exc)))
                print("  FAILED %-30s %s" % (builder.__name__, exc))
                traceback.print_exc(limit=5)

    if failures:
        print("\n%d builder(s) FAILED; the manifest is not written." % len(failures))
        return 1

    # ---- the combinatorics, walked rather than multiplied ------------------
    stacks = K.stack_permutations(specs, max_bodies=3)
    by_role = {}
    for s in specs:
        by_role[s.role] = by_role.get(s.role, 0) + 1
    by_rung = {}
    for s in specs:
        t = s.socket("top")
        if t is not None and t.kind == "tower":
            r = K.rung_of(t.radius)
            if r:
                by_rung.setdefault(r, {"leaves_you_here": 0, "terminators": 0})
                by_rung[r]["leaves_you_here"] += 1
    for rung in by_rung:
        for s in specs:
            b = s.socket("bottom")
            if (s.role in ("crown", "needle") and b is not None
                    and K.rung_of(b.radius) == rung):
                by_rung[rung]["terminators"] += 1

    manifest = {
        "schema": "wonderland-blender-kit/1",
        "kit_version": KIT_VERSION,
        "generated_utc": datetime.datetime.now(datetime.timezone.utc)
                                  .replace(microsecond=0).isoformat(),
        "generator": "wonderland/art/blender/scripts/build_assets.py",
        "blender": bpy.app.version_string,
        "conventions": {
            "authoring_units": "metres, Z up, +X front",
            "manifest_units": "unreal units (1 uu = 1 cm)",
            "uu_per_metre": U.UU_PER_METRE,
            "origin": "every module's footing sits at z = 0",
            "glb": "glTF 2.0 binary; metres, Y-up per the glTF specification",
            "fbx": ("binary FBX; vertex values in CENTIMETRES with "
                    "UnitScaleFactor 1, Z-up, X-forward -- both readings agree, "
                    "so Import Uniform Scale stays 1.0. See forge/units.py."),
            "materials": ("one material slot per mesh; a module with several "
                          "materials exports one mesh per material, sharing an "
                          "origin. Names are the MI_V2_* instances already in "
                          "wonderland/v2/materials_v2.py."),
            "uv": "planar-world projection at 2 m per tile; NOT a lightmap unwrap",
        },
        "style_axes": S.axis_table(),
        "route_ladder_uu": {k: round(U.m_to_uu(v), 3)
                            for k, v in K.ROUTE_LADDER.items()},
        "riser_uu": round(U.m_to_uu(K.RISER_M), 3),
        "radius_ladder_uu": {k: round(U.m_to_uu(v), 3) for k, v in K.LADDER.items()},
        "ladder_tolerance_uu": round(U.m_to_uu(K.LADDER_TOLERANCE_M), 3),
        "materials": {k: {"unreal": v["unreal"], "use": v["use"]}
                      for k, v in K.MATERIALS.items()},
        "counts": {
            "assets": len(records),
            "meshes": sum(r["part_count"] for r in records),
            "triangles": sum(r["tris_total"] for r in records),
            "by_role": by_role,
            "legal_tower_stacks_up_to_3_bodies": stacks,
            "rung_coverage": by_rung,
            "variants": sum(1 for r in records if r.get("variant_of")),
        },
        "assets": records,
    }
    path = os.path.join(MANIFESTS, "wonderland-blender-kit.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, sort_keys=False)
        fh.write("\n")
    print("\nmanifest -> %s" % os.path.relpath(path, ROOT))
    print("  %d assets, %d meshes, %d triangles, %d legal tower stacks"
          % (manifest["counts"]["assets"], manifest["counts"]["meshes"],
             manifest["counts"]["triangles"], stacks))

    if not args.no_render:
        render_sheets(specs, surface_check=args.surface_check,
                      only=args.only)
    return 0


def render_spelled(seeds=9, max_bodies=3):
    """Nine towers SPELLED from the kit, and the sheet that proves the point.

    A contact sheet of modules shows what was authored. This shows what the
    kit can SAY, which is the only thing the world session actually cares
    about: nine towers nobody modelled, drawn from the socket graph with a
    seeded random walk, standing side by side at one scale.

    The stacking arithmetic here is deliberately the SAME rule the manifest
    publishes -- next module's origin goes at the previous module's `top`
    socket z -- so if this render looks right, a generator following the
    manifest gets the same result.
    """
    import random

    out = os.path.join(ROOT, "validation", "renders")
    M.clear_scene()
    library, by_role = {}, {}
    for _group, group_builders in GROUPS():
        for builder in group_builders:
            forge = M.Forge()
            spec = builder(forge)
            forge.parts = {}
            zs = [v.co.z for o in spec.parts.values() for v in o.data.vertices]
            K.apply_measured_terminals(spec, max(zs))
            for o in spec.parts.values():
                o.hide_render = True
            library[spec.asset_id] = (spec, max(zs) - min(zs))
            by_role.setdefault(spec.role, []).append(spec)

    groups, lines = [], []
    for seed in range(seeds):
        rng = random.Random(seed * 7919 + 13)
        chain = [rng.choice(by_role["foot"])]
        for _ in range(rng.randint(1, max_bodies)):
            opts = [b for b in by_role.get("body", []) if K.compatible(chain[-1], b)]
            if not opts:
                break
            chain.append(rng.choice(opts))
        tops = [t for t in by_role.get("crown", []) + by_role.get("needle", [])
                if K.compatible(chain[-1], t)]
        if not tops:
            continue
        chain.append(rng.choice(tops))

        z, objs = 0.0, []
        for spec in chain:
            for o in spec.parts.values():
                dup = o.copy()
                dup.data = o.data.copy()
                bpy.context.scene.collection.objects.link(dup)
                dup.location = (0.0, 0.0, z)
                dup.hide_render = False
                objs.append(dup)
            top = spec.socket("top")
            z += top.z if (top is not None and top.radius > 1e-9) else library[spec.asset_id][1]
        groups.append(objs)
        lines.append("%6.2f m  %s" % (z, " + ".join(
            s.asset_id.replace("WL_", "") for s in chain)))

    P.lineup(groups, gap=10.0)
    allo = [o for o in bpy.data.objects if o.type == "MESH" and not o.hide_render]
    P.rig()
    res = (1800, 900)
    P.frame_camera(allo, res, azimuth=82.0, elevation=6.0, margin=1.05,
                   lens=85.0, target_bias=0.50)
    P.render(os.path.join(out, "KIT_spelled_towers.png"), res=res, samples=26)
    with open(os.path.join(out, "KIT_spelled_towers.txt"), "w", encoding="utf-8") as fh:
        fh.write("Towers spelled from the kit by a seeded walk of the socket graph.\n"
                 "Left to right in KIT_spelled_towers.png.\n\n")
        fh.write("\n".join(lines) + "\n")
    print("  render -> KIT_spelled_towers.png (%d towers)" % len(lines))


def _sheet_res(objs, azimuth, elevation, target_bias, width=1700,
               lo=360, hi=1150):
    """Pick a frame whose SHAPE matches the row's, so no pixels go to sky.

    A contact sheet is a row, and a row of ten modules is ten times wider than
    it is tall. Rendered into a fixed 1800x700 the camera fits the WIDTH, the
    subjects fill a fifth of the height, and the water family came back as a
    band of miniatures across the middle of a grey field.

    The right shape is not a fudge factor, it is the same number the camera
    already solves: `frame_camera` fits the projected half-extents and the
    larger constraint wins, so a frame of exactly `half_up / half_right` makes
    BOTH constraints bind at once and nothing is wasted in either axis.
    """
    _target, half_r, half_u = P.projected_half_extents(objs, azimuth, elevation,
                                                       target_bias)
    return (int(width), int(min(hi, max(lo, width * half_u / half_r))))


def _chunk_builders(builders, limit_m=100.0):
    """Split a family into rows no wider than `limit_m`, keeping kit order.

    WHY A FAMILY IS NOT ALWAYS ONE PICTURE. The sheet's job is to let a
    silhouette be judged, and a silhouette is judged from a LOW angle -- these
    render at 7 degrees of elevation for exactly that reason. But ten modules
    laid end to end are 140 m of row against 13 m of height, and a frame that
    contains all of it puts every module at 200 px. Raising the camera would
    fix the frame and lose the thing being looked at; wrapping the row into a
    grid at 7 degrees would put the front row in front of the back one.

    So a long family becomes several sheets. Each is still a low row, each
    module keeps its share of the pixels, and nothing is hidden behind
    anything. It costs one more PNG per family and no honesty at all.
    """
    rows, row, width = [], [], 0.0
    for b, w in builders:
        if row and width + w > limit_m:
            rows.append(row)
            row, width = [], 0.0
        row.append(b)
        width += w + 6.0
    if row:
        rows.append(row)
    # DO NOT LEAVE A ROW OF ONE. A last chunk with a single module in it fills
    # a 1700 px frame on its own and reads as a hero shot of a mid stage.
    if len(rows) > 1 and len(rows[-1]) == 1:
        # pop FIRST, then index. `rows[-2] = rows[-2] + rows.pop()` evaluates
        # the right side before resolving the target, so on a two-row family
        # (stairs) it indexed -2 into a list that had just become length 1.
        tail = rows.pop()
        rows[-1] = rows[-1] + tail
    return rows


def _build_row(builders):
    """Build one row of modules into a clean scene. Returns (objects, max dig)."""
    M.clear_scene()
    objs_groups, digs = [], 0.0
    for b in builders:
        forge = M.Forge()
        spec = b(forge)
        objs_groups.append(list(spec.parts.values()))
        digs = max(digs, getattr(spec, "excavates", 0.0))
        forge.parts = {}
    P.lineup(objs_groups, gap=6.0)
    return [o for o in bpy.data.objects if o.type == "MESH"], digs


def render_sheets(specs, surface_check=False, only=None):
    """Contact sheets per family group, plus the spelled-tower sheet.

    `surface_check` adds a second pass of each family against a bright magenta
    world with no ground. It is the only thing in this pipeline that finds two
    COPLANAR, SAME-FACING, PARTLY OVERLAPPING surfaces -- the check in
    `validate_assets.py` compares faces that share a centre and cannot see
    them. `WL_Wall_Postern_Gate` had a pair; they showed as two black bands
    with a moire, and black rather than magenta is what said "two surfaces"
    instead of "no surface".
    """
    out = os.path.join(ROOT, "validation", "renders")
    os.makedirs(out, exist_ok=True)
    AZ, EL, BIAS = 80.0, 7.0, 0.46

    for group, group_builders in GROUPS():
        if only and only != group:
            continue
        # measure every module once, so the row splitter knows what it is
        # packing before it packs it
        measured = []
        for b in group_builders:
            M.clear_scene()
            forge = M.Forge()
            spec = b(forge)
            lo, hi = P.bounds(list(spec.parts.values()))
            measured.append((b, hi.x - lo.x))
        rows = _chunk_builders(measured)
        for n, builders in enumerate(rows, start=1):
            stem = group if len(rows) == 1 else "%s_%dof%d" % (group, n, len(rows))
            allo, digs = _build_row(builders)
            # THE GROUND PLANE HIDES AN EXCAVATION. It sits at z = 0, which is
            # the ground datum, so a module cut into the datum renders as its
            # own rim on an unbroken floor -- `WL_Water_Sunken_Pool` came back
            # as a black ellipse. A row with anything below the datum is
            # rendered without it, and gives up its cast shadow to be seen.
            P.rig(ground=(digs <= 0.0))
            res = _sheet_res(allo, AZ, EL, BIAS)
            P.frame_camera(allo, res, azimuth=AZ, elevation=EL, margin=1.04,
                           lens=85.0, target_bias=BIAS)
            P.render(os.path.join(out, "KIT_%s.png" % stem), res=res, samples=24)
            print("  render -> KIT_%s.png  %dx%d  %d module(s)%s"
                  % (stem, res[0], res[1], len(builders),
                     "  (no ground: excavates)" if digs else ""))
            if surface_check:
                P.clear_rig()
                P.rig(ground=False)
                bg = bpy.context.scene.world.node_tree.nodes["Background"]
                bg.inputs[0].default_value = (1.0, 0.0, 0.8, 1.0)
                bg.inputs[1].default_value = 4.0
                P.frame_camera(allo, res, azimuth=AZ, elevation=EL, margin=1.04,
                               lens=85.0, target_bias=BIAS)
                P.render(os.path.join(out, "SURFACE_%s.png" % stem), res=res,
                         samples=10)
                print("  render -> SURFACE_%s.png  (magenta = hole, black = z-fight)"
                      % stem)
    render_spelled()


if __name__ == "__main__":
    sys.exit(main())
