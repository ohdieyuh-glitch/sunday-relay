"""Read the granted Project Brain slice; stage typed records for Julius.

READS come from the evaluation-context snapshot Julius cut for this execution:
exactly the kinds, missions and tasks the read grant admits, pinned to one
Brain sequence and hashed. There is no connection to anything; a script cannot
widen what it sees.

WRITES ARE STAGED, NEVER SAVED. ``record_*`` validates the record against the
Brain schema and the write grant and returns a ``Staged`` proposal. Julius
decides after the process exits - and only if the execution was not cancelled -
what is admitted, under which principal, with which provenance.
"""

from . import _session
from .errors import JuliusBrainValidationError
from .evidence import Evidence, EvaluationResult
from .schema import validate_body

_RELATIONS = (
    "CONTRADICTS", "SUPPORTS", "DERIVED_FROM", "RESOLVES", "EVIDENCED_BY", "ANSWERS", "PRODUCED_BY", "RELATES_TO",
)


class Entity:
    """A read-only view of one Brain entity from the granted snapshot."""

    __slots__ = ("_state",)

    def __init__(self, state):
        self._state = state

    entity_id = property(lambda self: self._state["entityId"])
    kind = property(lambda self: self._state["kind"])
    version = property(lambda self: self._state["version"])
    lifecycle = property(lambda self: self._state["lifecycle"])
    scope = property(lambda self: dict(self._state["scope"]))
    confidence = property(lambda self: self._state["confidence"])
    superseded_by = property(lambda self: self._state["supersededBy"])
    created_by = property(lambda self: dict(self._state["createdBy"]))
    links = property(lambda self: [dict(link) for link in self._state["links"]])
    inbound = property(lambda self: [dict(edge) for edge in self._state["inbound"]])

    @property
    def body(self):
        import copy
        return copy.deepcopy(self._state["body"])

    def get(self, field, default=None):
        return self._state["body"].get(field, default)

    def contradicted_by(self):
        return [edge["source"] for edge in self._state["inbound"] if edge["relation"] == "CONTRADICTS"]

    def __repr__(self):
        return "Entity(%s %s v%s %s)" % (self.kind, self.entity_id, self.version, self.lifecycle)


class Staged:
    """A proposal. ``status`` is STAGED: nothing has been written anywhere."""

    __slots__ = ("proposal_id", "kind", "status")

    def __init__(self, proposal_id, kind):
        self.proposal_id = proposal_id
        self.kind = kind
        self.status = "STAGED"

    @property
    def ref(self):
        return "proposal:%s" % self.proposal_id

    def __repr__(self):
        return "Staged(%s %s)" % (self.kind, self.proposal_id)


# --------------------------------------------------------------------- reads

def snapshot_hash():
    return _session.current().context["snapshotHash"]


def through_sequence():
    return _session.current().context["throughSequence"]


def execution_id():
    return _session.current().execution_id


def state_mode():
    """The state mode this snapshot was selected under, as Julius recorded it.

    ``{"mode": ..., "policyHash": ..., "excluded": {...}}``, or None when no mode
    was applied. ``excluded`` counts prior state withheld from this execution by
    reason — what a FRESH analysis was deliberately not allowed to see.
    """
    import copy
    return copy.deepcopy(_session.current().context.get("stateMode"))


def inputs():
    """The JSON inputs Julius passed to this execution (a deep copy)."""
    import copy
    return copy.deepcopy(_session.current().inputs)


def entities(kind=None, lifecycle="ACTIVE", mission_id=None, task_id=None):
    kinds = (kind,) if isinstance(kind, str) else (tuple(kind) if kind is not None else None)
    out = []
    for state in _session.current().context["entities"]:
        if kinds is not None and state["kind"] not in kinds:
            continue
        if lifecycle is not None and state["lifecycle"] != lifecycle:
            continue
        if mission_id is not None and state["scope"]["missionId"] not in (None, mission_id):
            continue
        if task_id is not None and state["scope"]["taskId"] != task_id:
            continue
        out.append(Entity(state))
    return out


def get(entity_id):
    for state in _session.current().context["entities"]:
        if state["entityId"] == entity_id:
            return Entity(state)
    return None


def get_objective():
    """The active objective, or None when the grant admits none (never a guess)."""
    found = entities("OBJECTIVE")
    return found[-1] if found else None


def get_requirements():
    return [item for item in entities("REQUIREMENT") if item.get("status") == "ACTIVE"]


def get_constraints():
    return [item for item in entities(("CONSTRAINT", "PROHIBITION")) if item.get("status") == "ACTIVE"]


def get_acceptance_criteria():
    return [item for item in entities("ACCEPTANCE_CRITERION") if item.get("status") == "ACTIVE"]


def list_decisions(include_superseded=False):
    return entities("DECISION", lifecycle=None if include_superseded else "ACTIVE")


def query_research(text=None):
    found = entities("RESEARCH")
    if text is None:
        return found
    needle = text.lower()
    return [item for item in found if needle in item.get("question", "").lower()]


def query_evidence(claim=None, evidence_class=None):
    found = entities("EVIDENCE")
    if evidence_class is not None:
        found = [item for item in found if item.get("evidenceClass") == evidence_class]
    if claim is not None:
        needle = claim.lower()
        found = [item for item in found if needle in item.get("claim", "").lower()]
    return found


def query_evals(name=None):
    found = entities("EVAL")
    return found if name is None else [item for item in found if item.get("evaluationName") == name]


def findings(status=None):
    found = entities("FINDING")
    return found if status is None else [item for item in found if item.get("status") == status]


def repairs(status=None):
    found = entities("REPAIR")
    return found if status is None else [item for item in found if item.get("status") == status]


def artifacts():
    return entities("ARTIFACT")


# -------------------------------------------------------------------- writes

def _target(value):
    if isinstance(value, Staged):
        return value.ref
    if isinstance(value, Entity):
        return value.entity_id
    if isinstance(value, str) and value:
        return value
    raise JuliusBrainValidationError("a link target must be an entity id, an Entity or a Staged proposal")


def _links(**relations):
    links = []
    for name, targets in relations.items():
        relation = name.upper()
        if relation not in _RELATIONS:
            raise JuliusBrainValidationError("unknown or forbidden relation %s" % relation)
        for target in targets or ():
            links.append({"relation": relation, "target": _target(target)})
    return links


def _stage(kind, body, links=(), confidence=None, retention="DURABLE", artifact_name=None):
    session = _session.current()
    if kind not in session.write_kinds:
        raise JuliusBrainValidationError("the write grant for this execution does not permit %s" % kind)
    if len(session.proposals) >= session.max_records:
        raise JuliusBrainValidationError("the write grant allows at most %d records" % session.max_records)
    if confidence is not None and (isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1):
        raise JuliusBrainValidationError("confidence must be None or within 0..1")
    body = _session.ensure_json(body, "body")
    validate_body(session.schema, kind, body)
    proposal = {
        "proposalId": session.next_proposal_id(),
        "kind": kind,
        "body": body,
        "links": list(links),
        "confidence": confidence,
        "retention": retention,
    }
    if artifact_name is not None:
        proposal["artifactName"] = artifact_name
    session.proposals.append(proposal)
    return Staged(proposal["proposalId"], kind)


def record_evidence(evidence, supports=(), derived_from=(), contradicts=(), relates_to=(), confidence=None):
    if not isinstance(evidence, Evidence):
        raise JuliusBrainValidationError("record_evidence takes a julius.evidence.Evidence")
    return _stage("EVIDENCE", evidence.body(),
                  _links(supports=supports, derived_from=derived_from, contradicts=contradicts, relates_to=relates_to),
                  confidence)


def record_eval(evaluation, evidenced_by=(), relates_to=()):
    if not isinstance(evaluation, EvaluationResult):
        raise JuliusBrainValidationError("record_eval takes a julius.evidence.EvaluationResult")
    return _stage("EVAL", evaluation.body(), _links(evidenced_by=evidenced_by, relates_to=relates_to))


def record_finding(statement, severity="MEDIUM", finding_class="RISK", evidenced_by=(), relates_to=()):
    """A tool finding is never blocking: whether it blocks is Julius's decision."""
    return _stage("FINDING", {
        "findingClass": finding_class, "severity": severity, "statement": statement,
        "blocking": False, "status": "OPEN", "juliusFindingId": None,
    }, _links(evidenced_by=evidenced_by, relates_to=relates_to))


def remember(statement, expires_at=None, evidenced_by=()):
    """Memory a script generates is admitted UNVERIFIED, and as working memory."""
    return _stage("MEMORY_FACT", {"statement": statement, "trust": "UNVERIFIED", "expiresAt": expires_at},
                  _links(evidenced_by=evidenced_by), retention="WORKING")


def trace(summary, **facts):
    return _stage("TRACE", {"traceClass": "TOOL_INVOCATION", "summary": summary, "facts": facts})


def register_artifact(name, artifact_class="PYTHON_OUTPUT", content_type="application/octet-stream"):
    """Stage an ARTIFACT for a file written with ``julius.artifacts.write``.

    The hash, size and storage reference are filled in by Julius from the bytes
    it collected; values a script supplies for them would be claims, and are not
    accepted.
    """
    import os
    session = _session.current()
    if os.path.basename(name) != name or name.startswith("."):
        raise JuliusBrainValidationError("artifact names are plain file names inside the output directory")
    if not os.path.isfile(os.path.join(session.output_dir, name)):
        raise JuliusBrainValidationError("no artifact named %s was written" % name)
    placeholder = "sha256:" + "0" * 64
    return _stage("ARTIFACT", {
        "artifactClass": artifact_class, "name": name, "contentType": content_type,
        "byteSize": 0, "contentHash": placeholder, "storageRef": "pending://julius-host", "commit": None,
    }, artifact_name=name)
