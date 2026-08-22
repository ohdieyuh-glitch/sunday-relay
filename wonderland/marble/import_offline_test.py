#!/usr/bin/env python3
"""Prove the UE importer's decisions without an engine.

There is no Unreal in this environment and there will not be one on a laptop,
so the importer cannot be run for real here. What CAN be checked is every
decision it makes before it touches the engine API, and those are the ones with
consequences: which mesh it picks, what scale it computes, whether collision is
switched off, what the actors are tagged, and whether the manifest ends up
describing the result or the request.

A stub `unreal` module records the calls. This does not prove UE 5.8 accepts
them — only a real editor does that, and the importer says so in its own
docstring — but it does prove the importer cannot place a Marble mesh with
collision enabled, which is the boundary the whole design rests on.

    python3 import_offline_test.py
"""
import io
import json
import os
import shutil
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
PASS, FAIL = [], []


def ok(msg):
    PASS.append(msg)
    print("  ok   %s" % msg)


def bad(msg):
    FAIL.append(msg)
    print("  FAIL %s" % msg)


def check(cond, msg):
    ok(msg) if cond else bad(msg)


# ---------------------------------------------------------------- the stub

class Recorder(object):
    def __init__(self):
        self.imports = []       # (filename, destination, name, nanite_requested)
        self.actors = []
        self.logs = []
        # ORDERED, not just counted. The defect this guards against is an
        # import that happens BEFORE the level is opened: every individual step
        # still succeeds, and every actor is silently discarded at exit. Only
        # the order distinguishes that from a working run.
        self.events = []        # ("open"|"import"|"spawn"|"save", detail)
        self.bounds_extent = (5000.0, 5000.0, 1200.0)   # HALF extent, as UE reports it
        self.material_two_sided = False   # what the glTF import produced
        self.material_override_on = True  # is base_property_overrides authoritative
        self.saved_materials = []
        self.level_exists = True
        self.load_ok = True
        self.save_ok = True


REC = Recorder()


def build_stub():
    u = types.ModuleType("unreal")

    class Vector(object):
        def __init__(self, x=0.0, y=0.0, z=0.0):
            self.x, self.y, self.z = float(x), float(y), float(z)

    class Rotator(object):
        def __init__(self):
            self.props = {}

        def set_editor_property(self, k, v):
            self.props[k] = v

    class Name(str):
        pass

    class CollisionEnabled(object):
        NO_COLLISION = "NO_COLLISION"

    class ComponentMobility(object):
        MOVABLE = "Movable"

    class StaticMeshComponent(object):
        def __init__(self):
            self.collision = "default"
            self.profile = None
        def set_mobility(self, v): self.mobility = v
        def set_static_mesh(self, m): self.static_mesh = m

        def set_collision_enabled(self, value):
            self.collision = value

        def set_collision_profile_name(self, value):
            self.profile = value

    class Actor(object):
        def __init__(self, asset):
            self.asset = asset
            self.label = None
            self.scale = None
            self.rotation = None
            self.hidden = None
            self.tags = []
            self.component = StaticMeshComponent()

        def set_actor_label(self, v): self.label = v
        def set_actor_scale3d(self, v): self.scale = v
        def set_actor_rotation(self, r, _b): self.rotation = r
        def set_actor_hidden_in_game(self, v): self.hidden = v
        def get_component_by_class(self, _cls): return self.component
        def get_actor_bounds(self, _only_colliding):
            return (Vector(0, 0, 0), Vector(*REC.bounds_extent))

    class AssetImportTask(object):
        def __init__(self): self.props = {"imported_object_paths": []}

        def set_editor_property(self, k, v): self.props[k] = v
        def get_editor_property(self, k): return self.props.get(k)

    class MeshPipeline(object):
        def __init__(self): self.build_nanite = False

        def set_editor_property(self, k, v): setattr(self, k, v)

    class InterchangeGenericAssetsPipeline(object):
        def __init__(self): self._mesh = MeshPipeline()

        def get_editor_property(self, k):
            return self._mesh if k == "mesh_pipeline" else None

        def set_editor_property(self, k, v): setattr(self, k, v)

    class AssetTools(object):
        def import_asset_tasks(self, tasks):
            for task in tasks:
                options = task.props.get("options")
                nanite = bool(options and options._mesh.build_nanite)
                name = task.props["destination_name"]
                base = task.props["destination_path"]
                # WHAT THE REAL IMPORT RETURNS. Measured on UE 5.8: a glTF
                # import creates a Texture2D, a MaterialInstanceConstant AND a
                # StaticMesh, and imported_object_paths lists all three. The
                # first version of this stub returned one path, so the offline
                # suite never saw the case where the importer tried to spawn an
                # actor from a texture — which is what actually happened.
                path = "%s/StaticMeshes/%s.%s" % (base, name, name)
                task.props["imported_object_paths"] = [
                    "%s/Textures/texture_image.texture_image" % base,
                    "%s/Materials/mat_coarse.mat_coarse" % base,
                    path,
                ]
                REC.imports.append((task.props["filename"],
                                    task.props["destination_path"], name, nanite))
                REC.events.append(("import", task.props["filename"]))

    class AssetToolsHelpers(object):
        @staticmethod
        def get_asset_tools(): return AssetTools()

    class EditorActorSubsystem(object):
        def spawn_actor_from_object(self, mesh, _loc, _rot):
            # THE REAL ENGINE RETURNED None HERE for a StaticMesh that had
            # loaded fine — "SpawnActorFromObject. No actor was spawned." The
            # stub reproduces that so the suite cannot pass on the path that
            # failed on hardware.
            REC.events.append(("spawn_from_object", mesh))
            return None

        def spawn_actor_from_class(self, cls, _loc, _rot):
            actor = Actor(cls)
            REC.actors.append((actor, _loc))
            REC.events.append(("spawn", cls))
            return actor

    class LevelEditorSubsystem(object):
        def load_level(self, path):
            if not REC.load_ok:
                return False
            REC.events.append(("open", path))
            return True

        def save_current_level(self):
            return bool(REC.save_ok)

    class World(object):
        pass

    class UnrealEditorSubsystem(object):
        def get_editor_world(self):
            return World()

    class EditorLoadingAndSavingUtils(object):
        @staticmethod
        def save_map(_world, path):
            if not REC.save_ok:
                return False
            REC.events.append(("save", path))
            return True

    class Overrides(object):
        def __init__(self, owner): self._o = owner
        def get_editor_property(self, k):
            if k == "override_two_sided": return self._o._override
            if k == "two_sided": return self._o._two
            raise Exception("no property %r" % k)
        def set_editor_property(self, k, v):
            if k == "override_two_sided": self._o._override = v
            elif k == "two_sided": self._o._two = v
            else: raise Exception("no property %r" % k)

    class Material(object):
        """A MaterialInstanceConstant, which is what a glTF import produces.

        It does NOT answer to `two_sided` — the real one raises "Failed to find
        property 'two_sided' ... on 'MaterialInstanceConstant'" — it answers
        through base_property_overrides, and only when the override flag is on.
        """
        def __init__(self, name):
            self._name = name
            self._two = REC.material_two_sided
            self._override = REC.material_override_on

        def get_name(self): return self._name
        def get_editor_property(self, k):
            if k == "base_property_overrides": return Overrides(self)
            if k == "parent": return None
            raise Exception("Failed to find property %r for attribute %r on "
                            "'MaterialInstanceConstant'" % (k, k))
        def set_editor_property(self, k, v):
            if k == "base_property_overrides": return
            raise Exception("Failed to find property %r" % k)

    class Texture2D(object):
        def __init__(self, path): self.path = path
        def get_name(self): return "texture_image"
        def get_editor_property(self, k):
            raise Exception("Failed to find property %r for attribute %r on "
                            "'Texture2D'" % (k, k))

    class MaterialSlot(object):
        def __init__(self, material): self._m = material
        def get_editor_property(self, k):
            if k == "material_interface": return self._m
            raise KeyError(k)

    class StaticMesh(object):
        def __init__(self, path):
            self.path = path
            self._materials = [MaterialSlot(Material("MI_" + path.rsplit("/", 1)[-1]))]

        def get_editor_property(self, k):
            if k == "static_materials": return self._materials
            raise KeyError(k)

    class StaticMeshActor(object):
        pass

    class EditorAssetLibrary(object):
        @staticmethod
        def does_asset_exist(_path):
            return bool(REC.level_exists)

        @staticmethod
        def save_loaded_asset(asset):
            REC.saved_materials.append(asset.get_name())
            return True

    def _subsystem(cls):
        if cls is LevelEditorSubsystem:
            return LevelEditorSubsystem()
        if cls is UnrealEditorSubsystem:
            return UnrealEditorSubsystem()
        return EditorActorSubsystem()

    u.Vector = Vector
    u.Rotator = Rotator
    u.Name = Name
    u.CollisionEnabled = CollisionEnabled
    u.StaticMeshComponent = StaticMeshComponent
    u.ComponentMobility = ComponentMobility
    u.AssetImportTask = AssetImportTask
    u.InterchangeGenericAssetsPipeline = InterchangeGenericAssetsPipeline
    u.AssetToolsHelpers = AssetToolsHelpers
    u.EditorActorSubsystem = EditorActorSubsystem
    u.LevelEditorSubsystem = LevelEditorSubsystem
    u.UnrealEditorSubsystem = UnrealEditorSubsystem
    u.EditorLoadingAndSavingUtils = EditorLoadingAndSavingUtils
    u.EditorAssetLibrary = EditorAssetLibrary
    u.get_editor_subsystem = _subsystem
    def _load(path):
        if "/Textures/" in path: return Texture2D(path)
        if "/Materials/" in path: return Material("MI_coarse")
        return StaticMesh(path)
    u.load_asset = _load
    u.StaticMesh = StaticMesh
    u.StaticMeshActor = StaticMeshActor
    u.Texture2D = Texture2D
    u.log_warning = lambda m: REC.logs.append(m)
    u.log = lambda m: REC.logs.append(m)
    return u


def make_world(root, slug, hq=False, ground=None, scale_factor=1.25, backdrop=False):
    wdir = os.path.join(root, slug)
    assets = os.path.join(wdir, "assets")
    os.makedirs(assets, exist_ok=True)
    downloaded = {}
    for name, key in (("mesh_full_res.glb", "full_res_mesh_url"),
                      ("collider.glb", "collider_mesh_url")):
        io.open(os.path.join(assets, name), "wb").write(b"glTF" + b"x" * 64)
        downloaded[key] = {"path": os.path.join("assets", name), "bytes": 68}
    if hq:
        io.open(os.path.join(assets, "mesh_hq.glb"), "wb").write(b"glTF" + b"y" * 99)
        downloaded["hq_mesh_url"] = {"path": os.path.join("assets", "mesh_hq.glb"),
                                     "bytes": 103}
    manifest = {
        "schema_version": "wonderland.marble.manifest/1",
        "marble_world_id": "world-uuid",
        "display_name": slug,
        "source_reference": {"kind": "founder-reference-image"},
        "prompt": {"type": "image"},
        "model": "marble-1.1",
        "generated_at": "2026-08-21T00:00:00Z",
        "operation_id": "op-1",
        "cost": {"total_credits": 1580},
        "assets": {"downloaded": downloaded},
        "exports": [],
        "transform": {"axis_correction_deg": [180.0, 0.0, 0.0],
                      "metric_scale_factor": scale_factor,
                      "ground_plane_offset_m": ground,
                      "unreal_uniform_scale": (scale_factor * 100.0) if scale_factor else None,
                      "unreal_origin_cm": [0.0, 0.0, 0.0],
                      "unreal_rotation_deg": [0.0, 0.0, 0.0]},
        "bounds": {"source": None, "min_cm": None, "max_cm": None},
        # The real manifest records what the GLB header said, and the two-sided
        # repair is gated on it — a fixture without it silently disables repair.
        "source_mesh": {"double_sided": True},
        "collision_source": {"authority": "unreal"},
        "unreal_destination": {"content_path": "/Game/Wonderland/Marble/%s" % slug,
                               "level": "/Game/Wonderland/Maps/WonderlandHub",
                               "actor_label": None},
        "licence": {"commercial_use": "unavailable"},
    }
    if backdrop:
        manifest["transform"]["placement_mode"] = "backdrop_at_camera"
        # Only the backdrop fixtures carry it. Forcing it onto every world made
        # the metric-scale tests fail, which was the fixture lying rather than
        # the code breaking.
        manifest["transform"]["anchor_camera"] = "HeroCam0"
        manifest["transform"]["unreal_backdrop_scale"] = 1268.7
        manifest["transform"]["backdrop_scale_multiplier"] = 6.0
        manifest["transform"]["backdrop_policy"] = {
            "recommended_roam_radius_m": 10.3, "tolerance_deg": 3.0}
    with io.open(os.path.join(wdir, "manifest.json"), "w", encoding="utf8") as h:
        json.dump(manifest, h, indent=2)
    return wdir


def run_importer(slug, root, extra=(), **knobs):
    global REC
    REC = Recorder()
    for key, value in knobs.items():
        if not hasattr(REC, key):
            raise AssertionError("unknown recorder knob %r" % key)
        setattr(REC, key, value)
    sys.modules["unreal"] = build_stub()
    for mod in ("import_marble_world",):
        sys.modules.pop(mod, None)
    src = io.open(os.path.join(HERE, "import-marble-world.py"), encoding="utf8").read()
    module = types.ModuleType("import_marble_world")
    module.__file__ = os.path.join(HERE, "import-marble-world.py")
    module.__dict__["__name__"] = "import_marble_world"
    exec(compile(src, module.__file__, "exec"), module.__dict__)
    module.main(["--slug", slug, "--root", root] + list(extra))
    return module


def run_importer_raw(argv, root):
    """Like run_importer but passes argv verbatim — no --slug, no --root."""
    global REC
    REC = Recorder()
    sys.modules["unreal"] = build_stub()
    src = io.open(os.path.join(HERE, "import-marble-world.py"), encoding="utf8").read()
    module = types.ModuleType("import_marble_world")
    module.__file__ = os.path.join(HERE, "import-marble-world.py")
    module.__dict__["__name__"] = "import_marble_world"
    exec(compile(src, module.__file__, "exec"), module.__dict__)
    module.main(list(argv))
    return module


def main():
    root = tempfile.mkdtemp(prefix="marble-import-")
    try:
        print("-- mesh choice --")
        make_world(root, "free-only")
        run_importer("free-only", root)
        visual = [i for i in REC.imports if "Collider" not in i[2]]
        check(len(visual) == 1 and visual[0][0].endswith("mesh_full_res.glb"),
              "with no paid export, the free full-res mesh is used")
        check(any("vertex-coloured" in m for m in REC.logs),
              "…and the log NAMES which mesh, so two runs are not confused")

        make_world(root, "with-hq", hq=True)
        run_importer("with-hq", root)
        visual = [i for i in REC.imports if "Collider" not in i[2]]
        check(visual[0][0].endswith("mesh_hq.glb"),
              "when the 3500-credit HQ mesh is present it is preferred")

        print("\n-- the collider standing in as scenery --")
        # THE CASE THAT ACTUALLY HAPPENED. The first real Marble generation came
        # back with neither hq_mesh_url nor full_res_mesh_url — splats, a
        # panorama and a collider. The collider carries COLOR_0, so it renders,
        # and refusing to import it would have meant reporting that Marble
        # cannot reach Unreal for free when it can.
        wdir = make_world(root, "collider-only")
        man_path = os.path.join(wdir, "manifest.json")
        man = json.load(io.open(man_path, encoding="utf8"))
        man["assets"]["downloaded"].pop("full_res_mesh_url", None)
        json.dump(man, io.open(man_path, "w", encoding="utf8"))
        # DEFAULT: REFUSE. The collider is 1.95 triangles per m2 with a median
        # edge of 1.25 m — a coloured blur. Substituting it for the Royal Garden
        # automatically would ship a blob and call it the founder's reference.
        try:
            run_importer("collider-only", root)
            bad("with no mesh url, the importer must NOT silently use the collider")
        except SystemExit as exc:
            check("3,500 credits" in str(exc) and "allow-collider-as-visual" in str(exc),
                  "no mesh url -> refusal naming BOTH the paid export and the opt-in")
        check(not REC.imports, "...and it imported nothing")

        run_importer("collider-only", root, extra=["--allow-collider-as-visual"])
        visual = [i for i in REC.imports if "Collider" not in i[2]]
        check(len(visual) == 1 and visual[0][0].endswith("collider.glb"),
              "with the opt-in flag, the collider becomes the visual layer")
        check(any("1.95 triangles per m2" in m for m in REC.logs),
              "...and the log quotes the MEASURED density, not an adjective")
        check(any("3,500-credit" in m for m in REC.logs),
              "...and names what would replace it")
        labels = [a.label for a, _ in REC.actors]
        check(sum(1 for l in labels if "ColliderReference" in (l or "")) == 0,
              "...and it is NOT also imported a second time as a hidden reference")
        check(all(a.component.collision == "NO_COLLISION" for a, _ in REC.actors),
              "...and it STILL has collision disabled — Unreal keeps the authority")

        print("\n-- the collision boundary --")
        make_world(root, "boundary", hq=True)
        run_importer("boundary", root)
        components = [a.component for a, _ in REC.actors]
        check(all(c.collision == "NO_COLLISION" for c in components),
              "EVERY placed Marble actor has collision disabled")
        check(all(c.profile == "NoCollision" for c in components),
              "…and its collision profile set to NoCollision as well")
        visual_actors = [a for a, _ in REC.actors if "VisualLayer" in (a.label or "")]
        collider_actors = [a for a, _ in REC.actors if "ColliderReference" in (a.label or "")]
        check(len(visual_actors) == 1, "one visual-layer actor was placed")
        check(len(collider_actors) == 1, "the collider mesh was placed as a REFERENCE")
        check(collider_actors[0].hidden is True,
              "the collider reference is hidden in game — it is not scenery either")
        check("MarbleNoCollision" in visual_actors[0].tags,
              "the visual actor is TAGGED as non-colliding, so a later pass can find it")
        check("MarbleColliderReference" in collider_actors[0].tags,
              "the collider reference is tagged as a reference, not as collision")

        print("\n-- the axis correction --")
        # Marble's collider export is Y-DOWN; UE's glTF import assumes Y-UP.
        # Without this the Royal Garden arrives inverted — sky below, plaza
        # overhead — and reads as a lighting bug on a paid GPU.
        make_world(root, "axis", hq=True, backdrop=True)
        run_importer("axis", root)
        rolls = [a.rotation.props.get("roll") for a, _ in REC.actors]
        check(all(abs((r or 0) - 180.0) < 1e-6 for r in rolls),
              "the 180-degree roll from the manifest reaches every placed actor")
        check(any("axis correction applied" in m for m in REC.logs),
              "...and the import says so rather than doing it silently")
        check(any("BACKDROP anchored to HeroCam0" in m for m in REC.logs),
              "the single-viewpoint shell is announced as a backdrop, not a world")
        check(any("smears if a player walks away" in m for m in REC.logs),
              "...and its one real limitation is stated at import time")

        print("\n-- the backdrop scale --")
        # A shell at native scale tolerates 1.7 m of movement before smearing.
        # Scaling it out buys proportional roam at no visual cost from the
        # arrival camera, so the backdrop scale — not the metric one — is what
        # must reach the actor.
        make_world(root, "backdropscale", hq=True, backdrop=True)
        run_importer("backdropscale", root)
        va = [a for a, _ in REC.actors if "VisualLayer" in (a.label or "")]
        check(va and abs(va[0].scale.x - 1268.7) < 1e-6,
              "the BACKDROP scale is applied, not the raw metric scale")
        check(any("BACKDROP SCALE" in m and "roam" in m for m in REC.logs),
              "...and the import states the roam radius it buys")

        print("\n-- scale and placement --")
        check(abs(visual_actors[0].scale.x - 125.0) < 1e-9,
              "metric_scale_factor 1.25 became a uniform scale of 125 (metres->cm)")
        check(visual_actors[0].rotation.props.get("yaw") == 0.0
              and "pitch" in visual_actors[0].rotation.props,
              "rotation is built with NAMED fields, not the positional constructor")

        make_world(root, "grounded", ground=-0.4)
        run_importer("grounded", root)
        placed_z = [loc.z for _a, loc in REC.actors]
        check(all(abs(z - 40.0) < 1e-6 for z in placed_z),
              "ground_plane_offset -0.4 m lifted the layer to z=+40cm")
        check(any("ground plane offset" in m for m in REC.logs),
              "…and said so")


        # …and in backdrop mode it is not applied AT ALL, because translating the
        # shell is the one thing that breaks the scale-invariance it depends on.
        make_world(root, "groundbackdrop", ground=-0.4, backdrop=True)
        run_importer("groundbackdrop", root)
        placed_z = [loc.z for _a, loc in REC.actors]
        check(placed_z and all(abs(z - 0.0) < 1e-6 for z in placed_z),
              "in backdrop_at_camera the ground offset is NOT applied")
        check(any("NOT applied" in m and "scale-invariance" in m for m in REC.logs),
              "…and the reason is stated, not left as a silent omission")

        make_world(root, "noscale", scale_factor=None)
        run_importer("noscale", root)
        visual_actors = [a for a, _ in REC.actors if "VisualLayer" in (a.label or "")]
        check(abs(visual_actors[0].scale.x - 100.0) < 1e-9,
              "with no scale factor it falls back to the bare metre->cm conversion")
        check(any("may be the wrong size" in m for m in REC.logs),
              "…and warns that the layer may be wrong, rather than looking confident")

        print("\n-- nanite --")
        make_world(root, "nanite", hq=True)
        run_importer("nanite", root)
        visual = [i for i in REC.imports if "Collider" not in i[2]]
        collider = [i for i in REC.imports if "Collider" in i[2]]
        check(visual[0][3] is True, "the dense Marble visual mesh requests Nanite")
        check(collider and collider[0][3] is False,
              "the collider mesh does NOT — it is never rendered")
        run_importer("nanite", root, extra=["--no-nanite"])
        visual = [i for i in REC.imports if "Collider" not in i[2]]
        check(visual[0][3] is False, "--no-nanite is honoured")

        print("\n-- the manifest describes the RESULT --")
        make_world(root, "writeback", hq=True)
        run_importer("writeback", root)
        man = json.load(io.open(os.path.join(root, "writeback", "manifest.json"),
                                encoding="utf8"))
        dest = man["unreal_destination"]
        check(dest.get("imported_assets"), "imported asset paths are written back")
        check(dest.get("collider_assets"), "collider asset paths are written back")
        check(dest.get("nanite_requested") is True, "whether Nanite was requested is recorded")
        check(man["bounds"]["source"] == "measured in Unreal after import",
              "bounds are MEASURED after import, not copied from the request")
        check(man["bounds"]["max_cm"][0] == 5000.0, "…and carry the real numbers")
        check(man["collision_source"]["authority"] == "unreal",
              "the manifest still says Unreal owns collision")

        print("\n-- the level the layer lands in --")
        make_world(root, "level", hq=True)
        mod = run_importer("level", root)
        order = [kind for kind, _ in REC.events]
        check("open" in order and "import" in order,
              "the level is opened and the mesh is imported")
        check(order.index("open") < order.index("import"),
              "the level is opened BEFORE anything is imported "
              "(otherwise every actor is discarded at exit)")
        check(order.index("open") < order.index("spawn"),
              "…and before anything is spawned")
        check(order[-1] == "save", "the map is saved LAST, after placement")
        opened = [d for k, d in REC.events if k == "open"]
        saved = [d for k, d in REC.events if k == "save"]
        check(opened == ["/Game/Wonderland/Maps/WonderlandHub"],
              "it opens the level the manifest names")
        check(saved == opened, "…and saves that same level, not another one")
        check(any("MARBLE_LEVEL_SAVED=1" in m for m in REC.logs),
              "the save outcome is reported as a fact")
        man = json.load(io.open(os.path.join(root, "level", "manifest.json"),
                                encoding="utf8"))
        check(man["unreal_destination"]["level_saved"] is True,
              "the manifest records that the map was saved")

        make_world(root, "levelarg", hq=True)
        run_importer("levelarg", root, extra=["--level", "/Game/Other/Map"])
        check([d for k, d in REC.events if k == "open"] == ["/Game/Other/Map"],
              "--level overrides the manifest")

        make_world(root, "nosave", hq=True)
        run_importer("nosave", root, extra=["--no-save"])
        check(not [k for k, _ in REC.events if k == "save"],
              "--no-save really does not save")
        check(any("NOT written" in m for m in REC.logs),
              "…and says the actors will be gone when the session exits")
        man = json.load(io.open(os.path.join(root, "nosave", "manifest.json"),
                                encoding="utf8"))
        check(man["unreal_destination"]["level_saved"] is False,
              "…and the manifest does not claim a save that never happened")

        print("\n-- level failures are fatal, never warnings --")
        make_world(root, "missinglevel", hq=True)
        try:
            run_importer("missinglevel", root, level_exists=False)
            bad("a missing level must refuse")
        except SystemExit as exc:
            check("does not exist" in str(exc) and "Nothing was imported" in str(exc),
                  "a level that does not exist -> refusal before any import")
        check(not REC.imports, "…and it imported nothing")

        make_world(root, "loadfail", hq=True)
        try:
            run_importer("loadfail", root, load_ok=False)
            bad("load_level returning false must refuse")
        except SystemExit as exc:
            check("load_level" in str(exc) and "Nothing was imported" in str(exc),
                  "load_level false -> refusal rather than importing into a transient world")
        check(not REC.imports, "…and it imported nothing")

        make_world(root, "savefail", hq=True)
        try:
            run_importer("savefail", root, save_ok=False)
            bad("a failed save must be fatal")
        except SystemExit as exc:
            check("could not be saved" in str(exc) and "failure and not a warning" in str(exc),
                  "a map that will not save is a FAILURE (a cook from there ships no Marble layer)")

        print("\n-- what the engine actually did, on the box --")
        # Every case below is a defect that a clean compile, a clean cook and a
        # green offline suite all failed to catch. They were found by running it.
        make_world(root, "hw", hq=True, backdrop=True)
        run_importer("hw", root, material_two_sided=True)
        # 1. imported_object_paths returns a Texture2D, a MaterialInstance AND a
        #    StaticMesh. Only one of those is placeable.
        visual = [a for a, _ in REC.actors if "VisualLayer" in (a.label or "")]
        check(len(visual) == 1,
              "exactly ONE visual actor from a three-asset import, not three")
        check(any("not placeable, skipping" in m and "Texture2D" in m for m in REC.logs),
              "…and the texture is named and skipped rather than silently failing")
        check(any("3 asset(s), 1 of them placeable" in m for m in REC.logs),
              "…and the counts are reported")
        # 2. spawn_actor_from_object returned None on hardware for a StaticMesh
        #    that had loaded fine. The generator has always used from_class.
        check(not [k for k, _ in REC.events if k == "spawn_from_object"],
              "placement never uses spawn_actor_from_object, which returned None on the box")
        check([k for k, _ in REC.events if k == "spawn"],
              "…it spawns from CLASS, the path the generator proves in this commandlet")
        placed_actor = REC.actors[0][0]
        check(getattr(placed_actor.component, "mobility", None) == "Movable",
              "…and sets MOVABLE before assigning the mesh")
        check(getattr(placed_actor.component, "static_mesh", None) is not None,
              "…and actually assigns the mesh")

        # 5. THE SCALE CONVENTION, measured in the engine. UE's glTF import
        #    already converts metres to centimetres — 100 uu per glTF unit —
        #    so the actor scale is the metric factor, NOT that times 100. The
        #    shipped manifest was 100x out and produced a 123-km shell.
        real = json.load(io.open(os.path.join(HERE, "worlds",
                                              "royal-garden-backdrop",
                                              "manifest.json"), encoding="utf8"))
        rt = real["transform"]
        span = real["source_mesh"]["span"]
        got = [round(s * 100.0 * rt["unreal_backdrop_scale"]) for s in span]
        want = [round(v) for v in rt["expected_unreal_extent_cm"]]
        check(got == want,
              "the shipped scale x 100 uu-per-unit lands on the expected extent "
              "(%s vs %s)" % (got, want))
        check(abs(rt["unreal_backdrop_scale"]
                  - rt["unreal_uniform_scale"] * rt["backdrop_scale_multiplier"]) < 1e-6,
              "…and the backdrop scale is exactly the metric scale times the multiplier")
        check(rt["unreal_uniform_scale"] < 100,
              "…and the metric scale is not the 100x-inflated kind that shipped once")
        check("MEASURED IN THE ENGINE" in (rt.get("scale_convention") or ""),
              "…and the convention is recorded as measured, not assumed")
        # The importer must not clobber the metric scale with the applied one.
        src_txt = io.open(os.path.join(HERE, "import-marble-world.py"),
                          encoding="utf8").read()
        check('transform"]["unreal_applied_scale"] = scale' in src_txt
              and 'transform"]["unreal_uniform_scale"] = scale' not in src_txt,
              "the applied scale is written to its own field, not over the metric one")

        # 6. THE INVERSION. A gate designed to be permutation-invariant cannot
        #    see a 180-degree flip, because a flip changes no extent. The
        #    manifest must therefore DECLARE the correction, and the declaration
        #    has to survive.
        check(rt.get("axis_correction_deg") == [180.0, 0.0, 0.0],
              "the shipped world declares the 180 roll its export convention needs")
        check("R_x(+90) maps +Z to MINUS Y" in (rt.get("axis_correction_why") or "")
              or "MINUS Y" in (rt.get("axis_correction_why") or ""),
              "…and records the arithmetic, since the previous note had it backwards")
        check("CORRECTED" in (real["source_mesh"].get("axis_note") or ""),
              "…and the note that concluded the opposite is marked corrected, not deleted")
        # The collider in this repo is the physical evidence; assert its shape so
        # a re-exported asset that changes convention fails here rather than in a
        # frame.
        import struct as _struct
        _cp = os.path.join(HERE, "worlds", "royal-garden-backdrop", "assets", "collider.glb")
        if os.path.exists(_cp):
            _f = io.open(_cp, "rb"); _f.read(12)
            _jl = _struct.unpack("<II", _f.read(8))[0]
            _js = json.loads(_f.read(_jl).decode("utf8"))
            _lo = [1e30] * 3; _hi = [-1e30] * 3
            for _m in _js["meshes"]:
                for _pr in _m["primitives"]:
                    _a = _js["accessors"][_pr["attributes"]["POSITION"]]
                    for _i in range(3):
                        _lo[_i] = min(_lo[_i], _a["min"][_i]); _hi[_i] = max(_hi[_i], _a["max"][_i])
            check(_hi[1] < 5.0 and _lo[1] < -20.0,
                  "the collider is still Y-DOWN (y %.1f..%.1f), which is what the "
                  "correction is for" % (_lo[1], _hi[1]))
        else:
            print("  --   collider.glb absent; the physical check did not run")

        print("\n-- unknown is not single-sided --")
        # THE TRUTHFULNESS BUG. The first version read get_editor_property
        # ('two_sided'), which a MaterialInstanceConstant does not answer, and
        # printed "EVERY Marble material is single-sided" — a claim about the
        # asset made from a failure to look at it.
        make_world(root, "twosided-inst", hq=True, backdrop=True)
        run_importer("twosided-inst", root, material_two_sided=True,
                     material_override_on=True)
        check(any("MARBLE_TWO_SIDED=1" in m for m in REC.logs),
              "a material INSTANCE's two-sidedness is read through its overrides")
        check(not any("EVERY Marble material is single-sided" in m for m in REC.logs),
              "…and a two-sided instance is not called single-sided")

        make_world(root, "twosided-unknown", hq=True, backdrop=True)
        run_importer("twosided-unknown", root, material_two_sided=False,
                     material_override_on=False)
        check(any("UNKNOWN" in m and "not the same as single-sided" in m
                  for m in REC.logs),
              "an unreadable two_sided reports UNKNOWN, in those words")
        check(any("MARBLE_TWO_SIDED_UNKNOWN=1" in m for m in REC.logs),
              "…and is counted separately")
        check(not any("EVERY Marble material is single-sided" in m for m in REC.logs),
              "…and is NEVER reported as single-sided")

        make_world(root, "twosided-single", hq=True, backdrop=True)
        run_importer("twosided-single", root, material_two_sided=False,
                     material_override_on=True)
        check(any("MARBLE_TWO_SIDED_REPAIRED=1" in m for m in REC.logs),
              "a genuinely single-sided instance IS repaired, through the override struct")

        print("\n-- the shell's one silent failure: single-sided --")
        # A single-viewpoint reconstruction is a shell seen FROM THE INSIDE. If
        # the material imports single-sided every gate above still passes and
        # the frame is empty — which is only discoverable on metered GPU time.
        def sided(slug, source_double_sided=True, extra=()):
            make_world(root, slug, hq=True, backdrop=True)
            mp = os.path.join(root, slug, "manifest.json")
            mj = json.load(io.open(mp, encoding="utf8"))
            mj["source_mesh"] = {"double_sided": source_double_sided}
            json.dump(mj, io.open(mp, "w", encoding="utf8"))
            return mp

        sided("twosided")
        run_importer("twosided", root, material_two_sided=True)
        check(any("MARBLE_TWO_SIDED=1" in m and "REPAIRED=0" in m for m in REC.logs),
              "a material that imported two-sided is counted and left alone")
        check(not REC.saved_materials, "…and nothing is written")

        sided("singlesided")
        run_importer("singlesided", root, material_two_sided=False)
        check(any("SINGLE-SIDED while the source declares doubleSided" in m
                  for m in REC.logs),
              "a single-sided import is named, not passed over")
        check(any("MARBLE_TWO_SIDED_REPAIRED=1" in m for m in REC.logs),
              "…and two-sidedness is restored, because the source glTF declared it")
        check(len(REC.saved_materials) == 1,
              "…and the repaired material is saved, so the cook sees it")

        sided("noreprepair")
        run_importer("noreprepair", root, extra=["--no-two-sided-repair"],
                     material_two_sided=False)
        check(any("SINGLE-SIDED" in m for m in REC.logs),
              "--no-two-sided-repair still REPORTS the problem")
        check(not REC.saved_materials, "…and changes nothing")

        sided("srcsingle", source_double_sided=False)
        run_importer("srcsingle", root, material_two_sided=False)
        check(not REC.saved_materials,
              "a source that is genuinely single-sided is not 'repaired' into "
              "something it never was")

        print("\n-- the order-of-magnitude gate --")
        # The failure this exists for cooks, packages and streams perfectly, and
        # is discovered by a person looking at a browser on metered GPU time.
        def with_expected(slug, extent_cm):
            make_world(root, slug, hq=True, backdrop=True)
            mp = os.path.join(root, slug, "manifest.json")
            mj = json.load(io.open(mp, encoding="utf8"))
            if extent_cm is not None:
                mj["transform"]["expected_unreal_extent_cm"] = extent_cm
            json.dump(mj, io.open(mp, "w", encoding="utf8"))
            return mp

        with_expected("scaleok", [10000.0, 10000.0, 2400.0])
        run_importer("scaleok", root)
        check(any("scale check" in m and "worst ratio 1" in m for m in REC.logs),
              "an import at the expected size passes the gate and states the ratio")
        check([k for k, _ in REC.events if k == "save"],
              "…and the map is saved")
        man = json.load(io.open(os.path.join(root, "scaleok", "manifest.json"),
                                encoding="utf8"))
        check(man["bounds"]["measured_extent_cm"] == [10000.0, 10000.0, 2400.0],
              "…and the MEASURED extent is written back, not the requested one")

        with_expected("scale100x", [100.0, 100.0, 24.0])
        try:
            run_importer("scale100x", root)
            bad("a 100x size error must refuse")
        except SystemExit as exc:
            check("wrong SIZE" in str(exc) and "metre/centimetre" in str(exc),
                  "a 100x size error refuses and names the metre/centimetre trap")
        check(not [k for k, _ in REC.events if k == "save"],
              "…and the wrong-sized layer never reaches disk")

        # An axis SWAP is not a size error, and the gate must not confuse them:
        # glTF is Y-up, Unreal is Z-up, and the extents can arrive permuted.
        with_expected("scaleswapped", [2400.0, 10000.0, 10000.0])
        run_importer("scaleswapped", root)
        check([k for k, _ in REC.events if k == "save"],
              "extents that are merely PERMUTED pass — an axis swap is not a size error")

        with_expected("scaleunknown", None)
        run_importer("scaleunknown", root)
        check(any("was NOT checked" in m for m in REC.logs),
              "with no expected extent the gate says it did not run rather than passing")

        print("\n-- the slug transport --")
        make_world(root, "envslug", hq=True)
        os.environ["WONDERLAND_MARBLE_SLUG"] = "envslug"
        os.environ["WONDERLAND_MARBLE_ROOT"] = root
        try:
            run_importer_raw([], root)
            check(any("from WONDERLAND_MARBLE_SLUG" in m for m in REC.logs),
                  "the slug arrives by environment when -script= arguments do not")
            check(len(REC.imports) >= 1, "…and the import really happened")
        finally:
            os.environ.pop("WONDERLAND_MARBLE_SLUG", None)
            os.environ.pop("WONDERLAND_MARBLE_ROOT", None)
        try:
            run_importer_raw([], root)
            bad("with no slug anywhere the importer must refuse")
        except SystemExit as exc:
            check("WONDERLAND_MARBLE_SLUG" in str(exc) and "Nothing was imported" in str(exc),
                  "no slug at all -> refusal naming both ways to supply one")

        print("\n-- refusals --")
        empty = os.path.join(root, "nomesh")
        make_world(root, "nomesh")
        man_path = os.path.join(empty, "manifest.json")
        man = json.load(io.open(man_path, encoding="utf8"))
        man["assets"]["downloaded"] = {}
        json.dump(man, io.open(man_path, "w", encoding="utf8"))
        try:
            run_importer("nomesh", root)
            bad("with nothing downloaded the importer must refuse")
        except SystemExit as exc:
            check("fetch" in str(exc) and "Nothing was imported" in str(exc),
                  "no mesh on disk -> refusal naming the free command that fixes it")
        check(not REC.imports, "…and it imported nothing")

        make_world(root, "promote", hq=True)
        run_importer("promote", root,
                     extra=["--promote-marble-collision-i-have-evidence"])
        check(any("REFUSED" in m and "evidence" in m for m in REC.logs),
              "promoting Marble geometry to gameplay collision is REFUSED, not implemented")
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print("\n%d passed, %d failed" % (len(PASS), len(FAIL)))
    if FAIL:
        for item in FAIL:
            print("  - %s" % item)
        return 1
    print("\nWhat this does NOT prove: that UE 5.8 accepts these calls. There is")
    print("no engine here. The Interchange options in particular are guarded and")
    print("log when they do not apply.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
