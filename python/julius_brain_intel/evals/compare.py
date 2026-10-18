"""Candidate versus baseline: regression comparison and matched-run comparison.

A COMPARISON IS ONLY AS GOOD AS THE MATCH. Two runs compare like for like only if they ran the
same mission, on the same requested models per role, in the same lane and mode. ``match_check``
lists every difference; an unmatched pair can still be compared, but the report says it is
CONFOUNDED and the overall verdict cannot be IMPROVEMENT.

PER METRIC: IMPROVED / REGRESSED / UNCHANGED (within tolerance) / UNKNOWN (either side Unknown)
/ NOT_DIRECTIONAL (a neutral metric: the change is reported, never judged).

OVERALL: REGRESSION if any guarded metric regressed; IMPROVEMENT if at least one improved, none
regressed, no guarded metric is Unknown, and the runs are matched; NO_CHANGE if everything
guarded is unchanged; otherwise INCONCLUSIVE.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from .. import EVAL_SCHEMA, NOT_READINESS_AUTHORITY
from ..known import Unknown, as_json
from .metrics import HIGHER, LOWER, MetricDef, extract_metrics

IMPROVED = "IMPROVED"
REGRESSED = "REGRESSED"
UNCHANGED = "UNCHANGED"
UNKNOWN = "UNKNOWN"
NOT_DIRECTIONAL = "NOT_DIRECTIONAL"


def match_keys(analysis: Mapping[str, Any]) -> dict[str, Any]:
    """What must be equal for two runs to be a matched pair: the contract (its binding digest), the
    mode, the requested models and the runtime. NEVER a run's own identity: the two arms of a
    registered pair are two runs of ONE contract, each with its own rerun key, so their Julius run
    ids differ by design and a pair matched on them could never match."""
    roles = analysis.get("roles")
    requested: dict[str, str] = {}
    if isinstance(roles, list):
        for role in roles:
            requested.setdefault(role.get("role", "?"), role.get("requestedModel", ""))
    binding = analysis.get("binding", {})
    return {
        "mode": binding.get("mode"),
        "contractDigest": binding.get("contractDigest"),
        "requestedModels": dict(sorted(requested.items())),
        "runtimeVersion": binding.get("runtimeVersion"),
    }


def match_check(baseline: Mapping[str, Any], candidate: Mapping[str, Any]) -> dict[str, Any]:
    """Matched = same contract, mode, requested models and runtime. The commit is reported, not
    matched: a code change is usually the very intervention being measured.

    A bundle whose run recorded no learning arm carries no contract digest. For two such bundles
    the Julius run id stands in for the contract, as it always did (without a rerun key it is
    derived from the contract's digest, so equal ids = the same contract) -- and only then."""
    a, b = match_keys(baseline), match_keys(candidate)
    differences = [
        {"key": key, "baseline": a[key], "candidate": b[key]} for key in a if a[key] != b[key]
    ]
    if a["contractDigest"] is None and b["contractDigest"] is None:
        runs = (baseline.get("binding", {}).get("juliusRunId"), candidate.get("binding", {}).get("juliusRunId"))
        if runs[0] != runs[1]:
            differences.append({"key": "juliusRunId", "baseline": runs[0], "candidate": runs[1]})
    commits = (baseline.get("binding", {}).get("commit"), candidate.get("binding", {}).get("commit"))
    return {"matched": not differences, "differences": differences,
            "commitChanged": commits[0] != commits[1], "commits": {"baseline": commits[0], "candidate": commits[1]}}


def compare_metric(definition: MetricDef, base: Any, cand: Any, tolerance: float = 0.0) -> dict[str, Any]:
    entry: dict[str, Any] = {"metric": definition.name, "unit": definition.unit, "better": definition.better,
                             "baseline": as_json(base), "candidate": as_json(cand)}
    if isinstance(base, Unknown) or isinstance(cand, Unknown):
        entry["status"] = UNKNOWN
        return entry
    delta = cand - base
    entry["delta"] = delta
    if definition.better not in (HIGHER, LOWER):
        entry["status"] = NOT_DIRECTIONAL
    elif abs(delta) <= tolerance:
        entry["status"] = UNCHANGED
    elif (delta > 0) == (definition.better == HIGHER):
        entry["status"] = IMPROVED
    else:
        entry["status"] = REGRESSED
    return entry


def compare_runs(baseline: Mapping[str, Any], candidate: Mapping[str, Any],
                 tolerances: Mapping[str, float] | None = None,
                 guarded: Sequence[str] | None = None) -> dict[str, Any]:
    """Compare two ``julius.evidence-analysis.v1`` reports. ``guarded`` names the metrics whose
    regression fails the comparison (default: every directional metric both sides define)."""
    tolerances = tolerances or {}
    base_metrics, base_defs = extract_metrics(baseline)
    cand_metrics, cand_defs = extract_metrics(candidate)
    definitions = {d.name: d for d in base_defs + cand_defs}
    rows = []
    for name in sorted(definitions):
        rows.append(compare_metric(definitions[name],
                                   base_metrics.get(name, Unknown("baseline does not define it")),
                                   cand_metrics.get(name, Unknown("candidate does not define it")),
                                   tolerances.get(name, 0.0)))
    directional = [r for r in rows if r["better"] in (HIGHER, LOWER)]
    guarded_names = set(guarded) if guarded is not None else {r["metric"] for r in directional}
    guarded_rows = [r for r in rows if r["metric"] in guarded_names]
    match = match_check(baseline, candidate)
    if any(r["status"] == REGRESSED for r in guarded_rows):
        verdict = "REGRESSION"
    elif any(r["status"] == UNKNOWN for r in guarded_rows):
        verdict = "INCONCLUSIVE"
    elif any(r["status"] == IMPROVED for r in guarded_rows):
        verdict = "IMPROVEMENT" if match["matched"] else "INCONCLUSIVE"
    else:
        verdict = "NO_CHANGE"
    return {
        "schemaVersion": EVAL_SCHEMA,
        "authority": NOT_READINESS_AUTHORITY,
        "kind": "candidate_vs_baseline",
        "baseline": baseline.get("binding", {}).get("workflowRunId"),
        "candidate": candidate.get("binding", {}).get("workflowRunId"),
        "match": match,
        "confounded": not match["matched"],
        "metrics": rows,
        "guarded": sorted(guarded_names),
        "verdict": verdict,
    }
