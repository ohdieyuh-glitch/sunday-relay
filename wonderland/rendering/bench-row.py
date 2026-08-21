#!/usr/bin/env python3
"""Fold one camera's measurements into the bench report, and print it.

Deliberately dumb. It records what the instruments said and marks a run FAILED
when an instrument failed, rather than filling the row with nulls that read
like zeros. A bench that quietly reports 0 FPS for a run that never streamed
is how a regression gets attributed to a rendering change.
"""
import csv
import io
import json
import os
import re
import sys

# WonderlandWorldProof prints these at Warning level so they survive the
# packaged log's Display filtering. Capturing them per bench run is what turns
# "the Relay Dogs are there" into a number attached to the same frame the FPS
# came from — the founder asked for RELAY_DOGS and COMPOUND_AGENTS proven at
# RUNTIME, and a count taken from a different run than the screenshot proves
# nothing about the screenshot.
PROOF_LINES = ("WORLD", "ACTORS", "RELAY_DOGS", "COMPOUND_AGENTS", "PROXY_ACTORS",
               "RELAY_DOGS_WITHOUT_A_BODY", "WORLD_OK")
PROOF_RE = re.compile(r"\b(%s)=(\S+)" % "|".join(PROOF_LINES))

# Texture streaming announces its own failure in words rather than in a CVar,
# which makes it the one part of the founder's streaming question that can be
# answered without knowing whether r.Streaming.PoolSize exists on this build.
# A frame that is soft because its mips never loaded looks exactly like a frame
# that is soft because of the encoder, and these lines tell them apart.
STREAMING_RE = re.compile(
    r"(texture streaming pool over budget[^\n]*"
    r"|Streaming pool[^\n]*over budget[^\n]*"
    r"|out of (?:video )?memory[^\n]*)", re.I)


def scan_app_log(path, limit=4000000):
    """Pull the world proof and any streaming complaints out of the app log."""
    if not path or not os.path.exists(path):
        return {"log": path, "found": False}
    size = os.path.getsize(path)
    with io.open(path, encoding="utf8", errors="replace") as handle:
        if size > limit:
            handle.seek(size - limit)
        text = handle.read()
    proof = {}
    for match in PROOF_RE.finditer(text):
        proof[match.group(1)] = match.group(2)
    warnings = []
    seen = set()
    for match in STREAMING_RE.finditer(text):
        line = match.group(1).strip()[:220]
        if line not in seen:
            seen.add(line)
            warnings.append(line)
    return {
        "log": path,
        "found": True,
        "world_proof": proof,
        "streaming_warnings": warnings[:8],
        "streaming_warning_count": len(seen),
    }


def load(path, default=None):
    try:
        with io.open(path, encoding="utf8") as handle:
            return json.load(handle)
    except Exception:
        return default


def gpu_summary(path):
    try:
        rows = list(csv.reader(io.open(path, encoding="utf8")))
    except Exception:
        return None
    if len(rows) < 2:
        return None
    util, mem, temp = [], [], []
    for row in rows[1:]:
        if len(row) < 5:
            continue
        def num(cell):
            digits = "".join(c for c in cell if c.isdigit() or c == ".")
            return float(digits) if digits else None
        u, m, t = num(row[1]), num(row[3]), num(row[4])
        if u is not None:
            util.append(u)
        if m is not None:
            mem.append(m)
        if t is not None:
            temp.append(t)
    if not util:
        return None
    return {
        "samples": len(util),
        "gpu_util_mean_pct": sum(util) / len(util),
        "gpu_util_max_pct": max(util),
        "vram_used_mean_mib": (sum(mem) / len(mem)) if mem else None,
        "vram_used_max_mib": max(mem) if mem else None,
        "temp_max_c": max(temp) if temp else None,
    }


def summarise(report):
    print("\n%-6s %-8s %-10s %-8s %-9s %-9s %-7s %s"
          % ("cam", "fps p50", "fps min", "kbps", "gpu %", "vram MiB", "freeze", "status"))
    for run in report.get("runs", []):
        stream = run.get("stream") or {}
        gpu = run.get("gpu") or {}
        def fmt(value, spec="%.1f"):
            return (spec % value) if isinstance(value, (int, float)) else "-"
        print("%-6s %-8s %-10s %-8s %-9s %-9s %-7s %s" % (
            run.get("camera"),
            fmt(stream.get("fps_p50")), fmt(stream.get("fps_min")),
            fmt(stream.get("bitrate_kbps"), "%.0f"),
            fmt(gpu.get("gpu_util_mean_pct"), "%.0f"),
            fmt(gpu.get("vram_used_max_mib"), "%.0f"),
            fmt(stream.get("freeze_count"), "%.0f"),
            run.get("status")))
        for note in run.get("notes") or []:
            print("%-6s %s" % ("", "! " + note))
    # The world proof, once — it is a property of the build, not of a camera.
    for run in report.get("runs", []):
        proof = ((run.get("runtime") or {}).get("world_proof")) or {}
        if proof:
            print("\nRUNTIME PROOF (HeroCam%s): %s"
                  % (run.get("camera"),
                     "  ".join("%s=%s" % (k, proof[k])
                               for k in PROOF_LINES if k in proof)))
            break
    else:
        if report.get("runs"):
            print("\nRUNTIME PROOF: none found in the app log. The build did not "
                  "print WORLD=/RELAY_DOGS=, so this bench cannot say what was in "
                  "the world it measured.")
    complaints = [w for run in report.get("runs", [])
                  for w in ((run.get("runtime") or {}).get("streaming_warnings") or [])]
    if complaints:
        print("\nTEXTURE STREAMING complained — a soft frame may be missing mips "
              "rather than over-compressed:")
        for line in complaints[:5]:
            print("  %s" % line)

    print("\nprofile %s   exec: %s" % (report.get("profile"), report.get("exec_cmds")))
    print("gpu: %s" % report.get("gpu"))
    failed = [r for r in report.get("runs", []) if r.get("status") != "ok"]
    if failed:
        print("\n%d run(s) did NOT produce a measurement. Those rows are not "
              "evidence of anything." % len(failed))


def main(argv):
    if argv[1:2] == ["--summary"]:
        report = load(argv[2])
        if not report:
            print("no report at %s" % argv[2])
            return 1
        summarise(report)
        return 0

    report_path, camera, stats_path, gpu_csv, shot, measure_rc, shot_rc = argv[1:8]
    report = load(report_path) or {"runs": []}
    stream = load(stats_path) or {}
    stream.pop("raw", None)          # the per-second samples stay in their own file
    status = "ok"
    if int(measure_rc) != 0 or stream.get("fps_p50") is None:
        status = "FAILED: the stream produced no measurable frames"
    elif int(shot_rc) != 0 or not os.path.exists(shot):
        status = "measured, but no frame was captured"

    app_log = os.environ.get("WL_LOG_FILE") or os.path.join(
        os.environ.get("WL_LOG", ""), "app.log")
    runtime = scan_app_log(app_log)
    proof = runtime.get("world_proof") or {}
    # NOTES ARE NOT STATUS. The first version appended these to `status`, and
    # the summary — which decides a run failed by testing `status != "ok"` —
    # promptly reported a perfectly good run as having produced no measurement.
    # A field that means "did this run work" must keep meaning exactly that.
    notes = []
    if runtime.get("found") and proof.get("RELAY_DOGS") == "0":
        # A bench row reporting 60 FPS on a world with no Relay Dogs in it has
        # measured the wrong thing well. It belongs next to the numbers, not in
        # a separate document nobody opens.
        notes.append("RELAY_DOGS=0 in this run")
    if runtime.get("streaming_warning_count"):
        notes.append("texture streaming complained %d time(s)"
                     % runtime["streaming_warning_count"])

    report.setdefault("runs", []).append({
        "camera": camera,
        "status": status,
        "notes": notes,
        "runtime": runtime,
        "stream": stream,
        "gpu": gpu_summary(gpu_csv),
        "screenshot": shot if os.path.exists(shot) else None,
        "screenshot_bytes": os.path.getsize(shot) if os.path.exists(shot) else 0,
        "stream_stats_file": stats_path,
        "gpu_csv": gpu_csv,
    })
    with io.open(report_path, "w", encoding="utf8") as handle:
        json.dump(report, handle, indent=2)
    print("  recorded HeroCam%s: %s%s"
          % (camera, status, ("  [" + "; ".join(notes) + "]") if notes else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
