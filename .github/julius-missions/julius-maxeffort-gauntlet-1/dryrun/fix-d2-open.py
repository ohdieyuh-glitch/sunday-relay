"""DRY-RUN ONLY: the reference fix for defect D (a crash loses nothing), ONE entry point: next round opened but review never requested. Run from the workspace root."""
import pathlib

path = pathlib.Path('src/relay/mission/gauntlet/gauntlet-command.ts')
text = path.read_text(encoding='utf-8')


def swap(old: str, new: str) -> None:
    global text
    assert text.count(old) == 1, f'anchor not found exactly once: {old[:70]!r}'
    text = text.replace(old, new)


swap("  if (current.activation !== 'ACTIVE' || current.state !== 'READY') {\n",
     "  if (current.activation === 'ACTIVE' && current.state === 'RUNNING') {\n"
     "    // Opened already; the process may have died before the review was requested. Requesting again is idempotent by the work id.\n"
     "    return {\n"
     "      advanced: true, state: current.state, activation: current.activation, round: current.round,\n"
     "      nextWorkId: await schedule(current, 'REVIEW', deps), haltReason: current.haltReason,\n"
     "    };\n"
     "  }\n"
     "  if (current.activation !== 'ACTIVE' || current.state !== 'READY') {\n")
path.write_text(text, encoding='utf-8', newline='')
print('fix-d2-open.py applied')
