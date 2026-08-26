#!/usr/bin/env python3
"""The V1 write-guard. Legacy Wonderland visual content is READ-ONLY on V2.

    python3 wonderland/tools/v1_guard.py                # staged changes (pre-commit)
    python3 wonderland/tools/v1_guard.py --since 667fbf9 # a range
    python3 wonderland/tools/v1_guard.py --self-test    # prove it bites

Exit 1 with the offending paths when a `relay/wonderland-v2*` branch modifies
LEGACY VISUAL CONTENT (the deny-list in V1-LEGACY-MANIFEST.md), unless
WONDERLAND_V1_OVERRIDE is set to a non-empty reason -- then it prints the
reason and passes, so the override is visible in the log. On any other branch
it only reports. Shared engineering is never blocked.

Deliberately simple: a path list and `git diff --name-only`. A guard nobody
can predict is a guard people route around.
"""
import fnmatch
import os
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

LEGACY = (
    "wonderland/infra/build/generate-hub-level.py",
    "wonderland/WorldDesign/hub-layout.json",
    "wonderland/WorldDesign/visual-target.json",
    "wonderland/infra/build/hd/assets.py",
    "wonderland/infra/build/hd/arrival.py",
    "wonderland/infra/build/verify-hero-*.py",
    "wonderland/infra/build/verify-landmark-*.py",
    "wonderland/infra/build/verify-static-environment.py",
    "wonderland/infra/build/verify-light-budget.py",
    "wonderland/infra/build/verify-sky-fill.py",
    "wonderland/infra/build/verify-leaf-material.py",
    "wonderland/infra/build/verify-colourfulness.py",
    "wonderland/infra/build/verify-palette-saturation.py",
    "wonderland/infra/build/verify-material-usage-flags.py",
    "wonderland/infra/build/verify-base-colour-wired.py",
    "wonderland/infra/build/verify-no-placeholder-materials.py",
    "wonderland/infra/build/verify-texture-families.py",
    "wonderland/infra/build/verify-canonical-dog.py",
    "wonderland/infra/build/verify-dog-proxy.py",
    "wonderland/infra/build/measure-*.py",
    "wonderland/infra/build/compare-*.py",
    "wonderland/infra/build/attribute-dark.py",
    "wonderland/infra/build/palette.py",
    "wonderland/infra/build/hero_shots.py",
    "wonderland/infra/build/render-*-strip.py",
    "wonderland/infra/build/emit-dog-body.py",
    "wonderland/infra/build/TASK5-NIAGARA.md",
    "wonderland/infra/build/GPU-READY-QUEUE.md",
    "wonderland/infra/build/HANDOVER.md",
    "wonderland/marble/worlds/*",
)
V2_BRANCH_PREFIX = "relay/wonderland-v2"


def git(*args):
    return subprocess.run(["git"] + list(args), cwd=REPO, capture_output=True, text=True).stdout


def changed(since=None):
    if since:
        out = git("diff", "--name-only", since, "HEAD")
        out += git("diff", "--name-only", "HEAD")
        out += git("diff", "--name-only", "--cached")
    else:
        out = git("diff", "--name-only", "--cached")
    return sorted(set(p.strip() for p in out.splitlines() if p.strip()))


def legacy_hits(paths):
    hits = []
    for p in paths:
        for pat in LEGACY:
            if fnmatch.fnmatch(p, pat) or p.startswith(pat.rstrip("*")) and pat.endswith("*"):
                hits.append((p, pat))
                break
    return hits


def main(argv):
    if "--self-test" in argv:
        hits = legacy_hits(["wonderland/infra/build/generate-hub-level.py",
                            "wonderland/infra/build/verify-hero-corridor.py",
                            "wonderland/marble/worlds/royal-garden-backdrop/manifest.json",
                            "wonderland/v2/build_v2.py",
                            "wonderland/Source/Wonderland/WonderlandGameMode.cpp",
                            "wonderland/infra/build/gen-textures.py"])
        got = sorted(h[0] for h in hits)
        want = ["wonderland/infra/build/generate-hub-level.py",
                "wonderland/infra/build/verify-hero-corridor.py",
                "wonderland/marble/worlds/royal-garden-backdrop/manifest.json"]
        if got != want:
            print("V1 GUARD SELF-TEST FAILED: got %s want %s" % (got, want))
            return 1
        print("V1 GUARD SELF-TEST OK: bites on legacy paths, ignores shared engineering and V2")
        return 0
    since = None
    for a in argv:
        if a.startswith("--since="):
            since = a.split("=", 1)[1]
    if "--since" in argv:
        since = argv[argv.index("--since") + 1]
    branch = git("rev-parse", "--abbrev-ref", "HEAD").strip()
    paths = changed(since)
    hits = legacy_hits(paths)
    if not hits:
        print("V1 GUARD: %d changed path(s), none legacy (%s)" % (len(paths), branch))
        return 0
    override = os.environ.get("WONDERLAND_V1_OVERRIDE", "").strip()
    print("V1 GUARD: %d LEGACY VISUAL path(s) changed on %s:" % (len(hits), branch))
    for p, pat in hits:
        print("  %s   (rule: %s)" % (p, pat))
    if not branch.startswith(V2_BRANCH_PREFIX):
        print("V1 GUARD: not a V2 branch -- reporting only")
        return 0
    if override:
        print("V1 GUARD: OVERRIDDEN -- reason: %s" % override)
        return 0
    print("V1 GUARD: REFUSED. Old Wonderland is archive (V1-LEGACY-MANIFEST.md). "
          "Set WONDERLAND_V1_OVERRIDE=\"<reason>\" only with the founder's explicit decision.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
