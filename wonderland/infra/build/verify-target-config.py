#!/usr/bin/env python3
"""The UE targets must stay on 5.8 settings, and must not silence the check.

A real L4 run reached UnrealBuildTool and then failed WonderlandEditor with
OtherCompilationError / ExitCode=6:

    WonderlandEditor modifies the values of properties:
    [ UndefinedIdentifierWarningLevel: Off != Error, ... ]
    This is not allowed, as WonderlandEditor has build products in common
    with UnrealEditor.

Nothing in our targets set those warning levels. Asking for a LEGACY include
order (EngineIncludeOrderVersion.Unreal5_4) is what makes UBT relax them, so
that pre-5.8 code still compiles — and WonderlandEditor shares build products
with UnrealEditor, whose shared environment has them at Error.

Two ways to regress from here, and this guards both:

  1. Going back to legacy settings. The obsolete enum only WARNS (CS0618), so
     nothing stops someone reinstating it, and the failure returns at the end
     of a paid compile rather than here.
  2. Silencing the report instead of fixing it. UBT helpfully suggests
     bOverrideBuildEnvironment and TargetBuildEnvironment.Unique, and both are
     wrong for this project: Epic documents the former as "whether to IGNORE
     VIOLATIONS to the shared build environment", which leaves this target
     compiling engine headers under different warning rules than the engine
     did; the latter gives up sharing and rebuilds the engine per target,
     costing hours of GPU time to avoid a two-line migration.

Runs anywhere; no engine, no GPU.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, "..", "..", "Source"))
TARGETS = ("WonderlandEditor.Target.cs", "Wonderland.Target.cs")

# The engine this whole pipeline pins, by name, in the container tag and in
# build-wonderland.sh's hard version assertion.
WANT_BUILD_SETTINGS = "BuildSettingsVersion.V7"
WANT_INCLUDE_ORDER = "EngineIncludeOrderVersion.Unreal5_8"

# Legacy values that reproduce the exact L4 failure.
LEGACY_INCLUDE = re.compile(r"EngineIncludeOrderVersion\.Unreal5_(0|1|2|3|4|5|6|7)\b")
LEGACY_SETTINGS = re.compile(r"BuildSettingsVersion\.V([1-6])\b")

# Escape hatches that hide the problem rather than solve it.
SUPPRESSORS = (
    ("bOverrideBuildEnvironment", "ignores shared-build-environment violations "
                                  "instead of not causing one"),
    ("TargetBuildEnvironment.Unique", "abandons the shared engine build and "
                                      "rebuilds it per target — hours of GPU time"),
)


def strip_comments(text):
    """C# comments only; the file explains the fix at length and must not trip
    its own guard."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def main():
    fails = []
    for name in TARGETS:
        path = os.path.join(SRC, name)
        if not os.path.isfile(path):
            fails.append("%s is missing" % name)
            continue
        code = strip_comments(io.open(path, encoding="utf8").read())

        if WANT_BUILD_SETTINGS not in code:
            fails.append("%s does not set %s" % (name, WANT_BUILD_SETTINGS))
        if WANT_INCLUDE_ORDER not in code:
            fails.append("%s does not set %s" % (name, WANT_INCLUDE_ORDER))

        m = LEGACY_INCLUDE.search(code)
        if m:
            fails.append("%s pins %s — this is the exact L4 failure: a legacy "
                         "include order makes UBT relax warning levels the "
                         "shared UnrealEditor environment holds at Error"
                         % (name, m.group(0)))
        m = LEGACY_SETTINGS.search(code)
        if m:
            fails.append("%s pins %s, older than %s" % (name, m.group(0), WANT_BUILD_SETTINGS))

        for token, why in SUPPRESSORS:
            if token in code:
                fails.append("%s uses %s — %s" % (name, token, why))

    # Both targets must agree. A game target on different settings than the
    # editor target is a cook that behaves differently from what was tested.
    seen = {}
    for name in TARGETS:
        path = os.path.join(SRC, name)
        if not os.path.isfile(path):
            continue
        code = strip_comments(io.open(path, encoding="utf8").read())
        bs = re.search(r"DefaultBuildSettings\s*=\s*([\w.]+)", code)
        io_ = re.search(r"IncludeOrderVersion\s*=\s*([\w.]+)", code)
        seen[name] = (bs.group(1) if bs else None, io_.group(1) if io_ else None)
    if len(set(seen.values())) > 1:
        fails.append("the targets disagree: %s" % seen)

    if fails:
        for f in fails:
            print("FAIL %s" % f)
        return 1
    print("TARGET CONFIG OK  %d targets on %s / %s, no build-environment overrides"
          % (len(TARGETS), WANT_BUILD_SETTINGS, WANT_INCLUDE_ORDER))
    return 0


if __name__ == "__main__":
    sys.exit(main())
