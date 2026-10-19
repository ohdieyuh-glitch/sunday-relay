"""DRY-RUN ONLY (never part of a mission): the reference fix for defect A (notification latch). Run from the workspace root."""
import pathlib

path = pathlib.Path('src/relay/usage/usage-thresholds.ts')
text = path.read_text(encoding='utf-8')


def swap(old: str, new: str) -> None:
    global text
    assert text.count(old) == 1, f'anchor not found exactly once: {old[:70]!r}'
    text = text.replace(old, new)


swap("    if (usageWindow.percentUsed === null) continue; // unknown usage never notifies\n",
     "    if (usageWindow.percentUsed === null) {\n      // unknown usage never notifies and never re-arms: keep this section's keys\n      for (const key of previous) if (key.startsWith(`${section}|`)) next.add(key);\n      continue;\n    }\n")
swap("  if (contracts.remaining !== null) {\n    let candidate",
     "  if (contracts.remaining === null) {\n    for (const key of previous) if (key.startsWith('mission_contracts|')) next.add(key);\n  }\n  if (contracts.remaining !== null) {\n    let candidate")
path.write_text(text, encoding='utf-8', newline='')
print('fix A applied')
