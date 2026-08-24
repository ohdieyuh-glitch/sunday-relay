#!/usr/bin/env python3
"""No visible production mesh may resolve to a default or placeholder material.

WHY THIS EXISTS

The founder's instruction is explicit: "No default Unreal gray, checker,
unassigned material, or placeholder material may appear in the hero view. Add
an automated validator that fails if a visible production mesh resolves to a
default/placeholder material."

It is a real class of defect here and not a hypothetical. This world has
already shipped two versions of it:

  - the batched pieces once carried a material PATH but no object, and the
    cooker strips what nothing references, so 146 batches drew engine grey;
  - a material assignment once ran BEFORE component registration, which
    discards the override, so the mesh default drew instead.

Both looked fine in the source. Only the frame disagreed.

WHAT IT CHECKS, and why it is offline

Every piece the generator places names a material. This walks the generator
against the stub and asserts that every one of those names RESOLVES -- that it
exists in the material library the same run built. A piece whose material is
None is a piece that will draw with whatever the mesh defaults to, and in this
project that is engine grey with a checkerboard.

It cannot see a cook that strips an asset, which is what the runtime FORENSIC
lines in WonderlandInstancedBatch.cpp are for. The two are complementary: this
one fails on a laptop in seconds, that one fails on the box with the truth.
"""
import importlib.util
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")

# Names that mean "nobody chose this", whatever the engine calls them.
PLACEHOLDER_TOKENS = ("worldgrid", "defaultmaterial", "basicshapematerial",
                      "default_material", "checker", "placeholder", "m_default")


def main():
    spec = importlib.util.spec_from_file_location(
        "wl_dryrun_ph", os.path.join(HERE, "verify-generator-dryrun.py"))
    dry = importlib.util.module_from_spec(spec)
    dry_mod = dry
    spec.loader.exec_module(dry_mod)
    stub = dry_mod.make_unreal()

    Any = dry_mod.Any
    real_call = Any.__call__

    placed = {"total": 0, "unresolved": 0}
    unresolved_labels = []
    suspicious = []

    def spy(self, *a, **kw):
        nm = getattr(self, "_name", "")
        # Every batched piece announces its material object and path.
        if nm.endswith("set_editor_property") and len(a) >= 2:
            if a[0] in ("MaterialPath", "material_path") and isinstance(a[1], str):
                low = a[1].lower()
                if any(t in low for t in PLACEHOLDER_TOKENS):
                    suspicious.append(a[1])
        return real_call(self, *a, **kw)

    Any.__call__ = spy
    sys.modules["unreal"] = stub
    ns = {"__name__": "__wl_placeholder__", "__file__": GEN}
    src = io.open(GEN, encoding="utf8").read()

    # Instrument the ONE place every visible piece resolves its material, so
    # this counts what is actually placed rather than what is declared.
    marker = "        _lb = label or \"\""
    if marker not in src:
        print("FAIL: could not find the material resolution point in the "
              "generator. This validator has drifted from the code it checks, "
              "and a validator that cannot find its subject must not pass.")
        return 1
    src = src.replace(
        marker,
        "        _WL_PH['total'] += 1\n"
        "        if m is None:\n"
        "            _WL_PH['unresolved'] += 1\n"
        "            if len(_WL_PH_LABELS) < 12:\n"
        "                _WL_PH_LABELS.append(str(label) + ' / ' + str(mat))\n"
        + marker, 1)

    ns["_WL_PH"] = placed
    ns["_WL_PH_LABELS"] = unresolved_labels
    try:
        exec(compile(src, GEN, "exec"), ns)
    finally:
        Any.__call__ = real_call

    print("visible pieces placed        : %d" % placed["total"])
    print("pieces with NO material      : %d" % placed["unresolved"])
    print("placeholder material paths   : %d" % len(suspicious))
    print()

    if placed["total"] == 0:
        print("FAIL: no placed pieces were observed at all. Either the world is "
              "empty or this validator no longer sees it -- and a check that "
              "checked nothing must not report a pass.")
        return 1

    failed = False
    if placed["unresolved"] > 0:
        failed = True
        print("FAIL: %d visible pieces resolve NO material and will draw with "
              "the mesh default -- engine grey, and a checkerboard on anything "
              "flat enough to show it." % placed["unresolved"])
        for lab in unresolved_labels:
            print("   %s" % lab)
        print()
    if suspicious:
        failed = True
        print("FAIL: %d pieces point at a placeholder material path:"
              % len(suspicious))
        for p in sorted(set(suspicious))[:8]:
            print("   %s" % p)
        print()

    if failed:
        return 1
    print("PASS: every visible piece resolves a real, chosen material.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
