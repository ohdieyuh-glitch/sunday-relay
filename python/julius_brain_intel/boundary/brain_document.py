"""The canonical Project Brain document, read strictly: ``relay-project-brain.v1``.

SOURCE. ``GET /relay-api/project-brain/projects/<id>`` (operator door) or the Wonderland door's
``view=document`` -- the TypeScript projection ``buildProjectBrainDocument`` in
``src/relay/mission/project-brain/project-brain-document.ts``. This module is a READER of that
one Brain; it keeps no records of its own.

THE VOCABULARY IS MIRRORED, AND PINNED. Every constant below is asserted equal to its
TypeScript source by ``scripts/julius-brain-intel-python.test.ts``, and that test also feeds a
document built by the real projection through ``parse_brain_document``. If either side drifts,
CI fails -- the boundary cannot rot silently.

STRICT. An unknown schema version, section, status, relation or actor kind is refused with a
``BrainSchemaError``: an analysis of a document this reader does not understand would be a
guess presented as a measurement.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

BRAIN_SCHEMA_V1 = "relay-project-brain.v1"

SECTIONS: tuple[str, ...] = (
    "objective", "missions", "architecture", "requirements", "constraints", "acceptanceCriteria", "decisions",
    "research", "findings", "handoffs", "repairs", "activity", "evidence", "evals", "trace", "provenance",
    "governance", "memory", "companions",
)
STATUSES: tuple[str, ...] = (
    "PROPOSED", "ACTIVE", "ADOPTED", "ACCEPTED", "DECLINED", "RESOLVED", "ACKNOWLEDGED", "WITHDRAWN", "SUPERSEDED",
)
#: A live record still says something; WITHDRAWN and SUPERSEDED no longer do.
LIVE_STATUSES: tuple[str, ...] = ("PROPOSED", "ACTIVE", "ADOPTED", "ACCEPTED", "DECLINED", "RESOLVED", "ACKNOWLEDGED")
RELATIONS: tuple[str, ...] = (
    "SATISFIES", "REFINES", "RESPONDS_TO", "SUPPORTS", "CONTRADICTS", "SUPERSEDES", "DERIVED_FROM", "CONCERNS",
    "ACKNOWLEDGES", "REVIEWS",
)
SCOPES: tuple[str, ...] = ("PROJECT", "MISSION")
ACTOR_KINDS: tuple[str, ...] = (
    "FOUNDER", "WONDERLAND_PLAYER", "JULIUS", "PROMPT_ARCHITECT", "CODING_AGENT", "INDEPENDENT_REVIEWER", "COMPANION",
    "SYSTEM",
)
DELIVERER_KINDS: tuple[str, ...] = (
    "WONDERLAND_CLIENT", "OPERATOR_API", "JULIUS_RUNTIME", "COMPANION_CHANNEL", "RELAY_BOOTSTRAP",
)
RECORD_DOMAINS: tuple[str, ...] = (
    "USER_FACT", "PREFERENCE", "IDENTITY", "INSTRUCTION", "WORKFLOW", "SCRATCHPAD", "SHARED_CONTEXT",
    "OBJECTIVE_NOTE", "REQUIREMENT", "CONSTRAINT", "ACCEPTANCE_CRITERION", "ARCHITECTURE_NOTE",
    "DECISION", "RESEARCH_NOTE", "MISSION_INPUT", "MEMORY_REVIEW", "FINDING_RESPONSE", "GOVERNANCE_ACK",
    "COMPANION_RESULT",
)
ITEM_SOURCES: tuple[str, ...] = ("JULIUS", "PROJECT_BRAIN")


class BrainSchemaError(ValueError):
    """The document is not a ``relay-project-brain.v1`` this reader can stand behind."""


@dataclass(frozen=True)
class Actor:
    kind: str
    id: str


@dataclass(frozen=True)
class BrainItem:
    ref: str
    section: str
    kind: str
    mission_ref: str | None
    scope: str
    title: str
    text: str
    status: str | None
    version: int | None
    recorded_at: str | None
    author: Actor | None
    deliverer: Actor | None
    source: str
    source_table: str
    evidence_refs: tuple[str, ...]
    subject_ref: str | None
    attributes: Mapping[str, Any]

    @property
    def live(self) -> bool:
        """A record no one withdrew or superseded. Julius's own rows carry run states, not record statuses."""
        if self.source != "PROJECT_BRAIN":
            return True
        return self.status in LIVE_STATUSES


@dataclass(frozen=True)
class BrainLink:
    ref: str
    from_ref: str
    relation: str
    to_ref: str
    created_at: str


@dataclass(frozen=True)
class BrainMission:
    ref: str
    run_id: str
    mission_id: str
    state: str
    objective: str | None
    created_at: str
    updated_at: str
    open_blocking_findings: int
    criteria_satisfied: int
    criteria_total: int


@dataclass(frozen=True)
class BrainDocument:
    project_id: str
    observed_at: str
    cursor: str
    scope_kind: str
    scope_run_id: str | None
    revision: int
    missions: tuple[BrainMission, ...]
    sections: Mapping[str, tuple[BrainItem, ...]]
    links: tuple[BrainLink, ...]
    truncated: tuple[str, ...]

    def items(self) -> list[BrainItem]:
        return [item for section in SECTIONS for item in self.sections.get(section, ())]

    def by_ref(self) -> dict[str, BrainItem]:
        return {item.ref: item for item in self.items()}


def _need(obj: Mapping[str, Any], key: str, kind: type | tuple[type, ...], where: str) -> Any:
    if key not in obj:
        raise BrainSchemaError(f"{where}: missing {key!r}")
    value = obj[key]
    if not isinstance(value, kind):
        raise BrainSchemaError(f"{where}: {key!r} has type {type(value).__name__}")
    return value


def _opt_str(obj: Mapping[str, Any], key: str, where: str) -> str | None:
    value = obj.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise BrainSchemaError(f"{where}: {key!r} must be a string or null")
    return value


def _actor(value: Any, kinds: tuple[str, ...], where: str) -> Actor | None:
    if value is None:
        return None
    if not isinstance(value, dict) or not isinstance(value.get("kind"), str) or not isinstance(value.get("id"), str):
        raise BrainSchemaError(f"{where}: an actor is {{kind, id}}")
    if value["kind"] not in kinds:
        raise BrainSchemaError(f"{where}: unknown actor kind {value['kind']!r}")
    return Actor(value["kind"], value["id"])


def _item(raw: Any, section: str, index: int) -> BrainItem:
    where = f"sections.{section}[{index}]"
    if not isinstance(raw, dict):
        raise BrainSchemaError(f"{where}: an item is an object")
    if raw.get("section") != section:
        raise BrainSchemaError(f"{where}: filed under {section!r} but names section {raw.get('section')!r}")
    scope = _need(raw, "scope", str, where)
    if scope not in SCOPES:
        raise BrainSchemaError(f"{where}: unknown scope {scope!r}")
    source = _need(raw, "source", str, where)
    if source not in ITEM_SOURCES:
        raise BrainSchemaError(f"{where}: unknown source {source!r}")
    status = _opt_str(raw, "status", where)
    if source == "PROJECT_BRAIN" and status not in STATUSES:
        raise BrainSchemaError(f"{where}: unknown record status {status!r}")
    version = raw.get("version")
    if version is not None and (not isinstance(version, int) or isinstance(version, bool) or version < 1):
        raise BrainSchemaError(f"{where}: version must be a positive integer or null")
    refs = _need(raw, "evidenceRefs", list, where)
    if not all(isinstance(ref, str) for ref in refs):
        raise BrainSchemaError(f"{where}: evidenceRefs must be strings")
    attributes = raw.get("attributes", {})
    if not isinstance(attributes, dict):
        raise BrainSchemaError(f"{where}: attributes must be an object")
    return BrainItem(
        ref=_need(raw, "ref", str, where),
        section=section,
        kind=_need(raw, "kind", str, where),
        mission_ref=_opt_str(raw, "missionRef", where),
        scope=scope,
        title=_need(raw, "title", str, where),
        text=_need(raw, "text", str, where),
        status=status,
        version=version,
        recorded_at=_opt_str(raw, "recordedAt", where),
        author=_actor(raw.get("author"), ACTOR_KINDS, f"{where}.author"),
        deliverer=_actor(raw.get("deliverer"), DELIVERER_KINDS, f"{where}.deliverer"),
        source=source,
        source_table=_need(raw, "sourceTable", str, where),
        evidence_refs=tuple(refs),
        subject_ref=_opt_str(raw, "subjectRef", where),
        attributes=dict(attributes),
    )


def parse_brain_document(raw: Any) -> BrainDocument:
    """Parse and validate one ``relay-project-brain.v1`` document. Raises ``BrainSchemaError``."""
    if not isinstance(raw, dict):
        raise BrainSchemaError("a Brain document is a JSON object")
    version = raw.get("schemaVersion")
    if version != BRAIN_SCHEMA_V1:
        raise BrainSchemaError(f"schemaVersion {version!r} is not {BRAIN_SCHEMA_V1!r}")
    raw_sections = _need(raw, "sections", dict, "document")
    if set(raw_sections) != set(SECTIONS):
        missing = sorted(set(SECTIONS) - set(raw_sections))
        extra = sorted(set(raw_sections) - set(SECTIONS))
        raise BrainSchemaError(f"sections differ from the canonical 19: missing={missing} extra={extra}")
    sections = {
        name: tuple(_item(item, name, index) for index, item in enumerate(_need(raw_sections, name, list, "sections")))
        for name in SECTIONS
    }
    refs = [item.ref for items in sections.values() for item in items]
    if len(refs) != len(set(refs)):
        raise BrainSchemaError("an item ref appears twice: a fact is in the Brain once")
    links = []
    for index, link in enumerate(_need(raw, "links", list, "document")):
        where = f"links[{index}]"
        if not isinstance(link, dict):
            raise BrainSchemaError(f"{where}: a link is an object")
        relation = _need(link, "relation", str, where)
        if relation not in RELATIONS:
            raise BrainSchemaError(f"{where}: unknown relation {relation!r}")
        links.append(BrainLink(_need(link, "ref", str, where), _need(link, "fromRef", str, where), relation,
                               _need(link, "toRef", str, where), _need(link, "createdAt", str, where)))
    missions = []
    for index, mission in enumerate(_need(raw, "missions", list, "document")):
        where = f"missions[{index}]"
        missions.append(BrainMission(
            ref=_need(mission, "ref", str, where), run_id=_need(mission, "runId", str, where),
            mission_id=_need(mission, "missionId", str, where), state=_need(mission, "state", str, where),
            objective=_opt_str(mission, "objective", where), created_at=_need(mission, "createdAt", str, where),
            updated_at=_need(mission, "updatedAt", str, where),
            open_blocking_findings=_need(mission, "openBlockingFindings", int, where),
            criteria_satisfied=_need(mission, "criteriaSatisfied", int, where),
            criteria_total=_need(mission, "criteriaTotal", int, where),
        ))
    scope = _need(raw, "scope", dict, "document")
    scope_kind = _need(scope, "kind", str, "scope")
    if scope_kind not in SCOPES:
        raise BrainSchemaError(f"scope: unknown kind {scope_kind!r}")
    revision = _need(raw, "revision", int, "document")
    if revision < 0:
        raise BrainSchemaError("revision is a non-negative count")
    truncated = _need(raw, "truncated", list, "document")
    return BrainDocument(
        project_id=_need(raw, "projectId", str, "document"),
        observed_at=_need(raw, "observedAt", str, "document"),
        cursor=_need(raw, "cursor", str, "document"),
        scope_kind=scope_kind,
        scope_run_id=_opt_str(scope, "runId", "scope"),
        revision=revision,
        missions=tuple(missions),
        sections=sections,
        links=tuple(links),
        truncated=tuple(str(t) for t in truncated),
    )


def vocabulary() -> dict[str, list[str]]:
    """The mirrored constants, for the cross-language drift test."""
    return {
        "schemaVersion": [BRAIN_SCHEMA_V1],
        "sections": list(SECTIONS),
        "statuses": list(STATUSES),
        "liveStatuses": list(LIVE_STATUSES),
        "relations": list(RELATIONS),
        "scopes": list(SCOPES),
        "actorKinds": list(ACTOR_KINDS),
        "delivererKinds": list(DELIVERER_KINDS),
        "recordDomains": list(RECORD_DOMAINS),
    }
