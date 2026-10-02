"""What Julius actually read for one mission: the ``julius-context`` response.

SOURCE. ``GET /relay-api/project-brain/projects/<id>/julius-context?runId=`` answers
``{projectId, runId, entries}`` where each entry is a ``JuliusBrainEntry``
(``src/relay/mission/julius/julius-runtime.ts``). Project Brain records arrive as
``pbr:<uuid>@v<n>`` -- the version is part of the id, so a reader can tell exactly which
version a worker was handed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .brain_document import BrainSchemaError

ENTRY_KINDS: tuple[str, ...] = (
    "OBJECTIVE", "REQUIREMENT", "CONSTRAINT", "DECISION", "FINDING", "REPAIR", "HANDOFF", "ARTIFACT", "EVIDENCE",
)
SENSITIVITIES: tuple[str, ...] = ("PUBLIC", "INTERNAL", "SECRET")
ROLES: tuple[str, ...] = ("PROMPT_ARCHITECT", "CODING_AGENT", "INDEPENDENT_REVIEWER")
_VERSIONED = re.compile(r"^(pbr:[^@]+)@v([1-9][0-9]*)$")


@dataclass(frozen=True)
class ContextEntry:
    entry_id: str
    kind: str
    text: str
    task_ids: tuple[str, ...]
    allowed_roles: tuple[str, ...]
    sensitivity: str
    worker_id: str | None
    recorded_at: str | None
    evidence_ids: tuple[str, ...]

    @property
    def record_ref(self) -> str | None:
        """For a Project Brain record entry, the record's ref without its version."""
        match = _VERSIONED.match(self.entry_id)
        return match.group(1) if match else None

    @property
    def record_version(self) -> int | None:
        match = _VERSIONED.match(self.entry_id)
        return int(match.group(2)) if match else None


@dataclass(frozen=True)
class JuliusContext:
    project_id: str
    run_id: str
    entries: tuple[ContextEntry, ...]


def parse_julius_context(raw: Any) -> JuliusContext:
    if not isinstance(raw, dict):
        raise BrainSchemaError("a julius-context answer is an object")
    data = raw.get("data", raw)  # the bridge wraps answers as {data: ...}; accept either
    for key in ("projectId", "runId", "entries"):
        if key not in data:
            raise BrainSchemaError(f"julius-context: missing {key!r}")
    entries = []
    for index, entry in enumerate(data["entries"]):
        where = f"entries[{index}]"
        if not isinstance(entry, dict):
            raise BrainSchemaError(f"{where}: an entry is an object")
        kind = entry.get("kind")
        if kind not in ENTRY_KINDS:
            raise BrainSchemaError(f"{where}: unknown kind {kind!r}")
        sensitivity = entry.get("sensitivity")
        if sensitivity not in SENSITIVITIES:
            raise BrainSchemaError(f"{where}: unknown sensitivity {sensitivity!r}")
        roles = entry.get("allowedRoles", [])
        if not all(role in ROLES for role in roles):
            raise BrainSchemaError(f"{where}: unknown role in allowedRoles")
        provenance = entry.get("provenance") or {}
        entries.append(ContextEntry(
            entry_id=str(entry.get("entryId", "")),
            kind=kind,
            text=str(entry.get("text", "")),
            task_ids=tuple(str(t) for t in entry.get("taskIds", [])),
            allowed_roles=tuple(roles),
            sensitivity=sensitivity,
            worker_id=provenance.get("workerId"),
            recorded_at=provenance.get("recordedAt"),
            evidence_ids=tuple(str(e) for e in provenance.get("evidenceIds", [])),
        ))
    return JuliusContext(str(data["projectId"]), str(data["runId"]), tuple(entries))
