"""Mission quality: a fixed rubric of deterministic checks over one evidence analysis.

Each check is PASS, FAIL or UNKNOWN, with the field it read. The summary counts them and never
folds UNKNOWN into either side. This is a measurement of one mission's evidence; it is not the
scorecard and it does not award credit.
"""

from __future__ import annotations

from typing import Any, Mapping

from .. import EVAL_SCHEMA, NOT_READINESS_AUTHORITY

PASS = "PASS"
FAIL = "FAIL"
UNKNOWN = "UNKNOWN"


def _val(cell: Any) -> tuple[bool, Any]:
    if isinstance(cell, dict) and "value" in cell:
        return True, cell["value"]
    return False, cell.get("unknown") if isinstance(cell, dict) else None


def _check(name: str, cell: Any, predicate, source: str) -> dict[str, Any]:
    known, value = _val(cell)
    if not known:
        return {"check": name, "status": UNKNOWN, "source": source, "why": value}
    return {"check": name, "status": PASS if predicate(value) else FAIL, "source": source, "observed": value}


def mission_quality(analysis: Mapping[str, Any]) -> dict[str, Any]:
    mission = analysis.get("mission", {})
    roles = analysis.get("roles")
    checks = [
        _check("completed", mission.get("runState"), lambda v: v == "COMPLETED", "runs.tsv"),
        _check("no run.failed event", mission.get("runFailedEvent"), lambda v: v is False, "failures.tsv"),
        _check("one unambiguous RESULT", mission.get("ticks"), lambda v: isinstance(v, int), "live-mission.evidence.txt"),
        _check("diff non-empty", mission.get("diffPaths"), lambda v: len(v) > 0, "workspace.diff"),
        _check("no open blocking finding", mission.get("openBlockingFindings"), lambda v: v == 0, "finding-status.tsv"),
        _check("no scope violation", mission.get("scopeViolations"), lambda v: v == 0, "scope.tsv"),
        _check("no open tool invocation", mission.get("nonTerminalInvocations"), lambda v: v == 0, "tool-invocations.tsv"),
        _check("no duplicate settlement", mission.get("duplicateSettlements"), lambda v: v == 0, "settlement-integrity.tsv"),
    ]
    if isinstance(roles, list) and roles:
        checks.append({"check": "every role served its requested model", "source": "worker-diagnostics.tsv",
                       "status": PASS if all(r.get("modelMatch") in ("EXACT", "DATED_BUILD") for r in roles) else FAIL})
        latency_known = [isinstance(r.get("latency", {}).get("elapsedMs"), dict) and "value" in r["latency"]["elapsedMs"] for r in roles]
        checks.append({"check": "every role's latency recorded", "source": "worker-diagnostics.tsv",
                       "status": PASS if all(latency_known) else FAIL,
                       "observed": f"{sum(latency_known)}/{len(latency_known)}"})
    else:
        checks.append({"check": "every role served its requested model", "status": UNKNOWN, "source": "worker-diagnostics.tsv"})
        checks.append({"check": "every role's latency recorded", "status": UNKNOWN, "source": "worker-diagnostics.tsv"})
    verification = analysis.get("verification")
    if isinstance(verification, list) and verification:
        missing = [v.get("criteriaMissing") for v in verification]
        checks.append({"check": "no acceptance criterion missing at verification", "source": "trajectory.tsv",
                       "status": UNKNOWN if any(m is None for m in missing) else (PASS if all(m == 0 for m in missing) else FAIL),
                       "observed": missing})
    else:
        checks.append({"check": "no acceptance criterion missing at verification", "status": UNKNOWN, "source": "trajectory.tsv"})
    counts = {status: sum(1 for c in checks if c["status"] == status) for status in (PASS, FAIL, UNKNOWN)}
    return {
        "schemaVersion": EVAL_SCHEMA,
        "authority": NOT_READINESS_AUTHORITY,
        "kind": "mission_quality",
        "run": analysis.get("binding", {}).get("workflowRunId"),
        "checks": checks,
        "counts": counts,
        # A ratio over KNOWN checks only, with the unknown count beside it: never a score that hides gaps.
        "passRateOfKnown": (counts[PASS] / (counts[PASS] + counts[FAIL])) if (counts[PASS] + counts[FAIL]) else None,
    }
