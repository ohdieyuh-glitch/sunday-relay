"""One bundle in, one ``julius.evidence-analysis.v1`` report out.

One bundle is one run: a bundle whose store held several (the WITH arm of a registered pair restores
the WITHOUT arm's store) is read for its own run only (``learning_arm.own_run``), and ``runScope``
says which run that was and how it was named.
"""

from __future__ import annotations

from typing import Any

from .. import EVIDENCE_ANALYSIS_SCHEMA, NOT_READINESS_AUTHORITY
from ..boundary.evidence_bundle import EvidenceBundle
from ..known import Unknown
from .anomalies import detect_anomalies
from .completeness import completeness, inventory
from .learning_arm import learning_record, own_run
from .mission import mission_summary
from .roles import role_executions, verification_facts


def analyze_bundle(bundle: EvidenceBundle, permitted_paths: tuple[str, ...] | None = None) -> dict[str, Any]:
    bundle, scope = own_run(bundle)
    roles = role_executions(bundle)
    verification = verification_facts(bundle)
    anomalies = detect_anomalies(bundle, permitted_paths)
    learning = learning_record(bundle)
    recorded = learning if isinstance(learning, dict) else {}
    return {
        "schemaVersion": EVIDENCE_ANALYSIS_SCHEMA,
        "authority": NOT_READINESS_AUTHORITY,
        "binding": {
            "workflowRunId": bundle.manifest.get("workflow_run_id"),
            "workflowRunAttempt": bundle.manifest.get("workflow_run_attempt"),
            "commit": bundle.manifest.get("commit"),
            "tree": bundle.manifest.get("tree"),
            "mode": bundle.manifest.get("mode"),
            "juliusRunId": bundle.manifest.get("julius_run_id"),
            # The contract both arms of a registered pair run (the mission's binding digest, the
            # learningPair clause outside it) and the runtime that ran it, as the arm's own learning
            # record carries them. None when the run recorded no arm: never inferred.
            "contractDigest": recorded.get("objectiveDigest"),
            "runtimeVersion": recorded.get("runtimeVersion"),
            "note": "bind by workflowRunId: the Julius run id is derived from the contract and repeats across attempts, "
                    "unless the run is an arm of a registered pair, which takes its own through its rerun key",
        },
        "runScope": scope.to_json(),
        "learning": learning.to_json() if isinstance(learning, Unknown) else learning,
        "completeness": completeness(bundle),
        "inventory": inventory(bundle),
        "roles": roles.to_json() if isinstance(roles, Unknown) else [r.to_json() for r in roles],
        "verification": verification.to_json() if isinstance(verification, Unknown) else verification,
        "mission": mission_summary(bundle),
        "anomalies": [a.to_json() for a in anomalies],
        "anomalyCounts": {sev: sum(1 for a in anomalies if a.severity == sev) for sev in ("P0", "P1", "P2", "P3")},
    }
