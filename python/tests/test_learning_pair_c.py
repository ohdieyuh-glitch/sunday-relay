"""Decision C's zero-spend ``learning-evaluate`` fixture (registration design r8.5, section 8 item 6; V5 E1(d)).

THE registration -- the committed draft, ``.github/julius-learning-registrations/julius-learning-pair-1.json`` -- through this
package's own CLI, the one the verifier runs; the four arm contracts, ``.github/julius-missions/julius-learning-pair-1-*``, which
carry its digest; and four arm bundles in a2's real shape (paid Mission 6 attempt 2, run 36915013287), laid out as Option D
produces them: each WITHOUT arm a job on a fresh store, each WITH arm a job that restored its WITHOUT arm's store. Nothing is
dispatched and nothing is paid.

Two facts about the instrument, pinned for this registration:
  1. the full registered set (2 baselines + 2 candidates) evaluates: a verdict, with primary.n = {baseline 2, candidate 2};
  2. a REDUCED set (one candidate) still returns PROVISIONAL, with primary.n = {baseline 2, candidate 1}. The evaluator holds
     the baselines to the registered list and the candidates to none (evaluate.py, steps 3 and 4), so only the registration's
     own rule refuses that set (V5 E1: the four registered bundles, evaluated together, primary.n 2/2 or no credit). The
     evaluator is PREREG-frozen; a change to it turns this red.
"""

import json
import os
import re
import subprocess
import sys
import unittest
from datetime import datetime, timedelta

from helpers import TempDirs, arm_bundle

PACKAGE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPOSITORY = os.path.dirname(PACKAGE_ROOT)
REGISTRATION = os.path.join(REPOSITORY, ".github", "julius-learning-registrations", "julius-learning-pair-1.json")
MISSIONS = os.path.join(REPOSITORY, ".github", "julius-missions")
PINNING_TEST = os.path.join(REPOSITORY, "scripts", "julius-learning-pair-pins.test.ts")
ARMS = ("julius-learning-pair-1-without-1", "julius-learning-pair-1-with-1",
        "julius-learning-pair-1-without-2", "julius-learning-pair-1-with-2")
#: The WITH arms' own Julius runs. They follow from the contract and the rerun key, which only the TypeScript compiler
#: derives: scripts/julius-learning-pair-pins.test.ts derives all four, and this file is held to its two (below).
WITH_1, WITH_2 = "run:d9991fd5c259ef434de1011d", "run:fefae24f8c8aab71f2920433"


def cli(*args):
    return subprocess.run([sys.executable, "-B", "-m", "julius_brain_intel", *args], cwd=PACKAGE_ROOT,
                          capture_output=True, text=True, encoding="utf-8")


def clause(arm):
    with open(os.path.join(MISSIONS, arm, "contract.json"), encoding="utf-8") as handle:
        return json.load(handle)["learningPair"]


class DecisionCRegisteredPairFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = TempDirs()
        with open(REGISTRATION, encoding="utf-8") as handle:
            self.registration = json.load(handle)
        self.w1, self.w2 = self.registration["baselineRuns"]
        registered = datetime.fromisoformat(self.registration["registeredAt"].replace("Z", "+00:00"))
        self.after = (registered + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")

    def tearDown(self):
        self.tmp.cleanup()

    def digest(self):
        validated = cli("learning-validate", REGISTRATION)
        self.assertEqual(validated.returncode, 0, validated.stderr)
        return json.loads(validated.stdout)["digest"]

    def bundles(self, with_repairs):
        """WITHOUT-1 (2 repairs) and WITHOUT-2 (3), each on its own fresh store; WITH-k restored from WITHOUT-k. Each arm's
        learning record carries the digest its OWN contract declares, and arm WITH names the WITHOUT run its contract names."""
        without_1, with_1, without_2, with_2 = (clause(arm) for arm in ARMS)
        return {
            "41": arm_bundle(self.tmp, without_1["registrationDigest"], self.w1, "41", repairs=2),
            "42": arm_bundle(self.tmp, without_2["registrationDigest"], self.w2, "42", repairs=3),
            "43": arm_bundle(self.tmp, with_1["registrationDigest"], WITH_1, "43", without=with_1["withoutRunId"],
                             repairs=with_repairs[0], inherited_repairs=2),
            "44": arm_bundle(self.tmp, with_2["registrationDigest"], WITH_2, "44", without=with_2["withoutRunId"],
                             repairs=with_repairs[1], inherited_repairs=3),
        }

    def evaluate(self, bundles, candidates):
        result = cli("learning-evaluate", REGISTRATION, "--baseline", bundles["41"], bundles["42"],
                     "--candidate", *(bundles[run] for run in candidates),
                     "--started", *(f"{run}={self.after}" for run in candidates))
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_the_with_runs_are_the_ones_the_pinning_test_derives(self):
        with open(PINNING_TEST, encoding="utf-8") as handle:
            pinned = dict(re.findall(r"'(jlp1-with-[12])': '(run:[0-9a-f]{24})'", handle.read()))
        self.assertEqual(pinned, {"jlp1-with-1": WITH_1, "jlp1-with-2": WITH_2})

    def test_the_four_arms_carry_the_digest_learning_validate_prints_and_pair_as_registered(self):
        digest = self.digest()
        self.assertEqual([clause(arm)["registrationDigest"] for arm in ARMS], [digest.split(":", 1)[1]] * 4)
        self.assertEqual([clause(arm).get("withoutRunId") for arm in ARMS], [None, self.w1, None, self.w2])
        self.assertEqual(len({self.w1, self.w2, WITH_1, WITH_2}), 4)

    def test_the_full_registered_set_evaluates_two_against_two(self):
        digest = self.digest()
        for with_repairs, verdict in (((0, 0), "RETAIN"), ((2, 3), "REJECT")):
            out = self.evaluate(self.bundles(with_repairs), ("43", "44"))
            self.assertEqual(out["registrationDigest"], digest)
            self.assertEqual(out["verdict"], verdict, out["reasons"])
            self.assertIn(out["verdict"], ("RETAIN", "REJECT", "PROVISIONAL"))
            self.assertEqual(out["primary"]["n"], {"baseline": 2, "candidate": 2})
            self.assertEqual([(a["side"], a["juliusRunId"], a["workflowRunId"], a["arm"]) for a in out["arms"]], [
                ("baseline", self.w1, "41", "WITHOUT"), ("baseline", self.w2, "42", "WITHOUT"),
                ("candidate", WITH_1, "43", "WITH"), ("candidate", WITH_2, "44", "WITH")])

    def test_a_reduced_set_of_one_candidate_returns_provisional_which_only_the_registration_refuses(self):
        # WITH-1 refused or never counted, WITH-2 alone: the instrument still answers PROVISIONAL, a verdict PREREG section 3
        # counts as valid. primary.n = 2/1 is the mark V5 E1(c) reads to refuse it.
        out = self.evaluate(self.bundles((0, 0)), ("44",))
        self.assertEqual(out["verdict"], "PROVISIONAL", out["reasons"])
        self.assertEqual(out["primary"]["n"], {"baseline": 2, "candidate": 1})
        self.assertIn("cannot form an interval", out["reasons"][-1])


if __name__ == "__main__":
    unittest.main()
