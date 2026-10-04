import copy
import unittest

from helpers import A2, CONTRACT, RUNTIME, TempDirs, arm_bundle, arm_record, julius, set_manifest
from julius_brain_intel.boundary import load_bundle
from julius_brain_intel.evidence_analysis import analyze_bundle
from julius_brain_intel.learning import RegistrationError, evaluate_learning, parse_registration

REGISTERED = "2026-10-02T09:00:00Z"
BEFORE = "2026-10-02T08:00:00Z"
AFTER = "2026-10-02T10:00:00Z"


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
        "confounders": ["tree"],
        "minRunsPerSide": 3,
    }
    raw.update(over)
    return raw


def digest(reg):
    """What an arm's contract carries: the digest learning-validate printed, without its prefix."""
    return reg.digest().split(":", 1)[1]


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
            "matched on the Julius run id": registration(matchedOn=["juliusRunId", "mode", "requestedModels"]),
            "matched on the workflow run id": registration(matchedOn=["contractDigest", "workflowRunId"]),
        }
        for name, raw in cases.items():
            with self.assertRaises(RegistrationError, msg=name):
                parse_registration(raw)

    def test_the_default_match_is_the_preregistered_keys_and_never_a_run_id(self):
        # MATCHED_PAIR_PREREG §3: contract digest, mode, requested models, runtimeVersion and the main commit.
        reg = parse_registration(registration())
        self.assertEqual(reg.matched_on, ("contractDigest", "mode", "requestedModels", "runtimeVersion", "commit"))


class EvaluationTests(unittest.TestCase):
    """The verdicts, over arms that are each a run of their own and recorded themselves."""

    def setUp(self):
        self.tmp = TempDirs()

    def tearDown(self):
        self.tmp.cleanup()

    def run_(self, reg, workflow_run, run_id, n_ticks, without=None, **manifest):
        return analyze_bundle(load_bundle(arm_bundle(self.tmp, digest(reg), run_id, workflow_run, n_ticks=n_ticks,
                                                     records=[arm_record(run_id, "WITH" if without else "WITHOUT",
                                                                         digest(reg), without=without)],
                                                     **manifest)))

    def arms(self, reg, base_ticks, cand_ticks, cand_tree=None, cand_commit=None):
        base = [self.run_(reg, f"B{i + 1}", julius(i + 1), t) for i, t in enumerate(base_ticks)]
        extra = {k: v for k, v in (("tree", cand_tree), ("commit", cand_commit)) if v}
        cand = [self.run_(reg, f"C{i + 1}", julius(101 + i), t, without=julius(i % len(base_ticks) + 1), **extra)
                for i, t in enumerate(cand_ticks)]
        started = {f"C{i + 1}": AFTER for i in range(len(cand_ticks))}
        return base, cand, started

    def evaluate(self, reg_over=None, **arms):
        reg = parse_registration(registration(**(reg_over or {})))
        base, cand, started = self.arms(reg, **arms)
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
        base, cand, _ = self.arms(reg, base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        out = evaluate_learning(reg, base, cand, {"C1": BEFORE, "C2": BEFORE, "C3": BEFORE})
        self.assertEqual(out["verdict"], "INVALID")

    def test_unrecorded_start_is_invalid(self):
        reg = parse_registration(registration())
        base, cand, _ = self.arms(reg, base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        self.assertEqual(evaluate_learning(reg, base, cand, {})["verdict"], "INVALID")

    def test_wrong_baseline_is_invalid(self):
        out = self.evaluate({"baselineRuns": ["X1", "X2", "X3"]}, base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        self.assertEqual(out["verdict"], "INVALID")

    def test_unmatched_runs_are_invalid(self):
        reg = parse_registration(registration())
        base, cand, started = self.arms(reg, base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        tampered = copy.deepcopy(cand[0])
        tampered["binding"]["mode"] = "preflight"
        out = evaluate_learning(reg, base, [tampered] + cand[1:], started)
        self.assertEqual(out["verdict"], "INVALID")

    def test_a_declared_confounder_blocks_a_conclusion(self):
        out = self.evaluate(base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5], cand_tree="f" * 40)
        self.assertEqual(out["verdict"], "INCONCLUSIVE")
        self.assertEqual(out["confounders"][0]["key"], "tree")

    def test_unknown_primary_is_inconclusive(self):
        out = self.evaluate({"metrics": [{"name": "role.CODING_AGENT.elapsed_ms", "expectedDirection": "lower",
                                          "minEffect": 0, "primary": True}]},
                            base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        self.assertEqual(out["verdict"], "INCONCLUSIVE")

    def test_the_outcome_names_its_registration(self):
        out = self.evaluate(base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        self.assertEqual(out["registrationDigest"], parse_registration(registration()).digest())
        self.assertIn("awards no beta-readiness credit", out["authority"])

    # -- per-arm identity (decision C, Option D)

    def test_a_changed_commit_is_unmatched(self):
        # The main commit is a registered match key now, not a confounder: a pair across two commits measures two changes.
        out = self.evaluate(base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5], cand_commit="f" * 40)
        self.assertEqual(out["verdict"], "INVALID", out["reasons"])
        self.assertIn("commit", out["reasons"][-1])

    def test_one_run_counted_twice_is_invalid(self):
        reg = parse_registration(registration(minRunsPerSide=2, baselineRuns=["B1", "B2"]))
        base, cand, started = self.arms(reg, base_ticks=[8, 9], cand_ticks=[4])
        out = evaluate_learning(reg, base, [cand[0], cand[0]], started)
        self.assertEqual(out["verdict"], "INVALID")
        self.assertIn("one run is one sample", out["reasons"][-1])

    def test_a_start_may_be_keyed_by_the_arm_s_julius_run(self):
        reg = parse_registration(registration())
        base, cand, _ = self.arms(reg, base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        out = evaluate_learning(reg, base, cand, {julius(101 + i): AFTER for i in range(3)})
        self.assertEqual(out["verdict"], "RETAIN", out["reasons"])

    def test_every_start_recorded_for_an_arm_must_follow_the_registration(self):
        # Two names, two starts: the earlier one decides. An arm cannot pick the name that tells the better story.
        reg = parse_registration(registration())
        base, cand, started = self.arms(reg, base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        out = evaluate_learning(reg, base, cand, dict(started, **{julius(102): BEFORE}))
        self.assertEqual(out["verdict"], "INVALID")
        self.assertIn(julius(102), out["reasons"][-1])

    def test_baseline_arms_may_be_registered_by_their_julius_runs(self):
        # An arm run after the registration is named by the id its contract and rerun key will give it.
        out = self.evaluate({"baselineRuns": [julius(1), julius(2), julius(3)]}, base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        self.assertEqual(out["verdict"], "RETAIN", out["reasons"])
        self.assertEqual([a["juliusRunId"] for a in out["arms"]], [julius(1), julius(2), julius(3), julius(101), julius(102), julius(103)])

    def test_a_baseline_registered_twice_is_invalid(self):
        out = self.evaluate({"baselineRuns": ["B1", julius(1), "B2"], "minRunsPerSide": 2}, base_ticks=[8, 9], cand_ticks=[4, 4])
        self.assertEqual(out["verdict"], "INVALID")

    def test_a_match_on_a_value_nobody_recorded_proves_nothing(self):
        # Arms without a learning record carry no contract digest: equal None on both sides is not a match.
        reg = parse_registration(registration(minRunsPerSide=1, baselineRuns=["B1"]))
        bundles = [analyze_bundle(load_bundle(self.tmp.bundle(A2, {
            "bundle-manifest.txt": set_manifest(workflow_run_id=run, julius_run_id=julius(n)),
            "live-mission.evidence.txt": ticks(t)}))) for run, n, t in (("B1", 1, 8), ("C1", 101, 4))]
        out = evaluate_learning(reg, bundles[:1], bundles[1:], {"C1": AFTER})
        self.assertEqual(out["verdict"], "INVALID")
        self.assertIn("contractDigest", out["reasons"][-1])

    def test_an_arm_recorded_under_another_registration_is_invalid(self):
        reg = parse_registration(registration())
        base, cand, started = self.arms(reg, base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        other = parse_registration(registration(hypothesis="another experiment"))
        stray = self.run_(other, "C3", julius(103), 5, without=julius(3))
        out = evaluate_learning(reg, base, cand[:2] + [stray], started)
        self.assertEqual(out["verdict"], "INVALID")
        self.assertIn("ran under registration", out["reasons"][-1])

    def test_an_arm_that_lost_its_record_is_invalid(self):
        reg = parse_registration(registration())
        base, cand, started = self.arms(reg, base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        stripped = copy.deepcopy(cand[2])
        stripped["learning"] = {"unknown": "learning.tsv is MISSING"}
        out = evaluate_learning(reg, base, cand[:2] + [stripped], started)
        self.assertEqual(out["verdict"], "INVALID")
        self.assertIn("carries no learning record", out["reasons"][-1])

    def test_an_arm_on_the_wrong_side_is_invalid(self):
        reg = parse_registration(registration())
        base, cand, started = self.arms(reg, base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        swapped = copy.deepcopy(cand[0])
        swapped["learning"]["arm"] = "WITHOUT"
        out = evaluate_learning(reg, base, [swapped] + cand[1:], started)
        self.assertEqual(out["verdict"], "INVALID")
        self.assertIn("not WITH", out["reasons"][-1])

    def test_a_with_arm_compared_with_no_baseline_arm_here_is_invalid(self):
        reg = parse_registration(registration())
        base, cand, started = self.arms(reg, base_ticks=[8, 9, 8], cand_ticks=[4, 4, 5])
        elsewhere = self.run_(reg, "C3", julius(103), 5, without=julius(99))
        out = evaluate_learning(reg, base, cand[:2] + [elsewhere], started)
        self.assertEqual(out["verdict"], "INVALID")
        self.assertIn(julius(99), out["reasons"][-1])


class MatchedPairTests(unittest.TestCase):
    """A 2 + 2 registered pair, evaluated across its four arm bundles as Option D produces them: each
    WITHOUT arm a job on a fresh store, each WITH arm a job that restored its WITHOUT arm's store, so
    its bundle holds both runs and must be read for its own."""

    W1, W2, C1, C2 = julius(0xA1), julius(0xA2), julius(0xC1), julius(0xC2)

    def setUp(self):
        self.tmp = TempDirs()

    def tearDown(self):
        self.tmp.cleanup()

    def reg(self, **over):
        return parse_registration(registration(**{
            "baselineRuns": [self.W1, self.W2], "minRunsPerSide": 2, "confounders": [],
            "metrics": [{"name": "mission.repair_rounds", "expectedDirection": "lower", "minEffect": 1, "primary": True},
                        {"name": "mission.ticks", "expectedDirection": "lower", "minEffect": 0, "primary": False}],
            **over}))

    def pair(self, reg, with_repairs=(0, 0)):
        """Four bundles: WITHOUT 41, 42 (2 and 3 repairs) and WITH 43, 44 restored from them."""
        d = digest(reg)
        paths = {
            "41": arm_bundle(self.tmp, d, self.W1, "41", repairs=2),
            "42": arm_bundle(self.tmp, d, self.W2, "42", repairs=3),
            "43": arm_bundle(self.tmp, d, self.C1, "43", without=self.W1, repairs=with_repairs[0], inherited_repairs=2),
            "44": arm_bundle(self.tmp, d, self.C2, "44", without=self.W2, repairs=with_repairs[1], inherited_repairs=3),
        }
        analyses = {run: analyze_bundle(load_bundle(path)) for run, path in paths.items()}
        return paths, [analyses["41"], analyses["42"]], [analyses["43"], analyses["44"]]

    def test_the_with_arm_s_bundle_holds_both_runs_and_is_read_for_its_own(self):
        paths, _, cand = self.pair(self.reg())
        raw = load_bundle(paths["43"])
        self.assertEqual(sorted({row["run_id"] for row in raw.table("runs").rows}), sorted([self.C1, self.W1]))
        self.assertEqual(sum(1 for row in raw.table("tasks").rows if row["task_type"].startswith("repair:")), 2)  # W1's
        report = cand[0]
        self.assertEqual(report["runScope"], {"runs": sorted([self.C1, self.W1]), "run": self.C1, "basis": "manifest",
                                              "scoped": True, "reason": None})
        self.assertEqual(report["mission"]["runState"], {"value": "COMPLETED"})
        self.assertEqual(report["mission"]["repairRounds"], {"value": 0})
        self.assertEqual((report["binding"]["contractDigest"], report["binding"]["runtimeVersion"]), (CONTRACT, RUNTIME))
        self.assertEqual((report["learning"]["arm"], report["learning"]["withoutRunId"]), ("WITH", self.W1))

    def test_a_registered_two_by_two_pair_is_evaluated_across_four_arm_bundles(self):
        reg = self.reg()
        _, base, cand = self.pair(reg)
        out = evaluate_learning(reg, base, cand, {"43": AFTER, "44": AFTER})
        self.assertEqual(out["verdict"], "RETAIN", out["reasons"])
        self.assertEqual(out["primary"]["n"], {"baseline": 2, "candidate": 2})
        self.assertEqual(out["metrics"]["mission.repair_rounds"]["baseline"], [{"value": 2}, {"value": 3}])
        self.assertEqual(out["metrics"]["mission.repair_rounds"]["candidate"], [{"value": 0}, {"value": 0}])
        self.assertEqual([(a["side"], a["juliusRunId"], a["workflowRunId"], a["arm"]) for a in out["arms"]], [
            ("baseline", self.W1, "41", "WITHOUT"), ("baseline", self.W2, "42", "WITHOUT"),
            ("candidate", self.C1, "43", "WITH"), ("candidate", self.C2, "44", "WITH")])

    def test_no_movement_on_a_valid_pair_is_reject(self):
        # REJECT is a VALID pair's verdict (MATCHED_PAIR_PREREG §3): the gate refusing is the capability working.
        reg = self.reg()
        _, base, cand = self.pair(reg, with_repairs=(2, 3))
        out = evaluate_learning(reg, base, cand, {"43": AFTER, "44": AFTER})
        self.assertEqual(out["verdict"], "REJECT", out["reasons"])

    def test_a_registration_later_than_a_candidate_start_is_refused(self):
        late = self.reg(registeredAt="2026-10-02T09:30:00Z")
        _, base, cand = self.pair(late)
        out = evaluate_learning(late, base, cand, {"43": AFTER, "44": "2026-10-02T09:15:00Z"})
        self.assertEqual(out["verdict"], "INVALID")
        self.assertIn("not after the registration", out["reasons"][-1])
        self.assertIn(self.C2, out["reasons"][-1])

    def test_a_with_arm_keyed_by_its_julius_run_start(self):
        reg = self.reg()
        _, base, cand = self.pair(reg)
        out = evaluate_learning(reg, base, cand, {self.C1: AFTER, self.C2: AFTER})
        self.assertEqual(out["verdict"], "RETAIN", out["reasons"])

    def test_a_with_bundle_that_cannot_name_its_own_run_is_not_read_as_two(self):
        # The manifest names no run and the WITH arm left no record: nothing says which run is the job's own.
        reg = self.reg()
        path = arm_bundle(self.tmp, digest(reg), self.C1, "43", without=self.W1, inherited_repairs=2,
                          records=[arm_record(self.W1, "WITHOUT", digest(reg))], julius_run_id="none")
        report = analyze_bundle(load_bundle(path))
        self.assertIsNone(report["runScope"]["run"])
        self.assertIn("unknown", report["mission"]["runState"])
        self.assertIn("unknown", report["mission"]["repairRounds"])
        self.assertEqual(load_bundle(path).table("tasks").status, "PRESENT")
        self.assertIn("unknown", report["learning"])

    def test_the_with_record_names_the_run_when_the_manifest_cannot(self):
        reg = self.reg()
        path = arm_bundle(self.tmp, digest(reg), self.C1, "43", without=self.W1, inherited_repairs=2, julius_run_id="none")
        report = analyze_bundle(load_bundle(path))
        self.assertEqual((report["runScope"]["run"], report["runScope"]["basis"]), (self.C1, "learning_record"))
        self.assertEqual(report["mission"]["repairRounds"], {"value": 0})

    def test_a_manifest_and_a_with_record_that_disagree_are_not_resolved(self):
        reg = self.reg()
        path = arm_bundle(self.tmp, digest(reg), self.C1, "43", without=self.W1, inherited_repairs=2, julius_run_id=self.W1)
        report = analyze_bundle(load_bundle(path))
        self.assertIsNone(report["runScope"]["run"])
        self.assertIn("ambiguous", report["runScope"]["reason"])
        self.assertIn("unknown", report["mission"]["repairRounds"])


if __name__ == "__main__":
    unittest.main()
