"""Evidence completeness: is everything a reading needs present, readable and bound to a run?

R-Z (pre-registered): a row that depends on an unreadable, zero-byte or header-only file is
UNKNOWN, and the inventory is recorded with any score. This module produces that inventory and
the list of required evidence a bundle lacks. It does not decide credit; it says what can be
read.
"""

from __future__ import annotations

from typing import Any

from ..boundary.evidence_bundle import EMPTY_CONFIRMED, PRESENT, EvidenceBundle

#: Tables a PAID mission bundle needs before any mission reading can be made. A preflight or
#: smoke bundle legitimately has no mission rows; its required set is the manifest only.
PAID_REQUIRED_TABLES: tuple[str, ...] = (
    "runs", "tasks", "decisions", "worker-diagnostics", "evidence", "trajectory", "contract-events",
    "tool-invocations", "scope", "failures", "settlement-integrity", "cost-accounting", "budget",
    "finding-status", "finding-lifecycle",
)
PAID_REQUIRED_TEXTS: tuple[str, ...] = ("workspace.diff", "workspace-status.txt", "live-mission.evidence.txt")
MANIFEST_KEYS: tuple[str, ...] = ("commit", "tree", "mode", "workflow_run_id", "workflow_run_attempt", "tracked_changes")


def inventory(bundle: EvidenceBundle) -> list[dict[str, Any]]:
    rows = []
    for name, table in sorted(bundle.tables.items()):
        rows.append({"file": f"{name}.tsv", "status": table.status, "rows": len(table.rows),
                     "footerCount": table.footer_count, "problems": list(table.problems)})
    for name, body in sorted(bundle.texts.items()):
        rows.append({"file": name, "status": "PRESENT" if body else "EMPTY", "bytes": len(body.encode("utf-8"))})
    return rows


def completeness(bundle: EvidenceBundle) -> dict[str, Any]:
    mode = bundle.manifest.get("mode", "")
    missing_keys = [key for key in MANIFEST_KEYS if not bundle.manifest.get(key)]
    tables_required = PAID_REQUIRED_TABLES if mode == "paid" else ()
    texts_required = PAID_REQUIRED_TEXTS if mode == "paid" else ()
    unreadable = []
    for name in tables_required:
        table = bundle.table(name)
        if table.status not in (PRESENT, EMPTY_CONFIRMED):
            unreadable.append({"file": f"{name}.tsv", "status": table.status, "problems": list(table.problems)})
    missing_texts = [name for name in texts_required if bundle.text(name) is None]
    required = len(tables_required) + len(texts_required) + len(MANIFEST_KEYS)
    satisfied = required - len(unreadable) - len(missing_texts) - len(missing_keys)
    return {
        "mode": mode or None,
        "boundToRun": bool(bundle.manifest.get("workflow_run_id")) and bool(bundle.manifest.get("commit")),
        "required": required,
        "satisfied": satisfied,
        "complete": satisfied == required,
        "missingManifestKeys": missing_keys,
        "unreadableTables": unreadable,
        "missingTexts": missing_texts,
        "bundleProblems": list(bundle.problems),
    }
