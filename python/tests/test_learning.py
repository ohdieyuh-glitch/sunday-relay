import copy
import unittest

from helpers import A2, TempDirs, set_manifest
from julius_brain_intel.boundary import load_bundle
from julius_brain_intel.evidence_analysis import analyze_bundle
from julius_brain_intel.learning import RegistrationError, evaluate_learning, parse_registration

REGISTERED = "2026-10-02T09:00:00Z"
BEFORE = "2026-10-02T08:00:00Z"


def registration(**over):
    raw = {
        "schemaVersion": "julius.learning-registration.v1",
        "registrationId": "learn-001",
        "registeredAt": REGISTERED,
        "hypothesis": "Carrying the prior mission's unresolved findings shortens the next mission.",
        "weakness": {"description": "the coder re-discovers a defect the last mission already found",
                     "evidence": ["run 36915013287 scope.tsv seq 54"]},
        "adaptation": {"kind": "context", "description": "carry unresolved findings", "changeRef": "commit:abc1234"},
        "baselineRuns": ["B1", "B2", "B3"],
        "metrics": [{"name": "mission.ticks", "expectedDirection": "lower", "minEffect": 1, "primary": True},
                    {"name": "mission.completed", "expectedDirection": "higher", "minEffect": 0, "primary": False}],
        "confounders": ["commit"],
        "minRunsPerSide": 3,
    }
    raw.update(over)
    return raw


def ticks(n):
    return lambda text: text.replace("RESULT: COMPLETED after 4 ticks", f"RESULT: COMPLETED after {n} ticks")


class RegistrationTests(unittest.TestCase):
    def test_valid_and_hashed(self):
        reg = parse_registration(registration())
        self.assertTrue(reg.digest().startswith("sha256:"))
        self.assertEqual(reg.digest(), parse_registration(registration()).digest())
        self.assertNotEqual(reg.digest(), parse_registration(registration(hypothesis="something else")).digest())

    def test_refusals(self):
        cases = {
            "no evidence for the weakness": registration(weakness={"description": "a hunch", "evidence": []}),
            "no change ref": registration(adaptation={"kind": "context", "description": "x", "changeRef": ""}),
            "two primaries": registration(metrics=[
                {"name": "mission.ticks", "expectedDirection": "lower", "primary": True},
                {"name": "mission.completed", "expectedDirection": "higher", "primary": True}]),
            "no direction": registration(metrics=[{"name": "mission.ticks", "expectedDirection": "better", "primary": True}]),
            "negative min effect": registration(metrics=[
                {"name": "mission.ticks", "expectedDirection": "lower", "minEffect": -1, "primary": True}]),
            "bad timestamp": registration(registeredAt="yesterday"),
            "wrong schema": registration(schemaVersion="julius.learning-registration.v0"),
        }
        for name, raw in cases.items():
            with self.assertRaises(RegistrationError, msg=name):
                parse_registration(raw)


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TempDirs()

    def tearDown(self):
        self.tmp.cleanup()

    def run_(self, run_id, n_ticks, commit=None):
        manifest = {"workflow_run_id": run_id}
        if commit:
            manifest["commit"] = commit
        return analyze_bundle(load_bundle(self.tmp.bundle(A2, {
            "bundle-manifest.txt": set_manifest(**manifest), "live-mission.evidence.txt": ticks(n_ticks)})))

    def arms(self, base_ticks, cand_ticks, cand_commit=None):
        base = [self.run_(f"B{i + 1}", t) for i, t in enumerate(base_ticks)]
        cand = [self.run_(f"C{i + 1}", t, cand_commit) for i, t in enumerate(cand_ticks)]
        started = {f"C{i + 1}": "2026-10-02T10:00:00Z" for i in range(len(cand_ticks))}
        return base, cand, started

    def evaluate(self, reg_over=None, **arms):
        reg = parse_registration(registration(**(reg_over or {})))
        base, cand, started = self.arms(**arms)
        return evaluate_learning(reg, base, cand, started)

    def test_retain_on_a_clear_matched_improvement(self):
        out = self.evaluate(base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        self.assertEqual(out["verdict"], "RETAIN", out["reasons"])

    def test_a_second_success_is_not_learning(self):
        # Both arms complete: the binary metric cannot move, so "it worked again" is REJECT, never RETAIN.
        out = self.evaluate({"metrics": [{"name": "mission.completed", "expectedDirection": "higher", "minEffect": 0,
                                          "primary": True}]}, base_ticks=[4, 4, 4], cand_ticks=[4, 4, 4])
        self.assertEqual(out["verdict"], "REJECT")

    def test_one_repeat_success_is_not_even_provisional(self):
        # The founder's exact case: one baseline success, one later success, nothing measured moved.
        # No interval can be formed with one pair -- and it must still be REJECT, not PROVISIONAL.
        out = self.evaluate({"baselineRuns": ["B1"], "minRunsPerSide": 3,
                             "metrics": [{"name": "mission.completed", "expectedDirection": "higher", "minEffect": 0,
                                          "primary": True}]}, base_ticks=[4], cand_ticks=[4])
        self.assertEqual(out["verdict"], "REJECT", out["reasons"])

    def test_the_registered_minimum_is_enforced_above_the_statistical_floor(self):
        # Two runs per side CAN form an interval, but this registration demanded three.
        out = self.evaluate({"baselineRuns": ["B1", "B2"], "minRunsPerSide": 3}, base_ticks=[8, 9], cand_ticks=[4, 4])
        self.assertEqual(out["verdict"], "PROVISIONAL", out["reasons"])

    def test_no_improvement_is_rejected(self):
        out = self.evaluate(base_ticks=[5, 6, 5], cand_ticks=[6, 5, 6])
        self.assertEqual(out["verdict"], "REJECT")

    def test_overlapping_arms_are_rejected_by_the_interval(self):
        out = self.evaluate(base_ticks=[4, 9, 5], cand_ticks=[3, 8, 4])
        self.assertIn(out["verdict"], ("REJECT",), out["reasons"])

    def test_one_pair_is_provisional_at_best(self):
        out = self.evaluate({"baselineRuns": ["B1"], "minRunsPerSide": 3}, base_ticks=[8], cand_ticks=[4])
        self.assertEqual(out["verdict"], "PROVISIONAL")

    def test_registration_after_the_run_is_invalid(self):
        reg = parse_registration(registration())
        base, cand, _ = self.arms(base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        out = evaluate_learning(reg, base, cand, {"C1": BEFORE, "C2": BEFORE, "C3": BEFORE})
        self.assertEqual(out["verdict"], "INVALID")

    def test_unrecorded_start_is_invalid(self):
        reg = parse_registration(registration())
        base, cand, _ = self.arms(base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        self.assertEqual(evaluate_learning(reg, base, cand, {})["verdict"], "INVALID")

    def test_wrong_baseline_is_invalid(self):
        out = self.evaluate({"baselineRuns": ["X1", "X2", "X3"]}, base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        self.assertEqual(out["verdict"], "INVALID")

    def test_unmatched_runs_are_invalid(self):
        reg = parse_registration(registration())
        base, cand, started = self.arms(base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        tampered = copy.deepcopy(cand[0])
        tampered["binding"]["mode"] = "preflight"
        out = evaluate_learning(reg, base, [tampered] + cand[1:], started)
        self.assertEqual(out["verdict"], "INVALID")

    def test_a_declared_confounder_blocks_a_conclusion(self):
        out = self.evaluate(base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5], cand_commit="f" * 40)
        self.assertEqual(out["verdict"], "INCONCLUSIVE")
        self.assertEqual(out["confounders"][0]["key"], "commit")

    def test_unknown_primary_is_inconclusive(self):
        out = self.evaluate({"metrics": [{"name": "role.CODING_AGENT.elapsed_ms", "expectedDirection": "lower",
                                          "minEffect": 0, "primary": True}]},
                            base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        self.assertEqual(out["verdict"], "INCONCLUSIVE")

    def test_the_outcome_names_its_registration(self):
        out = self.evaluate(base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        self.assertEqual(out["registrationDigest"], parse_registration(registration()).digest())
        self.assertIn("awards no beta-readiness credit", out["authority"])


if __name__ == "__main__":
    unittest.main()
