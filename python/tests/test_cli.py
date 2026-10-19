import json
import os
import subprocess
import sys
import tempfile
import unittest

from helpers import A1, A2, TempDirs, arm_bundle, document, item, julius

PACKAGE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def cli(*args):
    return subprocess.run([sys.executable, "-m", "julius_brain_intel", *args], cwd=PACKAGE_ROOT,
                          capture_output=True, text=True, encoding="utf-8")


class CliTests(unittest.TestCase):
    def test_a_report_carrying_refused_material_is_never_printed(self):
        # Defence in depth: the loader withholds secrets, and the printer refuses anything that slipped past.
        from julius_brain_intel.__main__ import _print
        with self.assertRaises(RuntimeError):
            _print({"note": "sk-ant-api03-FAKETESTNOTREAL"})
        with self.assertRaises(RuntimeError):
            _print({"note": "my chain-of-thought was"})

    def test_no_report_can_award_readiness(self):
        # Every report kind carries the disclaimer, and none carries a field a reader could take for a score.
        from julius_brain_intel import NOT_READINESS_AUTHORITY
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as handle:
            json.dump(document([item("pbr:a", "requirements")]), handle)
        try:
            reports = [json.loads(cli(*args).stdout) for args in (
                ("analyze-bundle", A2), ("quality", A2), ("compare", A1, A2), ("memory", handle.name))]
        finally:
            os.unlink(handle.name)

        def keys(value):
            if isinstance(value, dict):
                for key, inner in value.items():
                    yield key
                    yield from keys(inner)
            elif isinstance(value, list):
                for inner in value:
                    yield from keys(inner)

        for report in reports:
            self.assertEqual(report["authority"], NOT_READINESS_AUTHORITY, report.get("schemaVersion"))
            awarding = [k for k in keys(report) if any(w in k.lower() for w in ("readiness", "credit", "percent", "score"))]
            self.assertEqual(awarding, [], report.get("schemaVersion"))

    def test_analyze_bundle(self):
        result = cli("analyze-bundle", A2)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["schemaVersion"], "julius.evidence-analysis.v1")
        self.assertEqual(report["binding"]["workflowRunId"], "36915013287")

    def test_compare(self):
        result = cli("compare", A1, A2)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["kind"], "candidate_vs_baseline")

    def test_a_registered_pair_is_validated_then_evaluated_from_four_arm_bundles(self):
        # The C-4/C-5 sequence: the hash first, the arms' contracts carry it, then one bundle per arm and
        # each WITH arm's start keyed by its workflow run (or its Julius run, here for the second).
        tmp = TempDirs()
        w1, w2, c1, c2 = julius(0xA1), julius(0xA2), julius(0xC1), julius(0xC2)
        raw = {
            "schemaVersion": "julius.learning-registration.v1", "registrationId": "learn-pair-001",
            "registeredAt": "2026-10-04T09:00:00Z", "hypothesis": "Carried verified knowledge lowers repairs.",
            "weakness": {"description": "the coder repeats a repair", "evidence": ["run 36915013287 tasks.tsv"]},
            "adaptation": {"kind": "carried_knowledge", "description": "verified claims of the WITHOUT arm",
                           "changeRef": "brain:claims"},
            "baselineRuns": [w1, w2],
            "metrics": [{"name": "mission.repair_rounds", "expectedDirection": "lower", "minEffect": 1, "primary": True}],
            "minRunsPerSide": 2,
        }
        try:
            path = os.path.join(tmp.bundle(A2), "registration.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(raw, handle)
            validated = cli("learning-validate", path)
            self.assertEqual(validated.returncode, 0, validated.stderr)
            digest = json.loads(validated.stdout)["digest"].split(":", 1)[1]
            arms = [arm_bundle(tmp, digest, w1, "41", repairs=2), arm_bundle(tmp, digest, w2, "42", repairs=3),
                    arm_bundle(tmp, digest, c1, "43", without=w1, inherited_repairs=2),
                    arm_bundle(tmp, digest, c2, "44", without=w2, inherited_repairs=3)]
            result = cli("learning-evaluate", path, "--baseline", *arms[:2], "--candidate", *arms[2:],
                         "--started", "43=2026-10-04T10:00:00Z", f"{c2}=2026-10-04T11:00:00Z")
            self.assertEqual(result.returncode, 0, result.stderr)
            outcome = json.loads(result.stdout)
            self.assertEqual(outcome["verdict"], "RETAIN", outcome["reasons"])
            self.assertEqual([a["juliusRunId"] for a in outcome["arms"]], [w1, w2, c1, c2])
            late = cli("learning-evaluate", path, "--baseline", *arms[:2], "--candidate", *arms[2:],
                       "--started", "43=2026-10-04T10:00:00Z", "44=2026-10-04T08:59:59Z")
            self.assertEqual(json.loads(late.stdout)["verdict"], "INVALID")
        finally:
            tmp.cleanup()

    def test_brain_check_refuses_with_exit_2(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as handle:
            json.dump(dict(document([item("pbr:a", "requirements")]), schemaVersion="relay-project-brain.v9"), handle)
        try:
            result = cli("brain-check", handle.name)
            self.assertEqual(result.returncode, 2)
            self.assertIn("refused:", result.stderr)
        finally:
            os.unlink(handle.name)

    def test_vocabulary_and_safety_classify(self):
        vocab = json.loads(cli("vocabulary").stdout)
        self.assertEqual(len(vocab["sections"]), 20)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as handle:
            json.dump(["julius-task-contract.ts", "sk-ant-api03-FAKETESTNOTREAL", "plain"], handle)
        try:
            out = cli("safety-classify", handle.name)
            self.assertEqual(json.loads(out.stdout), [None, "credential", None])
            self.assertNotIn("FAKETESTNOTREAL", out.stdout)  # verdicts only, never the strings
        finally:
            os.unlink(handle.name)


if __name__ == "__main__":
    unittest.main()
