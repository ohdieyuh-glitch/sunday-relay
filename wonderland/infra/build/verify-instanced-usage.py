#!/usr/bin/env python3
"""Every MASTER material this world draws on instances must say it may.

WHY THIS EXISTS

A material without `bUsedWithInstancedStaticMeshes` is silently replaced by the
engine's DEFAULT GREY at draw time. Not an error, not a warning in the cook, not
a mismatch: SetMaterial and GetMaterial agree, the binding really is correct,
and the frame draws grey. It only happens in a cooked build, so the editor looks
fine.

This project has now been bitten twice. The first time it was 38 materials -- the
entire visible world -- and the fix was `wl_allow_instanced_use`, called from
M_WLMaster and M_WLLeaf. The second time was M_WLRunes, written afterwards,
which never called it: the arcane circle, the founder reference's most
identifying element, drew as a grey plane lying on grey cobbles and was
therefore invisible. Three passes were spent on its brightness and its texture
before the packaged log gave it away -- M_WLMaster and M_WLLeaf log the flag and
M_WLRunes did not.

That is the shape to catch: a rule applied to the materials that existed when it
was written, and not to the sibling added later.

    python3 verify-instanced-usage.py

Reads the generator as TEXT and requires that every `create_asset(..., "M_...",
unreal.Material, ...)` master is passed to wl_allow_instanced_use somewhere.
Exit 1 if one is not.

WHAT IT CANNOT SEE: a master built by some other call, and whether the property
actually took on this engine build (wl_allow_instanced_use tries two spellings
and logs which one worked -- read the packaged log for the FLAG lines).
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")

MASTER = re.compile(r'create_asset\(\s*"(M_[A-Za-z0-9_]+)"')
ALLOWED = re.compile(r'wl_allow_instanced_use\(\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*"([^"]+)"')


def main():
    src = io.open(GEN, encoding="utf-8").read()
    masters = sorted(set(MASTER.findall(src)))
    if not masters:
        print("verify-instanced-usage: no master materials found in %s — the "
              "pattern this gate reads has changed and it is not checking "
              "anything." % GEN)
        return 1
    # the label passed to wl_allow_instanced_use may carry a suffix like
    # "M_WLMaster (cached)", so match on the leading name
    flagged = set()
    for label in ALLOWED.findall(src):
        flagged.add(label.split()[0])

    missing = [m for m in masters if m not in flagged]
    if not missing:
        print("verify-instanced-usage OK — %d master material(s) built, all "
              "passed to wl_allow_instanced_use: %s"
              % (len(masters), ", ".join(masters)))
        return 0

    print("verify-instanced-usage FAILED — %d master material(s) are built and "
          "never told they may draw on instanced static meshes:\n" % len(missing))
    for m in missing:
        print("  %s" % m)
    print("\n  UE replaces such a material with the DEFAULT GREY at draw time, "
          "silently,\n  in the cooked build only. Every binding check still "
          "passes.\n\n  FIX: call wl_allow_instanced_use(<the master>, \"%s\") "
          "where it is built." % missing[0])
    return 1


if __name__ == "__main__":
    sys.exit(main())
