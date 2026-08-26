#!/usr/bin/env python3
"""GATE: the Marble ring and cut-out code paths run against the REAL gs.Context
and a stub engine, so a wrong call into our own helpers (new_dynamic_mesh("x")
took the live run down) fails here, on the laptop, instead of on the Studio.

The stub `unreal` answers every engine call with a permissive object; the
Context's Python methods are the real ones. A line "V2 MARBLE ...: FAILED (...)"
or "cannot read" means a Python-level defect in OUR code, and fails the gate.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "infra", "build"))
os.environ.setdefault("WONDERLAND_TEXTURE_DIR", "/nonexistent")
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("dry", os.path.join(HERE, "..", "infra", "build", "verify-generator-dryrun.py"))
_dry = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_dry)
unreal = _dry.make_unreal()
sys.modules["unreal"] = unreal

import gs  # noqa: E402
import build_v2 as B  # noqa: E402

lines = []
B.LOG = lambda msg: lines.append(str(msg))


class _Vec(object):
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x, self.y, self.z = x, y, z


class _Xf(object):
    translation = _Vec()
    scale3d = _Vec(1, 1, 1)

    class rotation(object):
        @staticmethod
        def rotator():
            return None

    def inverse(self):
        return self

    def transform_location(self, v):
        return _Vec(getattr(v, "x", 0.0), getattr(v, "y", 0.0), getattr(v, "z", 0.0))


class _Comp(object):
    def get_editor_property(self, name):
        return unreal.StaticMesh()

    def set_collision_enabled(self, *_a):
        pass


class _Actor(object):
    def get_component_by_class(self, cls):
        return _Comp()

    def get_actor_transform(self):
        return _Xf()

    def get_editor_property(self, name):
        return []

    def set_editor_property(self, *_a):
        pass

    def get_actor_location(self):
        return _Vec(0.0, 30000.0, 0.0)


unreal.Vector = _Vec
ctx = gs.Context(unreal, log=lambda *a: None) if "log" in gs.Context.__init__.__code__.co_varnames else gs.Context(unreal)
ctx.backend = "geometry-script"          # force the GS code path against the stub
B.C.LOOK["marbleDistant"] = 1
B.C.LOOK["marbleCutouts"] = 1
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem) if hasattr(unreal, "get_editor_subsystem") else unreal.EditorActorSubsystem()
eal = unreal.EditorAssetLibrary
B.marble_distant_ring(_Actor(), actors, eal, {}, ctx)
B.marble_cutouts(_Actor(), actors, eal, {}, ctx)
bad = [l for l in lines if "FAILED (" in l or "cannot read" in l or "Traceback" in l]
for l in lines:
    print(" ", l[:160])
if bad:
    print("FAIL: Python-level defect in the Marble code paths: %s" % bad[0][:200])
    sys.exit(1)
print("PASS: Marble ring + cut-out paths run against the real Context (engine calls stubbed)")
