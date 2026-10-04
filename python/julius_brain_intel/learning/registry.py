"""Learning-loop pre-registration: ``julius.learning-registration.v1``.

A claim that Julius LEARNED is a claim that a specific adaptation, made because of a specific
weakness seen in evidence, moved a declared metric in a declared direction on a matched later
mission. Every one of those words is fixed here, BEFORE the later mission runs, and the record
is content-hashed so it cannot be edited afterwards. A revision is a new registration that names
the one it replaces.

Required:
  hypothesis          one sentence
  weakness            what was wrong, with >= 1 evidence ref (a bundle anomaly, a finding, a run id)
  adaptation          what changes (kind, description, change_ref: a commit, a patch digest or a
                      Brain record) -- the ONE difference the comparison is about
  baseline            the baseline arm(s), each named once by its workflow run id or its Julius
                      run id. An arm of a registered pair takes its Julius run id from its own
                      rerun key (``run:`` + sha256(idempotencyKey:rerun:<key>)[:24]), so it can be
                      named before it runs -- as it must be, since its contract carries this
                      registration's digest
  metrics             >= 1, exactly one primary; each with expected direction (higher/lower) and a
                      minimum effect that counts
  matched_on          keys every arm must share (default, MATCHED_PAIR_PREREG §3: the contract
                      digest, mode, requested models, runtime version and the commit). Never a
                      per-run identity: two arms are two runs, so a pair matched on one could
                      never match, and the registration is refused
  confounders         further keys to check and REPORT (e.g. provider latency regime, tree)
  failure_rule        the declared outcome that rejects the adaptation
  min_runs_per_side   below this an interval cannot be formed and RETAIN is impossible
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Mapping

from .. import LEARNING_REGISTRATION_SCHEMA

DIRECTIONS = ("higher", "lower")
DEFAULT_MATCHED_ON = ("contractDigest", "mode", "requestedModels", "runtimeVersion", "commit")
#: One run's own identity. No two arms share one (MATCHED_PAIR_PREREG §6), so none can be matched on.
PER_RUN_KEYS = ("juliusRunId", "workflowRunId", "workflowRunAttempt")


class RegistrationError(ValueError):
    """The registration is not specific enough to be falsified."""


@dataclass(frozen=True)
class MetricSpec:
    name: str
    expected_direction: str
    min_effect: float
    primary: bool


@dataclass(frozen=True)
class Registration:
    registration_id: str
    registered_at: str
    hypothesis: str
    weakness: str
    weakness_evidence: tuple[str, ...]
    adaptation_kind: str
    adaptation_description: str
    change_ref: str
    baseline_runs: tuple[str, ...]
    metrics: tuple[MetricSpec, ...]
    matched_on: tuple[str, ...] = DEFAULT_MATCHED_ON
    confounders: tuple[str, ...] = ()
    failure_rule: str = "the primary metric does not move by at least its minimum effect in the expected direction"
    min_runs_per_side: int = 2
    supersedes: str | None = None
    extra: Mapping[str, Any] = field(default_factory=dict)

    @property
    def primary(self) -> MetricSpec:
        return next(m for m in self.metrics if m.primary)

    def canonical(self) -> dict[str, Any]:
        return {
            "schemaVersion": LEARNING_REGISTRATION_SCHEMA,
            "registrationId": self.registration_id, "registeredAt": self.registered_at,
            "hypothesis": self.hypothesis,
            "weakness": {"description": self.weakness, "evidence": list(self.weakness_evidence)},
            "adaptation": {"kind": self.adaptation_kind, "description": self.adaptation_description,
                           "changeRef": self.change_ref},
            "baselineRuns": list(self.baseline_runs),
            "metrics": [{"name": m.name, "expectedDirection": m.expected_direction, "minEffect": m.min_effect,
                         "primary": m.primary} for m in self.metrics],
            "matchedOn": list(self.matched_on), "confounders": list(self.confounders),
            "failureRule": self.failure_rule, "minRunsPerSide": self.min_runs_per_side,
            "supersedes": self.supersedes,
        }

    def digest(self) -> str:
        body = json.dumps(self.canonical(), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return "sha256:" + hashlib.sha256(body.encode("utf-8")).hexdigest()


def _parse_time(text: str) -> datetime:
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise RegistrationError(f"registeredAt is not an ISO timestamp: {text!r}") from error


def parse_registration(raw: Mapping[str, Any]) -> Registration:
    if raw.get("schemaVersion") != LEARNING_REGISTRATION_SCHEMA:
        raise RegistrationError(f"schemaVersion must be {LEARNING_REGISTRATION_SCHEMA!r}")
    def need(key: str) -> Any:
        value = raw.get(key)
        if value in (None, "", [], {}):
            raise RegistrationError(f"{key} is required")
        return value
    weakness = need("weakness")
    adaptation = need("adaptation")
    if not weakness.get("evidence"):
        raise RegistrationError("a weakness must cite >= 1 piece of evidence: a hunch is not a weakness")
    for key in ("kind", "description", "changeRef"):
        if not adaptation.get(key):
            raise RegistrationError(f"adaptation.{key} is required: the change must be identifiable")
    metrics = []
    for spec in need("metrics"):
        direction = spec.get("expectedDirection")
        if direction not in DIRECTIONS:
            raise RegistrationError(f"metric {spec.get('name')!r}: expectedDirection must be higher or lower")
        min_effect = spec.get("minEffect", 0)
        if not isinstance(min_effect, (int, float)) or min_effect < 0:
            raise RegistrationError(f"metric {spec.get('name')!r}: minEffect must be a non-negative number")
        metrics.append(MetricSpec(str(spec.get("name")), direction, float(min_effect), bool(spec.get("primary"))))
    if sum(1 for m in metrics if m.primary) != 1:
        raise RegistrationError("exactly one metric must be primary: two primaries are a forking path")
    min_runs = raw.get("minRunsPerSide", 2)
    if not isinstance(min_runs, int) or min_runs < 1:
        raise RegistrationError("minRunsPerSide must be a positive integer")
    registered_at = need("registeredAt")
    _parse_time(registered_at)
    matched_on = tuple(raw.get("matchedOn") or DEFAULT_MATCHED_ON)
    per_run = [key for key in matched_on if key in PER_RUN_KEYS]
    if per_run:
        raise RegistrationError(f"matchedOn names a per-run identity {per_run}: two arms are two runs and never share one")
    return Registration(
        registration_id=str(need("registrationId")), registered_at=registered_at, hypothesis=str(need("hypothesis")),
        weakness=str(weakness.get("description", "")), weakness_evidence=tuple(str(e) for e in weakness["evidence"]),
        adaptation_kind=str(adaptation["kind"]), adaptation_description=str(adaptation["description"]),
        change_ref=str(adaptation["changeRef"]), baseline_runs=tuple(str(r) for r in need("baselineRuns")),
        metrics=tuple(metrics), matched_on=matched_on,
        confounders=tuple(raw.get("confounders") or ()), failure_rule=str(raw.get("failureRule") or Registration.failure_rule),
        min_runs_per_side=min_runs, supersedes=raw.get("supersedes"),
    )
