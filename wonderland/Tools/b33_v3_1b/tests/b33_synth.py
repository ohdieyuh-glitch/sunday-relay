"""b33_synth.py -- synthetic B33 run folders for the unit tests. DIAGNOSTIC tool, W2DEV, not evidence by itself (SYNTHETIC data only).
Builds a run folder like b33_launch.ps1 + b33_drive.ps1 would (RUN.json, sender/observer Wonderland.log with the client's exact WLREMOTE line
formats, drive_synth/timeline.csv, frames/index.csv without images) from a 1 ms physics model of the Dog (JumpZVelocity 420, gravity 980,
jog 230, run 520) and a model observer that draws the sender's report CHORD at (now - delayMs) plus injected errors.
Log stamps go through a queue model of the UE log writer: stamp = max(emit time, previous stamp + write cost) per file (write cost 0 = exact).
v3.1: RUN.json prereg_launch true; every wl.* CVar in a client's -ExecCmds (not wl.Social.Dev, a command) echoes as a bare
`wl.X = "v"` log line like UE 5.8 does (R7-06; echo_extra_* / echo_omit_observer for fixtures); and the run is CLOSED like b33_stop.ps1
closes it: SHA256SUMS_AT_CLOSE.txt (RUN.json, both logs, the timeline, frames\\index.csv) + RUN_CLOSE.json (close=False for a fixture).
Defaults follow the PREREG B33 v3 judged launch: each client's -ExecCmds = wl.Social.Dev <identity> http://127.0.0.1:8796, wl.Remote.LogPeriod 0.1,
scalability 0; RUN.json disclosed.render_cvars = ["scalability 0"], server.port 8796, boot_sha256 "cd"*32.
CLI (used by tests/test_drive_and_stop.ps1 C9): python -I -B tests/b33_synth.py --from-drychecks <DRYCHECKS.json> <out run dir> [--append-observer CMD]
  builds a synthetic run whose two "LogInit: Command Line:" lines are EXACTLY the launcher's planned client arguments (DRYCHECKS.json planned.*.args,
  optionally with one more -ExecCmds command appended on the observer) and whose RUN.json disclosed block, identities and server port are the
  launcher's own (DRYCHECKS.json disclosed / planned / server_port).
"""
import datetime, hashlib, json, math, os, re

T0 = datetime.datetime(2026, 10, 21, 12, 0, 0, tzinfo=datetime.timezone.utc).timestamp()
G, VJ, JOG, RUN = 980.0, 420.0, 230.0, 520.0


def stampstr(t, frame):
    d = datetime.datetime.fromtimestamp(t, datetime.timezone.utc)
    return "[%04d.%02d.%02d-%02d.%02d.%02d:%03d][%3d]" % (d.year, d.month, d.day, d.hour, d.minute, d.second, d.microsecond // 1000, frame % 1000)


class Plan:
    """a time line of segments: each ('stand'|'walk'|'run', seconds, jumps=[relative times], m4=False)"""
    def __init__(self):
        self.segs = []

    def add(self, kind, secs, jumps=(), block=None):
        self.segs.append((kind, secs, list(jumps), block))
        return self


SYNTH_ROUTE_TEXT = '{"name": "synthetic route (b33_synth.py; v3.1 ROUTE_PIN fixtures)"}\n'


def default_plan(n_stand=8, n_walk=8, n_run=8, m4_drops=(111.3,) * 10, stand_gap=2.6, walk_gap=1.6, run_gap=1.4, m4_gap_s=0.0):
    p = Plan()
    p.m4_gap_s = m4_gap_s
    p.add("stand", 2.0)
    p.add("stand", 1.0 + n_stand * stand_gap, [1.0 + i * stand_gap for i in range(n_stand)], "STAND")
    p.add("stand", 2.0)
    p.add("walk", 1.0 + n_walk * walk_gap + 0.6, [1.0 + i * walk_gap for i in range(n_walk)], "WALK")
    p.add("stand", 2.0)
    p.add("run", 1.0 + n_run * run_gap + 0.6, [1.0 + i * run_gap for i in range(n_run)], "RUN")
    p.add("stand", 2.0)
    p.m4_drops = list(m4_drops)
    return p


def simulate(plan, m4_space_at=None):
    """1 ms steps -> list of (t, x, y, z, vz, speed, airborne, label); blocks [(name, t0, t1)]; key events [(t, name)]"""
    dt = 0.001
    out, blocks, keys = [], [], []
    x, y, z, vz, air = 0.0, 200.0, 10.0, 0.0, False
    t = 0.0
    ground_fn = [lambda xx, yy: 10.0]

    def step(spd, heading_y, want_jump):
        nonlocal x, y, z, vz, air, t
        if want_jump and not air:
            air, vz = True, VJ
        if heading_y:
            y += spd * dt
        else:
            x += spd * dt
        g = ground_fn[0](x, y)
        if not air:
            if g < z - 0.5:
                air, vz = True, 0.0      # walked off an edge
            else:
                z = g
        if air:
            vz -= G * dt
            z += vz * dt
            if z <= g and vz < 0:
                z, vz, air = g, 0.0, False
        t += dt
        lab = ("JUMP" if vz > 0 else "FALL") if air else ("IDLE" if spd < 10 else ("WALK" if spd < 400 else "RUN"))
        out.append((t, x, y, z, vz, spd, air, lab))

    for kind, secs, jumps, block in plan.segs:
        spd = {"stand": 0.0, "walk": JOG, "run": RUN}[kind]
        t_start = t
        if block:
            blocks.append([block, t_start, None])
        jl = sorted(jumps)
        n = int(round(secs / dt))
        for i in range(n):
            rel = i * dt
            want = bool(jl) and rel >= jl[0]
            if want:
                keys.append((t, "SPACE"))
                jl.pop(0)
            step(spd, True, want)
        if block:
            blocks[-1][2] = t
    # M4: along +x, cycles of ramp up (+105 over 380 uu) / plateau 100 uu (stand 1.2 s) / cliff (drop) / lawn 400 uu (stand 1.6 s)
    if getattr(plan, "m4_drops", None):
        level, x0 = z, x
        prof = []          # (x_from, x_to, z_from, z_to)
        cx = x0
        for d in plan.m4_drops:
            top = level + 105.0
            prof.append((cx, cx + 380.0, level, top)); cx += 380.0
            prof.append((cx, cx + 100.0, top, top)); cx += 100.0
            level = top - d
            prof.append((cx, cx + 400.0, level, level)); cx += 400.0

        def gfun(xx, yy, prof=prof, z_end=level):
            for a, b, za, zb in prof:
                if a <= xx < b:
                    return za + (zb - za) * (xx - a) / (b - a)
            return z_end
        ground_fn[0] = gfun
        cx = x0
        for k_att, d in enumerate(plan.m4_drops):
            blocks.append(["M4_%d" % (k_att + 1), t, None])      # Q-M2c-5: one block per walk-off attempt, as the drive logs them
            # walk the ramp to the middle of the plateau, stand, walk off, walk on, stand
            for target, stand in ((cx + 380.0 + 50.0, 1.2), (cx + 380.0 + 100.0 + 150.0, 1.6)):
                while x < target:
                    if m4_space_at is not None and abs(t - (blocks[-1][1] + m4_space_at)) < 0.0005:
                        keys.append((t, "SPACE"))
                    step(JOG, False, False)
                for _ in range(int(stand / dt)):
                    step(0.0, False, False)
            cx += 880.0
            blocks[-1][2] = t
            if getattr(plan, "m4_gap_s", 0.0) and k_att < len(plan.m4_drops) - 1:
                for _ in range(int(plan.m4_gap_s / dt)):      # v3.1: the return between attempts, outside every block (P78)
                    step(0.0, False, False)
    return out, [tuple(b) for b in blocks], keys


def sender_reports(traj, periods=(0.117, 0.165, 0.123, 0.141)):
    """the sender's world reports: every ~117-165 ms the state at that instant"""
    reps, k, tn = [], 0, 0.05
    idx = 0
    while idx < len(traj):
        while idx < len(traj) and traj[idx][0] < tn:
            idx += 1
        if idx >= len(traj):
            break
        reps.append(traj[idx])
        tn += periods[k % len(periods)]
        k += 1
    return reps


def chord(reps, tt):
    """linear interpolation of the reported z (what the analyser calls truth); None outside"""
    lo, hi = 0, len(reps) - 1
    if tt < reps[0][0] or tt > reps[-1][0]:
        return None, None, None
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if reps[mid][0] <= tt:
            lo = mid
        else:
            hi = mid
    a, b = reps[lo], reps[hi]
    f = (tt - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 0.0
    return a[3] + (b[3] - a[3]) * f, a, b


def queue_stamps(events, cost):
    """events [(emit t, text)] -> [(stamp, text)] through the one-writer queue"""
    events.sort(key=lambda e: e[0])
    out, last = [], -1e18
    for t, text in events:
        s = max(t, last + cost)
        out.append((s, text))
        last = s
    return out


def build(run_dir, plan=None, air_off=0.0, land_off=0.0, sink=0.0, delay=0.30, sender_cost=0.0, viewer_cost=0.0,
          filler_viewer_hz=0.0, filler_sender_hz=0.0, dev_line=False, teleport=False, m4_space_at=None, frames=True, timeline=True,
          sender_name="synth_s", viewer_name="synth_v", exe_sha="ab" * 32, pids=(101, 102), standing_reps=True,
          exec_sender=None, exec_observer=None, role="JUDGED", started_utc="2026-10-21T00:00:00Z", render_cvars=("scalability 0",), cmdline=True, server=None,
          teleport_uu=900.0, dev_line_observer=False, sink_from=0.6, sink_to=1.4, extra_switches=(), rep_lines=True,
          boot_sha="cd" * 32, commit="synthetic", run_extra=None, cmdline_sender=None, cmdline_observer=None, disclosed=None,
          echo_extra_sender=(), echo_extra_observer=(), echo_omit_observer=(), close=True, post_inputs=(), ring=False, ring_repeat_every=0, sink_blocks=()):
    plan = plan or default_plan()
    traj, blocks, keys = simulate(plan, m4_space_at=m4_space_at)
    # v3.1 Q-B33-2 fixtures: extra drawn-height offsets on GROUND samples, at truth times relative to a block's begin or end
    # sink_blocks = [(block name, "begin" | "end", from_s, to_s, dz)]
    sink_spans = []
    for bn, anchor, f0, f1, dz in sink_blocks:
        bb = [b for b in blocks if b[0] == bn][0]
        base = bb[1] if anchor == "begin" else bb[2]
        sink_spans.append((base + f0, base + f1, dz))
    reps = sender_reports(traj)
    if teleport:
        k = len(reps) // 2
        r = reps[k]
        reps[k] = (r[0], r[1] + teleport_uu, r[2], r[3], r[4], r[5], r[6], r[7])
    land_times = []
    for p, q in zip(reps, reps[1:]):
        if p[7] in ("JUMP", "FALL") and q[7] not in ("JUMP", "FALL"):
            land_times.append(q[0])
    fig = "usr_" + sender_name
    # ---- sender log
    sev = [(-5.0, "LogInit: Display: synthetic sender log (b33_synth.py)")]
    if exec_sender is None:
        exec_sender = ["wl.Social.Dev %s http://127.0.0.1:8796" % sender_name, "wl.Remote.LogPeriod 0.1", "scalability 0"]
    if exec_observer is None:
        exec_observer = ["wl.Social.Dev %s http://127.0.0.1:8796" % viewer_name, "wl.Remote.LogPeriod 0.1", "scalability 0"]
    if cmdline:
        sev.append((-4.9, "LogInit: Command Line: " + (cmdline_sender if cmdline_sender is not None else
                                                        '-userdir="X:/synth/sender" -windowed -ResX=940 -ResY=1031 -WinX=0 -WinY=0 -wldev%s -ExecCmds="%s"' % (
                                                            "".join(" " + x for x in extra_switches), ",".join(exec_sender)))))
    prev_t = None
    for r in reps:
        per = 0 if prev_t is None else (r[0] - prev_t) * 1000.0
        prev_t = r[0]
        sev.append((T0 + r[0], "LogTemp: Display: WLREMOTE send motion=%s z=%.1f vz=%.1f period=%.0fms" % (r[7], r[3], r[4], per)))
        sev.append((T0 + r[0] + 0.012, "LogTemp: Display: WLREMOTE send soles=(%.1f,%.1f,%.1f) rtt=12ms period=%.0fms status=200 yaw=90.00" % (r[1], r[2], r[3], per)))
    if dev_line:
        sev.append((T0 + reps[len(reps) // 3][0] + 0.003, "LogTemp: Display: WLDEV jump"))
    dev_obs = [(T0 + reps[len(reps) // 3][0] + 0.004, "LogTemp: Display: WLDEV pos 0 0 0 yaw 0")] if dev_line_observer else []
    if filler_sender_hz:
        n = int((reps[-1][0]) * filler_sender_hz)
        sev += [(T0 + i / filler_sender_hz, "LogTemp: Display: filler line %d" % i) for i in range(n)]
    sev[0] = (T0 - 5.0, sev[0][1])
    if cmdline:
        sev[1] = (T0 - 4.9, sev[1][1])
    sev += [(T0 - 4.8, e) for e in _echoes(cmdline_sender, exec_sender) + list(echo_extra_sender)]
    # ---- viewer log, as WonderlandSocialLive/WonderlandWorldPresence do it: its own world reports (period=, the D1 anchors); in each answer
    # (right after its "send soles" line) the sender's newest stored report is applied: a new position sets RecvAt/RecvAgeMs and logs a rep
    # line; a standing player's newer report (8c5c62cb ReportTimeSamples) logs a rep line too but keeps RecvAt. Every ~100 ms tick: a fig
    # line (recv = target, age = (now - RecvAt) + RecvAgeMs) and a motion line (drawn z = the report chord at now - delay + injected errors).
    vev = [(T0 - 5.0, "LogInit: Display: synthetic viewer log (b33_synth.py)")]
    if cmdline:
        vev.append((T0 - 4.9, "LogInit: Command Line: " + (cmdline_observer if cmdline_observer is not None else
                                                             '-userdir="X:/synth/observer" -windowed -ResX=940 -ResY=1031 -WinX=960 -WinY=0 -wldev%s -ExecCmds="%s"' % (
                                                                 "".join(" " + x for x in extra_switches), ",".join(exec_observer)))))
    vev += [(T0 - 4.8, e) for e in _echoes(cmdline_observer, exec_observer)
            if e.split(" = ")[0].lower() not in [x.lower() for x in echo_omit_observer]] + [(T0 - 4.8, e) for e in echo_extra_observer]
    tv, per_i, pers = 0.03, 0, (0.131, 0.149, 0.119, 0.157)
    prev = None
    # v3.1k P82 fixtures: ring=True writes the transport ring's trail lines (TRANSPORT_RING_DESIGN_T1_v1 4.3): at each answer, the sender's
    # reports stored since the last one the viewer took (at most 7, oldest first, never the newest) as 'WLREMOTE trail ... ins=1'; every
    # ring_repeat_every-th answer with a trail also repeats its first point as 'ins=0' (a dropped at-least-once repeat). Lines only: the drawn
    # z (motion lines) is the same chord with or without them.
    idx_of = {id(r): i for i, r in enumerate(reps)}
    ring_answers = 0
    arrivals = []          # (t_cb, report) in time order: when the viewer took each new position
    target, last_seen = None, None
    while tv < traj[-1][0]:
        per = 0 if prev is None else (tv - prev) * 1000.0
        prev = tv
        t_cb = tv + 0.011
        vev.append((T0 + tv, "LogTemp: Display: WLREMOTE send motion=IDLE z=10.0 vz=0.0 period=%.0fms" % per))
        vev.append((T0 + t_cb, "LogTemp: Display: WLREMOTE send soles=(500.0,-300.0,10.0) rtt=11ms period=%.0fms status=200 yaw=0.00" % per))
        newest = None
        for r in reps:
            if r[0] <= t_cb - 0.005:
                newest = r
            else:
                break
        if newest is not None and newest is not last_seen:
            if ring and last_seen is not None:
                skipped = reps[idx_of[id(last_seen)] + 1:idx_of[id(newest)]][-7:]
                for k, r in enumerate(skipped, 1):
                    vev.append((T0 + t_cb + 0.0001, "LogTemp: Display: WLREMOTE trail fig=%s p=(%.1f,%.1f,%.1f) age=%.0fms k=%d/%d ins=1 n=5"
                                % (fig, r[1], r[2], r[3], (t_cb - r[0]) * 1000.0, k, len(skipped))))
                if skipped:
                    ring_answers += 1
                    if ring_repeat_every and ring_answers % ring_repeat_every == 0:
                        r = skipped[0]
                        vev.append((T0 + t_cb + 0.00015, "LogTemp: Display: WLREMOTE trail fig=%s p=(%.1f,%.1f,%.1f) age=%.0fms k=1/%d ins=0 n=5"
                                    % (fig, r[1], r[2], r[3], (t_cb - r[0]) * 1000.0, len(skipped))))
            age = (t_cb - newest[0]) * 1000.0
            moved = target is None or abs(newest[1] - target[1]) > 0.5 or abs(newest[2] - target[2]) > 0.5 or abs(newest[3] - target[3]) > 0.5
            if moved:
                arrivals.append((t_cb + 0.0002, newest, age))
                target = newest
            if rep_lines and (moved or standing_reps):
                vev.append((T0 + t_cb + 0.0002, "LogTemp: Display: WLREMOTE rep fig=%s p=(%.1f,%.1f,%.1f) age=%.0fms n=5 v=%.0f retimeShiftMs=0"
                            % (fig, newest[1], newest[2], newest[3], age, newest[5])))
            last_seen = newest
        tv += pers[per_i % len(pers)]
        per_i += 1
    tf, fr, ai = 0.5, 0, -1
    while tf < traj[-1][0]:
        while ai + 1 < len(arrivals) and arrivals[ai + 1][0] <= tf:
            ai += 1
        tt = tf - delay
        zc, a, b = chord(reps, tt)
        if zc is not None and ai >= 0:
            zd = zc
            if a[7] in ("JUMP", "FALL") or b[7] in ("JUMP", "FALL"):
                zd += air_off
            else:
                lt = max([L for L in land_times if L <= tt], default=None)
                if lt is not None and 0.0 < tt - lt <= 0.3:
                    zd += land_off
                if lt is not None and sink_from < tt - lt <= sink_to:
                    zd += sink
                for a_, b_, dz_ in sink_spans:
                    if a_ <= tt <= b_:
                        zd += dz_
            recv_at, cur, recv_age = arrivals[ai]
            vev.append((T0 + tf, "LogTemp: Display: WLREMOTE fig=%s recv=(%.1f,%.1f,%.1f) age=%.0fms applied=(0.0,0.0,0.0) lagUu=0.0 lagXYUu=0.0 worn=0 floatZ=0.00 lowestUu=-0.24 aim=(0.0,0.0) dtMs=16.7 nowXY=(0.0,0.0) interp=1 delayMs=%.0f yaw=90.00 tyaw=90.00"
                        % (fig, cur[1], cur[2], cur[3], (tf - recv_at) * 1000.0 + recv_age, delay * 1000.0)))
            vev.append((T0 + tf + 0.00001, "LogTemp: Display: WLREMOTE motion fig=%s motion=%s z=%.2f" % (fig, cur[7], zd)))
        tf += 0.1 + (0.004 if fr % 3 == 0 else 0.0)
        fr += 1
    vev += dev_obs
    if filler_viewer_hz:
        n = int(traj[-1][0] * filler_viewer_hz)
        vev += [(T0 + i / filler_viewer_hz, "LogTemp: Display: filler line %d" % i) for i in range(n)]
    os.makedirs(run_dir, exist_ok=True)
    paths = {}
    for who, ev, cost in (("sender", sev, sender_cost), ("observer", vev, viewer_cost)):
        lines = queue_stamps(ev, cost)
        d = os.path.join(run_dir, who, "Saved", "Logs")
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, "Wonderland.log")
        with open(p, "w", encoding="utf-8", newline="\n") as f:
            for n, (s, text) in enumerate(lines):
                f.write(stampstr(s, n) + text + "\n")
        paths[who] = p
    run = {"run_id": os.path.basename(run_dir), "label": "SYNTHETIC (b33_synth.py)", "exe_sha256": exe_sha, "boot_sha256": boot_sha, "commit": commit,
           "role": role, "control": role == "CONTROL", "prereg_launch": True, "started_utc": started_utc,
           "disclosed": disclosed if disclosed is not None else {"render_cvars": list(render_cvars), "logging_cvars": ["wl.Remote.LogPeriod 0.1"]},
           "ram_free_gb_at_start": 9.9,
           "server": server if server is not None else {"prereg": True, "kind": "SYNTHETIC", "commit": "cbe584becf417c48cc4de8efe8a2fa16f404c0bf",
                                                         "tree": "490a543282a3703ce6878e0586dbe9a2a524d107", "port": 8796},
           "sender": {"log": paths["sender"], "pids": [pids[0]], "identity": sender_name},
           "observer": {"log": paths["observer"], "pids": [pids[1]], "identity": viewer_name}}
    run.update(run_extra or {})
    with open(os.path.join(run_dir, "RUN.json"), "w", encoding="utf-8") as f:
        json.dump(run, f, indent=1)
    if timeline:
        d = os.path.join(run_dir, "drive_synth")
        os.makedirs(d, exist_ok=True)
        ev = []
        for name, a, b in blocks:
            ev.append((a, "BLOCK_BEGIN", name))
            ev.append((b, "BLOCK_END", name))
        for t, k in keys:
            ev.append((t, "KEY_DOWN", k))
            ev.append((t + 0.12, "KEY_UP", k))
        # v3.1k (P78 fixtures): extra drive input rows (block name, seconds after that block's END, event, detail)
        for bn, dt_after, e, det in post_inputs:
            ends = [b for (name, a, b) in blocks if name == bn]
            ev.append((ends[0] + dt_after, e, det))
        ev.sort()
        with open(os.path.join(d, "route.json"), "w", encoding="utf-8", newline="\n") as f:   # v3.1: the drive's copy of its route (ROUTE_PIN)
            f.write(SYNTH_ROUTE_TEXT)
        with open(os.path.join(d, "timeline.csv"), "w", encoding="utf-8", newline="\n") as f:
            f.write("utc_iso,utc_ms,seq,event,detail\n")
            for n, (t, e, det) in enumerate(ev):
                ms = int(round((T0 + t) * 1000))
                f.write("%s,%d,%d,%s,%s\n" % (datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).isoformat(), ms, n, e, det))
    if frames:
        d = os.path.join(run_dir, "frames")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.csv"), "w", encoding="utf-8", newline="\n") as f:
            f.write("utc_ms,file\n")
            t = 0.0
            while t < traj[-1][0]:
                f.write("%d,f_%07d.jpg\n" % (int((T0 + t) * 1000), int(t * 1000)))
                t += 0.2
    if close:
        close_run(run_dir)
    return run_dir


def _echoes(cmdline_text, cmds):
    """the bare `wl.X = "v"` echo lines UE 5.8 writes for each wl.* CVar of -ExecCmds (wl.Social.Dev is a command: no echo)"""
    if cmdline_text is not None:
        m = re.search(r'-ExecCmds="([^"]*)"', cmdline_text)
        cmds = [c for c in (m.group(1).split(",") if m else []) if c.strip()]
    out = []
    for c in cmds or []:
        parts = c.split()
        if len(parts) == 2 and parts[0].lower().startswith("wl.") and parts[0].lower() != "wl.social.dev":
            out.append('%s = "%s"' % (parts[0], parts[1]))
    return out


def close_run(run_dir):
    """what b33_stop.ps1 writes after the run closed: SHA256SUMS_AT_CLOSE.txt (sha256, two spaces, the path relative to the run with
    backslashes; UTF-8 with BOM like Set-Content -Encoding utf8) and RUN_CLOSE.json (sums_sha256)"""
    def h(p):
        with open(p, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    rels = ["RUN.json"]
    for root, dirs, files in os.walk(run_dir):
        dirs.sort()
        for fn in sorted(files):
            rel = os.path.relpath(os.path.join(root, fn), run_dir)
            if fn in ("Wonderland.log", "timeline.csv", "index.csv") and rel not in rels:
                rels.append(rel)
    lines = ["%s  %s" % (h(os.path.join(run_dir, r)), r.replace("/", "\\")) for r in rels]
    sp = os.path.join(run_dir, "SHA256SUMS_AT_CLOSE.txt")
    with open(sp, "w", encoding="utf-8-sig", newline="\r\n") as f:
        f.write("\n".join(lines) + "\n")
    with open(os.path.join(run_dir, "RUN_CLOSE.json"), "w", encoding="utf-8") as f:
        json.dump({"closed_utc": "synthetic", "by": "b33_synth.close_run", "sums_file": "SHA256SUMS_AT_CLOSE.txt", "sums_sha256": h(sp)}, f, indent=1)


def from_drychecks(dc_path, out_dir, append_observer=None):
    """a synthetic run whose Command Lines and RUN.json launch block are the launcher's own planned ones (b33_launch.ps1 -DryChecks)"""
    with open(dc_path, encoding="utf-8-sig") as f:
        dc = json.load(f)
    pl = dc["planned"]
    args_o = pl["observer"]["args"]
    if append_observer:
        i = args_o.rindex('"')            # the closing quote of -ExecCmds="..." (the last token)
        args_o = args_o[:i] + "," + append_observer + args_o[i:]
    return build(out_dir, sender_name=pl["sender"]["identity"], viewer_name=pl["observer"]["identity"],
                 cmdline_sender=pl["sender"]["args"], cmdline_observer=args_o, disclosed=dc["disclosed"],
                 server={"prereg": True, "kind": "SYNTHETIC (from DRYCHECKS)", "port": dc["server_port"],
                         "commit": (dc.get("server") or {}).get("commit"), "tree": (dc.get("server") or {}).get("tree")},   # v3.1: the relay pin is judged
                 run_extra={"prereg_launch": dc.get("prereg_launch")})


if __name__ == "__main__":
    import sys
    a = sys.argv[1:]
    if len(a) >= 3 and a[0] == "--from-drychecks":
        extra = a[a.index("--append-observer") + 1] if "--append-observer" in a else None
        print(from_drychecks(a[1], a[2], extra))
    else:
        print(__doc__)
        sys.exit(2)
