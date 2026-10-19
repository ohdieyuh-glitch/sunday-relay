"""What this package refuses to carry: credentials and hidden reasoning.

The same shapes the canonical Project Brain refuses (``projectBrainForbiddenMaterial`` in
``src/relay/mission/project-brain/project-brain.ts``) -- kept identical by a cross-language
test, so the two layers cannot disagree about what a secret looks like. Text that matches is
WITHHELD, never echoed: an analysis report is shared, and a report that quoted the secret it
found would be the leak.
"""

from __future__ import annotations

import re

#: A key's prefix starts a TOKEN. Without the left boundary, `sk-[…]{8,}` matched inside
#: `julius-task-contract.ts` and `julius-task-pipeline.ts`: the first real paid bundle this layer
#: read (run 36915013287) raised six false P0s on file paths, and the Brain refused, as a
#: credential, any statement naming those files. The boundary is in both layers, pinned by the
#: cross-language corpus test.
_B = r"(?<![A-Za-z0-9])"
SECRET_SHAPES: tuple[re.Pattern[str], ...] = (
    re.compile(_B + r"sk-[A-Za-z0-9_-]{8,}"),
    re.compile(_B + r"sk-ant-[A-Za-z0-9_-]{8,}"),
    re.compile(_B + r"AKIA[0-9A-Z]{12,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY"),
    re.compile(_B + r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(_B + r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(_B + r"xox[baprs]-[A-Za-z0-9-]{10,}"),
    re.compile(_B + r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}"),
    re.compile(
        r"\b(?:password|passwd|api[-_ ]?key|secret[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret)"
        r"\s*[:=]\s*\S{6,}",
        re.IGNORECASE,
    ),
    re.compile(r"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s:@/]+:[^\s@/]+@", re.IGNORECASE),
)
HIDDEN_REASONING = re.compile(
    r"chain[- ]of[- ]thought|hidden reasoning|<thinking>|</thinking>|internal monologue", re.IGNORECASE
)

CREDENTIAL = "credential"
REASONING = "hidden_reasoning"


def forbidden_material(text: str) -> str | None:
    """``"credential"``, ``"hidden_reasoning"`` or None -- the Brain's own rule, in order."""
    if any(shape.search(text) for shape in SECRET_SHAPES):
        return CREDENTIAL
    if HIDDEN_REASONING.search(text):
        return REASONING
    return None


def withheld(kind: str) -> str:
    return f"[withheld: {kind}-shaped content]"


def safe_text(text: str, limit: int = 400) -> str:
    """Text fit to appear in a report: refused material is withheld, the rest is bounded."""
    kind = forbidden_material(text)
    if kind is not None:
        return withheld(kind)
    return text if len(text) <= limit else text[:limit] + "…"
