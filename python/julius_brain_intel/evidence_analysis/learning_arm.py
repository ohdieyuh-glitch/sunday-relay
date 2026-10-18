"""One arm of a registered learning pair: which run a bundle is about, and the record that run left.

THE BUNDLE'S OWN RUN. A paid job runs ONE mission. Under decision C's Option D the WITH arm's job
restores the WITHOUT arm's store before it bootstraps, so its dump holds two runs -- the one it
inherited and its own -- and, read whole, ``runs.tsv`` holds two rows and every count is the sum
of two missions. A bundle that holds one run is read exactly as before. One that holds several is
scoped to its own, named, in order, by:

  1. the manifest's ``julius_run_id``: the dump's reading of the entrypoint's own ``Run ... accepted``
     line, i.e. the run this job's contract (and its ``learningPair`` rerun key) bootstrapped;
  2. when the manifest names none, the bundle's one arm-WITH record in ``learning.tsv``: a store
     holding several runs is a WITH arm's restored store, and the only WITH record in it is the
     job's own (the restored WITHOUT store carries a WITHOUT record and nothing else).

Nothing else is guessed. A manifest naming a run no table holds, a WITH record naming another run
than the manifest does, or no name at all leaves every row-bearing table UNATTRIBUTED.

THE RECORD. ``learning.tsv`` is the dump of the ``learning.arm.recorded`` ledger event the live
mission writes at a registered arm's terminal state (``recordJuliusLearningOutcome``): the
registration digest, the arm, its pairing (objective digest = the mission's binding digest, the one
contract both arms run, with the ``learningPair`` clause outside it; roles; runtime version) and, on
arm WITH, the WITHOUT run it was compared with, the comparison and the gate's decision. It is read
for the bundle's own run only, as recorded.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..boundary.evidence_bundle import EvidenceBundle, bundle_runs, scope_to_run
from ..known import Reading, Unknown


@dataclass(frozen=True)
class RunScope:
    runs: tuple[str, ...]
    run: str | None
    basis: str | None
    scoped: bool
    reason: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {"runs": list(self.runs), "run": self.run, "basis": self.basis, "scoped": self.scoped,
                "reason": self.reason}


def _named(value: str | None) -> str | None:
    """The dump writes ``none`` for a run it could not name: that is no name."""
    text = (value or "").strip()
    return None if text in ("", "none") else text


def _with_record_runs(bundle: EvidenceBundle) -> list[str]:
    table = bundle.table("learning")
    if not table.readable:
        return []
    return sorted({row.get("run_id", "") for row in table.rows if row.get("arm") == "WITH"} - {""})


def own_run(bundle: EvidenceBundle) -> tuple[EvidenceBundle, RunScope]:
    """The bundle read for its own run, and how that run was named."""
    runs = tuple(bundle_runs(bundle))
    named = _named(bundle.manifest.get("julius_run_id"))
    if len(runs) <= 1:
        return bundle, RunScope(runs, named, "manifest" if named else None, False)
    with_runs = _with_record_runs(bundle)

    def refuse(reason: str) -> tuple[EvidenceBundle, RunScope]:
        return scope_to_run(bundle, None, reason), RunScope(runs, None, None, False, reason)

    if named is not None:
        if named not in runs:
            return refuse(f"the manifest names {named}, which no table of this {len(runs)}-run bundle holds")
        others = [run for run in with_runs if run != named]
        if others:
            return refuse(f"the manifest names {named} but learning.tsv records arm WITH for {others}: "
                          "the bundle's own run is ambiguous")
        return scope_to_run(bundle, named), RunScope(runs, named, "manifest", True)
    if len(with_runs) == 1:
        return scope_to_run(bundle, with_runs[0]), RunScope(runs, with_runs[0], "learning_record", True)
    return refuse(f"the bundle holds {len(runs)} runs and neither its manifest nor one arm-WITH learning record "
                  "names its own")


#: ``learning.tsv`` column -> the record's field. Tokens, digests, run ids and numbers, as recorded.
_FIELDS: tuple[tuple[str, str], ...] = (
    ("run_id", "runId"), ("event_id", "eventId"), ("cites_event_id", "citesEventId"),
    ("record_version", "recordVersion"), ("registration_digest", "registrationDigest"), ("arm", "arm"),
    ("run_state", "runState"), ("objective_digest", "objectiveDigest"), ("roles", "roles"),
    ("runtime_version", "runtimeVersion"), ("without_run_id", "withoutRunId"), ("comparison", "comparison"),
    ("comparison_reason", "comparisonReason"), ("decision", "decision"), ("decision_reason", "decisionReason"),
    ("proposal", "proposal"),
)


def learning_record(bundle: EvidenceBundle) -> Reading[dict[str, Any]]:
    """The arm record of the bundle's run (read it from ``own_run``'s bundle), or why there is none."""
    table = bundle.table("learning")
    if not table.readable:
        return Unknown(f"learning.tsv is {table.status}")
    if not table.rows:
        return Unknown("no learning record: the run is not an arm of a registered pair, or its record was never made")
    if len(table.rows) > 1:
        return Unknown(f"learning.tsv holds {len(table.rows)} records for one run: ambiguous")
    row = table.rows[0]
    return {key: (row.get(column) or None) for column, key in _FIELDS}
