"""The mission as the bundle records it: state, tasks, decisions, findings, repairs, challenges,
acceptance, the implementation diff, tool invocations and settlement.

Each field is read from the table that owns it, and a field whose table is not readable is
Unknown. Two rules from the pre-registered reading rules apply here because they are rules about
the EVIDENCE, not about credit:

- R-RESULT: more than one ``RESULT:`` line in ``live-mission.evidence.txt`` makes the reported
  terminal state ambiguous, so the tick count it carries is Unknown.
- R-B6: a ``julius.run.failed`` event makes the run FAILED whatever ``runs.tsv`` says; this module
  reports both and lets the anomaly layer flag a disagreement.
"""

from __future__ import annotations

import re
from typing import Any

from ..boundary.evidence_bundle import EvidenceBundle
from ..known import Reading, Unknown, as_json, parse_int

_RESULT = re.compile(r"^RESULT: (?P<state>[A-Z_]+)(?: after (?P<ticks>[0-9]+) ticks?)?")
_DIFF_PATH = re.compile(r"^diff --git a/(\S+) b/(\S+)$", re.MULTILINE)
_GENERATION = re.compile(r":g(?P<g>[0-9]+)$|:(?P<a>[0-9]+):[0-9]+$")

TERMINAL_INVOCATION_STATES = ("SUCCEEDED", "FAILED", "CANCELLED")


def _readable_rows(bundle: EvidenceBundle, name: str) -> Reading[tuple[dict[str, str], ...]]:
    table = bundle.table(name)
    if not table.readable:
        return Unknown(f"{name}.tsv is {table.status}")
    return table.rows


def result_lines(bundle: EvidenceBundle) -> Reading[list[dict[str, Any]]]:
    text = bundle.text("live-mission.evidence.txt")
    if text is None:
        return Unknown("live-mission.evidence.txt missing")
    out = []
    for line in text.splitlines():
        match = _RESULT.match(line.strip())
        if match:
            ticks = match.group("ticks")
            out.append({"state": match.group("state"), "ticks": int(ticks) if ticks else None})
    return out


def evidence_generation(evidence_id: str) -> int | None:
    """The attempt generation an evidence id names (``…:g<gen>`` or ``…:<gen>:<n>``), if any."""
    match = _GENERATION.search(evidence_id)
    if not match:
        return None
    return int(match.group("g") or match.group("a"))


def diff_paths(bundle: EvidenceBundle) -> Reading[list[str]]:
    diff = bundle.text("workspace.diff")
    status = bundle.text("workspace-status.txt")
    if diff is None and status is None:
        return Unknown("workspace.diff and workspace-status.txt missing")
    paths = {match.group(2) for match in _DIFF_PATH.finditer(diff or "")}
    for line in (status or "").splitlines():
        parts = line.strip().split(maxsplit=1)
        if len(parts) == 2:
            paths.add(parts[1])
    if not paths and not (diff or "").strip() and not (status or "").strip():
        # R-B3: both empty on a run is UNREADABLE -- the workflow captures them with `|| true`,
        # so empty can mean git failed. It is not "no change".
        return Unknown("workspace.diff and workspace-status.txt are both empty: unreadable, not 'no change'")
    return sorted(paths)


def mission_summary(bundle: EvidenceBundle) -> dict[str, Any]:
    runs = _readable_rows(bundle, "runs")
    tasks = _readable_rows(bundle, "tasks")
    decisions = _readable_rows(bundle, "decisions")
    findings = _readable_rows(bundle, "finding-status")
    contract_events = _readable_rows(bundle, "contract-events")
    invocations = _readable_rows(bundle, "tool-invocations")
    scope = _readable_rows(bundle, "scope")
    failures = _readable_rows(bundle, "failures")
    duplicates = _readable_rows(bundle, "settlement-integrity")

    run_state: Reading[str]
    if isinstance(runs, Unknown):
        run_state = runs
    elif len(runs) != 1:
        run_state = Unknown(f"runs.tsv holds {len(runs)} runs; one bundle is one run")
    else:
        run_state = runs[0].get("state", "") or Unknown("run state blank")

    results = result_lines(bundle)
    ticks: Reading[int]
    if isinstance(results, Unknown):
        ticks = results
    elif len(results) != 1:
        ticks = Unknown(f"{len(results)} RESULT lines: ambiguous (R-RESULT)")
    elif results[0]["ticks"] is None:
        ticks = Unknown("RESULT line carries no tick count")
    else:
        ticks = results[0]["ticks"]

    run_failed_event: Reading[bool]
    if isinstance(failures, Unknown):
        run_failed_event = failures
    else:
        run_failed_event = any(row.get("event_type") == "julius.run.failed" for row in failures)

    def count(rows: Reading[tuple[dict[str, str], ...]], predicate) -> Reading[int]:
        return rows if isinstance(rows, Unknown) else sum(1 for row in rows if predicate(row))

    repairs = count(tasks, lambda row: row.get("task_type", "").startswith("repair:"))
    open_blocking = count(findings, lambda row: row.get("blocking") in ("t", "true") and row.get("effective_status") == "OPEN")
    challenges = count(contract_events, lambda row: row.get("event_type") == "julius.contract.challenged")
    dispositions = (contract_events if isinstance(contract_events, Unknown)
                    else [row.get("disposition", "") for row in contract_events
                          if row.get("event_type") == "julius.contract.disposition"])
    non_terminal = count(invocations, lambda row: row.get("state") not in TERMINAL_INVOCATION_STATES)
    scope_violations: Reading[int]
    if isinstance(scope, Unknown):
        scope_violations = scope
    else:
        recorded = [parse_int(row.get("scope_violations"), "scope_violations") for row in scope
                    if row.get("event_type") == "julius.coder.implementation.recorded"]
        known = [value for value in recorded if not isinstance(value, Unknown)]
        scope_violations = sum(known) if known else Unknown("no implementation.recorded row with a scope count")
    report_refusals = count(scope, lambda row: row.get("event_type") == "julius.coder.report.refused")

    return {
        "runState": as_json(run_state),
        "runFailedEvent": as_json(run_failed_event),
        "ticks": as_json(ticks),
        "resultLines": as_json(results),
        "tasks": as_json(tasks if isinstance(tasks, Unknown) else [
            {"taskId": row.get("task_id"), "role": row.get("role"), "type": row.get("task_type"), "state": row.get("state")}
            for row in tasks]),
        "decisions": as_json(decisions if isinstance(decisions, Unknown) else [
            {"taskId": row.get("task_id"), "action": row.get("action"), "reasonCode": row.get("reason_code"),
             "evidenceIds": row.get("evidence_ids")} for row in decisions]),
        "repairRounds": as_json(repairs),
        "openBlockingFindings": as_json(open_blocking),
        "contractChallenges": as_json(challenges),
        "contractDispositions": as_json(dispositions),
        "nonTerminalInvocations": as_json(non_terminal),
        "scopeViolations": as_json(scope_violations),
        "coderReportRefusals": as_json(report_refusals),
        "duplicateSettlements": as_json(duplicates if isinstance(duplicates, Unknown) else len(duplicates)),
        "diffPaths": as_json(diff_paths(bundle)),
    }
