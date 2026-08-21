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
import sys


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

    report.setdefault("runs", []).append({
        "camera": camera,
        "status": status,
        "stream": stream,
        "gpu": gpu_summary(gpu_csv),
        "screenshot": shot if os.path.exists(shot) else None,
        "screenshot_bytes": os.path.getsize(shot) if os.path.exists(shot) else 0,
        "stream_stats_file": stats_path,
        "gpu_csv": gpu_csv,
    })
    with io.open(report_path, "w", encoding="utf8") as handle:
        json.dump(report, handle, indent=2)
    print("  recorded HeroCam%s: %s" % (camera, status))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
