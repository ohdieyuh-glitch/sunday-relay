#!/usr/bin/env python3
"""Execute the REAL build_leaf_material() offline and check what it wires up.

THE COVERAGE HOLE THIS FILLS. Every other offline harness replaces
build_leaf_material() with wl_preview_leaf.leaf_stub, because a stub `unreal`
cannot build a material graph and the generator's seven `if "leafcard" in MATS`
branches must still be taken. That is the right call for those harnesses -- and
it leaves ~120 lines of material code, the code that decides how every leaf in
Wonderland is lit, running for the first time inside a twelve-minute GPU build.

That is not hypothetical. A `Cannot nativize 'Color' as 'LinearColor'` error in
exactly this kind of code killed a real build earlier in this sprint, and the
dry run had passed.

So this harness does the opposite: it calls the real function against the same
stub engine and records what it asks the engine for. It cannot prove the
material LOOKS right -- only a GPU render can -- but it proves the code runs,
and it proves the specific wiring the frame depends on is present.

What it checks, and why each one is here:

  - the function does not bail. Its first line returns {} when there is no leaf
    mask, and a silent {} is how foliage would go opaque with no error.
  - the shading model is MSM_TWO_SIDED_FOLIAGE. attribute-dark.py measured
    foliage carrying 12.8% of the arrival frame as DARK pixels, with individual
    canopy blobs 83-100% dark: backlit leaves with no transmission resolve to
    their own shadow.
  - MP_SUBSURFACE_COLOR is connected. The shading model without a subsurface
    input transmits black, which is the bug it was meant to fix.
  - base colour, opacity mask and normal are still connected, so a future edit
    cannot trade the canopy's shape away for its light.
"""
import importlib.util
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")


def load_dryrun():
    """Import verify-generator-dryrun.py for its stub engine (dashes in name)."""
    spec = importlib.util.spec_from_file_location(
        "wl_dryrun", os.path.join(HERE, "verify-generator-dryrun.py"))
    mod = importlib.util.module_from_spec(spec)
    # It runs its own main() only under __main__, so importing is safe.
    spec.loader.exec_module(mod)
    return mod


def main():
    dry = load_dryrun()
    stub = dry.make_unreal()

    # MSM_TWO_SIDED_FOLIAGE must EXIST on the stub or the generator's
    # getattr(..., None) skips the branch and this gate would pass vacuously.
    if getattr(stub.MaterialShadingModel, "MSM_TWO_SIDED_FOLIAGE", None) is None:
        print("FAIL: the stub engine has no MaterialShadingModel."
              "MSM_TWO_SIDED_FOLIAGE, so this gate would prove nothing")
        return 1

    connected = []
    mel = stub.MaterialEditingLibrary
    real_connect = mel.connect_material_property

    def spy_connect(expr, out, prop):
        connected.append(str(prop))
        return real_connect(expr, out, prop)

    mel.connect_material_property = spy_connect

    # Per-ASSET, not shared: one dict across every created asset would let a
    # different material's shading_model satisfy the check for this one.
    props_by_asset = {}
    made = {"n": 0}
    tools = stub.AssetToolsHelpers.get_asset_tools()
    real_create = tools.create_asset

    class Recorder(object):
        def __init__(self, inner, name):
            self._inner = inner
            self._name = name

        def set_editor_property(self, k, v):
            props_by_asset.setdefault(self._name, {})[k] = v
            return getattr(self._inner, "set_editor_property", lambda *a: None)(k, v)

        def get_editor_property(self, k):
            return props_by_asset.get(self._name, {}).get(k)

        def __getattr__(self, k):
            return getattr(self._inner, k)

    def spy_create(name, pkg, cls, factory):
        made["n"] += 1
        return Recorder(real_create(name, pkg, cls, factory), str(name))

    tools.create_asset = spy_create
    stub.AssetToolsHelpers.get_asset_tools = lambda: tools

    sys.modules["unreal"] = stub
    ns = {"__name__": "__wl_leafgate__", "__file__": GEN}
    exec(compile(io.open(GEN, encoding="utf8").read(), GEN, "exec"), ns)

    # A texture set that satisfies the guard. Values only need to be truthy:
    # the point is to reach the graph, not to sample it.
    texs = {k: object() for k in ("leafcard_a", "leafcard_n", "leafcard_m")}
    try:
        out = ns["build_leaf_material"](texs)
    except Exception as exc:
        print("FAIL: build_leaf_material raised %s: %s" % (type(exc).__name__, exc))
        import traceback
        traceback.print_exc()
        return 1

    failures = []
    if not out:
        failures.append("returned no material instances - it bailed out silently")
    else:
        missing = [k for k in ("leafcard", "leafcard_hi", "leafcard_deep") if k not in out]
        if missing:
            failures.append("missing instances: %s" % ", ".join(missing))

    if made["n"] == 0:
        failures.append("created no material asset at all")

    want_sm = stub.MaterialShadingModel.MSM_TWO_SIDED_FOLIAGE
    props = props_by_asset.get("M_WLLeaf", {})
    if not props:
        failures.append("M_WLLeaf was never created - the graph below it "
                        "never ran, so nothing here was actually checked")
    # The stub returns a fresh string per attribute access, so compare by
    # VALUE. Identity would fail against a real engine enum too.
    if props.get("shading_model") != want_sm:
        failures.append("shading_model is %r, not MSM_TWO_SIDED_FOLIAGE - a "
                        "backlit canopy renders as its own shadow"
                        % (props.get("shading_model"),))
    if props.get("two_sided") is not True:
        failures.append("two_sided is not True")
    if props.get("blend_mode") is None:
        failures.append("blend_mode was never set (leaf cards need MASKED)")

    for want in ("MP_SUBSURFACE_COLOR", "MP_BASE_COLOR",
                 "MP_OPACITY_MASK", "MP_NORMAL"):
        if not any(want in c for c in connected):
            failures.append("%s is never connected" % want)

    print("material assets created : %d" % made["n"])
    print("instances returned      : %s" % ", ".join(sorted(out)) if out else "(none)")
    print("assets recorded         : %d (%s)"
          % (len(props_by_asset), ", ".join(sorted(props_by_asset))[:80]))
    print("shading_model           : %r" % (props.get("shading_model"),))
    print("properties connected    : %d" % len(connected))
    print()
    if failures:
        print("FAIL: %d problem(s) in the leaf material" % len(failures))
        for f in failures:
            print("  - %s" % f)
        return 1
    print("PASS: the real leaf material builds, is two-sided foliage, and "
          "transmits through a subsurface input")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
