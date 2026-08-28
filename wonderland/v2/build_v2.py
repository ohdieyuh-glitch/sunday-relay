"""WONDERLAND V2 — the editor entry point. Creates WL_V2_GoldenArrival from nothing.

Run inside the UE 5.8 editor commandlet (v2-build.sh):

    UnrealEditor-Cmd Wonderland.uproject -run=pythonscript -script=wonderland/v2/build_v2.py

Order, and why:

  1. RECORD      engine, plugins, Geometry Script capability — so the log's
                 first lines say what this build was made with
  2. NEW MAP     from the Open World (World Partition) template; an empty
                 level if the template is absent. The actor list is logged
                 IMMEDIATELY as the empty-world evidence, and the build refuses
                 to continue if any V1 actor class is present
  3. DATA LAYERS V2_Arrival ... V2_VFX (tags if the Data Layer API is absent)
  4. TEXTURES + MATERIALS  new masters under /Game/WonderlandV2/Materials
  5. ASSETS      every recipe in assets_v2, saved under the V2 root
  6. GROUND      terrain (the template's landscape or a ground slab), the
                 plaza flagstones, the path laid on the spline
  7. COMPOSITION every placement in layout_v2, as actors, foldered, tagged,
                 assigned to data layers; hover props as WonderlandHoverProp
  8. LIGHT       sun, sky light, sky atmosphere, height fog (volumetric),
                 portal light, post-process volume
  9. CAMERA      HeroCam_V2_Arrival, locked, tagged HeroCam0 for the capture path
 10. SAVE + MANIFEST  the map, every asset, and a JSON manifest the shell
                 reads; a one-line V2 SUMMARY the founder can grep

Every engine call that can vary by build is tolerant and logged. A failure
in one phase degrades that phase and never leaves the map unsaved.
"""

import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
_HD = os.path.join(os.path.dirname(HERE), "infra", "build", "hd")
if _HD not in sys.path:
    sys.path.insert(0, _HD)

import unreal                      # noqa: E402  (the editor, or the dry run's stub)
import v2_config as C              # noqa: E402
import layout_v2 as LAYOUT         # noqa: E402
import materials_v2 as MAT         # noqa: E402
import assets_v2 as ASSETS         # noqa: E402
import gs                          # noqa: E402
import dressing_v2 as DRESS        # noqa: E402
import layout_tools as LT          # noqa: E402  (engineering, migrated)

LOG = unreal.log_warning           # warning level survives the packaged log filter
V1_CLASS_MARKERS = ("WonderlandInstancedBatch", "WonderlandStrollingDog", "WonderlandProjectAvatar",
                    "WonderlandInteractable")
V1_LABEL_MARKERS = ("SkyCity", "PlazaBed", "Tile", "RelayDog", "GreatTree", "Batch_", "HDAR_", "Orn")

MANIFEST = {"map": C.MAP_PATH, "content_root": C.CONTENT_ROOT, "phases": {}, "assets": {},
            "actors": {}, "empty_map_actors": [], "world_partition": "unknown", "backend": None,
            "materials": 0, "failures": []}


def phase(name):
    LOG("V2 PHASE %s" % name)
    MANIFEST["phases"][name] = time.time()


def set_prop(obj, name, value):
    for n in (name, name[0].lower() + name[1:], _snake(name)):
        try:
            obj.set_editor_property(n, value)
            return True
        except Exception:
            continue
    return False


def _snake(n):
    out = ""
    for i, ch in enumerate(n):
        if ch.isupper() and i and not n[i - 1].isupper():
            out += "_"
        out += ch.lower()
    return out.lstrip("_").replace("b_", "", 1) if n.startswith("b") and len(n) > 1 and n[1].isupper() else out


def rot(p, y, r):
    ro = unreal.Rotator()
    ro.set_editor_property("pitch", float(p))
    ro.set_editor_property("yaw", float(y))
    ro.set_editor_property("roll", float(r))
    return ro


def vec(p):
    return unreal.Vector(float(p[0]), float(p[1]), float(p[2]))


# ==========================================================================
# 2. the map
# ==========================================================================


#: WLV2_PARTITIONED=0 builds a CLASSIC level (actors inside the .umap) -- the
#: fallback if a partitioned level's external actor packages cannot be saved
#: from the commandlet; the founder's World Partition requirement is served by
#: the partitioned default.
WP_PARTITIONED = os.environ.get("WLV2_PARTITIONED", "1") != "0"


def _map_file_on_disk():
    """The .umap this build writes, on disk -- /Game/X/Y -> <Content>/X/Y.umap."""
    rel = C.MAP_PATH.split("/Game/", 1)[1]
    return os.path.join(str(unreal.Paths.project_content_dir()), *rel.split("/")) + ".umap"


def clear_old_map(eal):
    """Remove the previous build's map so the level can be created fresh.

    2026-08-28: `EditorAssetLibrary.delete_asset` returned False WITHOUT an
    exception, the code never looked at its return value, and
    `LevelEditorSubsystem.new_level` then refused: "Failed to validate the
    destination. An asset already exists at this location." The build died
    after announcing a rebuild. So: load a neutral map first (a loaded level
    cannot be deleted), delete and LOG the result, and if the package is still
    there remove the file and rescan the registry. Fail closed if it persists.
    """
    if not eal.does_asset_exist(C.MAP_PATH):
        return
    LOG("V2 MAP: %s exists from an earlier run; deleting it so this is a fresh level" % C.MAP_PATH)
    try:
        unreal.EditorLoadingAndSavingUtils.load_map("/Engine/Maps/Entry")
    except Exception as exc:
        LOG("V2 MAP: could not load the neutral map first (%s)" % exc)
    deleted = False
    try:
        deleted = bool(eal.delete_asset(C.MAP_PATH))
    except Exception as exc:
        LOG("V2 MAP: delete_asset raised (%s)" % exc)
    LOG("V2 MAP: delete_asset -> %s" % deleted)
    if eal.does_asset_exist(C.MAP_PATH):
        path = _map_file_on_disk()
        removed = []
        for p in (path, path.replace(".umap", "_BuiltData.uasset")):
            if os.path.isfile(p):
                try:
                    os.remove(p)
                    removed.append(os.path.basename(p))
                except Exception as exc:
                    LOG("V2 MAP: os.remove(%s) failed (%s)" % (p, exc))
        try:
            reg = unreal.AssetRegistryHelpers.get_asset_registry()
            reg.scan_paths_synchronous([C.MAP_PATH.rsplit("/", 1)[0]], True)
        except Exception as exc:
            LOG("V2 MAP: registry rescan failed (%s)" % exc)
        LOG("V2 MAP: removed on disk %s; asset exists now: %s" % (removed, eal.does_asset_exist(C.MAP_PATH)))
    if eal.does_asset_exist(C.MAP_PATH) and os.path.isfile(_map_file_on_disk()):
        raise RuntimeError("the previous map %s could not be removed; refusing to build over it" % C.MAP_PATH)


def new_map(actors, eal, lsu):
    """Create the V2 level. Returns (world, how)."""
    clear_old_map(eal)
    how = None
    world = None
    # VERIFIED 5.5 API: LevelEditorSubsystem.new_level(asset_path,
    # is_partitioned_world=False) -> bool. A genuinely EMPTY World Partition
    # level, no template actors, no landscape -- exactly what the directive
    # asks for. The template route (new_map_from_template takes
    # (template, save_existing_map: bool), not a destination) is the fallback,
    # then a plain empty level; the log says which one was taken.
    try:
        les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    except Exception:
        les = None
    if les is not None:
        try:
            if les.new_level(C.MAP_PATH, WP_PARTITIONED):
                how = "empty World Partition level (LevelEditorSubsystem.new_level, partitioned)"
        except TypeError:
            try:
                if les.new_level(C.MAP_PATH):
                    how = "empty level (LevelEditorSubsystem.new_level; partition flag unsupported)"
            except Exception as exc:
                LOG("V2 MAP: new_level failed (%s)" % exc)
        except Exception as exc:
            LOG("V2 MAP: partitioned new_level failed (%s)" % exc)
    if how is None:
        for tpl in C.OPEN_WORLD_TEMPLATES:
            if not eal.does_asset_exist(tpl):
                continue
            try:
                if les is not None and les.new_level_from_template(C.MAP_PATH, tpl):
                    how = "template %s (World Partition)" % tpl.rsplit("/", 1)[-1]
                    break
            except Exception as exc:
                LOG("V2 MAP: template %s failed (%s)" % (tpl, exc))
    if how is None:
        try:
            ok = unreal.EditorLevelLibrary.new_level(C.MAP_PATH)
            how = "empty level (EditorLevelLibrary.new_level)" if ok else None
        except Exception as exc:
            LOG("V2 MAP: EditorLevelLibrary.new_level failed (%s)" % exc)
    if how is None:
        raise RuntimeError("could not create %s by any method" % C.MAP_PATH)
    try:
        world = unreal.EditorLevelLibrary.get_editor_world()
    except Exception:
        world = None
    MANIFEST["map_created_by"] = how
    LOG("V2 MAP: created %s via %s" % (C.MAP_PATH, how))
    # ---- EMPTY-WORLD EVIDENCE (Gauntlet round 1) --------------------------
    names = []
    try:
        for a in actors.get_all_level_actors():
            cls = a.get_class().get_name() if hasattr(a, "get_class") else type(a).__name__
            lb = a.get_actor_label() if hasattr(a, "get_actor_label") else str(a)
            names.append("%s:%s" % (cls, lb))
    except Exception as exc:
        LOG("V2 MAP: could not enumerate actors (%s)" % exc)
    MANIFEST["empty_map_actors"] = names
    LOG("V2 EMPTY MAP: %d actor(s) present at creation: %s" % (len(names), ", ".join(names[:40])))
    bad = [n for n in names if any(m in n for m in V1_CLASS_MARKERS + V1_LABEL_MARKERS)]
    if bad:
        raise RuntimeError("V1 actors are present in the new map: %s -- refusing to build V2 on top of V1" % bad)
    # world partition status, best effort
    wp = "unknown"
    try:
        ws = world.get_world_settings() if world is not None else None
        for getter in ("is_partitioned_world", "get_world_partition"):
            fn = getattr(world, getter, None) if world is not None else None
            if fn:
                v = fn()
                wp = "enabled" if v else "disabled"
                break
        if wp == "unknown" and ws is not None:
            for prop in ("world_partition", "enable_world_partition"):
                try:
                    v = ws.get_editor_property(prop)
                    wp = "enabled" if v else "disabled"
                    break
                except Exception:
                    continue
    except Exception:
        pass
    if wp == "unknown" and "World Partition" in how:
        wp = "enabled (by template)"
    MANIFEST["world_partition"] = wp
    LOG("V2 WORLD PARTITION: %s" % wp)
    return world, how


# ==========================================================================
# 3. data layers
# ==========================================================================


def make_data_layers():
    layers = {}
    sub = None
    try:
        sub = unreal.get_editor_subsystem(unreal.DataLayerEditorSubsystem)
    except Exception:
        sub = None
    if sub is None:
        LOG("V2 DATA LAYERS: subsystem unavailable; layer names are written as actor TAGS")
        return layers, "tags"
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    for name in C.DATA_LAYERS:
        try:
            asset = None
            path = C.FOLDERS["data"] + "/DL_" + name
            eal = unreal.EditorAssetLibrary
            if eal.does_asset_exist(path):
                asset = eal.load_asset(path)
            else:
                factory = getattr(unreal, "DataLayerFactory", None)
                if factory is not None:
                    asset = tools.create_asset("DL_" + name, C.FOLDERS["data"], unreal.DataLayerAsset, factory())
            inst = None
            if asset is not None:
                params = unreal.DataLayerCreationParameters()
                set_prop(params, "DataLayerAsset", asset)
                inst = sub.create_data_layer_instance(params)
            if inst is None and hasattr(sub, "create_data_layer"):
                # VERIFIED 5.5 API: create_data_layer(parent_data_layer=None) -> DataLayerInstance
                inst = sub.create_data_layer()
                if inst is not None:
                    for prop in ("data_layer_label", "DataLayerLabel"):
                        try:
                            inst.set_editor_property(prop, unreal.Name(name))
                            break
                        except Exception:
                            continue
            if inst is not None:
                layers[name] = inst
        except Exception as exc:
            LOG("V2 DATA LAYERS: %s not created (%s)" % (name, exc))
    LOG("V2 DATA LAYERS: %d of %d created as real Data Layers%s"
        % (len(layers), len(C.DATA_LAYERS), "" if layers else "; falling back to tags"))
    return layers, ("data-layers" if layers else "tags")


# ==========================================================================
# 3b. performance: HLOD layers + streaming policy (gauntlet G)
# ==========================================================================
#
# VERIFIED 5.5 API (Epic python docs): HLODLayer editor properties layer_type
# (HLODLayerType.INSTANCING / MESH_MERGE / MESH_SIMPLIFY / MESH_APPROXIMATE /
# CUSTOM), cell_size (int), loading_range (double), is_spatially_loaded,
# parent_layer; HLODLayerFactory exists; Actor.hlod_layer, Actor.is_spatially_
# loaded, Actor.runtime_grid; WorldSettings.world_partition (read-only object)
# with WorldPartition.default_hlod_layer. The runtime spatial-hash grids are
# NOT exposed to Python (their class pages 404), so grid cell sizes stay at
# the engine defaults and this says so in the log.
#
# Policy by band (the map is small and every band is visible from the hero
# camera, so the lever is DRAW CALLS, not unloading):
#   V2_Arrival   hero foreground: full detail, no HLOD, spatially loaded
#   V2_Garden / V2_Vegetation / V2_Props   near HLOD (INSTANCING) so the
#                far side of the garden collapses into one ISM per cell
#   V2_Castle / V2_Skyline   far HLOD (INSTANCING, big cells) and ALWAYS
#                loaded: a tower that pops in at the skyline is a defect
#   V2_VFX       spatially loaded, no HLOD
# INSTANCING needs no commandlet rendering, so the HLOD build runs on CPU.
PERF_POLICY = {
    "V2_Arrival":    {"hlod": None,   "spatial": True},
    "V2_Garden":     {"hlod": "near", "spatial": True},
    "V2_Vegetation": {"hlod": "near", "spatial": True},
    "V2_Props":      {"hlod": "near", "spatial": True},
    "V2_Castle":     {"hlod": "far",  "spatial": False},
    "V2_Skyline":    {"hlod": "far",  "spatial": False},
    "V2_VFX":        {"hlod": None,   "spatial": True},
}
HLOD_SPECS = {
    # name, type, cell (uu), loading range (uu), spatially loaded
    "far":  ("HLOD_V2_Far",  "INSTANCING", 51200, 409600, False),
    "near": ("HLOD_V2_Near", "INSTANCING", 12800, 102400, True),
}
PERF = {"layers": {}, "counts": {}, "grid": "engine default (runtime hash not scriptable)"}


def make_hlod_layers(world):
    """Create the two HLOD layer assets under the V2 root and make the near one
    the world's default. Tolerant: if the classes are absent (stub engine or
    an engine without World Partition HLOD), the build logs it and goes on
    with no HLOD -- the performance line says so."""
    layer_cls = getattr(unreal, "HLODLayer", None)
    fac_cls = getattr(unreal, "HLODLayerFactory", None)
    if layer_cls is None or fac_cls is None:
        LOG("V2 HLOD: HLODLayer/HLODLayerFactory unavailable -- no HLOD layers (draw calls stay per-actor)")
        return {}
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    eal = unreal.EditorAssetLibrary
    pkg = C.FOLDERS.get("hlod", C.CONTENT_ROOT + "/HLOD")
    made = {}
    for key in ("far", "near"):        # far first: it is the near layer's parent
        name, ltype, cell, rng, spatial = HLOD_SPECS[key]
        path = pkg + "/" + name
        try:
            if eal.does_asset_exist(path):
                eal.delete_asset(path)
            layer = tools.create_asset(name, pkg, layer_cls, fac_cls())
            if layer is None:
                LOG("V2 HLOD: create_asset returned None for %s" % name)
                continue
            layer.set_editor_property("layer_type", getattr(unreal.HLODLayerType, ltype))
            layer.set_editor_property("cell_size", int(cell))
            layer.set_editor_property("loading_range", float(rng))
            layer.set_editor_property("is_spatially_loaded", bool(spatial))
            if key == "near" and "far" in made:
                layer.set_editor_property("parent_layer", made["far"])
            eal.save_asset(path, only_if_is_dirty=False)
            made[key] = layer
            LOG("V2 HLOD: %s %s cell %d range %d spatial %s" % (name, ltype, cell, rng, spatial))
        except Exception as exc:
            LOG("V2 HLOD: %s FAILED: %s" % (name, exc))
    if "near" in made:
        try:
            ws = world.get_world_settings()
            wp = ws.get_editor_property("world_partition")
            if wp is not None:
                wp.set_editor_property("default_hlod_layer", made["near"])
                LOG("V2 HLOD: default_hlod_layer = HLOD_V2_Near")
            else:
                LOG("V2 HLOD: world has no WorldPartition object; default layer not set")
        except Exception as exc:
            LOG("V2 HLOD: default layer not set (%s)" % exc)
    PERF["layers"] = {k: HLOD_SPECS[k][0] for k in made}
    return made


#: WLV2_ALL_ALWAYS_LOADED=1: every actor is_spatially_loaded=False -- the World
#: Partition streaming bypass (P0 TEST 5). The world then lives entirely in
#: the always-loaded set the editor and the runtime load without cells.
ALL_ALWAYS_LOADED = os.environ.get("WLV2_ALL_ALWAYS_LOADED", "0") == "1"


def apply_perf(actor, band):
    pol = PERF_POLICY.get(band)
    if pol is None:
        return
    if ALL_ALWAYS_LOADED:
        pol = dict(pol, spatial=False)
    key = "%s:%s" % (band, "hlod-" + pol["hlod"] if pol["hlod"] and pol["hlod"] in PERF["layers"] else "no-hlod")
    PERF["counts"][key] = PERF["counts"].get(key, 0) + 1
    try:
        actor.set_editor_property("is_spatially_loaded", bool(pol["spatial"]))
    except Exception:
        pass
    layer = _HLOD.get(pol["hlod"]) if pol["hlod"] else None
    if layer is not None:
        try:
            actor.set_editor_property("hlod_layer", layer)
        except Exception:
            pass


_HLOD = {}


def _band_tag(actor):
    """BAND_A (< 50 m from the viewpoint), BAND_B (< 200 m), BAND_C beyond --
    the founder's distance-based responsibility, as a tag on every actor."""
    try:
        loc = actor.get_actor_location()
        d = math.hypot(float(loc.x), float(loc.y))
    except Exception:
        return None
    return "BAND_A" if d < 5000.0 else ("BAND_B" if d < 20000.0 else "BAND_C")


def assign_layer(actor, band, layers, sub_cache=[None]):
    try:
        cur = list(actor.get_editor_property("tags") or [])
        names = [str(t) for t in cur]
        cur.append(unreal.Name(band))
        if not any(t.startswith("MARBLE_") for t in names):
            cur.append(unreal.Name("UNREAL_PRODUCTION"))
            bt = _band_tag(actor)
            if bt and bt not in names:
                cur.append(unreal.Name(bt))
        actor.set_editor_property("tags", cur)
    except Exception:
        pass
    apply_perf(actor, band)
    inst = layers.get(band)
    if inst is None:
        return
    try:
        if sub_cache[0] is None:
            sub_cache[0] = unreal.get_editor_subsystem(unreal.DataLayerEditorSubsystem)
        sub_cache[0].add_actor_to_data_layer(actor, inst)
    except Exception:
        pass


# ==========================================================================
# 7. placement
# ==========================================================================


#: Repeated small assets are INSTANCED through the C++ batch actor rather than
#: spawned as actors: one draw per (mesh, material) instead of one per plant.
BATCHABLE = {"ground_flowers", "flower_cluster", "rose_bloom", "hedge_block", "hedge_mass", "rose_bush",
             "shrub_flowering", "topiary_ball", "mushroom_small", "blossom_cluster", "vine_wall", "ivy_drape",
             "side_steps", "retaining_wall", "balustrade"}


class Placer(object):
    def __init__(self, actors, eal, asset_paths, mats, layers):
        self.actors = actors
        self.eal = eal
        self.assets = asset_paths
        self.mats = mats
        self.layers = layers
        self.count = {}
        self.df_excluded = 0
        self.df_failed = 0
        self.missing = {}
        self.hover_cls = None
        try:
            self.hover_cls = unreal.load_class(None, "/Script/Wonderland.WonderlandHoverProp")
        except Exception:
            self.hover_cls = None
        self._mesh_cache = {}
        self.pending = {}          # (asset, mat, band) -> transforms
        self.batch_cls = None
        try:
            self.batch_cls = unreal.load_class(None, "/Script/Wonderland.WonderlandInstancedBatch")
        except Exception:
            self.batch_cls = None
        self.batched = 0

    def mesh(self, key):
        path = self.assets.get(key)
        if not path:
            self.missing[key] = self.missing.get(key, 0) + 1
            return None
        if key not in self._mesh_cache:
            self._mesh_cache[key] = self.eal.load_asset(path)
        return self._mesh_cache[key]

    def place(self, item, hover=False, batch=True):
        if batch and self.batch_cls and item["asset"] in BATCHABLE and item["asset"] in self.assets:
            loc, r, sc = item["pos"], item["rot"], item["scale"]
            self.pending.setdefault((item["asset"], item.get("mat"), item["band"]), []).extend(
                [float(loc[0]), float(loc[1]), float(loc[2]), float(r[0]), float(r[1]), float(r[2]),
                 float(sc[0]), float(sc[1]), float(sc[2])])
            self.count[item["band"]] = self.count.get(item["band"], 0) + 1
            self.batched += 1
            return True
        sm = self.mesh(item["asset"])
        if sm is None:
            return None
        loc, r, sc = item["pos"], item["rot"], item["scale"]
        cls = self.hover_cls if (hover and self.hover_cls) else unreal.StaticMeshActor
        actor = self.actors.spawn_actor_from_class(cls, vec(loc), rot(*r))
        if actor is None:
            return None
        actor.set_actor_scale3d(vec(sc))
        if item.get("label"):
            actor.set_actor_label(item["label"])
        mi = self.mats.get(item.get("mat")) if item.get("mat") else None
        if hover and self.hover_cls:
            set_prop(actor, "Mesh", sm)
            set_prop(actor, "MeshPath", self.assets.get(item["asset"], ""))
            if mi is not None:
                set_prop(actor, "Material", mi)
                set_prop(actor, "MaterialPath", mi.get_path_name())
        else:
            smc = actor.get_component_by_class(unreal.StaticMeshComponent)
            if smc is not None:
                # MOVABLE, by V1's measurement on this pipeline: with no baked
                # lighting a STATIC-mobility mesh rendered black. Nanite and
                # Lumen both accept movable meshes.
                try:
                    smc.set_mobility(unreal.ComponentMobility.MOVABLE)
                except Exception:
                    pass
                smc.set_static_mesh(sm)
                if mi is not None:
                    smc.set_material(0, mi)
                if item.get("mat") in MAT.FOLIAGE and not int(C.LOOK.get("foliageDistanceFieldLighting", 1)):
                    # PASS 05c: a leaf cloud's distance field is a solid blob
                    # that occludes the sky light on the leaves themselves.
                    if set_prop(smc, "bAffectDistanceFieldLighting", False):
                        self.df_excluded += 1
                    else:
                        self.df_failed += 1
        try:
            actor.set_folder_path(unreal.Name("V2/" + item["band"]))
        except Exception:
            pass
        assign_layer(actor, item["band"], self.layers)
        self.count[item["band"]] = self.count.get(item["band"], 0) + 1
        return actor


    def flush(self):
        """Emit one batch actor per (asset, material, band)."""
        made = 0
        for (key, mat, band), xf in self.pending.items():
            a = self.actors.spawn_actor_from_class(self.batch_cls, vec((0, 0, 0)), rot(0, 0, 0))
            if a is None:
                continue
            a.set_actor_label("V2Batch_%s_%s" % (key, mat or "default"))
            set_prop(a, "MeshPath", self.assets[key])
            set_prop(a, "Mesh", self.eal.load_asset(self.assets[key]))
            mi = self.mats.get(mat) if mat else None
            if mi is not None:
                set_prop(a, "Material", mi)
                set_prop(a, "MaterialPath", mi.get_path_name())
            set_prop(a, "BatchName", unreal.Name("V2_%s" % key))
            set_prop(a, "bHierarchical", True)
            set_prop(a, "bCastShadow", True)
            set_prop(a, "bCollides", key in ("side_steps", "retaining_wall", "balustrade", "hedge_block"))
            if mat in MAT.FOLIAGE and not int(C.LOOK.get("foliageDistanceFieldLighting", 1)):
                # PASS 05d: the batched hedges, beds and blossoms -- same
                # reason as the canopies (see Placer.place); the property is
                # AWonderlandInstancedBatch::bAffectDistanceFieldLighting.
                if set_prop(a, "bAffectDistanceFieldLighting", False):
                    self.df_excluded += 1
                else:
                    self.df_failed += 1
            for payload in (xf, None):
                try:
                    if payload is None:
                        arr = unreal.Array(float)
                        for v in xf:
                            arr.append(float(v))
                        payload = arr
                    if set_prop(a, "Transforms", payload):
                        break
                except Exception:
                    continue
            try:
                a.set_folder_path(unreal.Name("V2/" + band + "/Batches"))
            except Exception:
                pass
            assign_layer(a, band, self.layers)
            made += 1
        LOG("V2 BATCHES: %d instances in %d batch actors (%s)" % (self.batched, made,
            ", ".join(sorted(set(k for (k, _, _) in self.pending)))))
        self.pending = {}
        return made


# ==========================================================================
# 6. ground: plaza + path
# ==========================================================================


def lay_ground(placer, actors, eal, assets, mats, layers, plaza_only=False):
    """The pale plaza (large slabs, loose cream/grey checker, sparse petals)
    and the dark stone path from the front wall to the arch, rising at the
    steps. Batched through the C++ batch actor when it is in the build."""
    plaza = [k for k in sorted(assets) if k.startswith("plaza_slab_")]
    setts = [k for k in sorted(assets) if k.startswith("cobble_slab_")]
    if not plaza and not setts:
        LOG("V2 GROUND: no slabs built; the plaza is missing")
        return 0
    placements = []
    x0, x1, y0, y1 = LAYOUT.PLAZA_RECT
    # THE PLAZA AS MASONRY (PASS 01, 2026-08-28): courses of one height along
    # +Y, slabs of three LENGTHS along X in running bond (alternate courses
    # start half a slab in), 4 uu joints, three tints in a low-frequency
    # blotch (never a checker), a hair of height and yaw jitter. The
    # reference plaza is fitted flagstones; a grid of one square reads as
    # tiles no matter what the material does.
    course = ASSETS.PLAZA_COURSE
    joint = 4.0
    by_class = {}
    for k in plaza:
        by_class.setdefault(ASSETS.plaza_slab_class(int(k.rsplit("_", 1)[1])), []).append(k)
    lengths = ASSETS.PLAZA_LENGTHS
    rows = int((y1 - y0) / (course + joint)) + 1
    laid = 0
    if plaza and by_class:
        for r in range(rows):
            y = y0 + (course + joint) * (r + 0.5)
            if y + course * 0.5 > y1 + course * 0.25:
                continue
            x = x0 - (lengths[0] * 0.5 if r % 2 else 0.0)
            c = 0
            while x < x1:
                h = LT.mk.rnd(r, c, 21)
                cls = 0 if h < 0.55 else (1 if h < 0.80 else 2)       # square 55 %, short 25 %, runner 20 %
                if cls not in by_class:
                    cls = sorted(by_class)[0]
                length = lengths[cls]
                cx = x + length * 0.5
                if cx - length * 0.5 < x0 - length * 0.25 or cx + length * 0.5 > x1 + length * 0.25:
                    x += length + joint
                    c += 1
                    continue
                variants = by_class[cls]
                key = variants[int(LT.mk.rnd(r, c, 27) * len(variants)) % len(variants)]
                blotch = LT.mk.rnd(r // 2, c // 3, 28) * 0.7 + LT.mk.rnd(r, c, 29) * 0.3
                mat = "MI_V2_PlazaCream" if blotch < 0.55 else ("MI_V2_PlazaWarm" if blotch < 0.80 else "MI_V2_PlazaGrey")
                # jitter small enough that a 2 m runner cannot overlap its
                # neighbour's chamfer (PASS 01/01b showed dark wedge "cracks"
                # at +/-1.2 deg): +/-0.4 deg, +/-0.8 uu.
                placements.append((key, cx + (LT.mk.rnd(r, c, 23) - 0.5) * 0.8,
                                   y + (LT.mk.rnd(r, c, 24) - 0.5) * 0.8, -1.0 + 0.6 * LT.mk.rnd(r, c, 25),
                                   (LT.mk.rnd(r, c, 26) - 0.5) * 0.4, 1.0, 1.0, 1.0, mat))
                laid += 1
                x += length + joint
                c += 1
    cols = laid // max(1, rows)
    tile = course
    flags = [k for k in sorted(assets) if k.startswith("path_flag_")]
    kerb = "kerb_stone" if "kerb_stone" in assets else None
    if flags and not plaza_only:
        # THE PATH AS FITTED FLAGS IN RUNNING BOND (PASS 01b): courses across
        # the way every (course + joint) along the spline, flags of three
        # lengths laid across each course from a half-offset on alternate
        # courses, 3 uu joints, the way narrowing with distance; cream kerb
        # stones on a regular pitch along both edges. PASS 01's lay_stones
        # (a cobble grid of irregular polygons) read as stepping-stones on grass.
        sp = LT.Spline(LAYOUT.PATH_SPLINE)
        by_class = {}
        for k in flags:
            by_class.setdefault(ASSETS.path_flag_class(int(k.rsplit("_", 1)[1])), []).append(k)
        course, joint = ASSETS.PATH_COURSE, 3.0
        lengths = ASSETS.PATH_LENGTHS
        total = sp.length
        d, row, laid_flags, laid_kerbs = 0.0, 0, 0, 0
        while d <= total:
            p, t = sp.at(d)
            yaw = math.degrees(math.atan2(t[1], t[0]))
            frac = d / max(1.0, total)
            half = 0.5 * (LAYOUT.PATH_WIDTH_NEAR + (LAYOUT.PATH_WIDTH_FAR - LAYOUT.PATH_WIDTH_NEAR) * frac) * 0.94
            lat = -half - (lengths[0] * 0.5 if row % 2 else 0.0)
            c = 0
            while lat < half:
                h = LT.mk.rnd(row, c, 31)
                cls = 0 if h < 0.5 else (1 if h < 0.78 else 2)
                if cls not in by_class:
                    cls = sorted(by_class)[0]
                length = lengths[cls]
                centre = lat + length * 0.5
                if centre - length * 0.35 >= -half and centre + length * 0.35 <= half:
                    x, y, z = sp.offset_xy(d, centre)
                    variants = by_class[cls]
                    key = variants[int(LT.mk.rnd(row, c, 32) * len(variants)) % len(variants)]
                    placements.append((key, x + (LT.mk.rnd(row, c, 33) - 0.5) * 1.2, y + (LT.mk.rnd(row, c, 34) - 0.5) * 1.2,
                                       z - 2.0 + 0.6 * LT.mk.rnd(row, c, 35), yaw + 90.0 + (LT.mk.rnd(row, c, 36) - 0.5) * 1.0,
                                       1.0, 1.0, 1.0, "MI_V2_PathStone"))
                    laid_flags += 1
                lat += length + joint
                c += 1
            if kerb and row % 2 == 0:            # kerb pitch = 2 courses = 150 uu for a 120 uu block
                for sgn in (-1, 1):
                    x, y, z = sp.offset_xy(d, sgn * (half + 22.0))
                    placements.append((kerb, x, y, z - 1.0, yaw, 1.0, 1.0, 1.0, "MI_V2_Kerb"))
                    laid_kerbs += 1
            d += course + joint
            row += 1
        LOG("V2 GROUND: path %d flags in %d courses, %d kerb stones (running bond, PASS 01b)" % (laid_flags, row, laid_kerbs))
    elif setts and not plaza_only:
        sp = LT.Spline(LAYOUT.PATH_SPLINE)
        for st in LT.lay_stones(sp, width=LAYOUT.PATH_WIDTH_NEAR * 0.92, tile=58.0, shrink=0.86, seed=5, kerb=False):
            frac = st["d"] / max(1.0, sp.length)
            half = 0.5 * (LAYOUT.PATH_WIDTH_NEAR + (LAYOUT.PATH_WIDTH_FAR - LAYOUT.PATH_WIDTH_NEAR) * frac)
            if abs(st["x"] - sp.at(st["d"])[0][0]) > half:
                continue
            v = int(LT.mk.rnd(st["d"], st["x"], 3) * len(setts)) % len(setts)
            placements.append((setts[v], st["x"], st["y"], st["z"] - 2.0, st["yaw"], st["sx"] * 0.95, st["sy"] * 0.95, 0.8,
                               "MI_V2_PathStone"))
    cls = None
    try:
        cls = unreal.load_class(None, "/Script/Wonderland.WonderlandInstancedBatch")
    except Exception:
        cls = None
    placed = 0
    if cls:
        by = {}
        for (key, x, y, z, yaw, sx, sy, sz, mat) in placements:
            by.setdefault((key, mat), []).extend([x, y, z, 0.0, yaw, 0.0, sx, sy, sz])
        for (key, mat), xf in by.items():
            a = actors.spawn_actor_from_class(cls, vec((0, 0, 0)), rot(0, 0, 0))
            if a is None:
                continue
            a.set_actor_label("V2Batch_%s_%s" % (key, mat))
            set_prop(a, "MeshPath", assets[key])
            set_prop(a, "Mesh", eal.load_asset(assets[key]))
            mi = mats.get(mat)
            if mi is not None:
                set_prop(a, "Material", mi)
                set_prop(a, "MaterialPath", mi.get_path_name())
            set_prop(a, "BatchName", unreal.Name("V2_%s" % key))
            set_prop(a, "bHierarchical", True)
            set_prop(a, "bCastShadow", True)
            set_prop(a, "bCollides", True)
            for payload in (xf, None):
                try:
                    if payload is None:
                        arr = unreal.Array(float)
                        for v in xf:
                            arr.append(float(v))
                        payload = arr
                    if set_prop(a, "Transforms", payload):
                        break
                except Exception:
                    continue
            try:
                a.set_folder_path(unreal.Name("V2/Ground"))
            except Exception:
                pass
            assign_layer(a, "V2_Arrival", layers)
            placed += len(xf) // 9
        LOG("V2 GROUND: %d slabs in %d batches (WonderlandInstancedBatch): plaza %dx%d of %s uu, path %s"
            % (placed, len(by), cols, rows, tile, "laid" if (setts and not plaza_only) else "not laid"))
    else:
        for (key, x, y, z, yaw, sx, sy, sz, mat) in placements:
            it = {"asset": key, "pos": (x, y, z), "rot": (0.0, yaw, 0.0), "scale": (sx, sy, sz),
                  "mat": mat, "label": None, "band": "V2_Arrival"}
            if placer.place(it) is not None:
                placed += 1
        LOG("V2 GROUND: %d slabs as actors (no batch class in this build)" % placed)
    # sparse petals on the plaza -- the reference's only plaza dressing
    petals = 0
    if "flower_cluster" in assets:
        for i in range(LAYOUT.PETALS):
            x = x0 + (x1 - x0) * LT.mk.rnd(31, i, 1)
            y = y0 + (y1 - y0) * LT.mk.rnd(31, i, 2)
            it = {"asset": "flower_cluster", "pos": (x, y, 12.0), "rot": (0.0, 360.0 * LT.mk.rnd(31, i, 3), 0.0),
                  "scale": (0.09, 0.09, 0.03), "mat": ("MI_V2_PetalPink", "MI_V2_RosePink", "MI_V2_PetalViolet")[i % 3],
                  "label": "Plaza_Petal%d" % i, "band": "V2_Arrival"}
            if placer.place(it) is not None:
                petals += 1
    LOG("V2 GROUND: %d petals on the plaza" % petals)
    return placed


# ==========================================================================
# 6b. the Marble world
# ==========================================================================


def marble_world(actors, eal, layers):
    """Place Marble's textured HQ mesh as the scenery, registered on the V2
    hero camera. Returns the actor or None (and says why)."""
    L = C.LOOK
    if not int(L["marbleWorld"]):
        LOG("V2 MARBLE: off (marbleWorld=0); the castle kit is the scenery")
        return None
    glb = C.MARBLE_GLB
    if not glb or not os.path.exists(glb):
        LOG("V2 MARBLE: HQ mesh not available on this host (WLV2_MARBLE_GLB=%r); the castle kit is the scenery" % glb)
        return None
    import importlib.util
    tool_path = os.path.join(os.path.dirname(HERE), "marble", "import-marble-world.py")
    spec = importlib.util.spec_from_file_location("marble_import_tool", tool_path)
    tool = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(tool)
    except SystemExit:
        pass
    except Exception as exc:
        LOG("V2 MARBLE: import tool did not load (%s)" % exc)
        return None
    # MARBLE GEOMETRY QUARANTINE (founder, 2026-08-26): raw generated geometry
    # lives under Scenic/Marble, never beside the authored kit, and every
    # Marble actor is tagged MARBLE_REFERENCE_ONLY or MARBLE_DISTANT_SCENIC.
    dest = C.CONTENT_ROOT + "/Scenic/Marble"
    try:
        paths = tool.import_glb(glb, dest, "SM_MarbleWorld", True)
    except Exception as exc:
        LOG("V2 MARBLE: import failed (%s)" % exc)
        return None
    try:
        meshes = tool.static_meshes(paths)
    except Exception as exc:
        LOG("V2 MARBLE: no placeable mesh after import (%s)" % exc)
        return None
    if not meshes:
        LOG("V2 MARBLE: import produced no static mesh (%d assets)" % len(paths))
        return None
    path, mesh = meshes[0]
    # Nanite on the shell: dense, static, opaque, no WPO -- the ideal case.
    try:
        ns = mesh.get_editor_property("nanite_settings")
        ns.set_editor_property("enabled", bool(L["nanite"]))
        mesh.set_editor_property("nanite_settings", ns)
        eal.save_loaded_asset(mesh)
    except Exception as exc:
        LOG("V2 MARBLE: nanite not set (%s)" % exc)
    # the unlit, single-sided export: two-sided from inside, and its baked
    # lighting raised into the lit world's range
    repaired = 0
    try:
        n = mesh.get_num_sections(0) if hasattr(mesh, "get_num_sections") else 1
    except Exception:
        n = 1
    for slot in range(max(1, int(n))):
        try:
            mat = mesh.get_material(slot)
            if mat is None:
                continue
            tool.set_two_sided(mat)
            tool.apply_unlit_gain(mat, float(L["marbleGain"]))
            repaired += 1
        except Exception as exc:
            LOG("V2 MARBLE: material slot %d not repaired (%s)" % (slot, exc))
    # REGISTRATION, from V1's live measurement: the reconstruction viewpoint is
    # the mesh origin, so the actor origin goes ON the hero camera; the floor
    # is groundOffset native units below it (100 uu per unit after import, x
    # scale); roll 180 corrects the axis; yaw 180 is the artistic facing
    # decided from two rendered frames.
    S = float(L["marbleScale"])
    z = float(L["marbleGroundOffsetM"]) * 100.0 * S
    loc = (0.0, 0.0, z)          # the world origin IS the panorama viewpoint
    actor = None
    try:
        actor = tool.place(path, mesh, loc, (float(L["marbleRollDeg"]), 0.0, float(L["marbleYawDeg"])), S,
                           "V2_MarbleWorld_Scaffold" if not int(L["marbleVisible"]) else "V2_MarbleWorld",
                           ["Marble", "V2_Skyline", "NoCollision", "MARBLE_REFERENCE_ONLY",
                            "Scaffold" if not int(L["marbleVisible"]) else "Visible"],
                           visible=bool(int(L["marbleVisible"])))
    except Exception as exc:
        LOG("V2 MARBLE: place failed (%s)" % exc)
    if actor is not None:
        try:
            actor.set_folder_path(unreal.Name("V2/Scenic/Marble"))
        except Exception:
            pass
        # never collision: the playable world's collision is the kit's
        try:
            for comp in actor.get_components_by_class(unreal.PrimitiveComponent):
                comp.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
        except Exception:
            pass
        assign_layer(actor, "V2_Skyline", layers)
    MANIFEST["marble"] = {"glb": glb, "asset": path, "scale": S, "origin": loc,
                          "rotation_rpy": (L["marbleRollDeg"], 0.0, L["marbleYawDeg"]),
                          "gain": L["marbleGain"], "materials_repaired": repaired, "placed": actor is not None}
    LOG("V2 MARBLE: %s placed %s at %s scale %.4f roll %.0f yaw %.0f gain %.0f (%d material(s) two-sided+gain); "
        "viewpoint at the world origin, floor at z=0"
        % (path, "as a HIDDEN composition SCAFFOLD (marbleVisible=0)" if not int(L["marbleVisible"]) else "VISIBLE",
           loc, S, L["marbleRollDeg"], L["marbleYawDeg"], L["marbleGain"], repaired))
    return actor


# ==========================================================================
# 6b. Marble DISTANT RING -- the Band C experiment (founder, 2026-08-26)
# ==========================================================================
#
# "Evaluate whether the selected Marble world's distant skyline geometry can
# serve as V2 Band C scenery." The scaffold minus everything inside a
# `marbleDistantRadiusM` box around the viewpoint, placed VISIBLE with no
# collision, tagged MARBLE_DISTANT_SCENIC, HLOD far, Nanite. The renders judge
# it (quality / performance / lighting / camera robustness); marbleDistant=0
# removes it and the modular city carries the skyline alone.


def marble_distant_ring(marble_actor, actors, eal, layers, gsctx):
    L = C.LOOK
    if marble_actor is None or not int(L.get("marbleDistant", 0)) or gsctx is None or gsctx.backend != "geometry-script":
        LOG("V2 MARBLE DISTANT: skipped (%s)" % ("no Marble mesh" if marble_actor is None else
                                                  "marbleDistant=0" if not int(L.get("marbleDistant", 0)) else "no Geometry Script"))
        return None
    u = unreal
    try:
        smc = marble_actor.get_component_by_class(u.StaticMeshComponent)
        src_mesh = smc.get_editor_property("static_mesh")
        xf = marble_actor.get_actor_transform()
        inv = xf.inverse() if hasattr(xf, "inverse") else None
    except Exception as exc:
        LOG("V2 MARBLE DISTANT: cannot read the scaffold (%s)" % exc)
        return None
    R = float(L.get("marbleDistantRadiusM", 200.0)) * 100.0
    try:
        dm = gsctx.new_dynamic_mesh()   # no name argument (the stub accepted one; the real class does not)
        gsctx.gs("assets", "copy_mesh_from_static_mesh", src_mesh, dm, u.GeometryScriptCopyMeshFromAssetOptions(),
                 u.GeometryScriptMeshReadLOD())
        n0 = gsctx.gs("queries", "get_num_triangle_i_ds", dm)
        # the inner box in world space -> the mesh's local space (the scaffold is
        # scaled, rolled and yawed), as the bounds of its transformed corners
        corners = [(sx * R, sy * R, z) for sx in (-1, 1) for sy in (-1, 1) for z in (-5000.0, 40000.0)]
        lp = [inv.transform_location(u.Vector(*c)) for c in corners] if inv is not None else [u.Vector(*c) for c in corners]
        bmin = u.Vector(min(v.x for v in lp), min(v.y for v in lp), min(v.z for v in lp))
        bmax = u.Vector(max(v.x for v in lp), max(v.y for v in lp), max(v.z for v in lp))
        # is_valid defaults to False and an invalid box selects NOTHING (the
        # 90 m ring "selected" 0 of 592,580 triangles): same guard as the
        # cut-out code -- constructor kwarg, then both setters, then a check.
        box = None
        try:
            box = u.Box(bmin, bmax, True)
        except Exception:
            box = u.Box(bmin, bmax)
        for setter in (lambda: box.set_editor_property("is_valid", True), lambda: setattr(box, "is_valid", True)):
            try:
                setter()
            except Exception:
                continue
        try:
            LOG("V2 MARBLE DISTANT: box is_valid=%s" % box.get_editor_property("is_valid"))
        except Exception:
            pass
        res = gsctx.gs("selection", "select_mesh_elements_in_box", dm, box, u.GeometryScriptMeshSelectionType.TRIANGLES, False, 1)
        inside = res[1] if isinstance(res, (tuple, list)) and len(res) > 1 else res
        if inside is None:
            LOG("V2 MARBLE DISTANT: selection failed (%s)" % gsctx.caps.errors.get("selection.select_mesh_elements_in_box"))
            return None
        gsctx.gs("edit", ("delete_selected_triangles_from_mesh", "delete_selected_triangles"), dm, inside)
        n1 = gsctx.gs("queries", "get_num_triangle_i_ds", dm)
        folder = C.CONTENT_ROOT + "/Scenic/Marble"
        path = folder + "/SM_MarbleDistantRing"
        if eal.does_asset_exist(path):
            eal.delete_asset(path)
        nopts = u.GeometryScriptCreateNewStaticMeshAssetOptions()
        for prop, val in (("enable_recompute_normals", False), ("enable_recompute_tangents", False),
                          ("enable_nanite", bool(L["nanite"])), ("enable_collision", False)):
            try:
                nopts.set_editor_property(prop, val)
            except Exception:
                pass
        LOG("V2 MARBLE DISTANT: %s triangles in the scaffold, %s beyond %.0f m (local box %s .. %s)"
            % (n0, n1, R / 100.0, (round(bmin.x), round(bmin.y), round(bmin.z)), (round(bmax.x), round(bmax.y), round(bmax.z))))
        if not isinstance(n1, int) or n1 < 100:
            LOG("V2 MARBLE DISTANT: nothing left beyond the radius -- the inner box is wrong or the world is smaller than %.0f m; no ring" % (R / 100.0))
            return None
        if isinstance(n0, int) and n1 == n0:
            LOG("V2 MARBLE DISTANT: the inner box selected NOTHING (%d = %d) -- an invalid box or a wrong local transform; "
                "placing the whole scaffold visible would not be a ring, so no ring" % (n0, n1))
            return None
        r2 = gsctx.gs("newasset", "create_new_static_mesh_asset_from_mesh", dm, path, nopts)
        sm = r2[0] if isinstance(r2, (tuple, list)) else r2
        if sm is None:
            LOG("V2 MARBLE DISTANT: asset not created (outcome %s; error %s)"
                % (r2[1] if isinstance(r2, (tuple, list)) and len(r2) > 1 else r2,
                   gsctx.caps.errors.get("newasset.create_new_static_mesh_asset_from_mesh")))
            return None
        # the scaffold's repaired materials (two-sided, unlit gain) carry over
        try:
            for slot in range(max(1, int(src_mesh.get_num_sections(0)))):
                m = src_mesh.get_material(slot)
                if m is not None:
                    sm.set_material(slot, m)
        except Exception:
            pass
        eal.save_asset(path, only_if_is_dirty=False)
        a = actors.spawn_actor_from_class(u.StaticMeshActor, xf.translation, xf.rotation.rotator())
        a.set_actor_scale3d(xf.scale3d)
        a.static_mesh_component.set_static_mesh(sm)
        a.set_actor_label("V2_MarbleDistantRing")
        a.set_actor_hidden_in_game(False)
        try:
            a.static_mesh_component.set_collision_enabled(u.CollisionEnabled.NO_COLLISION)
        except Exception:
            pass
        try:
            a.set_editor_property("tags", [u.Name(t) for t in ("Marble", "MARBLE_DISTANT_SCENIC", "NoCollision", "BAND_C")])
            a.set_folder_path(u.Name("V2/Scenic/Marble"))
        except Exception:
            pass
        assign_layer(a, "V2_Skyline", layers)
        MANIFEST["marble_distant"] = {"asset": path, "radius_m": R / 100.0, "triangles_before": n0, "triangles_after": n1}
        LOG("V2 MARBLE DISTANT: ring beyond %.0f m placed VISIBLE (%s -> %s triangles), no collision, HLOD far -- the render judges it"
            % (R / 100.0, n0, n1))
        return a
    except Exception as exc:
        LOG("V2 MARBLE DISTANT: FAILED (%s)" % exc)
        return None


# ==========================================================================
# 6c. Marble cut-outs: the reference's own sculpted landmarks, as meshes
# ==========================================================================

#: label -> (world-space box min, max) in the V2 frame, and the authored
#: placements it REPLACES. Boxes come from ANALYSIS.md positions with room.
MARBLE_CUTOUTS = {
    "GiantMushroom": ((600.0, -200.0, -50.0), (3400.0, 2400.0, 2600.0),
                      ("GiantMushroom", "GiantMushroom_Gills", "GiantMushroom_Base", "GiantMushroom_Clock", "GiantMushroom_Ivy0",
                       "GiantMushroom_Ivy1", "GiantMushroom_Vine0", "GiantMushroom_Vine1")),
    "RoseCone_L": ((550.0, -400.0, 40.0), (1250.0, 350.0, 700.0), ("RoseCone_L", "RoseCone_L_Planter")),
    "RoseCone_R": ((-1250.0, -100.0, 40.0), (-450.0, 650.0, 700.0), ("RoseCone_R", "RoseCone_R_Planter")),
    "ClockTree": ((-3200.0, 1100.0, -50.0), (-900.0, 3000.0, 2200.0),
                  ("ClockTree_Trunk", "ClockTree_Clock", "ClockTree_Canopy0", "ClockTree_Canopy1",
                   "ClockTree_Canopy2", "ClockTree_Canopy3", "ClockTree_Vine0", "ClockTree_Vine1")),
    "HeartTopiary": ((-1500.0, 2200.0, 0.0), (-300.0, 3200.0, 1200.0),
                     ("HeartTopiary", "Heart_Terrace", "Heart_Base0", "Heart_Base1")),
    "GardenGate": ((500.0, 1450.0, -20.0), (1300.0, 1950.0, 900.0),
                   ("GardenGate_PierL", "GardenGate_PierR", "GardenGate_LeafL", "GardenGate_LeafR",
                    "GardenGate_FinialL", "GardenGate_FinialR", "GardenGate_IvyL")),
}


def marble_cutouts(marble_actor, actors, eal, layers, gsctx):
    """Cut each MARBLE_CUTOUTS box out of the imported Marble mesh as its own
    static mesh, in the MARBLE mesh's own space, then place it with the same
    actor transform as the scaffold, VISIBLE. Returns the set of authored
    labels the cut-outs replace (empty if nothing was cut)."""
    L = C.LOOK
    replaced = set()
    if marble_actor is None or not int(L["marbleCutouts"]) or gsctx.backend != gs.Backend.GS:
        LOG("V2 MARBLE CUTOUTS: skipped (%s)" % ("no Marble mesh" if marble_actor is None else
                                                  "marbleCutouts=0" if not int(L["marbleCutouts"]) else "no Geometry Script"))
        return replaced
    u = unreal
    try:
        smc = marble_actor.get_component_by_class(u.StaticMeshComponent)
        src_mesh = smc.get_editor_property("static_mesh")   # no get_static_mesh() in 5.8 Python
        xf = marble_actor.get_actor_transform()
    except Exception as exc:
        LOG("V2 MARBLE CUTOUTS: cannot read the scaffold (%s)" % exc)
        return replaced
    try:
        inv = xf.inverse() if hasattr(xf, "inverse") else None
    except Exception:
        inv = None
    for label, (lo, hi, replaces) in MARBLE_CUTOUTS.items():
        try:
            dm = gsctx.new_dynamic_mesh()
            gsctx.gs("assets", "copy_mesh_from_static_mesh", src_mesh, dm, u.GeometryScriptCopyMeshFromAssetOptions(),
                     u.GeometryScriptMeshReadLOD())
            # world box -> the mesh's local space (the scaffold's transform is
            # a rotation + uniform scale + translation, so the local box is the
            # transformed corners' bounds)
            corners = [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
            if inv is not None:
                lp = [inv.transform_location(u.Vector(*c)) for c in corners]
                bmin = u.Vector(min(p.x for p in lp), min(p.y for p in lp), min(p.z for p in lp))
                bmax = u.Vector(max(p.x for p in lp), max(p.y for p in lp), max(p.z for p in lp))
            else:
                bmin, bmax = u.Vector(*lo), u.Vector(*hi)
            # VERIFIED: unreal.Box(min, max) -- is_valid is a PROPERTY that
            # defaults to False, and an invalid box selects nothing
            box = u.Box(bmin, bmax)
            for setter in (lambda: box.set_editor_property("is_valid", True), lambda: setattr(box, "is_valid", True)):
                try:
                    setter()
                    break
                except Exception:
                    continue
            # VERIFIED 5.5 API: select_mesh_elements_in_box(target, box,
            # selection_type, invert, min_num_triangle_points) RETURNS
            # (mesh, selection) -- `invert=True` selects everything OUTSIDE
            # the box, which is exactly what is deleted.
            res = gsctx.gs("selection", "select_mesh_elements_in_box", dm, box,
                           u.GeometryScriptMeshSelectionType.TRIANGLES, True, 3)
            outside = res[1] if isinstance(res, (tuple, list)) and len(res) > 1 else res
            gsctx.gs("edit", ("delete_selected_triangles_from_mesh", "delete_selected_triangles"), dm, outside)
            n_tri = gsctx.gs("queries", ("get_num_triangle_i_ds", "get_num_triangle_ids", "get_num_triangles"), dm)
            if not isinstance(n_tri, int) or n_tri < 50:
                LOG("V2 MARBLE CUTOUT %s: %s triangles in the box; skipped" % (label, n_tri))
                continue
            # save as its own asset, keep the Marble material
            folder = C.CONTENT_ROOT + "/Marble/Cutouts"
            name = "SM_Marble_" + label
            path = folder + "/" + name
            if eal.does_asset_exist(path):
                eal.delete_asset(path)
            # factory-free empty asset (StaticMeshFactoryNew does not exist in
            # 5.8 Python): a copy of the engine cube, replaced entirely below
            sm = eal.duplicate_asset("/Engine/BasicShapes/Cube", folder + "/" + name)
            if sm is None:
                raise RuntimeError("duplicate_asset returned None for %s" % name)
            opts = u.GeometryScriptCopyMeshToAssetOptions()
            for prop, val in (("enable_recompute_normals", False), ("emit_transaction", False), ("replace_materials", True)):
                try:
                    opts.set_editor_property(prop, val)
                except Exception:
                    pass
            try:
                mat0 = src_mesh.get_material(0)
                opts.set_editor_property("new_materials", [mat0])
            except Exception:
                pass
            try:
                ns = u.GeometryScriptNaniteOptions()
                ns.set_editor_property("enabled", bool(L["nanite"]))
                opts.set_editor_property("apply_nanite_settings", True)
                opts.set_editor_property("nanite_settings", ns)
            except Exception:
                pass
            gsctx.gs("assets", "copy_mesh_to_static_mesh", dm, sm, opts, u.GeometryScriptMeshWriteLOD())
            eal.save_asset(path, only_if_is_dirty=False)
            a = actors.spawn_actor_from_class(u.StaticMeshActor, xf.translation if hasattr(xf, "translation") else vec((0, 0, 0)),
                                              rot(0, 0, 0))
            if a is None:
                continue
            try:
                a.set_actor_transform(xf, False, False)
            except Exception:
                pass
            comp = a.get_component_by_class(u.StaticMeshComponent)
            if comp is not None:
                try:
                    comp.set_mobility(u.ComponentMobility.MOVABLE)
                except Exception:
                    pass
                comp.set_static_mesh(sm)
                try:
                    comp.set_collision_enabled(u.CollisionEnabled.NO_COLLISION)
                except Exception:
                    pass
            a.set_actor_label("V2_MarbleCutout_" + label)
            try:
                a.set_folder_path(u.Name("V2/Marble/Cutouts"))
            except Exception:
                pass
            assign_layer(a, "V2_Garden", layers)
            replaced.update(replaces)
            LOG("V2 MARBLE CUTOUT %s: %d triangles -> %s, placed VISIBLE; replaces %d authored placements"
                % (label, n_tri, path, len(replaces)))
        except Exception as exc:
            LOG("V2 MARBLE CUTOUT %s: failed (%s); the authored kit stands" % (label, exc))
    MANIFEST["marble_cutouts"] = sorted(MARBLE_CUTOUTS) if replaced else []
    return replaced


# ==========================================================================
# 8. light and atmosphere
# ==========================================================================


def light_and_air(actors, layers):
    L = C.LOOK
    sun = actors.spawn_actor_from_class(unreal.DirectionalLight, vec((0, 0, 2000)), rot(L["sunPitch"], L["sunYaw"], 0))
    sun.set_actor_label("V2_Sun")
    dc = sun.get_component_by_class(unreal.DirectionalLightComponent)
    if dc is not None:
        try:
            dc.set_mobility(unreal.ComponentMobility.MOVABLE)
        except Exception:
            pass
        try:
            dc.set_intensity(float(L["sunLux"]))
        except Exception:
            set_prop(dc, "Intensity", float(L["sunLux"]))
        set_prop(dc, "bUseTemperature", True)
        set_prop(dc, "Temperature", float(L["sunTemperatureK"]))
        set_prop(dc, "bAtmosphereSunLight", True)
        set_prop(dc, "VolumetricScatteringIntensity", 1.0)
        set_prop(dc, "bCastVolumetricShadow", True)
        set_prop(dc, "LightSourceAngle", 1.2)
        set_prop(dc, "DynamicShadowCascades", 4)
    bounce = int(L.get("bounceLight", 0))
    if bounce:
        # PASS 05b: ground bounce as a shadowless light pointing UP (pitch
        # +90 sends the light upward, so it reaches downward-facing surfaces:
        # leaf undersides, cornices, the mushroom cap). See v2_config.LOOK.
        bl = actors.spawn_actor_from_class(unreal.DirectionalLight, vec((0, 0, 300)), rot(L["bouncePitch"], 0, 0))
        bl.set_actor_label("V2_GroundBounce")
        bc = bl.get_component_by_class(unreal.DirectionalLightComponent)
        if bc is not None:
            try:
                bc.set_mobility(unreal.ComponentMobility.MOVABLE)
            except Exception:
                pass
            try:
                bc.set_intensity(float(L["bounceLux"]))
            except Exception:
                set_prop(bc, "Intensity", float(L["bounceLux"]))
            r, g, b = L["bounceColor"]
            set_prop(bc, "LightColor", unreal.Color(int(r), int(g), int(b), 255))
            set_prop(bc, "bUseTemperature", False)
            set_prop(bc, "CastShadows", False)
            set_prop(bc, "bAtmosphereSunLight", False)
            set_prop(bc, "VolumetricScatteringIntensity", 0.0)
            set_prop(bc, "bCastVolumetricShadow", False)
        try:
            bl.set_folder_path(unreal.Name("V2/Light"))
        except Exception:
            pass
        assign_layer(bl, "V2_Skyline", layers)
    sky = actors.spawn_actor_from_class(unreal.SkyAtmosphere, vec((0, 0, 0)), rot(0, 0, 0))
    sky.set_actor_label("V2_SkyAtmosphere")
    sac = sky.get_component_by_class(unreal.SkyAtmosphereComponent)
    if sac is not None:
        f = float(L.get("skyLuminanceFactor", 1.0))
        ok_l = set_prop(sac, "SkyLuminanceFactor", unreal.LinearColor(f, f, f, 1.0))
        ok_m = set_prop(sac, "MieScatteringScale", float(L.get("mieScatteringScale", 0.003996)))
        LOG("V2 ATMOSPHERE: sky luminance x%.2f %s, Mie scale %.4f %s"
            % (f, "set" if ok_l else "NOT SET", float(L.get("mieScatteringScale", 0.003996)), "set" if ok_m else "NOT SET"))
    sl = actors.spawn_actor_from_class(unreal.SkyLight, vec((0, 0, 500)), rot(0, 0, 0))
    sl.set_actor_label("V2_SkyLight")
    sc = sl.get_component_by_class(unreal.SkyLightComponent)
    if sc is not None:
        try:
            sc.set_mobility(unreal.ComponentMobility.MOVABLE)
        except Exception:
            pass
        realtime = str(L.get("skyLightCapture", "realtime")) == "realtime"
        set_prop(sc, "bRealTimeCapture", realtime)
        if not realtime:
            # one capture of the SCENE at load (sunlit plaza below = ground
            # bounce); a Movable sky light captures when it registers
            try:
                set_prop(sc, "SourceType", unreal.SkyLightSourceType.SLS_CAPTURED_SCENE)
            except Exception as exc:
                LOG("V2 LIGHT: sky light SourceType not set (%s)" % exc)
        set_prop(sc, "Intensity", float(L["skyLightIntensity"]))
        set_prop(sc, "bLowerHemisphereIsBlack", False)
    # PASS 06: 3D clouds -- the dome paints sky only now, the low sky needs
    # real cumulus. The engine's VolumetricCloud actor ships with its default
    # cloud material; the layer sits 4-10 km up (LOOK cloudLayer*).
    if int(L.get("volumetricClouds", 0)):
        try:
            vc = actors.spawn_actor_from_class(unreal.VolumetricCloud, vec((0, 0, 0)), rot(0, 0, 0))
        except Exception as exc:
            vc = None
            LOG("V2 CLOUDS: VolumetricCloud not spawned (%s)" % exc)
        if vc is not None:
            vc.set_actor_label("V2_Clouds")
            vcc = vc.get_component_by_class(unreal.VolumetricCloudComponent)
            if vcc is not None:
                set_prop(vcc, "LayerBottomAltitude", float(L["cloudLayerBottomKm"]))
                set_prop(vcc, "LayerHeight", float(L["cloudLayerHeightKm"]))
                # PASS 06b: our own instance of the engine cloud material
                try:
                    mel = unreal.MaterialEditingLibrary
                    eal_ = unreal.EditorAssetLibrary   # light_and_air has no eal of its own (main's is local)
                    parent = eal_.load_asset("/Engine/EngineSky/VolumetricClouds/m_SimpleVolumetricCloud")
                    pkg = C.FOLDERS["mat_instances"]
                    cpath = pkg + "/MI_V2_Clouds"
                    if eal_.does_asset_exist(cpath):
                        eal_.delete_asset(cpath)
                    cmi = unreal.AssetToolsHelpers.get_asset_tools().create_asset("MI_V2_Clouds", pkg, unreal.MaterialInstanceConstant,
                                                                                  unreal.MaterialInstanceConstantFactoryNew())
                    if parent is None or cmi is None:
                        raise RuntimeError("cloud material parent or instance missing")
                    try:
                        mel.set_material_instance_parent(cmi, parent)
                    except Exception:
                        cmi.set_editor_property("parent", parent)
                    mel.set_material_instance_scalar_parameter_value(cmi, "Cloud_GlobalCoverage", float(L["cloudCoverage"]))
                    mel.set_material_instance_scalar_parameter_value(cmi, "Cloud_GlobalDensity", float(L["cloudDensity"]))
                    eal_.save_asset(cpath, only_if_is_dirty=False)
                    set_prop(vcc, "Material", cmi)
                    LOG("V2 CLOUDS: MI_V2_Clouds coverage %.2f density %.2f" % (L["cloudCoverage"], L["cloudDensity"]))
                except Exception as exc:
                    LOG("V2 CLOUDS FAILED: cloud instance not applied (%s) -- the engine default (overcast) stands" % exc)
            try:
                vc.set_folder_path(unreal.Name("V2/Light"))
            except Exception:
                pass
            assign_layer(vc, "V2_Skyline", layers)
            LOG("V2 CLOUDS: volumetric cloud layer %.1f-%.1f km" % (L["cloudLayerBottomKm"], L["cloudLayerBottomKm"] + L["cloudLayerHeightKm"]))
    fog = actors.spawn_actor_from_class(unreal.ExponentialHeightFog, vec((0, 0, 0)), rot(0, 0, 0))
    fog.set_actor_label("V2_HeightFog")
    fc = fog.get_component_by_class(unreal.ExponentialHeightFogComponent)
    if fc is not None:
        set_prop(fc, "FogDensity", float(L["fogDensity"]))
        set_prop(fc, "FogHeightFalloff", float(L["fogFalloff"]))
        set_prop(fc, "StartDistance", float(L["fogStartDistance"]))
        c = L["fogInscattering"]
        set_prop(fc, "FogInscatteringLuminance", unreal.LinearColor(c[0], c[1], c[2], 1.0))
        set_prop(fc, "bEnableVolumetricFog", bool(L["volumetricFog"]))
        set_prop(fc, "VolumetricFogScatteringDistribution", 0.3)
        set_prop(fc, "VolumetricFogExtinctionScale", float(L["fogScattering"]))
    # the portal's own light: localised violet
    pl = actors.spawn_actor_from_class(unreal.PointLight, vec((0, 0, 140)), rot(0, 0, 0))
    pl.set_actor_label("V2_PortalLight")
    pc = pl.get_component_by_class(unreal.PointLightComponent)
    if pc is not None and int(L["portal"]):
        try:
            pc.set_mobility(unreal.ComponentMobility.MOVABLE)
        except Exception:
            pass
        set_prop(pc, "Intensity", float(L["portalLightIntensity"]))
        set_prop(pc, "LightColor", unreal.Color(176, 108, 255, 255))
        set_prop(pc, "AttenuationRadius", 1600.0)
        set_prop(pc, "SourceRadius", 120.0)
        set_prop(pc, "bCastShadows", False)
    # the post-process volume: unbound, the V2 grade
    ppv = actors.spawn_actor_from_class(unreal.PostProcessVolume, vec((0, 0, 0)), rot(0, 0, 0))
    ppv.set_actor_label("V2_PostProcess")
    set_prop(ppv, "bUnbound", True)
    try:
        s = ppv.get_editor_property("settings")
        _grade(s)
        ppv.set_editor_property("settings", s)
    except Exception as exc:
        LOG("V2 POST: volume settings not applied (%s)" % exc)
    for a, band in ((sun, "V2_Skyline"), (sky, "V2_Skyline"), (sl, "V2_Skyline"), (fog, "V2_Skyline"),
                    (pl, "V2_VFX"), (ppv, "V2_Skyline")):
        try:
            a.set_folder_path(unreal.Name("V2/Light"))
        except Exception:
            pass
        assign_layer(a, band, layers)
    LOG("V2 LIGHT: sun %.0f lux at pitch %.0f yaw %.0f, %dK; sky light %.1f (%s capture); ground bounce %s; fog %.3f; portal light %.0f"
        % (L["sunLux"], L["sunPitch"], L["sunYaw"], L["sunTemperatureK"], L["skyLightIntensity"],
           L.get("skyLightCapture", "realtime"), ("%.0f lux up" % L["bounceLux"]) if bounce else "off",
           L["fogDensity"], L["portalLightIntensity"]))
    LOG("V2 LUMEN: skylight leaking %.2f; foliage distance-field lighting %s"
        % (float(L.get("lumenSkylightLeaking", 0.0)), "on" if int(L.get("foliageDistanceFieldLighting", 1)) else "OFF"))


def _grade(s):
    L = C.LOOK
    pairs = [("override_bloom_intensity", True), ("bloom_intensity", float(L["bloomIntensity"])),
             ("override_bloom_threshold", True), ("bloom_threshold", float(L["bloomThreshold"])),
             ("override_color_gain_shadows", True), ("color_gain_shadows", unreal.Vector4(*(tuple(L["gradeShadows"]) + (1.0,)))),
             ("override_color_gain_midtones", True), ("color_gain_midtones", unreal.Vector4(*(tuple(L["gradeMidtones"]) + (1.0,)))),
             ("override_color_gain_highlights", True), ("color_gain_highlights", unreal.Vector4(*(tuple(L["gradeHighlights"]) + (1.0,)))),
             ("override_auto_exposure_method", True), ("auto_exposure_method", getattr(getattr(unreal, "AutoExposureMethod", None), "AEM_HISTOGRAM", None)),
             ("override_auto_exposure_bias", True), ("auto_exposure_bias", float(L.get("exposureBias", 0.0))),
             ("override_auto_exposure_min_brightness", L.get("exposurePinEV100") is not None),
             ("auto_exposure_min_brightness", float(L["exposurePinEV100"]) if L.get("exposurePinEV100") is not None else None),
             ("override_auto_exposure_max_brightness", L.get("exposurePinEV100") is not None),
             ("auto_exposure_max_brightness", float(L["exposurePinEV100"]) if L.get("exposurePinEV100") is not None else None),
             ("override_lumen_final_gather_quality", True), ("lumen_final_gather_quality", 2.0),
             ("override_lumen_reflection_quality", True), ("lumen_reflection_quality", 2.0),
             ("override_lumen_scene_detail", True), ("lumen_scene_detail", 2.0),
             ("override_lumen_skylight_leaking", True), ("lumen_skylight_leaking", float(L.get("lumenSkylightLeaking", 0.0)))]
    for n, v in pairs:
        if v is None:
            continue
        try:
            s.set_editor_property(n, v)
        except Exception:
            pass


# ==========================================================================
# 9. the camera
# ==========================================================================


def hero_camera(actors, layers):
    """Every camera in v2_config.HERO_CAMS, locked. HeroCam0 is the capture
    default (the reconstruction viewpoint); HeroCam1 looks through the gate."""
    cams = []
    for H in C.HERO_CAMS:
        cam = actors.spawn_actor_from_class(unreal.CameraActor, vec(H["location"]), rot(*H["rotation"]))
        cam.set_actor_label(H["name"])
        cc = cam.get_component_by_class(unreal.CameraComponent)
        if cc is not None:
            try:
                cc.set_field_of_view(float(H["fov"]))
            except Exception:
                set_prop(cc, "FieldOfView", float(H["fov"]))
            try:
                pp = cc.get_editor_property("post_process_settings")
                _grade(pp)
                cc.set_editor_property("post_process_settings", pp)
                cc.set_editor_property("post_process_blend_weight", 1.0)
            except Exception as exc:
                LOG("V2 CAMERA: post-process not applied (%s)" % exc)
        try:
            cam.set_editor_property("tags", [unreal.Name(t) for t in H["tags"]])
        except Exception:
            pass
        try:
            cam.set_folder_path(unreal.Name("V2/Camera"))
        except Exception:
            pass
        LOG("V2 CAMERA: %s at %s rot %s fov %.0f tags %s -- LOCKED"
            % (H["name"], H["location"], H["rotation"], H["fov"], "/".join(H["tags"])))
        cams.append(cam)
    # THE ARRIVAL SPAWN: a PlayerStart where PlayerCam01 stands, facing the
    # gate, so "near the player spawn" is a fact of the map and not a guess.
    try:
        P1 = C.HERO_CAMS[1]
        ps = actors.spawn_actor_from_class(unreal.PlayerStart, vec((P1["location"][0], P1["location"][1], 100.0)),
                                           rot(0.0, P1["rotation"][1], 0.0))
        if ps is not None:
            ps.set_actor_label("V2_ArrivalSpawn")
            try:
                ps.set_folder_path(unreal.Name("V2/Camera"))
            except Exception:
                pass
            LOG("V2 SPAWN: PlayerStart at %s yaw %.0f (PlayerCam01's point)" % (ps.get_actor_location(), P1["rotation"][1]))
    except Exception as exc:
        LOG("V2 SPAWN: PlayerStart not placed (%s)" % exc)
    # THE SCALE REFERENCE: one canonical Relay Dog for ScaleCam07, loaded by
    # class path; a missing class is reported, never silently skipped, and
    # never replaced by a stand-in (the Dog is frozen; there is no other).
    L = C.LOOK
    MANIFEST["scale_dog"] = {"placed": False}
    if int(L.get("scaleDog", 0)):
        dog_cls = None
        try:
            dog_cls = unreal.load_class(None, str(L["scaleDogClass"]))
        except Exception:
            dog_cls = None
        if dog_cls is None:
            LOG("V2 SCALE DOG: class %s did not load -- ScaleCam07 has NO scale reference" % L["scaleDogClass"])
        else:
            dog = actors.spawn_actor_from_class(dog_cls, vec(L["scaleDogPos"]), rot(0.0, float(L["scaleDogYaw"]), 0.0))
            if dog is None:
                LOG("V2 SCALE DOG: spawn failed -- ScaleCam07 has NO scale reference")
            else:
                dog.set_actor_label("Scale_CanonicalDog")
                # BP_RelayDog is a Character. This world has no gameplay
                # collision under the plaza (only steps, walls, balustrades and
                # hedge blocks collide), so at BeginPlay its capsule fell
                # through the flagstones and SUITE01's ScaleCam07 showed no
                # Dog. A scale reference does not walk: movement mode None,
                # no gravity, it stands where it is placed.
                cmc = dog.get_component_by_class(unreal.CharacterMovementComponent)
                if cmc is not None:
                    ok_mode = set_prop(cmc, "DefaultLandMovementMode", unreal.MovementMode.MOVE_NONE)
                    ok_grav = set_prop(cmc, "GravityScale", 0.0)
                    LOG("V2 SCALE DOG: movement None %s, gravity 0 %s (no collision under the plaza)"
                        % ("set" if ok_mode else "NOT SET", "set" if ok_grav else "NOT SET"))
                else:
                    LOG("V2 SCALE DOG: no CharacterMovementComponent found -- it may fall through the plaza")
                try:
                    dog.set_editor_property("tags", [unreal.Name("ScaleReference"), unreal.Name("CanonicalDog")])
                except Exception:
                    pass
                try:
                    dog.set_folder_path(unreal.Name("V2/Camera"))
                except Exception:
                    pass
                assign_layer(dog, "V2_Arrival", layers)
                MANIFEST["scale_dog"] = {"placed": True, "pos": list(L["scaleDogPos"]), "yaw": float(L["scaleDogYaw"])}
                LOG("V2 SCALE DOG: one canonical Relay Dog at %s yaw %.0f, behind HeroCam0, for ScaleCam07"
                    % (L["scaleDogPos"], L["scaleDogYaw"]))
    return cams


# ==========================================================================
# main
# ==========================================================================


def main():
    t0 = time.time()
    phase("record")
    try:
        LOG("V2 ENGINE: %s" % unreal.SystemLibrary.get_engine_version())
    except Exception:
        pass
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    eal = unreal.EditorAssetLibrary
    lsu = unreal.EditorLoadingAndSavingUtils

    phase("map")
    world, how = new_map(actors, eal, lsu)

    phase("data-layers")
    layers, layer_mode = make_data_layers()
    MANIFEST["data_layers"] = layer_mode
    phase("hlod")
    _HLOD.update(make_hlod_layers(world))

    phase("materials")
    texs = MAT.import_textures(unreal, LOG)
    mats = MAT.build_materials(unreal, LOG, texs)
    # THE DOG'S MATERIALS. MI_RelayDog_Ivory / _Visor / _Eye are children of
    # M_V2_Surface / M_V2_Portal, and the masters are deleted and recreated
    # above on every generate -- so the Dog's instances were orphaned and
    # ScaleCam07 (V2_PASS_052) showed a charcoal Dog. Rebuilt on the fresh
    # masters here, from dog_canon, at the same asset paths the blueprint holds.
    if int(C.LOOK.get("scaleDog", 0)):
        try:
            import dog_v2 as DOG
            dog_mats = DOG.build_materials()
            LOG("V2 SCALE DOG: %d material instances rebuilt on the fresh masters" % len(dog_mats))
        except Exception as exc:
            LOG("V2 SCALE DOG FAILED: materials not rebuilt (%s) -- the Dog will render in the engine default" % exc)
    MANIFEST["materials"] = len(mats)

    phase("assets")
    ctx = gs.Context(unreal, LOG, force_fallback=os.environ.get("WLV2_FORCE_FALLBACK", "0") == "1")
    MANIFEST["backend"] = ctx.backend
    MANIFEST["gs_capability"] = ctx.caps.report()
    asset_paths = ASSETS.build_assets(ctx, log=LOG)
    MANIFEST["assets"] = {k: v for k, v in asset_paths.items()}
    MANIFEST["asset_detail"] = [{"name": n, "path": p, "backend": b, "tris": t, "notes": notes}
                                for (n, p, b, t, notes) in ctx.saved]
    MANIFEST["failures"].extend(["asset %s: %s" % f for f in ctx.failed])
    gs_n = sum(1 for s in ctx.saved if s[2] == gs.Backend.GS)
    LOG("V2 ASSETS: %d saved (%d geometry-script, %d FALLBACK), %d failed"
        % (len(ctx.saved), gs_n, len(ctx.saved) - gs_n, len(ctx.failed)))

    phase("ground")
    placer = Placer(actors, eal, asset_paths, mats, layers)
    has_landscape = False
    try:
        for a in actors.get_all_level_actors():
            if "Landscape" in a.get_class().get_name():
                has_landscape = True
                break
    except Exception:
        pass
    if not has_landscape:
        g = actors.spawn_actor_from_class(unreal.StaticMeshActor, vec((0, 0, -30)), rot(0, 0, 0))
        if g is not None:
            g.set_actor_label("V2_GroundSlab")
            smc = g.get_component_by_class(unreal.StaticMeshComponent)
            cube = eal.load_asset("/Engine/BasicShapes/Cube")
            if smc is not None and cube is not None:
                # THE ONE ENGINE PRIMITIVE IN V2: a 400 m ground slab under
                # the flagstones and beds, wearing moss, present only when the
                # map has no landscape. It is terrain, not an art asset.
                smc.set_static_mesh(cube)
                # PASS 06: +/- 600 m -- the far band stands at 300-420 m and
                # the fog needs ground to fade into, not the atmosphere's floor
                g.set_actor_scale3d(vec((1200.0, 1200.0, 0.6)))
                if "MI_V2_Moss" in mats:
                    smc.set_material(0, mats["MI_V2_Moss"])
            assign_layer(g, "V2_Arrival", layers)
        LOG("V2 GROUND: no landscape in the map; a moss ground slab stands in for terrain")
    else:
        LOG("V2 GROUND: the template's landscape is the terrain")
    phase("marble")
    marble = marble_world(actors, eal, layers)
    replaced = marble_cutouts(marble, actors, eal, layers, ctx)
    marble_distant_ring(marble, actors, eal, layers, ctx)
    MANIFEST["actors"]["flagstones"] = lay_ground(placer, actors, eal, asset_paths, mats, layers,
                                                  plaza_only=(marble is not None and int(C.LOOK["marbleVisible"])))

    phase("composition")
    bands = [LAYOUT.FOREGROUND, LAYOUT.COURTYARD, LAYOUT.GARDEN, LAYOUT.PALACE]
    if marble is not None and int(C.LOOK["marbleVisible"]):
        bands = [LAYOUT.FOREGROUND]
        LOG("V2 COMPOSITION: Marble world VISIBLE -- only the foreground is placed in front of it")
    skipped = 0
    for band in bands:
        for item in band:
            if item.get("label") in replaced:
                skipped += 1
                continue
            placer.place(item)
    if skipped:
        LOG("V2 COMPOSITION: %d authored placements replaced by Marble cut-outs" % skipped)
    if int(C.LOOK["portal"]) and "portal_disc" in asset_paths:
        r = float(C.LOOK["portalRadius"]) / 630.0
        for key, sc, lb in (("portal_disc", r, "Portal_Runes"), ("portal_ring", r * 1.0, "Portal_RingOuter"),
                            ("portal_ring", r * 0.7, "Portal_RingInner")):
            placer.place({"asset": key, "pos": (0.0, 0.0, 2.0 if key == "portal_disc" else 3.0), "rot": (0, 0, 0),
                          "scale": (sc, sc, 1.0), "mat": "MI_V2_PortalRunes" if key == "portal_disc" else "MI_V2_PortalGlow",
                          "label": lb, "band": "V2_VFX"})
        LOG("V2 PORTAL: restrained rune disc, radius %.0f uu, at the viewpoint" % C.LOOK["portalRadius"])
    for item in LAYOUT.SKY:
        if int(C.LOOK["skyDome"]) and "MI_V2_SkyPano" in mats:
            placer.place(item)
        else:
            LOG("V2 SKY: dome skipped (%s)" % ("skyDome=0" if not int(C.LOOK["skyDome"]) else "no panorama material"))
    for item in LAYOUT.HOVER:
        placer.place(item, hover=True, batch=False)

    phase("dressing")
    dressed = 0
    if int(C.LOOK.get("dressing", 1)):
        plan = DRESS.plan(density=float(C.LOOK.get("dressingDensity", 1.0)))
        for item in plan:
            if placer.place(item) is not None:
                dressed += 1
        LOG("V2 DRESSING: %d secondary placements in the garden zones (%s); plaza and corridor excluded"
            % (dressed, DRESS.summary(plan)))
    MANIFEST["actors"]["dressing"] = dressed
    MANIFEST["actors"]["batches"] = placer.flush() if placer.batch_cls else 0
    if placer.df_excluded or placer.df_failed:
        LOG("V2 FOLIAGE DF: %d foliage actors excluded from distance-field lighting, %d refused the property"
            % (placer.df_excluded, placer.df_failed))
    MANIFEST["actors"]["foliage_df_excluded"] = placer.df_excluded
    MANIFEST["actors"].update(placer.count)
    if placer.missing:
        LOG("V2 COMPOSITION: placements skipped for assets that did not build: %s"
            % ", ".join("%s x%d" % kv for kv in sorted(placer.missing.items())))
    LOG("V2 COMPOSITION: " + ", ".join("%s %d" % kv for kv in sorted(placer.count.items())))

    phase("light")
    light_and_air(actors, layers)

    phase("camera")
    hero_camera(actors, layers)

    phase("save")
    saved = False
    # A FRESH level has no filename yet: LevelEditorSubsystem.save_current_level
    # refuses with "Use EditorLoadingAndSavingUtils". save_map names and writes
    # it (proven on the classic diagnostic map), so it is tried too.
    _util = unreal.EditorLoadingAndSavingUtils
    for saver in (lambda: lsu.save_current_level(),
                  lambda: _util.save_map(unreal.EditorLevelLibrary.get_editor_world(), C.MAP_PATH),
                  lambda: _util.save_packages([unreal.EditorLevelLibrary.get_editor_world().get_outermost()], False)):
        try:
            if saver():
                saved = True
                break
        except Exception as exc:
            LOG("V2 SAVE: %s" % exc)
    try:
        eal.save_directory(C.CONTENT_ROOT, only_if_is_dirty=False, recursive=True)
    except Exception as exc:
        LOG("V2 SAVE: save_directory %s" % exc)
    # THE ACTORS OF A WORLD PARTITION LEVEL ARE EXTERNAL PACKAGES. save_current_level
    # writes the 11 KB map and save_directory writes assets; neither writes
    # __ExternalActors__, so the first three packages cooked an EMPTY world
    # (runtime: WL_TAG_VISIBILITY shown=0, every frame black). VERIFIED 5.5 API:
    # EditorLoadingAndSavingUtils.save_dirty_packages(save_map_packages,
    # save_content_packages) saves every dirty package, actors included.
    ext_saved = None
    try:
        util = getattr(unreal, "EditorLoadingAndSavingUtils", None)
        if util is not None:
            ext_saved = bool(util.save_dirty_packages(True, True))
            LOG("V2 SAVE: save_dirty_packages(map, content) -> %s" % ext_saved)
    except Exception as exc:
        LOG("V2 SAVE: save_dirty_packages %s" % exc)
    # save_dirty_packages returned True and wrote NOTHING (0 actor packages for
    # 448 actors, 2026-08-26 10:20Z): programmatically spawned actors' external
    # packages are not flagged dirty. So: take every actor's package by handle
    # and save the lot regardless of the dirty flag (VERIFIED 5.5 API:
    # EditorLoadingAndSavingUtils.save_packages(packages, only_dirty)). Log
    # where the packages live -- a /Temp or transient outer is a different bug.
    try:
        util = getattr(unreal, "EditorLoadingAndSavingUtils", None)
        pkgs, names = [], []
        for a in actors.get_all_level_actors():
            try:
                pk = a.get_outermost()
            except Exception:
                continue
            if pk is None:
                continue
            nm = pk.get_name() if hasattr(pk, "get_name") else str(pk)
            if nm not in names:
                names.append(nm)
                pkgs.append(pk)
        LOG("V2 SAVE: %d distinct actor package(s); e.g. %s" % (len(pkgs), " | ".join(names[:3])))
        if util is not None and pkgs:
            ok = util.save_packages(pkgs, False)
            LOG("V2 SAVE: save_packages(%d, only_dirty=False) -> %s" % (len(pkgs), ok))
    except Exception as exc:
        LOG("V2 SAVE: explicit package save failed (%s)" % exc)
    # TRIPWIRE: count the actor packages on disk. A world that saved no actors
    # must not cook -- that is a black frame forty minutes later.
    ext_count = None
    try:
        cdir = str(unreal.Paths.project_content_dir())
        # UE 5.x keeps them under Content/__ExternalActors__/<map folder>/<map>/
        # (the log's package names prove it), not under the map's own folder.
        ext_dir = os.path.join(cdir, "__ExternalActors__", C.CONTENT_ROOT.replace("/Game/", ""), "Maps", C.MAP_PATH.rsplit("/", 1)[-1])
        if os.path.isdir(cdir):
            ext_count = 0
            for _root, _dirs, files in os.walk(ext_dir):
                ext_count += sum(1 for f in files if f.endswith(".uasset"))
            LOG("V2 SAVE: %d external actor package(s) under %s" % (ext_count, ext_dir))
    except Exception as exc:
        LOG("V2 SAVE: external actor count unavailable (%s)" % exc)
    # The other legitimate shape: actors INSIDE the map package (a classic
    # level, or a partitioned level whose actors were not made external). Then
    # the .umap itself carries them and grows from ~11 KB to megabytes.
    umap_bytes = None
    try:
        cdir = str(unreal.Paths.project_content_dir())
        umap = os.path.join(cdir, C.CONTENT_ROOT.replace("/Game/", ""), "Maps", C.MAP_PATH.rsplit("/", 1)[-1] + ".umap")
        if os.path.isfile(umap):
            umap_bytes = os.path.getsize(umap)
            LOG("V2 SAVE: %s is %d bytes" % (umap, umap_bytes))
    except Exception as exc:
        LOG("V2 SAVE: umap size unavailable (%s)" % exc)
    MANIFEST["saved"] = saved
    MANIFEST["external_actor_packages"] = ext_count
    MANIFEST["umap_bytes"] = umap_bytes
    # the final actor list, for the outliner evidence
    final = []
    try:
        for a in actors.get_all_level_actors():
            final.append("%s:%s" % (a.get_class().get_name(), a.get_actor_label()))
    except Exception:
        pass
    MANIFEST["final_actors"] = final
    v1_in_final = [n for n in final if any(m in n for m in V1_CLASS_MARKERS[1:] + ("SkyCity", "PlazaBed", "RelayDog", "HDAR_"))]
    MANIFEST["v1_actors_in_final"] = v1_in_final
    MANIFEST["seconds"] = round(time.time() - t0, 1)
    # An EMPTY level package is 6-11 KB; the classic V2 world with 445 actors
    # measured 877,890 bytes. 100 KB separates them with room to spare (the
    # first threshold was 1 MB and refused a perfectly good map).
    actors_in_map = umap_bytes is not None and umap_bytes > 100000
    if ext_count is not None and len(final) > 20 and ext_count < int(0.9 * len(final)) and not actors_in_map:
        raise RuntimeError("V2 SAVE: only %d external actor packages on disk for %d actors and the map is %s bytes -- the level would cook EMPTY; refusing"
                           % (ext_count, len(final), umap_bytes))
    LOG("V2 SAVE: actors on disk as %s" % ("%d external packages" % ext_count if (ext_count or 0) >= int(0.9 * len(final))
                                            else "the map package (%s bytes)" % umap_bytes if actors_in_map else "NOTHING"))
    MANIFEST["performance"] = PERF
    LOG("V2 PERFORMANCE: hlod layers %s; grid %s; actors by band %s"
        % (", ".join(sorted(PERF["layers"].values())) or "none", PERF["grid"],
           ", ".join("%s=%d" % kv for kv in sorted(PERF["counts"].items())) or "none"))
    out = os.environ.get("WLV2_MANIFEST", "/tmp/wlv2-manifest.json")
    try:
        with open(out, "w") as f:
            json.dump(MANIFEST, f, indent=1, default=str)
    except Exception as exc:
        LOG("V2 MANIFEST: not written (%s)" % exc)
    LOG("V2 SUMMARY: map=%s created_by=%s wp=%s saved=%s assets=%d/%d backend=%s materials=%d actors=%d "
        "flagstones=%s v1_actors=%d data_layers=%s seconds=%.0f"
        % (C.MAP_PATH, how, MANIFEST["world_partition"], saved, len(asset_paths),
           len(ASSETS.known_asset_keys()), ctx.backend, len(mats), len(final),
           MANIFEST["actors"].get("flagstones"), len(v1_in_final), layer_mode, time.time() - t0))
    if not saved:
        unreal.log_error("V2 SAVE FAILED -- the map was not written; nothing to cook")


if __name__ == "__main__" or True:
    main()
