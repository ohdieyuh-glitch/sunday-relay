"""The Blender forge kit, as world content: one import, then ordinary placements.

WHAT THIS FILE IS FOR. `wonderland/art/blender` builds 101 modules with measured
sockets, one material slot per mesh, and a manifest that names an `MI_V2_*`
instance the V2 palette already defines. None of it was reachable from the
world, because the world places assets by KEY -- `Placer` looks a key up in the
dict `assets_v2.build_assets` returns, loads that path, and spawns or batches
it. A forge mesh had no key, so `layout_v2` could not name one.

This gives it one. `import_kit_assets(ctx)` imports the FBX the forge exported
and returns `{key: asset path}` in exactly the shape `build_assets` returns, so
`build_v2.py` merges the two dicts and every downstream thing -- batching,
materials, data layers, labels, the hierarchy audit, the walkable audit --
treats a forge module as an ordinary V2 asset. Nothing else in the pipeline
needed changing, which is the point.

THE KEY IS THE MESH NAME, NOT THE ASSET ID. A forge module with four materials
exports FOUR meshes sharing an origin, because `WonderlandInstancedBatch`
carries one MaterialPath per batch. The world's placement dict likewise carries
one `asset` and one `mat`. So `WL_Hero_Gate_Royal` is four placements at one
transform -- `WL_Hero_Gate_Royal`, `_gold`, `_glass`, `_roof` -- which is the
convention `assets_v2` already uses for `gatehouse_district`/`gatehouse_glass`.
`placements_for()` does that expansion from the manifest so no layout has to.

WHAT IS AND IS NOT PROVEN. `plan()` and everything above it runs with no engine
and is checked by `verify_kit_bridge.py`. `import_kit_assets` needs the editor
and HAS NOT RUN: there is no Unreal in the container this was written in, and
`wonderland/art/unreal/import-plan.json` still says
`imported_into_an_editor: false`. Every guard here is written the way
`marble/import-marble-world.py` writes them -- an option that does not apply is
LOGGED, never swallowed -- because a silently-skipped import is this project's
most repeated failure.
"""

import io
import json
import os

try:
    import unreal
except ImportError:                       # every offline path below works
    unreal = None

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
BLENDER_ROOT = os.path.join(REPO, "wonderland", "art", "blender")
MANIFEST = os.path.join(BLENDER_ROOT, "manifests", "wonderland-blender-kit.json")

CONTENT_ROOT = "/Game/WonderlandV2"
KIT_ROOT = CONTENT_ROOT + "/Kit"

#: family group -> the V2 data layer. Every value is in `v2_config.DATA_LAYERS`;
#: this invents no layer. It is the same table `art/unreal/import_kit.py` uses,
#: and it is duplicated rather than imported because that file lives outside the
#: v2 package and the world build must not depend on the art tree's layout.
GROUP_BAND = {
    "towers": "V2_Skyline", "roofscape": "V2_Skyline", "hero": "V2_Skyline",
    "thresholds": "V2_Castle", "civic": "V2_Castle", "walls": "V2_Castle",
    "variants": "V2_Castle",
    "stairs": "V2_Garden", "gardens": "V2_Garden", "water": "V2_Garden",
    "ground": "V2_Arrival",
    "market": "V2_Props", "details": "V2_Props",
}

_CACHE = {}


def manifest(path=MANIFEST):
    """The forge manifest, read once. Raises if it is not built."""
    if "manifest" not in _CACHE:
        if not os.path.exists(path):
            raise RuntimeError(
                "no forge manifest at %s -- run "
                "wonderland/art/blender/scripts/build_assets.py first" % path)
        with io.open(path, encoding="utf8") as fh:
            _CACHE["manifest"] = json.load(fh)
    return _CACHE["manifest"]


def index(path=MANIFEST):
    """asset_id -> the manifest record."""
    if "index" not in _CACHE:
        _CACHE["index"] = {a["asset_id"]: a for a in manifest(path)["assets"]}
    return _CACHE["index"]


def asset(asset_id):
    a = index().get(asset_id)
    if a is None:
        raise KeyError("%s is not in the forge kit" % asset_id)
    return a


def band_for(asset_id):
    return GROUP_BAND.get(asset(asset_id).get("family_group"), "V2_Props")


def destination(record):
    """`/Game/WonderlandV2/Kit/<group>`, variants in their own subfolder."""
    group = record.get("family_group") or "misc"
    if record.get("variant_of"):
        return "%s/%s/Weathered" % (KIT_ROOT, group)
    return "%s/%s" % (KIT_ROOT, group)


def meshes(asset_id):
    """[(key, material, part_key)] for one module, base mesh first.

    The base mesh keeps the module's own name and every other part is
    `<AssetId>_<part>`, which is the suffix shape `hierarchy.py`'s
    LANDMARK_RIDERS already knows how to ride rather than count twice.
    """
    rec = asset(asset_id)
    out = []
    for part_key, part in sorted((rec.get("parts") or {}).items()):
        out.append((part["mesh_name"], part["material"], part_key))
    out.sort(key=lambda t: (t[0] != asset_id, t[0]))
    return out


def mesh_keys(path=MANIFEST):
    """Every key a layout may name from the kit: one per MESH, not per module.

    The set `assets_v2.known_asset_keys` needs. Kept separate from `plan()`
    because that stats every FBX on disk to report `source_exists`, and the
    world's own gates ask this question 14,000 times in a run.
    """
    if "mesh_keys" not in _CACHE:
        keys = set()
        for rec in manifest(path)["assets"]:
            for part in (rec.get("parts") or {}).values():
                keys.add(part["mesh_name"])
        _CACHE["mesh_keys"] = keys
    return _CACHE["mesh_keys"]


def placements_for(asset_id, pos, rot=(0.0, 0.0, 0.0), scale=1.0, label=None,
                   band=None):
    """One module at one transform, expanded to one placement per MESH.

    Returns dicts in exactly `layout_v2`'s shape, so everything that walks
    `ALL` -- the builder, `walkable.py`, `region.py`, `hierarchy.py`,
    `framescape.py` -- sees ordinary placements.
    """
    rec = asset(asset_id)
    lab = label or asset_id
    b = band or band_for(asset_id)
    s = (float(scale), float(scale), float(scale)) if not isinstance(scale, tuple) \
        else tuple(float(v) for v in scale)
    out = []
    for i, (mesh_name, mat, part_key) in enumerate(meshes(asset_id)):
        out.append({
            "asset": mesh_name,
            "pos": (float(pos[0]), float(pos[1]), float(pos[2])),
            "rot": (float(rot[0]), float(rot[1]), float(rot[2])),
            "scale": s,
            "mat": mat,
            # THE RIDERS CARRY THE BASE LABEL PLUS THEIR PART. `hierarchy.py`
            # counts a landmark by its label prefix and rides the suffixed
            # meshes; naming them anything else would count one gate as four.
            "label": lab if i == 0 else "%s_%s" % (lab, part_key),
            "band": b,
            "kit": rec["asset_id"],
        })
    return out


def height_uu(asset_id):
    return float(asset(asset_id)["height_uu"])


def footprint_uu(asset_id):
    sz = asset(asset_id)["size_uu"]
    return max(float(sz[0]), float(sz[1]))


def socket(asset_id, name):
    for s in asset(asset_id).get("sockets") or []:
        if s["name"] == name:
            return s
    return None


def stack(chain, pos, rot=(0.0, 0.0, 0.0), label=None, band=None):
    """A spelled tower: each module at the MEASURED top socket of the one below.

    The forge's own rule, applied here rather than restated: a module's `top`
    socket z is where the next one bears, and it was measured off the geometry
    rather than declared. Returns placements for the whole stack.
    """
    out, z = [], float(pos[2])
    unit = label or "KitStack"
    for i, aid in enumerate(chain):
        rungs = placements_for(aid, (pos[0], pos[1], z), rot=rot,
                               label="%s_%d" % (unit, i + 1), band=band)
        # A STACK IS ONE THING. Its rungs bear on each other, so a screen that
        # removes the crown and keeps the base leaves a decapitated tower --
        # worse than either keeping or dropping the whole stand. `unit` says
        # they live or die together; `kit_layout._screen` honours it.
        for pl in rungs:
            pl["unit"] = unit
        out += rungs
        top = socket(aid, "top")
        if top is None:
            break
        z += float(top["z_uu"])
    return out


def _rung(radius_uu):
    lad = manifest()["radius_ladder_uu"]
    tol = manifest()["ladder_tolerance_uu"]
    for name, r in lad.items():
        if abs(float(r) - float(radius_uu)) <= float(tol):
            return name
    return None


def spellings(want=8, max_bodies=2, min_height_uu=0.0):
    """Legal foot -> body* -> terminator chains, tallest first, all different.

    The forge's grammar walked here rather than trusted from a count: a `top`
    and a `bottom` socket, both of kind `tower`, on the same rung of the radius
    ladder. Chains are deduped on BOTH ends -- the tallest foot wins every sort,
    so deduping on the crown alone gives eight different towers standing on
    eight identical undercrofts, which is the procedural monotony
    `framescape.py` already measures as "one piece holding the ceiling".

    AND ON THE SHAFT, which is the same argument one level down and the version
    this function did not make. Chains sort tallest first, so for every (foot,
    crown) pair the tallest body combination wins -- and
    `Tower_Mid_Machicolated + Tower_Mid_Fluted` is that pair for most of them.
    Twelve spellings came back with twelve crowns and THREE shafts between them,
    and `Tower_Mid_Balconied`, `Tower_Mid_Lantern` and `Tower_Mid_Oriel` were
    never spelled at all: three modules the forge built and the world could not
    reach. A second pass admits a chain that introduces a body nothing else has
    used, even when both its ends are already spoken for.
    """
    def top(a):
        s = socket(a["asset_id"], "top")
        return s if s and s["kind"] == "tower" else None

    def bot(a):
        s = socket(a["asset_id"], "bottom")
        return s if s and s["kind"] == "tower" else None

    assets = [a for a in manifest()["assets"] if not a.get("variant_of")]
    feet = [a for a in assets if a.get("silhouette_role") == "foot" and top(a)]
    bodies = [a for a in assets if a.get("silhouette_role") == "body"
              and top(a) and bot(a)]
    ends = [a for a in assets
            if a.get("silhouette_role") in ("crown", "needle") and bot(a)]

    found = []
    for foot in sorted(feet, key=lambda a: a["asset_id"]):
        chains = [[foot]]
        for _ in range(max_bodies):
            grown = []
            for ch in chains:
                r = _rung(top(ch[-1])["radius_uu"])
                for b in bodies:
                    if _rung(bot(b)["radius_uu"]) == r:
                        grown.append(ch + [b])
            chains += grown
        for ch in chains:
            r = _rung(top(ch[-1])["radius_uu"])
            for e in ends:
                if _rung(bot(e)["radius_uu"]) == r:
                    found.append(ch + [e])

    def total(ch):
        z = 0.0
        for m in ch[:-1]:
            t = socket(m["asset_id"], "top")
            z += float(t["z_uu"]) if t else 0.0
        return z + height_uu(ch[-1]["asset_id"])

    found.sort(key=lambda ch: -total(ch))
    out, used_top, used_foot, used_body = [], set(), set(), set()

    def take(ch):
        used_top.add(ch[-1]["asset_id"])
        used_foot.add(ch[0]["asset_id"])
        used_body.update(m["asset_id"] for m in ch[1:-1])
        out.append(([m["asset_id"] for m in ch], total(ch)))

    tall = [ch for ch in found if total(ch) >= min_height_uu]
    # 1. a new foot AND a new crown -- the tallest of each, as before
    for ch in tall:
        if len(out) >= want:
            break
        if ch[-1]["asset_id"] in used_top or ch[0]["asset_id"] in used_foot:
            continue
        take(ch)
    # 2. a new SHAFT, even where both ends are spoken for
    for ch in tall:
        if len(out) >= want:
            break
        if not any(m["asset_id"] not in used_body for m in ch[1:-1]):
            continue
        take(ch)
    # 3. anything with a crown not yet used
    for ch in tall:
        if len(out) >= want:
            break
        if ch[-1]["asset_id"] in used_top:
            continue
        take(ch)
    return out


def plan(path=MANIFEST):
    """Everything the import needs, derived. No engine required."""
    m = manifest(path)
    rows = []
    for rec in m["assets"]:
        dest = destination(rec)
        for part_key, part in sorted((rec.get("parts") or {}).items()):
            src = os.path.join(BLENDER_ROOT, part["fbx"])
            rows.append({
                "key": part["mesh_name"], "asset_id": rec["asset_id"],
                "source": src, "source_exists": os.path.exists(src),
                "destination_path": dest,
                "asset_path": "%s/%s" % (dest, part["mesh_name"]),
                "material": part["material"],
                "band": band_for(rec["asset_id"]),
                "nanite": bool(rec.get("nanite_recommended")),
                "collision": bool(rec.get("collision_recommended")),
                "tris": part.get("tris"),
            })
    return rows


# --------------------------------------------------------------------------
# the editor half. Never runs offline, and says so rather than pretending.
# --------------------------------------------------------------------------


def import_kit_assets(ctx=None, keys=None, log=print):
    """Import the forge meshes and return `{key: asset path}`.

    Shaped exactly like `assets_v2.build_assets` so `build_v2.py` can merge the
    two dicts and change nothing else. Outside the editor it returns `{}` and
    SAYS so -- a silent empty dict here would look identical to a world whose
    kit simply was not placed.
    """
    if unreal is None:
        log("V2 KIT: no unreal module; 0 forge meshes imported. This is the "
            "offline path and the kit is NOT in this build.")
        return {}
    rows = plan()
    if keys:
        want = set(keys)
        rows = [r for r in rows if r["key"] in want]
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    out, failed = {}, []
    for r in rows:
        if not r["source_exists"]:
            failed.append((r["key"], "no FBX at %s -- run build_assets.py in "
                                     "this checkout" % r["source"]))
            continue
        existing = r["asset_path"]
        if unreal.EditorAssetLibrary.does_asset_exist(existing):
            out[r["key"]] = existing
            continue
        task = unreal.AssetImportTask()
        task.set_editor_property("filename", r["source"])
        task.set_editor_property("destination_path", r["destination_path"])
        task.set_editor_property("destination_name", r["key"])
        task.set_editor_property("automated", True)
        task.set_editor_property("replace_existing", True)
        task.set_editor_property("save", True)
        if r["nanite"]:
            try:
                opts = unreal.InterchangeGenericAssetsPipeline()
                opts.get_editor_property("mesh_pipeline").set_editor_property(
                    "build_nanite", True)
                task.set_editor_property("options", opts)
            except Exception as exc:                       # noqa: BLE001
                log("V2 KIT %-34s NANITE NOT APPLIED (%s) -- imported at "
                    "engine defaults" % (r["key"], exc))
        tools.import_asset_tasks([task])
        paths = list(task.get_editor_property("imported_object_paths") or [])
        if not paths:
            failed.append((r["key"], "the engine returned no imported object "
                                     "paths"))
            continue
        out[r["key"]] = paths[0].split(".")[0]
    log("V2 KIT: %d forge mesh(es) available, %d failed" % (len(out), len(failed)))
    for key, why in failed:
        log("V2 KIT %-34s FAILED: %s" % (key, why))
    return out
