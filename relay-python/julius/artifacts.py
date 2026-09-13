"""Files a script hands back to Julius.

Artifacts are written into the execution's output directory only. Julius
hashes and stores the bytes after the process exits; a file is referenced from
the Brain only through ``julius.brain.register_artifact``.
"""

import os

from . import _session
from .errors import JuliusBrainValidationError


def path(name):
    session = _session.current()
    if os.path.basename(name) != name or name.startswith(".") or not name:
        raise JuliusBrainValidationError("artifact names are plain file names inside the output directory")
    return os.path.join(session.output_dir, name)


def write(name, content):
    target = path(name)
    if isinstance(content, str):
        with open(target, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
    elif isinstance(content, (bytes, bytearray, memoryview)):
        with open(target, "wb") as handle:
            handle.write(content)
    else:
        raise JuliusBrainValidationError("artifact content is str or bytes")
    return target
