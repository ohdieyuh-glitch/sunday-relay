"""DRY-RUN ONLY (never part of a mission): the reference fix for defect B (no-progress signals). Run from the workspace root."""
import pathlib

path = pathlib.Path('src/relay/recovery/detection.ts')
text = path.read_text(encoding='utf-8')


def swap(old: str, new: str) -> None:
    global text
    assert text.count(old) == 1, f'anchor not found exactly once: {old[:70]!r}'
    text = text.replace(old, new)


swap("  if (current.diffFingerprint === previous.diffFingerprint) signals.push('identical-diff');\n",
     "  if (current.diffFingerprint && current.diffFingerprint === previous.diffFingerprint) signals.push('identical-diff');\n")
swap("  if (current.failureFingerprint === previous.failureFingerprint) signals.push('identical-failure');\n",
     "  if (current.failureFingerprint && current.failureFingerprint === previous.failureFingerprint) signals.push('identical-failure');\n")
swap("  if (current.reportPayloadFingerprint === previous.reportPayloadFingerprint) signals.push('identical-report');\n",
     "  if (current.reportPayloadFingerprint && current.reportPayloadFingerprint === previous.reportPayloadFingerprint) signals.push('identical-report');\n")
path.write_text(text, encoding='utf-8', newline='')
print('fix B applied')
