import os
import unittest

from helpers import A1, A2, A2_RUN, TempDirs, arm_bundle, julius, set_cell, set_manifest, tsv_edit
from julius_brain_intel.boundary import load_bundle
from julius_brain_intel.evidence_analysis import (
    analyze_bundle, compare_anomalies, served_model_match, sha256_file, verify_artifact, verify_sums,
)
from julius_brain_intel.evidence_analysis.mission import evidence_generation

CODER = "run:efb6e20f0d11885bc5085a68:build"


def codes(report):
    return sorted({a["code"] for a in report["anomalies"]})


class RealBundleTests(unittest.TestCase):
    """What the two real paid runs say, as independently falsified by hand on 2026-10-01."""

    def test_attempt_2_completed_and_its_three_known_findings(self):
        report = analyze_bundle(load_bundle(A2))
        self.assertTrue(report["completeness"]["complete"])
        self.assertTrue(report["completeness"]["boundToRun"])
        self.assertEqual(report["binding"]["workflowRunId"], "36915013287")
        mission = report["mission"]
        self.assertEqual(mission["runState"], {"value": "COMPLETED"})
        self.assertEqual(mission["ticks"], {"value": 4})
        self.assertEqual(mission["diffPaths"], {"value": ["src/relay/workspace/julius-tools/node-tool-adapter.ts"]})
        self.assertEqual(mission["repairRounds"], {"value": 0})
        self.assertEqual(mission["openBlockingFindings"], {"value": 0})
        self.assertEqual(report["anomalyCounts"], {"P0": 0, "P1": 0, "P2": 2, "P3": 1})
        self.assertEqual(codes(report), ["CODER_REPORT_REFUSED", "LATENCY_UNRECORDED", "TOKEN_SOURCES_DISAGREE"])
        coder = next(r for r in report["roles"] if r["role"] == "CODING_AGENT")
        self.assertEqual((coder["requestedModel"], coder["servedModel"], coder["modelMatch"]),
                         ("claude-opus-5-5", "claude-opus-5-5", "EXACT"))
        self.assertEqual(coder["servedBasis"], {"value": "attested"})
        # UNKNOWN stays UNKNOWN: the coder's latency was not recorded, and nothing reconstructs it.
        self.assertEqual(coder["latency"]["elapsedMs"], {"unknown": "elapsed_ms not recorded"})
        self.assertEqual(coder["billing"]["providerCostUsdMicros"], {"unknown": "provider-reported cost not recorded"})
        architect = next(r for r in report["roles"] if r["role"] == "PROMPT_ARCHITECT")
        self.assertEqual(architect["latency"]["elapsedMs"], {"value": 50543})

    def test_attempt_1_rediscovers_its_known_defects(self):
        report = analyze_bundle(load_bundle(A1))
        self.assertFalse(report["completeness"]["boundToRun"])
        self.assertEqual(report["mission"]["runState"], {"value": "FAILED"})
        # The NUL-settlement P0 left an invocation open; the coder "served" claude-fable-5 per SDK init only.
        self.assertIn("OPEN_INVOCATION", codes(report))
        self.assertIn("SERVED_MODEL_NOT_ATTESTED", codes(report))
        # Both workspace files empty is UNREADABLE, never "no change" (R-B3).
        self.assertIn("unknown", report["mission"]["diffPaths"])
        self.assertIn("unknown", report["mission"]["openBlockingFindings"])  # finding-status.tsv did not exist yet


class NegativeControlTests(unittest.TestCase):
    """Each detector fires on the defect it names and stays silent on attempt 2, where it is absent."""

    def setUp(self):
        self.tmp = TempDirs()

    def tearDown(self):
        self.tmp.cleanup()

    def mutated(self, edits):
        return analyze_bundle(load_bundle(self.tmp.bundle(A2, edits)))

    def test_served_model_swap(self):
        r = self.mutated({"worker-diagnostics.tsv": tsv_edit(set_cell({"task_id": CODER}, "served_model", "claude-opus-5"))})
        self.assertNotIn("SERVED_MODEL_MISMATCH", codes(r))  # usage_key still names the requested model: EXACT by rule
        r = self.mutated({"worker-diagnostics.tsv": tsv_edit(lambda h, rows: set_cell({"task_id": CODER}, "served_model_usage_key", "claude-opus-5")(
            h, set_cell({"task_id": CODER}, "served_model_usage_canonical", "claude-opus-5")(
                h, set_cell({"task_id": CODER}, "served_model", "claude-opus-5")(h, rows))))})
        self.assertIn("SERVED_MODEL_MISMATCH", codes(r))

    def test_unattested_coder(self):
        r = self.mutated({"worker-diagnostics.tsv": tsv_edit(set_cell({"task_id": CODER}, "served_model_basis", "init"))})
        self.assertIn("SERVED_MODEL_NOT_ATTESTED", codes(r))

    def test_recorded_latency_clears_the_finding(self):
        r = self.mutated({"worker-diagnostics.tsv": tsv_edit(set_cell({"task_id": CODER}, "elapsed_ms", "23781"))})
        self.assertNotIn("LATENCY_UNRECORDED", codes(r))
        coder = next(x for x in r["roles"] if x["role"] == "CODING_AGENT")
        self.assertEqual(coder["latency"]["elapsedMs"], {"value": 23781})

    def test_duplicate_settlement(self):
        r = self.mutated({"settlement-integrity.tsv": tsv_edit(
            lambda h, rows: [["run:efb6e20f0d11885bc5085a68", "resv-1", "CODING_AGENT", "2"]])})
        self.assertIn("DUPLICATE_SETTLEMENT", codes(r))
        self.assertEqual(r["mission"]["duplicateSettlements"], {"value": 1})

    def test_open_invocation(self):
        r = self.mutated({"tool-invocations.tsv": tsv_edit(lambda h, rows: [
            [c if h[i] != "state" else ("DISPATCHING" if n == 0 else c) for i, c in enumerate(row)] for n, row in enumerate(rows)])})
        self.assertIn("OPEN_INVOCATION", codes(r))

    def test_empty_diff_on_completed_run(self):
        r = self.mutated({"workspace.diff": lambda t: "", "workspace-status.txt": lambda t: ""})
        self.assertIn("DIFF_UNREADABLE", codes(r))  # both empty: unreadable (R-B3), flagged on a COMPLETED run
        # Readable, but changing nothing: the R-B4 defect itself.
        r = self.mutated({"workspace.diff": lambda t: "(no changes)\n", "workspace-status.txt": lambda t: ""})
        self.assertIn("EMPTY_DIFF_ON_COMPLETED_RUN", codes(r))
        r = self.mutated({"workspace.diff": lambda t: "", "workspace-status.txt": lambda t: "?? nothing\n"})
        self.assertNotIn("EMPTY_DIFF_ON_COMPLETED_RUN", codes(r))

    def test_diff_outside_permitted_paths(self):
        report = analyze_bundle(load_bundle(A2), permitted_paths=("src/relay/workspace/julius-tools/other.ts",))
        self.assertIn("DIFF_OUTSIDE_PERMITTED_PATHS", codes(report))
        report = analyze_bundle(load_bundle(A2), permitted_paths=("src/relay/workspace/julius-tools/node-tool-adapter.ts",))
        self.assertNotIn("DIFF_OUTSIDE_PERMITTED_PATHS", codes(report))

    def test_two_result_lines_are_ambiguous(self):
        r = self.mutated({"live-mission.evidence.txt": lambda t: t + "RESULT: FAILED after 9 ticks\n"})
        self.assertIn("AMBIGUOUS_RESULT", codes(r))
        self.assertIn("unknown", r["mission"]["ticks"])

    def test_result_disagreeing_with_runs(self):
        r = self.mutated({"runs.tsv": tsv_edit(set_cell({}, "state", "VERIFYING"))})
        self.assertIn("RESULT_DISAGREES_WITH_RUNS", codes(r))

    def test_run_failed_event_beats_runs_state(self):
        r = self.mutated({"failures.tsv": tsv_edit(lambda h, rows: [[
            {"run_id": "run:efb6e20f0d11885bc5085a68", "event_type": "julius.run.failed"}.get(col, "") for col in h]])})
        self.assertIn("RUN_FAILED_EVENT_BUT_STATE", codes(r))

    def test_stale_evidence_accept(self):
        r = self.mutated({"worker-diagnostics.tsv": tsv_edit(set_cell({"task_id": CODER}, "dispatch_attempt", "2"))})
        self.assertIn("STALE_EVIDENCE_ACCEPT", codes(r))

    def test_tracked_changes(self):
        r = self.mutated({"bundle-manifest.txt": set_manifest(tracked_changes="3")})
        self.assertIn("TRACKED_CHANGES_NONZERO", codes(r))

    def test_unreadable_source_is_reported_never_clean(self):
        r = self.mutated({"worker-diagnostics.tsv": lambda t: "unavailable\n"})
        self.assertIn("EVIDENCE_UNREADABLE", codes(r))
        self.assertIn("unknown", r["roles"])
        self.assertFalse(r["completeness"]["complete"])

    def test_zero_cost_for_unknown_api_cost(self):
        r = self.mutated({"worker-diagnostics.tsv": tsv_edit(set_cell({"role": "PROMPT_ARCHITECT"}, "cost_usd_micros", "0"))})
        self.assertIn("UNKNOWN_COST_RECORDED_AS_ZERO", codes(r))


class HelperTests(unittest.TestCase):
    def test_served_model_rule(self):
        self.assertEqual(served_model_match("claude-opus-5-5", "claude-opus-5-5"), "EXACT")
        self.assertEqual(served_model_match("claude-opus-5-5", "x", "claude-opus-5-5"), "EXACT")
        self.assertEqual(served_model_match("claude-opus-5-5", "claude-opus-5-5-20261001"), "DATED_BUILD")
        self.assertEqual(served_model_match("claude-opus-5-5", "claude-opus-5"), "MISMATCH")
        # Never a prefix: "claude-opus-5-5-mini" is another model, not a dated build.
        self.assertEqual(served_model_match("claude-opus-5-5", "claude-opus-5-5-mini"), "MISMATCH")
        self.assertEqual(served_model_match("claude-opus-5-5", ""), "UNATTESTED")

    def test_evidence_generation(self):
        self.assertEqual(evidence_generation("tool:run:x:build:diff:g1"), 1)
        self.assertEqual(evidence_generation("run:x:build:2:0"), 2)
        self.assertIsNone(evidence_generation("finding:abc"))

    def test_digests(self):
        tmp = TempDirs()
        try:
            path = tmp.bundle(A2)
            target = os.path.join(path, "runs.tsv")
            digest = sha256_file(target)
            self.assertEqual(verify_artifact(target, "sha256:" + digest)["verdict"], "MATCH")
            self.assertEqual(verify_artifact(target, "0" * 64)["verdict"], "MISMATCH")
            with open(os.path.join(path, "SHA256SUMS"), "w", encoding="utf-8") as handle:
                handle.write(f"{digest}  runs.tsv\n{'0' * 64}  missing.tsv\n")
            result = verify_sums(path)
            self.assertEqual(result["verdict"], "MISMATCH")
            self.assertEqual({f["file"]: f["verdict"] for f in result["files"]}, {"runs.tsv": "MATCH", "missing.tsv": "MISSING"})
        finally:
            tmp.cleanup()

    def test_cross_run_resolution_needs_a_readable_source(self):
        a1 = analyze_bundle(load_bundle(A1))
        a2 = analyze_bundle(load_bundle(A2))
        verdicts = compare_anomalies([a1, a2])["codes"]
        self.assertEqual(verdicts["OPEN_INVOCATION"]["status"], "RESOLVED")
        self.assertEqual(verdicts["SERVED_MODEL_NOT_ATTESTED"]["status"], "RESOLVED")
        self.assertEqual(verdicts["LATENCY_UNRECORDED"]["status"], "PERSISTENT")
        self.assertEqual(verdicts["CODER_REPORT_REFUSED"]["status"], "NEW")


class RunScopeTests(unittest.TestCase):
    """One bundle, one run: a WITH arm's restored store is read for its own run, a single run as before."""

    def setUp(self):
        self.tmp = TempDirs()

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_single_run_bundle_is_read_exactly_as_before(self):
        raw = load_bundle(A2)
        report = analyze_bundle(raw)
        self.assertEqual(report["runScope"], {"runs": [A2_RUN], "run": A2_RUN, "basis": "manifest", "scoped": False,
                                              "reason": None})
        self.assertEqual({r["file"]: (r["status"], r["rows"], r["problems"]) for r in report["inventory"] if r["file"].endswith(".tsv")},
                         {f"{n}.tsv": (t.status, len(t.rows), list(t.problems)) for n, t in raw.tables.items()})
        # No learning record, so no contract digest or runtime: None, never inferred.
        self.assertEqual((report["binding"]["contractDigest"], report["binding"]["runtimeVersion"]), (None, None))
        self.assertEqual(report["learning"], {"unknown": "learning.tsv is MISSING"})

    def test_a_with_arm_s_bundle_keeps_only_its_own_rows(self):
        own, inherited = julius(0xC1), julius(0xA1)
        report = analyze_bundle(load_bundle(arm_bundle(self.tmp, "0" * 64, own, "43", without=inherited, inherited_repairs=2)))
        self.assertTrue(report["completeness"]["complete"], report["completeness"])
        self.assertEqual(len(report["roles"]), 4)
        self.assertEqual(report["mission"]["repairRounds"], {"value": 0})
        status = {r["file"]: r["status"] for r in report["inventory"]}
        # sessions.tsv is scoped by mission, not run, and both arms run one mission: it cannot be attributed.
        self.assertEqual(status["sessions.tsv"], "UNATTRIBUTED")
        sessions = next(r for r in report["inventory"] if r["file"] == "sessions.tsv")
        self.assertEqual(sessions["problems"], [f"no run_id column: its rows cannot be scoped to {own}"])
        self.assertEqual(status["runs.tsv"], "PRESENT")

    def test_a_row_naming_no_run_in_a_two_run_bundle_is_unattributed(self):
        own, inherited = julius(0xC1), julius(0xA1)
        path = arm_bundle(self.tmp, "0" * 64, own, "43", without=inherited)
        with open(os.path.join(path, "budget.tsv"), encoding="utf-8", newline="") as handle:
            budget = handle.read()
        with open(os.path.join(path, "budget.tsv"), "w", encoding="utf-8", newline="") as handle:
            handle.write(tsv_edit(set_cell({"run_id": inherited}, "run_id", ""))(budget))
        report = analyze_bundle(load_bundle(path))
        budget_row = next(r for r in report["inventory"] if r["file"] == "budget.tsv")
        self.assertEqual(budget_row["status"], "UNATTRIBUTED")
        self.assertFalse(report["completeness"]["complete"])


if __name__ == "__main__":
    unittest.main()
