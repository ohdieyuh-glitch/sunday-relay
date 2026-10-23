"""test_b33_wording.py -- wording-only regressions found in the 2026-10-23 B33 survey rehearsals (T091807Z, T093602Z). DIAGNOSTIC tool,
W2DEV, not evidence by itself. Run: python -I -B tests/test_b33_wording.py
  W1 b33_survey_record.py: a survey drive run WITH -SurveyReturn that aborted before the walk-off (T091807Z: HARDWARE mouse abort) must not
     be described as "run without -SurveyReturn"; the route verdict line and the exit code stay exactly as before (ROUTE NOT OK, 1).
     Fixture: tests/fixtures/T091807Z_aborted_survey (byte copies of that run's drive timeline.csv and route.json; no RUN.json, no logs).
  W2 b33_survey_record.py: a survey that COMPLETED the runway and the mount with no SURVEY_WALKOFF block still says "run without
     -SurveyReturn" (the wording is only changed for a drive that ended early).
  W3 b33_launch.ps1: RUN.json's label names the server override actually used: -RelaySource for a ring-relay run (T091807Z/T093602Z said
     "-ServerTree"), -ServerTree for a -ServerTree run, the package-precondition text for a prereg server. The label is descriptive only:
     the judge copies it into meta and never reads it for a verdict.
"""
import csv, io, os, shutil, subprocess, sys, tempfile, unittest, contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "b33_analyser"))
import b33_survey_record as SR   # noqa: E402

FIX = os.path.join(HERE, "fixtures", "T091807Z_aborted_survey")
VERDICT_T091807Z = ("- ROUTE NOT OK: the SURVEY_RUNWAY block did not complete (runway not verified); no ON_KERB row (the approach + mount "
                    "did not reach the kerb); the drive aborted: B33ABORT: other input seen (a person or other software): HARDWARE mouse "
                    "msg=0x200 (route sha256 7de04985b6db89989b5ed8063972c2b143f3c45b4be8577d8c3b9917c390405b)")


def record(run):
    out = os.path.join(tempfile.mkdtemp(prefix="b33w_"), "SURVEY_RECORD.md")
    with contextlib.redirect_stdout(io.StringIO()):
        rc = SR.main([run, "--out", out])
    with open(out, encoding="utf-8") as f:
        return rc, f.read().splitlines()


def walkoff_lines(lines):
    i = lines.index("## SURVEY_WALKOFF (disclosed; never counted)")
    return [l for l in lines[i + 1:] if l.startswith("- ")][:1]


class SurveyRecordWording(unittest.TestCase):
    def test_W1_aborted_survey_return_run_is_not_called_a_run_without_survey_return(self):
        rc, lines = record(FIX)
        self.assertEqual(rc, 1)
        self.assertIn(VERDICT_T091807Z, lines)                       # the verdict line is unchanged, byte for byte
        w = walkoff_lines(lines)
        self.assertEqual(len(w), 1, lines)
        self.assertNotIn("run without -SurveyReturn", w[0])
        self.assertIn("ended before the walk-off", w[0])

    def test_W2_completed_survey_without_walkoff_keeps_the_old_wording(self):
        tmp = tempfile.mkdtemp(prefix="b33w2_")
        src = os.path.join(FIX, "drive_survey_20261023T092018Z")
        dst = os.path.join(tmp, "drive_survey_20261023T092018Z")
        os.makedirs(dst)
        shutil.copy(os.path.join(src, "route.json"), dst)
        with open(os.path.join(src, "timeline.csv"), encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
        fields = list(rows[0].keys())
        rows = [r for r in rows if r["event"] != "ABORT"]
        t = int(rows[-1]["utc_ms"])
        for k, (ev, det) in enumerate((("BLOCK_BEGIN", "SURVEY_RUNWAY"), ("BLOCK_END", "SURVEY_RUNWAY"), ("ON_KERB", "synthetic"))):
            rows.append(dict({x: "" for x in fields}, utc_iso="synthetic", utc_ms=str(t + 1000 * (k + 1)), seq=str(900 + k), event=ev, detail=det))
        with open(os.path.join(dst, "timeline.csv"), "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            w.writerows(rows)
        rc, lines = record(tmp)
        self.assertEqual(rc, 0, lines)
        self.assertEqual(walkoff_lines(lines), ["- no SURVEY_WALKOFF block (run without -SurveyReturn)"])


class LaunchLabel(unittest.TestCase):
    """the RUN.json label expression of b33_launch.ps1, evaluated by powershell with the launcher's own variables set"""

    @staticmethod
    def label(server_prereg, relay_source, server_tree):
        with open(os.path.join(ROOT, "b33_launch.ps1"), encoding="utf-8-sig") as f:
            line = [l for l in f.read().splitlines() if "run_id = (Split-Path $run -Leaf); label = " in l]
        assert len(line) == 1, line
        expr = line[0].split("label = ", 1)[1].strip()
        ps = "$serverPrereg = $%s; $RelaySource = '%s'; $ServerTree = '%s'; %s" % (
            "true" if server_prereg else "false", relay_source, server_tree, expr)
        p = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, text=True)
        assert p.returncode == 0, p.stderr
        return p.stdout.strip()

    def test_W3_relay_source_run_is_labelled_relay_source(self):
        lab = self.label(False, r"C:\dev\iwonder\_b33_relay_wt_3f20fc1a_20261023", "")
        self.assertIn("-RelaySource", lab)
        self.assertNotIn("-ServerTree", lab)
        self.assertIn("NOT-PREREG", lab)

    def test_W3_server_tree_run_keeps_the_server_tree_label(self):
        self.assertEqual(self.label(False, "", r"C:\dev\iwonder\wonderland-integration-sprint"),
                         "DIAGNOSTIC B33 NOT-PREREG (server override -ServerTree; dev loopback; never scoring evidence)")

    def test_W3_prereg_server_label_unchanged(self):
        self.assertEqual(self.label(True, "", ""),
                         "DIAGNOSTIC B33 package precondition (dev loopback, dev identities; never scoring evidence)")


if __name__ == "__main__":
    unittest.main(verbosity=2)