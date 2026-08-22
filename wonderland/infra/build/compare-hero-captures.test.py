#!/usr/bin/env python3
"""The comparison must refuse captures that do not support their own claims.

A reporting tool that always prints a nice table is worse than none: it makes
every run look like a result. These fixtures are the three ways a hero capture
can be a lie -- the camera fell back, the world had no Marble in it, the world
had no Relay Dogs in it -- plus the one way it can be honest.
"""
import io
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "compare-hero-captures.py")
PASS, FAIL = [0], []


def check(name, ok, detail=""):
    if ok:
        PASS[0] += 1
        print("  ok   %s" % name)
    else:
        FAIL.append(name)
        print("  FAIL %s%s" % (name, ("\n         " + detail) if detail else ""))


def sidecar(root, name, cam, served, fell, fov, marble="1", dogs="7", stream=True):
    payload = {
        "hero_camera": cam,
        "build_sha": "26a5ea6" + "0" * 33,
        "branch": "relay/wonderland-marble",
        "png": os.path.join(root, name + ".png"),
        "generator_knobs": {"WONDERLAND_MARBLE_IMPORT": "royal-garden-backdrop"},
        "world_proof": [
            "HERO_CAM_REQUESTED=%d" % cam,
            "HERO_CAM_SERVED=%s" % served,
            "HERO_CAM_FELL_BACK=%d" % fell,
            "HERO_CAM_FOV=%.2f" % fov,
            "MARBLE_ACTORS=%s" % marble,
            "RUNTIME_RELAY_DOGS=%s" % dogs,
        ],
        "stream": ({"delivered": {"fps_mean": 58.0, "fps_p50": 60.0,
                                  "resolution": "1280x720"}} if stream else {}),
        "gpu": {"while_rendering": {"gpu_util_pct": 61, "vram_used_mib": 3820}},
    }
    path = os.path.join(root, name + ".json")
    with io.open(path, "w", encoding="utf8") as handle:
        json.dump(payload, handle)
    return path


def run(*paths):
    proc = subprocess.run([sys.executable, TOOL] + list(paths),
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return proc.returncode, proc.stdout.decode("utf8", "replace")


def main():
    root = tempfile.mkdtemp(prefix="hero-cmp-")
    try:
        good0 = sidecar(root, "good0", 0, "HeroCam0_1", 0, 62.0)
        good6 = sidecar(root, "good6", 6, "HeroCam6_1", 0, 75.0)
        code, out = run(good0, good6)
        check("an honest pair passes", code == 0, out[-400:])
        check("…and both FOVs are reported", "62.00" in out and "75.00" in out)
        check("…and frame time is derived from the delivered p50",
              "16.7" in out, "1000/60 should appear as the p50 frame time")

        fell = sidecar(root, "fell6", 6, "HeroCam0_1", 1, 62.0)
        code, out = run(good0, fell)
        check("a fallback is REFUSED", code == 1)
        check("…and named as a different camera", "FELL BACK" in out)

        code, out = run(sidecar(root, "nomarble", 0, "HeroCam0_1", 0, 62.0, marble="0"))
        check("a world with no Marble backdrop is refused", code == 1 and "NO Marble" in out)

        code, out = run(sidecar(root, "nodogs", 0, "HeroCam0_1", 0, 62.0, dogs="0"))
        check("a world with no Relay Dogs is refused", code == 1 and "NO Relay Dogs" in out)

        nostream = sidecar(root, "nostream", 0, "HeroCam0_1", 0, 62.0, stream=False)
        code, out = run(nostream)
        check("an unmeasured stream reads 'not measured', never 0",
              "not measured" in out and "0.0" not in out.split("delivered FPS mean")[1][:24],
              out[out.find("delivered FPS mean"):][:80])

        # The case that actually happened: nothing identified itself.
        silent = sidecar(root, "silent", 6, "HeroCam6_1", 0, 75.0)
        with io.open(silent, encoding="utf8") as handle:
            payload = json.load(handle)
        payload["world_proof"] = [l for l in payload["world_proof"]
                                  if not l.startswith("HERO_CAM_")]
        with io.open(silent, "w", encoding="utf8") as handle:
            json.dump(payload, handle)
        code, out = run(silent)
        check("a frame whose camera never identified itself is REFUSED",
              code == 1 and "did not report which camera" in out,
              "three -HeroCam values returned the same frame and nothing said so")

        other = sidecar(root, "other", 0, "HeroCam0_1", 0, 62.0)
        with io.open(other, encoding="utf8") as handle:
            payload = json.load(handle)
        payload["build_sha"] = "deadbee" + "0" * 33
        with io.open(other, "w", encoding="utf8") as handle:
            json.dump(payload, handle)
        code, out = run(good0, other)
        check("captures from two different builds are called out",
              "DIFFERENT builds" in out,
              "this project has already compared two captures that were the same binary")
    finally:
        import shutil
        shutil.rmtree(root, ignore_errors=True)

    print("\npassed %d, failed %d" % (PASS[0], len(FAIL)))
    for item in FAIL:
        print("  FAILED: %s" % item)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
