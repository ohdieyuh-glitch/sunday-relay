"""The learning loop's analysis layer: pre-registration and outcome evaluation."""

from .evaluate import evaluate_learning
from .registry import MetricSpec, Registration, RegistrationError, parse_registration

__all__ = ["evaluate_learning", "MetricSpec", "Registration", "RegistrationError", "parse_registration"]
