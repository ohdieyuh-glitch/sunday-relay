"""Context-budget efficiency: how much of what Julius was handed was worth its characters."""

from __future__ import annotations

from typing import Any, Mapping

from ..boundary.context_entries import JuliusContext
from ..known import Unknown, as_json


def context_budget(context: JuliusContext, judgments: Mapping[str, int] | None = None) -> dict[str, Any]:
    entries = context.entries
    total = sum(len(e.text) for e in entries)
    by_kind: dict[str, int] = {}
    for entry in entries:
        by_kind[entry.kind] = by_kind.get(entry.kind, 0) + len(entry.text)
    seen: dict[str, int] = {}
    duplicate_chars = 0
    for entry in entries:
        key = " ".join(entry.text.split())
        if key in seen:
            duplicate_chars += len(entry.text)
        seen[key] = seen.get(key, 0) + 1
    relevant_share: object
    if judgments is None or not judgments:
        relevant_share = Unknown("no relevance judgments")
    elif total == 0:
        relevant_share = Unknown("empty context")
    else:
        def key_of(entry):
            return entry.record_ref or entry.entry_id
        relevant = sum(len(e.text) for e in entries if judgments.get(key_of(e), 0) > 0)
        relevant_share = relevant / total
    return {
        "entries": len(entries),
        "characters": total,
        "charactersByKind": dict(sorted(by_kind.items())),
        "duplicateCharacters": duplicate_chars,
        "duplicateShare": (duplicate_chars / total) if total else 0.0,
        "relevantShare": as_json(relevant_share),
        "secretEntries": sum(1 for e in entries if e.sensitivity == "SECRET"),
    }
