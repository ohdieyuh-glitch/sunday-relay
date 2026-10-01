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
