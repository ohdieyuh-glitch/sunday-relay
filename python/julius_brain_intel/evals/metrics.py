"""Deterministic metrics from one ``julius.evidence-analysis.v1`` report.

Every metric has a definition: its unit and which direction is better. A metric the evidence
does not carry is Unknown -- never zero, never borrowed from a neighbouring field. The same
report always yields the same metrics (no clock, no randomness, no I/O).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from ..known import Reading, Unknown

HIGHER = "higher"
LOWER = "lower"
NEUTRAL = "neutral"


@dataclass(frozen=True)
class MetricDef:
    name: str
    unit: str
    better: str
    description: str


def _value(cell: Any, what: str) -> Reading[Any]:
    if isinstance(cell, dict) and "value" in cell:
        return cell["value"]
    if isinstance(cell, dict) and "unknown" in cell:
        return Unknown(f"{what}: {cell['unknown']}")
    return Unknown(f"{what}: not in the analysis")


BASE_DEFS: tuple[MetricDef, ...] = (
    MetricDef("mission.completed", "bool(0/1)", HIGHER, "runs.tsv says COMPLETED and no run.failed event"),
    MetricDef("mission.ticks", "ticks", LOWER, "ticks to the terminal state, from the single RESULT line"),
    MetricDef("mission.repair_rounds", "count", LOWER, "repair tasks the run created"),
    MetricDef("mission.open_blocking_findings", "count", LOWER, "blocking findings still OPEN at the end"),
    MetricDef("mission.contract_challenges", "count", NEUTRAL, "contract challenges (never forced; neither good nor bad)"),
    MetricDef("mission.scope_violations", "count", LOWER, "scope violations Julius observed in the implementation"),
    MetricDef("mission.diff_paths", "count", NEUTRAL, "paths the final diff changes"),
    MetricDef("evidence.anomalies_p0_p1", "count", LOWER, "P0 and P1 anomalies in the bundle"),
    MetricDef("evidence.complete", "bool(0/1)", HIGHER, "every required table readable and the bundle bound to a run"),
)


def role_defs(roles: list[str]) -> tuple[MetricDef, ...]:
    out = []
    for role in sorted(set(roles)):
        out.extend([
            MetricDef(f"role.{role}.elapsed_ms", "ms", LOWER, f"{role} provider wall time, as recorded"),
            MetricDef(f"role.{role}.output_tokens", "tokens", NEUTRAL, f"{role} output tokens, as recorded"),
            MetricDef(f"role.{role}.model_exact", "bool(0/1)", HIGHER, f"{role} served the requested model"),
        ])
    return tuple(out)


def extract_metrics(analysis: Mapping[str, Any]) -> tuple[dict[str, Reading[Any]], tuple[MetricDef, ...]]:
    """Metrics plus their definitions. A role dispatched more than once sums tokens and wall time
    only if every dispatch recorded them; otherwise the role's figure is Unknown."""
    mission = analysis.get("mission", {})
    metrics: dict[str, Reading[Any]] = {}
    state = _value(mission.get("runState"), "run state")
    failed_event = _value(mission.get("runFailedEvent"), "run.failed event")
    if isinstance(state, Unknown):
        metrics["mission.completed"] = state
    elif isinstance(failed_event, Unknown):
        metrics["mission.completed"] = failed_event
    else:
        metrics["mission.completed"] = 1 if state == "COMPLETED" and not failed_event else 0
    metrics["mission.ticks"] = _value(mission.get("ticks"), "ticks")
    metrics["mission.repair_rounds"] = _value(mission.get("repairRounds"), "repair rounds")
    metrics["mission.open_blocking_findings"] = _value(mission.get("openBlockingFindings"), "open blocking findings")
    metrics["mission.contract_challenges"] = _value(mission.get("contractChallenges"), "contract challenges")
    metrics["mission.scope_violations"] = _value(mission.get("scopeViolations"), "scope violations")
    paths = _value(mission.get("diffPaths"), "diff paths")
    metrics["mission.diff_paths"] = paths if isinstance(paths, Unknown) else len(paths)
    counts = analysis.get("anomalyCounts")
    metrics["evidence.anomalies_p0_p1"] = (counts.get("P0", 0) + counts.get("P1", 0)) if isinstance(counts, dict) else Unknown("no anomaly counts")
    complete = analysis.get("completeness", {}).get("complete")
    metrics["evidence.complete"] = (1 if complete else 0) if isinstance(complete, bool) else Unknown("no completeness")

    roles = analysis.get("roles")
    role_names: list[str] = []
    if isinstance(roles, list):
        grouped: dict[str, list[Mapping[str, Any]]] = {}
        for role in roles:
            grouped.setdefault(role.get("role", "?"), []).append(role)
        role_names = list(grouped)
        for name, dispatches in grouped.items():
            elapsed = [_value(d.get("latency", {}).get("elapsedMs"), f"{name} elapsed_ms") for d in dispatches]
            tokens = [_value(d.get("tokens", {}).get("output"), f"{name} output tokens") for d in dispatches]
            unknown_elapsed = next((e for e in elapsed if isinstance(e, Unknown)), None)
            unknown_tokens = next((t for t in tokens if isinstance(t, Unknown)), None)
            # `Unknown` is falsy on purpose, so `unknown or sum(...)` would sum it: branch explicitly.
            metrics[f"role.{name}.elapsed_ms"] = unknown_elapsed if unknown_elapsed is not None else sum(elapsed)  # type: ignore[arg-type]
            metrics[f"role.{name}.output_tokens"] = unknown_tokens if unknown_tokens is not None else sum(tokens)  # type: ignore[arg-type]
            metrics[f"role.{name}.model_exact"] = 1 if all(d.get("modelMatch") in ("EXACT", "DATED_BUILD") for d in dispatches) else 0
    elif isinstance(roles, dict) and "unknown" in roles:
        metrics["roles"] = Unknown(roles["unknown"])
    return metrics, BASE_DEFS + role_defs(role_names)
