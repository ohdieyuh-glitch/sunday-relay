"""Memory intelligence over the canonical Brain: retrieval quality, staleness, conflicts, budget,
an advisory selector and mission-history usefulness."""

from typing import Any, Mapping

from .. import MEMORY_EVAL_SCHEMA, NOT_READINESS_AUTHORITY
from ..boundary.brain_document import BrainDocument
from ..boundary.context_entries import JuliusContext
from .budget import context_budget
from .conflicts import detect_conflicts
from .history import history_usefulness
from .retrieval import DISTRACTOR, evaluate_retrieval
from .selection import SelectionPolicy, select, selected_refs
from .staleness import detect_stale


def memory_report(document: BrainDocument, context: JuliusContext | None = None,
                  judgments: Mapping[str, int] | None = None, run_id: str | None = None,
                  policy: SelectionPolicy = SelectionPolicy(), k: int = 10) -> dict[str, Any]:
    """One ``julius.memory-eval.v1`` report: the Brain's memory health, and how well a selection
    (Julius's own context if given, else the advisory selector's) matches the judgments."""
    selection = select(document, run_id, policy)
    report: dict[str, Any] = {
        "schemaVersion": MEMORY_EVAL_SCHEMA,
        "authority": NOT_READINESS_AUTHORITY,
        "projectId": document.project_id,
        "brainRevision": document.revision,
        "stale": detect_stale(document, context),
        "conflicts": detect_conflicts(document),
        "history": history_usefulness(document),
        "advisorySelection": selection,
    }
    if judgments is not None:
        report["advisorySelectionQuality"] = evaluate_retrieval(list(selected_refs(selection)), judgments, k)
    if context is not None:
        refs = [entry.record_ref or entry.entry_id for entry in context.entries]
        report["juliusContextBudget"] = context_budget(context, judgments)
        if judgments is not None:
            report["juliusContextQuality"] = evaluate_retrieval(refs, judgments, k)
    return report


__all__ = [
    "DISTRACTOR", "SelectionPolicy", "context_budget", "detect_conflicts", "detect_stale", "evaluate_retrieval",
    "history_usefulness", "memory_report", "select", "selected_refs",
]
