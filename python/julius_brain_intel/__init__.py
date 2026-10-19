"""Julius Project Brain intelligence: evals, evidence analysis, memory intelligence, learning.

THE ANALYSIS LAYER, NOT A SECOND BRAIN. The TypeScript runtime is the deterministic control
plane and the canonical Project Brain (``relay-project-brain.v1``) is its only memory. This
package reads typed, versioned artifacts that runtime already produces -- the Brain document,
the context entries Julius reads, the paid-run evidence bundle -- and writes versioned JSON
reports. It never mutates kernel state, never stores reasoning, and never awards readiness
credit: an eval measures, the scorecard decides.

UNKNOWN STAYS UNKNOWN. A value the evidence does not carry is an ``Unknown`` with its reason,
never a zero, a default, or a value reconstructed from something adjacent.
"""

from __future__ import annotations

__version__ = "0.1.0"

#: The report schemas this package writes. Each is versioned; a reader refuses a version it
#: does not know rather than guessing at its shape.
EVIDENCE_ANALYSIS_SCHEMA = "julius.evidence-analysis.v1"
EVAL_SCHEMA = "julius.eval.v1"
MEMORY_EVAL_SCHEMA = "julius.memory-eval.v1"
LEARNING_REGISTRATION_SCHEMA = "julius.learning-registration.v1"
LEARNING_OUTCOME_SCHEMA = "julius.learning-outcome.v1"

#: Every report carries this, so no reader can mistake a measurement for a readiness verdict.
NOT_READINESS_AUTHORITY = (
    "measurement only: this report awards no beta-readiness credit; "
    "the scorecard's pre-registered rules decide credit"
)
