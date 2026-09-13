"""Julius Project Brain SDK.

Python is a governed capability of Julius, not an authority. Inside a Julius
Python execution this package gives a script:

* ``julius.brain``     - read the scoped Project Brain snapshot Julius granted,
                          and STAGE typed records (evidence, evals, findings,
                          artifacts, memory, traces) for Julius to validate;
* ``julius.evidence``  - the typed evidence vocabulary (Measurement, Comparison,
                          Assertion, MetricSeries, Table, ExperimentResult,
                          Failure, EvaluationResult);
* ``julius.result``    - the structured return value and metrics;
* ``julius.artifacts`` - files to hand back, hashed and stored by Julius.

Nothing here writes to the Brain. A staged record is a proposal; Julius
decides whether it is admitted, after the execution ends, and only if the
execution was not cancelled. Standard library only.
"""

from . import artifacts, brain, evidence, result
from .errors import JuliusBrainValidationError, JuliusSessionError

__all__ = [
    "artifacts",
    "brain",
    "evidence",
    "result",
    "JuliusBrainValidationError",
    "JuliusSessionError",
]

__version__ = "0.1.0"
