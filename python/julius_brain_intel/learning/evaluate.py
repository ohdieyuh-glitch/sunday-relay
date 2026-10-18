"""Evaluate a pre-registered adaptation: ``julius.learning-outcome.v1``.

baseline mission -> evidence -> weakness -> adaptation -> matched later mission -> measurement
-> comparison -> RETAIN / REJECT / PROVISIONAL / INCONCLUSIVE / INVALID.

THE VERDICTS, in the order they are tested:

  INVALID       the registration does not precede every candidate run, one run is counted as
                two arms, a baseline arm is not one registered, an arm's own learning record
                belongs to another registration or arm, or the runs are not matched on the
                registered keys (or carry none of a key's value, which no comparison can match).
                The comparison measures nothing the registration promised.
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

ONE ARM, ONE RUN, TWO NAMES (decision C, Option D). Each arm is one Julius run -- its own, through
its contract's rerun key -- in one job of its own workflow run; arm WITH's job restored arm
WITHOUT's store, and its bundle is read for its own run (``learning_arm.own_run``). An arm is named
by either id: a registration names its baseline arms by workflow run id (a run that preceded it)
or by Julius run id (an arm run after it: the id follows from the contract and the rerun key), and
``candidate_started_at`` may key a candidate's start by either. Every start recorded for a
candidate arm must follow the registration. When the arms recorded themselves (``learning.tsv``),
every arm must have: under this registration's digest, baseline arms WITHOUT, candidate arms WITH,
each WITH compared with a baseline arm of this evaluation.
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


def _named(value: Any) -> str | None:
    """An id as a bundle records it; the dump writes ``none`` for a run it could not name."""
    text = "" if value is None else str(value).strip()
    return None if text in ("", "none") else text


def _identity(analysis: Mapping[str, Any]) -> dict[str, str | None]:
    """The arm's two names: the run its bundle was read for, and its workflow run."""
    binding = analysis.get("binding", {})
    scope = analysis.get("runScope") or {}
    return {"juliusRunId": _named(scope.get("run")) or _named(binding.get("juliusRunId")),
            "workflowRunId": _named(binding.get("workflowRunId"))}


def _label(identity: Mapping[str, str | None]) -> str:
    names = [identity["juliusRunId"], f"workflow run {identity['workflowRunId']}" if identity["workflowRunId"] else None]
    return " / ".join(name for name in names if name) or "an unnamed run"


def _record(analysis: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """The arm's own learning record, as its analysis read it; None when it carries none."""
    learning = analysis.get("learning")
    return learning if isinstance(learning, dict) and "arm" in learning else None


def _arm(side: str, analysis: Mapping[str, Any], identity: Mapping[str, str | None]) -> dict[str, Any]:
    record = _record(analysis) or {}
    return {"side": side, **identity, **{key: record.get(key) for key in (
        "arm", "registrationDigest", "runState", "withoutRunId", "comparison", "decision", "proposal")}}


def evaluate_learning(registration: Registration, baseline: Sequence[Mapping[str, Any]],
                      candidate: Sequence[Mapping[str, Any]], candidate_started_at: Mapping[str, str],
                      *, seed: int = 0) -> dict[str, Any]:
    """``baseline``/``candidate``: ``julius.evidence-analysis.v1`` reports, one per arm.
    ``candidate_started_at``: a candidate arm's workflow run id (or its Julius run id) -> that arm's
    workflow run created_at as GitHub records it (not the bundle's own clock)."""
    base_ids = [_identity(b) for b in baseline]
    cand_ids = [_identity(c) for c in candidate]
    outcome: dict[str, Any] = {
        "schemaVersion": LEARNING_OUTCOME_SCHEMA, "authority": NOT_READINESS_AUTHORITY,
        "registrationId": registration.registration_id, "registrationDigest": registration.digest(),
        "hypothesis": registration.hypothesis, "adaptation": {"kind": registration.adaptation_kind,
                                                               "changeRef": registration.change_ref},
        "baselineRuns": [b.get("binding", {}).get("workflowRunId") for b in baseline],
        "candidateRuns": [c.get("binding", {}).get("workflowRunId") for c in candidate],
        "arms": [_arm("baseline", b, i) for b, i in zip(baseline, base_ids)]
                + [_arm("candidate", c, i) for c, i in zip(candidate, cand_ids)],
        "reasons": [],
    }

    def finish(verdict: str, reason: str) -> dict[str, Any]:
        outcome["verdict"] = verdict
        outcome["reasons"].append(reason)
        return outcome

    if not baseline or not candidate:
        return finish("INVALID", "each arm needs at least one run")
    # 1. ORDER: the registration came first, or this is a story told after the fact. Every start
    #    recorded for a candidate arm, by its workflow run or its Julius run, must follow it.
    registered = _time(registration.registered_at)
    for identity in cand_ids:
        recorded = [(name, candidate_started_at[name]) for name in (identity["workflowRunId"], identity["juliusRunId"])
                    if name is not None and name in candidate_started_at]
        if not recorded:
            return finish("INVALID", f"no recorded start for candidate run {_label(identity)}: "
                                     "cannot prove the registration preceded it")
        for name, text in recorded:
            started = _time(text)
            if started is None or registered is None or started <= registered:
                return finish("INVALID", f"candidate run {_label(identity)} started at {text} ({name}), "
                                         f"not after the registration ({registration.registered_at})")
    # 2. IDENTITY: one run is one sample. The same run counted twice is a second reading, not a second arm.
    for key in ("juliusRunId", "workflowRunId"):
        names = [identity[key] for identity in base_ids + cand_ids if identity[key] is not None]
        repeated = sorted({name for name in names if names.count(name) > 1})
        if repeated:
            return finish("INVALID", f"{key} {repeated} names more than one arm: one run is one sample, never two")
    # 3. THE REGISTERED BASELINE: each registered run is exactly one baseline arm, and each baseline arm is registered.
    registered_runs = list(registration.baseline_runs)
    claimed: list[str] = []
    for identity in base_ids:
        hits = [run for run in registered_runs if run in (identity["juliusRunId"], identity["workflowRunId"])]
        if len(hits) != 1:
            return finish("INVALID", f"baseline runs {outcome['baselineRuns']} are not the registered {registered_runs}: "
                                     f"{_label(identity)} is named {len(hits)} time(s)")
        claimed.extend(hits)
    if sorted(claimed) != sorted(registered_runs):
        return finish("INVALID", f"baseline runs {outcome['baselineRuns']} are not the registered {registered_runs}: "
                                 f"{sorted(set(registered_runs) - set(claimed))} has no arm")
    # 4. THE ARMS' OWN RECORDS. Once one arm recorded itself, every arm must have, under THIS registration
    #    and as the arm it is: an arm cannot leave the pair by losing its record.
    records = [_record(run) for run in list(baseline) + list(candidate)]
    if any(record is not None for record in records):
        digest = registration.digest().split(":", 1)[-1]
        sides = ["baseline"] * len(baseline) + ["candidate"] * len(candidate)
        for side, identity, record in zip(sides, base_ids + cand_ids, records):
            expected = "WITHOUT" if side == "baseline" else "WITH"
            if record is None:
                return finish("INVALID", f"{side} run {_label(identity)} carries no learning record while another arm does")
            if record.get("registrationDigest") != digest:
                return finish("INVALID", f"{side} run {_label(identity)} ran under registration "
                                         f"{record.get('registrationDigest')}, not this one ({digest})")
            if record.get("arm") != expected:
                return finish("INVALID", f"{side} run {_label(identity)} is arm {record.get('arm')}, not {expected}")
        baseline_runs = {identity["juliusRunId"] for identity in base_ids} - {None}
        for identity, analysis in zip(cand_ids, candidate):
            without = (_record(analysis) or {}).get("withoutRunId")
            if without not in baseline_runs:
                return finish("INVALID", f"candidate run {_label(identity)} was compared with {without}, "
                                         "which is not a baseline arm here")
    # 5. MATCH on the registered keys. A key no run carries is equal everywhere and proves nothing.
    reference = _key_values(baseline[0], registration.matched_on)
    absent = sorted(key for key, value in reference.items() if value in (None, "", {}, []))
    if absent:
        return finish("INVALID", f"run {_label(base_ids[0])} carries no {absent}: a match on a value nobody "
                                 "recorded cannot be proven")
    for run, identity in zip(list(baseline) + list(candidate), base_ids + cand_ids):
        values = _key_values(run, registration.matched_on)
        if values != reference:
            diff = {k: (reference[k], values[k]) for k in reference if reference[k] != values[k]}
            return finish("INVALID", f"run {_label(identity)} is not matched on {sorted(diff)}: {diff}")
    # 6. CONFOUNDERS: any declared confounder that differs between the arms is reported, and blocks a conclusion.
    confounded = []
    for key in registration.confounders:
        base_vals = {str(_key_values(b, [key])[key]) for b in baseline}
        cand_vals = {str(_key_values(c, [key])[key]) for c in candidate}
        if base_vals != cand_vals:
            confounded.append({"key": key, "baseline": sorted(base_vals), "candidate": sorted(cand_vals)})
    outcome["confounders"] = confounded

    # 7. MEASURE the primary metric (secondary metrics are reported, never decisive).
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
