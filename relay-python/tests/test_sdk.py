"""Unit tests for the Julius SDK, run with: python -m unittest discover -s relay-python/tests"""

import json
import math
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from julius import _session, artifacts, brain, evidence, result  # noqa: E402
from julius.errors import JuliusBrainValidationError  # noqa: E402

SCHEMA = os.path.join(ROOT, "julius", "brain_schema.json")


def entity(entity_id, kind, body, lifecycle="ACTIVE", mission="mission:t", task=None, inbound=()):
    return {
        "entityId": entity_id, "kind": kind, "version": 1, "lifecycle": lifecycle, "body": body,
        "scope": {"missionId": mission, "runId": None, "taskId": task}, "confidence": None,
        "supersededBy": None, "createdBy": {"kind": "JULIUS", "id": "julius", "role": None, "onBehalfOf": None, "grantId": None},
        "links": [], "inbound": list(inbound),
    }


class SdkTestCase(unittest.TestCase):
    def setUp(self):
        _session.reset_for_tests()
        self.dir = tempfile.mkdtemp(prefix="julius-sdk-")
        os.makedirs(os.path.join(self.dir, "out"))
        context = {
            "format": "julius-brain-evaluation-context.v1", "brainId": "brain:t", "throughSequence": 7,
            "snapshotHash": "sha256:" + "1" * 64,
            "entities": [
                entity("objective:1", "OBJECTIVE", {"statement": "Measure latency", "successMeasure": None}),
                entity("constraint:1", "CONSTRAINT", {"statement": "No network", "status": "ACTIVE"}),
                entity("constraint:2", "CONSTRAINT", {"statement": "Maybe", "status": "PROPOSED"}),
                entity("decision:old", "DECISION", {"decisionClass": "MISSION", "statement": "files", "rationale": "x", "alternatives": [], "status": "ACTIVE"}, lifecycle="SUPERSEDED"),
                entity("decision:new", "DECISION", {"decisionClass": "MISSION", "statement": "ledger", "rationale": "y", "alternatives": [], "status": "ACTIVE"}),
                entity("evidence:1", "EVIDENCE", {"evidenceClass": "MEASUREMENT", "claim": "p95 under 5ms", "summary": "4.1", "status": "PASSED", "verification": "UNVERIFIED", "data": None, "juliusEvidenceId": None},
                       inbound=[{"relation": "CONTRADICTS", "source": "evidence:2", "sourceKind": "EVIDENCE"}]),
            ],
        }
        paths = {name: os.path.join(self.dir, name) for name in ("context.json", "result.json", "proposals.jsonl")}
        with open(paths["context.json"], "w", encoding="utf-8") as handle:
            json.dump(context, handle)
        self.control = {
            "executionId": "exec-1", "missionId": "mission:t", "taskId": "task-1", "inputs": {"rows": [1, 2, 3]},
            "outputDir": os.path.join(self.dir, "out"), "writeGrant": {"kinds": ["EVIDENCE", "EVAL", "FINDING", "ARTIFACT", "TRACE", "MEMORY_FACT"], "maxRecords": 5},
            "contextPath": paths["context.json"], "schemaPath": SCHEMA, "resultPath": paths["result.json"], "proposalsPath": paths["proposals.jsonl"],
        }
        _session.configure(self.control)

    def tearDown(self):
        _session.reset_for_tests()
        shutil.rmtree(self.dir, ignore_errors=True)

    def read_outputs(self):
        _session.flush()
        with open(self.control["resultPath"], encoding="utf-8") as handle:
            result_doc = json.load(handle)
        with open(self.control["proposalsPath"], encoding="utf-8") as handle:
            proposals = [json.loads(line) for line in handle if line.strip()]
        return result_doc, proposals


class ReadTests(SdkTestCase):
    def test_reads_only_the_granted_snapshot(self):
        self.assertEqual(brain.get_objective().get("statement"), "Measure latency")
        self.assertEqual([c.entity_id for c in brain.get_constraints()], ["constraint:1"])
        self.assertEqual([d.entity_id for d in brain.list_decisions()], ["decision:new"])
        self.assertEqual(len(brain.list_decisions(include_superseded=True)), 2)
        self.assertEqual(brain.query_evidence(claim="P95")[0].contradicted_by(), ["evidence:2"])
        self.assertEqual(brain.through_sequence(), 7)
        self.assertEqual(brain.inputs(), {"rows": [1, 2, 3]})

    def test_entity_body_is_a_copy(self):
        objective = brain.get_objective()
        body = objective.body
        body["statement"] = "changed"
        self.assertEqual(brain.get_objective().get("statement"), "Measure latency")


class StagingTests(SdkTestCase):
    def test_staged_records_are_proposals_with_links(self):
        measured = brain.record_evidence(evidence.Measurement("p95_ms", 4.1, "ms", status=evidence.PASSED), supports=["objective:1"])
        self.assertEqual(measured.status, "STAGED")
        brain.record_eval(evidence.EvaluationResult("latency", "ENTITY", "objective:1", "PASS", score=1, max_score=1, seed=7), evidenced_by=[measured])
        result.set({"p95": 4.1})
        result.metric("p95", 4.1, "ms")
        result_doc, proposals = self.read_outputs()
        self.assertEqual(result_doc["format"], "julius-python-result.v1")
        self.assertTrue(result_doc["valueSet"])
        self.assertEqual(result_doc["metrics"], [{"name": "p95", "unit": "ms", "value": 4.1}])
        self.assertEqual([p["kind"] for p in proposals], ["EVIDENCE", "EVAL"])
        self.assertEqual(proposals[0]["body"]["verification"], "UNVERIFIED")
        self.assertEqual(proposals[1]["links"], [{"relation": "EVIDENCED_BY", "target": "proposal:p0001"}])
        self.assertIsNone(proposals[1]["body"]["reproducibility"]["codeHash"], "reproducibility is the host's to fill")

    def test_refuses_what_the_brain_would_refuse(self):
        with self.assertRaises(JuliusBrainValidationError):
            brain.record_evidence(evidence.Measurement("x", float("nan")))
        with self.assertRaises(JuliusBrainValidationError):
            result.set({"bad": math.inf})
        with self.assertRaises(JuliusBrainValidationError):
            brain.record_finding("drift", severity="APOCALYPTIC")
        with self.assertRaises(JuliusBrainValidationError):
            brain._stage("DECISION", {"decisionClass": "MISSION", "statement": "s", "rationale": "r", "alternatives": [], "status": "ACTIVE"})
        with self.assertRaises(JuliusBrainValidationError):
            brain.record_evidence(evidence.Observation("c", "s"), supports=[object()])

    def test_the_grant_limits_the_number_of_records(self):
        for index in range(5):
            brain.trace("step %d" % index)
        with self.assertRaises(JuliusBrainValidationError):
            brain.trace("one too many")

    def test_tool_findings_never_block_and_memory_is_unverified(self):
        brain.record_finding("drift detected", severity="HIGH")
        brain.remember("latency is bimodal")
        _, proposals = self.read_outputs()
        self.assertFalse(proposals[0]["body"]["blocking"])
        self.assertEqual(proposals[1]["body"]["trust"], "UNVERIFIED")
        self.assertEqual(proposals[1]["retention"], "WORKING")

    def test_artifacts_must_exist_and_hashes_are_not_claimed(self):
        with self.assertRaises(JuliusBrainValidationError):
            brain.register_artifact("missing.csv")
        with self.assertRaises(JuliusBrainValidationError):
            artifacts.write("../escape.txt", "x")
        artifacts.write("table.csv", "a,b\n1,2\n")
        brain.register_artifact("table.csv", "DATASET", "text/csv")
        _, proposals = self.read_outputs()
        self.assertEqual(proposals[0]["artifactName"], "table.csv")
        self.assertEqual(proposals[0]["body"]["storageRef"], "pending://julius-host")


class EvidenceVocabularyTests(unittest.TestCase):
    def test_unknown_is_none_never_zero(self):
        comparison = evidence.Comparison("p95", baseline=None, candidate=4.0)
        body = comparison.body()
        self.assertEqual(body["status"], "INCONCLUSIVE")
        self.assertIsNone(body["data"]["delta"])
        self.assertIsNone(body["data"]["relativeChange"])

    def test_comparison_direction_and_tolerance(self):
        self.assertEqual(evidence.Comparison("p95", 5.0, 4.0, better="LOWER").body()["status"], "PASSED")
        self.assertEqual(evidence.Comparison("acc", 0.9, 0.85, better="HIGHER").body()["status"], "FAILED")
        self.assertEqual(evidence.Comparison("acc", 0.9, 0.89, better="HIGHER", tolerance=0.02).body()["status"], "PASSED")

    def test_assertion_table_series_and_experiment(self):
        self.assertEqual(evidence.Assertion("rows", 3, 3).body()["status"], "PASSED")
        with self.assertRaises(ValueError):
            evidence.Table("t", ["a", "b"], [[1]])
        self.assertEqual(len(evidence.MetricSeries("loss", [(1, 0.5), (2, 0.4)]).body()["data"]["points"]), 2)
        self.assertEqual(evidence.ExperimentResult("ab", "B is faster", "REFUTED").body()["status"], "FAILED")


class SessionTests(unittest.TestCase):
    def test_outside_an_execution_the_sdk_says_so(self):
        _session.reset_for_tests()
        previous = os.environ.pop("JULIUS_PYTHON_CONTROL", None)
        try:
            from julius.errors import JuliusSessionError
            with self.assertRaises(JuliusSessionError):
                brain.get_objective()
        finally:
            if previous is not None:
                os.environ["JULIUS_PYTHON_CONTROL"] = previous


if __name__ == "__main__":
    unittest.main()
