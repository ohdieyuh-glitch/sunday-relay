"""The structured return of an execution.

stdout and stderr are diagnostic evidence; this is the semantic interface. A
value set here is returned to Julius as JSON, alongside any metrics.
"""

from . import _session
from .errors import JuliusBrainValidationError

MAX_METRICS = 256


def set(value):  # noqa: A001 - `julius.result.set(...)` reads as intended
    session = _session.current()
    session.result_value = _session.ensure_json(value, "result")
    session.result_set = True


def metric(name, value, unit=None):
    session = _session.current()
    if len(session.metrics) >= MAX_METRICS:
        raise JuliusBrainValidationError("at most %d metrics" % MAX_METRICS)
    if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))):
        raise JuliusBrainValidationError("a metric value is a number, or None when unknown")
    session.metrics.append(_session.ensure_json({"name": str(name), "value": value, "unit": unit}, "metric"))
