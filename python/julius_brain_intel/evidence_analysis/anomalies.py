"""Anomalies in one bundle: deterministic rules over typed fields, each with a stable code.

A detector reports what the evidence SAYS, with the rows it read. It never reports what it
cannot read as clean: an unreadable source yields an ``EVIDENCE_UNREADABLE`` anomaly naming the
file, never silence. Severities follow the project's usage (P0 credential exposure; P1 a
provenance, money or integrity fault; P2 evidence the scorecard needs is missing; P3 noise worth
recording). They are labels for triage, not credit.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..boundary.evidence_bundle import EvidenceBundle
from ..known import Unknown
from .mission import TERMINAL_INVOCATION_STATES, diff_paths, evidence_generation, result_lines
from .roles import DATED_BUILD, EXACT, RoleExecution, role_executions


@dataclass(frozen=True)
class Anomaly:
    code: str
    severity: str
    subject: str
    detail: str
    evidence: tuple[str, ...] = field(default_factory=tuple)

    def to_json(self) -> dict[str, Any]:
        return {"code": self.code, "severity": self.severity, "subject": self.subject, "detail": self.detail,
                "evidence": list(self.evidence)}


def _unreadable(name: str, bundle: EvidenceBundle) -> Anomaly:
    table = bundle.table(name)
    return Anomaly("EVIDENCE_UNREADABLE", "P2", f"{name}.tsv", f"{table.status}: {'; '.join(table.problems) or 'no detail'}")


def detect_anomalies(bundle: EvidenceBundle, permitted_paths: tuple[str, ...] | None = None) -> list[Anomaly]:
    out: list[Anomaly] = []

    for problem in bundle.problems:
        if "_shaped_content_withheld" in problem:
            out.append(Anomaly("CREDENTIAL_SHAPED_CONTENT", "P0", problem.split(":", 1)[-1],
                               "credential- or reasoning-shaped content was found and withheld on load"))

    roles = role_executions(bundle)
    if isinstance(roles, Unknown):
        out.append(_unreadable("worker-diagnostics", bundle))
        roles = []
    for execution in roles:
        out.extend(_role_anomalies(execution))

    out.extend(_settlement_anomalies(bundle))
    out.extend(_invocation_anomalies(bundle))
    out.extend(_scope_anomalies(bundle))
    out.extend(_result_anomalies(bundle))
    out.extend(_stale_accept_anomalies(bundle, roles))

    manifest = bundle.manifest
    if bundle.manifest_present and manifest.get("tracked_changes", "0") not in ("0", ""):
        out.append(Anomaly("TRACKED_CHANGES_NONZERO", "P2", "bundle-manifest.txt",
                           f"tracked_changes={manifest.get('tracked_changes')}: the run's checkout was not clean (R-TC)"))

    paths = diff_paths(bundle)
    run_state = bundle.table("runs").rows[0].get("state") if bundle.table("runs").readable and bundle.table("runs").rows else None
    if isinstance(paths, Unknown):
        if run_state == "COMPLETED":
            out.append(Anomaly("DIFF_UNREADABLE", "P1", "workspace.diff", paths.reason))
    else:
        if run_state == "COMPLETED" and not paths:
            out.append(Anomaly("EMPTY_DIFF_ON_COMPLETED_RUN", "P1", "workspace.diff", "a COMPLETED run changed nothing (R-B4)"))
        if permitted_paths is not None:
            outside = [path for path in paths if path not in permitted_paths]
            if outside:
                out.append(Anomaly("DIFF_OUTSIDE_PERMITTED_PATHS", "P1", "workspace.diff",
                                   f"changed paths outside the contract: {outside}", tuple(outside)))
    return out


def _role_anomalies(execution: RoleExecution) -> list[Anomaly]:
    out = []
    subject = f"{execution.role}:{execution.task_id}"
    if execution.model_match not in (EXACT, DATED_BUILD):
        out.append(Anomaly("SERVED_MODEL_" + execution.model_match, "P1", subject,
                           f"requested {execution.requested_model!r}, served {execution.served_model!r}"))
    if execution.role == "CODING_AGENT" and execution.served_basis != "attested":
        basis = execution.served_basis.reason if isinstance(execution.served_basis, Unknown) else execution.served_basis
        out.append(Anomaly("SERVED_MODEL_NOT_ATTESTED", "P1", subject,
                           f"the coder's served model basis is {basis!r}, not 'attested'"))
    if isinstance(execution.elapsed_ms, Unknown) and isinstance(execution.trajectory_duration_ms, Unknown):
        out.append(Anomaly("LATENCY_UNRECORDED", "P2", subject,
                           f"no explicit duration: elapsed_ms ({execution.elapsed_ms.reason}); "
                           f"trajectory ({execution.trajectory_duration_ms.reason})"))
    if (not isinstance(execution.output_tokens, Unknown) and not isinstance(execution.usage_output_tokens, Unknown)
            and execution.output_tokens != execution.usage_output_tokens):
        out.append(Anomaly("TOKEN_SOURCES_DISAGREE", "P3", subject,
                           f"output tokens {execution.output_tokens} (result) vs {execution.usage_output_tokens} (modelUsage)"))
    if execution.billing_path == "API_BILLED" and execution.cost_usd_micros == 0 and execution.cost_basis == "UNKNOWN":
        out.append(Anomaly("UNKNOWN_COST_RECORDED_AS_ZERO", "P1", subject, "an unknown API cost is recorded as $0"))
    if execution.billing_path == "SUBSCRIPTION" and execution.cost_usd_micros == 0:
        out.append(Anomaly("SUBSCRIPTION_COST_RECORDED_AS_ZERO", "P1", subject,
                           "subscription usage must be NOT_APPLICABLE (null), never $0"))
    return out


def _settlement_anomalies(bundle: EvidenceBundle) -> list[Anomaly]:
    out = []
    duplicates = bundle.table("settlement-integrity")
    if not duplicates.readable:
        out.append(_unreadable("settlement-integrity", bundle))
    elif duplicates.rows:
        out.append(Anomaly("DUPLICATE_SETTLEMENT", "P1", "settlement-integrity.tsv",
                           f"{len(duplicates.rows)} reservation(s) settled more than once",
                           tuple(row.get("reservation_id", "") for row in duplicates.rows)))
    budget = bundle.table("budget")
    if budget.readable:
        reserved = {row.get("reservation_id") for row in budget.rows if row.get("event_type") == "julius.budget.reserved"}
        settled = {row.get("reservation_id") for row in budget.rows if row.get("event_type") == "julius.budget.settled"}
        unsettled = sorted(r for r in reserved - settled if r)
        if unsettled:
            out.append(Anomaly("UNSETTLED_RESERVATION", "P2", "budget.tsv",
                               f"{len(unsettled)} reservation(s) never settled", tuple(unsettled)))
    return out


def _invocation_anomalies(bundle: EvidenceBundle) -> list[Anomaly]:
    invocations = bundle.table("tool-invocations")
    if not invocations.readable:
        return [_unreadable("tool-invocations", bundle)]
    open_rows = [row for row in invocations.rows if row.get("state") not in TERMINAL_INVOCATION_STATES]
    if not open_rows:
        return []
    return [Anomaly("OPEN_INVOCATION", "P1", "tool-invocations.tsv",
                    f"{len(open_rows)} invocation(s) not terminal", tuple(row.get("invocation_id", "") for row in open_rows))]


def _scope_anomalies(bundle: EvidenceBundle) -> list[Anomaly]:
    scope = bundle.table("scope")
    if not scope.readable:
        return [_unreadable("scope", bundle)]
    out = []
    for row in scope.rows:
        if row.get("event_type") == "julius.coder.report.refused":
            reason = row.get("reason_code") or ""
            out.append(Anomaly("CODER_REPORT_REFUSED", "P2", row.get("task_id", ""),
                               f"the coder's self-report was refused; reason {'exported: ' + reason if reason else 'NOT exported by the dump'}",
                               (f"scope.tsv seq {row.get('sequence', '')}",)))
        if row.get("event_type") == "julius.coder.scope.violated":
            out.append(Anomaly("SCOPE_VIOLATION", "P1", row.get("task_id", ""), f"rule {row.get('rule', '')}"))
    return out


def _result_anomalies(bundle: EvidenceBundle) -> list[Anomaly]:
    results = result_lines(bundle)
    runs = bundle.table("runs")
    if isinstance(results, Unknown) or not runs.readable or len(runs.rows) != 1:
        return []
    out = []
    if len(results) > 1:
        out.append(Anomaly("AMBIGUOUS_RESULT", "P1", "live-mission.evidence.txt",
                           f"{len(results)} RESULT lines (R-RESULT): the terminal state is ambiguous"))
    state = runs.rows[0].get("state")
    if len(results) == 1 and results[0]["state"] != state:
        out.append(Anomaly("RESULT_DISAGREES_WITH_RUNS", "P1", "live-mission.evidence.txt",
                           f"RESULT says {results[0]['state']}, runs.tsv says {state}"))
    failures = bundle.table("failures")
    if failures.readable and any(row.get("event_type") == "julius.run.failed" for row in failures.rows) and state != "FAILED":
        out.append(Anomaly("RUN_FAILED_EVENT_BUT_STATE", "P1", "failures.tsv",
                           f"a julius.run.failed event exists while runs.tsv says {state} (R-B6: the run reads FAILED)"))
    return out


def _stale_accept_anomalies(bundle: EvidenceBundle, roles: list[RoleExecution]) -> list[Anomaly]:
    """R-A: an ACCEPT whose every cited evidence id is from an older generation than the task's accepted attempt."""
    decisions = bundle.table("decisions")
    if not decisions.readable:
        return [_unreadable("decisions", bundle)]
    attempts: dict[str, int] = {}
    for execution in roles:
        if not isinstance(execution.dispatch_attempt, Unknown):
            attempts[execution.task_id] = max(attempts.get(execution.task_id, 0), execution.dispatch_attempt)
    out = []
    for row in decisions.rows:
        if row.get("action") != "ACCEPT":
            continue
        task = row.get("task_id", "")
        accepted = attempts.get(task)
        ids = [part.strip().strip('"') for part in row.get("evidence_ids", "").strip("[]").split(",") if part.strip()]
        generations = [g for g in (evidence_generation(i) for i in ids) if g is not None]
        if accepted is None or not generations:
            continue
        if max(generations) < accepted:
            out.append(Anomaly("STALE_EVIDENCE_ACCEPT", "P1", task,
                               f"ACCEPT cites generations {sorted(set(generations))} below the accepted attempt {accepted} (R-A)",
                               tuple(ids)))
    return out
