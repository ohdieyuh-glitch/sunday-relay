"""The execution session: what Julius granted, and what the script staged.

The runner configures exactly one session from Julius's control file before
the user script starts. Everything a script stages is held here and written
once, at exit, by ``flush``. The files it writes are PROPOSALS: Julius reads
them after the process ends and alone decides what enters the Project Brain.
"""

import json
import math
import os
import threading

from .errors import JuliusBrainValidationError, JuliusSessionError

RESULT_FORMAT = "julius-python-result.v1"
PROPOSAL_FORMAT = "julius-python-proposal.v1"

_lock = threading.Lock()
_session = None


class Session:
    def __init__(self, control):
        self.control = control
        self.execution_id = control["executionId"]
        self.mission_id = control["missionId"]
        self.task_id = control.get("taskId")
        self.inputs = control.get("inputs")
        self.output_dir = control["outputDir"]
        self.write_kinds = frozenset(control["writeGrant"]["kinds"])
        self.max_records = int(control["writeGrant"]["maxRecords"])
        with open(control["contextPath"], "r", encoding="utf-8") as handle:
            self.context = json.load(handle)
        with open(control["schemaPath"], "r", encoding="utf-8") as handle:
            self.schema = json.load(handle)
        self.proposals = []
        self.result_value = None
        self.result_set = False
        self.metrics = []
        self._counter = 0

    def next_proposal_id(self):
        self._counter += 1
        return "p%04d" % self._counter


def configure(control):
    """Called by the runner. A second configuration is refused."""
    global _session
    with _lock:
        if _session is not None:
            raise JuliusSessionError("julius session already configured")
        _session = Session(control)
    return _session


def configure_from_file(path):
    with open(path, "r", encoding="utf-8") as handle:
        return configure(json.load(handle))


def current():
    if _session is None:
        path = os.environ.get("JULIUS_PYTHON_CONTROL")
        if path:
            return configure_from_file(path)
        raise JuliusSessionError(
            "not inside a Julius Python execution (no session was configured)"
        )
    return _session


def reset_for_tests():
    global _session
    with _lock:
        _session = None


def ensure_json(value, path="value"):
    """Refuse values Julius could not store: NaN, infinities, non-string keys."""
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            raise JuliusBrainValidationError(
                "%s: must be finite (unknown is None, never NaN)" % path
            )
        return value
    if isinstance(value, (list, tuple)):
        return [ensure_json(item, "%s[%d]" % (path, index)) for index, item in enumerate(value)]
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise JuliusBrainValidationError("%s: keys must be strings" % path)
            out[key] = ensure_json(item, "%s.%s" % (path, key))
        return out
    raise JuliusBrainValidationError(
        "%s: %s is not JSON; convert it before staging" % (path, type(value).__name__)
    )


def _atomic_write(path, text):
    temp = "%s.%d.tmp" % (path, os.getpid())
    with open(temp, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    os.replace(temp, path)


def flush():
    """Write the structured result and the staged proposals. Idempotent."""
    session = _session
    if session is None:
        return
    control = session.control
    result = {
        "format": RESULT_FORMAT,
        "executionId": session.execution_id,
        "valueSet": session.result_set,
        "value": session.result_value,
        "metrics": session.metrics,
        "proposalCount": len(session.proposals),
    }
    _atomic_write(control["resultPath"], json.dumps(result, sort_keys=True, allow_nan=False))
    lines = [
        json.dumps(dict(proposal, format=PROPOSAL_FORMAT), sort_keys=True, allow_nan=False)
        for proposal in session.proposals
    ]
    _atomic_write(control["proposalsPath"], "\n".join(lines) + ("\n" if lines else ""))
