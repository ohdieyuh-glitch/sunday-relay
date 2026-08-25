#!/usr/bin/env python3
"""Refuse a diff that crosses the gauntlet's ownership line.

Two agents edit one Unreal project -- Claude Code (generator, C++, config) and
Aura (in-editor assets). Aura publishes no multi-agent guidance, UE allows one
editor instance, and the generator REGENERATES its own asset paths on every
build. So ownership is by path, the active writer is named in
wonderland/.gauntlet-lock, and this check refuses any diff whose files belong
to the other agent.

    python3 gauntlet-check.py [BASE]        # default BASE = origin/relay/wonderland-hd-rebuild or HEAD~1
    python3 gauntlet-check.py --self-test   # prove it bites

Exit 1 on a violation, on a missing lock, or on a lock naming an unknown writer.
The lock flip itself is always allowed.
"""
import io
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
LOCK = "wonderland/.gauntlet-lock"

OWNERS = {
    "claude": ("wonderland/infra/", "wonderland/Source/", "wonderland/Config/",
               "wonderland/WorldDesign/", "wonderland/Wonderland.uproject",
               "wonderland/GAUNTLET.md"),
    "aura":   ("wonderland/Content/Wonderland/Aura/", "wonderland/Saved/.Aura/Skills/"),
}


def read_lock(root):
    p = os.path.join(root, LOCK)
    if not os.path.exists(p):
        return None
    m = re.search(r"writer=(\w+)", io.open(p, encoding="utf-8").read())
    return m.group(1) if m else None


def owner_of(path):
    for who, prefixes in OWNERS.items():
        if any(path == pre or path.startswith(pre) for pre in prefixes):
            return who
    return None                      # unowned: shared, allowed


def check(paths, writer):
    if writer not in OWNERS:
        return ["lock names unknown writer %r" % writer]
    bad = []
    for p in paths:
        if p == LOCK:
            continue
        o = owner_of(p)
        if o is not None and o != writer:
            bad.append("%s is owned by %s, but the lock says writer=%s" % (p, o, writer))
    return bad


def changed_paths(root, base):
    out = subprocess.run(["git", "diff", "--name-only", base, "HEAD"], cwd=root,
                         capture_output=True, text=True)
    if out.returncode != 0:
        out = subprocess.run(["git", "diff", "--name-only", "HEAD~1", "HEAD"], cwd=root,
                             capture_output=True, text=True)
    staged = subprocess.run(["git", "diff", "--name-only", "--cached"], cwd=root,
                            capture_output=True, text=True).stdout
    return sorted(set((out.stdout + staged).split()))


def self_test():
    assert check(["wonderland/Source/Foo.cpp"], "aura"), "aura touching Source/ must be refused"
    assert check(["wonderland/Content/Wonderland/Aura/BP_Gate.uasset"], "claude"), \
        "claude touching Aura's subtree must be refused"
    assert not check(["wonderland/Content/Wonderland/Aura/BP_Gate.uasset", LOCK], "aura"), \
        "aura in its own subtree plus the lock flip must pass"
    assert not check(["wonderland/infra/build/generate-hub-level.py"], "claude")
    assert not check(["README.md"], "aura"), "unowned paths are shared"
    assert check(["anything"], "nobody"), "unknown writer must be refused"
    print("gauntlet-check self-test OK — bites on cross-ownership, passes own subtree + lock")
    return 0


def main():
    if "--self-test" in sys.argv:
        return self_test()
    base = next((a for a in sys.argv[1:] if not a.startswith("--")), None)
    if base is None:
        base = "origin/relay/wonderland-hd-rebuild"
    writer = read_lock(ROOT)
    if writer is None:
        print("gauntlet-check FAILED — no %s or no writer= line in it" % LOCK)
        return 1
    paths = changed_paths(ROOT, base)
    bad = check(paths, writer)
    if bad:
        print("gauntlet-check FAILED — writer=%s touched the other agent's files:" % writer)
        for b in bad:
            print("  " + b)
        return 1
    print("gauntlet-check OK — writer=%s, %d changed path(s), none cross ownership" % (writer, len(paths)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
