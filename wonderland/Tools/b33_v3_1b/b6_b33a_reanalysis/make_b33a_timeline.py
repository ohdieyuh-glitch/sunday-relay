"""make_b33a_timeline.py -- W2DEV: b33a's recorded drive phases -> a b33_drive-format timeline.csv, for the B6 re-analysis only. DIAGNOSTIC, not evidence.
Run: python -I -B make_b33a_timeline.py <b33a run folder> <out timeline.csv>
b33a (run_20261020T071219Z_b33a, old exe 40102b69) was driven by mp_auto_jump_v3.ps1, which wrote jump_A.csv (one row per phase, UTC ISO start/end)
and jump_A.csv.log ("JUMP n in <phase> at HH:MM:SS.fff", taken AFTER the 120 ms Space hold). The judge v3 judges the drive's BLOCKS (M2 ruling
B-4), so the phases are mapped 1:1 and nothing else: JUMP IN PLACE -> STAND, WALK JUMP -> WALK, RUN JUMP -> RUN (BLOCK_BEGIN at the phase start,
BLOCK_END at its end), and each logged jump -> KEY_DOWN SPACE (logged time - 0.120 s) + KEY_UP SPACE (logged time). Inputs are read only.
"""
import csv, datetime, os, re, sys

PHASES = {"JUMP IN PLACE": "STAND", "WALK JUMP": "WALK", "RUN JUMP": "RUN"}
JUMP = re.compile(r"JUMP (\d+) in (.+?) at (\d\d):(\d\d):(\d\d)\.(\d{3})")


def iso_ms(s):
    s = s.strip().rstrip("Z")
    head, frac = (s.split(".") + ["0"])[:2]
    d = datetime.datetime.strptime(head, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc)
    return int(round(d.timestamp() * 1000 + float("0." + frac) * 1000))


def main(argv):
    run, out = argv[0], argv[1]
    rows = []
    with open(os.path.join(run, "jump_A.csv"), encoding="utf-8-sig", newline="") as f:
        phases = list(csv.DictReader(f))
    day = None
    for ph in phases:
        if not ph.get("phase") or (ph.get("index") or "").startswith("#"):
            continue                                   # the "# DONE ..." trailer
        name = ph["phase"].strip()
        t0, t1 = iso_ms(ph["start_utc"]), iso_ms(ph["end_utc"])
        day = day or datetime.datetime.fromtimestamp(t0 / 1000, datetime.timezone.utc).date()
        if name in PHASES:
            rows.append((t0, "BLOCK_BEGIN", PHASES[name]))
            rows.append((t1, "BLOCK_END", PHASES[name]))
    with open(os.path.join(run, "jump_A.csv.log"), encoding="utf-8-sig") as f:
        for line in f:
            m = JUMP.search(line)
            if not m or m.group(2).strip() not in PHASES:
                continue
            h, mi, s, ms = map(int, m.groups()[2:])
            t = int(datetime.datetime(day.year, day.month, day.day, h, mi, s, ms * 1000, tzinfo=datetime.timezone.utc).timestamp() * 1000)
            rows.append((t - 120, "KEY_DOWN", "SPACE"))
            rows.append((t, "KEY_UP", "SPACE"))
    rows.sort()
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write("utc_iso,utc_ms,seq,event,detail\n")
        for n, (t, ev, det) in enumerate(rows, 1):
            f.write("%s,%d,%d,%s,%s\n" % (datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).isoformat(), t, n, ev, det))
    print("wrote %s: %d rows (%d blocks)" % (out, len(rows), sum(1 for r in rows if r[1] == "BLOCK_BEGIN")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
