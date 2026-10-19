"""Stale memory: statements that were true once and are not what Julius should act on now.

Four deterministic signals, each read from typed fields of the canonical Brain:

    SUPERSEDED_LIVE      a live item is the target of a SUPERSEDES link from another live item
    DEAD_IN_CONTEXT      Julius's context carries a record that is WITHDRAWN or SUPERSEDED
    VERSION_LAG          Julius read ``pbr:<id>@v<n>`` while the Brain now holds a later version
    CITES_FAILED         an item's only evidence is evidence whose own status is FAILED

Age alone is NOT staleness: an old adopted requirement is still the requirement. A caller may
pass an explicit ``max_age_days`` policy; without one, no item is stale for being old.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..boundary.brain_document import BrainDocument
from ..boundary.context_entries import JuliusContext


def _parse_time(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def detect_stale(document: BrainDocument, context: JuliusContext | None = None,
                 max_age_days: float | None = None, now: str | None = None) -> list[dict[str, Any]]:
    items = document.by_ref()
    findings: list[dict[str, Any]] = []
    for link in document.links:
        if link.relation != "SUPERSEDES":
            continue
        newer, older = items.get(link.from_ref), items.get(link.to_ref)
        if newer is not None and older is not None and newer.live and older.live:
            findings.append({"signal": "SUPERSEDED_LIVE", "ref": older.ref, "supersededBy": newer.ref,
                             "detail": "still live although a live item supersedes it"})
    if context is not None:
        for entry in context.entries:
            ref = entry.record_ref
            if ref is None:
                continue
            item = items.get(ref)
            if item is None:
                continue
            if item.status in ("WITHDRAWN", "SUPERSEDED"):
                findings.append({"signal": "DEAD_IN_CONTEXT", "ref": ref, "status": item.status,
                                 "entryId": entry.entry_id, "detail": "Julius was handed a record nobody stands behind"})
            if item.version is not None and entry.record_version is not None and entry.record_version < item.version:
                findings.append({"signal": "VERSION_LAG", "ref": ref, "readVersion": entry.record_version,
                                 "currentVersion": item.version, "entryId": entry.entry_id})
    failed_evidence = {item.ref for item in document.sections.get("evidence", ()) if (item.status or "").upper() == "FAILED"}
    for item in document.items():
        if item.evidence_refs and all(ref in failed_evidence for ref in item.evidence_refs) and item.section != "evidence":
            findings.append({"signal": "CITES_FAILED", "ref": item.ref, "evidence": list(item.evidence_refs),
                             "detail": "every piece of evidence it cites FAILED"})
    if max_age_days is not None:
        reference = _parse_time(now) or _parse_time(document.observed_at)
        for item in document.items():
            recorded = _parse_time(item.recorded_at)
            if reference is not None and recorded is not None and item.live:
                age = (reference - recorded).total_seconds() / 86400
                if age > max_age_days:
                    findings.append({"signal": "OLDER_THAN_POLICY", "ref": item.ref, "ageDays": round(age, 2),
                                     "policyDays": max_age_days})
    return findings
