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

    class StaticMeshComponent(object):
        def __init__(self):
            self.collision = "default"
            self.profile = None

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
            return (Vector(0, 0, 0), Vector(5000, 5000, 1200))

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
                path = "%s/%s.%s" % (task.props["destination_path"], name, name)
                task.props["imported_object_paths"] = [path]
                REC.imports.append((task.props["filename"],
                                    task.props["destination_path"], name, nanite))

    class AssetToolsHelpers(object):
        @staticmethod
        def get_asset_tools(): return AssetTools()

    class EditorActorSubsystem(object):
        def spawn_actor_from_object(self, mesh, _loc, _rot):
            actor = Actor(mesh)
            REC.actors.append((actor, _loc))
            return actor

    u.Vector = Vector
    u.Rotator = Rotator
    u.Name = Name
    u.CollisionEnabled = CollisionEnabled
    u.StaticMeshComponent = StaticMeshComponent
    u.AssetImportTask = AssetImportTask
    u.InterchangeGenericAssetsPipeline = InterchangeGenericAssetsPipeline
    u.AssetToolsHelpers = AssetToolsHelpers
    u.EditorActorSubsystem = EditorActorSubsystem
    u.get_editor_subsystem = lambda _cls: EditorActorSubsystem()
    u.load_asset = lambda path: {"asset": path}
    u.log_warning = lambda m: REC.logs.append(m)
    u.log = lambda m: REC.logs.append(m)
    return u


def make_world(root, slug, hq=False, ground=None, scale_factor=1.25):
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
        "transform": {"metric_scale_factor": scale_factor,
                      "ground_plane_offset_m": ground,
                      "unreal_uniform_scale": (scale_factor * 100.0) if scale_factor else None,
                      "unreal_origin_cm": [0.0, 0.0, 0.0],
                      "unreal_rotation_deg": [0.0, 0.0, 0.0]},
        "bounds": {"source": None, "min_cm": None, "max_cm": None},
        "collision_source": {"authority": "unreal"},
        "unreal_destination": {"content_path": "/Game/Wonderland/Marble/%s" % slug,
                               "level": "/Game/Wonderland/Maps/WonderlandHub",
                               "actor_label": None},
        "licence": {"commercial_use": "unavailable"},
    }
    with io.open(os.path.join(wdir, "manifest.json"), "w", encoding="utf8") as h:
        json.dump(manifest, h, indent=2)
    return wdir


def run_importer(slug, root, extra=()):
    global REC
    REC = Recorder()
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
