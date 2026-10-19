"""DRY-RUN ONLY (never part of a mission): the reference fix for defect B (future publication before rounding). Run from the workspace root."""
import pathlib

path = pathlib.Path('src/relay/mission/evidence/evidence-contracts.ts')
text = path.read_text(encoding='utf-8')


def swap(old: str, new: str) -> None:
    global text
    assert text.count(old) == 1, f'anchor not found exactly once: {old[:70]!r}'
    text = text.replace(old, new)


swap("  const minutes = Math.round((retrieved - published) / 60000);\n  if (minutes < 0) return { minutes: null, freshness: 'unknown' };\n",
     "  if (retrieved - published < 0) return { minutes: null, freshness: 'unknown' };\n  const minutes = Math.round((retrieved - published) / 60000);\n")
path.write_text(text, encoding='utf-8', newline='')
print('fix B applied')
