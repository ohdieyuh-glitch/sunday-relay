"""Retrieval and ranking quality against explicit relevance judgments.

Judgments map a ref to a grade: 0 = not relevant, 1 = relevant, 2 = essential, and the special
grade ``DISTRACTOR`` (-1) for an item that is plausibly related but WRONG to include (a stale
version, another project's fact, a withdrawn statement). Without judgments there is no truth to
measure against, so every metric is Unknown -- never a perfect score by default.
"""

from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

from ..known import Unknown, as_json

DISTRACTOR = -1


def precision_at_k(ranked: Sequence[str], judgments: Mapping[str, int], k: int) -> float | Unknown:
    if not judgments:
        return Unknown("no relevance judgments")
    top = list(ranked)[:k]
    if not top:
        return Unknown("nothing retrieved")
    return sum(1 for ref in top if judgments.get(ref, 0) > 0) / len(top)


def recall_at_k(ranked: Sequence[str], judgments: Mapping[str, int], k: int) -> float | Unknown:
    relevant = {ref for ref, grade in judgments.items() if grade > 0}
    if not relevant:
        return Unknown("no relevant item judged: recall is undefined")
    return len(relevant & set(list(ranked)[:k])) / len(relevant)


def reciprocal_rank(ranked: Sequence[str], judgments: Mapping[str, int]) -> float | Unknown:
    if not any(grade > 0 for grade in judgments.values()):
        return Unknown("no relevant item judged")
    for position, ref in enumerate(ranked, start=1):
        if judgments.get(ref, 0) > 0:
            return 1.0 / position
    return 0.0


def ndcg_at_k(ranked: Sequence[str], judgments: Mapping[str, int], k: int) -> float | Unknown:
    gains = sorted((grade for grade in judgments.values() if grade > 0), reverse=True)
    if not gains:
        return Unknown("no relevant item judged")
    dcg = sum((2 ** max(judgments.get(ref, 0), 0) - 1) / math.log2(i + 2) for i, ref in enumerate(list(ranked)[:k]))
    idcg = sum((2 ** g - 1) / math.log2(i + 2) for i, g in enumerate(gains[:k]))
    return dcg / idcg


def distractor_rate(ranked: Sequence[str], judgments: Mapping[str, int], k: int) -> float | Unknown:
    top = list(ranked)[:k]
    if not top:
        return Unknown("nothing retrieved")
    if not judgments:
        return Unknown("no relevance judgments")
    return sum(1 for ref in top if judgments.get(ref, 0) == DISTRACTOR) / len(top)


def evaluate_retrieval(ranked: Sequence[str], judgments: Mapping[str, int], k: int = 10) -> dict[str, Any]:
    unjudged = [ref for ref in ranked[:k] if ref not in judgments]
    return {
        "k": k,
        "retrieved": len(ranked),
        "precisionAtK": as_json(precision_at_k(ranked, judgments, k)),
        "recallAtK": as_json(recall_at_k(ranked, judgments, k)),
        "mrr": as_json(reciprocal_rank(ranked, judgments)),
        "ndcgAtK": as_json(ndcg_at_k(ranked, judgments, k)),
        "distractorRateAtK": as_json(distractor_rate(ranked, judgments, k)),
        # An unjudged item is counted as not relevant above; say how many there were, so a high
        # precision on a mostly-unjudged list cannot pass for a measured one.
        "unjudgedInTopK": len(unjudged),
    }
