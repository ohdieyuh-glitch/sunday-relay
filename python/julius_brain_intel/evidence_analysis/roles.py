"""Per-role execution evidence: who answered, on what model, how long, how many tokens, at what cost.

THE SERVED-MODEL RULE IS THE SCORECARD'S, VERBATIM (``READINESS_LEDGER.md`` row 10, agreed by
both Julius sessions): requested equals served iff ``served_model == requested_model`` OR
``served_model_usage_key == requested_model`` OR ``served_model_usage_canonical ==
requested_model``. A dated build of the requested alias is ``DATED_BUILD``. Anything else is a
mismatch; nothing is inferred from a string prefix.

LATENCY IS READ, NEVER RECONSTRUCTED. ``elapsed_ms`` (worker diagnostics), ``duration_ms``
(the trajectory's provider DISPATCH row) and ``active_ms`` (effort) are reported as recorded.
A blank field is Unknown. The timestamps that would let a reader estimate a duration are not
used: the scorecard asks for an explicit field, and an estimate presented beside measurements
would read as one.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from ..boundary.evidence_bundle import EvidenceBundle
from ..known import Reading, Unknown, as_json, parse_bool, parse_int

EXACT = "EXACT"
DATED_BUILD = "DATED_BUILD"
MISMATCH = "MISMATCH"
UNATTESTED = "UNATTESTED"

_DATED = re.compile(r"^(?P<alias>.+)-(?P<date>[0-9]{8})$")


def served_model_match(requested: str, served: str, usage_key: str = "", usage_canonical: str = "") -> str:
    """The scorecard's row-10 rule. ``UNATTESTED`` when nothing names a served model."""
    if not requested:
        return UNATTESTED
    if requested in (served, usage_key, usage_canonical) and requested != "":
        return EXACT
    for candidate in (served, usage_key, usage_canonical):
        match = _DATED.match(candidate or "")
        if match and match.group("alias") == requested:
            return DATED_BUILD
    if not served and not usage_key and not usage_canonical:
        return UNATTESTED
    return MISMATCH


@dataclass
class RoleExecution:
    task_id: str
    role: str
    stage: str
    provider: str
    transport: str
    requested_model: str
    served_model: str
    served_basis: Reading[str]
    model_match: str
    dispatch_attempt: Reading[int]
    elapsed_ms: Reading[int]
    trajectory_duration_ms: Reading[int]
    active_ms: Reading[int]
    input_tokens: Reading[int]
    output_tokens: Reading[int]
    usage_output_tokens: Reading[int]
    billing_path: str
    cost_basis: str
    cost_usd_micros: Reading[int]
    execution_cost_usd_micros: Reading[int]
    outcome: str
    result_subtype: str
    is_error: Reading[bool]
    result_model_count: Reading[int]
    notes: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {
            "taskId": self.task_id, "role": self.role, "stage": self.stage, "provider": self.provider,
            "transport": self.transport, "requestedModel": self.requested_model, "servedModel": self.served_model,
            "servedBasis": as_json(self.served_basis), "modelMatch": self.model_match,
            "dispatchAttempt": as_json(self.dispatch_attempt),
            "latency": {
                "elapsedMs": as_json(self.elapsed_ms),
                "trajectoryDurationMs": as_json(self.trajectory_duration_ms),
                "activeMs": as_json(self.active_ms),
            },
            "tokens": {
                "input": as_json(self.input_tokens), "output": as_json(self.output_tokens),
                "usageOutput": as_json(self.usage_output_tokens),
            },
            "billing": {
                "path": self.billing_path, "costBasis": self.cost_basis,
                "providerCostUsdMicros": as_json(self.cost_usd_micros),
                "executionPriceUsdMicros": as_json(self.execution_cost_usd_micros),
                "executionPriceIsNotABill": True,
            },
            "outcome": self.outcome, "resultSubtype": self.result_subtype, "isError": as_json(self.is_error),
            "resultModelCount": as_json(self.result_model_count), "notes": list(self.notes),
        }


def _facts(cell: str) -> dict[str, Any]:
    try:
        value = json.loads(cell) if cell else {}
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def role_executions(bundle: EvidenceBundle) -> Reading[list[RoleExecution]]:
    """One record per provider dispatch in ``worker-diagnostics.tsv``. Unknown if unreadable."""
    diagnostics = bundle.table("worker-diagnostics")
    if not diagnostics.readable:
        return Unknown(f"worker-diagnostics.tsv is {diagnostics.status}")
    trajectory = bundle.table("trajectory")
    effort = bundle.table("effort")
    durations: dict[str, list[Reading[int]]] = {}
    if trajectory.readable:
        for row in trajectory.rows:
            if row.get("event_kind") == "DISPATCH" and row.get("provider_id"):
                durations.setdefault(row.get("task_id", ""), []).append(parse_int(row.get("duration_ms"), "duration_ms"))
    active: dict[str, Reading[int]] = {}
    if effort.readable:
        for row in effort.rows:
            active[row.get("task_id", "")] = parse_int(row.get("active_ms"), "active_ms")
    out: list[RoleExecution] = []
    for row in diagnostics.rows:
        task_id = row.get("task_id", "")
        requested = row.get("requested_model", "")
        served = row.get("served_model", "")
        basis_cell = row.get("served_model_basis", "")
        traj = durations.get(task_id)
        traj_reading: Reading[int]
        if trajectory.readable is False:
            traj_reading = Unknown(f"trajectory.tsv is {trajectory.status}")
        elif not traj:
            traj_reading = Unknown("no provider DISPATCH row in trajectory.tsv for this task")
        elif len(traj) > 1:
            traj_reading = Unknown(f"{len(traj)} provider DISPATCH rows for this task: ambiguous")
        else:
            traj_reading = traj[0]
        execution = RoleExecution(
            task_id=task_id,
            role=row.get("role", ""),
            stage=row.get("stage", ""),
            provider=row.get("provider", ""),
            transport=row.get("transport", ""),
            requested_model=requested,
            served_model=served,
            served_basis=basis_cell if basis_cell else Unknown("served_model_basis not recorded"),
            model_match=served_model_match(requested, served, row.get("served_model_usage_key", ""),
                                           row.get("served_model_usage_canonical", "")),
            dispatch_attempt=parse_int(row.get("dispatch_attempt"), "dispatch_attempt"),
            elapsed_ms=parse_int(row.get("elapsed_ms"), "elapsed_ms"),
            trajectory_duration_ms=traj_reading,
            active_ms=active.get(task_id, Unknown("no effort row for this task")),
            input_tokens=parse_int(row.get("input_tokens"), "input_tokens"),
            output_tokens=parse_int(row.get("output_tokens"), "output_tokens"),
            usage_output_tokens=parse_int(row.get("result_model_first_output_tokens"), "modelUsage output tokens"),
            billing_path=row.get("billing_path", ""),
            cost_basis=row.get("cost_basis", ""),
            cost_usd_micros=parse_int(row.get("cost_usd_micros"), "provider-reported cost"),
            execution_cost_usd_micros=parse_int(row.get("execution_cost_usd_micros"), "execution price"),
            outcome=row.get("outcome", ""),
            result_subtype=row.get("result_subtype", ""),
            is_error=parse_bool(row.get("is_error"), "is_error"),
            result_model_count=parse_int(row.get("result_model_count"), "result_model_count"),
        )
        out.append(execution)
    return out


def verification_facts(bundle: EvidenceBundle) -> Reading[list[dict[str, Any]]]:
    """The trajectory's VERIFICATION rows: decision, reason, criteriaMissing as recorded."""
    trajectory = bundle.table("trajectory")
    if not trajectory.readable:
        return Unknown(f"trajectory.tsv is {trajectory.status}")
    rows = []
    for row in trajectory.rows:
        if row.get("event_kind") != "VERIFICATION":
            continue
        facts = _facts(row.get("safe_facts", ""))
        missing = facts.get("criteriaMissing")
        rows.append({
            "taskId": row.get("task_id", ""),
            "outcome": row.get("outcome", ""),
            "reasonCode": facts.get("reasonCode"),
            "criteriaMissing": missing if isinstance(missing, int) else None,
        })
    return rows
