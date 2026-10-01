"""Measurable marginal value of a module: runs WITH it versus runs WITHOUT it, on one metric.

This is how a fuzzy module, a context selector, a prompt change or any other optional component
earns its place: an ablation with a declared metric and direction, an effect size, an interval
and a test -- and a verdict that refuses to call a single pair, or an interval that straddles
zero, "value".

VERDICTS: VALUE (the interval excludes zero in the better direction and the effect meets the
declared minimum), HARM (excludes zero in the worse direction), NO_DETECTABLE_VALUE (the interval
includes zero), INSUFFICIENT (too few runs to form an interval), UNKNOWN (a run lacks the metric).
"""

from __future__ import annotations

from typing import Any, Sequence

from .. import EVAL_SCHEMA, NOT_READINESS_AUTHORITY
from ..known import Unknown, as_json
from .metrics import HIGHER, LOWER
from .stats import bootstrap_diff_ci, cliffs_delta, mean, permutation_p


def marginal_value(module: str, metric: str, better: str, with_module: Sequence[Any], without_module: Sequence[Any],
                   *, min_effect: float = 0.0, seed: int = 0) -> dict[str, Any]:
    if better not in (HIGHER, LOWER):
        raise ValueError("better must be 'higher' or 'lower': a neutral metric has no marginal value")
    report: dict[str, Any] = {
        "schemaVersion": EVAL_SCHEMA, "authority": NOT_READINESS_AUTHORITY, "kind": "marginal_value",
        "module": module, "metric": metric, "better": better, "minEffect": min_effect, "seed": seed,
        "n": {"with": len(with_module), "without": len(without_module)},
    }
    unknowns = [v for v in list(with_module) + list(without_module) if isinstance(v, Unknown)]
    if unknowns:
        report.update(verdict="UNKNOWN", why=f"{len(unknowns)} run(s) lack the metric: {unknowns[0].reason}")
        return report
    w = [float(v) for v in with_module]
    wo = [float(v) for v in without_module]
    if not w or not wo:
        report.update(verdict="INSUFFICIENT", why="each arm needs at least one run")
        return report
    effect = mean(w) - mean(wo)
    signed = effect if better == HIGHER else -effect  # positive = better with the module
    ci = bootstrap_diff_ci(wo, w, seed=seed)
    report.update(effect=effect, effectInBetterDirection=signed, cliffsDelta=as_json(cliffs_delta(wo, w)),
                  ci95=as_json(ci), permutationP=as_json(permutation_p(wo, w, seed=seed)))
    if isinstance(ci, Unknown):
        report.update(verdict="INSUFFICIENT", why=ci.reason)
        return report
    lo, hi = ci if better == HIGHER else (-ci[1], -ci[0])
    if lo > 0 and signed >= min_effect:
        verdict = "VALUE"
    elif hi < 0:
        verdict = "HARM"
    else:
        verdict = "NO_DETECTABLE_VALUE"
    report["verdict"] = verdict
    return report
