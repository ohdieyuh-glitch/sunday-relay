import unittest

from helpers import A1, A2, TempDirs, set_manifest
from julius_brain_intel.boundary import load_bundle
from julius_brain_intel.evals import (
    bootstrap_diff_ci, cliffs_delta, compare_runs, extract_metrics, marginal_value, mission_quality, permutation_p,
)
from julius_brain_intel.evidence_analysis import analyze_bundle
from julius_brain_intel.known import Unknown


def ticks(n):
    return lambda text: text.replace("RESULT: COMPLETED after 4 ticks", f"RESULT: COMPLETED after {n} ticks")


class MetricTests(unittest.TestCase):
    def test_attempt_2_metrics(self):
        metrics, defs = extract_metrics(analyze_bundle(load_bundle(A2)))
        self.assertEqual(metrics["mission.completed"], 1)
        self.assertEqual(metrics["mission.ticks"], 4)
        self.assertEqual(metrics["role.PROMPT_ARCHITECT.elapsed_ms"], 50543)
        self.assertIsInstance(metrics["role.CODING_AGENT.elapsed_ms"], Unknown)
        # Two reviews: summed only because both recorded their time.
        self.assertEqual(metrics["role.INDEPENDENT_REVIEWER.elapsed_ms"], 71810 + 41844)
        self.assertIn("mission.ticks", {d.name for d in defs})

    def test_attempt_1_is_not_completed(self):
        metrics, _ = extract_metrics(analyze_bundle(load_bundle(A1)))
        self.assertEqual(metrics["mission.completed"], 0)


class CompareTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TempDirs()
        self.a2 = analyze_bundle(load_bundle(A2))

    def tearDown(self):
        self.tmp.cleanup()

    def clone(self, run_id, n_ticks):
        return analyze_bundle(load_bundle(self.tmp.bundle(A2, {
            "bundle-manifest.txt": set_manifest(workflow_run_id=run_id), "live-mission.evidence.txt": ticks(n_ticks)})))

    def test_unmatched_runs_never_read_as_improvement(self):
        # a1 FAILED, a2 COMPLETED: "completed" went up -- but the coder model changed and a1 has no manifest.
        report = compare_runs(analyze_bundle(load_bundle(A1)), self.a2, guarded=["mission.completed"])
        self.assertFalse(report["match"]["matched"])
        self.assertTrue(report["confounded"])
        self.assertEqual(next(r for r in report["metrics"] if r["metric"] == "mission.completed")["status"], "IMPROVED")
        self.assertEqual(report["verdict"], "INCONCLUSIVE")

    def test_identical_runs_are_no_change(self):
        report = compare_runs(self.a2, self.clone("1", 4), guarded=["mission.completed", "mission.ticks"])
        self.assertTrue(report["match"]["matched"])
        self.assertEqual(report["verdict"], "NO_CHANGE")

    def test_more_ticks_is_a_regression(self):
        report = compare_runs(self.a2, self.clone("2", 6), guarded=["mission.ticks"])
        self.assertEqual(report["verdict"], "REGRESSION")

    def test_fewer_ticks_on_a_matched_run_is_an_improvement(self):
        report = compare_runs(self.clone("3", 6), self.a2, guarded=["mission.ticks"])
        self.assertEqual(report["verdict"], "IMPROVEMENT")

    def test_tolerance(self):
        report = compare_runs(self.a2, self.clone("4", 5), tolerances={"mission.ticks": 1}, guarded=["mission.ticks"])
        self.assertEqual(report["verdict"], "NO_CHANGE")

    def test_an_unknown_guarded_metric_is_inconclusive_not_clean(self):
        # The coder's latency is Unknown in attempt 2: guarding it can never yield NO_CHANGE.
        report = compare_runs(self.a2, self.clone("5", 4), guarded=["role.CODING_AGENT.elapsed_ms"])
        self.assertEqual(report["verdict"], "INCONCLUSIVE")

    def test_every_report_disclaims_readiness(self):
        report = compare_runs(self.a2, self.a2)
        self.assertIn("awards no beta-readiness credit", report["authority"])


class StatsTests(unittest.TestCase):
    def test_bootstrap_is_seeded_and_refuses_one_point(self):
        a, b = [10, 12, 11, 13], [20, 21, 19, 22]
        self.assertEqual(bootstrap_diff_ci(a, b, seed=7), bootstrap_diff_ci(a, b, seed=7))
        lo, hi = bootstrap_diff_ci(a, b, seed=7)
        self.assertGreater(lo, 0)
        self.assertIsInstance(bootstrap_diff_ci([1], [2]), Unknown)

    def test_permutation_exact(self):
        self.assertAlmostEqual(permutation_p([1, 2, 3], [10, 11, 12]), 2 / 20)  # the two extreme labelings of 20
        self.assertEqual(permutation_p([5, 5, 5], [5, 5, 5]), 1.0)

    def test_cliffs_delta(self):
        self.assertEqual(cliffs_delta([1, 2], [3, 4]), 1.0)
        self.assertEqual(cliffs_delta([3, 4], [1, 2]), -1.0)
        self.assertIsInstance(cliffs_delta([], [1]), Unknown)


class MarginalValueTests(unittest.TestCase):
    def test_clear_value(self):
        r = marginal_value("fuzzy-ranker", "mission.ticks", "lower", [4, 4, 5, 4, 4], [7, 8, 7, 9, 8])
        self.assertEqual(r["verdict"], "VALUE")

    def test_no_detectable_value_when_the_arms_overlap(self):
        r = marginal_value("fuzzy-ranker", "mission.ticks", "lower", [5, 7, 4, 8, 6], [6, 5, 8, 4, 7])
        self.assertEqual(r["verdict"], "NO_DETECTABLE_VALUE")

    def test_harm(self):
        r = marginal_value("fuzzy-ranker", "mission.ticks", "lower", [9, 10, 9, 11], [4, 5, 4, 5])
        self.assertEqual(r["verdict"], "HARM")

    def test_one_pair_is_insufficient(self):
        r = marginal_value("fuzzy-ranker", "mission.ticks", "lower", [3], [9])
        self.assertEqual(r["verdict"], "INSUFFICIENT")

    def test_an_unknown_run_makes_it_unknown(self):
        r = marginal_value("m", "role.CODING_AGENT.elapsed_ms", "lower", [Unknown("not recorded"), 5], [6, 7])
        self.assertEqual(r["verdict"], "UNKNOWN")

    def test_min_effect_is_respected(self):
        r = marginal_value("m", "mission.ticks", "lower", [4.0, 4.1, 4.0, 4.1], [4.4, 4.5, 4.4, 4.5], min_effect=1.0)
        self.assertNotEqual(r["verdict"], "VALUE")

    def test_neutral_metric_is_refused(self):
        with self.assertRaises(ValueError):
            marginal_value("m", "mission.diff_paths", "neutral", [1, 2], [1, 2])


class QualityTests(unittest.TestCase):
    def test_attempt_2(self):
        q = mission_quality(analyze_bundle(load_bundle(A2)))
        status = {c["check"]: c["status"] for c in q["checks"]}
        self.assertEqual(status["completed"], "PASS")
        self.assertEqual(status["every role served its requested model"], "PASS")
        self.assertEqual(status["every role's latency recorded"], "FAIL")
        self.assertEqual(status["no acceptance criterion missing at verification"], "PASS")

    def test_attempt_1_unknowns_are_counted_apart(self):
        q = mission_quality(analyze_bundle(load_bundle(A1)))
        status = {c["check"]: c["status"] for c in q["checks"]}
        self.assertEqual(status["completed"], "FAIL")
        self.assertEqual(status["no open blocking finding"], "UNKNOWN")
        self.assertGreater(q["counts"]["UNKNOWN"], 0)
        known = q["counts"]["PASS"] + q["counts"]["FAIL"]
        self.assertAlmostEqual(q["passRateOfKnown"], q["counts"]["PASS"] / known)


if __name__ == "__main__":
    unittest.main()
