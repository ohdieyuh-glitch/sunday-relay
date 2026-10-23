"""Remote jump/fall grounding analyser. Run: python -I motion_diag.py <viewer.log> <sender.log> [--shift-ms N]
Reads (UE log stamp prefix [YYYY.MM.DD-HH.MM.SS:mmm] required):
  sender : WLREMOTE send motion=M z=Z vz=V period=Pms
  viewer : WLREMOTE fig=ID ... delayMs=D ...      (per-figure line; gives the draw delay)
           WLREMOTE motion fig=ID motion=M z=Z    (drawn feet z + received motion)
Sender timeline = first stamp + cumulative period (NOT log stamps, per C7). Truth time of a drawn sample = viewer stamp - delay + shift.
Gap = drawn z - sender sole z (linear interpolation at truth time). Bars: air |gap| p95 <= 10 uu; within 0.5 s after landing p95 <= 2 uu.
Note: the viewer feet z carries the constant lowestUu sink (-0.29 uu in earlier runs); it is inside the 2 uu bar.
"""
import re, sys, datetime, bisect

AIR = ("JUMP", "FALL", "FLY")
STAMP = re.compile(r"^\[(\d{4})\.(\d\d)\.(\d\d)-(\d\d)\.(\d\d)\.(\d\d):(\d{3})\]")
SEND = re.compile(r"WLREMOTE send motion=(\w+) z=(-?[\d.]+) vz=(-?[\d.]+) period=(-?[\d.]+)ms")
FIG = re.compile(r"WLREMOTE fig=(\S+) .*?delayMs=(-?[\d.]+)")
MOT = re.compile(r"WLREMOTE motion fig=(\S+) motion=(\w+) z=(-?[\d.]+)")


def stamp(line):
    m = STAMP.match(line)
    if not m:
        return None
    y, mo, d, h, mi, s, ms = map(int, m.groups())
    return datetime.datetime(y, mo, d, h, mi, s, ms * 1000, tzinfo=datetime.timezone.utc).timestamp()


def parse_sender(lines, use_stamps=True):
    """use_stamps=True (default): each sender line is placed at its own log stamp (the cumulative-period timeline drifted by seconds over a 3 min real log:
    jump1 run, WDEV 10-19). use_stamps=False restores the period timeline (see C7: stamps can compress, so check both)."""
    out, t0, cum = [], None, 0.0
    for ln in lines:
        m = SEND.search(ln)
        if not m:
            continue
        ts = stamp(ln)
        if t0 is None:
            if ts is None:
                continue
            t0 = ts
        else:
            cum += float(m.group(4)) / 1000.0
        out.append(((ts if use_stamps and ts is not None else t0 + cum), m.group(1), float(m.group(2)), float(m.group(3))))
    return out


def parse_viewer(lines):
    delay, out = {}, []
    for ln in lines:
        f = FIG.search(ln)
        if f:
            delay[f.group(1)] = float(f.group(2)) / 1000.0
            continue
        m = MOT.search(ln)
        ts = stamp(ln)
        if m and ts is not None and m.group(1) in delay:
            out.append((ts, m.group(1), m.group(2), float(m.group(3)), delay[m.group(1)]))
    return out


def pct(v, p):
    if not v:
        return None
    v = sorted(v)
    return v[min(len(v) - 1, int(round(p * (len(v) - 1))))]


def analyse(sender, viewer, shift_s=0.0):
    ts = [s[0] for s in sender]
    land_after = [None] * len(sender)   # landing time for ground samples shortly after an air run
    last_land = None
    for i, s in enumerate(sender):
        if s[1] in AIR:
            last_land = None
        elif i > 0 and sender[i - 1][1] in AIR:
            last_land = s[0]
        land_after[i] = None if s[1] in AIR else last_land
    air_gaps, land_gaps, ground_gaps = [], [], []
    recv_air = 0
    for (t, fig, mot, z, d) in viewer:
        if mot in AIR:
            recv_air += 1
        tt = t - d + shift_s
        if tt < ts[0] or tt > ts[-1]:
            continue
        j = min(bisect.bisect_right(ts, tt) - 1, len(ts) - 2)
        a, b = sender[j], sender[j + 1]
        f = (tt - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 0.0
        gap = z - (a[2] + (b[2] - a[2]) * f)
        if a[1] in AIR or b[1] in AIR:
            air_gaps.append(abs(gap))
        elif land_after[j] is not None and tt - land_after[j] <= 0.5:
            land_gaps.append(gap)
        else:
            ground_gaps.append(gap)
    ep, run = 0, 0   # air episodes: >= 3 consecutive sender samples labelled JUMP/FALL/FLY
    for s in sender:
        run = run + 1 if s[1] in AIR else 0
        if run == 3:
            ep += 1
    r = {
        "sender_samples": len(sender), "viewer_samples": len(viewer), "viewer_recv_air_labels": recv_air,
        "air_episodes_x3": ep, "n_air": len(air_gaps), "n_land": len(land_gaps), "n_ground": len(ground_gaps),
        "air_p95_abs": pct(air_gaps, 0.95), "land_p95_abs": pct([abs(g) for g in land_gaps], 0.95),
        "land_min_gap": min(land_gaps) if land_gaps else None,
        "ground_p50": pct(ground_gaps, 0.5),
    }
    r["pass_air"] = r["air_p95_abs"] is not None and r["air_p95_abs"] <= 10.0
    r["pass_land"] = r["land_p95_abs"] is not None and r["land_p95_abs"] <= 2.0
    r["pass_viewer_reads_motion"] = recv_air > 0
    r["PASS"] = bool(r["pass_air"] and r["pass_land"] and r["pass_viewer_reads_motion"] and ep > 0)
    return r


def best_shift(sender, viewer):
    best = None
    for ms in range(-500, 501, 10):
        r = analyse(sender, viewer, ms / 1000.0)
        if r["air_p95_abs"] is not None and (best is None or r["air_p95_abs"] < best[1]):
            best = (ms, r["air_p95_abs"])
    return best


def main(argv):
    shift = 0.0
    if "--shift-ms" in argv:
        i = argv.index("--shift-ms")
        shift = float(argv[i + 1]) / 1000.0
        del argv[i:i + 2]
    vl = open(argv[0], encoding="utf-8", errors="replace").read().splitlines()
    sl = open(argv[1], encoding="utf-8", errors="replace").read().splitlines()
    sender, viewer = parse_sender(sl), parse_viewer(vl)
    if len(sender) < 2:
        print("no sender 'WLREMOTE send motion=' lines")
        return 2
    r = analyse(sender, viewer, shift)
    for k, v in r.items():
        print(f"{k}: {v}")
    print("best_shift_ms,air_p95:", best_shift(sender, viewer))
    return 0 if r["PASS"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
