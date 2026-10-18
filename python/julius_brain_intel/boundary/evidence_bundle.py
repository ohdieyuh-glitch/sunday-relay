"""The paid-run evidence bundle, read as data: ``julius.evidence-bundle.v1``.

SOURCE. The ``julius-live-evidence`` artifact that ``.github/julius-live-evidence-dump.sh``
writes: one ``psql -A -F '\\t'`` table per ``*.tsv`` (header row, data rows, a ``(N rows)``
footer), a ``key=value`` ``bundle-manifest.txt``, and a few plain files
(``workspace.diff``, ``workspace-status.txt``, ``live-mission.evidence.txt``). These are
machine formats the dump defines; nothing here parses a human-readable log.

EVERY TABLE SAYS HOW FAR IT CAN BE TRUSTED:

    PRESENT          header, rows, and a footer whose count equals the rows read
    EMPTY_CONFIRMED  header and a ``(0 rows)`` footer: the query RAN and found nothing
    EMPTY_UNCONFIRMED header only, no footer: zero rows cannot be told from a query that died
    UNAVAILABLE      the dump wrote ``unavailable``: the query failed
    MALFORMED        ragged rows, or a footer that disagrees with the rows read
                     (a newline inside a cell splits a row; the reader must not guess)
    MISSING          the file is not in the bundle
    UNATTRIBUTED     the bundle holds more than one run and these rows cannot be scoped to its
                     own (no run named, no ``run_id`` column, or a row naming no run)

A row-dependent reading over anything but PRESENT/EMPTY_CONFIRMED is Unknown.

ONE BUNDLE IS ONE RUN, EVEN WHEN ITS STORE HELD TWO. Under decision C's Option D the WITH arm's
job restores the WITHOUT arm's database before it bootstraps, so its dump carries both runs.
``scope_to_run`` reads such a bundle for one run: every table keeps that run's rows only
(``run_id`` is appended to every run-bearing table by the dump), and a table whose rows cannot
be attributed is UNATTRIBUTED rather than summed across two missions.

CREDENTIALS ARE WITHHELD ON LOAD. A cell whose text matches a refused shape is replaced and
recorded as a problem, so no analysis built on this object can echo it.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Iterable

from ..safety import forbidden_material, withheld

BUNDLE_SCHEMA = "julius.evidence-bundle.v1"

PRESENT = "PRESENT"
EMPTY_CONFIRMED = "EMPTY_CONFIRMED"
EMPTY_UNCONFIRMED = "EMPTY_UNCONFIRMED"
UNAVAILABLE = "UNAVAILABLE"
MALFORMED = "MALFORMED"
MISSING = "MISSING"
UNATTRIBUTED = "UNATTRIBUTED"
READABLE = (PRESENT, EMPTY_CONFIRMED)

_FOOTER = re.compile(r"^\((\d+) rows?\)$")
_TEXT_FILES = (
    "workspace.diff",
    "workspace-status.txt",
    "live-mission.evidence.txt",
    "subscription-smoke.txt",
    "executor-diagnostics.txt",
    "provider-readiness.txt",
    "preflight-roles.evidence.txt",
)


@dataclass(frozen=True)
class Table:
    name: str
    status: str
    header: tuple[str, ...] = ()
    rows: tuple[dict[str, str], ...] = ()
    footer_count: int | None = None
    problems: tuple[str, ...] = ()

    @property
    def readable(self) -> bool:
        return self.status in READABLE

    def column(self, name: str) -> list[str]:
        return [row.get(name, "") for row in self.rows]


@dataclass
class EvidenceBundle:
    path: str
    manifest: dict[str, str]
    manifest_present: bool
    tables: dict[str, Table]
    texts: dict[str, str]
    problems: list[str] = field(default_factory=list)

    def table(self, name: str) -> Table:
        """The named table, or a MISSING one -- never a KeyError mid-analysis."""
        return self.tables.get(name) or Table(name=name, status=MISSING)

    def text(self, name: str) -> str | None:
        return self.texts.get(name)

    @property
    def workflow_run_id(self) -> str | None:
        return self.manifest.get("workflow_run_id") or None

    def to_json(self) -> dict[str, object]:
        return {
            "schemaVersion": BUNDLE_SCHEMA,
            "path": self.path,
            "manifest": dict(self.manifest) if self.manifest_present else None,
            "tables": {
                name: {
                    "status": t.status,
                    "rows": len(t.rows),
                    "footerCount": t.footer_count,
                    "problems": list(t.problems),
                }
                for name, t in sorted(self.tables.items())
            },
            "texts": {name: len(body) for name, body in sorted(self.texts.items())},
            "problems": list(self.problems),
        }


def _scrub(cell: str, where: str, problems: list[str]) -> str:
    kind = forbidden_material(cell)
    if kind is None:
        return cell
    problems.append(f"{kind}_shaped_content_withheld:{where}")
    return withheld(kind)


def parse_table(name: str, body: str, problems: list[str]) -> Table:
    """One psql ``-A -F '\\t'`` table. ``problems`` collects bundle-level findings."""
    lines = [line.rstrip("\r") for line in body.split("\n")]
    lines = [line for line in lines if line != ""]
    if not lines:
        return Table(name=name, status=EMPTY_UNCONFIRMED, problems=("zero bytes",))
    if any(line.strip() == "unavailable" for line in lines):
        return Table(name=name, status=UNAVAILABLE, problems=("the dump wrote unavailable",))
    footers = [line for line in lines if _FOOTER.match(line)]
    data = [line for line in lines if not _FOOTER.match(line)]
    header = tuple(data[0].split("\t"))
    table_problems: list[str] = []
    rows: list[dict[str, str]] = []
    ragged = 0
    for index, line in enumerate(data[1:], start=1):
        cells = line.split("\t")
        if len(cells) != len(header):
            ragged += 1
            continue
        rows.append({h: _scrub(c, f"{name}:{index}:{h}", problems) for h, c in zip(header, cells)})
    footer_count = None
    if len(footers) == 1:
        footer_count = int(_FOOTER.match(footers[0]).group(1))  # type: ignore[union-attr]
    elif len(footers) > 1:
        table_problems.append(f"{len(footers)} footers")
    if ragged:
        table_problems.append(f"{ragged} ragged row(s)")
    if footer_count is not None and footer_count != len(rows) + ragged:
        table_problems.append(f"footer says {footer_count} rows, {len(rows) + ragged} read")
    if table_problems:
        return Table(name, MALFORMED, header, tuple(rows), footer_count, tuple(table_problems))
    if not rows:
        status = EMPTY_CONFIRMED if footer_count == 0 else EMPTY_UNCONFIRMED
        return Table(name, status, header, (), footer_count, () if footer_count == 0 else ("no footer",))
    if footer_count is None:
        return Table(name, PRESENT, header, tuple(rows), None, ("no footer: row count unconfirmed",))
    return Table(name, PRESENT, header, tuple(rows), footer_count)


def parse_manifest(body: str) -> dict[str, str]:
    manifest: dict[str, str] = {}
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        manifest[key.strip()] = value.strip()
    return manifest


def _read(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="replace", newline="") as handle:
        return handle.read()


def load_bundle(directory: str, names: Iterable[str] | None = None) -> EvidenceBundle:
    """Load every table and text file in ``directory``. Raises only if it is not a directory."""
    if not os.path.isdir(directory):
        raise FileNotFoundError(f"not an evidence bundle directory: {directory}")
    problems: list[str] = []
    tables: dict[str, Table] = {}
    texts: dict[str, str] = {}
    wanted = set(names) if names is not None else None
    for entry in sorted(os.listdir(directory)):
        full = os.path.join(directory, entry)
        if not os.path.isfile(full):
            continue
        if entry.endswith(".tsv"):
            name = entry[: -len(".tsv")]
            if wanted is None or name in wanted:
                tables[name] = parse_table(name, _read(full), problems)
        elif entry in _TEXT_FILES:
            body = _read(full)
            kind = forbidden_material(body)
            if kind is not None:
                problems.append(f"{kind}_shaped_content_withheld:{entry}")
                body = withheld(kind)
            texts[entry] = body
    manifest_path = os.path.join(directory, "bundle-manifest.txt")
    manifest_present = os.path.isfile(manifest_path)
    manifest = parse_manifest(_read(manifest_path)) if manifest_present else {}
    if not manifest_present:
        problems.append("bundle-manifest.txt missing: the bundle cannot be bound to a run or a commit")
    return EvidenceBundle(directory, manifest, manifest_present, tables, texts, problems)


def bundle_runs(bundle: EvidenceBundle) -> list[str]:
    """Every run any table names in its ``run_id`` column, sorted. One for a job's own fresh store."""
    runs: set[str] = set()
    for table in bundle.tables.values():
        if "run_id" in table.header:
            runs.update(row.get("run_id", "") for row in table.rows)
    runs.discard("")
    return sorted(runs)


def _scoped(table: Table, run_id: str | None, reason: str) -> Table:
    if not table.rows:
        return table  # nothing to attribute: a refused, missing or empty table stays what it was
    if run_id is None:
        return Table(table.name, UNATTRIBUTED, table.header, (), table.footer_count, (reason,))
    if "run_id" not in table.header:
        return Table(table.name, UNATTRIBUTED, table.header, (), table.footer_count,
                     (f"no run_id column: its rows cannot be scoped to {run_id}",))
    blank = sum(1 for row in table.rows if not row.get("run_id"))
    if blank:
        return Table(table.name, UNATTRIBUTED, table.header, (), table.footer_count,
                     (f"{blank} row(s) name no run: they cannot be scoped to {run_id}",))
    kept = tuple(row for row in table.rows if row.get("run_id") == run_id)
    note = f"scoped to {run_id}: {len(kept)} of {len(table.rows)} row(s)"
    if table.status not in READABLE:
        return Table(table.name, table.status, table.header, kept, table.footer_count, table.problems + (note,))
    if kept:
        status = PRESENT
    else:
        # The query ran and its footer counted the rows; none of them is this run's.
        status = EMPTY_CONFIRMED if table.footer_count is not None else EMPTY_UNCONFIRMED
    return Table(table.name, status, table.header, kept, table.footer_count, table.problems + (note,))


def scope_to_run(bundle: EvidenceBundle, run_id: str | None, reason: str = "") -> EvidenceBundle:
    """The bundle read for ONE run. ``run_id`` None marks every row-bearing table UNATTRIBUTED with
    ``reason``: a bundle of several runs that cannot name its own is never read as their sum. Texts
    and the manifest are the job's own and pass through unchanged."""
    tables = {name: _scoped(table, run_id, reason or "the bundle's own run is not named") for name, table in bundle.tables.items()}
    return EvidenceBundle(bundle.path, bundle.manifest, bundle.manifest_present, tables, dict(bundle.texts),
                          list(bundle.problems))
