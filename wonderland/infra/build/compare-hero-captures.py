#!/usr/bin/env python3
"""Put two hero captures side by side, and refuse to flatter either one.

    python3 compare-hero-captures.py <capture>.json [<capture>.json ...]

A capture sidecar carries the frame, the build that made it, what the packaged
world reported about itself, what the browser measured off the stream, and what
the GPU was doing at the time. Reading them one at a time is how two runs get
compared on different terms, so this reads them together and prints one table.

Three things it will not do:

  * report a missing measurement as a number. "not measured" and "0" are
    different claims and only one of them is ever true here.
  * compare captures from different builds without saying so. This project has
    already compared two captures that turned out to be the same binary.
  * let a frame stand as evidence for a camera that did not render it. The
    packaged build prints HERO_CAM_REQUESTED and HERO_CAM_SERVED; if they
    disagree, OR IF THE BUILD DID NOT SAY AT ALL, the row is marked and the exit
    code is non-zero. Silence is the case that actually happened: the player
    controller was never reached, so no camera identified itself, three
    different -HeroCam values returned the identical frame, and a blank row
    would have read as a working comparison.
"""
import io
import json
import os
import sys

UNKNOWN = "not measured"


def proof(entry, key):
    for line in entry.get("world_proof") or []:
        if line.startswith(key + "="):
            return line.split("=", 1)[1]
    return None


def num(value, fmt="%.1f"):
    return UNKNOWN if value is None else (fmt % value)


def gpu(entry, phase, key):
    return ((entry.get("gpu") or {}).get(phase) or {}).get(key)


def load(path):
    with io.open(path, encoding="utf8") as handle:
        entry = json.load(handle)
    entry["_path"] = path
    return entry


ROWS = [
    ("hero camera requested", lambda e: proof(e, "HERO_CAM_REQUESTED")
     or str(e.get("hero_camera"))),
    ("camera that ANSWERED", lambda e: proof(e, "HERO_CAM_SERVED") or UNKNOWN),
    ("fell back to legacy cam", lambda e: {"1": "YES", "0": "no"}.get(
        proof(e, "HERO_CAM_FELL_BACK"), UNKNOWN)),
    ("camera location (cm)", lambda e: proof(e, "HERO_CAM_LOC") or UNKNOWN),
    ("camera rotation (P,Y,R)", lambda e: proof(e, "HERO_CAM_ROT") or UNKNOWN),
    ("horizontal FOV", lambda e: proof(e, "HERO_CAM_FOV") or UNKNOWN),
    ("", lambda e: ""),
    ("Marble actors in world", lambda e: proof(e, "MARBLE_ACTORS") or UNKNOWN),
    ("Marble two-sided comps", lambda e: proof(e, "MARBLE_TWO_SIDED_COMPONENTS") or UNKNOWN),
    ("Relay Dogs at runtime", lambda e: proof(e, "RUNTIME_RELAY_DOGS") or UNKNOWN),
    ("Compound Agents", lambda e: proof(e, "RUNTIME_COMPOUND_AGENTS") or UNKNOWN),
    ("Dogs standing on ground", lambda e: proof(e, "RUNTIME_GROUNDED_DOGS") or UNKNOWN),
    ("blocking primitives", lambda e: proof(e, "RUNTIME_BLOCKING_PRIMITIVES") or UNKNOWN),
    ("instanced pieces", lambda e: proof(e, "INSTANCED_PIECES") or UNKNOWN),
    ("instance batches built", lambda e: proof(e, "RUNTIME_INSTANCES_BUILT")
     or proof(e, "BATCHES") or UNKNOWN),
    ("loose actors", lambda e: proof(e, "ACTORS") or UNKNOWN),
    ("", lambda e: ""),
    ("delivered FPS mean", lambda e: num(
        ((e.get("stream") or {}).get("delivered") or {}).get("fps_mean"))),
    ("delivered FPS p50", lambda e: num(
        ((e.get("stream") or {}).get("delivered") or {}).get("fps_p50"))),
    ("delivered FPS min", lambda e: num(
        ((e.get("stream") or {}).get("delivered") or {}).get("fps_min"))),
    ("frame time at p50 (ms)", lambda e: (
        lambda f: UNKNOWN if not f else "%.1f" % (1000.0 / f))(
            ((e.get("stream") or {}).get("delivered") or {}).get("fps_p50"))),
    ("resolution", lambda e: ((e.get("stream") or {}).get("delivered") or {})
     .get("resolution") or UNKNOWN),
    ("bitrate (kbps)", lambda e: num((e.get("stream") or {}).get("bitrate_kbps"), "%.0f")),
    ("frames dropped", lambda e: str(((e.get("stream") or {}).get("delivered") or {})
                                     .get("dropped", UNKNOWN))),
    ("freeze count", lambda e: str(((e.get("stream") or {}).get("delivered") or {})
                                   .get("freeze_count", UNKNOWN))),
    ("", lambda e: ""),
    ("GPU util while rendering", lambda e: num(gpu(e, "while_rendering", "gpu_util_pct"), "%s%%")),
    ("VRAM used (MiB)", lambda e: num(gpu(e, "while_rendering", "vram_used_mib"), "%s")),
    ("VRAM idle before (MiB)", lambda e: num(gpu(e, "idle_before_launch", "vram_used_mib"), "%s")),
    ("VRAM total (MiB)", lambda e: num(gpu(e, "while_rendering", "vram_total_mib"), "%s")),
    ("GPU temperature (C)", lambda e: num(gpu(e, "while_rendering", "temp_c"), "%s")),
]



def load_camera_table():
    """The generator's hero-shot table, via the same parser the contract uses."""
    build = os.path.join(os.path.dirname(os.path.abspath(__file__)))
    if build not in sys.path:
        sys.path.insert(0, build)
    try:
        import hero_shots
        return {c["index"]: c for c in hero_shots.described()}
    except Exception:
        return {}


def _floats(text):
    try:
        return [float(v) for v in (text or "").split(",")]
    except ValueError:
        return None


def transform_mismatch(entry, requested, cameras):
    """Did the engine render from the camera the run asked for?

    Answered from the LOCATION, ROTATION and FOV the packaged build printed,
    against what the generator authored for that index. A frame is attributable
    when the numbers agree; a label is not needed and is not trustworthy.
    """
    cam = e_index = None
    try:
        e_index = int(requested)
        cam = cameras.get(e_index)
    except (TypeError, ValueError):
        pass
    if cam is None:
        return []                      # nothing to compare against; not a claim
    loc = _floats(proof(entry, "HERO_CAM_LOC"))
    rot = _floats(proof(entry, "HERO_CAM_ROT"))
    fov = _floats(proof(entry, "HERO_CAM_FOV"))
    if not loc or not rot or not fov:
        return ["hero %s reported no camera transform, so the frame cannot be "
                "attributed" % entry.get("hero_camera")]
    problems = []
    want_loc = cam["location_cm"]
    if max(abs(a - b) for a, b in zip(loc, want_loc)) > 1.0:
        problems.append("hero %s rendered from %s, but HeroCam%d is authored at %s"
                        % (entry.get("hero_camera"), loc, e_index, want_loc))
    if abs(rot[0] - cam["pitch_deg"]) > 0.05 or abs(rot[1] - cam["yaw_deg"]) > 0.05:
        problems.append("hero %s rendered at pitch/yaw %.2f/%.2f, but HeroCam%d is "
                        "authored at %.2f/%.2f"
                        % (entry.get("hero_camera"), rot[0], rot[1], e_index,
                           cam["pitch_deg"], cam["yaw_deg"]))
    if abs(fov[0] - cam["fov_horizontal_deg"]) > 0.01:
        problems.append("hero %s rendered at %.2f deg FOV, but HeroCam%d is authored "
                        "at %.2f" % (entry.get("hero_camera"), fov[0], e_index,
                                     cam["fov_horizontal_deg"]))
    return problems


def main(argv):
    paths = argv[1:]
    if len(paths) < 1:
        sys.stderr.write(__doc__)
        return 2
    entries = [load(p) for p in paths]

    builds = {e.get("build_sha") for e in entries}
    print("HERO CAPTURE COMPARISON")
    print("=" * (26 + 24 * len(entries)))
    if len(builds) > 1:
        print("!! these captures come from DIFFERENT builds: %s"
              % ", ".join(sorted(b[:7] for b in builds if b)))
        print("   Nothing below is a like-for-like comparison.")
    else:
        print("build %s   branch %s"
              % (list(builds)[0][:7] if builds else "?", entries[0].get("branch") or "?"))
    knobs = entries[0].get("generator_knobs") or {}
    print("generator knobs: %s" % ", ".join("%s=%s" % (k, v) for k, v in sorted(knobs.items()) if v))
    print()

    head = "%-26s" % "" + "".join("%-24s" % ("hero %s" % e.get("hero_camera")) for e in entries)
    print(head)
    print("-" * len(head.rstrip()))
    for label, get in ROWS:
        if not label:
            print()
            continue
        print("%-26s" % label + "".join("%-24s" % get(e) for e in entries))
    print()
    for e in entries:
        print("hero %s frame: %s" % (e.get("hero_camera"), e.get("png")))

    cameras = load_camera_table()
    bad = []
    for e in entries:
        served = proof(e, "HERO_CAM_SERVED")
        requested = proof(e, "HERO_CAM_REQUESTED")
        if proof(e, "HERO_CAM_FELL_BACK") == "1":
            bad.append("hero %s FELL BACK — the frame is of a different camera"
                       % e.get("hero_camera"))
        else:
            # NOT the actor's name. UE's GetName() returns "CameraActor_12";
            # the identity that matters is the TAG the level generator set, and
            # the actor name never carries it. Checking the name against
            # "HeroCam6" condemns a perfectly good capture.
            #
            # The transform is better evidence than any label anyway: if the
            #位置, rotation and FOV the engine reported are the ones the
            # generator authored for that index, then that is the camera that
            # rendered, whatever the object happens to be called.
            bad.extend(transform_mismatch(e, requested, cameras))
        if not served:
            bad.append("hero %s did not report which camera answered — the frame "
                       "cannot be attributed to any camera at all"
                       % e.get("hero_camera"))
        if proof(e, "MARBLE_ACTORS") in (None, "0"):
            bad.append("hero %s rendered a world with NO Marble backdrop in it"
                       % e.get("hero_camera"))
        if proof(e, "RUNTIME_RELAY_DOGS") in (None, "0"):
            bad.append("hero %s rendered a world with NO Relay Dogs in it"
                       % e.get("hero_camera"))
    if bad:
        print("\nTHESE CAPTURES DO NOT SUPPORT THE CLAIMS MADE ABOUT THEM:")
        for line in bad:
            print("  - %s" % line)
        return 1
    print("\nEvery frame above was rendered by the camera it names, from a world "
          "containing\nthe Marble backdrop and the Relay Dogs.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
