"""b33_judge.py v3.1 -- W2DEV judge for the B33 PACKAGE PRECONDITION (SC3; Stage 1 ruling Q4; M2 checklist B1-B8; M2 ruling a185b283 B-2..B-10;
M2b ruling fea3fb7f / review R7: R7-01..R7-10).
DIAGNOSTIC tool, W2DEV, not evidence by itself.
Runs the slicer (b33_slicer.py) and BOTH analysers (b33_analyser/motion_diag.py = the registered one, byte-identical, the BAR; motion_diag_w2.py =
the listed diff, which may only add a FAIL or an INCONCLUSIVE) on ONE run folder, scenario by scenario over the DRIVE's blocks, and prints the
verdicts PASS / FAIL / INCONCLUSIVE (or VOID), the M4 fall list, the launch/server/exe checks and the timing report.
Run:  python -I -B b33_judge.py <run folder> [--sender-log P --viewer-log P] [--timeline P] [--fig ID] [--frames DIR] [--no-require-frames]
                                [--candidate-file P] [--relay-pin-file P] [--route-pin-file P] [--expect-exe SHA256] [--allow-launch-cmds "a;b"]
                                [--allow-switches "-x;-y"] [--historical] [--json OUT]
      python -I -B b33_judge.py --pair <judge1.json> <judge2.json>                       (two fresh JUDGED runs; a CONTROL is refused)
      python -I -B b33_judge.py --control-vs <control.json> <judged1.json> <judged2.json> [--p7a <founder's P7a record>]   (R-5 clearance)
      python -I -B b33_judge.py --ring-compare <ring run> <run without the ring> [the same options as a run]   (v3.1k P82: the RING EVIDENCE
                                of both runs side by side; DESCRIPTIVE, never a criterion; each run is judged read-only as usual)
      v3.1: --allow-switches / --allow-launch-cmds only with --historical (R7-03); pair / --control-vs refuse a JSON judged with ANY override
      (R7-07); a VOID run is still analysed and its per-scenario verdicts printed (R7-08); the P7a record format is in read_p7a (R7-05).
      THE EXPECTED EXE comes from ONE place: tools/b33/CANDIDATE.json (game_exe_sha256), which the launcher reads too. While its status is
      not READY (it ships PENDING) every run is VOID. --candidate-file points at another candidate file (tests only); --expect-exe is a printed OVERRIDE for
      historical re-analyses and synthetic tests only. --allow-launch-cmds / --allow-switches only for historical
      runs whose rendering commands / switches were disclosed elsewhere (e.g. b33a), and they are printed. --historical (needs --expect-exe):
      a re-analysis of an exe older than 8c5c62cb (no ReportTimeSamples, so its in-effect check is skipped); printed; never SC3 data.
Inputs : <run>/RUN.json (b33_launch.ps1), both Wonderland.log files, <run>/drive_*/timeline.csv (b33_drive.ps1; dry-run timelines ignored),
         <run>/frames/index.csv (b33_frames.ps1).
Outputs: the report on stdout (and --json); exit 0 = PASS, 1 = FAIL, 3 = INCONCLUSIVE, 4 = VOID, 5 = pair REFUSED, 2 = usage/input error.
The verdict algebra (ALGEBRA below) is printed at the top of every report.
"""
import csv, datetime, glob, hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "b33_analyser"))
sys.path.insert(0, HERE)
import motion_diag as MD          # noqa: E402  the REGISTERED analyser (sha256 4dee34d0...), imported unmodified: THE BAR
import motion_diag_w2 as W        # noqa: E402  the listed diff (W2 D1-D5): may only ADD a FAIL or an INCONCLUSIVE
import b33_slicer as SL           # noqa: E402

REGISTERED_SHA256 = "4dee34d04a36ae0f9a8e0e7f5f925fa4eca371ce498927c1cce16b1d27f8ad29"
CANDIDATE_FILE = os.path.join(HERE, "CANDIDATE.json")   # THE ONE pinned candidate (label, commit, game/boot exe sha256); the launcher reads it too
RELAY_PIN_FILE = os.path.join(HERE, "RELAY_PIN.json")   # v3.1: THE relay pin (commit + tree of the counted loopback relay); the launcher reads it too
ROUTE_PIN_FILE = os.path.join(HERE, "ROUTE_PIN.json")   # v3.1: THE route pin (route sha256, chosen on a survey before data); the drive reads it too
RING_EVIDENCE = True     # v3.1 P82: the DESCRIPTIVE ring block; the test RingNoVerdictChange proves the verdicts byte-equal with it on and off
VOID_DEV = re.compile(r"wl\.dev\.", re.IGNORECASE)
VOID_WLDEV = "WLDEV"
CMDLINE = re.compile(r"LogInit: Command Line:(.*)$")
EXECCMDS = re.compile(r'-ExecCmds="([^"]*)"', re.IGNORECASE)
SWITCH = re.compile(r'(-[A-Za-z][A-Za-z0-9_]*)(?:=(?:"[^"]*"|\S*))?|("[^"]*"|\S+)')
DEFAULT_SWITCHES = ("-userdir", "-windowed", "-ResX", "-ResY", "-WinX", "-WinY", "-wldev", "-ExecCmds")   # PREREG B33 v3 launch switches
DEV_LOOPBACK = re.compile(r"^wl\.Social\.Dev\s+(\S+)\s+http://127\.0\.0\.1:(\d+)$", re.IGNORECASE)   # the dev identity on the LOOPBACK server only
LOG_PERIOD = re.compile(r"^wl\.Remote\.LogPeriod\s+([\d.]+)$", re.IGNORECASE)                     # logging only
PREREG_RENDER_CVARS = ("scalability 0",)   # PREREG B33 v3 judged launch: b33_launch.ps1 ... -RenderCvars 'scalability 0' (the ONLY rendering command)
PREREG_LOG_PERIOD = 0.1                    # b33_launch.ps1 -LogPeriod default
CONTROL_CVARS = ("wl.Remote.InterpEaseZ 30", "wl.Remote.ReportTimeSamples 0", "wl.Remote.RttClock 0")
INI_WL = re.compile(r"Set CVar \[\[(wl\.[^:\]]+)", re.IGNORECASE)
PREREG_SWITCHES = DEFAULT_SWITCHES          # R7-03: THE judge's own list (prereg); RUN.json's list is printed, never trusted (--historical excepted)
ECHO_WL = re.compile(r'^\[[^\]]*\]\[[^\]]*\](wl\.[A-Za-z0-9_.]+) = "([^"]*)"\s*$')   # R7-06: a bare console-set echo (UE 5.8), e.g.
                                                                                   # [2026.10.20-22.22.09:920][  0]wl.Remote.LogPeriod = "0.1"
ECHO_ALLOWED = {"wl.remote.logperiod": "0.1"}   # the prereg launch's only wl.* CVar (logging only)
OVERRIDE_FLAGS = ("--sender-log", "--viewer-log", "--timeline", "--fig", "--frames", "--no-require-frames", "--expect-exe",
                  "--allow-launch-cmds", "--allow-switches", "--historical", "--candidate-file",
                  "--relay-pin-file", "--route-pin-file")   # R7-07: pair/--control-vs refuse these (v3.1: the two pin files too)
CLOSE_SUMS = "SHA256SUMS_AT_CLOSE.txt"      # written by b33_stop.ps1 after the run closed (C0.3); the judge checks what it reads (R8-05 analog)
P7A_DECISION = re.compile(r"^\s*DECISION\s*:\s*(APPROVED|REJECTED)\s*$", re.IGNORECASE)
BLOCK_SCENARIO = {"STAND": "STANDING", "WALK": "WALKING", "RUN": "RUNNING"}
BLOCK_POST_S = 1.6
MIN_JUMPS = 7
MIN_EPISODES = 3
M4_MIN_FALLS = 5
# Q-M2c-5 (ruling M20261021T044135Z-INDEPENDENT_REVIEW-3fab1b, option (b); the lead's choice M20261021T044223Z-WONDERLAND_DEV-848a1d), fixed BEFORE data:
M4_ATTEMPTS = 10          # EXACTLY this many M4 walk-off attempts per counted run (blocks M4_1..M4_10); every one listed; no selection
M4_RERUN_CAP = 2          # at most this many ADDITIONAL counted runs per candidate, each replacing an M4-INCONCLUSIVE run
STOOD_FOR_CHECK_S = 2.0
AIR_BAR, LAND_BAR, SINK_BAR = 10.0, 2.0, -2.0
GATE_BACKLOG_P95_MS = 50.0
GATE_VIEWER_LAG_P95_MS = 100.0
GATE_LINK_MIN_N = 5
GATE_LINK_P95_MS = 400.0
GATE_RAW_LAG_P95_MS = 25.0

ALGEBRA = """VERDICT ALGEBRA v3.1 (B33 v3.1; M2 ruling a185b283 B-2..B-10; M2b ruling fea3fb7f R7-01..R7-08; fixed before data; bars verbatim
 from PREREG_B33_MOTION_v1 c73022b4, not loosened):
 PRECEDENCE (R7-02): VOID > FAIL > INCONCLUSIVE (an INCOMPLETE block included) > timing gate > PASS. A measured bar violation is FAIL even in an
   INCOMPLETE block or under a failed timing gate; nothing turns a FAIL into INCOMPLETE or INCONCLUSIVE.
 RUN COMPOSITION (R7-01): a JUDGED run is ONE launch (b33_launch.ps1 -Scenario all) with ONE drive (b33_drive.ps1 -Mode all: the jump blocks,
   then the M4 blocks), so each judged run carries all four scenarios; the CONTROL is one launch with -Control and -Mode jumps.
 Shift = 0 ms, fixed (B2). No exclusions and no time shifts: every sample of every DRIVE BLOCK of a scenario is analysed.
 SCENARIOS = the drive's blocks (drive_*/timeline.csv): STAND -> STANDING, WALK -> WALKING, RUN -> RUNNING, M4_<n> -> M4. A block's samples run
   from BLOCK_BEGIN to BLOCK_END + 1.6 s (sender game clock on the wall clock). A block that never ended (abort) ends at the drive's last row and is
   INCOMPLETE. No timeline = every scenario INCONCLUSIVE (M4 too). The slicer's classes only COUNT jumps toward the minimums: a jump of the block's
   class with its takeoff inside the block counts; every other jump or fall inside a block is listed, and its samples stay in that block's analysis.
 ANALYSERS = BOTH: the REGISTERED analyser (motion_diag.py 4dee34d0, raw log stamps, shift 0) is the bar. motion_diag_w2 re-times samples and may
   only ADD a FAIL or an INCONCLUSIVE; it is never the basis of a PASS. The sinking test (no registered numbers) uses the same arithmetic on the
   registered tuples and on W2's.
 RUN = VOID if any of these holds (R7-08: a VOID run is still analysed and its per-scenario verdicts are PRINTED so a bar FAIL stays
   visible; they are not a result, and pair / --control-vs never count them):
   - RUN.json's exe sha256 is not CANDIDATE.json's game_exe_sha256 (the ONE pinned candidate), or CANDIDATE.json's status is not READY
     (it ships PENDING: every run is VOID until the lead fills it);
   - a SENDER or OBSERVER log line matches (?i)wl\\.dev\\. or contains "WLDEV";
   - a teleport: > 150 uu at > 2000 uu/s, or > 60 uu at > 1200 uu/s;
   - (R7-03) a client's OWN "LogInit: Command Line" has a switch not in the PREREG list held by this judge: -userdir -windowed -ResX -ResY
     -WinX -WinY -wldev -ExecCmds (so -forcelogflush or -wlframes = VOID; RUN.json's list is printed, never trusted; only a --historical
     re-analysis uses RUN.json's list plus --allow-switches); or RUN.json prereg_launch is not true; or a client log has a
     "LogConfig ... Set CVar [[wl.*" line;
   - (R7-06) a client log has a bare console-set echo `wl.X = "v"` other than wl.Remote.LogPeriod = "0.1" (each -ExecCmds CVar and every
     console set echoes one), except, on a CONTROL observer, exactly one echo each of wl.Remote.InterpEaseZ = "30",
     wl.Remote.ReportTimeSamples = "0" and wl.Remote.RttClock = "0", all three of which must be there;
   - (R8-05 analog) a file the judge reads (RUN.json, both logs, every drive timeline, frames\\index.csv) is missing from, or differs from,
     the run's SHA256SUMS_AT_CLOSE.txt (b33_stop.ps1), or the run has no such file / RUN_CLOSE.json (--historical: checked only if present);
   - a client's -ExecCmds is not EXACTLY the PREREG set (as a multiset, any order): wl.Social.Dev <its RUN.json identity>
     http://127.0.0.1:<RUN.json server port>, wl.Remote.LogPeriod 0.1, scalability 0 (+ exactly the three CONTROL values on a CONTROL
     observer); i.e. any other command (an extra wl.Remote.*, r.*, ...), a repeated one or a missing one is VOID; and RUN.json
     disclosed.render_cvars must be exactly ["scalability 0"] (--historical re-analyses: disclosed/--allow-launch-cmds rendering commands);
   - RUN.json boot_sha256 is not CANDIDATE.json's boot_exe_sha256, RUN.json commit is not CANDIDATE.json's commit (or a prefix of it), or the
     run was launched with a non-default candidate file (RUN.json candidate.default false: -CandidateFile is for tests only);
   - a CONTROL run without exactly wl.Remote.InterpEaseZ 30, ReportTimeSamples 0 and RttClock 0 on the OBSERVER (none on the sender), or whose
     observer log shows newer-standing-report samples (repeated rep lines: ReportTimeSamples 1 in effect);
   - a JUDGED run with any of those three CVars, or whose observer log shows no newer-standing-report sample although the sender stood >= 2 s
     (the compiled default 1 not in effect);
   - a NOT-PREREG server (RUN.json server.prereg false: -ServerTree or -RelaySource);
   - (v3.1) RELAY_PIN.json is not PINNED with a 40-hex commit and tree, or RUN.json's server commit / tree are not the pin's (--historical:
     not checked);
   - (v3.1) the run has M4 blocks and ROUTE_PIN.json is not PINNED with a 64-hex route_sha256, or a drive's copy of its route
     (drive_*/route.json) does not hash to it (--historical: not checked).
 PER SCENARIO, in this order (B-3: a timing gate can never turn a FAIL into anything else):
   1 FAIL if the REGISTERED analyser's data violate a bar: air p95 > 10.0 uu; landing p95 > 2.0 uu (truth within 0.5 s after touchdown);
     sinking: any sample from 0.5 s after touchdown to the next takeoff or the block end drawn more than 2.0 uu below the sender (B-8); or the
     viewer received no air label. v3.1 (ruling Q-B33-2 = 392923 (b)): the sinking test runs PER BLOCK -- each M4 attempt is its own block
     -- so a touchdown in one block never opens a settle window in another; in EVERY block the samples before the block's first touchdown
     are not covered by the sinking bar (as STAND / WALK / RUN always were). The -2.0 floor, the 0.5 s offset and the window end are
     unchanged. The analysers' own settle_* numbers printed below run over the joined windows; the BAR reads the per-block numbers.
   2 FAIL if W2's data violate a bar.
   3 INCONCLUSIVE if an observation is missing:
     - jump scenarios: counted jumps < 7, or air_episodes_x3 < 3;
     - M4: qualifying falls < 5 (each >= 100.0 uu by min(median, last) - landing), or Space pressed in an M4 block;
     - any scenario: n_air, n_land or settle_n == 0; an INCOMPLETE block; no observer frame in the scenario (B7); a missing Command Line line.
     - any scenario (P78; ruling Q-B33-1 condition 4): a JUDGED block whose frozen window holds drive input after the block's end, i.e. a
       KEY_DOWN / KEY_UP / MOUSE / CLICK row of the drive timeline at END < t <= END + 1.6 s (the next block's, or an M4 return's, input:
       the window would measure that motion as this block's). INCONCLUSIVE, not VOID: a measured bar violation in such a block stays FAIL
       (R7-02 precedence; ruling Q-B33-1 condition 1: no attribution turns a counted FAIL into anything else); VOID is kept for the run's
       identity and integrity, and a VOID here would let a drive defect erase a FAIL.
   4 INCONCLUSIVE if a timing gate fails (gates only demote a PASS):
     - W2's clocks not established: sender or viewer backlog p95 > 50 ms; viewer file lag p95 > 100 ms; cross-log check < 5 samples; any
       causality violation < -10 ms; or link p95 > 400 ms;
     - or the raw file lag p95 > 25 ms (the registered analyser's stamps).
   5 PASS otherwise.
 RESULT: VOID if VOID; else FAIL if any scenario FAILs; else PASS only if all four PASS; else INCONCLUSIVE.
 M4 ATTEMPTS (Q-M2c-5 (b), stated before data): a counted run makes EXACTLY 10 walk-off attempts (blocks M4_1..M4_10). EVERY attempt
   is listed with its drop by the pinned start-z rule; an attempt is excluded ONLY by the height rule (drop < 100.0); EVERY qualifying fall
   is judged under the bars (its M4_<n> block), not the first 5; fewer than 5 qualifying = INCONCLUSIVE; any other attempt count =
   INCONCLUSIVE (the drive never skips or repeats an attempt); a bar FAIL on any qualifying fall = FAIL.
 PAIR / RECORD (B-6, B-10, Q-M2c-5): --pair <j1> <j2> or --record <j1> <j2> [<j3> <j4>] = EVERY counted run of the candidate, in launch order:
   - JUDGED runs only: a CONTROL is REFUSED; a JSON judged with any override (input paths, --no-require-frames, --expect-exe,
     --candidate-file, --allow-*, --historical) is REFUSED (R7-07); a VOID run makes the pair VOID.
   - ONE exe sha256 for all; different run folders; different client pids.
   - NO HIDDEN RUN: every JUDGED run folder of that exe next to a listed one must be listed, or REFUSED. (v3.1a, 7a7faf P2-2) A run that
     is never counted is not a JUDGED run and is not listed: role SURVEY or REHEARSAL_NOT_PREREG (the v3.1a launcher writes them outside
     the counted-runs folder), and, for an older folder, a name SURVEY_* / REHEARSAL_NOT_PREREG_*, scenario survey or a NOT-PREREG server.
   - Any FAIL in any run = FAIL (the candidate is not cleared; no retry).
   - A run whose ONLY non-PASS is M4 INCONCLUSIVE FOR THE PRE-STATED CAUSE may be replaced by a FRESH run; at most 2 additional counted
     runs in total, each one replacing such a run (an additional run with nothing to replace, or a third additional run, is REFUSED);
     every run stays listed. (v3.1a, 7a7faf P2-1 (a), chosen before data) The ONLY replaceable cause is the 3fab1b one: "fewer than 5
     qualifying falls" (with 0 qualifying, the "no drive block" that follows from it). Any other M4 INCONCLUSIVE reason (P78 window
     contamination, an attempt count other than 10, an INCOMPLETE block, a missing observation, a Space press, a timing gate) is NOT
     replaceable: the record is INCONCLUSIVE and the reviewer rules.
   - PASS = two runs in which EVERY scenario, M4 included, PASSES (the first two such runs); a run INCONCLUSIVE outside M4 is not
     replaceable under (b): INCONCLUSIVE (the reviewer rules).
 CONTROL (R-5, B-10): judged like a run, and expected to FAIL. --control-vs prints the three clearance conditions:
   (a) (R7-04) the control (not VOID) FAILs >= 1 jump scenario by a REGISTERED-analyser bar at shift 0 (registered_bar_violations not
       empty); a W2-only FAIL or a missing air label does not count;
   (b) both judged runs (not VOID, no override) PASS that scenario and their whole runs (all four scenarios: R7-01 run composition);
   (c) (R7-05) the founder's P7a look at the observer frames is recorded VERBATIM as an APPROVAL (--p7a <record>: DECISION: APPROVED and a
       non-empty VERBATIM: text); a recorded REJECTION means NOT cleared. The reviewer judges (c) from the verbatim record; the tool line is
       advisory.
   The compiled defaults (120/1/1 at v3) clear only if (a), (b) and (c) all hold. Otherwise (a control that does not fail, a judged run that does not PASS, or
   a rejection): revert, that is a new governed build and fresh SC3 runs."""


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def read_lines(p):
    with open(p, encoding="utf-8", errors="replace") as f:
        return f.read().splitlines()


def utc(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%H:%M:%S.%f")[:-3] if t is not None else "-"


def load_candidate(path):
    """CANDIDATE.json -> dict (status, label, commit, game_exe_sha256, boot_exe_sha256, package_folder); a missing or unreadable file is not READY"""
    if not path or not os.path.exists(path):
        return {"status": "PENDING (no candidate file %s)" % path, "game_exe_sha256": ""}
    try:
        with open(path, encoding="utf-8-sig") as f:
            c = json.load(f)
        return c if isinstance(c, dict) else {"status": "INVALID (not a JSON object: %s)" % path, "game_exe_sha256": ""}
    except (OSError, ValueError) as e:   # an unreadable candidate file is NOT READY (VOID), never a crash (exit 1 would read as FAIL)
        return {"status": "INVALID (%s: %s)" % (path, e), "game_exe_sha256": ""}


def candidate_pending(c):
    """True unless status is exactly READY and game_exe_sha256 is a sha256 (the launcher refuses on the same rule)"""
    return str(c.get("status", "")).strip() != "READY" or not re.fullmatch(r"[0-9a-fA-F]{64}", str(c.get("game_exe_sha256") or ""))


def dev_lines(lines):
    return [(i + 1, l.strip()[:200]) for i, l in enumerate(lines) if VOID_WLDEV in l or VOID_DEV.search(l)]


def launch_scan(lines, who, disclosed_render, allow_extra, switches_ok):
    """the client's own "LogInit: Command Line:" line: every switch against the disclosed list (B-5), and its -ExecCmds commands classified
    (dev identity on the loopback server; logging-only wl.Remote.LogPeriod; CONTROL: the three old values; disclosed rendering commands;
    anything else not allowed). Also any ini/console "Set CVar [[wl.*" line. exec_exact() then checks the set is EXACTLY the prereg one."""
    out = {"client": who, "cmdline_found": False, "switches": [], "bad_switches": [], "commands": [], "control_cvars": [], "render_cvars": [],
           "dev_cmds": [], "log_period_cmds": [], "not_allowed": [], "ini_wl_lines": [], "empty_tokens": 0}
    cl = None
    for l in lines[:5000]:
        m = CMDLINE.search(l)
        if m:
            cl = m.group(1)
            break
    if cl is not None:
        out["cmdline_found"] = True
        ok = {s.lower() for s in switches_ok}
        for m in SWITCH.finditer(cl):
            if m.group(1):
                out["switches"].append(m.group(1))
                if m.group(1).lower() not in ok:
                    out["bad_switches"].append(m.group(1))
            elif m.group(2):
                out["bad_switches"].append("unexpected token " + m.group(2)[:60])
        m = EXECCMDS.search(cl)
        toks = m.group(1).split(",") if m else []
        cmds = [" ".join(c.split()) for c in toks if c.strip()]
        out["empty_tokens"] = sum(1 for c in toks if not c.strip())   # a trailing / double comma: not EXACTLY the prereg ExecCmds
        out["commands"] = cmds
        low_control = [c.lower() for c in CONTROL_CVARS]
        for c in cmds:
            if DEV_LOOPBACK.match(c):
                out["dev_cmds"].append(c)
            elif LOG_PERIOD.match(c):
                out["log_period_cmds"].append(c)
            elif c.lower() in low_control:
                out["control_cvars"].append(c)
            elif not c.lower().startswith("wl.") and (c in disclosed_render or c in allow_extra):
                out["render_cvars"].append(c)
            else:
                out["not_allowed"].append(c)
    for i, l in enumerate(lines):
        m = INI_WL.search(l)
        if m and "LogConfig" in l:
            out["ini_wl_lines"].append((i + 1, l.strip()[:200]))
    return out


def exec_exact(sc, identity, port):
    """PREREG B33 v3 launch (b33_launch.ps1 -Package <pkg> -Commit <sha> -Scenario <s> -RenderCvars 'scalability 0'): a client's -ExecCmds is
    EXACTLY {wl.Social.Dev <identity> http://127.0.0.1:<port>, wl.Remote.LogPeriod 0.1, scalability 0}, as a multiset in any order (a CONTROL
    observer's three old values are checked in launch_verdict; any other command is already in not_allowed). -> VOID reasons"""
    why, who = [], sc["client"]
    if not sc["cmdline_found"]:
        return why
    if len(sc["dev_cmds"]) != 1:
        why.append("%s -ExecCmds has %d wl.Social.Dev loopback commands, not exactly 1: %s" % (who, len(sc["dev_cmds"]), sc["dev_cmds"]))
    else:
        m = DEV_LOOPBACK.match(sc["dev_cmds"][0])
        if identity and m.group(1).lower() != str(identity).lower():
            why.append("%s -ExecCmds dev identity %s is not RUN.json's %s" % (who, m.group(1), identity))
        if port and int(m.group(2)) != int(port):
            why.append("%s -ExecCmds dev server port %s is not RUN.json's server port %s" % (who, m.group(2), port))
    lp = sc["log_period_cmds"]
    try:
        lp_ok = len(lp) == 1 and abs(float(LOG_PERIOD.match(lp[0]).group(1)) - PREREG_LOG_PERIOD) < 1e-9
    except ValueError:
        lp_ok = False
    if not lp_ok:
        why.append("%s -ExecCmds logging command(s) %s are not exactly ['wl.Remote.LogPeriod %s']" % (who, lp, PREREG_LOG_PERIOD))
    if sorted(c.lower() for c in sc["render_cvars"]) != sorted(PREREG_RENDER_CVARS):
        why.append("%s -ExecCmds rendering commands %s are not exactly the prereg's %s" % (who, sc["render_cvars"], list(PREREG_RENDER_CVARS)))
    if sc.get("empty_tokens"):
        why.append("%s -ExecCmds has %d empty command(s) (a trailing or double comma): not exactly the prereg set" % (who, sc["empty_tokens"]))
    return why


def echo_scan(lines):
    """R7-06: every bare console-set echo `[stamp][frame]wl.X = "v"` -> [(line no, name, value)]"""
    out = []
    for i, l in enumerate(lines):
        m = ECHO_WL.match(l.rstrip("\r\n"))
        if m:
            out.append((i + 1, m.group(1), m.group(2)))
    return out


def _same_value(a, b):
    try:
        return abs(float(a) - float(b)) < 1e-9
    except ValueError:
        return a.strip().lower() == b.strip().lower()


def echo_verdict(role, echoes):
    """R7-06 -> VOID reasons. echoes = {"sender": [...], "observer": [...]} from echo_scan"""
    void = []
    want = {c.split()[0].lower(): c.split()[1] for c in CONTROL_CVARS}
    for who in ("sender", "observer"):
        seen = {}
        for (n, name, val) in echoes.get(who, []):
            k = name.lower()
            if k in ECHO_ALLOWED and _same_value(val, ECHO_ALLOWED[k]):
                continue
            if role == "CONTROL" and who == "observer" and k in want and _same_value(val, want[k]):
                seen[k] = seen.get(k, 0) + 1
                continue
            void.append('%s log line %d: console-set echo %s = "%s" that the prereg launch does not make (R7-06)' % (who, n, name, val))
        if role == "CONTROL" and who == "observer":
            for k, v in want.items():
                if seen.get(k, 0) != 1:
                    void.append('CONTROL observer log has %d echo(es) of %s = "%s", not exactly 1: the control value is not confirmed (R7-06)' % (
                        seen.get(k, 0), k, v))
    return void


def close_check(run, paths, historical):
    """R8-05 analog: the files the verdict rests on must equal their hashes in SHA256SUMS_AT_CLOSE.txt (b33_stop.ps1) -> (record, VOID reasons)"""
    sums_p = os.path.join(run, CLOSE_SUMS) if run else ""
    if not run or not os.path.exists(sums_p):
        if historical:
            return {"sums_file": None, "note": "no %s (historical re-analysis: not required)" % CLOSE_SUMS}, []
        return {"sums_file": None}, ["the run has no %s: it was not closed by b33_stop.ps1, so its files are not fixed (R8-05 analog)" % CLOSE_SUMS]
    sums = {}
    with open(sums_p, encoding="utf-8-sig") as f:
        for line in f:
            parts = line.strip().split(None, 1)
            if len(parts) == 2 and len(parts[0]) == 64:
                sums[os.path.normcase(os.path.normpath(parts[1].strip().lstrip("*")))] = parts[0].lower()
    why, checked = [], {}
    for p in paths:
        rel = os.path.normcase(os.path.relpath(os.path.abspath(p), os.path.abspath(run)))
        if rel.startswith(".."):
            why.append("%s is outside the run folder: not covered by %s" % (p, CLOSE_SUMS))
            continue
        h = sha256(p)
        checked[rel] = h
        if rel not in sums:
            why.append("%s is not listed in %s" % (rel, CLOSE_SUMS))
        elif sums[rel] != h:
            why.append("%s changed after the run closed (now %s, at close %s)" % (rel, h[:16], sums[rel][:16]))
    rc = os.path.join(run, "RUN_CLOSE.json")
    if os.path.exists(rc):
        with open(rc, encoding="utf-8-sig") as f:
            cj = json.load(f)
        if (cj.get("sums_sha256") or "").lower() != sha256(sums_p):
            why.append("%s does not match RUN_CLOSE.json sums_sha256" % CLOSE_SUMS)
    elif not historical:
        why.append("the run has no RUN_CLOSE.json (b33_stop.ps1)")
    rec = {"sums_file": sums_p, "sums_sha256": sha256(sums_p), "checked": checked}
    if historical:      # a --historical re-analysis is never SC3 data: the close check is recorded, it never VOIDs
        rec["problems"] = why
        return rec, []
    return rec, why


def read_p7a(path):
    """R7-05: the founder's P7a record, a plain-text file written by whoever records the founder's look:
         DECISION: APPROVED            (or REJECTED)
         VERBATIM: <the founder's own words, verbatim; may continue on the following lines>
       other lines (RECORDED_UTC:, RECORDED_BY:, the frames looked at) are kept and printed.
       -> (state, verbatim text): APPROVED / REJECTED / INVALID (missing file, no or two DECISION lines, an empty VERBATIM)"""
    if not path or not os.path.isfile(path):
        return "INVALID", "no record (--p7a <file>)"
    with open(path, encoding="utf-8-sig", errors="replace") as f:
        lines = f.read().splitlines()
    dec = [P7A_DECISION.match(l).group(1).upper() for l in lines if P7A_DECISION.match(l)]
    verb, on = [], False
    for l in lines:
        if re.match(r"^\s*VERBATIM\s*:", l, re.IGNORECASE):
            on = True
            verb.append(l.split(":", 1)[1].strip())
        elif on and re.match(r"^\s*[A-Z_]+\s*:", l):
            on = False
        elif on:
            verb.append(l.strip())
    text = " ".join(x for x in verb if x)
    if len(dec) != 1:
        return "INVALID", "%d DECISION lines (exactly one of DECISION: APPROVED / DECISION: REJECTED is needed)" % len(dec)
    if not text:
        return "INVALID", "the VERBATIM: text is empty"
    return dec[0], text


def standing_report_check(viewer_lines, fig, sends):
    """B-10 / R-5: is ReportTimeSamples in effect on the OBSERVER? With 1 the observer logs a "WLREMOTE rep" line for each NEWER report of a
    standing sender (the same position again); with 0 it never does (a repeated position is not a sample). Counted: rep lines of the sender's
    figure whose position repeats the previous rep line's, at most 1.0 s later (a rejoin's re-announce is older). Also the sender's longest IDLE
    stretch (its own reports), since only a sender that stood can produce them."""
    figs, reps, _ = W.viewer_clock(viewer_lines, fig)
    repeats, prev = 0, None
    for (i, fg, key, t_cb, ts) in reps:
        if prev is not None and key == prev[0] and ts is not None and prev[1] is not None and ts - prev[1] <= 1.0:
            repeats += 1
        prev = (key, ts)
    longest, start = 0.0, None
    for s in sends:
        if s["motion"] == "IDLE":
            start = s["t"] if start is None else start
            longest = max(longest, s["t"] - start)
        else:
            start = None
    return {"repeated_rep_lines": repeats, "sender_longest_idle_s": longest}


def launch_verdict(role, scans, srcheck, historical=False):
    """-> (void reasons, inconclusive reasons) for the run's role"""
    void, inc = [], []
    for sc in scans:
        if not sc["cmdline_found"]:
            inc.append("%s log has no 'LogInit: Command Line:' line: launch settings cannot be checked" % sc["client"])
        for s in sc["bad_switches"]:
            void.append("%s launch switch not in the PREREG list (R7-03; --historical: not disclosed): %s" % (sc["client"], s))
        for c in sc["not_allowed"]:
            void.append("%s launch command not allowed (gameplay or undisclosed): %s" % (sc["client"], c))
        for n, l in sc["ini_wl_lines"]:
            void.append("%s ini/console wl.* CVar set at line %d: %s" % (sc["client"], n, l))
    snd = [x for x in scans if x["client"] == "sender"]
    obs = [x for x in scans if x["client"] == "observer"]
    stood = srcheck["sender_longest_idle_s"] >= STOOD_FOR_CHECK_S
    if role == "CONTROL":
        if snd and snd[0]["control_cvars"]:
            void.append("CONTROL misconfigured: the sender has %s (only the observer gets the old values)" % snd[0]["control_cvars"])
        if obs and obs[0]["cmdline_found"] and sorted(c.lower() for c in obs[0]["control_cvars"]) != sorted(c.lower() for c in CONTROL_CVARS):
            void.append("CONTROL misconfigured: the observer has %s, not exactly %s" % (obs[0]["control_cvars"], list(CONTROL_CVARS)))
        if srcheck["repeated_rep_lines"] > 0:
            void.append("CONTROL values not in effect: the observer log has %d newer-standing-report samples (ReportTimeSamples 1)" % srcheck["repeated_rep_lines"])
    else:
        for sc in scans:
            if sc["control_cvars"]:
                void.append("%s has old-value CVars %s on a JUDGED run (a gameplay CVar at launch, C0.6)" % (sc["client"], sc["control_cvars"]))
        if stood and srcheck["repeated_rep_lines"] == 0 and not historical:
            void.append("the compiled default ReportTimeSamples 1 is not in effect on the observer (no newer-standing-report sample although the sender stood %.1f s)" % srcheck["sender_longest_idle_s"])
    return void, inc


INPUT_EVENTS = ("KEY_DOWN", "KEY_UP", "MOUSE", "CLICK")


def post_window_inputs(block, keys):
    """P78 (ruling Q-B33-1 condition 4): the drive input rows inside a COMPLETE block's frozen post window END < t <= END + BLOCK_POST_S.
    Any such row is input for what the drive did next (the next block, an M4 return), whose motion the window would judge as this block's."""
    n, a, b, c = block
    if not c:
        return []
    return [k for k in keys if b < k[0] <= b + BLOCK_POST_S + 1e-9]


def contamination_note(name, block, hits):
    n, a, b, c = block
    first = min(hits)
    return ("P78 contamination: the %s block ending %s holds %d drive input row(s) in its frozen window after its end (first %s %s at END + %.3f s; "
            "window END + %.1f s): INCONCLUSIVE" % (name, utc(b), len(hits), first[1], first[2], first[0] - b, BLOCK_POST_S))


def read_timeline(path):
    """b33_drive.ps1 timeline.csv -> (blocks [(name, t0, t1, complete)], key events [(t, event, detail)])"""
    if not path or not os.path.exists(path):
        return [], []
    blocks, open_b, keys, last = [], {}, [], None
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            try:
                t = int(row["utc_ms"]) / 1000.0
            except (KeyError, ValueError):
                continue
            last = t
            ev, det = row.get("event", ""), row.get("detail", "")
            if ev == "BLOCK_BEGIN":
                open_b[det] = t
            elif ev == "BLOCK_END" and det in open_b:
                blocks.append((det, open_b.pop(det), t, True))
            elif ev in INPUT_EVENTS:     # v3.1k (P78): MOUSE and CLICK rows are drive input too (the Space check reads only "SPACE" rows)
                keys.append((t, ev, det))
    for det, t0 in open_b.items():   # a block that never ended (an abort): to the drive's last row, INCOMPLETE
        blocks.append((det, t0, last if last is not None else t0, False))
    return blocks, keys


def read_frames(frames_dir):
    idx = os.path.join(frames_dir, "index.csv") if frames_dir else None
    if not idx or not os.path.exists(idx):
        return []
    out = []
    with open(idx, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            try:
                out.append((int(row["utc_ms"]) / 1000.0, row["file"]))
            except (KeyError, ValueError):
                continue
    return out


def stitch(sender_tuples, viewer_tuples, ranges):
    """the scenario's sender samples (index ranges, time order) and the viewer samples whose truth time t - delay lies INSIDE one range,
    so the analyser never interpolates across the gap between two blocks (exactly the registered analyse() arithmetic, nothing dropped inside)"""
    s, wins = [], []
    for k0, k1 in ranges:
        part = sender_tuples[k0:k1 + 1]
        s.extend(part)
        wins.append((part[0][0], part[-1][0]))
    v = [r for r in viewer_tuples if any(a <= r[0] - r[4] <= b for a, b in wins)]
    return s, v, wins


def timing_gate(rep):
    why = []
    for side in ("sender", "viewer"):
        b = rep[side + "_backlog_ms"]
        if b.get("n", 0) == 0 or b["p95"] > GATE_BACKLOG_P95_MS:
            why.append("%s backlog p95 %s ms > %.0f" % (side, "%.1f" % b["p95"] if b.get("n") else "n/a", GATE_BACKLOG_P95_MS))
    vl = rep["viewer_lag_ms"]
    if vl.get("n", 0) and vl["p95"] > GATE_VIEWER_LAG_P95_MS:
        why.append("viewer file lag p95 %.1f ms > %.0f" % (vl["p95"], GATE_VIEWER_LAG_P95_MS))
    ll = rep["link_latency_ms"]
    if ll.get("n", 0) < GATE_LINK_MIN_N:
        why.append("cross-log check has %d samples < %d" % (ll.get("n", 0), GATE_LINK_MIN_N))
    else:
        if rep["link_causality_violations_lt_minus10ms"] > 0:
            why.append("%d causality violations (viewer received a position before the sender sent it)" % rep["link_causality_violations_lt_minus10ms"])
        if ll["p95"] > GATE_LINK_P95_MS:
            why.append("cross-log latency p95 %.0f ms > %.0f" % (ll["p95"], GATE_LINK_P95_MS))
    for side in ("sender", "viewer"):
        x = rep[side + "_lag_ms"]
        if x.get("n", 0) and x["p95"] > GATE_RAW_LAG_P95_MS:
            why.append("raw %s file lag p95 %.1f ms > %.0f (the registered analyser's stamps)" % (side, x["p95"], GATE_RAW_LAG_P95_MS))
    return why


def bar_violations(r, who):
    viol = []
    if r["air_p95_abs"] is not None and r["air_p95_abs"] > AIR_BAR:
        viol.append("%s: air p95 %.2f > %.1f" % (who, r["air_p95_abs"], AIR_BAR))
    if r["land_p95_abs"] is not None and r["land_p95_abs"] > LAND_BAR:
        viol.append("%s: landing p95 %.2f > %.1f" % (who, r["land_p95_abs"], LAND_BAR))
    sm = r.get("settle_min_gap")
    if sm is not None and sm < SINK_BAR:
        viol.append("%s: sinking: settled gap %.2f < %.1f" % (who, sm, SINK_BAR))
    if r["viewer_samples"] > 0 and r["viewer_recv_air_labels"] == 0:
        viol.append("%s: viewer received no air label" % who)
    return viol


def missing_obs(r, who, min_episodes):
    miss = []
    if r["air_episodes_x3"] < min_episodes:
        miss.append("%s: air_episodes_x3 %d < %d" % (who, r["air_episodes_x3"], min_episodes))
    for k in ("n_air", "n_land", "settle_n"):
        if r.get(k, 0) == 0:
            miss.append("%s: %s == 0" % (who, k))
    return miss


ORDER = {"PASS": 0, "INCONCLUSIVE": 1, "FAIL": 2, "VOID": 3}


def worse(a, b):
    return a if ORDER[a] >= ORDER[b] else b


def registered_with_settle(r_reg, sender, viewer):
    """the registered analyser computes no settle numbers; its sinking test is W2 D4's arithmetic on the SAME raw-stamp tuples (every registered
    number unchanged)"""
    rw = W.analyse(sender, viewer, 0.0)
    r = dict(r_reg)
    r["settle_n"], r["settle_min_gap"] = rw["settle_n"], rw["settle_min_gap"]
    return r


# ---------------- v3.1k P82: RING EVIDENCE (transport ring, candidate r16reh18; design TRANSPORT_RING_DESIGN_T1_v1 0a710c29 section 4.3).
# DESCRIPTIVE ONLY: never a criterion, never a bar, never a window; the verdict algebra above does not read it. It is computed after the
# scenario's verdict inputs and any error in it is recorded, not raised.
RING_TRAIL = re.compile(r"WLREMOTE trail fig=(\S+) p=\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\) age=(-?[\d.]+)ms k=(\d+)/(\d+) ins=([01]) n=(\d+)")
RING_REP = re.compile(r"WLREMOTE rep fig=(\S+) p=\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\) age=(-?[\d.]+)ms")
RING_SEND = re.compile(r"WLREMOTE send soles=\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)")
RING_POS_TOL = 0.11        # both logs print one decimal of the same float; a last-digit flip is tolerated
RING_MATCH_LATE_S = 3.0    # a report is looked for in the viewer's samples up to this long after the sender sent it (the ring keeps 2 s)
RING_STAND_UU = 0.05       # a sender report at the previous report's position (standing) is not counted for coverage


def ring_lines(ctx):
    """(sender sends [(t, x, y, z)], viewer samples [(t, x, y, z, kind)] for the figure (rep lines + trail ins=1 lines), trail lines [dict])"""
    if "_ring" in ctx:
        return ctx["_ring"]
    fig = ctx["fig"]
    sends, vs, trail = [], [], []
    for line in ctx["sender_lines"]:
        m = RING_SEND.search(line)
        if m:
            t = W.stamp(line)
            if t is not None:
                sends.append((t, float(m.group(1)), float(m.group(2)), float(m.group(3))))
    for line in ctx["viewer_lines"]:
        if ("fig=" + fig + " ") not in line:
            continue
        t = W.stamp(line)
        if t is None:
            continue
        m = RING_TRAIL.search(line)
        if m:
            d = {"t": t, "x": float(m.group(2)), "y": float(m.group(3)), "z": float(m.group(4)), "age_s": float(m.group(5)) / 1000.0,
                 "k": int(m.group(6)), "n": int(m.group(7)), "ins": int(m.group(8)), "samples": int(m.group(9))}
            trail.append(d)
            if d["ins"] == 1:
                vs.append((t, d["x"], d["y"], d["z"], "trail"))
            continue
        m = RING_REP.search(line)
        if m:
            vs.append((t, float(m.group(2)), float(m.group(3)), float(m.group(4)), "rep"))
    vs.sort(key=lambda r: r[0])
    ctx["_ring"] = (sends, vs, trail)
    return ctx["_ring"]


def ring_coverage(sends, vs, a, b):
    """the MOVING sender reports sent in [a, b] and how many reached the viewer as a stored sample (rep or trail ins=1), matched in order by
    position (RING_POS_TOL) within RING_MATCH_LATE_S after sending"""
    moving, prev = [], None
    for r in sends:
        if prev is not None and all(abs(r[i] - prev[i]) <= RING_STAND_UU for i in (1, 2, 3)):
            prev = r
            continue
        prev = r
        if a <= r[0] <= b:
            moving.append(r)
    ts = [v[0] for v in vs]
    import bisect as _b
    j0, got = 0, {"rep": 0, "trail": 0}
    for r in moving:
        j = max(j0, _b.bisect_left(ts, r[0] - 0.05))
        hit = None
        while j < len(vs) and vs[j][0] <= r[0] + RING_MATCH_LATE_S:
            v = vs[j]
            if all(abs(v[i] - r[i]) <= RING_POS_TOL for i in (1, 2, 3)):
                hit = j
                break
            j += 1
        if hit is not None:
            got[vs[hit][4]] += 1
            j0 = hit + 1
    n = len(moving)
    return {"moving_reports": n, "reached_by_rep": got["rep"], "reached_by_trail": got["trail"],
            "coverage_pct": round(100.0 * (got["rep"] + got["trail"]) / n, 2) if n else None}


def settle_samples(sender, viewer):
    """W2 D4's settle arithmetic (motion_diag_w2.analyse, the same lines), returning every settled sample's (truth time, gap) instead of only
    the minimum; run on the REGISTERED tuples it reproduces the judge's registered sinking test"""
    if len(sender) < 2:
        return []
    import bisect as _b
    ts = [x[0] for x in sender]
    land_after, last_land = [None] * len(sender), None
    for i, x in enumerate(sender):
        if x[1] in W.AIR:
            last_land = None
        elif i > 0 and sender[i - 1][1] in W.AIR:
            last_land = x[0]
        land_after[i] = None if x[1] in W.AIR else last_land
    out = []
    for (t, fig, mot, z, d) in viewer:
        tt = t - d
        if tt < ts[0] or tt > ts[-1]:
            continue
        j = min(_b.bisect_right(ts, tt) - 1, len(ts) - 2)
        a, b = sender[j], sender[j + 1]
        f = (tt - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 0.0
        gap = z - (a[2] + (b[2] - a[2]) * f)
        if a[1] in W.AIR or b[1] in W.AIR:
            continue
        if land_after[j] is not None and tt - land_after[j] <= 0.5:
            continue
        if land_after[j] is not None and tt - land_after[j] > W.SETTLE_FROM_S:
            out.append((tt, gap))
    return out


def ring_evidence(ctx, wins, ranges, settle_min_expected):
    sends, vs, trail = ring_lines(ctx)
    blocks = []
    for (a, b) in wins:
        tl = [d for d in trail if a <= d["t"] - d["age_s"] <= b]
        cov = ring_coverage(sends, vs, a, b)
        blocks.append({"window_utc": (utc(a), utc(b)), "trail_inserted": sum(1 for d in tl if d["ins"] == 1),
                       "trail_repeats_dropped": sum(1 for d in tl if d["ins"] == 0),
                       "max_k": max([d["k"] for d in tl], default=0), "max_n": max([d["n"] for d in tl], default=0), **cov})
    st = []
    for rg in ranges:          # v3.1 Q-B33-2: per block, like the bar
        s1, v1, _ = stitch(ctx["sender_reg"], ctx["viewer_reg"], [rg])
        st += settle_samples(s1, v1)
    gaps = sorted(g for (_, g) in st)
    tot_mov = sum(x["moving_reports"] for x in blocks)
    tot_hit = sum(x["reached_by_rep"] + x["reached_by_trail"] for x in blocks)
    ev = {"descriptive_only": True, "trail_lines_in_log": len(trail), "blocks": blocks,
          "coverage_pct": round(100.0 * tot_hit / tot_mov, 2) if tot_mov else None,
          "settle": {"n": len(gaps), "min": gaps[0] if gaps else None, "p01": W.pct(gaps, 0.01) if gaps else None,
                     "p05": W.pct(gaps, 0.05) if gaps else None, "n_below_minus1": sum(1 for g in gaps if g < -1.0),
                     "n_below_minus2": sum(1 for g in gaps if g < -2.0),
                     "lowest": [(utc(t), round(g, 3)) for (t, g) in sorted(st, key=lambda r: r[1])[:5]],
                     "matches_registered_min": (settle_min_expected is None and not gaps) or
                                               (bool(gaps) and settle_min_expected is not None and abs(gaps[0] - settle_min_expected) < 1e-9)}}
    return ev


def fmt_ring(ev):
    if not ev:
        return []
    if "error" in ev:
        return ["RING EVIDENCE (descriptive): not computed: %s" % ev["error"]]
    o = ["RING EVIDENCE (v3.1k P82; DESCRIPTIVE ONLY, never a criterion): trail lines in the viewer log %d; coverage of moving sender reports %s %%"
         % (ev["trail_lines_in_log"], ev["coverage_pct"])]
    for k, x in enumerate(ev["blocks"], 1):
        o.append("  window %d %s..%s: trail inserted (ins=1) %d, repeats dropped (ins=0) %d, max k/n %d/%d; moving reports %d, reached by rep %d + trail %d = %s %%"
                 % (k, x["window_utc"][0], x["window_utc"][1], x["trail_inserted"], x["trail_repeats_dropped"], x["max_k"], x["max_n"],
                    x["moving_reports"], x["reached_by_rep"], x["reached_by_trail"], x["coverage_pct"]))
    st = ev["settle"]
    o.append("  settle residuals (registered tuples, W2 D4 arithmetic, every settled sample): n %d, min %s, p01 %s, p05 %s, < -1.0: %d, < -2.0: %d; lowest %s; equals the judge's min: %s"
             % (st["n"], "%.3f" % st["min"] if st["min"] is not None else "-", "%.3f" % st["p01"] if st["p01"] is not None else "-",
                "%.3f" % st["p05"] if st["p05"] is not None else "-", st["n_below_minus1"], st["n_below_minus2"], st["lowest"], st["matches_registered_min"]))
    return o


def ring_compare(run_ring, run_plain, args):
    """two runs judged read-only as usual; their RING EVIDENCE side by side (descriptive)"""
    reps = [judge_run(run_ring, args), judge_run(run_plain, args)]
    o = ["RING COMPARE (v3.1k P82; DESCRIPTIVE ONLY: no verdict, bar or window is read from or changed by this table)",
         "ring run:  %s  RESULT %s" % (run_ring, reps[0]["result"]), "plain run: %s  RESULT %s" % (run_plain, reps[1]["result"]),
         "%-10s | %-5s | %8s | %9s | %7s | %6s | %8s | %8s | %6s | %6s" % ("scenario", "run", "coverage", "trail ins", "repeats", "settle", "min", "p05", "< -1", "< -2")]
    for sc in ("STANDING", "WALKING", "RUNNING", "M4"):
        for tag, r in (("ring", reps[0]), ("plain", reps[1])):
            ev = (r.get("scenarios", {}).get(sc) or {}).get("ring") or {}
            st = ev.get("settle") or {}
            bl = ev.get("blocks") or []
            o.append("%-10s | %-5s | %8s | %9d | %7d | %6s | %8s | %8s | %6s | %6s" % (
                sc, tag, ev.get("coverage_pct"), sum(x["trail_inserted"] for x in bl), sum(x["trail_repeats_dropped"] for x in bl), st.get("n"),
                "%.3f" % st["min"] if st.get("min") is not None else "-", "%.3f" % st["p05"] if st.get("p05") is not None else "-",
                st.get("n_below_minus1"), st.get("n_below_minus2")))
    return "\n".join(o), reps


def settle_per_block(sender_tuples, viewer_tuples, ranges):
    """v3.1 Q-B33-2 (392923 (b)): the W2 D4 sinking arithmetic run on EACH block range on its own (motion_diag_w2.analyse, unmodified, on
    that block's stitched tuples), so land_after never carries a touchdown across a block boundary. -> (settle_n summed, settle_min_gap over
    the blocks, per-block list)"""
    n, mins, per = 0, [], []
    for rg in ranges:
        s1, v1, w1 = stitch(sender_tuples, viewer_tuples, [rg])
        if len(s1) < 2:
            per.append({"range": rg, "settle_n": 0, "settle_min_gap": None})
            continue
        r = W.analyse(s1, v1, 0.0)
        n += r["settle_n"]
        if r["settle_min_gap"] is not None:
            mins.append(r["settle_min_gap"])
        per.append({"range": rg, "window_utc": (utc(w1[0][0]), utc(w1[0][1])), "settle_n": r["settle_n"], "settle_min_gap": r["settle_min_gap"]})
    return n, (min(mins) if mins else None), per


def judge_scenario(name, ranges, ctx, extra_missing, frames_needed, min_episodes):
    """one scenario over its drive-block sample ranges, in the v3 order: registered bars -> W2 bars -> missing -> timing gate -> PASS"""
    out = {"scenario": name, "ranges": ranges}
    if not ranges:
        out.update(verdict="INCONCLUSIVE", why=["no drive block of this scenario"] + list(extra_missing))
        return out
    s_w, v_w, wins_w = stitch(ctx["sender_w2"], ctx["viewer_w2"], ranges)
    s_r, v_r, wins_r = stitch(ctx["sender_reg"], ctx["viewer_reg"], ranges)
    r_w = W.analyse(s_w, v_w, 0.0)
    r_r = MD.analyse(s_r, v_r, 0.0)
    out["registered"] = r_r
    out["w2"] = r_w
    # v3.1 Q-B33-2: the sinking BAR reads the per-block numbers (registered tuples and W2 tuples); the analysers' dicts above stay unedited
    rn, rm, rper = settle_per_block(ctx["sender_reg"], ctx["viewer_reg"], ranges)
    wn, wm, wper = settle_per_block(ctx["sender_w2"], ctx["viewer_w2"], ranges)
    r_rs = dict(r_r)
    r_rs["settle_n"], r_rs["settle_min_gap"] = rn, rm
    r_wb = dict(r_w)
    r_wb["settle_n"], r_wb["settle_min_gap"] = wn, wm
    out["registered_settle"] = {"settle_n": rn, "settle_min_gap": rm, "per_block": True}
    out["settle_per_block"] = {"registered": rper, "w2": wper}
    if RING_EVIDENCE:
        try:      # v3.1 P82: descriptive; never read by the verdict below
            out["ring"] = ring_evidence(ctx, wins_w, ranges, rm)
        except Exception as ex:   # noqa: BLE001 -- the evidence must never change or stop a verdict
            out["ring"] = {"error": "%s: %s" % (type(ex).__name__, ex)}
    t_from, t_to = wins_w[0][0], wins_w[-1][1]
    rep = W.timing_report(ctx["sender_lines"], ctx["viewer_lines"], ctx["fig"], t_from, t_to)
    out["timing"] = rep
    out["window_utc"] = (utc(t_from), utc(t_to))
    frames = [f for f in ctx["frames"] if any(a - 0.5 <= f[0] <= b + 0.5 for a, b in wins_w)]
    out["frames"] = {"n": len(frames), "first": frames[0][1] if frames else None, "last": frames[-1][1] if frames else None}
    reg_viol = bar_violations(r_rs, "registered")
    w2_viol = bar_violations(r_wb, "w2")
    out["registered_bar_violations"], out["w2_bar_violations"] = reg_viol, w2_viol
    if reg_viol or w2_viol:                                          # steps 1-2: FAIL, whatever any gate says (B-3)
        out.update(verdict="FAIL", why=reg_viol + w2_viol)
        return out
    miss = list(extra_missing) + missing_obs(r_rs, "registered", min_episodes) + missing_obs(r_wb, "w2", min_episodes)
    if frames_needed and not frames:
        miss.append("no observer frame inside the scenario's blocks (B7)")
    if miss:                                                         # step 3
        out.update(verdict="INCONCLUSIVE", why=miss)
        return out
    gate = timing_gate(rep)
    if gate:                                                         # step 4: gates only demote a PASS
        out.update(verdict="INCONCLUSIVE", why=["timing: " + g for g in gate])
        return out
    out.update(verdict="PASS", why=[])                               # step 5
    return out


def resolve_inputs(run, args):
    rj = os.path.join(run, "RUN.json") if run else None
    meta = {}
    if rj and os.path.exists(rj):
        with open(rj, encoding="utf-8-sig") as f:
            meta = json.load(f)
    sender_log = args.get("--sender-log") or (meta.get("sender") or {}).get("log")
    viewer_log = args.get("--viewer-log") or (meta.get("observer") or {}).get("log")
    tl = args.get("--timeline")
    if not tl and run:
        c = sorted(t for t in glob.glob(os.path.join(run, "drive_*", "timeline.csv")) if "_DRYRUN_" not in t)   # a dry run's model timeline is never data
        tl = c if c else None
    elif tl:
        tl = [tl]
    frames = args.get("--frames") or (os.path.join(run, "frames") if run else None)
    return meta, sender_log, viewer_log, tl or [], frames


def detect_fig(viewer_lines, meta, forced):
    if forced:
        return forced
    figs = {}
    for l in viewer_lines:
        m = W.FIG.search(l)
        if m:
            figs[m.group(1)] = figs.get(m.group(1), 0) + 1
    if len(figs) == 1:
        return next(iter(figs))
    ident = ((meta.get("sender") or {}).get("identity") or "").lower()
    if ident and "usr_" + ident in figs:
        return "usr_" + ident
    raise SystemExit("cannot tell the sender's figure in the viewer log (%s); pass --fig" % figs)


def block_ranges(sends, windows):
    """sender sample index ranges whose (game-clock, wall-clock) time lies in each [t0, t1] window"""
    ranges = []
    for (t0, t1) in windows:
        ks = [s["k"] for s in sends if t0 <= s["t"] <= t1]
        if ks:
            ranges.append((min(ks), max(ks)))
    return ranges


def judge_run(run, args):
    """judge one run; v3.1: a VOID run is still analysed (R7-08): its per-scenario verdicts stay in the report, the RESULT is VOID"""
    report = _judge_run(run, args)
    void = report.pop("_void", [])
    if void:
        report["analysis_result_if_not_void"] = report.get("result")
        report["analysis_why_if_not_void"] = report.get("result_why", [])
        report["result"], report["result_why"] = "VOID", void
    return report


def _judge_run(run, args):
    historical = "--historical" in args
    for flag in ("--allow-switches", "--allow-launch-cmds"):
        if flag in args and not historical:
            raise SystemExit("%s is for --historical re-analyses only (R7-03): a judged run is held to the prereg lists" % flag)
    meta, sender_log, viewer_log, timelines, frames_dir = resolve_inputs(run, args)
    if not sender_log or not viewer_log or not os.path.exists(sender_log) or not os.path.exists(viewer_log):
        raise SystemExit("sender/viewer log not found (RUN.json sender.log/observer.log or --sender-log/--viewer-log)")
    frames_needed = "--no-require-frames" not in args
    cand_file = args.get("--candidate-file") or CANDIDATE_FILE
    cand = load_candidate(cand_file)
    override = args.get("--expect-exe")
    expect_exe = (override or cand.get("game_exe_sha256") or "").lower()
    sl, vl = read_lines(sender_log), read_lines(viewer_log)
    fig = detect_fig(vl, meta, args.get("--fig"))
    res, sends = SL.slice_run(sl)
    sender_w2 = [(s["t"], s["motion"], s["z"], s["vz"]) for s in sends]
    sender_reg = MD.parse_sender(sl)
    if len(sender_reg) != len(sender_w2):
        raise SystemExit("internal: registered and W2 sender sample counts differ (%d vs %d)" % (len(sender_reg), len(sender_w2)))
    vfig = [l for l in vl if ("fig=" + fig + " ") in l]
    ctx = {"sender_lines": sl, "viewer_lines": vl, "fig": fig, "sender_w2": sender_w2, "sender_reg": sender_reg,
           "viewer_w2": W.parse_viewer_w2(vl, fig_filter=fig), "viewer_reg": MD.parse_viewer(vfig), "frames": read_frames(frames_dir)}
    blocks, keys = [], []
    for tl in timelines:
        b, k = read_timeline(tl)
        blocks += b
        keys += k
    report = {"tool": "b33_judge.py v3.1 (W2DEV)", "run": run, "verdict_analyser": "both (registered = the bar; W2 may only add FAIL/INCONCLUSIVE)",
              "overrides": sorted(k for k in args if k in OVERRIDE_FLAGS),
              "frames_required": frames_needed, "expected_exe": expect_exe,
              "candidate": {"file": cand_file, "file_sha256": sha256(cand_file) if os.path.exists(cand_file) else None, "status": cand.get("status"),
                            "label": cand.get("label"), "commit": cand.get("commit"), "game_exe_sha256": cand.get("game_exe_sha256"),
                            "boot_exe_sha256": cand.get("boot_exe_sha256"), "expect_exe_override": override},
              "inputs": {"sender_log": sender_log, "viewer_log": viewer_log, "timelines": timelines, "frames_dir": frames_dir, "fig": fig},
              "hashes": {}, "meta": {k: meta.get(k) for k in ("exe_sha256", "commit", "ram_free_gb_at_start", "label", "run_id") if k in meta}}
    for name, p in [("sender_log", sender_log), ("viewer_log", viewer_log)] + [("timeline_%d" % n, t) for n, t in enumerate(timelines)]:
        report["hashes"][name] = sha256(p)
    for name in ("b33_analyser/motion_diag.py", "b33_analyser/motion_diag_w2.py", "b33_slicer.py", "b33_judge.py"):
        report["hashes"][name] = sha256(os.path.join(HERE, name))
    report["registered_analyser_identical"] = report["hashes"]["b33_analyser/motion_diag.py"] == REGISTERED_SHA256
    if not report["registered_analyser_identical"]:
        raise SystemExit("b33_analyser/motion_diag.py is not byte-identical to the registered analyser (%s)" % REGISTERED_SHA256)
    report["clients"] = {k: (meta.get(k) or {}).get("pids") for k in ("sender", "observer")}
    report["slicer"] = {"counts": res["counts"], "unclassified": res["unclassified"], "jumps": res["jumps"]}
    report["blocks"] = [{"name": n, "begin_utc": utc(a), "end_utc": utc(b), "complete": c} for (n, a, b, c) in blocks]
    # ---- run-level VOID checks
    void = []
    report["historical"] = historical
    if historical and not args.get("--expect-exe"):
        raise SystemExit("--historical needs an explicit --expect-exe (a re-analysis of an older exe, never SC3 data)")
    exe = (meta.get("exe_sha256") or (meta.get("sha256") if historical else "") or "").lower()   # b33a's older launcher wrote "sha256"
    report["meta"]["exe_sha256"] = exe or None
    if not override and candidate_pending(cand):
        void.append("CANDIDATE.json status is '%s', not READY (%s): no run is judged against a pending candidate" % (cand.get("status"), cand_file))
    if exe != expect_exe:
        void.append("exe sha256 %s is not the expected candidate %s (%s; R4-13)" % (exe or "missing", expect_exe or "none",
                                                                                   "--expect-exe override" if override else "CANDIDATE.json"))
    if not override:
        want_boot = (cand.get("boot_exe_sha256") or "").lower()
        boot = (meta.get("boot_sha256") or "").lower()
        if want_boot and boot != want_boot:
            void.append("boot exe sha256 %s is not CANDIDATE.json's %s" % (boot or "missing", want_boot))
        want_commit, got_commit = (cand.get("commit") or "").lower(), (meta.get("commit") or "").lower()
        if want_commit and not (got_commit and want_commit.startswith(got_commit)):
            void.append("RUN.json commit %s is not CANDIDATE.json's %s" % (got_commit or "missing", want_commit))
        rc = meta.get("candidate")
        if isinstance(rc, dict) and rc.get("default") is False:
            void.append("launched with a non-default candidate file %s (b33_launch.ps1 -CandidateFile is for tests only)" % rc.get("file"))
    sh, vh = dev_lines(sl), dev_lines(vl)
    report["void_lines_sender"], report["void_lines_observer"] = sh, vh
    if sh:
        void.append("%d wl.Dev/WLDEV line(s) in the SENDER log" % len(sh))
    if vh:
        void.append("%d wl.Dev/WLDEV line(s) in the OBSERVER log (R4-12)" % len(vh))
    report["teleports"] = res["teleports"]
    if res["teleports"]:
        void.append("%d teleport(s) in the sender log" % len(res["teleports"]))
    role = (meta.get("role") or ("CONTROL" if meta.get("control") else "JUDGED")).upper()
    report["role"] = role
    disc = meta.get("disclosed") or {}
    disclosed_render = list(disc.get("render_cvars") or [])
    allow = [x.strip() for x in (args.get("--allow-launch-cmds") or "").split(";") if x.strip()]
    if historical:
        switches_ok = list(disc.get("launch_switches") or DEFAULT_SWITCHES) + [x.strip() for x in (args.get("--allow-switches") or "").split(";") if x.strip()]
    else:
        switches_ok = list(PREREG_SWITCHES)          # R7-03: the judge's own prereg list; RUN.json's is printed only
        if meta.get("prereg_launch") is not True:
            void.append("RUN.json prereg_launch is %s: the launch is not the PREREG B33 v3.1 launch (b33_launch.ps1 printed a NOTE; R7-03)" % (
                json.dumps(meta.get("prereg_launch"))))
    report["switches_disclosed"] = switches_ok
    report["switches_run_json"] = list(disc.get("launch_switches") or [])
    scans = [launch_scan(sl, "sender", disclosed_render, allow, switches_ok), launch_scan(vl, "observer", disclosed_render, allow, switches_ok)]
    report["launch"] = scans
    srcheck = standing_report_check(vl, fig, sends)
    report["report_time_samples_check"] = srcheck
    lvoid, linc = launch_verdict(role, scans, srcheck, historical)
    void += lvoid
    echoes = {"sender": echo_scan(sl), "observer": echo_scan(vl)}      # R7-06
    report["echoes"] = {k: [(n, name, val) for (n, name, val) in v] for k, v in echoes.items()}
    void += echo_verdict(role, echoes)
    close_files = [p for p in [os.path.join(run, "RUN.json") if run else None, sender_log, viewer_log] + list(timelines) +
                   [os.path.join(frames_dir, "index.csv") if frames_dir else None] if p and os.path.exists(p)]
    report["close_check"], cvoid = close_check(run, close_files, historical)    # R8-05 analog
    void += cvoid
    srv = meta.get("server") or {}
    if not historical:
        # PREREG B33 v3: the judged launch's ExecCmds set is fixed; RUN.json must disclose exactly the prereg rendering command
        if sorted(c.lower() for c in disclosed_render) != sorted(PREREG_RENDER_CVARS):
            void.append("RUN.json disclosed.render_cvars %s is not exactly the prereg's %s" % (disclosed_render, list(PREREG_RENDER_CVARS)))
        for sc in scans:
            void += exec_exact(sc, (meta.get(sc["client"]) or {}).get("identity"), srv.get("port"))
    report["exec_cmds_prereg"] = {"render_cvars": list(PREREG_RENDER_CVARS), "log_period": PREREG_LOG_PERIOD, "checked": not historical}
    report["server"] = {k: srv.get(k) for k in ("prereg", "kind", "repo", "commit", "tree", "archive_files", "archive_file_list_sha256",
                                                "package_lock_identical", "bundle_sha256", "tree_dir", "head")} if srv else None
    if meta.get("prereg_server") is False or srv.get("prereg") is False:
        void.append("NOT-PREREG server (b33_launch.ps1 -ServerTree / -RelaySource): the loopback server is not the pinned relay's own dev-social-server.ts")
    # ---- v3.1: the relay pin and the route pin (explicit slots; PENDING = no run judged)
    rp_file = args.get("--relay-pin-file") or RELAY_PIN_FILE
    rp = load_candidate(rp_file)
    rp_ok = rp.get("status") == "PINNED" and re.fullmatch(r"[0-9a-f]{40}", str(rp.get("commit") or "")) and re.fullmatch(r"[0-9a-f]{40}", str(rp.get("tree") or ""))
    report["relay_pin"] = {"file": rp_file, "file_sha256": sha256(rp_file) if os.path.exists(rp_file) else None, "status": rp.get("status"),
                           "commit": rp.get("commit"), "tree": rp.get("tree")}
    if not historical:
        if not rp_ok:
            void.append("RELAY_PIN.json (%s) is not PINNED with a 40-hex commit and tree (status '%s'): no run is judged against a pending relay pin" % (rp_file, rp.get("status")))
        elif srv.get("commit") != rp.get("commit") or srv.get("tree") != rp.get("tree"):
            void.append("the run's loopback relay %s (tree %s) is not the relay pin %s (tree %s)" % (srv.get("commit"), srv.get("tree"), rp.get("commit"), rp.get("tree")))
    has_m4 = any(n.upper().startswith("M4") for (n, a, b, c) in blocks)
    rt_file = args.get("--route-pin-file") or ROUTE_PIN_FILE
    rt = load_candidate(rt_file)
    rt_ok = rt.get("status") == "PINNED" and re.fullmatch(r"[0-9a-f]{64}", str(rt.get("route_sha256") or ""))
    route_files = [os.path.join(os.path.dirname(t), "route.json") for t in timelines]
    route_shas = [sha256(r) if os.path.exists(r) else None for r in route_files]
    report["route_pin"] = {"file": rt_file, "file_sha256": sha256(rt_file) if os.path.exists(rt_file) else None, "status": rt.get("status"),
                           "route_sha256": rt.get("route_sha256"), "drive_routes": list(zip(route_files, route_shas)), "checked": bool(has_m4 and not historical)}
    if has_m4 and not historical:
        if not rt_ok:
            void.append("ROUTE_PIN.json (%s) is not PINNED with a 64-hex route_sha256 (status '%s'): no run with M4 blocks is judged against a pending route pin" % (rt_file, rt.get("status")))
        elif not route_shas or any(x != rt.get("route_sha256") for x in route_shas):
            void.append("the drive's route %s is not the pinned route %s" % (route_shas, rt.get("route_sha256")))
    # v3.1a 7a7faf P2-4: the RAM record (descriptive; never a verdict): RUN.json's lease gate and start readings, RAM_LOG.json's in-run guard
    ram_log = os.path.join(run, "RAM_LOG.json") if run else None
    ram_in = None
    if ram_log and os.path.exists(ram_log):
        try:
            with open(ram_log, encoding="utf-8-sig") as f:
                ram_in = json.load(f)
        except (OSError, ValueError) as e:
            ram_in = {"unreadable": str(e)}
    report["ram"] = {"lease_gb": meta.get("lease_gb"), "lease_gate_enforced_gb": 5.0, "ram_free_gb_at_start": meta.get("ram_free_gb_at_start"),
                     "ram_available_mb_at_start": meta.get("ram_available_mb_at_start"), "in_run_guard_gb": meta.get("in_run_guard_gb"),
                     "in_run": ram_in, "descriptive_only": True}
    report["launch_inconclusive"] = linc
    if void:
        report["_void"] = void          # R7-08: no early return; judge_run() sets the RESULT to VOID after the analysis
    # ---- scenarios = the drive's blocks (B-4)
    scen = {}
    if not blocks:
        for name in ("STANDING", "WALKING", "RUNNING", "M4"):
            scen[name] = {"scenario": name, "verdict": "INCONCLUSIVE", "why": ["no drive timeline: the scenarios are the drive's blocks (B-4)"]}
        report["scenarios"] = scen
        report["result"], report["result_why"] = "INCONCLUSIVE", ["no drive timeline"] + linc
        return report
    for bname, cls in BLOCK_SCENARIO.items():
        bl = [(a, b, c) for (n, a, b, c) in blocks if n == bname]
        windows = [(a, b + BLOCK_POST_S) for (a, b, c) in bl]
        ranges = block_ranges(sends, windows)
        inside = [d for d in res["jumps"] if any(a <= d["t_takeoff"] <= b for (a, b) in windows)]
        counted = [d for d in inside if d["class"] == cls]
        others = [d for d in inside if d["class"] != cls]
        extra = []
        if len(counted) < MIN_JUMPS:
            extra.append("counted %s jumps %d < %d" % (cls, len(counted), MIN_JUMPS))
        if any(not c for (a, b, c) in bl):
            extra.append("a %s block never ended (the drive aborted): INCOMPLETE" % bname)
        contam = []
        for (a, b, c) in bl:
            hits = post_window_inputs((bname, a, b, c), keys)
            if hits:
                contam.append({"block_end": utc(b), "inputs": len(hits), "first_after_end_s": round(min(hits)[0] - b, 3)})
                extra.append(contamination_note(bname, (bname, a, b, c), hits))
        d = judge_scenario(cls, ranges, ctx, extra, frames_needed, MIN_EPISODES)
        d["post_window_inputs"] = contam
        d["counted_jumps"] = len(counted)
        d["other_jumps_in_block"] = [{"takeoff": utc(o["stamp_takeoff"]), "class": o["class"], "reason": o["reason"]} for o in others]
        d["blocks"] = len(bl)
        scen[cls] = d
    # ---- M4 (B-4, B-6, B-7): the M4_<n> blocks, under the bars
    m4b = [(n, a, b, c) for (n, a, b, c) in blocks if n.upper().startswith("M4")]
    windows = [(a, b + BLOCK_POST_S) for (n, a, b, c) in m4b]
    falls = []
    for f in res["falls"]:
        f2 = dict(f)
        f2["in_m4_block"] = any(a <= f["t_takeoff"] <= b for (a, b) in windows)
        falls.append(f2)
    cand = [f for f in falls if f["in_m4_block"]]
    qual = [f for f in cand if f["qualifies"]]
    # Q-M2c-5 (b): EVERY attempt (M4_<n> block) listed with its drop; the bars judge EVERY qualifying fall's block, the others are excluded
    # ONLY by the height rule
    attempts, judged_windows, m4_contam = [], [], []
    for k, (n, a, b, c) in enumerate(m4b):
        w = windows[k]
        fl = [f for f in falls if w[0] <= f["t_takeoff"] <= w[1]]
        q = [f for f in fl if f["qualifies"]]
        hits = post_window_inputs((n, a, b, c), keys)
        attempts.append({"block": n, "complete": bool(c), "falls": len(fl), "drops": [f.get("drop") for f in fl], "qualifying": len(q),
                         "judged_under_bars": bool(q), "post_window_inputs": len(hits),
                         "excluded_by": None if q else ("no walk-off fall in the block" if not fl else "the height rule (drop < %.1f)" % 100.0)})
        if q:
            judged_windows.append(w)
            if hits:
                m4_contam.append(contamination_note(n, (n, a, b, c), hits))
    space = [k for k in keys if "SPACE" in k[2].upper() and any(a <= k[0] <= b for (_, a, b, _) in m4b)]
    extra = []
    if space:
        extra.append("the drive pressed Space %d time(s) inside an M4 block (not a walked-only scenario)" % len(space))
    if len(qual) < M4_MIN_FALLS:
        extra.append("qualifying walked falls %d < %d" % (len(qual), M4_MIN_FALLS))
    if len(m4b) != M4_ATTEMPTS:
        extra.append("M4 attempts %d, not the pre-stated %d (Q-M2c-5: exactly %d per counted run, no selection)" % (len(m4b), M4_ATTEMPTS, M4_ATTEMPTS))
    if any(not c for (n, a, b, c) in m4b):
        extra.append("an M4 block never ended (the drive aborted): INCOMPLETE")
    extra += m4_contam     # P78: only a JUDGED attempt's window counts (an attempt excluded by the height rule is not judged)
    d = judge_scenario("M4", block_ranges(sends, judged_windows), ctx, extra, frames_needed, 0)
    d.update({"falls_listed": falls, "candidates": len(cand), "qualifying": len(qual), "space_presses_in_m4": len(space), "timeline_m4_blocks": len(m4b),
              "attempts": attempts, "attempts_pre_stated": M4_ATTEMPTS, "attempts_judged_under_bars": len(judged_windows)})
    scen["M4"] = d
    report["scenarios"] = scen
    vs = [scen[k]["verdict"] for k in ("STANDING", "WALKING", "RUNNING", "M4")]
    report["result"] = "FAIL" if "FAIL" in vs else ("PASS" if all(v == "PASS" for v in vs) else "INCONCLUSIVE")
    if linc:
        report["result_why"] = linc
        if report["result"] == "PASS":
            report["result"] = "INCONCLUSIVE"
    return report


def _s(x):
    if not x.get("n"):
        return "n=0"
    return "n=%d p50 %.1f p95 %.1f max %.1f" % (x["n"], x["p50"], x["p95"], x["max"])


def fmt(rep):
    o = [ALGEBRA, "", "B33 JUDGE REPORT v3 -- DIAGNOSTIC tool, W2DEV, not evidence by itself", "run: %s" % rep["run"],
         "verdict analyser: %s | frames required: %s | expected exe: %s" % (rep["verdict_analyser"], rep["frames_required"], rep["expected_exe"])]
    o.append("CANDIDATE: " + json.dumps(rep.get("candidate")))
    o.append("overrides used (R7-07: pair / --control-vs refuse any): %s" % (rep.get("overrides") or "none"))
    if rep.get("result") == "VOID":
        o.append("*** RUN VOID: %s" % "; ".join(rep.get("result_why", [])))
        o.append("*** R7-08: the run is still analysed below so a bar FAIL stays visible; the per-scenario verdicts of a VOID run are NOT a result")
    o.append("inputs: " + json.dumps(rep["inputs"]))
    o.append("run record: " + json.dumps(rep["meta"]) + " | client pids: " + json.dumps(rep["clients"]))
    for k, v in rep["hashes"].items():
        o.append("sha256 %s %s" % (v, k))
    o.append("registered analyser byte-identical (%s): %s" % (REGISTERED_SHA256[:16], rep["registered_analyser_identical"]))
    if rep.get("historical"):
        o.append("HISTORICAL RE-ANALYSIS (--historical): an older exe; the ReportTimeSamples in-effect check is skipped; never SC3 data")
    o.append("ROLE: %s%s" % (rep.get("role"), " (M1 ruling R-5 must-fail CONTROL: the observer runs the OLD values 30/0/0; never a judged run; expected FAIL)" if rep.get("role") == "CONTROL" else ""))
    o.append("launch switches allowed (%s): %s | RUN.json's list (printed only): %s" % (
        "historical: RUN.json + --allow-switches" if rep.get("historical") else "the judge's PREREG list, R7-03", rep.get("switches_disclosed"),
        rep.get("switches_run_json")))
    ech = rep.get("echoes") or {}
    o.append("console-set echoes (R7-06): sender %s | observer %s" % (
        ["%s = \"%s\" (line %d)" % (nm, v, n) for (n, nm, v) in ech.get("sender", [])], ["%s = \"%s\" (line %d)" % (nm, v, n) for (n, nm, v) in ech.get("observer", [])]))
    cc = rep.get("close_check") or {}
    o.append("close hashes (R8-05 analog): %s" % (("%s sha256 %s; %d file(s) checked" % (cc.get("sums_file"), cc.get("sums_sha256"), len(cc.get("checked") or {})))
                                                   if cc.get("sums_file") else (cc.get("note") or "none")))
    for sc in rep.get("launch", []):
        o.append("launch %s: switches %s | NOT disclosed %s | commands %s | control CVars %s | disclosed render %s | NOT allowed %s | ini wl.* lines %d%s" % (
            sc["client"], sc["switches"], sc["bad_switches"], sc["commands"], sc["control_cvars"], sc["render_cvars"], sc["not_allowed"],
            len(sc["ini_wl_lines"]), "" if sc["cmdline_found"] else " | NO Command Line line"))
    rt = rep.get("report_time_samples_check") or {}
    o.append("ReportTimeSamples in effect on the observer (B-10): %s newer-standing-report samples; the sender's longest stand %.1f s" % (
        rt.get("repeated_rep_lines"), rt.get("sender_longest_idle_s", 0.0)))
    sv = rep.get("server")
    o.append("SERVER: %s" % ("no server record in RUN.json" if not sv else ("PREREG %s commit %s tree %s, %s archived files (list sha256 %s), lockfile identical %s, bundle sha256 %s" % (
        sv.get("kind"), sv.get("commit"), sv.get("tree"), sv.get("archive_files"), sv.get("archive_file_list_sha256"), sv.get("package_lock_identical"), sv.get("bundle_sha256"))
        if sv.get("prereg") else "NOT-PREREG override %s (head %s), bundle sha256 %s" % (sv.get("tree_dir"), sv.get("head"), sv.get("bundle_sha256")))))
    o.append("VOID scan: %d wl.Dev/WLDEV line(s) in the sender log, %d in the observer log, %d teleport(s)" % (
        len(rep.get("void_lines_sender", [])), len(rep.get("void_lines_observer", [])), len(rep.get("teleports", []))))
    for n, l in (rep.get("void_lines_sender", []) + rep.get("void_lines_observer", []))[:20]:
        o.append("  line %d: %s" % (n, l))
    for tp in rep.get("teleports", []):
        o.append("  teleport (%s rule) sample %d: %s -> %s (%.0f uu, %.0f uu/s)" % (tp.get("rule"), tp["k"], tp["from"], tp["to"], tp["dist_uu"], tp["uu_per_s"]))
    o.append("DRIVE BLOCKS: " + ("; ".join("%s %s..%s%s" % (b["name"], b["begin_utc"], b["end_utc"], "" if b["complete"] else " INCOMPLETE") for b in rep.get("blocks", [])) or "none"))
    sc = rep["slicer"]
    o.append("SLICER (counts only): %s; unclassified %d" % (json.dumps(sc["counts"]), sc["unclassified"]))
    for n, d in enumerate(sc["jumps"], 1):
        o.append("  jump %2d %-12s takeoff %s labels %-8s pre %-4s air speed %s rise %s %s" % (
            n, d["class"], utc(d["stamp_takeoff"]), d["labels"], d["pre_label"],
            "%.0f" % d["air_hspeed_med"] if d["air_hspeed_med"] is not None else "-", "%.1f" % d["rise"] if d["rise"] is not None else "-", d["reason"]))
    for name in ("STANDING", "WALKING", "RUNNING", "M4"):
        d = rep.get("scenarios", {}).get(name)
        if d is None:
            continue
        o.append("")
        o.append("=== %s%s: %s %s" % ("[VOID run, not a result] " if rep.get("result") == "VOID" else "", name, d["verdict"],
                                       ("-- " + "; ".join(d.get("why", []))) if d.get("why") else ""))
        if name != "M4" and "counted_jumps" in d:
            o.append("blocks: %d; counted jumps: %s; other jumps inside the blocks (analysed, not counted): %s; sample ranges %s; window %s" % (
                d.get("blocks"), d.get("counted_jumps"), d.get("other_jumps_in_block"), d.get("ranges"), d.get("window_utc")))
        if name == "M4" and "falls_listed" in d:
            o.append("M4 blocks: %d; walk-off falls listed: %d; inside M4 blocks: %d; qualifying (>= 100.0 uu): %d; Space presses in M4: %d" % (
                d["timeline_m4_blocks"], len(d["falls_listed"]), d["candidates"], d["qualifying"], d["space_presses_in_m4"]))
            for at in d.get("attempts", []):
                o.append("  attempt %-6s %s: falls %d, drops %s -> %s" % (
                    at["block"], "complete" if at["complete"] else "INCOMPLETE", at["falls"],
                    ["%.1f" % x if x is not None else "-" for x in at["drops"]],
                    ("JUDGED under the bars" if at["judged_under_bars"] else "excluded by " + at["excluded_by"]) +
                    (" [P78: %d drive input row(s) in its window after its end]" % at["post_window_inputs"] if at.get("post_window_inputs") else "")))
            o.append("  attempts: %d (pre-stated %d); judged under the bars: %d" % (len(d.get("attempts", [])), d.get("attempts_pre_stated", M4_ATTEMPTS), d.get("attempts_judged_under_bars", 0)))
            for n, f in enumerate(d["falls_listed"], 1):
                g = lambda k: ("%.1f" % f[k]) if f.get(k) is not None else "-"
                o.append("  fall %2d at %s in-M4-block %s: start z median %s (n %d) / last %s, landing z %s, drop median %s / last %s; QUALIFYING drop %s -> %s %s" % (
                    n, utc(f["stamp_takeoff"]), f["in_m4_block"], g("start_z_median"), f["start_n"], g("start_z_last"), g("landing_z"),
                    g("drop_median"), g("drop_last"), g("drop"), "QUALIFIES" if f["qualifies"] else "listed, not qualifying", f["note"]))
        for an in ("registered", "w2"):
            if an in d:
                o.append("-- analyser %s output (unedited dict):" % ("motion_diag.py (REGISTERED, raw stamps, the bar)" if an == "registered" else "motion_diag_w2.py (may only add FAIL/INCONCLUSIVE)"))
                for k, v in d[an].items():
                    o.append("   %s: %s" % (k, v))
        if "registered_settle" in d:
            o.append("registered sinking test (W2 D4 arithmetic on the registered tuples), PER BLOCK (Q-B33-2): %s" % d["registered_settle"])
            for k, pb in enumerate(d.get("settle_per_block", {}).get("registered", []), 1):
                o.append("  block %d %s: settle_n %d, settle_min_gap %s" % (k, pb.get("window_utc", "-"), pb["settle_n"],
                                                                            "%.3f" % pb["settle_min_gap"] if pb["settle_min_gap"] is not None else "-"))
            o.append("bar violations: registered %s | w2 %s" % (d["registered_bar_violations"], d["w2_bar_violations"]))
        if "timing" in d:
            t = d["timing"]
            o.append("timing (W2 D3, ms): sender lag %s | viewer lag %s | sender backlog %s | viewer backlog %s | fig correction %s | link latency %s | causality violations %d" % (
                _s(t["sender_lag_ms"]), _s(t["viewer_lag_ms"]), _s(t["sender_backlog_ms"]), _s(t["viewer_backlog_ms"]), _s(t["fig_correction_ms"]),
                _s(t["link_latency_ms"]), t["link_causality_violations_lt_minus10ms"]))
        if "frames" in d:
            o.append("observer frames in the blocks: %d (%s .. %s); SEEN note: to be written by whoever views them (B7)" % (d["frames"]["n"], d["frames"]["first"], d["frames"]["last"]))
        o += fmt_ring(d.get("ring"))
    if rep.get("ram"):
        ra = rep["ram"]
        ri = ra.get("in_run") or {}
        o.append("RAM (descriptive, never a verdict; 7a7faf P2-4): lease_gb %s (enforced gate %.1f); free at start %s GB / available %s MB; in-run guard %s GB: min free %s GB over %s readings, tripped %s" % (
            ra.get("lease_gb"), ra.get("lease_gate_enforced_gb"), ra.get("ram_free_gb_at_start"), ra.get("ram_available_mb_at_start"),
            ra.get("in_run_guard_gb"), ri.get("in_run_min_free_gb", "-"), ri.get("in_run_readings", "-"), ri.get("guard_tripped", "-")))
    o.append("")
    o.append("RESULT: %s %s" % (rep["result"], ("-- " + "; ".join(rep.get("result_why", []))) if rep.get("result_why") else ""))
    if rep.get("result") == "VOID" and "analysis_result_if_not_void" in rep:
        o.append("(R7-08) the analysis without the VOID would read: %s %s -- shown for visibility only; any FAIL here = NOT cleared" % (
            rep["analysis_result_if_not_void"], ("-- " + "; ".join(rep.get("analysis_why_if_not_void") or [])) if rep.get("analysis_why_if_not_void") else ""))
    if rep.get("role") == "CONTROL":
        o.append("CONTROL READING: %s" % ("the control FAILED as expected (clearance needs b33_judge.py --control-vs with both judged runs and the P7a note)" if rep["result"] == "FAIL"
                                          else "the control did NOT fail (%s): the instrument cannot tell the old values from the compiled defaults" % rep["result"]))
    return "\n".join(o)


def _load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


M4_REPLACEABLE = re.compile(r"^qualifying walked falls \d+ < %d$" % M4_MIN_FALLS)
NOT_COUNTED_ROLES = ("SURVEY", "REHEARSAL_NOT_PREREG")
NOT_COUNTED_PREFIXES = ("SURVEY_", "REHEARSAL_NOT_PREREG_")


def m4_replaceable(rep_):
    """v3.1a 7a7faf P2-1 (a): (True, []) only when the run's M4 is INCONCLUSIVE for the 3fab1b cause alone ("fewer than 5 qualifying
    falls"; with 0 qualifying, the "no drive block of this scenario" that follows from it); else (False, the other reasons)"""
    m4 = (rep_.get("scenarios") or {}).get("M4") or {}
    why = list(m4.get("why") or [])
    if m4.get("verdict") != "INCONCLUSIVE" or not any(M4_REPLACEABLE.match(w) for w in why):
        return False, why
    rest = [w for w in why if not M4_REPLACEABLE.match(w)]
    if m4.get("qualifying") == 0:
        rest = [w for w in rest if w != "no drive block of this scenario"]
    return (not rest), rest


def _judged_runs_next_to(run, exe):
    """every JUDGED run folder of this exe in the folder that holds `run` (the record must list them all); v3.1a (7a7faf P2-2): a run that is
    never counted (role SURVEY / REHEARSAL_NOT_PREREG; an older folder named SURVEY_* / REHEARSAL_NOT_PREREG_*, of scenario survey, or with a
    NOT-PREREG server) is not a JUDGED run"""
    root = os.path.dirname(os.path.abspath(run))
    found = []
    try:
        names = sorted(os.listdir(root))
    except OSError:
        return found
    for nm in names:
        rj = os.path.join(root, nm, "RUN.json")
        if not os.path.isfile(rj):
            continue
        try:
            with open(rj, encoding="utf-8-sig") as f:
                meta = json.load(f)
        except (OSError, ValueError):
            continue
        not_counted = (meta.get("role") in NOT_COUNTED_ROLES or nm.upper().startswith(NOT_COUNTED_PREFIXES) or meta.get("scenario") == "survey"
                       or meta.get("prereg_server") is False or (meta.get("server") or {}).get("prereg") is False)
        if meta.get("role") == "JUDGED" and not not_counted and (meta.get("exe_sha256") or "").lower() == (exe or "").lower():
            found.append(os.path.normcase(os.path.abspath(os.path.join(root, nm))))
    return found


def pair(j1, j2):
    """B-6 / B-10 pair = a record of exactly these two counted runs (Q-M2c-5: no hidden run)"""
    return record([j1, j2])


def record(paths):
    """Q-M2c-5 (b) + B-6 / B-10: EVERY counted run of one candidate, in launch order -> PASS / FAIL / INCONCLUSIVE / REFUSED / VOID"""
    reps = [_load(p) for p in paths]
    o = [ALGEBRA, "", "B33 PAIR / RECORD v3.1 (every counted run of the candidate; Q-M2c-5) -- DIAGNOSTIC tool, W2DEV, not evidence by itself"]
    reps.sort(key=lambda r: (r.get("meta") or {}).get("started_utc") or "")
    for n, r in enumerate(reps, 1):
        o.append("run %d: %s (started %s, result %s)" % (n, r["run"], (r.get("meta") or {}).get("started_utc"), r.get("result")))

    def out(result, why=None):
        if why:
            o.append(why)
        o.append("PAIR RESULT: %s" % result)
        return "\n".join(o), result
    roles = [r.get("role") for r in reps]
    if any(x != "JUDGED" for x in roles):
        return out("REFUSED", "PAIR REFUSED: roles %s; a CONTROL run is never paired (B-10)" % (roles,))
    ovs = [(x["run"], x.get("overrides")) for x in reps if x.get("overrides") is None or x.get("overrides")]
    if ovs:
        return out("REFUSED", "PAIR REFUSED (R7-07): judged with overrides or by a judge before v3.1: %s" % ovs)
    exes = {((r.get("meta") or {}).get("exe_sha256") or "").lower() for r in reps}
    if len(exes) != 1 or "" in exes:
        return out("REFUSED", "PAIR REFUSED: the runs are not of ONE exe: %s" % sorted(exes))
    listed = {os.path.normcase(os.path.abspath(r["run"] or "")) for r in reps}
    if len(listed) != len(reps):
        return out("REFUSED", "PAIR REFUSED: a run folder is listed twice")
    hidden = sorted(set(x for r in reps for x in _judged_runs_next_to(r["run"], exes.copy().pop())) - listed)
    if hidden:
        return out("REFUSED", "PAIR REFUSED (Q-M2c-5): JUDGED run(s) of this exe are not listed (no run may be hidden): %s" % hidden)
    if any(r.get("result") == "VOID" for r in reps):
        return out("VOID", "PAIR VOID: run results %s (a VOID run's per-scenario verdicts are never counted, R7-08)" % [r.get("result") for r in reps])
    why = []
    seen = {}
    for r in reps:
        pids = set(x for v in (r.get("clients") or {}).values() for x in (v or []))
        if not pids:
            why.append("client pids missing in %s" % r["run"])
        for q, qp in seen.items():
            if pids & qp:
                why.append("client pids shared by %s and %s (not fresh runs)" % (q, r["run"]))
        seen[r["run"]] = pids
    names = ("STANDING", "WALKING", "RUNNING", "M4")
    verd = [{nm: (r.get("scenarios") or {}).get(nm, {}).get("verdict", r.get("result")) for nm in names} for r in reps]
    for nm in names:
        vs = [v[nm] for v in verd]
        comb = "FAIL" if "FAIL" in vs else ("PASS" if sum(1 for x in vs if x == "PASS") >= 2 and len(vs) == 2 and all(x == "PASS" for x in vs) else
                                            ("PASS" if len(vs) > 2 and sum(1 for x in vs if x == "PASS") >= 2 else "INCONCLUSIVE"))
        o.append("%s: %s -> %s" % (nm, ", ".join("run%d %s" % (k + 1, x) for k, x in enumerate(vs)), comb))
    if any("FAIL" in v.values() for v in verd):
        return out("FAIL", "a FAIL in a counted run: the candidate is not cleared, no retry (B8; 8805ec; Q-M2c-5)")
    if why:
        return out("INCONCLUSIVE", "PAIR NOT VALID: " + "; ".join(why))
    passes, open_m4, additional = [], [], 0
    for k, v in enumerate(verd):
        full_pass = all(v[nm] == "PASS" for nm in names)
        m4_only = v["M4"] == "INCONCLUSIVE" and all(v[nm] == "PASS" for nm in names[:3])
        if m4_only:
            ok_cause, other = m4_replaceable(reps[k])
            if not ok_cause:        # v3.1a 7a7faf P2-1 (a): any other M4 INCONCLUSIVE reason is not replaceable
                return out("INCONCLUSIVE", "run %d is M4-INCONCLUSIVE for a cause that is NOT replaceable (only 'fewer than 5 qualifying falls' is, 3fab1b; "
                                           "7a7faf P2-1 (a)): %s -- the reviewer rules" % (k + 1, other))
        if k >= 2:
            if not open_m4:
                return out("REFUSED", "PAIR REFUSED (Q-M2c-5): run %d is an additional counted run with no M4-INCONCLUSIVE run to replace (selection)" % (k + 1))
            additional += 1
            if additional > M4_RERUN_CAP:
                return out("REFUSED", "PAIR REFUSED (Q-M2c-5): more than %d additional counted runs" % M4_RERUN_CAP)
            o.append("run %d replaces the M4-INCONCLUSIVE run %d" % (k + 1, open_m4.pop(0) + 1))
        if full_pass:
            passes.append(k)
        elif m4_only:
            open_m4.append(k)
        else:
            return out("INCONCLUSIVE", "run %d is INCONCLUSIVE outside M4 (%s): not replaceable under Q-M2c-5 (b); the reviewer rules" % (
                k + 1, {nm: v[nm] for nm in names}))
    if len(passes) >= 2:
        return out("PASS", "the pair: runs %d and %d (every scenario, M4 included, PASSES); %d run(s) listed, %d additional" % (
            passes[0] + 1, passes[1] + 1, len(reps), additional))
    left = M4_RERUN_CAP - additional
    return out("INCONCLUSIVE", "%d full-PASS run(s); %d M4-INCONCLUSIVE run(s) open; %d additional counted run(s) still allowed" % (len(passes), len(open_m4), left))


def control_vs(control_json, judged_jsons, p7a=None):
    """R-5 / B-10: the must-fail CONTROL (observer at 30/0/0) next to the two judged runs (compiled 120/1/1); prints the three conditions"""
    c = _load(control_json)
    js = [_load(p) for p in judged_jsons]
    o = [ALGEBRA, "", "B33 CONTROL vs JUDGED (M1 ruling R-5; M2 ruling B-10) -- DIAGNOSTIC tool, W2DEV, not evidence by itself",
         "control: %s (role %s, exe %s, result %s)" % (c["run"], c.get("role"), c["meta"].get("exe_sha256"), c.get("result"))]
    for j in js:
        o.append("judged : %s (role %s, exe %s, result %s)" % (j["run"], j.get("role"), j["meta"].get("exe_sha256"), j.get("result")))
    why = []
    if c.get("role") != "CONTROL":
        why.append("the first run is not a CONTROL run")
    for j in js:
        if j.get("role") != "JUDGED":
            why.append("%s is not a JUDGED run" % j["run"])
    exes = {(x["meta"].get("exe_sha256") or "").lower() for x in [c] + js}
    if len(exes) != 1 or "" in exes:
        why.append("exe sha256 differ or missing: %s" % sorted(exes))
    for x in [c] + js:
        if x.get("overrides") is None or x.get("overrides"):
            why.append("%s was judged with overrides %s or by a judge before v3.1 (R7-07)" % (x["run"], x.get("overrides")))

    def cell(rep, scn):
        d = (rep.get("scenarios") or {}).get(scn)
        if not d:
            return "%s" % rep.get("result")
        r = d.get("registered") or {}
        f = lambda v: "-" if v is None else "%.2f" % v
        return "%s reg air %s land %s" % (d["verdict"], f(r.get("air_p95_abs")), f(r.get("land_p95_abs")))
    o.append("%-9s | %-40s | %s" % ("scenario", "CONTROL (30/0/0 on the observer)", " | ".join("JUDGED %d (120/1/1)" % (n + 1) for n in range(len(js)))))
    for scn in ("STANDING", "WALKING", "RUNNING", "M4"):
        o.append("%-9s | %-40s | %s" % (scn, cell(c, scn), " | ".join(cell(j, scn) for j in js)))
    # (a) R7-04: only a REGISTERED-analyser bar FAIL of a non-VOID control counts (a W2-only FAIL or a missing air label does not)
    failed = [s for s in ("STANDING", "WALKING", "RUNNING")
              if ((c.get("scenarios") or {}).get(s) or {}).get("verdict") == "FAIL" and ((c.get("scenarios") or {}).get(s) or {}).get("registered_bar_violations")]
    other_fail = [s for s in ("STANDING", "WALKING", "RUNNING")
                  if ((c.get("scenarios") or {}).get(s) or {}).get("verdict") == "FAIL" and s not in failed]
    cond_a = bool(failed) and c.get("role") == "CONTROL" and c.get("result") != "VOID"
    cond_b = len(js) >= 2 and all(j.get("role") == "JUDGED" and j.get("result") == "PASS" and
                                  all(((j.get("scenarios") or {}).get(s) or {}).get("verdict") == "PASS" for s in failed) for j in js)
    p7a_state, p7a_text = read_p7a(p7a)
    cond_c = p7a_state == "APPROVED"
    o.append("CONDITION (a) the control (result %s) FAILs >= 1 jump scenario by a REGISTERED bar at shift 0: %s %s%s" % (
        c.get("result"), "MET" if cond_a else "NOT MET", failed or "",
        (" (not counted, R7-04: FAIL without a registered bar violation in %s)" % other_fail) if other_fail else ""))
    o.append("CONDITION (b) both judged runs PASS %s and their whole runs: %s (%d judged run(s): %s)" % (
        failed or "that scenario", "MET" if cond_b else "NOT MET", len(js), [j.get("result") for j in js]))
    o.append("CONDITION (c) the founder's P7a look, recorded verbatim as an APPROVAL (R7-05; the reviewer judges it, this line is advisory): %s" % (
        ("%s -- %s (sha256 %s): \"%s\"" % (p7a_state, p7a, sha256(p7a), p7a_text)) if p7a and os.path.isfile(p7a) else "NOT RECORDED (--p7a <record>)"))
    if why:
        o.append("NOT COMPARABLE: " + "; ".join(why))
        return "\n".join(o), 3
    if cond_a and cond_b and cond_c:
        o.append("ALL THREE CONDITIONS MET: the compiled defaults 120/1/1 may be cleared (the reviewer rules)")
        return "\n".join(o), 0
    o.append("NOT CLEARED: %s. A rejection, a control that does not fail, or a judged run that does not PASS means a revert: a new governed build and fresh SC3 runs." % (
        "the control did not FAIL by a registered bar: the instrument cannot tell the change apart" if not cond_a else
        ("a judged run did not PASS" if not cond_b else
         ("the founder's P7a look is a recorded REJECTION" if p7a_state == "REJECTED" else "the founder's P7a APPROVAL is not recorded (%s)" % p7a_text))))
    return "\n".join(o), (1 if cond_a and any(j.get("result") == "FAIL" for j in js) else 3)


def parse_args(argv):
    args, pos, i = {}, [], 0
    flags = {"--no-require-frames", "--historical"}
    while i < len(argv):
        if argv[i] in flags:
            args[argv[i]] = True
            i += 1
        elif argv[i].startswith("--"):
            args[argv[i]] = argv[i + 1]
            i += 2
        else:
            pos.append(argv[i])
            i += 1
    return args, pos


EXIT = {"PASS": 0, "FAIL": 1, "INCONCLUSIVE": 3, "VOID": 4, "REFUSED": 5}


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    if argv[0] == "--pair":
        text, result = pair(argv[1], argv[2])
        print(text)
        return EXIT[result]
    if argv[0] == "--record":
        text, result = record(argv[1:])
        print(text)
        return EXIT[result]
    if argv[0] == "--control-vs":
        rest, p7a = argv[1:], None
        if "--p7a" in rest:
            i = rest.index("--p7a")
            p7a = rest[i + 1]
            del rest[i:i + 2]
        text, rc = control_vs(rest[0], rest[1:], p7a)
        print(text)
        return rc
    if argv[0] == "--ring-compare":
        a2, p2 = parse_args(argv[3:])
        text, _ = ring_compare(argv[1], argv[2], a2)
        print(text)
        return 0
    args, pos = parse_args(argv)
    for removed in ("--verdict-analyser", "--m4-bars"):
        if removed in args:
            print("refused: %s was removed in v3 (M2 ruling B-2/B-7: the analyser is BOTH and M4 is judged under the bars)" % removed)
            return 2
    rep = judge_run(pos[0] if pos else None, args)
    print(fmt(rep))
    if "--json" in args:
        with open(args["--json"], "w", encoding="utf-8") as f:
            json.dump(rep, f, indent=1, default=str)
    return EXIT[rep["result"]]


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
