"""b33_slicer.py -- W2DEV's own B33 scenario slicer (written new; no code from the recused slice_phases.py). DIAGNOSTIC tool, W2DEV, not evidence by itself.
What it does: reads ONE sender log and splits the run into STANDING / WALKING / RUNNING jump scenarios by the SENDER'S OWN motion labels and
horizontal speeds, lists every walk-off fall (M4) and every teleport-like position jump. It never reads the drive timeline or the viewer log
to decide a class.
Run:  python -I b33_slicer.py <sender Wonderland.log> [--json OUT.json] [--write-slices DIR --viewer <viewer Wonderland.log>]
Inputs : the sender's "WLREMOTE send motion=M z=Z vz=V period=Pms" lines and the "WLREMOTE send soles=(x,y,z) rtt=.. period=.. status=.. yaw=.."
         line that answers each of them (positions). Times are the sender's own game clock (motion_diag_w2 W2 D1).
Outputs: a printed table + JSON {jumps, falls, teleports, spans}; with --write-slices, per-span raw slices of both logs for the registered
         analyser's CLI (python -I b33_analyser/motion_diag.py <viewer slice> <sender slice>).

RULES (fixed before data; constants below):
 Air run   = maximal run of consecutive samples labelled JUMP/FALL/FLY (the analyser's AIR set). Takeoff = its first sample's time; touchdown =
             the first non-AIR sample after it (the analyser's landing time).
 A JUMP    = an air run containing a JUMP label (vz > 0 at a sample). A WALK-OFF FALL = an air run with no JUMP label (M4).
 Counted jump: rise (max z in the run - pre-takeoff ground z) >= MIN_RISE_UU, and a class:
   STANDING: last ground label before takeoff == IDLE and median air horizontal speed < STAND_MAX_UUS
   WALKING : last ground label == WALK and WALK_MIN_UUS <= median air horizontal speed < RUN_MIN_UUS
   RUNNING : last ground label == RUN and median air horizontal speed >= RUN_MIN_UUS
   (labels as the client sets them, WonderlandSocialSubsystem.cpp:400-401: IDLE < 10, WALK < 400, RUN >= 400 uu/s; jog 230, run 520)
   The last ground sample must lie within PRE_GROUND_MAX_S before takeoff. Anything else is UNCLASSIFIED with the reason; it is listed and
   counts for no scenario. Horizontal speed of a sample = |xy - previous xy| / game-time step (both from the sender log).
 Spans     = for each class, consecutive jumps of that class with no other air run between them form a block; a block's span runs from
             PRE_S before its first takeoff to POST_S after its last touchdown, clipped so that it never reaches into another air run.
 M4 fall   = a WALK-OFF FALL. start z (median) = median z of the contiguous non-AIR samples just before the first FALL sample, walking back
             while a sample is within START_WINDOW_S of the fall and within START_BAND_UU of the last one, at most START_MAX_N samples; start z
             (last) = the last ground sample before the fall. QUALIFYING start z = min(median, last) (M2 review R4-11: the median can sit ~3 uu
             above the lip sample). landing z = z of the first non-AIR sample after the run. drop = min(median, last) - landing z; qualifies
             only if drop >= 100.0 (M2 B5); both drops (median - landing, last - landing) are printed; every fall is listed.
 Teleport  = consecutive positions more than TP_MIN_UU apart at more than TP_MIN_UUS, OR (R4-12, speed bound) more than TP2_MIN_UU apart at
             more than TP2_MIN_UUS (run 520 uu/s with a fall's ~500 uu/s vertical stays under ~720 uu/s; no walk, run or fall reaches 1200).
"""
import json, os, sys, statistics

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "b33_analyser"))
import motion_diag_w2 as W  # noqa: E402  (W2 D1 clock + line formats)

AIR = W.AIR
MIN_RISE_UU = 30.0
STAND_MAX_UUS = 50.0
WALK_MIN_UUS = 100.0
RUN_MIN_UUS = 400.0
PRE_GROUND_MAX_S = 0.5
PRE_S = 1.0
POST_S = 1.6
START_WINDOW_S = 2.0
START_BAND_UU = 3.0
START_MAX_N = 5
DROP_MIN_UU = 100.0
TP_MIN_UU = 150.0
TP_MIN_UUS = 2000.0
TP2_MIN_UU = 60.0
TP2_MIN_UUS = 1200.0
CLASSES = ("STANDING", "WALKING", "RUNNING")


def load_sender(lines):
    """the sender's world reports in file order with the D1 time and the horizontal speed into each sample"""
    _, sends = W.world_anchors(lines)
    prev = None
    for s in sends:
        s["hspeed"] = None
        if prev is not None and s["x"] is not None and prev["x"] is not None:
            dt = s["t"] - prev["t"]
            if dt > 0.02:
                s["hspeed"] = ((s["x"] - prev["x"]) ** 2 + (s["y"] - prev["y"]) ** 2) ** 0.5 / dt
        prev = s
    return sends


def air_runs(sends):
    runs, k = [], 0
    while k < len(sends):
        if sends[k]["motion"] in AIR:
            a = k
            while k + 1 < len(sends) and sends[k + 1]["motion"] in AIR:
                k += 1
            runs.append((a, k))
        k += 1
    return runs


def _median(v):
    return statistics.median(v) if v else None


def classify_run(sends, a, b):
    """one air run [a, b] -> dict with kind JUMP|FALL, class, reason and the numbers used"""
    labels = [sends[k]["motion"] for k in range(a, b + 1)]
    td = b + 1 if b + 1 < len(sends) else None
    pre = a - 1 if a > 0 else None
    d = {"k0": a, "k1": b, "n_air": b - a + 1, "labels": "".join(l[0] for l in labels),
         "t_takeoff": sends[a]["t"], "t_touchdown": sends[td]["t"] if td is not None else None,
         "stamp_takeoff": sends[a]["stamp"], "line_takeoff": sends[a]["i"],
         "kind": "JUMP" if "JUMP" in labels else "FALL",
         "pre_label": sends[pre]["motion"] if pre is not None else None,
         "pre_dt": (sends[a]["t"] - sends[pre]["t"]) if pre is not None else None,
         "z_pre": sends[pre]["z"] if pre is not None else None,
         "z_max": max(sends[k]["z"] for k in range(a, b + 1)),
         "z_land": sends[td]["z"] if td is not None else None,
         "xy_takeoff": (sends[a]["x"], sends[a]["y"])}
    sp = [sends[k]["hspeed"] for k in range(a, (td if td is not None else b) + 1) if sends[k]["hspeed"] is not None]
    d["air_hspeed_med"] = _median(sp)
    d["rise"] = (d["z_max"] - d["z_pre"]) if d["z_pre"] is not None else None
    cls, why = "UNCLASSIFIED", ""
    if d["kind"] != "JUMP":
        cls, why = "FALL", "no JUMP label (a walk-off fall, M4 rules)"
    elif td is None:
        why = "no touchdown sample (the log ends in the air)"
    elif pre is None or d["pre_dt"] > PRE_GROUND_MAX_S:
        why = "no ground sample within %.1f s before takeoff" % PRE_GROUND_MAX_S
    elif d["rise"] is None or d["rise"] < MIN_RISE_UU:
        why = "rise %.1f uu < %.0f (a blocked hop, not a jump)" % (d["rise"] if d["rise"] is not None else float("nan"), MIN_RISE_UU)
    elif d["air_hspeed_med"] is None:
        why = "no positions in the air"
    else:
        v, p = d["air_hspeed_med"], d["pre_label"]
        if p == "IDLE" and v < STAND_MAX_UUS:
            cls = "STANDING"
        elif p == "WALK" and WALK_MIN_UUS <= v < RUN_MIN_UUS:
            cls = "WALKING"
        elif p == "RUN" and v >= RUN_MIN_UUS:
            cls = "RUNNING"
        else:
            why = "label %s with air speed %.0f uu/s fits no class" % (p, v)
    d["class"], d["reason"] = cls, why
    return d


def m4_fall(sends, d):
    """M4 start/landing/drop for a walk-off fall (see RULES)"""
    a, b = d["k0"], d["k1"]
    out = {"start_z": None, "start_z_median": None, "start_z_last": None, "start_n": 0, "landing_z": d["z_land"], "drop": None, "drop_median": None,
           "drop_last": None, "qualifies": False, "note": ""}
    if a == 0 or sends[a - 1]["motion"] in AIR:
        out["note"] = "no ground sample before the fall"
        return out
    last = sends[a - 1]
    if sends[a]["t"] - last["t"] > START_WINDOW_S:
        out["note"] = "last ground sample %.2f s before the fall" % (sends[a]["t"] - last["t"])
        return out
    zs, k = [], a - 1
    while k >= 0 and len(zs) < START_MAX_N:
        s = sends[k]
        if s["motion"] in AIR or sends[a]["t"] - s["t"] > START_WINDOW_S or abs(s["z"] - last["z"]) > START_BAND_UU:
            break
        zs.append(s["z"])
        k -= 1
    out["start_z_median"], out["start_n"] = _median(zs), len(zs)
    out["start_z_last"] = last["z"]
    out["start_z"] = min(out["start_z_median"], out["start_z_last"])   # R4-11: the qualifying start z
    out["lip_xy"] = (last["x"], last["y"])
    if d["z_land"] is None:
        out["note"] = "no landing sample (the log ends in the air)"
        return out
    out["drop_median"] = out["start_z_median"] - d["z_land"]
    out["drop_last"] = out["start_z_last"] - d["z_land"]
    out["drop"] = out["start_z"] - d["z_land"]
    out["qualifies"] = out["drop"] >= DROP_MIN_UU
    td = b + 1
    out["land_xy"] = (sends[td]["x"], sends[td]["y"])
    settle = [s["z"] for s in sends[td:] if s["t"] - sends[td]["t"] <= 0.5 and s["motion"] not in AIR]
    out["settle_range_uu"] = (max(settle) - min(settle)) if settle else None
    out["fall_s"] = sends[td]["t"] - sends[a]["t"]
    if not out["qualifies"]:
        out["note"] = "drop %.1f < %.1f uu: listed, excluded by the 100.0 rule only" % (out["drop"], DROP_MIN_UU)
    return out


def teleports(sends):
    out = []
    for p, s in zip(sends, sends[1:]):
        if p["x"] is None or s["x"] is None:
            continue
        d3 = ((s["x"] - p["x"]) ** 2 + (s["y"] - p["y"]) ** 2 + (s["sz"] - p["sz"]) ** 2) ** 0.5
        dt = max(s["t"] - p["t"], 1e-3)
        rule = "dist" if (d3 > TP_MIN_UU and d3 / dt > TP_MIN_UUS) else ("speed" if (d3 > TP2_MIN_UU and d3 / dt > TP2_MIN_UUS) else None)
        if rule:
            out.append({"k": s["k"], "line": s["i"], "t": s["t"], "from": (p["x"], p["y"], p["sz"]), "to": (s["x"], s["y"], s["sz"]),
                        "dist_uu": d3, "uu_per_s": d3 / dt, "rule": rule})
    return out


def spans(sends, runs, info):
    """per class: blocks of consecutive same-class jumps -> sample index ranges (clipped away from every other air run)"""
    out = {c: [] for c in CLASSES}
    for c in CLASSES:
        block = []
        for r, d in zip(runs, info):
            if d["class"] == c:
                block.append((r, d))
                continue
            if block:
                out[c].append(block)
                block = []
        if block:
            out[c].append(block)
    res = {c: [] for c in CLASSES}
    for c in CLASSES:
        for block in out[c]:
            (a0, _), d0 = block[0]
            (_, b1), d1 = block[-1]
            t_start = d0["t_takeoff"] - PRE_S
            t_end = (d1["t_touchdown"] if d1["t_touchdown"] is not None else sends[b1]["t"]) + POST_S
            # clip: never into another air run
            prev_air_end = max([r[1] for r in runs if r[1] < a0], default=None)
            next_air_start = min([r[0] for r in runs if r[0] > b1], default=None)
            k0 = a0
            while k0 - 1 >= 0 and sends[k0 - 1]["t"] >= t_start and (prev_air_end is None or k0 - 1 > prev_air_end):
                k0 -= 1
            k1 = b1
            while k1 + 1 < len(sends) and sends[k1 + 1]["t"] <= t_end and (next_air_start is None or k1 + 1 < next_air_start):
                k1 += 1
            res[c].append({"k0": k0, "k1": k1, "t0": sends[k0]["t"], "t1": sends[k1]["t"], "stamp0": sends[k0]["stamp"], "stamp1": sends[k1]["stamp"],
                           "line0": sends[k0]["i"], "line1": sends[k1]["i"], "jumps": len(block)})
    return res


def slice_run(lines):
    sends = load_sender(lines)
    runs = air_runs(sends)
    info = [classify_run(sends, a, b) for (a, b) in runs]
    falls = []
    for d in info:
        if d["kind"] == "FALL":
            f = dict(d)
            f.update(m4_fall(sends, d))
            falls.append(f)
    return {"n_sends": len(sends), "jumps": [d for d in info if d["kind"] == "JUMP"], "falls": falls, "teleports": teleports(sends),
            "spans": spans(sends, runs, info), "counts": {c: sum(1 for d in info if d["class"] == c) for c in CLASSES},
            "unclassified": sum(1 for d in info if d["class"] == "UNCLASSIFIED")}, sends


def write_slices(res, sender_lines, viewer_lines, out_dir, viewer_pad_s=1.0):
    """raw line slices per span for the registered analyser's CLI: sender lines line0..line1; viewer lines stamped in [stamp0, stamp1 + pad]"""
    os.makedirs(out_dir, exist_ok=True)
    written = []
    vst = [W.stamp(l) for l in viewer_lines]
    for c in CLASSES:
        for n, sp in enumerate(res["spans"][c], 1):
            base = os.path.join(out_dir, "%s_span%d" % (c, n))
            with open(base + "_sender.log", "w", encoding="utf-8", newline="\n") as f:
                f.write("\n".join(sender_lines[sp["line0"]:sp["line1"] + 1]) + "\n")
            last = None
            keep = []
            for l, t in zip(viewer_lines, vst):
                if t is not None:
                    last = t
                if last is not None and sp["stamp0"] <= last <= sp["stamp1"] + viewer_pad_s:
                    keep.append(l)
            with open(base + "_viewer.log", "w", encoding="utf-8", newline="\n") as f:
                f.write("\n".join(keep) + "\n")
            written.append((c, n, base))
    return written


def fmt_table(res):
    out = ["B33 SLICER (W2DEV b33_slicer.py) sender samples %d; counted jumps STANDING %d WALKING %d RUNNING %d; unclassified %d; walk-off falls %d; teleports %d"
           % (res["n_sends"], res["counts"]["STANDING"], res["counts"]["WALKING"], res["counts"]["RUNNING"], res["unclassified"], len(res["falls"]), len(res["teleports"]))]
    out.append("JUMPS: n | class | stamp at takeoff (UTC) | labels | pre | air speed | rise | reason")
    for n, d in enumerate(res["jumps"], 1):
        import datetime
        st = datetime.datetime.fromtimestamp(d["stamp_takeoff"], datetime.timezone.utc).strftime("%H:%M:%S.%f")[:-3]
        out.append("  %2d | %-12s | %s | %-8s | %-4s | %s | %s | %s" % (n, d["class"], st, d["labels"], d["pre_label"],
                   "%.0f" % d["air_hspeed_med"] if d["air_hspeed_med"] is not None else "-", "%.1f" % d["rise"] if d["rise"] is not None else "-", d["reason"]))
    out.append("SPANS: class | k0..k1 | game-time length | jumps")
    for c in CLASSES:
        for sp in res["spans"][c]:
            out.append("  %-8s | %d..%d | %.2f s | %d" % (c, sp["k0"], sp["k1"], sp["t1"] - sp["t0"], sp["jumps"]))
    out.append("WALK-OFF FALLS (M4): n | start z median (n) / last | landing z | drop median / last | QUALIFYING drop = min(...) - landing | qualifies (>= 100.0) | note")
    for n, f in enumerate(res["falls"], 1):
        g = lambda k: ("%.1f" % f[k]) if f.get(k) is not None else "-"
        out.append("  %2d | %s (%d) / %s | %s | %s / %s | %s | %s | %s" % (n, g("start_z_median"), f["start_n"], g("start_z_last"), g("landing_z"),
                   g("drop_median"), g("drop_last"), g("drop"), "YES" if f["qualifies"] else "no", f["note"]))
    for tp in res["teleports"]:
        out.append("TELEPORT (%s rule) at sample %d (line %d): %s -> %s, %.0f uu at %.0f uu/s" % (tp["rule"], tp["k"], tp["line"], tp["from"], tp["to"], tp["dist_uu"], tp["uu_per_s"]))
    return "\n".join(out)


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    with open(argv[0], encoding="utf-8", errors="replace") as f:
        lines = f.read().splitlines()
    res, _ = slice_run(lines)
    print(fmt_table(res))
    if "--json" in argv:
        with open(argv[argv.index("--json") + 1], "w", encoding="utf-8") as f:
            json.dump(res, f, indent=1, default=str)
    if "--write-slices" in argv:
        with open(argv[argv.index("--viewer") + 1], encoding="utf-8", errors="replace") as f:
            vl = f.read().splitlines()
        for c, n, base in write_slices(res, lines, vl, argv[argv.index("--write-slices") + 1]):
            print("slice %s span %d -> %s_{sender,viewer}.log" % (c, n, base))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
