"""Conflicting memory: two things the Brain holds that cannot both be acted on.

Deterministic, from typed fields only -- no similarity guessing:

    CONTRADICTION_LINKED   a CONTRADICTS link joins two items that are both live
    ADOPTED_VS_DECLINED    two records of the same kind about the same subject, one ADOPTED or
                           ACCEPTED and one DECLINED, both still live

Text that merely differs is not reported: two requirements about one subject can both hold.
"""

from __future__ import annotations

from typing import Any

from ..boundary.brain_document import BrainDocument

_AFFIRMED = ("ADOPTED", "ACCEPTED")


def detect_conflicts(document: BrainDocument) -> list[dict[str, Any]]:
    items = document.by_ref()
    conflicts: list[dict[str, Any]] = []
    for link in document.links:
        if link.relation != "CONTRADICTS":
            continue
        a, b = items.get(link.from_ref), items.get(link.to_ref)
        if a is not None and b is not None and a.live and b.live:
            conflicts.append({"signal": "CONTRADICTION_LINKED", "refs": [a.ref, b.ref], "link": link.ref,
                              "statuses": [a.status, b.status]})
    by_subject: dict[tuple[str, str], list] = {}
    for item in document.items():
        if item.source == "PROJECT_BRAIN" and item.subject_ref and item.live:
            by_subject.setdefault((item.kind, item.subject_ref), []).append(item)
    for (kind, subject), group in sorted(by_subject.items()):
        affirmed = [i for i in group if i.status in _AFFIRMED]
        declined = [i for i in group if i.status == "DECLINED"]
        for a in affirmed:
            for d in declined:
                conflicts.append({"signal": "ADOPTED_VS_DECLINED", "kind": kind, "subjectRef": subject,
                                  "refs": [a.ref, d.ref], "statuses": [a.status, d.status]})
    return conflicts
