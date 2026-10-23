#!/usr/bin/env python3
"""Mechanical proof: Wonder Web window code left WonderlandUiSubsystem verbatim.

Compares the working tree to aa930c269c43a52fc31c785f7bdcc231c8af6cf0.

Every line removed from WonderlandUiSubsystem.cpp must appear, in order, in
WonderlandWonderWebWindows.h then WonderlandWonderWebWindows.cpp. Lines added
around that move may only be includes, preprocessor guards, the log-category
declaration, comments, or blank lines. WonderlandUiSubsystem.h must be unchanged.

The one line that is not a pure deletion is the log category. It was
file-static, which a second translation unit cannot name and which a unity
build cannot define twice. It is now DECLARE_LOG_CATEGORY_EXTERN in the new
header and DEFINE_LOG_CATEGORY once in WonderlandUiSubsystem.cpp. Verbosity
stays Log, All.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

PIN = "aa930c269c43a52fc31c785f7bdcc231c8af6cf0"
ROOT = Path(__file__).resolve().parents[2]
CPP_REL = "wonderland/Source/Wonderland/WonderlandUiSubsystem.cpp"
H_REL = "wonderland/Source/Wonderland/WonderlandUiSubsystem.h"
NEW_H = "wonderland/Source/Wonderland/WonderlandWonderWebWindows.h"
NEW_CPP = "wonderland/Source/Wonderland/WonderlandWonderWebWindows.cpp"

# Inclusive 1-based ranges at PIN. 1556-1680 (EnsureWonderWebWindow) sits inside
# the first helper cluster; 3176-3666 is the manager cluster through
# HandleJuliusConnectChanged.
RANGES = ((96, 119), (1525, 1771), (3176, 3666))
ANCHORS = {
    96: "// Named, not anonymous: the module is one unity translation unit (see WonderlandCompanionHud.cpp).",
    110: "namespace WonderWebWorkspaceTuning",
    1525: "UWonderlandUiSubsystem::FWonderWebWindow* UWonderlandUiSubsystem::FindWonderWebWindow(FName Id)",
    1556: "UWonderlandUiSubsystem::FWonderWebWindow* UWonderlandUiSubsystem::EnsureWonderWebWindow(FName Id)",
    1680: "}",
    1771: "}",
    3176: "int32 UWonderlandUiSubsystem::CountOpenWonderWebWindows() const",
    3666: "}",
}
LOG_BEFORE = "DEFINE_LOG_CATEGORY_STATIC(LogWonderlandUi, Log, All);"
LOG_AFTER = "DEFINE_LOG_CATEGORY(LogWonderlandUi);"
INCLUDE = '#include "WonderlandWonderWebWindows.h"'

ALLOWED_PATHS = {
    CPP_REL,
    H_REL,
    NEW_H,
    NEW_CPP,
    "wonderland/Tools/ww-extract-proof.py",
    "wonderland/Tools/syntax-check.sh",
}


def git_show(rel: str) -> str:
    out = subprocess.check_output(["git", "show", f"{PIN}:{rel}"], cwd=ROOT)
    return out.decode("utf-8")


def allowed_addition(line: str) -> bool:
    stripped = line.strip()
    if stripped == "":
        return True
    if stripped.startswith("//"):
        return True
    if stripped.startswith("#"):
        return True
    if stripped.startswith("DECLARE_LOG_CATEGORY_EXTERN"):
        return True
    return False


def main() -> int:
    failures = []
    pin_cpp = git_show(CPP_REL).splitlines()
    pin_h = git_show(H_REL).splitlines()
    print(f"pin {PIN}")
    print(f"WonderlandUiSubsystem.cpp at pin: {len(pin_cpp)} lines")
    print(f"WonderlandUiSubsystem.h at pin: {len(pin_h)} lines")

    for number, expect in ANCHORS.items():
        got = pin_cpp[number - 1]
        if got != expect:
            failures.append(f"pin anchor {number} is {got!r}, expected {expect!r}")
        else:
            print(f"anchor {number}: {got}")

    removed = []
    for start, end in RANGES:
        chunk = pin_cpp[start - 1 : end]
        text = "\n".join(chunk)
        brace = text.count("{") - text.count("}")
        print(f"range {start}-{end}: {len(chunk)} lines, brace balance {brace}")
        if brace != 0:
            failures.append(f"range {start}-{end} brace balance {brace}")
        removed.extend(chunk)
    print(f"removed lines: {len(removed)}")

    new_h_path = ROOT / NEW_H
    new_cpp_path = ROOT / NEW_CPP
    if not new_h_path.is_file() or not new_cpp_path.is_file():
        failures.append("new WonderlandWonderWebWindows.h/.cpp missing")
        print("\n".join(failures))
        return 1
    new_lines = new_h_path.read_text().splitlines() + new_cpp_path.read_text().splitlines()
    print(f"new header: {len(new_h_path.read_text().splitlines())} lines")
    print(f"new cpp: {len(new_cpp_path.read_text().splitlines())} lines")

    index = 0
    additions = []
    for line in new_lines:
        if index < len(removed) and line == removed[index]:
            index += 1
        else:
            additions.append(line)
    if index != len(removed):
        failures.append(
            f"removed lines not found in order: matched {index} of {len(removed)}; "
            f"next missing: {removed[index]!r}"
        )
    else:
        print(f"matched removed lines in order: {index}")

    bad_additions = [line for line in additions if not allowed_addition(line)]
    print(f"added lines around the move: {len(additions)}")
    for line in additions:
        mark = "OK" if allowed_addition(line) else "BAD"
        shown = line if line.strip() else "<blank>"
        print(f"  {mark} {shown}")
    if bad_additions:
        failures.append(f"{len(bad_additions)} added line(s) are not includes, guards, comments, or blanks")

    # The subsystem cpp may only lose those ranges, gain one include, and retarget the log macro.
    expect_cpp = pin_cpp[:]
    for start, end in sorted(RANGES, reverse=True):
        del expect_cpp[start - 1 : end]
    replaced = 0
    for i, line in enumerate(expect_cpp):
        if line == LOG_BEFORE:
            expect_cpp[i] = LOG_AFTER
            replaced += 1
    if replaced != 1:
        failures.append(f"log-category line replacements: {replaced}")
    if not expect_cpp or expect_cpp[0] != '#include "WonderlandUiSubsystem.h"':
        failures.append("subsystem cpp does not start with its own header include")
    else:
        expect_cpp.insert(1, INCLUDE)
    actual_cpp = (ROOT / CPP_REL).read_text().splitlines()
    if actual_cpp != expect_cpp:
        failures.append("WonderlandUiSubsystem.cpp is not the pin minus the moved ranges")
        # show a short mismatch window
        for i, (want, got) in enumerate(zip(expect_cpp, actual_cpp)):
            if want != got:
                failures.append(f"  first cpp mismatch at new line {i+1}: got {got!r} want {want!r}")
                break
        else:
            failures.append(f"  length got {len(actual_cpp)} want {len(expect_cpp)}")
    else:
        print(f"WonderlandUiSubsystem.cpp matches the deletion exactly: {len(actual_cpp)} lines")
        print(f"log category line is now: {LOG_AFTER}")

    actual_h = (ROOT / H_REL).read_text().splitlines()
    if actual_h != pin_h:
        failures.append("WonderlandUiSubsystem.h changed; a pure move leaves the class declarations in place")
    else:
        print(f"WonderlandUiSubsystem.h unchanged: {len(actual_h)} lines")

    status = subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True)
    unexpected = []
    for line in status.splitlines():
        path = line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if path not in ALLOWED_PATHS:
            unexpected.append(line)
    if unexpected:
        failures.append("unexpected working tree paths:")
        failures.extend(f"  {line}" for line in unexpected)
    else:
        print("working tree has no paths outside the extraction")

    if failures:
        print("FAIL")
        for item in failures:
            print(item)
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
