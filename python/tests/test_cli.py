import json
import os
import subprocess
import sys
import tempfile
import unittest

from helpers import A1, A2, document, item

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
        self.assertEqual(len(vocab["sections"]), 19)
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
