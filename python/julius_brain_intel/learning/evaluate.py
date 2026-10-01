"""Evaluate a pre-registered adaptation: ``julius.learning-outcome.v1``.

baseline mission -> evidence -> weakness -> adaptation -> matched later mission -> measurement
-> comparison -> RETAIN / REJECT / PROVISIONAL / INCONCLUSIVE / INVALID.

THE VERDICTS, in the order they are tested:

  INVALID       the registration does not precede every candidate run, a baseline run is not
                the one registered, or the runs are not matched on the registered keys. The
                comparison measures nothing the registration promised.
  INCONCLUSIVE  the primary metric is Unknown on any run, or a declared confounder differs between
                the arms (the change is not the only change).
  REJECT        the primary metric did not move by its minimum effect in the expected direction
                (for n >= min per side: the interval does not exclude zero in that direction) --
                the registration's own failure rule.
  PROVISIONAL   the observed effect meets the minimum in the expected direction, but there are too
                few runs to form an interval. Recorded as a lead, never as learning.
  RETAIN        the effect meets the minimum AND its bootstrap interval excludes zero in the
                expected direction, on matched, unconfounded runs.

A SECOND SUCCESSFUL RUN IS NOT LEARNING. A binary metric that was already at its best on the
baseline cannot improve, so the verdict for "it worked before and it worked again" is REJECT
(no movement), never RETAIN.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Mapping, Sequence

from .. import LEARNING_OUTCOME_SCHEMA, NOT_READINESS_AUTHORITY
from ..evals.compare import match_keys
from ..evals.metrics import extract_metrics
from ..evals.stats import bootstrap_diff_ci, mean
from ..known import Unknown, as_json
from .registry import Registration


def _time(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _key_values(analysis: Mapping[str, Any], keys: Sequence[str]) -> dict[str, Any]:
    matched = match_keys(analysis)
    binding = analysis.get("binding", {})
    out = {}
    for key in keys:
        out[key] = matched[key] if key in matched else binding.get(key)
    return out


def evaluate_learning(registration: Registration, baseline: Sequence[Mapping[str, Any]],
                      candidate: Sequence[Mapping[str, Any]], candidate_started_at: Mapping[str, str],
                      *, seed: int = 0) -> dict[str, Any]:
    """``baseline``/``candidate``: ``julius.evidence-analysis.v1`` reports. ``candidate_started_at``:
    workflow run id -> the run's created_at as GitHub records it (not the bundle's own clock)."""
    outcome: dict[str, Any] = {
        "schemaVersion": LEARNING_OUTCOME_SCHEMA, "authority": NOT_READINESS_AUTHORITY,
        "registrationId": registration.registration_id, "registrationDigest": registration.digest(),
        "hypothesis": registration.hypothesis, "adaptation": {"kind": registration.adaptation_kind,
                                                               "changeRef": registration.change_ref},
        "baselineRuns": [b.get("binding", {}).get("workflowRunId") for b in baseline],
        "candidateRuns": [c.get("binding", {}).get("workflowRunId") for c in candidate],
        "reasons": [],
    }

    def finish(verdict: str, reason: str) -> dict[str, Any]:
        outcome["verdict"] = verdict
        outcome["reasons"].append(reason)
        return outcome

    if not baseline or not candidate:
        return finish("INVALID", "each arm needs at least one run")
    # 1. ORDER: the registration came first, or this is a story told after the fact.
    registered = _time(registration.registered_at)
    for run in outcome["candidateRuns"]:
        started = _time(candidate_started_at.get(str(run)))
        if started is None:
            return finish("INVALID", f"no recorded start for candidate run {run}: cannot prove the registration preceded it")
        if registered is None or started <= registered:
            return finish("INVALID", f"candidate run {run} started at {candidate_started_at.get(str(run))}, "
                                     f"not after the registration ({registration.registered_at})")
    if set(map(str, outcome["baselineRuns"])) != set(registration.baseline_runs):
        return finish("INVALID", f"baseline runs {outcome['baselineRuns']} are not the registered {list(registration.baseline_runs)}")
    # 2. MATCH on the registered keys.
    reference = _key_values(baseline[0], registration.matched_on)
    for run in list(baseline) + list(candidate):
        values = _key_values(run, registration.matched_on)
        if values != reference:
            diff = {k: (reference[k], values[k]) for k in reference if reference[k] != values[k]}
            return finish("INVALID", f"run {run.get('binding', {}).get('workflowRunId')} is not matched on {sorted(diff)}: {diff}")
    # 3. CONFOUNDERS: any declared confounder that differs between the arms is reported, and blocks a conclusion.
    confounded = []
    for key in registration.confounders:
        base_vals = {str(_key_values(b, [key])[key]) for b in baseline}
        cand_vals = {str(_key_values(c, [key])[key]) for c in candidate}
        if base_vals != cand_vals:
            confounded.append({"key": key, "baseline": sorted(base_vals), "candidate": sorted(cand_vals)})
    outcome["confounders"] = confounded

    # 4. MEASURE the primary metric (secondary metrics are reported, never decisive).
    spec = registration.primary
    measured: dict[str, Any] = {}
    for metric in registration.metrics:
        base_vals = [extract_metrics(b)[0].get(metric.name, Unknown("metric not defined")) for b in baseline]
        cand_vals = [extract_metrics(c)[0].get(metric.name, Unknown("metric not defined")) for c in candidate]
        measured[metric.name] = {"baseline": [as_json(v) for v in base_vals], "candidate": [as_json(v) for v in cand_vals],
                                 "expectedDirection": metric.expected_direction, "minEffect": metric.min_effect,
                                 "primary": metric.primary}
    outcome["metrics"] = measured
    base_vals = [extract_metrics(b)[0].get(spec.name, Unknown("metric not defined")) for b in baseline]
    cand_vals = [extract_metrics(c)[0].get(spec.name, Unknown("metric not defined")) for c in candidate]
    unknown = next((v for v in base_vals + cand_vals if isinstance(v, Unknown)), None)
    if unknown is not None:
        return finish("INCONCLUSIVE", f"primary metric {spec.name} is unknown on a run: {unknown.reason}")
    if confounded:
        return finish("INCONCLUSIVE", f"declared confounder(s) differ between the arms: {[c['key'] for c in confounded]}")
    b = [float(v) for v in base_vals]
    c = [float(v) for v in cand_vals]
    effect = mean(c) - mean(b)
    signed = effect if spec.expected_direction == "higher" else -effect
    outcome["primary"] = {"metric": spec.name, "effect": effect, "effectInExpectedDirection": signed,
                          "minEffect": spec.min_effect, "n": {"baseline": len(b), "candidate": len(c)}}
    meets = signed >= spec.min_effect and signed > 0
    if not meets:
        return finish("REJECT", f"{spec.name} moved {effect:+g} (needed {spec.min_effect:g} "
                                f"{'up' if spec.expected_direction == 'higher' else 'down'}): {registration.failure_rule}")
    if len(b) < registration.min_runs_per_side or len(c) < registration.min_runs_per_side:
        return finish("PROVISIONAL", f"the effect meets the minimum, but {len(b)} and {len(c)} run(s) cannot form an "
                                     f"interval (registered minimum {registration.min_runs_per_side} per side)")
    ci = bootstrap_diff_ci(b, c, seed=seed)
    outcome["primary"]["ci95"] = as_json(ci)
    if isinstance(ci, Unknown):
        return finish("PROVISIONAL", ci.reason)
    lo = ci[0] if spec.expected_direction == "higher" else -ci[1]
    if lo > 0:
        return finish("RETAIN", f"{spec.name} moved {effect:+g} and the 95% interval {ci} excludes zero in the expected direction")
    return finish("REJECT", f"the 95% interval {ci} does not exclude zero: {registration.failure_rule}")
