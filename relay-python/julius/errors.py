"""Errors raised by the Julius SDK."""


class JuliusSessionError(RuntimeError):
    """The SDK is not running inside a configured Julius execution."""


class JuliusBrainValidationError(ValueError):
    """A staged record does not satisfy the Project Brain schema or grant."""

    def __init__(self, message, errors=()):
        super().__init__(message)
        self.errors = list(errors)


class JuliusGovernanceError(PermissionError):
    """An operation was denied by the execution's governance policy."""
