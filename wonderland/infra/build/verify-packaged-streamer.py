#!/usr/bin/env python3
"""Does the packaged Linux build actually contain a Pixel Streaming runtime?

THE FAILURE THIS CATCHES. A package can be perfectly healthy — it runs, it uses
the GPU, it accepts -PixelStreamingURL without complaint — and contain no
streamer at all. That is exactly what happened: the browser said "No streamer
available" and app.log held the command line and zero PixelStreaming, WebRTC or
encoder lines. An unknown command-line switch is not an error to Unreal, so
nothing announced the problem.

Several independent signals are checked because packaging layout differs
between monolithic and modular builds, and a check that only knows one layout
reports a false failure on the other. Any ONE authoritative hit is a pass;
none at all is a real failure.

Exit 0 PASS   1 FAIL (no streamer in the package)   2 package not found
"""
import json, os, re, subprocess, sys

PS_PAT = re.compile(rb"PixelStreaming[0-9]?", re.I)


def staged_root():
    for v in ("WL_STAGED", "WL_OUT"):
        p = os.environ.get(v)
        if p:
            cand = p if os.path.basename(p) == "Linux" else os.path.join(p, "Linux")
            if os.path.isdir(cand):
                return cand
    for cand in ("/teamspace/studios/this_studio/wonderland/packaged/Linux",):
        if os.path.isdir(cand):
            return cand
    return None


def find_plugin_dirs(root):
    hits = []
    for dirpath, dirnames, _ in os.walk(root):
        for d in list(dirnames):
            if "pixelstreaming" in d.lower():
                hits.append(os.path.join(dirpath, d))
    return hits


def find_modules(root):
    """Shared objects and .modules entries naming the plugin."""
    so, mods = [], []
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            low = fn.lower()
            if "pixelstreaming" in low and (low.endswith(".so") or ".so." in low):
                so.append(os.path.join(dirpath, fn))
            elif fn.endswith(".modules"):
                try:
                    with open(os.path.join(dirpath, fn), encoding="utf8") as fh:
                        data = json.load(fh)
                except Exception:
                    continue
                for name in (data.get("Modules") or {}):
                    if "pixelstreaming" in name.lower():
                        mods.append("%s -> %s" % (fn, name))
    return so, mods


def find_in_executable(root):
    """A monolithic shipping build links plugin code into the binary, so the
    only trace is symbol/string data inside the executable itself."""
    exe = None
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            p = os.path.join(dirpath, fn)
            if fn.startswith("Wonderland") and os.access(p, os.X_OK) and not fn.endswith(".sh"):
                if os.path.getsize(p) > 5 * 1024 * 1024:
                    exe = p
                    break
        if exe:
            break
    if not exe:
        return None, 0
    # Scan in chunks with an overlap, so a match spanning a boundary is not
    # lost and a multi-GB binary is not read into memory at once.
    hits, tail = 0, b""
    with open(exe, "rb") as fh:
        while True:
            chunk = fh.read(8 * 1024 * 1024)
            if not chunk:
                break
            hits += len(PS_PAT.findall(tail + chunk))
            tail = chunk[-32:]
    return exe, hits


def main():
    root = staged_root()
    if not root:
        print("PACKAGE NOT FOUND: set WL_OUT or WL_STAGED to the staged build.")
        return 2
    print("package: %s" % root)

    plugin_dirs = find_plugin_dirs(root)
    so, mods = find_modules(root)
    exe, exe_hits = find_in_executable(root)

    for d in plugin_dirs:
        print("  staged plugin dir : %s" % d)
    for s in so:
        print("  plugin module     : %s" % s)
    for m in mods:
        print("  .modules entry    : %s" % m)
    if exe:
        print("  executable        : %s (%d PixelStreaming references)" % (exe, exe_hits))
    else:
        print("  executable        : not found under the staged tree")

    if plugin_dirs or so or mods or exe_hits > 0:
        print("PASS: the package contains a Pixel Streaming runtime.")
        return 0

    print("FAIL: no Pixel Streaming runtime anywhere in this package.")
    print("      This build will start, accept -PixelStreamingURL, log nothing")
    print("      about a streamer, and the browser will say 'No streamer available'.")
    print("      Enable the plugin in Wonderland.uproject and repackage.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
