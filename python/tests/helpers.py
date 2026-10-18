"""Shared test helpers: the two REAL paid-run bundles, a mutator for negative controls, and a
builder for valid ``relay-project-brain.v1`` documents.

The bundles are the GitHub artifacts of paid Mission 6 attempt 1 (run 36568129865, FAILED) and
attempt 2 (run 36915013287, COMPLETED), credential-scanned, minus the 125 KB capability-proof
ledger and the drill transcripts no analysis reads.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from typing import Callable, Mapping

from julius_brain_intel.boundary.brain_document import SECTIONS

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "fixtures")
A1 = os.path.join(FIXTURES, "bundle-a1-36568129865")
A2 = os.path.join(FIXTURES, "bundle-a2-36915013287")


class TempDirs:
    """Make throwaway copies; remove them at the end of the test."""

    def __init__(self) -> None:
        self.paths: list[str] = []

    def bundle(self, source: str, edits: Mapping[str, Callable[[str], str] | None] | None = None) -> str:
        target = tempfile.mkdtemp(prefix="jbi-bundle-")
        self.paths.append(target)
        for name in os.listdir(source):
            shutil.copy(os.path.join(source, name), os.path.join(target, name))
        for name, edit in (edits or {}).items():
            path = os.path.join(target, name)
            if edit is None:
                if os.path.exists(path):
                    os.remove(path)
                continue
            current = ""
            if os.path.exists(path):
                with open(path, encoding="utf-8", newline="") as source:
                    current = source.read()
            with open(path, "w", encoding="utf-8", newline="") as handle:
                handle.write(edit(current))
        return target

    def cleanup(self) -> None:
        for path in self.paths:
            shutil.rmtree(path, ignore_errors=True)


def set_manifest(**values: str) -> Callable[[str], str]:
    def edit(text: str) -> str:
        lines = text.splitlines()
        keys = {line.split("=", 1)[0] for line in lines if "=" in line}
        out = [f"{line.split('=', 1)[0]}={values[line.split('=', 1)[0]]}" if "=" in line and line.split("=", 1)[0] in values else line
               for line in lines]
        out += [f"{k}={v}" for k, v in values.items() if k not in keys]
        return "\n".join(out) + "\n"
    return edit


def tsv_edit(fn: Callable[[list[str], list[list[str]]], list[list[str]]]) -> Callable[[str], str]:
    """Edit a psql table's data rows; the header is kept and the footer is rewritten to match."""
    def edit(text: str) -> str:
        lines = [line for line in text.split("\n") if line != ""]
        header = lines[0].split("\t")
        rows = [line.split("\t") for line in lines[1:] if not line.startswith("(")]
        rows = fn(header, rows)
        footer = f"({len(rows)} row{'s' if len(rows) != 1 else ''})"
        return "\n".join(["\t".join(header)] + ["\t".join(r) for r in rows] + [footer]) + "\n"
    return edit


def set_cell(where: Mapping[str, str], column: str, value: str) -> Callable[[list[str], list[list[str]]], list[list[str]]]:
    def fn(header: list[str], rows: list[list[str]]) -> list[list[str]]:
        index = header.index(column)
        for row in rows:
            if all(row[header.index(k)] == v for k, v in where.items()):
                row[index] = value
        return rows
    return fn


def chain(*edits: Callable[[str], str]) -> Callable[[str], str]:
    def edit(text: str) -> str:
        for one in edits:
            text = one(text)
        return text
    return edit


# ------------------------------------------------------------------ arms of a registered pair (decision C)

#: The one Julius run attempt 2's store held.
A2_RUN = "run:efb6e20f0d11885bc5085a68"
#: What an arm's learning record pairs on: the mission's binding digest and the runtime that ran it.
CONTRACT = "sha256:" + "e" * 64
RUNTIME = "julius-runtime.v1"


def julius(n: int) -> str:
    """A Julius run id of the shape the bootstrap mints: ``run:`` and 24 hex characters."""
    return f"run:{n:024x}"


def runs_edits(own: str, inherited: str | None = None) -> dict[str, Callable[[str], str]]:
    """A2 as the bundle of run ``own``: every table's rows and the mission evidence renamed to it.
    With ``inherited``, the store also held a second run -- a WITH arm's restored WITHOUT store --
    and every table carries A2's rows once per run."""
    def table(header: list[str], rows: list[list[str]]) -> list[list[str]]:
        renamed = [[cell.replace(A2_RUN, own) for cell in row] for row in rows]
        if inherited is None:
            return renamed
        return renamed + [[cell.replace(A2_RUN, inherited) for cell in row] for row in rows]
    edits: dict[str, Callable[[str], str]] = {name: tsv_edit(table) for name in os.listdir(A2) if name.endswith(".tsv")}
    edits["live-mission.evidence.txt"] = lambda text: text.replace(A2_RUN, own)
    return edits


def repair_tasks(run_id: str, count: int) -> Callable[[list[str], list[list[str]]], list[list[str]]]:
    """``count`` repair tasks for ``run_id`` appended to ``tasks.tsv``."""
    def fn(header: list[str], rows: list[list[str]]) -> list[list[str]]:
        added = [{"task_id": f"{run_id}:build:repair:{i}", "task_type": "repair:build", "role": "CODING_AGENT",
                  "state": "SUCCEEDED", "ordinal": "3", "parent_task_id": f"{run_id}:build", "run_id": run_id}
                 for i in range(count)]
        return rows + [[row.get(h, "") for h in header] for row in added]
    return fn


#: The columns `.github/julius-live-evidence-dump.sh` selects into ``learning.tsv``, in its order.
LEARNING_COLUMNS = (
    "run_id", "sequence", "event_id", "cites_event_id", "pair_correlation", "record_version", "loop_version",
    "registration_digest", "arm", "run_state", "objective_digest", "roles", "runtime_version", "policy_dimensions",
    "policy_minimum_relative_improvement", "policy_minimum_improved_dimensions", "trajectory_rows", "runs",
    "dispatches", "retries", "repairs", "recoveries", "fallbacks", "findings", "verified_completions",
    "known_usd_micros", "cost_complete", "average_duration_ms", "known_input_tokens", "known_output_tokens",
    "unknown_usage_components", "without_run_id", "without_run_state", "without_trajectory_rows", "comparison",
    "comparison_reason", "deltas", "decision", "decision_reason", "improved", "regressed", "marginal_value",
    "proposal", "occurred_at",
)


def arm_record(run_id: str, arm: str, registration_digest: str, *, without: str | None = None,
               objective: str = CONTRACT, runtime: str = RUNTIME) -> dict[str, str]:
    """One ``learning.arm.recorded`` row as the dump writes it; arm WITH names the run it was compared with."""
    event = f"julius-learning-record.v1:{run_id}:learning.arm.recorded"
    row = {"run_id": run_id, "sequence": "40", "event_id": event, "record_version": "julius-learning-record.v1",
           "loop_version": "julius-learning-loop.v1", "registration_digest": registration_digest, "arm": arm,
           "run_state": "COMPLETED", "objective_digest": objective,
           "roles": "CODING_AGENT,INDEPENDENT_REVIEWER,PROMPT_ARCHITECT", "runtime_version": runtime,
           "policy_dimensions": "repairs", "policy_minimum_relative_improvement": "0.1",
           "policy_minimum_improved_dimensions": "1", "occurred_at": "2026-10-04 12:00:00+00"}
    if without is not None:
        row.update({"cites_event_id": f"julius-learning-record.v1:{without}:learning.arm.recorded",
                    "without_run_id": without, "without_run_state": "COMPLETED", "comparison": "COMPARED",
                    "deltas": "repairs:IMPROVED:2:0:total", "decision": "PROMOTE", "proposal": "PROMOTION_PROPOSED"})
    return row


def learning_tsv(records: list[dict[str, str]]) -> Callable[[str], str]:
    def edit(_: str) -> str:
        lines = ["\t".join(LEARNING_COLUMNS)] + ["\t".join(r.get(c, "") for c in LEARNING_COLUMNS) for r in records]
        return "\n".join(lines + [f"({len(records)} row{'s' if len(records) != 1 else ''})"]) + "\n"
    return edit


def arm_bundle(tmp: TempDirs, registration_digest: str, run_id: str, workflow_run: str, *, without: str | None = None,
               repairs: int = 0, inherited_repairs: int = 0, n_ticks: int = 4,
               records: list[dict[str, str]] | None = None, **manifest: str) -> str:
    """One arm's bundle. Arm WITHOUT (``without`` None) is a job's own fresh store: one run. Arm WITH
    restored the WITHOUT arm's store, so its bundle holds both runs and both records."""
    edits = runs_edits(run_id, inherited=without)
    edits["tasks.tsv"] = chain(edits["tasks.tsv"], tsv_edit(repair_tasks(run_id, repairs)),
                               *([tsv_edit(repair_tasks(without, inherited_repairs))] if without else []))
    edits["live-mission.evidence.txt"] = chain(
        edits["live-mission.evidence.txt"],
        lambda text: text.replace("RESULT: COMPLETED after 4 ticks", f"RESULT: COMPLETED after {n_ticks} ticks"))
    if records is None:
        records = ([arm_record(without, "WITHOUT", registration_digest), arm_record(run_id, "WITH", registration_digest, without=without)]
                   if without else [arm_record(run_id, "WITHOUT", registration_digest)])
    edits["learning.tsv"] = learning_tsv(records)
    edits["bundle-manifest.txt"] = set_manifest(**{"julius_run_id": run_id, "workflow_run_id": workflow_run, **manifest})
    return tmp.bundle(A2, edits)


def item(ref: str, section: str, *, kind: str = "RECORD", status: str | None = "ACTIVE", version: int | None = 1,
         source: str = "PROJECT_BRAIN", scope: str = "PROJECT", mission_ref: str | None = None,
         evidence: tuple[str, ...] = (), subject: str | None = None, text: str = "a statement",
         recorded_at: str = "2026-10-01T10:00:00.000Z", author_kind: str = "FOUNDER") -> dict:
    return {
        "ref": ref, "section": section, "kind": kind, "missionRef": mission_ref, "scope": scope, "title": text[:40],
        "text": text, "status": status, "version": version, "recordedAt": recorded_at,
        "author": {"kind": author_kind, "id": "founder"}, "deliverer": {"kind": "OPERATOR_API", "id": "operator"},
        "source": source, "sourceTable": "project_brain_records" if source == "PROJECT_BRAIN" else "julius_brain_entries",
        "evidenceRefs": list(evidence), "subjectRef": subject, "attributes": {},
    }


def link(ref: str, from_ref: str, relation: str, to_ref: str) -> dict:
    return {"ref": ref, "fromRef": from_ref, "relation": relation, "toRef": to_ref, "createdAt": "2026-10-01T10:00:00.000Z"}


def document(items: list[dict] = (), links: list[dict] = (), *, project: str = "prj-test", revision: int = 7,
             observed_at: str = "2026-10-01T12:00:00.000Z") -> dict:
    sections = {name: [] for name in SECTIONS}
    for entry in items:
        sections[entry["section"]].append(entry)
    return {
        "schemaVersion": "relay-project-brain.v1", "projectId": project, "observedAt": observed_at,
        "cursor": "pbc1.e30", "scope": {"kind": "PROJECT", "runId": None}, "revision": revision,
        "missions": [], "sections": sections, "links": list(links),
        "counts": {name: len(sections[name]) for name in SECTIONS}, "truncated": [],
    }


def context(entries: list[dict], run_id: str = "run:x") -> dict:
    return {"data": {"projectId": "prj-test", "runId": run_id, "entries": entries}}


def entry(entry_id: str, text: str = "context text", kind: str = "OBJECTIVE") -> dict:
    return {"entryId": entry_id, "kind": kind, "text": text, "taskIds": [], "allowedRoles": ["CODING_AGENT"],
            "sensitivity": "INTERNAL", "provenance": {"workerId": "founder", "recordedAt": "2026-10-01T10:00:00.000Z",
                                                     "evidenceIds": []}}
