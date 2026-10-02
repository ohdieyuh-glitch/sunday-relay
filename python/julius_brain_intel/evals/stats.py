"""Small-sample statistics, deterministic by construction (seeded, no global state).

Paid Julius runs are few. These functions therefore say INSUFFICIENT when a sample cannot
support a statement, instead of producing an interval from one point. Every random procedure
takes an explicit seed and uses its own ``random.Random`` so a report is reproducible.
"""

from __future__ import annotations

import itertools
import math
import random
from typing import Sequence

from ..known import Reading, Unknown

MIN_PER_SIDE = 2


def mean(values: Sequence[float]) -> float:
    return sum(values) / len(values)


def bootstrap_diff_ci(baseline: Sequence[float], candidate: Sequence[float], *, seed: int = 0,
                      iterations: int = 4000, alpha: float = 0.05) -> Reading[tuple[float, float]]:
    """Percentile bootstrap CI for mean(candidate) - mean(baseline)."""
    if len(baseline) < MIN_PER_SIDE or len(candidate) < MIN_PER_SIDE:
        return Unknown(f"bootstrap needs >= {MIN_PER_SIDE} runs per side (have {len(baseline)} and {len(candidate)})")
    rng = random.Random(seed)
    diffs = []
    for _ in range(iterations):
        b = [baseline[rng.randrange(len(baseline))] for _ in baseline]
        c = [candidate[rng.randrange(len(candidate))] for _ in candidate]
        diffs.append(mean(c) - mean(b))
    diffs.sort()
    lo = diffs[int(math.floor((alpha / 2) * (iterations - 1)))]
    hi = diffs[int(math.ceil((1 - alpha / 2) * (iterations - 1)))]
    return (lo, hi)


def permutation_p(baseline: Sequence[float], candidate: Sequence[float], *, seed: int = 0,
                  max_exact: int = 20000, samples: int = 20000) -> Reading[float]:
    """Two-sided permutation p-value for a difference in means. Exact when the labelings are few."""
    if len(baseline) < MIN_PER_SIDE or len(candidate) < MIN_PER_SIDE:
        return Unknown(f"a permutation test needs >= {MIN_PER_SIDE} runs per side")
    pooled = list(baseline) + list(candidate)
    n_c = len(candidate)
    observed = abs(mean(candidate) - mean(baseline))
    total = math.comb(len(pooled), n_c)
    hits = 0
    if total <= max_exact:
        for chosen in itertools.combinations(range(len(pooled)), n_c):
            chosen_set = set(chosen)
            c = [pooled[i] for i in chosen]
            b = [pooled[i] for i in range(len(pooled)) if i not in chosen_set]
            if abs(mean(c) - mean(b)) >= observed - 1e-12:
                hits += 1
        return hits / total
    rng = random.Random(seed)
    for _ in range(samples):
        shuffled = pooled[:]
        rng.shuffle(shuffled)
        if abs(mean(shuffled[:n_c]) - mean(shuffled[n_c:])) >= observed - 1e-12:
            hits += 1
    return (hits + 1) / (samples + 1)


def cliffs_delta(baseline: Sequence[float], candidate: Sequence[float]) -> Reading[float]:
    """P(candidate > baseline) - P(candidate < baseline), in [-1, 1]."""
    if not baseline or not candidate:
        return Unknown("Cliff's delta needs at least one run per side")
    greater = sum(1 for c in candidate for b in baseline if c > b)
    less = sum(1 for c in candidate for b in baseline if c < b)
    return (greater - less) / (len(candidate) * len(baseline))
