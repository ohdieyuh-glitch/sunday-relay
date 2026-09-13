"""The typed evidence vocabulary.

These classes are CONSTRUCTORS for Project Brain EVIDENCE and EVAL bodies, not
a parallel evidence universe: each renders to exactly the body schema the Brain
already defines, with ``evidenceClass`` naming which kind of observation it is.
The same vocabulary is what a future evaluation environment returns.

Unknown is ``None``, never ``0`` and never ``NaN``. A comparison whose baseline
was not measured has ``delta=None``, not ``delta=candidate``.
"""

from ._session import ensure_json

PASSED = "PASSED"
FAILED = "FAILED"
INCONCLUSIVE = "INCONCLUSIVE"

MAX_SERIES_POINTS = 1000
MAX_TABLE_ROWS = 200
MAX_TABLE_COLUMNS = 32


class Evidence:
    """Base: an observation that supports (or fails to support) a claim."""

    evidence_class = "OBSERVATION"

    def __init__(self, claim, summary, status=INCONCLUSIVE, data=None):
        if status not in (PASSED, FAILED, INCONCLUSIVE):
            raise ValueError("status must be PASSED, FAILED or INCONCLUSIVE")
        self.claim = str(claim)
        self.summary = str(summary)
        self.status = status
        self.data = data

    def body(self):
        return {
            "evidenceClass": self.evidence_class,
            "claim": self.claim,
            "summary": self.summary,
            "status": self.status,
            # A tool never verifies its own observation.
            "verification": "UNVERIFIED",
            "data": ensure_json(self.data, "data"),
            "juliusEvidenceId": None,
        }


class Observation(Evidence):
    evidence_class = "OBSERVATION"


class Measurement(Evidence):
    evidence_class = "MEASUREMENT"

    def __init__(self, name, value, unit=None, claim=None, status=INCONCLUSIVE, summary=None, samples=None):
        self.name = str(name)
        self.value = value
        self.unit = unit
        rendered = "unknown" if value is None else repr(value)
        super().__init__(
            claim if claim is not None else "%s was measured" % name,
            summary if summary is not None else "%s = %s%s" % (name, rendered, "" if unit is None else " " + unit),
            status,
            {"name": self.name, "value": value, "unit": unit, "samples": samples},
        )


class Comparison(Evidence):
    evidence_class = "COMPARISON"

    def __init__(self, name, baseline, candidate, better="LOWER", unit=None, claim=None, tolerance=0.0, summary=None):
        if better not in ("LOWER", "HIGHER"):
            raise ValueError("better must be LOWER or HIGHER")
        known = baseline is not None and candidate is not None
        delta = (candidate - baseline) if known else None
        relative = (delta / baseline) if known and baseline != 0 else None
        if not known:
            status = INCONCLUSIVE
        else:
            improved_or_equal = candidate <= baseline + tolerance if better == "LOWER" else candidate >= baseline - tolerance
            status = PASSED if improved_or_equal else FAILED
        super().__init__(
            claim if claim is not None else "%s is no worse than baseline" % name,
            summary if summary is not None else "%s: baseline %s, candidate %s, delta %s" % (name, baseline, candidate, delta),
            status,
            {"name": name, "baseline": baseline, "candidate": candidate, "delta": delta,
             "relativeChange": relative, "better": better, "unit": unit, "tolerance": tolerance},
        )


class Assertion(Evidence):
    evidence_class = "ASSERTION"

    def __init__(self, name, expected, actual, passed=None, claim=None, summary=None):
        outcome = (expected == actual) if passed is None else bool(passed)
        super().__init__(
            claim if claim is not None else "%s holds" % name,
            summary if summary is not None else "%s: expected %r, actual %r" % (name, expected, actual),
            PASSED if outcome else FAILED,
            {"name": name, "expected": expected, "actual": actual, "passed": outcome},
        )


class MetricSeries(Evidence):
    evidence_class = "METRIC_SERIES"

    def __init__(self, name, points, unit=None, claim=None, status=INCONCLUSIVE, summary=None):
        points = [[x, y] for x, y in points]
        if len(points) > MAX_SERIES_POINTS:
            raise ValueError("a metric series holds at most %d points; store the rest as an artifact" % MAX_SERIES_POINTS)
        super().__init__(
            claim if claim is not None else "%s series was recorded" % name,
            summary if summary is not None else "%s: %d points" % (name, len(points)),
            status,
            {"name": name, "unit": unit, "points": points},
        )


class Table(Evidence):
    evidence_class = "TABLE"

    def __init__(self, name, columns, rows, claim=None, status=INCONCLUSIVE, summary=None):
        columns = [str(column) for column in columns]
        rows = [list(row) for row in rows]
        if len(columns) > MAX_TABLE_COLUMNS or len(rows) > MAX_TABLE_ROWS:
            raise ValueError("a table holds at most %d columns and %d rows; store the rest as an artifact" % (MAX_TABLE_COLUMNS, MAX_TABLE_ROWS))
        for row in rows:
            if len(row) != len(columns):
                raise ValueError("every row must have %d cells" % len(columns))
        super().__init__(
            claim if claim is not None else "%s was tabulated" % name,
            summary if summary is not None else "%s: %d rows x %d columns" % (name, len(rows), len(columns)),
            status,
            {"name": name, "columns": columns, "rows": rows},
        )


class ExperimentResult(Evidence):
    evidence_class = "EXPERIMENT_RESULT"

    def __init__(self, name, hypothesis, outcome, metrics=(), claim=None, summary=None):
        if outcome not in ("SUPPORTED", "REFUTED", "INCONCLUSIVE"):
            raise ValueError("outcome must be SUPPORTED, REFUTED or INCONCLUSIVE")
        status = {"SUPPORTED": PASSED, "REFUTED": FAILED, "INCONCLUSIVE": INCONCLUSIVE}[outcome]
        super().__init__(
            claim if claim is not None else hypothesis,
            summary if summary is not None else "%s: hypothesis %s" % (name, outcome.lower()),
            status,
            {"name": name, "hypothesis": hypothesis, "outcome": outcome,
             "metrics": [_metric(metric) for metric in metrics]},
        )


class Failure(Evidence):
    evidence_class = "FAILURE"

    def __init__(self, name, error_type, message, claim=None):
        super().__init__(
            claim if claim is not None else "%s completed" % name,
            "%s failed: %s: %s" % (name, error_type, message),
            FAILED,
            {"name": name, "errorType": str(error_type), "message": str(message)[:2000]},
        )


class ArtifactResult(Evidence):
    evidence_class = "ARTIFACT_RESULT"

    def __init__(self, name, artifact_name, claim=None, status=INCONCLUSIVE, summary=None):
        super().__init__(
            claim if claim is not None else "%s was produced" % artifact_name,
            summary if summary is not None else "%s produced %s" % (name, artifact_name),
            status,
            {"name": name, "artifactName": artifact_name},
        )


def _metric(metric):
    if isinstance(metric, dict):
        return {"name": str(metric["name"]), "value": metric.get("value"), "unit": metric.get("unit")}
    name, value, *rest = metric
    return {"name": str(name), "value": value, "unit": rest[0] if rest else None}


class EvaluationResult:
    """An EVAL record. Reproducibility is filled in by Julius, not claimed here:
    the code hash, inputs hash, environment hash and run identity are facts
    about the execution only the host observed."""

    OUTCOMES = ("PASS", "FAIL", "REFUSED", "ERROR", "INCONCLUSIVE")
    TARGETS = ("ENTITY", "ARTIFACT", "COMMIT", "WORKER", "MODEL", "PROMPT", "DATASET", "OTHER")

    def __init__(self, name, target_kind, target_reference, outcome, score=None, max_score=None,
                 metrics=(), evaluator="python", seed=None, inputs=()):
        if outcome not in self.OUTCOMES:
            raise ValueError("outcome must be one of %s" % ", ".join(self.OUTCOMES))
        if target_kind not in self.TARGETS:
            raise ValueError("target_kind must be one of %s" % ", ".join(self.TARGETS))
        self.name = name
        self.target_kind = target_kind
        self.target_reference = target_reference
        self.outcome = outcome
        self.score = score
        self.max_score = max_score
        self.metrics = [_metric(metric) for metric in metrics]
        self.evaluator = evaluator
        self.seed = seed
        self.inputs = [
            {"name": str(item["name"]), "reference": str(item["reference"]), "contentHash": item.get("contentHash")}
            for item in inputs
        ]

    def body(self):
        return ensure_json({
            "evaluationName": self.name,
            "target": {"targetKind": self.target_kind, "reference": str(self.target_reference)},
            "inputs": self.inputs,
            "outcome": self.outcome,
            "score": self.score,
            "maxScore": self.max_score,
            "metrics": self.metrics,
            "evaluator": self.evaluator,
            "reproducibility": {
                "seed": self.seed, "codeHash": None, "inputsHash": None, "environmentHash": None,
                "commit": None, "command": None, "environmentRunId": None,
            },
        }, "eval")
