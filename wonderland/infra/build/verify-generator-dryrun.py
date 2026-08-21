import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_WL = _os.path.dirname(_os.path.dirname(_HERE))          # <repo>/wonderland
#!/usr/bin/env python3
"""Run generate-hub-level.py OFFLINE against a stubbed `unreal` module.

The generator only ever reaches the engine through a handful of calls, so a stub
that records them can execute the whole of build() on this laptop. That will not
tell me what the world LOOKS like, but it catches every NameError, signature
mismatch and bad index in newly written kit code — which is the class of failure
that otherwise costs a full build-and-capture cycle to discover, and which is
exactly what the ~700 lines added in the last three passes are full of.

It also gives an actor budget per kit, which is the number that decides whether
the stream stays usable.
"""
import collections
import io
import os
import re
import sys
import types

GEN = _os.path.join(_HERE, "generate-hub-level.py")
LAYOUT = _os.path.join(_WL, "WorldDesign", "hub-layout.json")

spawned = collections.Counter()
warnings = []


class V:
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x, self.y, self.z = float(x), float(y), float(z)

    def __sub__(self, o):
        return V(self.x - o.x, self.y - o.y, self.z - o.z)


class Any(object):
    """Accepts every attribute, call and property the generator might use."""

    def __init__(self, name="obj"):
        self._name = name

    def __getattr__(self, k):
        if k.startswith("__"):
            raise AttributeError(k)
        return Any(self._name + "." + k)

    def __call__(self, *a, **kw):
        return Any(self._name + "()")

    def __repr__(self):
        return "<Any %s>" % self._name

    def get_actor_location(self):
        return V()

    def get_actor_scale3d(self):
        return V(1, 1, 1)

    def get_path_name(self):
        return "/Game/stub/" + self._name


_imported = set()


class Enum(object):
    def __getattr__(self, k):
        if k.startswith("__"):
            raise AttributeError(k)
        return "ENUM_" + k


def make_unreal():
    u = types.ModuleType("unreal")

    def log(m):
        pass

    def log_warning(m):
        warnings.append(str(m))

    u.log = log
    u.log_warning = log_warning
    u.log_error = log_warning
    u.Vector = V
    u.Rotator = lambda *a, **kw: Any("Rotator")
    u.LinearColor = lambda *a, **kw: Any("LinearColor")
    u.Color = lambda *a, **kw: Any("Color")
    u.Name = lambda s: s

    class _Actors(object):
        def spawn_actor_from_object(self, obj, loc, rot=None, **kw):
            spawned["mesh"] += 1
            return Any("actor")

        def spawn_actor_from_class(self, cls, loc, rot=None, **kw):
            spawned[str(cls)] += 1
            return Any("actor")

        def get_all_level_actors(self):
            return [Any("a")] * sum(spawned.values())

        def destroy_actor(self, a):
            return True

    class _EAL(object):
        def does_asset_exist(self, p):
            return str(p) in _imported

        def does_directory_exist(self, p):
            return False

        def delete_directory(self, p):
            return True

        def load_asset(self, p):
            return Any("asset:" + str(p))

        def save_asset(self, p):
            return True

    class _Tools(object):
        def create_asset(self, name, pkg, cls, factory):
            return Any("asset:" + name)

        def import_asset_tasks(self, tasks):
            return []

    class _MEL(object):
        def __getattr__(self, k):
            return lambda *a, **kw: Any("mel." + k)

    u.EditorActorSubsystem = Any("EditorActorSubsystem")
    u.get_editor_subsystem = lambda cls: _Actors()
    u.EditorAssetLibrary = _EAL()
    u.AssetToolsHelpers = Any("AssetToolsHelpers")
    u.AssetToolsHelpers.get_asset_tools = lambda: _Tools()
    u.MaterialEditingLibrary = _MEL()
    u.EditorLevelLibrary = Any("EditorLevelLibrary")
    u.EditorLoadingAndSavingUtils = Any("EditorLoadingAndSavingUtils")
    u.load_asset = lambda p: Any("asset")
    u.load_class = lambda outer, p: Any("class:" + p)
    u.load_object = lambda outer, p: Any("obj")
    u.MaterialProperty = Enum()
    u.MaterialSamplerType = Enum()
    u.TextureCompressionSettings = Enum()
    u.SkyLightSourceType = Enum()
    u.AutoExposureMethod = Enum()
    u.VectorNoiseFunction = Enum()
    u.TextureAddress = Enum()

    class _AnyModule(object):
        def __getattr__(self, k):
            return Any(k)

    # every other unreal.X (classes, factories, expression types)
    class _Task(Any):
        def __init__(self):
            Any.__init__(self, "AssetImportTask")
            self._dest_path = ""
            self._dest_name = ""
            self._dest = ""

        def set_editor_property(self, k, v):
            if k == "destination_path":
                self._dest_path = str(v)
            elif k == "destination_name":
                self._dest_name = str(v)
            self._dest = self._dest_path + "/" + self._dest_name

    def getattr_fallback(name):
        if name == "AssetImportTask":
            return _Task
        return Any(name)

    u.__getattr__ = getattr_fallback
    return u


import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from wl_preview_leaf import apply as _wl_leaf_apply  # noqa: E402


def main():
    stub = make_unreal()
    sys.modules["unreal"] = stub
    src = io.open(GEN, encoding="utf8").read()
    ns = {"__name__": "__wl_dryrun__", "__file__": GEN}
    # module-level `import unreal` picks up the stub; anything the stub misses
    # surfaces as a real AttributeError here rather than in a 12-minute build
    exec(compile(src, GEN, "exec"), ns)
    # Without this the leaf-card branches are all skipped and the dry run counts
    # a world with no foliage cards in it — see verify-hero-composition.py.
    _wl_leaf_apply(ns)
    import json
    layout = json.load(io.open(LAYOUT, encoding="utf8"))
    ns["build"](layout)
    total = sum(spawned.values())
    print("DRY RUN OK")
    print("  spawned actors: %d" % total)
    for k, v in spawned.most_common(8):
        print("    %-46s %6d" % (k[:46], v))
    # ---- THE ACTOR BUDGET, REWRITTEN AGAINST REAL EVIDENCE --------------
    #
    # WHAT THIS BLOCK USED TO SAY, and why it was replaced: it treated ~25,000
    # movable actors as "measured good" because that many had once streamed at
    # 140 fps on an RTX 6000 Ada, and it warned only when the world grew a
    # THIRD past that. Then the world was measured on the machine it actually
    # runs on.
    #
    # NVIDIA L4, 1280x720, H264, 18 Mb/s, browser-side: **12 FPS**, zero
    # freezes, **GPU utilisation ~10%**, VRAM 1.6 GB, RenderThread at 55-80% of
    # one core, with 33,149 actors in the world. A GPU at ten per cent while the
    # frame rate is twelve is starved, not loaded. The old figure was an
    # engine-side frame rate on a much stronger machine and it was never
    # evidence that 25,000 actors were affordable here.
    #
    # The world is batched now: decoration is instances inside a handful of
    # AWonderlandInstancedBatch actors. So the budget guards two things at once,
    # because either one alone can be satisfied dishonestly —
    #
    #   ACTORS must stay low          (or the batching has been undone)
    #   PIECES must stay high         (or the world has been emptied to hit it)
    #
    # A regression that deletes half the world to lower the actor count fails
    # here, and so does one that quietly goes back to an actor per flower.
    builds = max(1, len([w for w in warnings if w.startswith("LIFECYCLE ")]))
    per_build = total // builds
    loose_meshes = sum(v for k, v in spawned.items() if "StaticMeshActor" in k)
    loose_per_build = loose_meshes // builds

    pieces = 0
    for w in warnings:
        m = re.search(r"INSTANCED_PIECES=(\d+)", w)
        if m:
            pieces = max(pieces, int(m.group(1)))

    ACTOR_FAIL_AT = 2000        # measured today: ~256
    LOOSE_FAIL_AT = 250         # measured today: 0
    PIECES_FLOOR = 25000        # measured today: ~31,996

    print("  actor budget: %d actors per build across %d build(s)" % (per_build, builds))
    print("                %d loose StaticMeshActors, %d instanced pieces"
          % (loose_per_build, pieces))
    budget_bad = False
    if per_build > ACTOR_FAIL_AT:
        print("  BUDGET FAIL: %d actors per build (ceiling %d). The L4 measured "
              "12 FPS with a GPU at 10%% on an unbatched world; this is the "
              "number that caused it." % (per_build, ACTOR_FAIL_AT))
        budget_bad = True
    if loose_per_build > LOOSE_FAIL_AT:
        print("  BUDGET FAIL: %d loose StaticMeshActors (ceiling %d). Visual "
              "geometry belongs in a batch; an actor each is what starved the GPU."
              % (loose_per_build, LOOSE_FAIL_AT))
        budget_bad = True
    if pieces and pieces < PIECES_FLOOR:
        print("  BUDGET FAIL: only %d instanced pieces (floor %d). The actor "
              "count must come down by BATCHING, never by emptying the world."
              % (pieces, PIECES_FLOOR))
        budget_bad = True
    if not pieces:
        print("  BUDGET FAIL: the generator reported no INSTANCED_PIECES at all. "
              "Either batching is off or it produced nothing — and a world with "
              "no decoration would pass an actor ceiling perfectly.")
        budget_bad = True

    print("  generator warnings: %d" % len(warnings))
    for w in warnings[:12]:
        print("    ! %s" % w[:150])
    if budget_bad:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
