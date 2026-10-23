"""b33_survey_record.py -- W2DEV: the declared B33 route survey (M2 ruling a185b283 B-9) -> a fixed SURVEY_RECORD + a bounded route check.
DIAGNOSTIC tool, W2DEV, not evidence by itself.
Run: python -I -B b33_survey_record.py <survey run folder> [--route-new <proposed route json>] [--out <record .md>]
Inputs : the run folder of `b33_drive.ps1 -Mode survey [-SurveyReturn]` (RUN.json, drive_survey_*\\timeline.csv + route.json, the sender log).
Outputs: <run>\\SURVEY_RECORD.md (or --out), and stdout; exit 0 = ROUTE OK (and, with --route-new, the proposed route stays inside the bounds),
         1 = ROUTE NOT OK or the proposed route changes a forbidden field, 2 = usage/input error.
What it records, from the run's own files only:
  - the route file the drive used (its copy in the drive folder) and its sha256; the run's exe sha256;
  - every CAL / ARRIVED / ON_KERB / SURVEY_RUNWAY_OK / ABORT / NOTE row of the drive timeline;
  - the SURVEY_RUNWAY block (completed or not); the mount(s); the SURVEY_WALKOFF fall(s) from the sender's own log (b33_slicer M4 rule:
    start z median and last, landing z, drop) -- PRINTED AND NEVER COUNTED (B-9);
  - ROUTE OK = a completed SURVEY_RUNWAY block, an ON_KERB row, no ABORT; with a SURVEY_WALKOFF block also a second ON_KERB after it (the
    return route verified).
v3.1 (M2b review R7-09): the bounds baseline is the PINNED route v1 (routes/b33_route_v1.json, sha256 788f2015..., checked; a different
  file refuses with exit 2), never the route the survey happened to drive. A survey that drove another route (-Route) is recorded as a survey
  of a PROPOSED route: that route itself must stay inside the v1 bounds or the record says ROUTE NOT OK. Field names match exactly or as
  "<prefix>." (a key such as "whatever" no longer passes as "what").
--route-new: the proposed route may differ from the PINNED v1 ONLY in waypoints, arrive points, taps and calibration (B-9): jumps.approach,
  jumps.runway, jumps.arrive_uu, m4.approach, m4.arrive_uu, m4.return, m4.rejoin_index, m4.mount.to (inside the kerb box and y 4450..4505),
  m4.mount.max_taps, m4.mount.tap_ms, calibration.*, counts_per_deg_prior*, and the text fields name/what/verified/provenance/runway_note,
  dry_run_terrain.* (the offline model). NEVER: m4.mount.kerb_z, m4.mount.box_x, m4.mount.box_y, m4.walk_off.* (the location x=+163,
  y 4450..4505, the kerb box, kerb_z, the walk-off yaw/hold); the reader, the bars and the analysers are not in the route file at all.
"""
import csv, glob, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "b33_analyser"))
sys.path.insert(0, HERE)
import b33_slicer as SL   # noqa: E402

ALLOWED_PREFIXES = ("jumps.approach", "jumps.runway", "jumps.arrive_uu", "jumps.runway_note", "m4.approach", "m4.arrive_uu", "m4.return",
                    "m4.rejoin_index", "m4.mount.to", "m4.mount.max_taps", "m4.mount.tap_ms", "calibration", "counts_per_deg_prior",
                    "counts_per_deg_prior_source", "name", "what", "verified", "provenance", "dry_run_terrain")
BASELINE_ROUTE = os.path.join(HERE, "routes", "b33_route_v1.json")      # R7-09: THE bounds baseline (pinned)
BASELINE_SHA256 = "788f201566c34d6e96eb74d8d9e7a1243fa24cdf6f3ce66d51b0e615be3672bf"
FORBIDDEN_PREFIXES = ("m4.mount.kerb_z", "m4.mount.box_x", "m4.mount.box_y", "m4.walk_off")
KERB_Y = (4450.0, 4505.0)


def sha256(p):
    with open(p, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def flatten(o, pre=""):
    out = {}
    if isinstance(o, dict):
        for k, v in o.items():
            out.update(flatten(v, pre + "." + k if pre else k))
    else:
        out[pre] = json.dumps(o, sort_keys=True)
    return out


def match(k, p):
    """R7-09: a field name matches a prefix exactly or as '<prefix>.' (never a bare startswith)"""
    return k == p or k.startswith(p + ".")


def load_baseline():
    """the pinned route v1 (R7-09); a different file is refused"""
    if not os.path.exists(BASELINE_ROUTE) or sha256(BASELINE_ROUTE) != BASELINE_SHA256:
        raise SystemExit("the bounds baseline %s is missing or is not the pinned route v1 (sha256 %s)" % (BASELINE_ROUTE, BASELINE_SHA256))
    with open(BASELINE_ROUTE, encoding="utf-8-sig") as f:
        return json.load(f)


def route_diff(old, new):
    """-> (changed keys, refusals); old = the pinned v1 (R7-09)"""
    a, b = flatten(old), flatten(new)
    changed = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
    bad = []
    for k in changed:
        if any(match(k, p) for p in FORBIDDEN_PREFIXES):
            bad.append("%s is a fixed field (location, kerb box, kerb_z, walk-off): may not change" % k)
        elif not any(match(k, p) for p in ALLOWED_PREFIXES):
            bad.append("%s is not a waypoint, arrive point, tap or calibration field" % k)
    to = ((new.get("m4") or {}).get("mount") or {}).get("to")
    box = ((new.get("m4") or {}).get("mount") or {}).get("box_x") or [140.0, 186.0]
    if to is not None and not (float(box[0]) <= float(to[0]) <= float(box[1]) and KERB_Y[0] <= float(to[1]) <= KERB_Y[1]):
        bad.append("m4.mount.to %s is outside the kerb location (x in the kerb box %s, y %s..%s)" % (to, box, KERB_Y[0], KERB_Y[1]))
    return changed, bad


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    run = argv[0]
    args = {argv[i]: argv[i + 1] for i in range(1, len(argv) - 1, 2)}
    drives = sorted(d for d in glob.glob(os.path.join(run, "drive_survey_*")) if "_DRYRUN_" not in d)
    if not drives:
        print("no drive_survey_* folder in %s" % run)
        return 2
    rows = []
    for d in drives:
        with open(os.path.join(d, "timeline.csv"), encoding="utf-8-sig", newline="") as f:
            rows += [dict(r, _drive=os.path.basename(d)) for r in csv.DictReader(f)]
    route_used = os.path.join(drives[-1], "route.json")
    with open(route_used, encoding="utf-8-sig") as f:
        route = json.load(f)
    base = load_baseline()
    used_sha = sha256(route_used)
    used_is_v1 = used_sha == BASELINE_SHA256
    used_changed, used_bad = ([], []) if used_is_v1 else route_diff(base, route)
    meta = {}
    if os.path.exists(os.path.join(run, "RUN.json")):
        with open(os.path.join(run, "RUN.json"), encoding="utf-8-sig") as f:
            meta = json.load(f)
    o = ["# B33 ROUTE SURVEY RECORD (declared DIAGNOSTIC addendum, M2 ruling a185b283 B-9) -- W2DEV b33_survey_record.py; not evidence",
         "", "- run: `%s`" % run, "- exe sha256: `%s`" % meta.get("exe_sha256"),
         "- route used: `%s` sha256 `%s` (the drive's copy) -- %s" % (route_used, used_sha, "the PINNED route v1" if used_is_v1 else
             "NOT the pinned v1 (788f2015...): a survey of a PROPOSED route, bounded against v1 (R7-09)"),
         "- bounds baseline: `%s` sha256 `%s` (pinned)" % (BASELINE_ROUTE, BASELINE_SHA256),
         "- drive folders: %s" % ", ".join(os.path.basename(d) for d in drives), "", "## Drive rows (CAL, ARRIVED, ON_KERB, SURVEY_*, NOTE, ABORT)", ""]
    keep = ("CAL", "ARRIVED", "ON_KERB", "SURVEY_RUNWAY_OK", "NOTE", "ABORT", "BLOCK_BEGIN", "BLOCK_END", "END")
    for r in rows:
        if r.get("event") in keep:
            o.append("- %s %s `%s` at (%s, %s, z %s) %s" % (r.get("utc_iso"), r.get("event"), r.get("detail"), r.get("x"), r.get("y"), r.get("z"), r.get("motion")))
    ev = [r.get("event") for r in rows]
    blocks = {}
    for r in rows:
        if r.get("event") in ("BLOCK_BEGIN", "BLOCK_END"):
            blocks.setdefault(r["detail"], []).append((r["event"], int(r["utc_ms"]) / 1000.0))
    runway_done = any(e == "BLOCK_END" for e, _ in blocks.get("SURVEY_RUNWAY", []))
    on_kerb = [int(r["utc_ms"]) / 1000.0 for r in rows if r.get("event") == "ON_KERB"]
    walkoff = blocks.get("SURVEY_WALKOFF", [])
    aborts = [r for r in rows if r.get("event") == "ABORT"]
    why = []
    if not runway_done:
        why.append("the SURVEY_RUNWAY block did not complete (runway not verified)")
    if not on_kerb:
        why.append("no ON_KERB row (the approach + mount did not reach the kerb)")
    if aborts:
        why.append("the drive aborted: %s" % aborts[-1].get("detail"))
    if used_bad:
        why.append("the route driven leaves the B-9 bounds of the pinned v1: %s" % "; ".join(used_bad))
    falls_txt = []
    if walkoff:
        t_w0 = min(t for e, t in walkoff if e == "BLOCK_BEGIN")
        t_w1 = max((t for e, t in walkoff if e == "BLOCK_END"), default=float("inf"))
        if not any(t > t_w1 for t in on_kerb):
            why.append("no ON_KERB after the SURVEY_WALKOFF (the return route not verified)")
        slog = (meta.get("sender") or {}).get("log")
        if slog and os.path.exists(slog):
            with open(slog, encoding="utf-8", errors="replace") as f:
                res, _ = SL.slice_run(f.read().splitlines())
            for fl in res["falls"]:
                if t_w0 <= fl["t_takeoff"] <= t_w1 + SL.POST_S:
                    g = lambda k: ("%.1f" % fl[k]) if fl.get(k) is not None else "-"
                    falls_txt.append("- SURVEY_WALKOFF fall: start z median %s / last %s, landing z %s, drop median %s / last %s, min-rule drop %s -- PRINTED, NEVER COUNTED (B-9)" % (
                        g("start_z_median"), g("start_z_last"), g("landing_z"), g("drop_median"), g("drop_last"), g("drop")))
        else:
            falls_txt.append("- the sender log was not found: the SURVEY_WALKOFF fall is not printed")
    o += ["", "## SURVEY_WALKOFF (disclosed; never counted)", ""] + (falls_txt or ["- no SURVEY_WALKOFF block (run without -SurveyReturn)"])
    ok = not why
    if not used_is_v1:
        o += ["", "## The route driven vs the pinned v1 (R7-09)", "", "- changed fields: %s" % (", ".join(used_changed) or "none")]
        o += ["- REFUSED: " + b for b in used_bad] or ["- inside the bounds (waypoints, arrive points, taps, calibration only)"]
    o += ["", "## Route verdict", "", "- %s (route sha256 %s)" % ("ROUTE OK" if ok else "ROUTE NOT OK: " + "; ".join(why), used_sha)]
    rc = 0 if ok else 1
    if "--route-new" in args:
        with open(args["--route-new"], encoding="utf-8-sig") as f:
            new = json.load(f)
        changed, bad = route_diff(base, new)      # R7-09: against the PINNED v1, not the route the survey drove
        o += ["", "## Proposed route (bounded by B-9)", "", "- file `%s` sha256 `%s`" % (args["--route-new"], sha256(args["--route-new"])),
              "- changed fields: %s" % (", ".join(changed) or "none")]
        o += ["- REFUSED: " + b for b in bad] or ["- inside the bounds (waypoints, arrive points, taps, calibration only)"]
        if bad:
            rc = 1
    o += ["", "The reviewer rules on this addendum before any jump or M4 data (B-9). This record is hashed with the run."]
    text = "\n".join(o) + "\n"
    out = args.get("--out") or os.path.join(run, "SURVEY_RECORD.md")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print(text)
    print("record %s sha256 %s" % (out, sha256(out)))
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
