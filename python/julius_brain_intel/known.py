"""The tri-state value every analysis uses: a known value, or an Unknown that says why.

A missing latency is not 0 ms, a missing cost is not $0, and an empty file is not "nothing
happened" until something proves the query ran. ``Unknown`` carries its reason so the report
can say exactly which evidence was absent.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Iterable, TypeVar, Union

T = TypeVar("T")


@dataclass(frozen=True)
class Unknown:
    """A value the evidence does not establish, and why."""

    reason: str

    def to_json(self) -> dict[str, str]:
        return {"unknown": self.reason}

    def __bool__(self) -> bool:  # an Unknown is never truthy: `if value:` must not pass it
        return False


Reading = Union[T, Unknown]


def is_known(value: object) -> bool:
    return not isinstance(value, Unknown)


def as_json(value: object) -> Any:
    """A reading as JSON: ``{"value": x}`` or ``{"unknown": reason}``."""
    if isinstance(value, Unknown):
        return value.to_json()
    return {"value": value}


def known_or(value: "Reading[T]", fallback: T) -> T:
    return fallback if isinstance(value, Unknown) else value  # type: ignore[return-value]


def lift(fn: Callable[..., T], *args: object) -> "Reading[T]":
    """Apply ``fn`` only when every argument is known; otherwise the first Unknown wins."""
    for arg in args:
        if isinstance(arg, Unknown):
            return arg
    return fn(*args)


def first_unknown(values: Iterable[object]) -> "Unknown | None":
    for value in values:
        if isinstance(value, Unknown):
            return value
    return None


def parse_int(text: str | None, what: str) -> "Reading[int]":
    """An integer cell, or Unknown when the cell is blank or not an integer."""
    if text is None or text.strip() == "":
        return Unknown(f"{what} not recorded")
    try:
        return int(text.strip())
    except ValueError:
        return Unknown(f"{what} is not an integer: {text.strip()[:40]!r}")


def parse_bool(text: str | None, what: str) -> "Reading[bool]":
    if text is None or text.strip() == "":
        return Unknown(f"{what} not recorded")
    lowered = text.strip().lower()
    if lowered in ("t", "true"):
        return True
    if lowered in ("f", "false"):
        return False
    return Unknown(f"{what} is not a boolean: {text.strip()[:40]!r}")
