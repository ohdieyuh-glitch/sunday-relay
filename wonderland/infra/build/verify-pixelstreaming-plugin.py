#!/usr/bin/env python3
"""Does the engine actually have the Pixel Streaming plugin the project enables?

WHY THIS EXISTS. The packaged Wonderland ran on the L4, Wilbur served, the
player page loaded — and the browser said "No streamer available" because
Wonderland.uproject enabled no Pixel Streaming plugin at all. app.log carried
the -PixelStreamingURL command line and not one line of streamer, WebRTC or
encoder startup, because there was no streamer in the build to start.

Enabling a plugin the engine does not have fails at package time instead, which
is better but still costs a cook. So this proves the name against the real
engine BEFORE the cook, and — when the engine is reachable — prints every
PixelStreaming* plugin it does have, so a wrong name is corrected from evidence
rather than from another guess.

Exit 0  the enabled plugins all exist (or the engine is not reachable to check)
Exit 1  the project enables a plugin this engine does not provide
Exit 2  the project enables no Pixel Streaming plugin at all
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
UPROJECT = os.path.normpath(os.path.join(HERE, "..", "..", "Wonderland.uproject"))


def engine_roots():
    """Where an engine might be. Env first, then the Lightning defaults."""
    out = []
    for v in ("WL_UE", "UE_ROOT", "UNREAL_ENGINE_ROOT"):
        if os.environ.get(v):
            out.append(os.environ[v])
    root = os.environ.get("WL_ROOT", "")
    if root:
        out.append(os.path.join(root, "UnrealEngine"))
    out.append("/teamspace/studios/this_studio/wonderland/UnrealEngine")
    out.append("/home/ue4/UnrealEngine")
    return [p for p in out if p and os.path.isdir(p)]


def find_plugins(root):
    """Every *.uplugin under the engine whose name mentions PixelStreaming."""
    found = {}
    plug_root = os.path.join(root, "Engine", "Plugins")
    if not os.path.isdir(plug_root):
        return found
    for dirpath, dirnames, filenames in os.walk(plug_root):
        # Do not descend into intermediates; they carry no manifests and make
        # this walk far slower than it needs to be on a 100 GB tree.
        dirnames[:] = [d for d in dirnames if d not in ("Intermediate", "Binaries", "Content")]
        for fn in filenames:
            if fn.endswith(".uplugin") and "pixelstreaming" in fn.lower():
                found[fn[: -len(".uplugin")]] = os.path.join(dirpath, fn)
    return found


def enabled_ps_plugins(uproject):
    with open(uproject, encoding="utf8") as fh:
        data = json.load(fh)
    out = []
    for p in data.get("Plugins", []):
        if not p.get("Enabled", False):
            continue
        if "pixelstreaming" in p.get("Name", "").lower():
            # An editor-only allow-list would not stage into a packaged Linux
            # build, which is the whole point here.
            out.append((p["Name"], p.get("TargetAllowList")))
    return out


def main():
    enabled = enabled_ps_plugins(UPROJECT)
    if not enabled:
        print("FAIL: Wonderland.uproject enables no Pixel Streaming plugin.")
        print("      A packaged build then has no streamer, the client starts,")
        print("      and the browser reports 'No streamer available'.")
        return 2

    for name, allow in enabled:
        if allow:
            print("FAIL: %s is restricted to %s — it would not stage into the "
                  "packaged Linux build." % (name, allow))
            return 1
        print("project enables: %s (all targets)" % name)

    roots = engine_roots()
    if not roots:
        # Not a pass and not a failure: say which it is. The build gate on the
        # Lightning box has an engine and will settle it there.
        print("UNVERIFIED: no engine tree reachable from here, so the plugin "
              "name could not be confirmed against a real UE 5.8 install.")
        print("            Set WL_UE, or run this on the Lightning Studio.")
        return 0

    for root in roots:
        have = find_plugins(root)
        if not have:
            continue
        print("engine %s provides: %s" % (root, ", ".join(sorted(have))))
        missing = [n for n, _ in enabled if n not in have]
        if missing:
            print("FAIL: this engine has no %s." % ", ".join(missing))
            print("      Enable one of the names listed above in "
                  "Wonderland.uproject instead. Do not guess.")
            return 1
        print("OK: every enabled Pixel Streaming plugin exists in this engine.")
        return 0

    print("UNVERIFIED: engine tree(s) found but no PixelStreaming*.uplugin in "
          "them (%s). If the engine is a Docker image rather than a directory, "
          "run this inside the container." % ", ".join(roots))
    return 0


if __name__ == "__main__":
    sys.exit(main())
