"""Evidence analysis: provenance, latency, tokens, settlement, findings, completeness, anomalies."""

from .anomalies import Anomaly, detect_anomalies
from .completeness import completeness, inventory
from .cross_run import compare_anomalies
from .digests import sha256_file, verify_artifact, verify_sums
from .learning_arm import RunScope, learning_record, own_run
from .mission import mission_summary
from .report import analyze_bundle
from .roles import RoleExecution, role_executions, served_model_match

__all__ = [
    "Anomaly", "detect_anomalies", "completeness", "inventory", "compare_anomalies", "sha256_file",
    "verify_artifact", "verify_sums", "RunScope", "learning_record", "own_run", "mission_summary",
    "analyze_bundle", "RoleExecution", "role_executions", "served_model_match",
]
