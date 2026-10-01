"""Evals and scoring: deterministic metrics, comparison, statistics, quality, marginal value."""

from .compare import compare_runs, match_check
from .marginal import marginal_value
from .metrics import extract_metrics
from .quality import mission_quality
from .stats import bootstrap_diff_ci, cliffs_delta, permutation_p

__all__ = [
    "compare_runs", "match_check", "marginal_value", "extract_metrics", "mission_quality",
    "bootstrap_diff_ci", "cliffs_delta", "permutation_p",
]
