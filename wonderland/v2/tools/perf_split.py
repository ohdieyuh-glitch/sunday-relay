#!/usr/bin/env python3
"""Split a profiled run into the places the frames were spent.

    python3 wonderland/v2/tools/perf_split.py frames.csv [--route=explore]

`profile_movement.sh` gives one CSV row per frame: FrameTime, GameThreadTime,
RenderThreadTime, GPUTime, in milliseconds. Averaged over a whole run that
answers almost nothing -- a world is not uniformly expensive, and "the world
runs at N fps" hides the one region that does not.

THE ROUTE IS THE CLOCK. The Dog drives itself along a known route with known
speeds, so the elapsed time at any frame says WHERE it was: the plaza, the
castle approach, the garden quarter, the mushroom wood, the outer road, the
clock quarter, the hamlet. The windows below come from summing the route's own
legs, so a frame is attributed to a place rather than to a stopwatch.

Separately: THE STREAM IS NOT THE ENGINE. Frame time here is what Unreal spent
on a frame. What a viewer sees over Pixel Streaming through a Cloudflare tunnel
is that plus encode plus network, and the two must never be reported as one
number -- a 60 fps engine on a 12 fps tunnel is a network finding, not a
rendering one.
"""
import csv, os, sys

#: (label, start_s, end_s) -- from the exploration route's own leg timings.
EXPLORE = [
    ("idle at spawn",        0,   9),
    ("arrival gate",         9,  28),
    ("plaza crossing",      28,  50),
    ("fountain court",      50,  64),
    ("castle approach",     64,  88),
    ("garden quarter",      88, 161),
    ("mushroom wood",      161, 210),
    ("clock quarter",      210, 305),
    ("hamlet",             305, 403),
]
GAIT = [("idle", 0, 8), ("walk", 8, 20), ("jog", 20, 32),
        ("run", 32, 48), ("stop + turns", 48, 62), ("stairs", 62, 75)]

COLS = {"frame": ("FrameTime", "frametime"),
        "game": ("GameThreadTime", "gamethreadtime"),
        "render": ("RenderThreadTime", "renderthreadtime"),
        "gpu": ("GPUTime", "gputime")}


def pick(header, names):
    low = [h.strip().lower() for h in header]
    for n in names:
        if n.lower() in low:
            return low.index(n.lower())
    return None


def stats(v):
    if not v:
        return None
    v = sorted(v)
    q = lambda f: v[min(len(v) - 1, int(len(v) * f))]
    return {"n": len(v), "median": q(0.5), "p95": q(0.95), "p99": q(0.99),
            "max": v[-1], "mean": sum(v) / len(v)}


def main():
    path = sys.argv[1]
    route = next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--route=")), "explore")
    budget = float(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--budget=")), 33.3))
    windows = EXPLORE if route == "explore" else GAIT
    with open(path, newline="") as fh:
        rows = list(csv.reader(fh))
    header = rows[0]
    idx = {k: pick(header, v) for k, v in COLS.items()}
    if idx["frame"] is None:
        print("no FrameTime column in %s; columns are: %s" % (path, ", ".join(header[:12])))
        return 1
    data = []
    for r in rows[1:]:
        try:
            data.append({k: (float(r[i]) if i is not None and i < len(r) and r[i] else None)
                         for k, i in idx.items()})
        except ValueError:
            continue
    # elapsed time per frame, accumulated from FrameTime itself
    t, series = 0.0, []
    for d in data:
        series.append((t, d))
        t += (d["frame"] or 0.0) / 1000.0
    total = t
    print("PERFORMANCE SPLIT -- %s route, %d frames, %.0f s of engine time" % (route, len(data), total))
    print("all figures are MILLISECONDS PER FRAME as measured inside Unreal;")
    print("the stream's encoder and the tunnel are NOT in these numbers.\n")
    print("%-18s %6s %7s %7s %7s %7s   %s" %
          ("where", "frames", "median", "p95", "p99", "max", "over %.0f ms" % budget))
    print("-" * 84)
    for (label, a, b) in windows:
        v = [d["frame"] for (tt, d) in series if a <= tt < b and d["frame"]]
        s = stats(v)
        if not s:
            print("%-18s %6s   (no frames in this window)" % (label, 0))
            continue
        over = sum(1 for x in v if x > budget)
        print("%-18s %6d %7.2f %7.2f %7.2f %7.2f   %d (%.1f%%)"
              % (label, s["n"], s["median"], s["p95"], s["p99"], s["max"], over, 100.0 * over / s["n"]))
    print()
    print("%-18s %6s %7s %7s %7s %7s" % ("thread", "frames", "median", "p95", "p99", "max"))
    print("-" * 60)
    for key, name in (("frame", "FRAME"), ("game", "game thread"),
                      ("render", "render thread"), ("gpu", "GPU")):
        v = [d[key] for (_, d) in series if d[key]]
        s = stats(v)
        if not s:
            print("%-18s   (not in this CSV)" % name)
            continue
        print("%-18s %6d %7.2f %7.2f %7.2f %7.2f" % (name, s["n"], s["median"], s["p95"], s["p99"], s["max"]))
    # WHICH THREAD IS THE WALL. A frame costs the MAX of its threads, not their
    # sum; naming the bottleneck is the difference between a fix and a guess.
    med = {k: (stats([d[k] for (_, d) in series if d[k]]) or {}).get("median") for k in COLS}
    named = [(v, k) for k, v in med.items() if k != "frame" and v]
    if named:
        worst = max(named)
        print("\nbottleneck: %s at %.2f ms median, against a frame of %.2f ms"
              % (worst[1], worst[0], med["frame"] or 0.0))
    allv = [d["frame"] for (_, d) in series if d["frame"]]
    s = stats(allv)
    if s:
        print("whole run: %.1f fps median, %.1f fps at p95, %d of %d frames over %.0f ms (%.1f%%)"
              % (1000.0 / s["median"], 1000.0 / s["p95"],
                 sum(1 for x in allv if x > budget), len(allv), budget,
                 100.0 * sum(1 for x in allv if x > budget) / len(allv)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
