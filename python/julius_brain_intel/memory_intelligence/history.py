"""Mission-history usefulness: did what was carried from earlier missions get used?

Julius carries a prior mission's VERIFIED/APPROVED knowledge into a new run as entries named
``carried:<sourceRun>:<entryId>`` (``juliusCarriedEntryId``). An entry is USED when something the
later mission produced cites it -- a decision's or an item's evidence refs, or a subject ref. A
carried entry nothing cites is not proven useless (a worker may have read it silently), so the
ratio is reported as a LOWER BOUND on usefulness, and an empty carry is Unknown.
"""

from __future__ import annotations

from typing import Any

from ..boundary.brain_document import BrainDocument
from ..known import Unknown, as_json

CARRIED_PREFIX = "carried:"


def _cited(document: BrainDocument) -> set[str]:
    cited: set[str] = set()
    for item in document.items():
        cited.update(item.evidence_refs)
        if item.subject_ref:
            cited.add(item.subject_ref)
    return cited


def history_usefulness(document: BrainDocument) -> dict[str, Any]:
    carried = [item for item in document.items()
               if CARRIED_PREFIX in item.ref or item.attributes.get("entryId", "").__str__().startswith(CARRIED_PREFIX)]
    if not carried:
        return {"carried": 0, "cited": 0, "usedShareLowerBound": as_json(Unknown("no carried entries in this document"))}
    cited_refs = _cited(document)

    def key(item) -> set[str]:
        keys = {item.ref}
        entry = item.attributes.get("entryId")
        if isinstance(entry, str):
            keys.add(entry)
        return keys

    used = [item.ref for item in carried if key(item) & cited_refs]
    return {"carried": len(carried), "cited": len(used), "usedRefs": used,
            "usedShareLowerBound": as_json(len(used) / len(carried))}
