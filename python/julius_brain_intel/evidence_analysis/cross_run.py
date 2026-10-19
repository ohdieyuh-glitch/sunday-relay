"""Anomalies across runs: which defects recur, which appeared, which went away.

Input is a sequence of ``julius.evidence-analysis.v1`` reports in the caller's order (oldest
first). A code present in every run is PERSISTENT; one that first appears in the latest run is
NEW; one present before and absent now is RESOLVED -- but only if the latest run could have
shown it, i.e. the evidence its detector reads was readable. Absence of evidence is not a
resolution.
"""

from __future__ import annotations

from typing import Any, Sequence

#: The detectors that read a table, and the table: a code is only RESOLVED if this was readable.
_SOURCE = {
    "LATENCY_UNRECORDED": "worker-diagnostics.tsv",
    "SERVED_MODEL_MISMATCH": "worker-diagnostics.tsv",
    "SERVED_MODEL_NOT_ATTESTED": "worker-diagnostics.tsv",
    "TOKEN_SOURCES_DISAGREE": "worker-diagnostics.tsv",
    "DUPLICATE_SETTLEMENT": "settlement-integrity.tsv",
    "OPEN_INVOCATION": "tool-invocations.tsv",
    "CODER_REPORT_REFUSED": "scope.tsv",
    "STALE_EVIDENCE_ACCEPT": "decisions.tsv",
}


def _readable(report: dict[str, Any], file: str) -> bool:
    for row in report.get("inventory", []):
        if row.get("file") == file:
            return row.get("status") in ("PRESENT", "EMPTY_CONFIRMED")
    return False


def compare_anomalies(reports: Sequence[dict[str, Any]]) -> dict[str, Any]:
    if not reports:
        return {"runs": [], "codes": {}}
    codes_per_run = [{a["code"] for a in report.get("anomalies", [])} for report in reports]
    latest = reports[-1]
    all_codes = sorted(set().union(*codes_per_run))
    verdicts: dict[str, Any] = {}
    for code in all_codes:
        present = [code in codes for codes in codes_per_run]
        if all(present):
            status = "PERSISTENT"
        elif present[-1] and not any(present[:-1]):
            status = "NEW"
        elif not present[-1] and any(present[:-1]):
            source = _SOURCE.get(code)
            status = "RESOLVED" if source is None or _readable(latest, source) else "UNKNOWN_SOURCE_UNREADABLE"
        else:
            status = "INTERMITTENT"
        verdicts[code] = {"status": status, "presentIn": [r.get("binding", {}).get("workflowRunId") for r, p in
                                                           zip(reports, present) if p]}
    return {"runs": [r.get("binding", {}).get("workflowRunId") for r in reports], "codes": verdicts}
