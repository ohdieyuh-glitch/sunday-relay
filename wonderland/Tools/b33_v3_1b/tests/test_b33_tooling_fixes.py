"""test_b33_tooling_fixes.py -- regressions for the 2026-10-23 PILOT tooling defects (D-1, D-2, D-4, D-5). DIAGNOSTIC tool, W2DEV,
not evidence by itself. Run: python -I -B tests/test_b33_tooling_fixes.py   (D-4 / D-5 evaluate launcher expressions with `powershell`)
  D-1 SHA256SUMS.txt lists every tool file of this folder (outputs the tests write are excluded) and every entry matches its file.
  D-2 the six b6_b33a_reanalysis slice logs are present and match both SHA256SUMS.txt files that list them.
  D-4 LAUNCH_LOG line 1 names the run's real role ($runRole): never JUDGED for a survey or a -RelaySource / -ServerTree rehearsal.
  D-5 the in-run RAM reading writes one RAM_TRACE.csv row per sample (RamTraceRow) and RAM_LOG.json names the trace and its sha256.
  Skywalker rulings on 3c040da4 (2026-10-23):
  R1 b33_stop.ps1 hashes RAM_LOG.json and RAM_TRACE.csv into SHA256SUMS_AT_CLOSE.txt; a missing one is skipped, never a close error.
  R2 b33_judge.py stays byte-identical (sha256 4caddf0b...).
  R3 DRIVE_RECORD.txt logs sim_accel (the -SimAccel default stays 0).
  R4 b6_b33a_reanalysis/SHA256SUMS.txt fails exactly its 2 documented v3.1 entries, which equal the JUDGE_b33a_v3_1.* hashes.
  Skywalker's review of e1285752 (2026-10-23):
  FA RUN_CLOSE.json optional_close_files: the optional close files expected, found and missing (all missing still leaves a record).
  FE RAM_GUARD_TRIP.txt and STOP_LOG.txt are hashed at close when present and skipped when missing.
  OBSERVER_FOLLOW.md launcher half (2026-10-23):
  OF1 -ObserverFollow is refused (exit 2, before anything is made) unless the role is SURVEY or REHEARSAL_NOT_PREREG. Values (FORGE #416
      024a0d57: the client reads only the first token): whitespace, a quote, a semicolon or a comma is refused with a pointer to the user
      id; 'off' is refused at launch (the observer starts unfollowed); empty, other characters or > 64 refused; first / names / ids pass.
  OF2 without -ObserverFollow the client arguments and the disclosed block are byte-identical to e1285752's (its frozen fragment).
  OF3 with it, the observer's -ExecCmds ends with wl.Qa.FollowRemote <who>, disclosed (qa_cmds_observer, observer_follow) and logged;
      DRIVE_RECORD.txt copies it from RUN.json; the client command itself is not added here (FORGE #416).
"""
import hashlib, json, os, re, shutil, subprocess, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LAUNCH = os.path.join(ROOT, "b33_launch.ps1")
# what the test suites write into the tool folder at run time (never part of the tools)
OUTPUT_DIRS = {"__pycache__", os.path.join("tests", "dryrun_out"), os.path.join("tests", "fixtures_out"),
               os.path.join("tests", "launch_fixture"), os.path.join("tests", "stop_fixture"), os.path.join("tests", "survey_fixture")}
SLICES = ["STANDING_span1_sender.log", "STANDING_span1_viewer.log", "WALKING_span1_sender.log", "WALKING_span1_viewer.log",
          "WALKING_span2_sender.log", "WALKING_span2_viewer.log"]


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def read_sums(p):
    out = {}
    with open(p, encoding="utf-8-sig") as f:
        for line in f:
            m = re.match(r"^([0-9a-f]{64}) [ *](.+)$", line.rstrip("\r\n"))
            if m:
                rel = m.group(2)
                rel = rel[2:] if rel.startswith("./") else rel
                out[rel.replace("\\", "/")] = m.group(1)
    return out


def tool_files():
    found = set()
    for d, dirs, files in os.walk(ROOT):
        rel_d = os.path.relpath(d, ROOT)
        dirs[:] = [x for x in dirs if x not in OUTPUT_DIRS and os.path.normpath(os.path.join(rel_d, x)) not in OUTPUT_DIRS]
        for f in files:
            rel = os.path.normpath(os.path.join(rel_d, f)).replace(os.sep, "/")
            if rel != "SHA256SUMS.txt":
                found.add(rel)
    return found


def ps(cmd):
    p = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return p.stdout.strip()


def launch_src():
    with open(LAUNCH, encoding="utf-8-sig") as f:
        return f.read()


class Manifest(unittest.TestCase):
    def test_D1_every_entry_matches_and_every_tool_file_is_listed(self):
        sums = read_sums(os.path.join(ROOT, "SHA256SUMS.txt"))
        bad = [r for r, h in sums.items() if not os.path.exists(os.path.join(ROOT, r)) or sha256(os.path.join(ROOT, r)) != h]
        self.assertEqual(bad, [])
        self.assertEqual(sorted(tool_files() - set(sums)), [])

    def test_D2_slice_logs_present_and_match_both_manifests(self):
        top = read_sums(os.path.join(ROOT, "SHA256SUMS.txt"))
        sub = read_sums(os.path.join(ROOT, "b6_b33a_reanalysis", "SHA256SUMS.txt"))
        for n in SLICES:
            p = os.path.join(ROOT, "b6_b33a_reanalysis", "slices", n)
            self.assertTrue(os.path.exists(p), p)
            h = sha256(p)
            self.assertEqual(top.get("b6_b33a_reanalysis/slices/" + n), h, n)
            self.assertIn(h, sub.values(), n)


class LaunchRole(unittest.TestCase):
    """the $runRole line and LAUNCH_LOG line 1 of b33_launch.ps1, evaluated by powershell with the launcher's own switches set"""

    @staticmethod
    def line1(control, scenario, relay_source, server_tree):
        lines = launch_src().splitlines()
        role = [l for l in lines if l.startswith("$runRole = $(if ($Control)")]
        say = [l for l in lines if l.startswith('Say ("B33 launcher (W2DEV) DIAGNOSTIC')]
        assert len(role) == 1 and len(say) == 1, (role, say)
        cmd = "$Control = $%s; $Scenario = '%s'; $RelaySource = '%s'; $ServerTree = '%s'; %s; Write-Output %s" % (
            "true" if control else "false", scenario, relay_source, server_tree, role[0], say[0][len("Say "):])
        return ps(cmd)

    def test_D4_relay_source_survey_is_logged_as_rehearsal(self):
        out = self.line1(False, "survey", r"C:\dev\iwonder\_b33_relay_wt_3f20fc1a_20261023", "")
        self.assertTrue(out.endswith("role=REHEARSAL_NOT_PREREG scenario=survey"), out)

    def test_D4_server_tree_jumps_is_logged_as_rehearsal(self):
        self.assertTrue(self.line1(False, "jumps", "", r"C:\x").endswith("role=REHEARSAL_NOT_PREREG scenario=jumps"))

    def test_D4_prereg_survey_is_logged_as_survey(self):
        self.assertTrue(self.line1(False, "survey", "", "").endswith("role=SURVEY scenario=survey"))

    def test_D4_counted_run_still_logged_as_judged(self):
        self.assertTrue(self.line1(False, "all", "", "").endswith("role=JUDGED scenario=all"))

    def test_D4_control_wording_unchanged(self):
        self.assertTrue(self.line1(True, "all", "", "").endswith("role=CONTROL (must-fail control, never a judged run) scenario=all"))


class RamTrace(unittest.TestCase):
    @staticmethod
    def fn(name):
        m = re.search(r"(?ms)^function %s\(.*?^\}" % name, launch_src())
        assert m, name
        return m.group(0)

    def row(self, args):
        return ps(self.fn("RamGuardTrips") + "\n" + self.fn("RamTraceRow") + "\nRamTraceRow " + args)

    def test_D5_row_above_the_guard(self):
        self.assertEqual(self.row("([datetime]::new(2026,10,23,9,36,5,[DateTimeKind]::Utc)) 3.04 2.229 1.1"),
                         "2026-10-23T09:36:05.0000000Z,3.0,2.229,0")

    def test_D5_row_below_the_guard_is_flagged(self):
        self.assertTrue(self.row("([datetime]::new(2026,10,23,9,36,8,[DateTimeKind]::Utc)) 6 1.05 1.1").endswith(",6.0,1.050,1"))

    def test_D5_failed_read_keeps_its_row(self):
        self.assertTrue(self.row("([datetime]::new(2026,10,23,9,36,8,[DateTimeKind]::Utc)) 6 $null 1.1").endswith(",6.0,,0"))

    def test_D5_loop_writes_a_row_per_reading_and_ram_log_names_the_trace(self):
        src = launch_src()
        loop = src[src.index("# ---- 7. conductor wait"):src.index("} catch {\n  Say (\"LAUNCH ERROR")]
        self.assertIn("'utc,elapsed_s,free_gb,below_guard'", loop)
        read = loop.index("FreePhysicalMemory")
        self.assertLess(read, loop.index("Add-Content -Path $ramTrace -Value (RamTraceRow"))
        self.assertLess(loop.index("Add-Content -Path $ramTrace"), loop.index("RamGuardTrips $fr $InRunGuardGb"))
        self.assertIn("in_run_trace_file = 'RAM_TRACE.csv'; in_run_trace_sha256 = ", loop)
        self.assertIn("'RAM_LOG.json'", loop)


def ps_file(script, args):
    p = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script] + args,
                       capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


class StopHashesRam(unittest.TestCase):
    """R1: b33_stop.ps1 -FromLauncher on a fixture run folder with no processes and no lease"""

    def close(self, ram_log, ram_trace, guard_trip=False, stop_log=False):
        run = tempfile.mkdtemp(prefix="b33stop_")
        self.addCleanup(shutil.rmtree, run, True)
        with open(os.path.join(run, "RUN.json"), "w", encoding="utf-8") as f:
            json.dump({"run_id": "stop_ram_fixture", "role": "REHEARSAL_NOT_PREREG", "lease_id": None, "launcher_pid": 999999,
                       "sender": {"procs": []}, "observer": {"procs": []}, "server": {"procs": []}, "frames": {"procs": []}}, f)
        if ram_log:
            with open(os.path.join(run, "RAM_LOG.json"), "w", encoding="utf-8") as f:
                f.write('{"lease_gb": 5, "in_run_trace_file": "RAM_TRACE.csv"}\n')
        if ram_trace:
            with open(os.path.join(run, "RAM_TRACE.csv"), "w", encoding="ascii", newline="") as f:
                f.write("utc,elapsed_s,free_gb,below_guard\r\n2026-10-23T09:36:05.0000000Z,3.0,2.229,0\r\n")
        if guard_trip:
            with open(os.path.join(run, "RAM_GUARD_TRIP.txt"), "w", encoding="ascii") as f:
                f.write("2026-10-23T09:40:00.0000000Z free 1.05 GB < in-run guard 1.1 GB: the run is STOPPED\n")
        if stop_log:
            with open(os.path.join(run, "STOP_LOG.txt"), "w", encoding="utf-8") as f:
                f.write("2026-10-23T09:41:00.0000000Z stop: an earlier stop report (fixture)\n")
        rc, out = ps_file(os.path.join(ROOT, "b33_stop.ps1"), ["-Run", run, "-FromLauncher"])
        with open(os.path.join(run, "RUN_CLOSE.json"), encoding="utf-8-sig") as f:
            close = json.load(f)
        sums = {}
        with open(os.path.join(run, "SHA256SUMS_AT_CLOSE.txt"), encoding="utf-8-sig") as f:
            for line in f:
                parts = line.strip().split(None, 1)
                if len(parts) == 2:
                    # b33_stop.ps1 trims a leading '\\' (Windows); on a POSIX test host the path keeps its leading '/'
                    sums[parts[1].lstrip("\\/")] = parts[0]
        return run, close, sums, out

    def test_R1_both_present_both_hashed(self):
        run, close, sums, out = self.close(True, True)
        self.assertEqual(close["close_errors"] or [], [], out)
        for n in ("RAM_LOG.json", "RAM_TRACE.csv", "RUN.json"):
            self.assertEqual(sums.get(n), sha256(os.path.join(run, n)), (n, sums))

    def test_R1_both_missing_skipped_cleanly(self):
        run, close, sums, out = self.close(False, False)
        self.assertEqual(close["close_errors"] or [], [], out)
        self.assertNotIn("RAM_LOG.json", sums)
        self.assertNotIn("RAM_TRACE.csv", sums)
        self.assertEqual(sums.get("RUN.json"), sha256(os.path.join(run, "RUN.json")))

    def test_R1_trace_missing_log_still_hashed(self):
        run, close, sums, out = self.close(True, False)
        self.assertEqual(close["close_errors"] or [], [], out)
        self.assertEqual(sums.get("RAM_LOG.json"), sha256(os.path.join(run, "RAM_LOG.json")))
        self.assertNotIn("RAM_TRACE.csv", sums)

    def test_R1_launcher_comment_no_longer_claims_an_unhashed_record(self):
        src = launch_src()
        self.assertNotIn("written before the close so the stop hashes it", src)
        self.assertIn("b33_stop.ps1\n  # hashes RAM_LOG.json and RAM_TRACE.csv", src)


class StopOptionalCloseFiles(unittest.TestCase):
    """Skywalker's e1285752 review: F-A (RUN_CLOSE.json records the optional close files expected / found / missing) and F-E
    (RAM_GUARD_TRIP.txt and STOP_LOG.txt hashed at close when present, skipped when missing)"""
    ALL = ["RAM_LOG.json", "RAM_TRACE.csv", "RAM_GUARD_TRIP.txt", "STOP_LOG.txt"]

    def close(self, *a, **k):
        return StopHashesRam.close(self, *a, **k)

    def test_FA_all_missing_still_leaves_a_record(self):
        run, close, sums, out = self.close(False, False)
        self.assertEqual(close["close_errors"] or [], [], out)
        opt = close["optional_close_files"]
        self.assertEqual(opt["expected"], self.ALL)
        self.assertEqual(opt["found"] or [], [])
        self.assertEqual(opt["missing"], self.ALL)

    def test_FA_found_and_missing_split(self):
        run, close, sums, out = self.close(True, False, guard_trip=True)
        opt = close["optional_close_files"]
        self.assertEqual(opt["found"], ["RAM_LOG.json", "RAM_GUARD_TRIP.txt"])
        self.assertEqual(opt["missing"], ["RAM_TRACE.csv", "STOP_LOG.txt"])

    def test_FA_all_found(self):
        run, close, sums, out = self.close(True, True, guard_trip=True, stop_log=True)
        opt = close["optional_close_files"]
        self.assertEqual(opt["found"], self.ALL)
        self.assertEqual(opt["missing"] or [], [])

    def test_FE_guard_trip_and_stop_log_hashed_when_present(self):
        run, close, sums, out = self.close(True, True, guard_trip=True, stop_log=True)
        self.assertEqual(close["close_errors"] or [], [], out)
        for n in self.ALL + ["RUN.json"]:
            self.assertEqual(sums.get(n), sha256(os.path.join(run, n)), (n, sums))
        with open(os.path.join(run, "SHA256SUMS_AT_CLOSE.txt"), "rb") as f:
            self.assertEqual(close["sums_sha256"], hashlib.sha256(f.read()).hexdigest())

    def test_FE_guard_trip_and_stop_log_skipped_when_missing(self):
        run, close, sums, out = self.close(True, True)
        self.assertEqual(close["close_errors"] or [], [], out)
        self.assertNotIn("RAM_GUARD_TRIP.txt", sums)
        self.assertNotIn("STOP_LOG.txt", sums)
        self.assertEqual(sums.get("RAM_LOG.json"), sha256(os.path.join(run, "RAM_LOG.json")))


class JudgeUnchanged(unittest.TestCase):
    def test_R2_judge_is_byte_identical(self):
        self.assertEqual(sha256(os.path.join(ROOT, "b33_judge.py")), "4caddf0b34b74c9457b730ccdf2e2d1bab0fecbe51a51637dc34e53b4f80d0ec")


class DriveRecordSimAccel(unittest.TestCase):
    """R3: a -DryRun calibrate (sends nothing) records sim_accel in DRIVE_RECORD.txt"""

    def record(self, extra):
        run = tempfile.mkdtemp(prefix="b33drv_")
        self.addCleanup(shutil.rmtree, run, True)
        rc, out = ps_file(os.path.join(ROOT, "b33_drive.ps1"), ["-Run", run, "-Mode", "calibrate", "-DryRun"] + extra)
        recs = [os.path.join(d, f) for d, _, fs in os.walk(run) for f in fs if f == "DRIVE_RECORD.txt"]
        self.assertEqual(len(recs), 1, out)
        with open(recs[0], encoding="utf-8-sig") as f:
            return f.read().split()

    def test_R3_default_sim_accel_is_logged_as_0(self):
        self.assertIn("sim_accel=0", self.record([]))

    def test_R3_explicit_sim_accel_is_logged(self):
        self.assertIn("sim_accel=900", self.record(["-SimAccel", "900"]))


class B6ExpectedFailures(unittest.TestCase):
    def test_R4_exactly_the_two_documented_v31_entries_fail_and_match_the_b6_judge_record(self):
        b6 = os.path.join(ROOT, "b6_b33a_reanalysis")
        failed = {}
        with open(os.path.join(b6, "SHA256SUMS.txt"), encoding="utf-8-sig") as f:
            for line in f:
                m = re.match(r"^([0-9a-f]{64}) [ *](.+)$", line.rstrip("\r\n"))
                if m:
                    p = os.path.normpath(os.path.join(b6, m.group(2)))
                    if not os.path.exists(p) or sha256(p) != m.group(1):
                        failed[m.group(2)] = m.group(1)
        self.assertEqual(sorted(failed), ["../CANDIDATE.json", "../b33_judge.py"])
        with open(os.path.join(b6, "JUDGE_b33a_v3_1.json"), encoding="utf-8-sig") as f:
            rec = f.read()
        for h in failed.values():
            self.assertIn(h, rec)
        with open(os.path.join(b6, "SHA256SUMS_EXPECTED_FAILURES.md"), encoding="utf-8") as f:
            note = f.read()
        for k, h in failed.items():
            self.assertIn(k, note)
            self.assertIn(h, note)


# ---- OBSERVER_FOLLOW.md, the launcher half (2026-10-23)
# e1285752's b33_launch.ps1, from '$logCvars = @("wl.Remote.LogPeriod' up to '$PREREG_RENDER = @(' (sha256 below): the client arguments and
# the disclosed block exactly as they were before -ObserverFollow existed. OF2 runs it and the current launcher side by side.
OLD_ARGS_FRAGMENT_E1285752 = r"""$logCvars = @("wl.Remote.LogPeriod $LogPeriod")
function ClientArgs([string]$ud, [int]$winX, [string]$ident, [string[]]$extra) {
  # empty entries dropped: an empty [string[]] argument can arrive as one '' (that was the trailing comma on the observer's -ExecCmds)
  $cmds = @(@("wl.Social.Dev $ident http://127.0.0.1:$Port") + $logCvars + $RenderCvars + $extra | Where-Object { $_ -and $_.Trim() })
  $flush = $(if ($ForceLogFlush) { ' -forcelogflush' } else { '' })
  return "-userdir=`"$ud`" -windowed -ResX=$ResX -ResY=$ResY -WinX=$winX -WinY=$WinY -wldev$flush -ExecCmds=`"$($cmds -join ',')`""   # no -wlframes (M2 B-5)
}
$udS = Join-Path $run 'sender'; $udO = Join-Path $run 'observer'
$argS = ClientArgs $udS $SenderX $SenderName @()
$obsExtra = @(); if ($Control) { $obsExtra = $CONTROL_CVARS }   # an explicit array: $(if ... else { @() }) gives $null, i.e. one '' entry
$argO = ClientArgs $udO $ObserverX $ObserverName $obsExtra
$disclosed = [ordered]@{
  logging_cvars = $logCvars; render_cvars = @($RenderCvars); control_cvars_observer = @($obsExtra)
  switches = @('-wldev (needed by wl.Social.Dev)', "-windowed -ResX=$ResX -ResY=$ResY -WinX/-WinY (ignored by the client; the launcher places the windows)") + $(if ($ForceLogFlush) { @('-forcelogflush') } else { @() })
  # THE EXACT LAUNCH SWITCH LIST (M2 ruling B-5): the judge VOIDs any switch in a client's own LogInit Command Line that is not in this list
  launch_switches = @('-userdir', '-windowed', '-ResX', '-ResY', '-WinX', '-WinY', '-wldev', '-ExecCmds') + $(if ($ForceLogFlush) { @('-forcelogflush') } else { @() })
  gameplay_cvars = @()
}
"""
OLD_ARGS_FRAGMENT_SHA256 = "43d99e857335882679f257c967b022ce9520b90b7fc5f255528bc48f04318108"
CONTROL_CVARS = "@('wl.Remote.InterpEaseZ 30', 'wl.Remote.ReportTimeSamples 0', 'wl.Remote.RttClock 0')"


def ps_rc(cmd):
    p = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd], capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr).strip()


def between(src, start, end):
    i = src.index(start)
    return src[i:src.index(end, i)]


def role_line():
    lines = [l for l in launch_src().splitlines() if l.startswith("$runRole = $(if ($Control)")]
    assert len(lines) == 1, lines
    return lines[0]


def follow_gate():
    # the -ObserverFollow refusal block of the current launcher (from "$followCmd = ''" up to the -NotCountedRoot default)
    return between(launch_src(), "$followCmd = ''", "if (-not $NotCountedRoot)")


def setup(control, scenario, relay_source, server_tree, render, flush):
    return ("$Control = $%s; $Scenario = '%s'; $RelaySource = '%s'; $ServerTree = '%s'; $Port = 8796; $LogPeriod = 0.1; "
            "$RenderCvars = @(%s); $ForceLogFlush = $%s; $ResX = 940; $ResY = 1031; $WinY = 0; $SenderX = 0; $ObserverX = 960; "
            "$SenderName = 'wlautoA'; $ObserverName = 'wlautoB'; $run = 'C:\\runs\\R'; $CONTROL_CVARS = %s\n" % (
                "true" if control else "false", scenario, relay_source, server_tree, ", ".join("'%s'" % r for r in render),
                "true" if flush else "false", CONTROL_CVARS))


OUT = ("\nWrite-Output ('ARGS=' + $argS); Write-Output ('ARGO=' + $argO); "
       "Write-Output ('DISC=' + ($disclosed | ConvertTo-Json -Depth 6 -Compress))\n")
REFUSE0 = 'function Refuse0([string]$why) { Write-Output "RESULT refused (candidate check, nothing made): $why"; exit 2 }\n'


def run_new(cfg, follow=None):
    # the CURRENT launcher's role line, -ObserverFollow gate and argument/disclosed fragment, in a script block with the launcher's own
    # parameter (so $PSBoundParameters is real: an explicit -ObserverFollow '' counts as given)
    frag = between(launch_src(), '$logCvars = @("wl.Remote.LogPeriod', "$PREREG_RENDER = @(")
    body = REFUSE0 + setup(*cfg) + role_line() + "\n" + follow_gate() + frag + OUT
    call = "& { param([string]$ObserverFollow = '')\n" + body + "}" + ("" if follow is None else " -ObserverFollow " + ps_str(follow))
    return ps_rc(call)


def ps_str(v):
    # any value as a PowerShell expression built from char codes (no quoting problems in argv on Windows or Linux)
    if v == "":
        return "''"
    return "(-join [char[]]@(%s))" % ",".join(str(ord(c)) for c in v)


def run_old(cfg):
    return ps_rc(setup(*cfg) + OLD_ARGS_FRAGMENT_E1285752 + OUT)


def parse(out):
    d = {}
    for l in out.splitlines():
        for k in ("ARGS=", "ARGO=", "DISC="):
            if l.startswith(k):
                d[k[:-1]] = l[len(k):]
    return d


# (control, scenario, relay_source, server_tree, render cvars, forcelogflush)
NO_FLAG_CFGS = [
    (False, "all", "", "", ["scalability 0"], False),            # the PREREG judged launch
    (True, "all", "", "", ["scalability 0"], False),             # CONTROL
    (False, "survey", "", "", ["scalability 0"], False),         # SURVEY
    (False, "jumps", r"C:\dev\iwonder\_wdev_r18_ring_relay", "", [], False),   # REHEARSAL_NOT_PREREG
    (False, "m4", "", r"C:\x", ["scalability 0", "r.VSync 0"], True),
]


class ObserverFollowLauncher(unittest.TestCase):
    def test_OF0_frozen_fragment_is_e1285752s(self):
        self.assertEqual(hashlib.sha256(OLD_ARGS_FRAGMENT_E1285752.encode("utf-8")).hexdigest(), OLD_ARGS_FRAGMENT_SHA256)

    def test_OF1_refused_for_a_judged_run(self):
        rc, out = run_new((False, "all", "", "", ["scalability 0"], False), "first")
        self.assertEqual(rc, 2, out)
        self.assertIn("-ObserverFollow is refused for role JUDGED", out)
        self.assertNotIn("ARGO=", out)

    def test_OF1_refused_for_a_control_run(self):
        rc, out = run_new((True, "jumps", "", "", ["scalability 0"], False), "first")
        self.assertEqual(rc, 2, out)
        self.assertIn("-ObserverFollow is refused for role CONTROL", out)

    def test_OF1_refused_when_given_empty_on_a_judged_run(self):
        rc, out = run_new((False, "m4", "", "", ["scalability 0"], False), "")
        self.assertEqual(rc, 2, out)
        self.assertIn("refused for role JUDGED", out)

    SURVEY = (False, "survey", "", "", ["scalability 0"], False)

    def test_OF1_empty_value_refused_on_a_survey(self):
        rc, out = run_new(self.SURVEY, "")
        self.assertEqual(rc, 2, out)
        self.assertIn("-ObserverFollow is empty", out)

    def test_OF1_whitespace_quote_semicolon_comma_refused_with_the_user_id_pointer(self):
        # FORGE #416 024a0d57: wl.Qa.FollowRemote reads only the first token; -ExecCmds splits on commas
        for bad in ("two words", "a\tb", " lead", "trail ", 'dq"x', "sq'x", "semi;colon", "a,b", "back`tick", "Wl Auto B"):
            rc, out = run_new(self.SURVEY, bad)
            self.assertEqual(rc, 2, (bad, out))
            self.assertIn("contains whitespace, a quote, a semicolon or a comma", out, bad)
            self.assertIn("pass the player's user id instead", out, bad)
            self.assertNotIn("ARGO=", out, bad)

    def test_OF1_off_is_refused_at_launch_in_any_case(self):
        for off in ("off", "OFF", "Off"):
            rc, out = run_new(self.SURVEY, off)
            self.assertEqual(rc, 2, (off, out))
            self.assertIn("-ObserverFollow off is refused at launch", out, off)
            self.assertIn("omit -ObserverFollow", out, off)

    def test_OF1_other_characters_or_too_long_refused_with_the_user_id_pointer(self):
        for bad in ("x" * 65, "na\u00efve", "a/b", "a+b"):
            rc, out = run_new(self.SURVEY, bad)
            self.assertEqual(rc, 2, (bad, out))
            self.assertIn("is not first, a display name or a user id", out, bad)
            self.assertIn("pass the player's user id instead", out, bad)

    def test_OF1_first_display_names_and_user_ids_pass_unchanged(self):
        for good in ("first", "First", "wlautoA", "WLAUTOA", "steam:76561198000000001", "0f3c9a2e-41b7-4c55-9d1e-7a0b6c2d9e10",
                     "a.b@c_d", "x" * 64):
            rc, out = run_new(self.SURVEY, good)
            self.assertEqual(rc, 0, (good, out))
            self.assertIn("wl.Qa.FollowRemote " + good, parse(out)["ARGO"], (good, out))
            self.assertEqual(json.loads(parse(out)["DISC"])["qa_cmds_observer"], ["wl.Qa.FollowRemote " + good])

    def test_OF1_refusal_comes_before_anything_is_made(self):
        src = launch_src()
        gate = src.index("-ObserverFollow is refused for role")
        self.assertLess(gate, src.index("New-Item -ItemType Directory -Force $run"))
        self.assertLess(src.index("$runRole = $(if ($Control)"), gate)
        self.assertIn("Refuse0 \"-ObserverFollow is refused for role ${runRole}", src)

    def test_OF2_without_the_flag_the_arguments_and_disclosed_block_are_byte_identical(self):
        for cfg in NO_FLAG_CFGS:
            rc_n, out_n = run_new(cfg)
            rc_o, out_o = run_old(cfg)
            self.assertEqual((rc_n, rc_o), (0, 0), (cfg, out_n, out_o))
            n, o = parse(out_n), parse(out_o)
            self.assertEqual(sorted(n), ["ARGO", "ARGS", "DISC"], out_n)
            self.assertEqual(n, o, cfg)
            self.assertNotIn("FollowRemote", out_n)

    def test_OF2_the_flag_is_off_by_default(self):
        self.assertIn("[string]$ObserverFollow = ''", launch_src())

    def test_OF3_survey_follow_appends_last_to_the_observer_only_and_discloses(self):
        cfg = (False, "survey", "", "", ["scalability 0"], False)
        rc, out = run_new(cfg, "first")
        self.assertEqual(rc, 0, out)
        n, o = parse(out), parse(run_old(cfg)[1])
        self.assertEqual(n["ARGS"], o["ARGS"])
        self.assertTrue(o["ARGO"].endswith('"'))
        self.assertEqual(n["ARGO"], o["ARGO"][:-1] + ',wl.Qa.FollowRemote first"')
        self.assertTrue(n["ARGO"].endswith('-ExecCmds="wl.Social.Dev wlautoB http://127.0.0.1:8796,wl.Remote.LogPeriod 0.1,scalability 0,wl.Qa.FollowRemote first"'), n["ARGO"])
        dn, do = json.loads(n["DISC"]), json.loads(o["DISC"])
        self.assertEqual(dn["qa_cmds_observer"], ["wl.Qa.FollowRemote first"])
        self.assertEqual(dn["observer_follow"]["who"], "first")
        self.assertIs(dn["observer_follow"]["counted"], False)
        self.assertEqual(dn["control_cvars_observer"], [])
        for k in ("qa_cmds_observer", "observer_follow"):
            dn.pop(k)
        self.assertEqual(dn, do)

    def test_OF3_rehearsal_follow_by_user_id_is_accepted(self):
        rc, out = run_new((False, "jumps", "", r"C:\x", [], False), "dev-wlautoA_01")
        self.assertEqual(rc, 0, out)
        self.assertTrue(parse(out)["ARGO"].endswith(',wl.Qa.FollowRemote dev-wlautoA_01"'), out)

    def test_OF3_logged_and_not_a_prereg_launch(self):
        src = launch_src()
        self.assertIn("-and (-not $ForceLogFlush) -and (-not $followCmd)", src)
        say = src.index('if ($followCmd) { Say ("OBSERVER FOLLOW: -ObserverFollow')
        self.assertLess(say, src.index('Say "planned OBSERVER args: $argO"'))
        self.assertLess(say, src.index("if ($DryChecks) {\n  # every input check above passed"))

    def test_OF3_the_client_command_is_not_added_here(self):
        # FORGE adds wl.Qa.FollowRemote to the client in PR #416; these tools only pass it on
        src_root = os.path.normpath(os.path.join(ROOT, "..", "..", "Source"))
        if os.path.isdir(src_root):
            for d, _, fs in os.walk(src_root):
                for f in fs:
                    if f.endswith((".cpp", ".h")):
                        with open(os.path.join(d, f), encoding="utf-8", errors="replace") as fh:
                            self.assertNotIn("wl.Qa.FollowRemote", fh.read(), f)


class DriveRecordObserverFollow(unittest.TestCase):
    def record(self, disclosed):
        run = tempfile.mkdtemp(prefix="b33drvof_")
        self.addCleanup(shutil.rmtree, run, True)
        if disclosed is not None:
            with open(os.path.join(run, "RUN.json"), "w", encoding="utf-8") as f:
                json.dump({"run_id": "of_fixture", "role": "SURVEY", "disclosed": disclosed}, f)
        rc, out = ps_file(os.path.join(ROOT, "b33_drive.ps1"), ["-Run", run, "-Mode", "calibrate", "-DryRun"])
        recs = [os.path.join(d, f) for d, _, fs in os.walk(run) for f in fs if f == "DRIVE_RECORD.txt"]
        self.assertEqual(len(recs), 1, out)
        with open(recs[0], encoding="utf-8-sig") as f:
            return f.read()

    def test_OF4_drive_record_copies_the_disclosed_follow(self):
        rec = self.record({"render_cvars": ["scalability 0"], "qa_cmds_observer": ["wl.Qa.FollowRemote first"],
                           "observer_follow": {"who": "first", "command": "wl.Qa.FollowRemote first", "counted": False}})
        self.assertIn("observer_follow=first qa_cmds_observer=wl.Qa.FollowRemote first source=RUN.json", rec)

    def test_OF4_drive_record_unchanged_without_it(self):
        self.assertNotIn("observer_follow", self.record({"render_cvars": ["scalability 0"]}))
        self.assertNotIn("observer_follow", self.record(None))


if __name__ == "__main__":
    unittest.main(verbosity=2)
