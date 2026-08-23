#!/usr/bin/env python3
"""A Blueprint-exposed UPROPERTY in a private section will not compile.

THE BUILD THIS COST

    WonderlandStrollingDog.h(218): Error: BlueprintReadOnly should not be used
    on private

Unreal Header Tool refuses BlueprintReadOnly and BlueprintReadWrite on private
members unless the property carries meta=(AllowPrivateAccess="true"). The rule
is not obscure — but it is invisible on this laptop, because UHT only runs
inside the engine. Seven properties added over a session all landed in the
private section, and the first time anything said so was thirteen seconds into
a compile, on a rented L4, after a 73 GB image restore.

That is a TEXT-LEVEL property of a header file. It needs no engine to check.

Runs anywhere; no engine, no GPU.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.normpath(os.path.join(HERE, "..", "..", "Source", "Wonderland"))

ACCESS = re.compile(r"^\s*(public|protected|private)\s*:")
UPROP = re.compile(r"^\s*UPROPERTY\s*\(")


def main():
    bad = []
    checked = 0
    for name in sorted(os.listdir(SOURCE)):
        if not name.endswith(".h"):
            continue
        path = os.path.join(SOURCE, name)
        # Access defaults to PRIVATE in a class and PUBLIC in a struct. UCLASS
        # bodies are classes, and GENERATED_BODY() re-opens as public — which is
        # why the section is tracked from the last explicit specifier rather
        # than assumed.
        section = "private"
        for n, line in enumerate(io.open(path, encoding="utf8"), 1):
            m = ACCESS.match(line)
            if m:
                section = m.group(1)
                continue
            if "GENERATED_BODY" in line:
                section = "public"
                continue
            if not UPROP.match(line):
                continue
            checked += 1
            if section != "private":
                continue
            if "Blueprint" not in line:
                continue          # EditAnywhere alone is fine on a private member
            if "AllowPrivateAccess" in line:
                continue
            bad.append((name, n, line.strip()[:96]))

    if bad:
        sys.stderr.write(
            "verify-uproperty-access: %d Blueprint-exposed UPROPERTY(s) are in a "
            "private section without meta=(AllowPrivateAccess=\"true\").\n"
            "Unreal Header Tool REFUSES these, and it only says so inside the "
            "engine — this is a compile failure waiting for a GPU.\n\n" % len(bad))
        for name, n, text in bad:
            sys.stderr.write("  %s(%d): %s\n" % (name, n, text))
        raise SystemExit(1)

    print("verify-uproperty-access: ok — %d UPROPERTY declarations, none "
          "Blueprint-exposed from a private section without AllowPrivateAccess"
          % checked)


if __name__ == "__main__":
    main()
