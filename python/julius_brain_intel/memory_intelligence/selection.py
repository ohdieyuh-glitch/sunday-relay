"""A deterministic, scope-first memory selector -- ADVISORY, and measurable.

The runtime's own selection (the TypeScript context compiler) is the authority on what a worker
reads; nothing here changes it. This selector exists so a candidate selection policy can be
EVALUATED against judged sets before anyone proposes it to the runtime: the learning loop needs a
candidate to measure, and a candidate must be inspectable.

ORDER IS THE RULE. 1) Deterministic scope: same project, PROJECT-scoped or this mission's own,
live, in an allowed section. 2) Only then ranking, by explicit features: authority of status,
cited evidence, recency. 3) A character budget, applied last. Every selected and every rejected
item carries the reason, so a selection is explainable line by line.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from ..boundary.brain_document import BrainDocument, BrainItem

STATUS_AUTHORITY: Mapping[str, int] = {"ADOPTED": 3, "ACCEPTED": 3, "RESOLVED": 2, "ACKNOWLEDGED": 2,
                                       "ACTIVE": 1, "PROPOSED": 0, "DECLINED": -1}
DEFAULT_SECTIONS: tuple[str, ...] = ("objective", "requirements", "constraints", "acceptanceCriteria", "decisions",
                                     "architecture", "research", "findings", "memory")


@dataclass(frozen=True)
class SelectionPolicy:
    sections: tuple[str, ...] = DEFAULT_SECTIONS
    budget_chars: int = 6000
    include_declined: bool = False


def _in_scope(item: BrainItem, run_id: str | None, policy: SelectionPolicy) -> str | None:
    """None if in scope, else the reason it is not."""
    if item.section not in policy.sections:
        return "section not selected"
    if not item.live:
        return f"not live ({item.status})"
    if item.status == "DECLINED" and not policy.include_declined:
        return "declined"
    if item.scope == "MISSION" and run_id is not None and item.mission_ref not in (None, f"mission:{run_id}"):
        return "another mission's item"
    return None


def _rank_key(item: BrainItem) -> tuple:
    authority = STATUS_AUTHORITY.get(item.status or "", 1 if item.source == "JULIUS" else 0)
    return (-authority, -len(item.evidence_refs), -(_ts(item.recorded_at)), item.ref)


def _ts(text: str | None) -> float:
    from datetime import datetime
    if not text:
        return 0.0
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def select(document: BrainDocument, run_id: str | None, policy: SelectionPolicy = SelectionPolicy()) -> dict[str, Any]:
    rejected: list[dict[str, str]] = []
    candidates: list[BrainItem] = []
    for item in document.items():
        reason = _in_scope(item, run_id, policy)
        if reason is None:
            candidates.append(item)
        else:
            rejected.append({"ref": item.ref, "reason": reason})
    candidates.sort(key=_rank_key)
    selected: list[dict[str, Any]] = []
    used = 0
    for rank, item in enumerate(candidates, start=1):
        size = len(item.text)
        if used + size > policy.budget_chars:
            rejected.append({"ref": item.ref, "reason": "over the character budget"})
            continue
        used += size
        selected.append({"ref": item.ref, "rank": rank, "section": item.section, "status": item.status,
                         "evidence": len(item.evidence_refs), "chars": size})
    return {"projectId": document.project_id, "runId": run_id, "policy": policy.__dict__,
            "selected": selected, "rejected": rejected, "charactersUsed": used,
            "advisory": "measurement candidate only; the runtime's context compiler decides what a worker reads"}


def selected_refs(selection: Mapping[str, Any]) -> Sequence[str]:
    return [row["ref"] for row in selection["selected"]]
