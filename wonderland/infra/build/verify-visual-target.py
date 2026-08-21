#!/usr/bin/env python3
"""Check the arrival frame against wonderland/WorldDesign/visual-target.json.

    python3 verify-visual-target.py                 # runs the preview itself
    python3 verify-visual-target.py --facts f.json  # reuse an earlier run

WHAT THIS IS NOT

It is not a similarity score and it never will be. Every criterion is a
STRUCTURAL property of the frame — how much of it is objects, how many depth
bands carry weight, how much is carried by lone primitives, whether the Relay
Dogs can be read, what the colour families are. Those are measurable and
arguable. "How close is this to the reference" is neither, and the founder is
the authority on it.

A criterion that FAILS is a finding, not a verdict. The right response to
"green is 30% and the target is 25%" is to look at the frame and decide whether
the target or the world is wrong — and the target file says so about itself.
"""
import argparse
import io
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.normpath(os.path.join(HERE, "..", "..", "WorldDesign",
                                       "visual-target.json"))
PREVIEW = os.path.join(HERE, "verify-hero-composition.py")


def dig(facts, path):
    """Fetch a dotted metric path out of the facts, or None."""
    node = facts
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--facts", default=None,
                        help="a facts JSON from verify-hero-composition.py --json=")
    parser.add_argument("--preview", default=None, help="where to write the PNG")
    args = parser.parse_args(argv)

    with io.open(TARGET, encoding="utf8") as handle:
        target = json.load(handle)

    facts_path = args.facts
    tmp = None
    if not facts_path:
        tmp = tempfile.mkdtemp(prefix="visual-target-")
        facts_path = os.path.join(tmp, "facts.json")
        png = args.preview or os.path.join(tmp, "preview.png")
        result = subprocess.run(
            [sys.executable, PREVIEW, png, "--json=%s" % facts_path],
            capture_output=True, text=True)
        if result.returncode != 0 or not os.path.exists(facts_path):
            sys.stderr.write(result.stdout[-3000:])
            sys.stderr.write(result.stderr[-3000:])
            print("FAIL the composition preview did not produce facts. Nothing "
                  "was measured, so nothing below would have meant anything.")
            return 2
        print("preview: %s" % png)
    with io.open(facts_path, encoding="utf8") as handle:
        facts = json.load(handle)

    passed, failed, unmeasured = [], [], []
    print("\nVISUAL TARGET  (%s)\n" % target.get("camera"))
    for name, rule in target["criteria"].items():
        metric = rule["metric"]
        value = dig(facts, metric)

        if metric == "depth_pixels":
            # Every band must carry weight, not just the total.
            floor = rule["min_each"]
            if not isinstance(value, dict):
                unmeasured.append((name, metric))
                continue
            worst = min(value.items(), key=lambda kv: kv[1])
            ok = worst[1] >= floor
            detail = "near/mid/far = %s" % ", ".join(
                "%s %.1f%%" % (k, v) for k, v in sorted(value.items()))
            _emit(name, ok, detail, "each >= %.1f%%" % floor, passed, failed)
            continue

        if value is None:
            unmeasured.append((name, metric))
            continue
        if not isinstance(value, (int, float)):
            unmeasured.append((name, metric))
            continue

        low, high = rule.get("min"), rule.get("max")
        ok = True
        want = []
        if low is not None:
            ok = ok and value >= low
            want.append(">= %s" % low)
        if high is not None:
            ok = ok and value <= high
            want.append("<= %s" % high)
        _emit(name, ok, "%.2f" % value, " and ".join(want) or "any", passed, failed)

    print("\n  %d met, %d not met, %d not measured"
          % (len(passed), len(failed), len(unmeasured)))
    for name, metric in unmeasured:
        print("    NOT MEASURED  %-28s (%s missing from the facts)" % (name, metric))
    if failed:
        print("\n  Not met — each of these is a FINDING, not a verdict:")
        for name in failed:
            print("    - %s: %s" % (name, target["criteria"][name]["why"]))
    print("\n  Human visual review is the authority. Nothing here scores the "
          "frame against the reference image.")
    # Unmeasured criteria fail the run: a gate that silently skips what it
    # cannot read is a gate that passes as it stops working.
    return 1 if (failed or unmeasured) else 0


def _emit(name, ok, detail, want, passed, failed):
    (passed if ok else failed).append(name)
    print("  %-4s %-28s %-32s want %s"
          % ("ok" if ok else "MISS", name, detail, want))


if __name__ == "__main__":
    sys.exit(main())
