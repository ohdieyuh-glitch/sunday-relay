"""test_b33_tooling_fixes.py -- regressions for the 2026-10-23 PILOT tooling defects (D-1, D-2, D-4, D-5). DIAGNOSTIC tool, W2DEV,
not evidence by itself. Run: python -I -B tests/test_b33_tooling_fixes.py   (D-4 / D-5 evaluate launcher expressions with `powershell`)
  D-1 SHA256SUMS.txt lists every tool file of this folder (outputs the tests write are excluded) and every entry matches its file.
  D-2 the six b6_b33a_reanalysis slice logs are present and match both SHA256SUMS.txt files that list them.
  D-4 LAUNCH_LOG line 1 names the run's real role ($runRole): never JUDGED for a survey or a -RelaySource / -ServerTree rehearsal.
  D-5 the in-run RAM reading writes one RAM_TRACE.csv row per sample (RamTraceRow) and RAM_LOG.json names the trace and its sha256.
"""
import hashlib, os, re, subprocess, unittest

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
